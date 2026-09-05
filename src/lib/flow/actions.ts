import "server-only";
import { backoffDelayMs } from "@/lib/messaging/resilience";
import { logFlowEngineEvent } from "@/lib/messaging/telemetry";
import {
  flowActionHandler,
  isFlowActionKey,
  type FlowActionOutput,
} from "@/modules/flow/flow.actions.registry";
import type { FlowActionStatus, FlowVariables } from "@/modules/flow/flow.types";

/**
 * A EXECUÇÃO DE UMA AÇÃO DE NEGÓCIO — o §15 e o §25 do Prompt 3.
 *
 * ⚠️ NÃO EXISTE UMA LINHA SOBRE BOLSA, NORMATIVA OU EVENTO NESTE ARQUIVO, e
 * essa ausência é o §15 inteiro ("não colocar regra específica da Bolsa dentro
 * do Flow Engine"). O que existe aqui é a coreografia comum a QUALQUER ação:
 * achar o handler no registro, chamá-lo, insistir quando ele pede, traduzir o
 * desfecho para o vocabulário do motor.
 *
 * Ligar a Bolsa continua sendo UMA entrada em `FLOW_ACTION_HANDLERS`. Nem este
 * arquivo, nem o motor, nem a tela precisam saber que isso aconteceu.
 */

export interface RunActionInput {
  actionKey: string;
  arguments: Record<string, string>;
  /** §25. O teto configurado no nó. Ver `actionNodeConfigSchema`. */
  maxAttempts: number;
  variables: FlowVariables;
  whatsappChatId: string | null;
  /**
   * ⚠️ A CHAVE DE IDEMPOTÊNCIA DO PASSO, REPASSADA AO HANDLER. Um handler de
   * ESCRITA (abrir um chamado, registrar uma palestra) precisa dela para que a
   * segunda entrega da mesma mensagem não vire um segundo protocolo.
   * `lectures.idempotency_key` já existe exatamente para isso.
   */
  idempotencyKey: string;
  runId: string;
  nodeId: string;
  correlationId?: string;
}

export interface RunActionResult {
  status: FlowActionStatus;
  variables: FlowVariables;
  /** A frase técnica, para o passo. Nunca chega ao associado (§35). */
  error: string | null;
  /** Quantas vezes o handler foi chamado. Vai para a trilha e para o log. */
  attempts: number;
  durationMs: number;
}

/** O vocabulário do handler traduzido para o do motor. Ver `FlowActionOutput`. */
function traduzir(saida: FlowActionOutput): FlowActionStatus {
  if (saida.ok) return "success";
  if (saida.reason === "empty") return "not_found";
  if (saida.reason === "retry") return "retry";
  return "failure";
}

/**
 * Executa uma ação, insistindo só quando faz sentido insistir.
 *
 * ⚠️ SÓ `retry` É REPETIDO, E ESSA É A DISTINÇÃO INTEIRA DO §25. Uma consulta
 * que respondeu "não encontrei" RESPONDEU: repeti-la três vezes daria a mesma
 * resposta, gastaria três vezes o serviço e atrasaria a pessoa em segundos sem
 * mudar nada. Uma que falhou por dado inválido também não melhora sozinha.
 *
 * ⚠️ E A ÚLTIMA TENTATIVA QUE AINDA PEDE `retry` VIRA `failure`. Devolver
 * `retry` para o motor seria devolver um estado que não existe no desenho — o
 * desenhador tem caminhos para "deu certo", "não achei" e "falhou", e não para
 * "ainda estou tentando". O teto acabou; a resposta honesta é que falhou.
 */
export async function runFlowAction(entrada: RunActionInput): Promise<RunActionResult> {
  const comeco = Date.now();
  // Numa constante, e não como `entrada.actionKey` solto: o estreitamento do
  // guarda precisa sobreviver até o `flowActionHandler` lá embaixo.
  const chave = entrada.actionKey;

  if (!isFlowActionKey(chave)) {
    // Um retrato congelado pode citar uma ação que este build não conhece —
    // ela foi removida do registro depois da publicação. Não decidir é a
    // postura certa: o desenho tem um caminho para `failure`.
    return {
      status: "failure",
      variables: {},
      error: `Ação desconhecida neste build: ${entrada.actionKey}`,
      attempts: 0,
      durationMs: Date.now() - comeco,
    };
  }

  const handler = flowActionHandler(chave);

  if (!handler) {
    // §15. A ação existe no registro e ainda não tem handler ligado. A
    // publicação recusa fluxos assim (`pendingFlowActions`), então chegar aqui
    // significa que o handler foi DESLIGADO depois de a versão ir ao ar.
    return {
      status: "failure",
      variables: {},
      error: `Ação sem handler ligado: ${entrada.actionKey}`,
      attempts: 0,
      durationMs: Date.now() - comeco,
    };
  }

  const teto = Math.max(1, Math.min(5, entrada.maxAttempts));
  let ultimoErro: string | null = null;

  for (let tentativa = 1; tentativa <= teto; tentativa += 1) {
    let saida: FlowActionOutput;

    try {
      saida = await handler({
        variables: entrada.variables,
        whatsappChatId: entrada.whatsappChatId,
        // ⚠️ A CHAVE DO PASSO GANHA O NÚMERO DA TENTATIVA? NÃO. Ela é a MESMA
        // nas três: é isso que faz um handler de escrita reconhecer que a
        // segunda tentativa é a mesma operação, e não um pedido novo. Uma chave
        // por tentativa abriria três chamados para uma pessoa que pediu um.
        idempotencyKey: entrada.idempotencyKey,
      });
    } catch (erro) {
      // ⚠️ UMA EXCEÇÃO NÃO É `retry`. Ela não diz nada sobre ser temporária, e
      // tratá-la como temporária faria o motor insistir três vezes num defeito
      // de programação — atrasando a resposta ao associado para chegar ao mesmo
      // lugar. O handler que sabe que vale insistir devolve `retry`.
      const mensagem = erro instanceof Error ? erro.message : String(erro);

      logFlowEngineEvent("error", "flow.action", {
        correlationId: entrada.correlationId,
        runId: entrada.runId,
        nodeId: entrada.nodeId,
        actionKey: entrada.actionKey,
        actionStatus: "failure",
        attempt: tentativa,
        reason: "excecao",
      });

      return {
        status: "failure",
        variables: {},
        error: mensagem,
        attempts: tentativa,
        durationMs: Date.now() - comeco,
      };
    }

    const status = traduzir(saida);

    if (status !== "retry") {
      logFlowEngineEvent("info", "flow.action", {
        correlationId: entrada.correlationId,
        runId: entrada.runId,
        nodeId: entrada.nodeId,
        actionKey: entrada.actionKey,
        actionStatus: status,
        attempt: tentativa,
        maxAttempts: teto,
        durationMs: Date.now() - comeco,
      });

      return {
        status,
        // ⚠️ O FRACASSO TAMBÉM PODE TRAZER CONTEXTO — ver o campo `variables`
        // do ramo `ok: false` em `FlowActionOutput`. É o que deixa o desenho
        // distinguir "não há eventos" de "não reconheci este telefone", que
        // caem os dois em `not_found`. O `<chave>_status` não muda por isso.
        variables: saida.ok ? saida.variables : (saida.variables ?? {}),
        error: saida.ok ? null : `A ação respondeu ${status}.`,
        attempts: tentativa,
        durationMs: Date.now() - comeco,
      };
    }

    ultimoErro = "A ação pediu nova tentativa.";

    // O intervalo com jitter é o mesmo do envio de mensagens
    // (`backoffDelayMs`) — reusado de propósito: duas curvas de espera
    // diferentes no mesmo sistema seriam duas coisas para ajustar quando o
    // fornecedor mudar de humor. Só espera se ainda houver tentativa depois.
    if (tentativa < teto) {
      await esperar(backoffDelayMs(tentativa));
    }
  }

  logFlowEngineEvent("error", "flow.action", {
    correlationId: entrada.correlationId,
    runId: entrada.runId,
    nodeId: entrada.nodeId,
    actionKey: entrada.actionKey,
    actionStatus: "failure",
    attempt: teto,
    maxAttempts: teto,
    reason: "tentativas esgotadas",
    durationMs: Date.now() - comeco,
  });

  return {
    status: "failure",
    variables: {},
    error: ultimoErro,
    attempts: teto,
    durationMs: Date.now() - comeco,
  };
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
