import { describe, expect, it } from "vitest";
import { advanceFlow, initialFlowState } from "./flow.engine";
import type {
  CompiledFlowNode,
  CompiledFlowTransition,
  FlowDefinition,
  FlowEffect,
  FlowEngineState,
} from "./flow.types";

/**
 * O FLUXO INTEIRO (§39 e §40 do Prompt 3), e as tentativas (§10, §11, §26).
 *
 * ⚠️ POR QUE UM SEGUNDO ARQUIVO DE TESTE DO MOTOR. `flow.engine.test.ts` prova
 * REGRAS isoladas — uma resposta inválida repete a pergunta, uma variável
 * ausente não casa. Este prova o CAMINHO: começar, perguntar, condicionar,
 * consultar, perguntar de novo e transferir, com o contexto certo no fim. São
 * duas perguntas diferentes, e a segunda é a que o §48 chama de critério de
 * aceite.
 *
 * ⚠️ E O DESENHO ABAIXO É O DO §40 — a triagem real da APCS. Ele existe aqui
 * como DADO, e é essa a prova que interessa: não há uma linha de código no motor
 * que saiba o que é "BOLSA_SUINOS" ou "IMPRENSA". Trocar este objeto por outro
 * troca o atendimento inteiro, sem tocar em `flow.engine.ts` — que é o §41.
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

/**
 * O exemplo do §40:
 *
 *   BOAS_VINDAS → MENU ┬─ BOLSA_SUINOS → CONDIÇÃO(associado) ┬ sim → AÇÃO → RESULTADO → FIM
 *                      │                                     └ não → CONVITE → FIM
 *                      └─ IMPRENSA → PERGUNTA_ASSUNTO → TRANSFERIR(TIME_MARKETING)
 */
const TRIAGEM_APCS: FlowDefinition = {
  schema: 1,
  startNodeId: "boas_vindas",
  nodes: [
    no({
      id: "boas_vindas",
      type: "message",
      key: "BOAS_VINDAS",
      isStart: true,
      configuration: { text: "Olá! Você está no canal oficial da APCS." },
    }),
    no({
      id: "menu",
      type: "question",
      key: "MENU",
      configuration: {
        text: "Como podemos ajudar?",
        kind: "buttons",
        variable: "assunto",
        maxAttempts: 3,
        invalidText: "Não entendi. Responda com o número da opção.",
        onExhausted: "transfer",
        fallbackTeamKey: "TIME_ATENDIMENTO",
        exhaustedText: "Vou te encaminhar para uma pessoa.",
        options: [
          { key: "EVENTOS", label: "Eventos" },
          { key: "BOLSA_SUINOS", label: "Bolsa de Suínos" },
          { key: "IMPRENSA", label: "Imprensa" },
        ],
      },
    }),

    /* --- o ramo da Bolsa: condição, ação e resultado --- */
    no({ id: "eh_associado", type: "condition", key: "EH_ASSOCIADO", configuration: {} }),
    no({
      id: "consulta",
      type: "action",
      key: "CONSULTA_BOLSA",
      configuration: { actionKey: "consultar_bolsa", arguments: {}, maxAttempts: 2 },
    }),
    no({
      id: "resultado",
      type: "message",
      key: "RESULTADO",
      configuration: { text: "A cotação de hoje é {{cotacao}}." },
    }),
    no({
      id: "convite",
      type: "message",
      key: "CONVITE",
      configuration: { text: "A cotação completa é exclusiva para associados." },
    }),

    /* --- o ramo da Imprensa: segunda pergunta e transferência --- */
    no({
      id: "sub_assunto",
      type: "question",
      key: "SUB_ASSUNTO",
      configuration: {
        text: "Qual assunto você deseja tratar?",
        kind: "buttons",
        variable: "sub_assunto",
        options: [
          { key: "MARKETING", label: "Marketing" },
          { key: "FINANCEIRO", label: "Financeiro" },
        ],
      },
    }),
    no({
      id: "time_marketing",
      type: "attendant",
      key: "TIME_MARKETING",
      configuration: { teamKey: "TIME_MARKETING", slaMinutes: 120, priority: "high" },
    }),

    no({ id: "fim", type: "end", key: "FIM", configuration: { message: "Até logo!" } }),
  ],

  transitions: [
    seta({ id: "t0", sourceNodeId: "boas_vindas", targetNodeId: "menu" }),

    seta({
      id: "t1",
      sourceNodeId: "menu",
      targetNodeId: "eh_associado",
      condition: { type: "answer", optionKey: "BOLSA_SUINOS" },
    }),
    seta({
      id: "t2",
      sourceNodeId: "menu",
      targetNodeId: "sub_assunto",
      condition: { type: "answer", optionKey: "IMPRENSA" },
    }),
    seta({
      id: "t3",
      sourceNodeId: "menu",
      targetNodeId: "fim",
      condition: { type: "answer", optionKey: "EVENTOS" },
    }),

    // ⚠️ O `IF / ELSE` DO §13, E ELE SÃO DUAS SETAS COM PRIORIDADE. A primeira
    // pergunta; a segunda, `always`, é o `else`. Não existe estrutura aninhada
    // em lugar nenhum — quem lê o canvas vê os dois caminhos.
    seta({
      id: "t4",
      sourceNodeId: "eh_associado",
      targetNodeId: "consulta",
      priority: 0,
      condition: { type: "variable", name: "tipo_cliente", operator: "eq", value: "ASSOCIADO" },
    }),
    seta({ id: "t5", sourceNodeId: "eh_associado", targetNodeId: "convite", priority: 1 }),

    // §16. O desfecho da ação escolhe o caminho: achou → resultado; não achou →
    // o mesmo convite genérico, que é melhor do que "ocorreu um erro".
    seta({
      id: "t6",
      sourceNodeId: "consulta",
      targetNodeId: "resultado",
      priority: 0,
      condition: {
        type: "variable",
        name: "consultar_bolsa_status",
        operator: "eq",
        value: "success",
      },
    }),
    seta({ id: "t7", sourceNodeId: "consulta", targetNodeId: "convite", priority: 1 }),

    seta({ id: "t8", sourceNodeId: "resultado", targetNodeId: "fim" }),
    seta({ id: "t9", sourceNodeId: "convite", targetNodeId: "fim" }),

    seta({
      id: "t10",
      sourceNodeId: "sub_assunto",
      targetNodeId: "time_marketing",
      condition: { type: "answer", optionKey: "MARKETING" },
    }),
    seta({
      id: "t11",
      sourceNodeId: "sub_assunto",
      targetNodeId: "time_marketing",
      condition: { type: "answer", optionKey: "FINANCEIRO" },
    }),
  ],
};

/** Os tipos dos efeitos, na ordem — é assim que se lê uma passada do motor. */
function tipos(effects: readonly FlowEffect[]): string[] {
  return effects.map((e) => e.kind);
}

/* ========================================================================== */
/* §39 — o caminho inteiro                                                    */
/* ========================================================================== */

describe("o fluxo completo do §39", () => {
  /**
   * START → MESSAGE → QUESTION → CONDITION → ACTION → MESSAGE → END,
   * com o contexto conferido em cada parada.
   */
  it("percorre começo, mensagem, pergunta, condição, ação e encerramento", () => {
    /* --- 1. começar: entra pelo nó inicial e para na pergunta --- */
    const abertura = advanceFlow(TRIAGEM_APCS, initialFlowState(), { kind: "start" });

    expect(tipos(abertura.effects)).toEqual(["sendMessage", "askQuestion"]);
    expect(abertura.state.status).toBe("waiting_reply");
    expect(abertura.state.currentNodeId).toBe("menu");

    /* --- 2. responder: a resposta vira variável ANTES da transição --- */
    // O contexto chega com `tipo_cliente` já preenchido: quem o preencheu foi a
    // camada que reconheceu o telefone, e não uma pergunta do fluxo. É por isso
    // que a condição consegue decidir sem perguntar nada.
    const comAssociado: FlowEngineState = {
      ...abertura.state,
      variables: { ...abertura.state.variables, tipo_cliente: "ASSOCIADO" },
    };

    const escolheuBolsa = advanceFlow(TRIAGEM_APCS, comAssociado, {
      kind: "reply",
      text: "2",
    });

    // ⚠️ A PESSOA DIGITOU "2" E A VARIÁVEL GRAVADA É `BOLSA_SUINOS`. O número
    // morreu na tradução; nada além dela soube que existiu. É o §41.
    expect(escolheuBolsa.state.variables.assunto).toBe("BOLSA_SUINOS");

    // Atravessou a condição sozinho e parou na ação, esperando o handler.
    expect(tipos(escolheuBolsa.effects)).toEqual(["runAction"]);
    expect(escolheuBolsa.state.currentNodeId).toBe("consulta");

    const pedido = escolheuBolsa.effects[0];
    expect(pedido).toMatchObject({
      kind: "runAction",
      actionKey: "consultar_bolsa",
      maxAttempts: 2,
    });

    /* --- 3. a ação respondeu: o resultado escolhe o caminho --- */
    const depoisDaAcao = advanceFlow(TRIAGEM_APCS, escolheuBolsa.state, {
      kind: "actionResult",
      status: "success",
      variables: { cotacao: "R$ 8,40/kg" },
    });

    expect(tipos(depoisDaAcao.effects)).toEqual(["sendMessage", "complete"]);

    // §32. A interpolação usou o que a AÇÃO devolveu, e não o que a pessoa
    // digitou — a mensagem que sai é a escrita no nó, com o buraco preenchido.
    const mensagem = depoisDaAcao.effects[0];
    expect(mensagem).toMatchObject({
      kind: "sendMessage",
      text: "A cotação de hoje é R$ 8,40/kg.",
    });

    /* --- 4. o fim --- */
    expect(depoisDaAcao.state.status).toBe("completed");
    expect(depoisDaAcao.state.conversationStatus).toBe("resolved");

    // §19. Todo o contexto coletado continua no estado — é ele que o atendente
    // recebe sem precisar refazer a triagem.
    expect(depoisDaAcao.state.variables).toMatchObject({
      tipo_cliente: "ASSOCIADO",
      assunto: "BOLSA_SUINOS",
      cotacao: "R$ 8,40/kg",
      consultar_bolsa_status: "success",
    });
  });

  /**
   * O outro ramo do §40, e o que ele prova é o §17: duas perguntas seguidas e
   * uma transferência, com SLA e prioridade indo junto.
   */
  it("percorre o ramo da imprensa até a transferência, com contexto", () => {
    const abertura = advanceFlow(TRIAGEM_APCS, initialFlowState(), { kind: "start" });

    const escolheuImprensa = advanceFlow(TRIAGEM_APCS, abertura.state, {
      kind: "reply",
      text: "Imprensa",
    });

    // §8. Parou na segunda pergunta e NÃO avançou além dela.
    expect(tipos(escolheuImprensa.effects)).toEqual(["askQuestion"]);
    expect(escolheuImprensa.state.status).toBe("waiting_reply");

    const transferida = advanceFlow(TRIAGEM_APCS, escolheuImprensa.state, {
      kind: "reply",
      text: "MARKETING",
    });

    expect(transferida.effects[0]).toMatchObject({
      kind: "assignTeam",
      teamKey: "TIME_MARKETING",
      slaMinutes: 120,
      priority: "high",
      trigger: "flow",
    });

    // §17. O motor sai de cena e uma pessoa entra — as duas dimensões do estado
    // andam juntas AQUI e só aqui.
    expect(transferida.state.status).toBe("handed_off");
    expect(transferida.state.conversationStatus).toBe("in_service");
    expect(transferida.state.assignedTeamKey).toBe("TIME_MARKETING");

    // §19. O atendente recebe o assunto E o subassunto: ele não precisa
    // perguntar de novo o que a pessoa já respondeu duas vezes.
    expect(transferida.state.variables).toEqual({
      assunto: "IMPRENSA",
      sub_assunto: "MARKETING",
    });
  });

  /**
   * ⚠️ O TESTE DO §33 EM UMA ASSERÇÃO. A mesma resposta, no mesmo estado, no
   * mesmo desenho, produz o mesmo caminho — sempre. É o que "determinístico"
   * significa na prática, e o que permite reproduzir um atendimento estranho
   * meses depois a partir do retrato congelado.
   */
  it("a mesma entrada produz sempre o mesmo caminho", () => {
    const partida = advanceFlow(TRIAGEM_APCS, initialFlowState(), { kind: "start" }).state;

    const primeira = advanceFlow(TRIAGEM_APCS, partida, { kind: "reply", text: "IMPRENSA" });
    const segunda = advanceFlow(TRIAGEM_APCS, partida, { kind: "reply", text: "IMPRENSA" });

    expect(primeira.state).toEqual(segunda.state);
    expect(primeira.effects).toEqual(segunda.effects);
  });
});

/* ========================================================================== */
/* §10, §11 e §26 — as tentativas e o desfecho                                */
/* ========================================================================== */

describe("as tentativas de uma pergunta", () => {
  const noMenu: FlowEngineState = {
    ...initialFlowState(),
    currentNodeId: "menu",
    status: "waiting_reply",
  };

  it("usa o aviso configurado, e não a pergunta, quando a resposta não serve", () => {
    const { effects, state } = advanceFlow(TRIAGEM_APCS, noMenu, {
      kind: "reply",
      text: "quero falar com alguém",
    });

    expect(effects[0]).toMatchObject({
      kind: "repeatQuestion",
      text: "Não entendi. Responda com o número da opção.",
      attempt: 1,
      maxAttempts: 3,
    });

    // Não avançou, não gravou variável, e o contador subiu.
    expect(state.currentNodeId).toBe("menu");
    expect(state.status).toBe("waiting_reply");
    expect(state.attemptCount).toBe(1);
  });

  /**
   * ⚠️ ESTE É O TESTE QUE JUSTIFICA O PROMPT 3 TER MEXIDO AQUI. Antes dele, a
   * pergunta se repetia PARA SEMPRE: quem não entendesse o menu ficava
   * recebendo a mesma frase indefinidamente, e nenhuma pessoa da APCS ficava
   * sabendo. "Não consegui responder" precisa acabar em alguém.
   */
  it("na terceira tentativa desiste e transfere para o time configurado", () => {
    const segunda = { ...noMenu, attemptCount: 2 };

    const { effects, state } = advanceFlow(TRIAGEM_APCS, segunda, {
      kind: "reply",
      text: "???",
    });

    expect(effects[0]).toMatchObject({
      kind: "assignTeam",
      teamKey: "TIME_ATENDIMENTO",
      message: "Vou te encaminhar para uma pessoa.",
      // ⚠️ É ISTO QUE SEPARA, NA TRILHA, A TRANSFERÊNCIA DESENHADA DA
      // TRANSFERÊNCIA POR DESISTÊNCIA. Sem o campo, as duas seriam a mesma
      // linha, e "por que tanta gente cai neste time" não teria resposta.
      trigger: "fallback",
    });

    expect(state.status).toBe("handed_off");
    expect(state.assignedTeamKey).toBe("TIME_ATENDIMENTO");
  });

  /** Acertar zera a contagem: a pergunta seguinte começa com as três inteiras. */
  it("uma resposta válida depois de erros zera o contador", () => {
    const errou = { ...noMenu, attemptCount: 2 };

    const { state } = advanceFlow(TRIAGEM_APCS, errou, { kind: "reply", text: "IMPRENSA" });

    expect(state.attemptCount).toBe(0);
    expect(state.currentNodeId).toBe("sub_assunto");
  });

  /**
   * §11 com o outro desfecho. Um nó sem `onExhausted` configurado encerra — que
   * é o único desfecho que não depende de configuração nenhuma. Transferir sem
   * time escolhido mandaria a pessoa para lugar nenhum.
   */
  it("sem desfecho configurado, encerra em vez de transferir", () => {
    const semTime: FlowDefinition = {
      ...TRIAGEM_APCS,
      nodes: TRIAGEM_APCS.nodes.map((n) =>
        n.id === "sub_assunto"
          ? { ...n, configuration: { ...n.configuration, maxAttempts: 1 } }
          : n,
      ),
    };

    const { effects, state } = advanceFlow(
      semTime,
      { ...initialFlowState(), currentNodeId: "sub_assunto", status: "waiting_reply" },
      { kind: "reply", text: "nada disso" },
    );

    expect(effects[0]).toMatchObject({ kind: "complete", trigger: "fallback" });
    expect(state.status).toBe("completed");
  });
});

/* ========================================================================== */
/* §12 e §13 — a condição e o else                                            */
/* ========================================================================== */

describe("a condição", () => {
  it("o ELSE é a seta de prioridade maior, com condição sempre", () => {
    // Sem `tipo_cliente` no contexto, a primeira seta não casa — e a segunda,
    // `always`, é o `else`. É o §13 sem uma estrutura aninhada em lugar nenhum.
    const semTipo = advanceFlow(
      TRIAGEM_APCS,
      { ...initialFlowState(), currentNodeId: "menu", status: "waiting_reply" },
      { kind: "reply", text: "BOLSA_SUINOS" },
    );

    expect(tipos(semTipo.effects)).toEqual(["sendMessage", "complete"]);
    expect(semTipo.effects[0]).toMatchObject({
      text: "A cotação completa é exclusiva para associados.",
    });
  });
});
