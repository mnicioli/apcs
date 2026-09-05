import "server-only";
import { logFlowEngineEvent } from "@/lib/messaging/telemetry";
import { getBotChatTarget } from "@/lib/services/whatsapp-bot";
import { advanceFlow } from "@/modules/flow/flow.engine";
import {
  matchOption,
  questionInterpretsIntent,
  questionOptions,
} from "@/modules/flow/flow.node-config";
import {
  FLOW_INTENT_UNAVAILABLE,
  withFlowIntent,
  withoutFlowIntent,
  type FlowIntentReading,
} from "@/modules/flow/flow.intent";
import { BUSINESS_HOURS_VARIABLE } from "@/modules/flow/flow.hours";
/**
 * ⚠️ ESTE IMPORT NÃO É POR UM SÍMBOLO — É POR UM EFEITO COLATERAL, e ele é a
 * ligação entre o motor e os módulos da APCS.
 *
 * `FLOW_ACTION_HANDLERS` nasce VAZIO em `src/modules/flow/`, porque aquele
 * diretório é puro: não pode importar `server-only`, nem serviço, nem cliente
 * de banco (o simulador do Builder roda o mesmo motor sem nada disso). Quem o
 * preenche é `action-handlers.ts`, que já é `server-only`.
 *
 * Sem este import, todo nó de ação falharia com "ação sem handler ligado" — e
 * falharia em PRODUÇÃO, porque o simulador não passa por aqui. O import mora
 * neste arquivo por ser ele o único caminho pelo qual um turno de verdade
 * acontece. `FLOW_ACTION_HANDLERS_LOADED` é importado de propósito: sem uma
 * referência usada, o bundler pode podar o módulo inteiro.
 */
import { FLOW_ACTION_HANDLERS_LOADED } from "./action-handlers";
import { runFlowAction } from "./actions";
import { businessHoursVariables, resolveFlowIntent } from "./intent";
import { deliverFlowEffects } from "./deliver";
import {
  beginFlowRun,
  claimFlowStep,
  commitFlowStep,
  loadFlowRun,
  setFlowAutomationPause,
  type LoadedFlowRun,
  type PendingFlowEvent,
} from "./store";
import type { MessagingProvider } from "@/lib/messaging/messaging.types";
import type {
  CompiledFlowNode,
  FlowChannel,
  FlowEffect,
  FlowEngineInput,
  FlowEngineState,
  FlowStepStatus,
} from "@/modules/flow/flow.types";

/**
 * O FLOW ENGINE — a coreografia (§42 do Prompt 3).
 *
 * ⚠️ A DIVISÃO DE TRABALHO DESTE MÓDULO, PORQUE ELA É A ARQUITETURA INTEIRA:
 *
 *   `flow.engine.ts`   DECIDE. Puro, sem I/O. "Dado este desenho, este estado e
 *                      esta resposta, o que acontece?" Devolve efeitos.
 *   `store.ts`         GRAVA. Uma chamada por função do banco, sem regra.
 *   `deliver.ts`       FALA. Traduz efeito em mensagem de WhatsApp.
 *   `actions.ts`       CONSULTA. Chama o handler de negócio, com retry.
 *   ESTE ARQUIVO       ORQUESTRA. Chama os quatro na ordem certa e cuida do que
 *                      só existe quando eles se encontram: idempotência,
 *                      concorrência e trilha.
 *
 * ⚠️ E A ORDEM É A DECISÃO MAIS IMPORTANTE AQUI: GRAVA O ESTADO, DEPOIS FALA.
 *
 * A tentação é o contrário — falar primeiro, gravar depois, "para a pessoa não
 * esperar". Mas é entre esses dois momentos que mora o §24: se outra mensagem
 * já moveu a conversa, a trava otimista recusa a gravação. Falando antes, as
 * mensagens JÁ TERIAM SAÍDO, e a recusa chegaria tarde demais — o associado
 * receberia a pergunta de um nó que ele já passou.
 *
 * Gravando antes, a recusa acontece com ninguém tendo ouvido nada, e o turno é
 * simplesmente descartado. O preço é o inverso: uma falha de ENVIO depois da
 * gravação deixa o estado adiantado. Esse caso é visível — a mensagem fica
 * `failed` em `whatsapp_messages`, que é o mecanismo que a APCS já usa para
 * enxergar envio que não saiu — enquanto o outro seria invisível.
 */

/* -------------------------------------------------------------------------- */
/* Limites                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Quantas AÇÕES um único turno pode executar.
 *
 * ⚠️ NÃO É O MESMO TETO DO MOTOR. `LIMITE_DE_SALTOS` conta nós atravessados —
 * baratos, em memória. Este conta consultas ao CRM, cada uma com banco e
 * possivelmente rede. Um desenho com seis ações em fila entre duas perguntas
 * não é um fluxo: é um relatório, e ele estouraria o tempo do webhook antes de
 * chegar à sexta.
 */
const MAX_ACTIONS_PER_TURN = 4;

/**
 * A âncora do import por efeito colateral — ver o aviso em `./action-handlers`.
 *
 * ⚠️ SEM ESTA LINHA O BUNDLER PODE PODAR O MÓDULO INTEIRO, concluindo que um
 * import sem símbolo usado não faz nada. Os handlers não seriam registrados, e
 * todo nó de ação falharia com "ação sem handler ligado" — em produção, porque
 * o `dev` costuma não podar. É um defeito que só aparece depois do deploy, e é
 * por isso que ele merece uma linha e um comentário em vez de um import mudo.
 */
void FLOW_ACTION_HANDLERS_LOADED;

/** §29. Quanto tempo o robô fica calado quando ELE MESMO transfere. */
const HANDOFF_PAUSE_MINUTES = 12 * 60;

/* -------------------------------------------------------------------------- */
/* O que um turno devolve                                                     */
/* -------------------------------------------------------------------------- */

export type FlowTurnOutcome =
  /** Andou. `sent` é quantas mensagens saíram. */
  | { kind: "advanced"; runId: string; sent: number; failed: number }
  /** §23. A mensagem já tinha sido processada. Não é erro — é a reentrega. */
  | { kind: "duplicate"; runId: string }
  /** §24. Outra mensagem chegou primeiro. O turno foi descartado inteiro. */
  | { kind: "conflict"; runId: string }
  /** §29. Uma pessoa assumiu a conversa; o robô não fala. */
  | { kind: "paused"; runId: string }
  /** Não há fluxo de entrada ativo para o canal, ou a conversa não existe. */
  | { kind: "no_flow" }
  /** O desenho quebrou em execução. Ver `FlowEngineFailure`. */
  | { kind: "failed"; runId: string; reason: string };

export interface FlowTurnContext {
  provider: MessagingProvider;
  correlationId?: string;
}

/* -------------------------------------------------------------------------- */
/* §42 — a porta de entrada                                                   */
/* -------------------------------------------------------------------------- */

/**
 * UMA MENSAGEM CHEGOU. Começa o atendimento, ou continua o que já estava
 * andando.
 *
 * ⚠️ É UMA FUNÇÃO SÓ, E NÃO AS DUAS DO §42 (`startConversation` e
 * `processMessage`) — porque quem chama NÃO SABE qual das duas é o caso, e
 * obrigá-lo a adivinhar é criar um defeito.
 *
 * O webhook recebe "chegou texto na conversa X". Se ele tivesse de escolher,
 * escolheria pela pergunta errada ("já existe execução?") e chamaria `start`
 * numa conversa em andamento — que REINICIARIA o atendimento do zero, do nó
 * inicial, com as variáveis coletadas ainda no lugar. A pessoa receberia "Olá!
 * Você está no canal oficial da APCS" no meio da própria conversa, e nada teria
 * falhado.
 *
 * Quem sabe responder é o ESTADO, e ele está aqui: `currentNodeId` nulo
 * significa que a execução nasceu agora. Por isso a decisão mora dentro, depois
 * da leitura, e não do lado de fora, antes dela.
 *
 * ⚠️ E ELA É IDEMPOTENTE POR DUAS BARREIRAS DIFERENTES, as duas necessárias:
 * `flow_begin_run` devolve a execução ABERTA quando já existe (§28), então uma
 * segunda chamada não abre um fluxo paralelo; e o passo é reivindicado pela
 * chave da mensagem (§23), então a mesma mensagem não avança o fluxo duas vezes.
 */
export async function handleInboundFlowMessage(
  params: {
    channel: FlowChannel;
    chatId: string;
    /** O que a pessoa escreveu. Vazio numa abertura sem texto útil. */
    text: string;
    /** §23. O id da mensagem recebida. */
    idempotencyKey: string;
    inboundMessageId?: string | null;
  } & FlowTurnContext,
): Promise<FlowTurnOutcome> {
  const runId = await beginFlowRun(params.channel, params.chatId);

  if (!runId) {
    // Não é erro: é a APCS ainda não ter ligado o atendimento automático neste
    // canal. Quem chama segue para o próximo consumidor da mensagem.
    logFlowEngineEvent("info", "flow.step_skipped", {
      correlationId: params.correlationId,
      chatId: params.chatId,
      reason: "canal sem fluxo de entrada publicado",
    });
    return { kind: "no_flow" };
  }

  return executarTurno(runId, params.text, params);
}

/* -------------------------------------------------------------------------- */
/* §42 — pauseFlow / resumeFlow (§29 e §30)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Cala o robô nesta execução porque uma pessoa assumiu.
 *
 * ⚠️ POR MINUTOS, E NÃO "PARA SEMPRE". Um atendente que esquece de encerrar
 * deixaria a conversa mudo-para-sempre — e o associado que voltasse três dias
 * depois com outro assunto não seria atendido por ninguém. O prazo expira
 * sozinho, e o §30 (voltar ao robô) fica sendo o caso normal em vez de uma
 * intervenção que alguém precisa lembrar de fazer.
 */
export async function pauseFlowAutomation(
  runId: string,
  minutes: number = HANDOFF_PAUSE_MINUTES,
): Promise<boolean> {
  const ate = new Date(Date.now() + Math.max(1, minutes) * 60_000);
  return setFlowAutomationPause(runId, ate);
}

/** §30. O atendente terminou: a conversa volta ao fluxo automático. */
export async function resumeFlowAutomation(runId: string): Promise<boolean> {
  return setFlowAutomationPause(runId, null);
}

/* -------------------------------------------------------------------------- */
/* O turno                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * O ciclo completo de um avanço. É onde as seis regras se encontram.
 *
 * A ordem, e o porquê de cada passo estar onde está:
 *
 *   1. LÊ o estado + o retrato congelado (§33: nunca o desenho editável)
 *   2. PAUSA? o robô não atravessa conversa humana (§29)
 *   3. REIVINDICA o passo — a reentrega para aqui, em silêncio (§23)
 *   4. DECIDE, executando as ações que o motor pedir no caminho (§15, §25)
 *   5. GRAVA o estado com a trava otimista — o §24 recusa aqui, antes de falar
 *   6. FALA (§7)
 */
async function executarTurno(
  runId: string,
  texto: string,
  ctx: FlowTurnContext & { inboundMessageId?: string | null; idempotencyKey: string },
): Promise<FlowTurnOutcome> {
  const comeco = Date.now();

  /* 1 ------------------------------------------------------------------- */
  const run = await loadFlowRun(runId);
  if (!run) return { kind: "no_flow" };

  // ⚠️ A DECISÃO ENTRE ABRIR E CONTINUAR MORA AQUI, DEPOIS DA LEITURA. Ver o
  // aviso em `handleInboundFlowMessage`: `currentNodeId` nulo significa que a
  // execução nasceu agora, e é a única pergunta capaz de responder isto sem
  // adivinhação.
  const nascendo = run.state.currentNodeId === null;
  const entrada: FlowEngineInput = nascendo ? { kind: "start" } : { kind: "reply", text: texto };

  if (nascendo) {
    logFlowEngineEvent("info", "flow.run_started", {
      correlationId: ctx.correlationId,
      runId,
      chatId: run.whatsappChatId ?? undefined,
      flowId: run.flowId,
      flowVersionId: run.flowVersionId,
    });
  }

  /* 2 ------------------------------------------------------------------- */
  if (estaPausada(run)) {
    logFlowEngineEvent("info", "flow.paused", {
      correlationId: ctx.correlationId,
      runId,
      reason: "atendimento humano em andamento",
    });
    return { kind: "paused", runId };
  }

  /* 3 ------------------------------------------------------------------- */
  const noAtual = acharNode(run, run.state.currentNodeId);

  /**
   * ⚠️ AS VARIÁVEIS DO SISTEMA ENTRAM AQUI, ANTES DE O MOTOR DECIDIR — e o
   * "antes" é a arquitetura inteira do §13.
   *
   * A IA é consultada NESTE PONTO, fora do motor, e o que ela devolve é gravado
   * como variável. Quando `advanceFlow` roda, logo abaixo, a leitura já é um
   * dado igual a "cidade" ou "assunto": o motor não sabe que houve modelo, não
   * tem tipo capaz de nomear um nó a partir dela, e escolhe o caminho pelas
   * mesmas setas de sempre.
   *
   * Enfiar a chamada de IA dentro do motor seria o caminho curto — e a partir
   * daí "a IA não decide o fluxo" viraria uma promessa em comentário, mantida
   * por ninguém quebrá-la. Aqui é uma propriedade de quem importa o quê.
   */
  const { run: comSistema, leitura } = await comVariaveisDoSistema(run, texto, noAtual, ctx);

  const stepId = await claimFlowStep({
    runId,
    idempotencyKey: ctx.idempotencyKey,
    nodeId: run.state.currentNodeId,
    nodeType: noAtual?.type ?? null,
    input: { kind: entrada.kind },
    inboundMessageId: ctx.inboundMessageId ?? null,
  });

  if (stepId === null) {
    // ⚠️ SILÊNCIO, E NÃO ERRO. O fornecedor reentregou o mesmo webhook — o que
    // ele faz de propósito quando a primeira resposta demora. O passo já foi
    // dado e as mensagens já saíram; refazer qualquer parte disso duplicaria
    // uma mensagem no WhatsApp de um associado.
    logFlowEngineEvent("info", "flow.step_skipped", {
      correlationId: ctx.correlationId,
      runId,
      idempotencyKey: ctx.idempotencyKey,
      reason: "mensagem ja processada",
    });
    return { kind: "duplicate", runId };
  }

  /* 4 ------------------------------------------------------------------- */
  const decidido = await decidir(comSistema, entrada, stepId, ctx);

  /* 5 ------------------------------------------------------------------- */
  // ⚠️ O PREDICADO É NECESSÁRIO, e não é cerimônia: sem ele `find` devolve
  // `FlowEffect | undefined`, e `falha.reason` não existe em cinco das seis
  // variantes. É o type-check cobrando que o código diga QUAL efeito procurou.
  const falha = decidido.effects.find(
    (e): e is Extract<FlowEffect, { kind: "fail" }> => e.kind === "fail",
  );
  const stepStatus: FlowStepStatus = falha ? "failed" : "succeeded";

  const gravou = await commitFlowStep({
    stepId,
    lockVersion: run.lockVersion,
    state: decidido.state,
    stepStatus,
    output: { effects: decidido.effects.map((e) => e.kind), actions: decidido.actionsRun },
    // §35. A frase técnica fica NO PASSO. O associado nunca a lê.
    error: falha ? `O motor parou em ${falha.reason}.` : null,
    failureReason: falha ? falha.reason : null,
    events: decidido.events,
    // §10. O DELTA deste turno. O banco soma; mandar o total dobraria a conta.
    nodesWalked: decidido.nodesWalked,
    /**
     * §30. A LEITURA DA IA VAI PARA A COLUNA, e é o que fecha a lacuna que o
     * Prompt 4 deixou declarada: `flow_runs.intent` existia desde o Prompt 1 e
     * ninguém a preenchia.
     *
     * ⚠️ `null` QUANDO NÃO HOUVE LEITURA, e o banco PRESERVA a anterior nesse
     * caso. É deliberadamente o oposto das variáveis `sys_intent*`, que morrem
     * a cada turno: a variável decide CAMINHO, e uma leitura velha decidiria
     * errado; a coluna responde "o que a IA entendeu nesta conversa", e ali a
     * leitura velha é a única resposta que existe.
     *
     * ⚠️ E A LEITURA INDISPONÍVEL NÃO ENTRA. `sys_ia_indisponivel` não é uma
     * intenção — é a ausência de uma —, e gravá-la faria a média de confiança
     * do §47 incluir zeros que não medem nada.
     */
    intent: leitura && leitura.intent !== FLOW_INTENT_UNAVAILABLE ? leitura.intent : null,
    intentConfidence:
      leitura && leitura.intent !== FLOW_INTENT_UNAVAILABLE ? leitura.confidence : null,
  });

  if (!gravou) {
    // §24. Outra mensagem moveu a conversa entre a leitura e esta escrita.
    // Nada foi enviado, e é justamente por isso que a gravação vem antes da
    // fala. O turno é descartado inteiro.
    logFlowEngineEvent("error", "flow.conflict", {
      correlationId: ctx.correlationId,
      runId,
      stepId,
      reason: "trava otimista recusou",
    });
    return { kind: "conflict", runId };
  }

  /* 6 ------------------------------------------------------------------- */
  const entregue = await entregar(run, decidido.effects, ctx);

  // §29. Quando o PRÓPRIO robô transfere, ele se cala: entre o "vou te
  // encaminhar" e o atendente aparecer podem se passar horas, e sem isto ele
  // responderia a tudo que a pessoa escrevesse enquanto espera.
  if (decidido.effects.some((e) => e.kind === "assignTeam")) {
    await pauseFlowAutomation(runId);
  }

  logFlowEngineEvent(falha ? "error" : "info", falha ? "flow.failed" : "flow.node", {
    correlationId: ctx.correlationId,
    runId,
    stepId,
    flowId: run.flowId,
    flowVersionId: run.flowVersionId,
    nodeId: decidido.state.currentNodeId ?? undefined,
    status: decidido.state.status,
    durationMs: Date.now() - comeco,
    reason: falha?.reason,
  });

  if (falha) return { kind: "failed", runId, reason: falha.reason };

  return { kind: "advanced", runId, sent: entregue.sent, failed: entregue.failed };
}

/* -------------------------------------------------------------------------- */
/* A decisão, com as ações no meio                                            */
/* -------------------------------------------------------------------------- */

interface Decidido {
  state: FlowEngineState;
  effects: FlowEffect[];
  events: PendingFlowEvent[];
  actionsRun: number;
  /**
   * §10. A SOMA dos nós atravessados nas várias voltas do laço de ações.
   *
   * ⚠️ SOMA, E NÃO O ÚLTIMO. Um turno com duas ações chama `advanceFlow` três
   * vezes; guardar só o último resultado contaria apenas o trecho final, e um
   * fluxo cheio de ações passaria pela trava do §10 sem ser notado.
   */
  nodesWalked: number;
}

/**
 * Roda o motor até ele parar de pedir ação.
 *
 * ⚠️ O LAÇO EXISTE PORQUE O MOTOR PARA NA AÇÃO DE PROPÓSITO. Ele emite
 * `runAction` e devolve o controle — ele não sabe consultar a Bolsa, e não deve
 * saber (§15). Quem consulta é `runFlowAction`; o resultado volta como
 * `actionResult` e a travessia continua de onde parou. Duas ações seguidas no
 * desenho são duas voltas aqui.
 */
async function decidir(
  run: LoadedFlowRun,
  entrada: FlowEngineInput,
  stepId: number,
  ctx: FlowTurnContext & { idempotencyKey: string },
): Promise<Decidido> {
  const efeitos: FlowEffect[] = [];
  const eventos: PendingFlowEvent[] = [];
  let acoes = 0;
  let andados = 0;

  let resultado = advanceFlow(run.definition, run.state, entrada);
  andados += resultado.nodesWalked;
  efeitos.push(...resultado.effects);
  eventos.push(...eventosDosEfeitos(resultado.effects, entrada));

  while (acoes < MAX_ACTIONS_PER_TURN) {
    const pedido = resultado.effects.find(
      (e): e is Extract<FlowEffect, { kind: "runAction" }> => e.kind === "runAction",
    );
    if (!pedido) break;

    acoes += 1;

    const executada = await runFlowAction({
      actionKey: pedido.actionKey,
      arguments: pedido.arguments,
      maxAttempts: pedido.maxAttempts,
      variables: resultado.state.variables,
      whatsappChatId: run.whatsappChatId,
      // ⚠️ A CHAVE DO PASSO GANHA O NÚMERO DA AÇÃO. Duas ações no mesmo turno
      // são duas operações distintas — dar-lhes a mesma chave faria a segunda
      // parecer, para um handler de escrita, uma reentrega da primeira.
      idempotencyKey: `${ctx.idempotencyKey}:${stepId}:${acoes}`,
      runId: run.runId,
      nodeId: pedido.nodeId,
      correlationId: ctx.correlationId,
    });

    eventos.push({
      type: "action_executed",
      nodeId: pedido.nodeId,
      payload: {
        actionKey: pedido.actionKey,
        status: executada.status,
        attempts: executada.attempts,
        durationMs: executada.durationMs,
      },
    });

    resultado = advanceFlow(run.definition, resultado.state, {
      kind: "actionResult",
      status: executada.status,
      variables: executada.variables,
    });

    andados += resultado.nodesWalked;
    efeitos.push(...resultado.effects);
    eventos.push(...eventosDosEfeitos(resultado.effects, null));
  }

  // Estourou o teto de ações. O estado fica onde está (parado no nó de ação) e
  // o turno vira falha — insistir daria o mesmo resultado, e seguir em frente
  // significaria pular uma consulta que o desenho considera necessária.
  if (acoes >= MAX_ACTIONS_PER_TURN && resultado.effects.some((e) => e.kind === "runAction")) {
    efeitos.push({ kind: "fail", nodeId: resultado.state.currentNodeId, reason: "hop_limit" });
  }

  return {
    state: resultado.state,
    effects: efeitos,
    events: eventos,
    actionsRun: acoes,
    nodesWalked: andados,
  };
}

/* -------------------------------------------------------------------------- */
/* A trilha (§22)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Os eventos que um conjunto de efeitos produz.
 *
 * ⚠️ NENHUM DELES CARREGA O TEXTO DA PESSOA NEM O TEXTO ENVIADO. O que a pessoa
 * escreveu vive em `whatsapp_messages`, com a retenção de lá; duplicá-lo aqui
 * criaria uma segunda cópia de dado pessoal numa tabela que ninguém lembraria
 * de expurgar. O que entra é vocabulário do desenho — a chave da alternativa, o
 * time, o número da tentativa.
 */
function eventosDosEfeitos(
  effects: readonly FlowEffect[],
  entrada: FlowEngineInput | null,
): PendingFlowEvent[] {
  const eventos: PendingFlowEvent[] = [];

  if (entrada?.kind === "reply") {
    eventos.push({ type: "answer_received", payload: {} });
  }

  for (const effect of effects) {
    switch (effect.kind) {
      case "sendMessage":
        eventos.push({
          type: "message_sent",
          nodeId: effect.nodeId,
          payload: {
            trigger: effect.trigger,
            hasAttachment: Boolean(effect.imageUrl || effect.pdfUrl),
          },
        });
        break;

      case "askQuestion":
        eventos.push({
          type: "question_sent",
          nodeId: effect.nodeId,
          payload: { options: effect.options.length },
        });
        break;

      case "repeatQuestion":
        // §11. É este evento que responde "quantas pessoas não entendem esta
        // pergunta" — a métrica de fallback do §36, que não existiria se a
        // repetição fosse apenas uma pergunta enviada de novo.
        eventos.push({
          type: "answer_rejected",
          nodeId: effect.nodeId,
          payload: { attempt: effect.attempt, maxAttempts: effect.maxAttempts },
        });
        break;

      case "assignTeam":
        eventos.push({
          type: "transferred_to_team",
          nodeId: effect.nodeId,
          payload: {
            teamKey: effect.teamKey,
            priority: effect.priority,
            slaMinutes: effect.slaMinutes,
            trigger: effect.trigger,
          },
        });
        break;

      case "complete":
        eventos.push({
          type: "flow_completed",
          nodeId: effect.nodeId,
          payload: { trigger: effect.trigger },
        });
        break;

      case "fail":
        eventos.push({
          type: "flow_failed",
          nodeId: effect.nodeId,
          payload: { reason: effect.reason },
        });
        break;

      case "runAction":
        // O evento da ação é emitido por quem a EXECUTA, com o desfecho e a
        // duração. Emiti-lo aqui registraria a intenção, não o fato.
        break;
    }
  }

  return eventos;
}

/* -------------------------------------------------------------------------- */
/* Miudezas                                                                   */
/* -------------------------------------------------------------------------- */

async function entregar(
  run: LoadedFlowRun,
  effects: readonly FlowEffect[],
  ctx: FlowTurnContext,
): Promise<{ sent: number; failed: number }> {
  if (!run.whatsappChatId) return { sent: 0, failed: 0 };

  const target = await getBotChatTarget(run.whatsappChatId);
  if (!target) return { sent: 0, failed: 0 };

  const resultado = await deliverFlowEffects(effects, {
    target,
    provider: ctx.provider,
    runId: run.runId,
    correlationId: ctx.correlationId,
  });

  return { sent: resultado.sent, failed: resultado.failed };
}

/** §29. O robô fala nesta conversa agora? */
function estaPausada(run: LoadedFlowRun): boolean {
  if (!run.automationPausedUntil) return false;
  return new Date(run.automationPausedUntil).getTime() > Date.now();
}

function acharNode(run: LoadedFlowRun, id: string | null): CompiledFlowNode | null {
  if (!id) return null;
  return run.definition.nodes.find((n) => n.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/* As variáveis do sistema (§13, §14, §16, §34 do Prompt 4)                   */
/* -------------------------------------------------------------------------- */

/**
 * O desenho menciona esta variável em algum lugar?
 *
 * ⚠️ É UMA BUSCA DE TEXTO NO RETRATO CONGELADO, e a grosseria é deliberada. A
 * alternativa "correta" — varrer nós e transições campo a campo, sabendo onde
 * uma variável pode aparecer — teria de conhecer a forma de cada configuração,
 * e passaria a mentir na primeira vez que alguém acrescentasse um campo novo
 * que aceita `{{...}}`. Mentindo, o sintoma seria a variável não ser calculada
 * e a condição não casar: um fluxo que simplesmente pega o caminho errado, sem
 * nada falhar.
 *
 * O texto acha em qualquer campo, hoje e depois. O custo é um `stringify` de um
 * objeto que já está na memória, uma vez por turno, e só para as variáveis cujo
 * cálculo é caro o bastante para valer a pergunta.
 *
 * ⚠️ FALSO POSITIVO É INOFENSIVO: no pior caso a variável é calculada sem
 * ninguém usá-la. Falso NEGATIVO seria o defeito silencioso — e a busca de
 * texto não tem como produzir um.
 */
function desenhoUsa(run: LoadedFlowRun, nome: string): boolean {
  return JSON.stringify(run.definition).includes(nome);
}

/**
 * Acrescenta ao estado o que o MOTOR sabe e o desenho não tem como saber.
 *
 * ⚠️ AS DUAS TÊM CUSTO, E POR ISSO AS DUAS SÃO CONDICIONAIS:
 *
 *   o expediente   custa uma leitura de `app_settings`. Só é calculado se o
 *                  desenho citar `sys_horario_atendimento` em algum lugar.
 *   a intenção     custa uma chamada de modelo. Só acontece numa PERGUNTA
 *                  marcada com `interpretIntent` cuja resposta não casou com
 *                  alternativa nenhuma.
 *
 * O segundo é o que importa: um fluxo de menu puro — o caso mais comum — nunca
 * chama a IA. Quem digitou "2" sai pela alternativa, e o modelo não é
 * consultado. É o §16 ("os dois simultaneamente") com a conta certa: o texto
 * livre só custa quando é de fato texto livre.
 */
async function comVariaveisDoSistema(
  run: LoadedFlowRun,
  texto: string,
  noAtual: CompiledFlowNode | null,
  ctx: FlowTurnContext,
): Promise<{ run: LoadedFlowRun; leitura: FlowIntentReading | null }> {
  /**
   * ⚠️ A LEITURA ANTERIOR MORRE AQUI, ANTES DE QUALQUER COISA — e a linha vale
   * o comentário porque a ausência dela era um defeito com cara de acerto.
   *
   * Sem isto, um `sys_intent_band=high` lido três turnos atrás continuava no
   * contexto e casava com uma seta de intenção HOJE. Quem digitasse "3" para
   * falar com um atendente, num nó sem seta `answer` para aquela alternativa,
   * receberia a Bolsa — porque a seta de variável casaria com a leitura velha.
   * Ver `withoutFlowIntent`, onde a história está inteira.
   */
  let variables = withoutFlowIntent(run.state.variables);

  /* §34 — o expediente ------------------------------------------------- */
  if (desenhoUsa(run, BUSINESS_HOURS_VARIABLE)) {
    // ⚠️ RECALCULADO A CADA TURNO, e não congelado na abertura: uma conversa
    // que começa às 17h58 e chega ao nó de transferência às 18h02 tem de
    // transferir como fora do expediente.
    variables = { ...variables, ...(await businessHoursVariables()) };
  }

  /* §12, §13, §16 — a intenção ------------------------------------------ */
  const perguntaAberta =
    noAtual !== null &&
    noAtual.type === "question" &&
    run.state.status === "waiting_reply" &&
    questionInterpretsIntent(noAtual);

  if (!perguntaAberta || texto.trim() === "") {
    return { run: { ...run, state: { ...run.state, variables } }, leitura: null };
  }

  /**
   * ⚠️ A ALTERNATIVA É TENTADA PRIMEIRO, AQUI E DE NOVO NO MOTOR.
   *
   * A repetição é real e é intencional: este `matchOption` decide se vale
   * GASTAR o modelo, e o do motor decide o caminho. Sem o daqui, quem digitasse
   * "2" pagaria uma classificação para nada, em toda resposta de menu — e a IA
   * ficaria no caminho crítico de um fluxo que não precisa dela.
   *
   * As duas chamadas usam a MESMA função sobre as MESMAS alternativas, então
   * não há como divergirem: se esta casa, a do motor casa.
   */
  if (matchOption(texto, questionOptions(noAtual))) {
    return { run: { ...run, state: { ...run.state, variables } }, leitura: null };
  }

  const leitura = await resolveFlowIntent({
    message: texto,
    runId: run.runId,
    nodeId: noAtual.id,
    correlationId: ctx.correlationId,
  });

  return {
    run: { ...run, state: { ...run.state, variables: withFlowIntent(variables, leitura) } },
    leitura,
  };
}
