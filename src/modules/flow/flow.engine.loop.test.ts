import { describe, expect, it } from "vitest";
import { advanceFlow, initialFlowState } from "./flow.engine";
import type {
  CompiledFlowNode,
  CompiledFlowTransition,
  FlowDefinition,
  FlowEngineState,
} from "./flow.types";

/**
 * §9 E §10 DO PROMPT 5 — o laço, e os DOIS tetos que fazem falta.
 *
 * ============================================================================
 * ⚠️ POR QUE UM ARQUIVO SÓ PARA ISTO
 * ============================================================================
 *
 * Porque a distinção entre os dois tetos é fácil de perder numa refatoração, e
 * perdê-la reabre um defeito que não dá erro em lugar nenhum:
 *
 *   `LIMITE_DE_SALTOS` (20)             o laço FECHADO. MENU → CONDIÇÃO → MENU
 *                                       sem parar. Trava o webhook em segundos.
 *                                       Aparece na primeira conversa.
 *
 *   `LIMITE_DE_NOS_POR_CONVERSA` (200)  o laço LENTO. PERGUNTA A → PERGUNTA B →
 *                                       PERGUNTA A, uma mensagem por turno.
 *                                       Cada turno é VÁLIDO e gasta 2 saltos —
 *                                       o primeiro teto nunca dispara. A pessoa
 *                                       recebe as mesmas perguntas até desistir.
 *
 * Alguém que "simplifique" os dois num só reintroduz o segundo caso. Estes
 * testes existem para que essa simplificação falhe aqui, e não em produção.
 */

function no(
  parcial: Partial<CompiledFlowNode> & Pick<CompiledFlowNode, "id" | "type">,
): CompiledFlowNode {
  return {
    key: parcial.id.toUpperCase(),
    name: parcial.id,
    isStart: false,
    configuration: {},
    position: { x: 0, y: 0 },
    metadata: {},
    ...parcial,
  };
}

function seta(
  parcial: Partial<CompiledFlowTransition> &
    Pick<CompiledFlowTransition, "id" | "sourceNodeId" | "targetNodeId">,
): CompiledFlowTransition {
  return { condition: { type: "always" }, label: null, priority: 0, ...parcial };
}

/* -------------------------------------------------------------------------- */
/* O laço FECHADO — o que o teto de saltos já pegava                          */
/* -------------------------------------------------------------------------- */

/** MENSAGEM → CONDIÇÃO → MENSAGEM, sem nenhuma pergunta que faça o motor parar. */
const LACO_FECHADO: FlowDefinition = {
  schema: 1,
  startNodeId: "a",
  nodes: [
    no({ id: "a", type: "message", isStart: true, configuration: { text: "oi" } }),
    no({ id: "b", type: "condition", configuration: {} }),
  ],
  transitions: [
    seta({ id: "t1", sourceNodeId: "a", targetNodeId: "b" }),
    seta({ id: "t2", sourceNodeId: "b", targetNodeId: "a" }),
  ],
};

describe("§9 — o laço fechado trava o turno, e o motor recusa", () => {
  it("para com hop_limit em vez de girar para sempre", () => {
    const resultado = advanceFlow(LACO_FECHADO, initialFlowState(), { kind: "start" });

    const falha = resultado.effects.find((e) => e.kind === "fail");
    expect(falha?.kind === "fail" && falha.reason).toBe("hop_limit");
    expect(resultado.state.status).toBe("failed");
  });

  /**
   * ⚠️ ELE ANDOU ATÉ O TETO, e o número importa: é ele que o banco soma. Um
   * turno que gira vinte nós precisa CONTAR vinte, senão a trava da conversa
   * (§10) nunca vê o que o laço fechado consumiu.
   */
  it("conta os nós que atravessou antes de desistir", () => {
    const resultado = advanceFlow(LACO_FECHADO, initialFlowState(), { kind: "start" });
    expect(resultado.nodesWalked).toBe(20);
  });
});

/* -------------------------------------------------------------------------- */
/* O laço LENTO — o que só a trava por conversa pega                          */
/* -------------------------------------------------------------------------- */

/**
 * PERGUNTA A → resposta → PERGUNTA B → resposta → PERGUNTA A → …
 *
 * ⚠️ ESTE DESENHO É VÁLIDO. Ele passa no validador: tem início, tem saída em
 * todo nó, não tem órfão. O problema não é estrutural — é que não existe
 * caminho para fora. Nenhuma barreira de publicação pega isso, e é por isso que
 * a barreira precisa ser de EXECUÇÃO.
 */
const LACO_LENTO: FlowDefinition = {
  schema: 1,
  startNodeId: "p1",
  nodes: [
    no({
      id: "p1",
      type: "question",
      isStart: true,
      configuration: {
        text: "Primeira?",
        kind: "buttons",
        variable: "r1",
        options: [{ key: "SIM", label: "Sim" }],
      },
    }),
    no({
      id: "p2",
      type: "question",
      configuration: {
        text: "Segunda?",
        kind: "buttons",
        variable: "r2",
        options: [{ key: "SIM", label: "Sim" }],
      },
    }),
  ],
  transitions: [
    seta({
      id: "t1",
      sourceNodeId: "p1",
      targetNodeId: "p2",
      condition: { type: "answer", optionKey: "SIM" },
    }),
    seta({
      id: "t2",
      sourceNodeId: "p2",
      targetNodeId: "p1",
      condition: { type: "answer", optionKey: "SIM" },
    }),
  ],
};

function esperando(nodeId: string, nodeExecutions: number): FlowEngineState {
  return {
    currentNodeId: nodeId,
    variables: {},
    status: "waiting_reply",
    conversationStatus: "triage",
    assignedTeamKey: null,
    attemptCount: 0,
    nodeExecutions,
  };
}

describe("§10 — o laço lento só a trava por conversa enxerga", () => {
  /**
   * ⚠️ O TESTE QUE DESCREVE O DEFEITO. Cada turno é perfeitamente saudável: um
   * salto, uma pergunta, nenhuma falha. É o acúmulo que denuncia — e o acúmulo
   * só existe porque o contador atravessa os turnos.
   */
  it("cada turno isolado parece saudável", () => {
    const resultado = advanceFlow(LACO_LENTO, esperando("p1", 0), {
      kind: "reply",
      text: "SIM",
    });

    expect(resultado.state.status).toBe("waiting_reply");
    expect(resultado.state.currentNodeId).toBe("p2");
    expect(resultado.effects.some((e) => e.kind === "fail")).toBe(false);
    // Longe dos vinte saltos: o teto do turno nunca chegaria perto.
    expect(resultado.nodesWalked).toBeLessThan(5);
  });

  it("recusa quando a conversa já atravessou o teto", () => {
    const resultado = advanceFlow(LACO_LENTO, esperando("p1", 200), {
      kind: "reply",
      text: "SIM",
    });

    const falha = resultado.effects.find((e) => e.kind === "fail");
    expect(falha?.kind === "fail" && falha.reason).toBe("loop_detected");
    expect(resultado.state.status).toBe("failed");
  });

  /**
   * ⚠️ A TRAVA VEM ANTES DE EXECUTAR O NÓ, e não depois. Parar depois faria a
   * conversa mandar mais uma mensagem repetida para alguém que já recebeu
   * duzentas — que é exatamente o sintoma que a trava existe para acabar.
   */
  it("não emite mensagem ao recusar", () => {
    const resultado = advanceFlow(LACO_LENTO, esperando("p1", 200), {
      kind: "reply",
      text: "SIM",
    });

    expect(resultado.effects.some((e) => e.kind === "askQuestion")).toBe(false);
    expect(resultado.effects.some((e) => e.kind === "sendMessage")).toBe(false);
  });

  it("deixa passar quem ainda está longe do teto", () => {
    const resultado = advanceFlow(LACO_LENTO, esperando("p1", 199), {
      kind: "reply",
      text: "SIM",
    });

    expect(resultado.state.status).toBe("waiting_reply");
    expect(resultado.effects.some((e) => e.kind === "fail")).toBe(false);
  });

  /**
   * ⚠️ `loop_detected` E `hop_limit` SÃO MOTIVOS DIFERENTES, e a tela de erros
   * do §33 depende disso: um manda procurar uma seta, o outro manda procurar um
   * caminho sem saída. Colapsá-los faria quem lê o painel investigar o lugar
   * errado.
   */
  it("não se confunde com o teto de saltos", () => {
    const lento = advanceFlow(LACO_LENTO, esperando("p1", 200), { kind: "reply", text: "SIM" });
    const fechado = advanceFlow(LACO_FECHADO, initialFlowState(), { kind: "start" });

    const a = lento.effects.find((e) => e.kind === "fail");
    const b = fechado.effects.find((e) => e.kind === "fail");

    expect(a?.kind === "fail" && a.reason).not.toBe(b?.kind === "fail" && b.reason);
  });
});

/* -------------------------------------------------------------------------- */
/* O contador é o delta, e não o total                                        */
/* -------------------------------------------------------------------------- */

describe("nodesWalked", () => {
  /**
   * ⚠️ ELE É O DELTA DO TURNO. O banco faz `node_executions + p_nodes_walked`;
   * mandar o total acumulado dobraria a conta a cada turno, e a trava do §10
   * dispararia na terceira mensagem de uma conversa normal.
   */
  it("não inclui o que a conversa já tinha andado", () => {
    const zerada = advanceFlow(LACO_LENTO, esperando("p1", 0), { kind: "reply", text: "SIM" });
    const adiantada = advanceFlow(LACO_LENTO, esperando("p1", 150), {
      kind: "reply",
      text: "SIM",
    });

    expect(adiantada.nodesWalked).toBe(zerada.nodesWalked);
  });

  it("é zero quando o turno falha sem andar", () => {
    // Parada num nó que não existe no retrato: falha antes de qualquer travessia.
    const resultado = advanceFlow(LACO_LENTO, esperando("nao_existe", 0), {
      kind: "reply",
      text: "SIM",
    });

    expect(resultado.nodesWalked).toBe(0);
  });
});
