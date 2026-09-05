import "server-only";
import { logFlowEngineEvent } from "@/lib/messaging/telemetry";
import { getBotChatTarget } from "@/lib/services/whatsapp-bot";
import { deliverFlowEffects } from "./deliver";
import {
  claimFlowStep,
  commitFlowStep,
  dueFlowRuns,
  loadFlowRun,
  type DueFlowRun,
  type PendingFlowEvent,
} from "./store";
import type { MessagingProvider } from "@/lib/messaging/messaging.types";
import type { FlowEffect, FlowEngineState } from "@/modules/flow/flow.types";

/**
 * O TEMPO — §27 do Prompt 3.
 *
 * ⚠️ UMA CONVERSA QUE EMUDECE NÃO SE RESOLVE SOZINHA, e é isso que esta
 * varredura conserta. Sem ela, uma pergunta sem resposta deixa a execução em
 * `waiting_reply` para sempre: a conversa não aparece em fila nenhuma (não foi
 * transferida), não conta como resolvida e não conta como abandonada. Ela
 * simplesmente some — e some justamente quando alguém precisou de ajuda e não
 * conseguiu responder.
 *
 * ⚠️ E O COMPORTAMENTO É CONFIGURÁVEL POR FLUXO, porque o escopo é explícito em
 * não assumir um único ("não assumir um comportamento fixo"). Uma triagem de
 * imprensa pode querer transferir; uma consulta de preço pode querer encerrar.
 *
 * ⚠️ A VARREDURA NÃO TEM CAMINHO PRÓPRIO DE ESCRITA. Ela passa por
 * `flow_claim_step` e `flow_commit_step`, as mesmas portas de qualquer avanço —
 * então a idempotência (§23), a trava otimista (§24) e a trilha (§22) valem
 * aqui sem uma linha a mais. Um segundo caminho de escrita divergiria do
 * primeiro na primeira manutenção, e a conversa encerrada por tempo passaria a
 * ter uma trilha diferente da encerrada por conversa, pelo mesmo desfecho.
 */

/**
 * ⚠️ A VARIÁVEL DE SISTEMA, E O PREFIXO É DELIBERADO.
 *
 * `sys_` marca o que é do MOTOR e não do desenho. Duas consequências, as duas
 * queridas: ela aparece no contexto entregue ao atendente como qualquer outra
 * (é informação legítima — "esta pessoa já recebeu um lembrete"), e ela NÃO é
 * interpolável em texto, porque `interpolate` só aceita nomes começando por
 * letra. Ninguém escreve `{{sys_timeout_reminders}}` numa mensagem sem querer.
 */
const REMINDER_VARIABLE = "sys_timeout_reminders";

/**
 * ⚠️ UM LEMBRETE, E DEPOIS ENCERRA — e isto é uma decisão, não o escopo.
 *
 * O §27 lista "enviar lembrete" como uma das ações possíveis, e para aí. Mas
 * lembrete é a única das três que NÃO MUDA O ESTADO: depois dele a conversa
 * continua esperando resposta, vence de novo na janela seguinte, e lembra de
 * novo. Um associado que nunca mais responder receberia a mesma mensagem a cada
 * 24 horas, para sempre — que é a definição de spam, e viria do CRM da APCS.
 *
 * O lembrete é uma segunda chance, e uma segunda chance que se repete não é
 * chance nenhuma. Depois dele, o silêncio é resposta: a conversa encerra.
 */
const MAX_REMINDERS = 1;

export interface FlowTimeoutTickOutcome {
  examined: number;
  reminded: number;
  closed: number;
  transferred: number;
  skipped: number;
}

/**
 * Uma passada da varredura.
 *
 * ⚠️ CHAMAR DUAS VEZES SEGUIDAS É SEGURO, e é o que permite deixar o cron
 * agressivo sem medo. A chave de idempotência do passo carrega o `lock_version`
 * da execução: duas passadas sem nada ter mudado no meio pedem a MESMA chave, e
 * a segunda é recusada pelo índice único.
 */
export async function runFlowTimeoutTick(
  provider: MessagingProvider,
  correlationId: string,
  limit = 50,
): Promise<FlowTimeoutTickOutcome> {
  const resultado: FlowTimeoutTickOutcome = {
    examined: 0,
    reminded: 0,
    closed: 0,
    transferred: 0,
    skipped: 0,
  };

  const vencidas = await dueFlowRuns(limit);
  resultado.examined = vencidas.length;

  for (const vencida of vencidas) {
    try {
      const desfecho = await tratar(vencida, provider, correlationId);

      if (desfecho === "reminded") resultado.reminded += 1;
      else if (desfecho === "closed") resultado.closed += 1;
      else if (desfecho === "transferred") resultado.transferred += 1;
      else resultado.skipped += 1;
    } catch (erro) {
      // ⚠️ NADA AQUI LANÇA PARA FORA. Uma exceção viraria 500 na rota do cron,
      // e um cron que falha por causa de UMA conversa deixa as outras
      // quarenta e nove vencidas sem tratamento — indefinidamente, porque a
      // próxima passada esbarraria na mesma conversa.
      resultado.skipped += 1;
      logFlowEngineEvent("error", "flow.timeout", {
        correlationId,
        runId: vencida.runId,
        reason: erro instanceof Error ? erro.message : "erro desconhecido",
      });
    }
  }

  return resultado;
}

type Desfecho = "reminded" | "closed" | "transferred" | "skipped";

async function tratar(
  vencida: DueFlowRun,
  provider: MessagingProvider,
  correlationId: string,
): Promise<Desfecho> {
  const run = await loadFlowRun(vencida.runId);
  if (!run) return "skipped";

  // Entre a consulta e agora, alguém pode ter respondido. Reler e conferir é o
  // que impede a varredura de encerrar uma conversa que acabou de voltar à
  // vida — a trava otimista pegaria isso, mas tarde, depois de a mensagem de
  // encerramento já ter sido montada.
  if (run.state.status !== "running" && run.state.status !== "waiting_reply") {
    return "skipped";
  }

  const lembretes = Number(run.state.variables[REMINDER_VARIABLE] ?? "0") || 0;
  const acao = vencida.action === "remind" && lembretes >= MAX_REMINDERS ? "close" : vencida.action;

  const mensagem = vencida.message?.trim() || null;
  const efeitos: FlowEffect[] = [];
  const eventos: PendingFlowEvent[] = [
    {
      type: "flow_timeout",
      nodeId: run.state.currentNodeId,
      payload: { action: acao, silentMinutes: vencida.silentMinutes, reminders: lembretes },
    },
  ];

  let estado: FlowEngineState;
  let desfecho: Desfecho;

  switch (acao) {
    case "remind":
      // O estado NÃO muda: a conversa continua esperando a mesma resposta, no
      // mesmo nó. O que muda é o relógio — `flow_commit_step` carimba
      // `last_activity_at`, e a janela recomeça.
      estado = {
        ...run.state,
        variables: { ...run.state.variables, [REMINDER_VARIABLE]: String(lembretes + 1) },
      };
      if (mensagem) {
        efeitos.push({
          kind: "sendMessage",
          nodeId: run.state.currentNodeId ?? "",
          text: mensagem,
          delaySeconds: 0,
          imageUrl: null,
          pdfUrl: null,
          trigger: "timeout",
        });
      }
      desfecho = "reminded";
      break;

    case "transfer":
      if (!vencida.teamKey) {
        // O CHECK `flows_timeout_team` impede configurar `transfer` sem time —
        // mas o time pode ter sido DESATIVADO depois, e aí a consulta devolve
        // nulo. Transferir para lugar nenhum seria pior que não transferir.
        logFlowEngineEvent("error", "flow.timeout", {
          correlationId,
          runId: run.runId,
          reason: "fluxo transfere por tempo e o time nao esta ativo",
        });
        return "skipped";
      }
      estado = {
        ...run.state,
        status: "handed_off",
        conversationStatus: "in_service",
        assignedTeamKey: vencida.teamKey,
      };
      efeitos.push({
        kind: "assignTeam",
        nodeId: run.state.currentNodeId ?? "",
        teamKey: vencida.teamKey,
        message: mensagem,
        slaMinutes: null,
        priority: "normal",
        trigger: "timeout",
      });
      eventos.push({
        type: "transferred_to_team",
        nodeId: run.state.currentNodeId,
        payload: { teamKey: vencida.teamKey, trigger: "timeout" },
      });
      desfecho = "transferred";
      break;

    case "close":
    default:
      estado = { ...run.state, status: "completed", conversationStatus: "resolved" };
      efeitos.push({
        kind: "complete",
        nodeId: run.state.currentNodeId ?? "",
        message: mensagem,
        trigger: "timeout",
      });
      eventos.push({
        type: "flow_completed",
        nodeId: run.state.currentNodeId,
        payload: { trigger: "timeout" },
      });
      desfecho = "closed";
      break;
  }

  /* ---------------------------------------------------------------------- */

  // ⚠️ A CHAVE CARREGA O `lock_version`. Duas passadas do cron sem nada ter
  // mudado no meio pedem a MESMA chave, e o índice único recusa a segunda —
  // que é o §23 valendo para um gatilho que não é mensagem nenhuma.
  const stepId = await claimFlowStep({
    runId: run.runId,
    idempotencyKey: `timeout:${run.lockVersion}`,
    nodeId: run.state.currentNodeId,
    nodeType: null,
    input: { kind: "timeout", action: acao, silentMinutes: vencida.silentMinutes },
  });

  if (stepId === null) return "skipped";

  const gravou = await commitFlowStep({
    stepId,
    lockVersion: run.lockVersion,
    state: estado,
    output: { action: acao },
    events: eventos,
  });

  if (!gravou) return "skipped";

  if (run.whatsappChatId && efeitos.length > 0) {
    const target = await getBotChatTarget(run.whatsappChatId);
    if (target) {
      await deliverFlowEffects(efeitos, {
        target,
        provider,
        runId: run.runId,
        correlationId,
      });
    }
  }

  logFlowEngineEvent("info", "flow.timeout", {
    correlationId,
    runId: run.runId,
    flowId: run.flowId,
    status: estado.status,
    reason: acao,
  });

  return desfecho;
}
