import {
  actionArguments,
  actionKey,
  actionMaxAttempts,
  isEnabled,
  mediaField,
  nodeText,
  questionOptions,
  textField,
  numberField,
} from "./flow.node-config";
import { resolveTransition } from "./flow.transitions";
import type {
  CompiledFlowNode,
  FlowDefinition,
  FlowEffect,
  FlowEngineFailure,
  FlowEngineState,
  FlowNodeType,
} from "./flow.types";

/**
 * O REGISTRO DE EXECUTORES DE NÓ — o §6 do Prompt 3.
 *
 * ⚠️ O QUE ELE SUBSTITUIU, E POR QUE ISSO IMPORTA.
 *
 * Antes havia um `switch (node.type)` de seis braços dentro da travessia. Ele
 * não estava espalhado e não estava errado — o escopo pede outra coisa: que
 * acrescentar um tipo de nó não signifique EDITAR O MOTOR. Com o `switch`, um
 * nó de "aguardar" ou de "sortear" seria um braço novo no meio do laço que
 * também cuida do teto de saltos, do acúmulo de efeitos e da falha — ou seja,
 * mexer no código mais delicado do módulo para acrescentar algo que não tem
 * nada a ver com ele.
 *
 * Com a tabela, um tipo novo é UM objeto aqui e UM valor em `FLOW_NODE_TYPES`.
 * O motor não muda.
 *
 * ⚠️ E O EXECUTOR NÃO É UM "HANDLER QUE FAZ": ele não envia, não grava e não
 * chama serviço. Ele lê a configuração do nó, EMITE efeitos e diz para onde ir.
 * Quem faz é a camada de execução (`src/lib/flow/`). A separação é o que mantém
 * o motor testável sem banco e igual no simulador e na produção.
 */

/* -------------------------------------------------------------------------- */
/* O contrato                                                                 */
/* -------------------------------------------------------------------------- */

export interface NodeExecutorContext {
  definition: FlowDefinition;
  node: CompiledFlowNode;
  state: FlowEngineState;
  /**
   * A escolha que a pessoa acabou de fazer, quando o nó está sendo executado
   * logo depois de uma resposta. `null` no resto do tempo — ver
   * `transitionMatches`.
   */
  answerKey: string | null;
}

/**
 * O que um executor devolve.
 *
 * Os três desfechos são os únicos que existem, e cada um tem um significado
 * operacional distinto:
 *
 *   `continue`  o motor segue andando — a travessia não parou
 *   `halt`      alguém de fora precisa agir antes de continuar (responder,
 *               executar a ação, assumir a conversa) ou o fluxo acabou
 *   `fail`      o desenho está quebrado em execução
 */
export type NodeExecutorOutcome =
  | { kind: "continue"; state: FlowEngineState; nextNodeId: string; effects: FlowEffect[] }
  | { kind: "halt"; state: FlowEngineState; effects: FlowEffect[] }
  | { kind: "fail"; state: FlowEngineState; effects: FlowEffect[]; reason: FlowEngineFailure };

export interface NodeExecutor {
  type: FlowNodeType;
  /** Como o nó aparece na trilha e nos logs. PT-BR, curto. */
  label: string;
  execute(ctx: NodeExecutorContext): NodeExecutorOutcome;
}

/* -------------------------------------------------------------------------- */
/* Os atalhos comuns                                                          */
/* -------------------------------------------------------------------------- */

/**
 * "Emiti estes efeitos; agora siga a seta."
 *
 * ⚠️ TODO EXECUTOR QUE AVANÇA PASSA POR AQUI, e é o que garante que os seis
 * façam a MESMA pergunta ao resolvedor de transições. Um executor que
 * consultasse a lista por conta própria poderia ordenar diferente — e o mesmo
 * desenho escolheria caminhos diferentes dependendo do tipo do nó de origem.
 */
function seguir(
  ctx: NodeExecutorContext,
  state: FlowEngineState,
  effects: FlowEffect[],
): NodeExecutorOutcome {
  const saida = resolveTransition(ctx.definition, ctx.node.id, state.variables, ctx.answerKey);

  if (!saida) {
    return {
      kind: "fail",
      state,
      effects: [
        ...effects,
        { kind: "fail", nodeId: ctx.node.id, reason: "no_matching_transition" },
      ],
      reason: "no_matching_transition",
    };
  }

  return { kind: "continue", state, nextNodeId: saida.targetNodeId, effects };
}

/* -------------------------------------------------------------------------- */
/* Os seis                                                                    */
/* -------------------------------------------------------------------------- */

const messageExecutor: NodeExecutor = {
  type: "message",
  label: "Mensagem",
  execute(ctx) {
    const efeitos: FlowEffect[] = [];

    // ⚠️ O NÓ DESLIGADO É ATRAVESSADO, NÃO IGNORADO. Ele não emite mensagem e o
    // fluxo segue pela saída dele — que é o que permite calar um aviso
    // temporário sem desmontar o desenho em volta. Ver `enabled` no schema.
    if (isEnabled(ctx.node)) {
      efeitos.push({
        kind: "sendMessage",
        nodeId: ctx.node.id,
        text: nodeText(ctx.node, ctx.state.variables),
        delaySeconds: numberField(ctx.node, "delaySeconds") ?? 0,
        // §19 do Prompt 4. INTERPOLADOS, e não lidos crus: é o que permite ao
        // desenhador escrever `{{bolsa_imagem_url}}` e receber o arquivo da
        // versão ATIVA em vez de um endereço fixo que vence. Ver `mediaField`.
        imageUrl: mediaField(ctx.node, "imageUrl", ctx.state.variables),
        pdfUrl: mediaField(ctx.node, "pdfUrl", ctx.state.variables),
        trigger: "flow",
      });
    }

    return seguir(ctx, ctx.state, efeitos);
  },
};

const questionExecutor: NodeExecutor = {
  type: "question",
  label: "Pergunta",
  execute(ctx) {
    // §8 do Prompt 3: PERGUNTA E PARA. Não avança antes da resposta, e o estado
    // que grava isso é `waiting_reply` — é ele que a próxima mensagem consulta
    // para saber que o que chegou é uma resposta, e não uma pergunta nova.
    return {
      kind: "halt",
      state: {
        ...ctx.state,
        status: "waiting_reply",
        conversationStatus: "waiting_reply",
        // ⚠️ ZERA AQUI, E NÃO NA RESPOSTA. Chegar a uma pergunta é sempre o
        // começo de uma contagem nova — inclusive quando se chega a ela pela
        // segunda vez, vindo de um "voltar ao menu". Ver `attemptCount`.
        attemptCount: 0,
      },
      effects: [
        {
          kind: "askQuestion",
          nodeId: ctx.node.id,
          text: nodeText(ctx.node, ctx.state.variables),
          options: questionOptions(ctx.node),
        },
      ],
    };
  },
};

const conditionExecutor: NodeExecutor = {
  type: "condition",
  label: "Condição",
  execute(ctx) {
    // ⚠️ O NÓ DE CONDIÇÃO NÃO AVALIA NADA SOZINHO. Quem carrega a comparação é a
    // TRANSIÇÃO (`{type:"variable", name, operator, value}`) — o nó só marca o
    // ponto do desenho em que a bifurcação acontece. Assim acrescentar um
    // terceiro caminho é acrescentar uma seta, não editar o nó. É também o que
    // dá o `if / else if / else` do §13 de graça: ver `resolveTransition`.
    return seguir(ctx, ctx.state, []);
  },
};

const actionExecutor: NodeExecutor = {
  type: "action",
  label: "Ação",
  execute(ctx) {
    // Para e espera o handler. A retomada é `advanceFlow(…, {kind:
    // "actionResult"})` — ver `flow.engine.ts`.
    return {
      kind: "halt",
      state: { ...ctx.state, status: "running" },
      effects: [
        {
          kind: "runAction",
          nodeId: ctx.node.id,
          actionKey: actionKey(ctx.node),
          arguments: actionArguments(ctx.node, ctx.state.variables),
          maxAttempts: actionMaxAttempts(ctx.node),
        },
      ],
    };
  },
};

const attendantExecutor: NodeExecutor = {
  type: "attendant",
  label: "Transferência",
  execute(ctx) {
    const teamKey = textField(ctx.node, "teamKey") ?? "";

    return {
      kind: "halt",
      state: {
        ...ctx.state,
        status: "handed_off",
        // §13 do Prompt 1. As duas dimensões andam juntas AQUI e só aqui: o
        // motor sai de cena e uma pessoa entra. Em qualquer outro ponto elas
        // são independentes.
        conversationStatus: "in_service",
        assignedTeamKey: teamKey,
      },
      effects: [
        {
          kind: "assignTeam",
          nodeId: ctx.node.id,
          teamKey,
          message: textField(ctx.node, "message"),
          // O compromisso de prazo e a posição na fila (Prompt 2, §12).
          slaMinutes: numberField(ctx.node, "slaMinutes"),
          priority: textField(ctx.node, "priority") ?? "normal",
          trigger: "flow",
        },
      ],
    };
  },
};

const endExecutor: NodeExecutor = {
  type: "end",
  label: "Encerramento",
  execute(ctx) {
    // §20 do Prompt 3: encerra e NÃO executa nada depois. O `halt` é o que
    // garante isso — a travessia não pergunta por transição nenhuma daqui.
    return {
      kind: "halt",
      state: { ...ctx.state, status: "completed", conversationStatus: "resolved" },
      effects: [
        {
          kind: "complete",
          nodeId: ctx.node.id,
          message: textField(ctx.node, "message"),
          trigger: "flow",
        },
      ],
    };
  },
};

/* -------------------------------------------------------------------------- */
/* A tabela                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ `Record` COMPLETO. Quando alguém acrescentar um valor em
 * `FLOW_NODE_TYPES`, o TypeScript aponta ESTA linha — e não um caminho que só
 * quebraria em produção, no meio de uma conversa, quando o motor chegasse a um
 * nó do tipo novo e não soubesse o que fazer com ele.
 */
export const NODE_EXECUTORS: Record<FlowNodeType, NodeExecutor> = {
  message: messageExecutor,
  question: questionExecutor,
  condition: conditionExecutor,
  action: actionExecutor,
  attendant: attendantExecutor,
  end: endExecutor,
};

export function nodeExecutor(type: FlowNodeType): NodeExecutor {
  return NODE_EXECUTORS[type];
}

/** O rótulo PT-BR de um tipo de nó. A trilha e os logs usam. */
export function nodeTypeLabel(type: FlowNodeType): string {
  return NODE_EXECUTORS[type].label;
}
