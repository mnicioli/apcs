import { describe, expect, it } from "vitest";
import {
  advanceFlow,
  casarAlternativa,
  initialFlowState,
  type FlowEngineState,
} from "./flow.engine";
import type { CompiledFlowNode, CompiledFlowTransition, FlowDefinition } from "./flow.types";

/**
 * O MOTOR — e o que estes testes cobrem é o §25, que é uma regra arquitetural e
 * não um comportamento: a decisão do caminho é DETERMINÍSTICA e sai das
 * transições, nunca de texto.
 *
 * ⚠️ O TESTE MAIS IMPORTANTE DO ARQUIVO É "reordenar as alternativas não muda o
 * caminho". Ele é o §9 e o §10 juntos, e é a regra que um refactor apressado
 * quebra sem perceber — porque tudo continua funcionando na tela, e só o
 * atendimento vai para o lugar errado.
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
 * A triagem do escopo, em miniatura:
 *
 *     BOAS_VINDAS → PERGUNTA ┬─ EVENTOS  → TIME_EVENTOS (atendente)
 *                            └─ FILIACAO → FIM
 */
const TRIAGEM: FlowDefinition = {
  schema: 1,
  startNodeId: "n1",
  nodes: [
    no({
      id: "n1",
      type: "message",
      key: "BOAS_VINDAS",
      isStart: true,
      configuration: { text: "Olá! Aqui é a APCS." },
    }),
    no({
      id: "n2",
      type: "question",
      key: "PERGUNTA_ASSUNTO",
      configuration: {
        text: "Como podemos ajudar?",
        variable: "assunto",
        options: [
          { key: "EVENTOS", label: "Eventos e inscrições" },
          { key: "FILIACAO", label: "Filiação" },
        ],
      },
    }),
    no({
      id: "n3",
      type: "attendant",
      key: "TIME_EVENTOS",
      configuration: { teamKey: "TIME_EVENTOS" },
    }),
    no({ id: "n4", type: "end", key: "FIM", configuration: { message: "Até logo!" } }),
  ],
  transitions: [
    seta({ id: "t1", sourceNodeId: "n1", targetNodeId: "n2" }),
    seta({
      id: "t2",
      sourceNodeId: "n2",
      targetNodeId: "n3",
      condition: { type: "answer", optionKey: "EVENTOS" },
    }),
    seta({
      id: "t3",
      sourceNodeId: "n2",
      targetNodeId: "n4",
      condition: { type: "answer", optionKey: "FILIACAO" },
    }),
  ],
};

/** O estado de quem já viu a pergunta e ainda não respondeu. */
function esperandoResposta(): FlowEngineState {
  return { ...initialFlowState(), currentNodeId: "n2", status: "waiting_reply" };
}

describe("o motor de fluxos", () => {
  it("entra pelo nó inicial, envia a mensagem e para na pergunta", () => {
    const { state, effects } = advanceFlow(TRIAGEM, initialFlowState(), { kind: "start" });

    expect(effects[0]).toEqual({
      kind: "sendMessage",
      nodeId: "n1",
      text: "Olá! Aqui é a APCS.",
      delaySeconds: 0,
      imageUrl: null,
      pdfUrl: null,
    });
    expect(effects[1]).toMatchObject({ kind: "askQuestion", nodeId: "n2" });

    // Parar na pergunta é o comportamento, não uma falha: um fluxo que não para
    // não conversa.
    expect(state.status).toBe("waiting_reply");
    expect(state.currentNodeId).toBe("n2");
  });

  it("um fluxo sem nó inicial falha em vez de andar às cegas", () => {
    const { state, effects } = advanceFlow({ ...TRIAGEM, startNodeId: null }, initialFlowState(), {
      kind: "start",
    });

    expect(state.status).toBe("failed");
    expect(effects).toEqual([{ kind: "fail", nodeId: null, reason: "no_start_node" }]);
  });

  it("a resposta vira variável e leva ao caminho da chave escolhida", () => {
    const { state, effects } = advanceFlow(TRIAGEM, esperandoResposta(), {
      kind: "reply",
      text: "Eventos e inscrições",
    });

    // §15: o que a pessoa respondeu fica guardado, e é a CHAVE, não o rótulo.
    expect(state.variables).toEqual({ assunto: "EVENTOS" });
    expect(effects).toEqual([
      {
        kind: "assignTeam",
        nodeId: "n3",
        teamKey: "TIME_EVENTOS",
        message: null,
        slaMinutes: null,
        priority: "normal",
      },
    ]);
    expect(state.status).toBe("handed_off");
    expect(state.assignedTeamKey).toBe("TIME_EVENTOS");
  });

  /**
   * ⚠️ O §13 EM UMA ASSERÇÃO. As duas dimensões andam juntas SÓ na transferência
   * — o motor sai de cena e uma pessoa entra. Em qualquer outro ponto elas são
   * independentes, e é isso que o teste seguinte mostra.
   */
  it("separa a situação do motor da situação do atendimento", () => {
    const transferida = advanceFlow(TRIAGEM, esperandoResposta(), {
      kind: "reply",
      text: "EVENTOS",
    });
    expect(transferida.state.status).toBe("handed_off");
    expect(transferida.state.conversationStatus).toBe("in_service");

    const perguntando = advanceFlow(TRIAGEM, initialFlowState(), { kind: "start" });
    expect(perguntando.state.status).toBe("waiting_reply");
    expect(perguntando.state.conversationStatus).toBe("waiting_reply");
  });

  it("encerra no nó final e marca a conversa como resolvida", () => {
    const { state, effects } = advanceFlow(TRIAGEM, esperandoResposta(), {
      kind: "reply",
      text: "FILIACAO",
    });

    expect(effects).toEqual([{ kind: "complete", nodeId: "n4", message: "Até logo!" }]);
    expect(state.status).toBe("completed");
    expect(state.conversationStatus).toBe("resolved");
  });

  it("repete a pergunta escrita quando a resposta não casa — e não inventa frase", () => {
    const { state, effects } = advanceFlow(TRIAGEM, esperandoResposta(), {
      kind: "reply",
      text: "quero saber do preço do porco",
    });

    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ kind: "repeatQuestion", text: "Como podemos ajudar?" });

    // Não avançou, não gravou variável, não falhou.
    expect(state.currentNodeId).toBe("n2");
    expect(state.variables).toEqual({});
    expect(state.status).toBe("waiting_reply");
  });

  it("uma resposta que chega fora de hora não faz o fluxo andar", () => {
    const { state, effects } = advanceFlow(TRIAGEM, initialFlowState(), {
      kind: "reply",
      text: "EVENTOS",
    });

    expect(state.status).toBe("failed");
    expect(effects[0]).toMatchObject({ reason: "not_waiting_reply" });
  });

  /**
   * ⚠️ ESTE É O TESTE QUE GUARDA O §9 E O §10.
   *
   * As alternativas são reordenadas — "Filiação" passa a ser a número 1 — e o
   * caminho de quem responde "Eventos" tem de continuar sendo o mesmo. Se
   * alguém trocar a comparação por índice, tudo continua compilando, a tela
   * continua igual, e este teste é a única coisa que percebe.
   */
  it("reordenar as alternativas não muda para onde cada chave leva", () => {
    const reordenada: FlowDefinition = {
      ...TRIAGEM,
      nodes: TRIAGEM.nodes.map((node) =>
        node.id === "n2"
          ? {
              ...node,
              configuration: {
                ...node.configuration,
                options: [
                  { key: "FILIACAO", label: "Filiação" },
                  { key: "EVENTOS", label: "Eventos e inscrições" },
                ],
              },
            }
          : node,
      ),
    };

    const { state } = advanceFlow(reordenada, esperandoResposta(), {
      kind: "reply",
      text: "Eventos e inscrições",
    });

    expect(state.variables).toEqual({ assunto: "EVENTOS" });
    expect(state.assignedTeamKey).toBe("TIME_EVENTOS");
  });

  it("segue a transição de menor prioridade quando duas condições casam", () => {
    const ambiguo: FlowDefinition = {
      ...TRIAGEM,
      transitions: [
        seta({ id: "t1", sourceNodeId: "n1", targetNodeId: "n4", priority: 10 }),
        seta({ id: "t0", sourceNodeId: "n1", targetNodeId: "n2", priority: 1 }),
      ],
    };

    const { state } = advanceFlow(ambiguo, initialFlowState(), { kind: "start" });

    // A de prioridade 1 ganha. Sem ordem estável, execuções idênticas
    // produziriam caminhos diferentes — e o defeito seria irreproduzível.
    expect(state.currentNodeId).toBe("n2");
  });

  it("um nó sem saída que casa falha em vez de parar em silêncio", () => {
    const semSaida: FlowDefinition = {
      ...TRIAGEM,
      transitions: [seta({ id: "t1", sourceNodeId: "n1", targetNodeId: "n2" })],
    };

    const { state, effects } = advanceFlow(semSaida, esperandoResposta(), {
      kind: "reply",
      text: "EVENTOS",
    });

    expect(state.status).toBe("failed");
    expect(effects[0]).toMatchObject({ reason: "no_matching_transition" });
  });

  /**
   * ⚠️ O CICLO É LEGÍTIMO ("voltar ao menu"), E POR ISSO O TETO EXISTE. Sem ele,
   * este desenho seria um laço infinito dentro de um webhook: um processo
   * travado e uma pessoa sem resposta.
   */
  it("corta um desenho que circula sem nunca parar", () => {
    const circular: FlowDefinition = {
      schema: 1,
      startNodeId: "a",
      nodes: [
        no({ id: "a", type: "message", isStart: true, configuration: { text: "a" } }),
        no({ id: "b", type: "message", configuration: { text: "b" } }),
      ],
      transitions: [
        seta({ id: "t1", sourceNodeId: "a", targetNodeId: "b" }),
        seta({ id: "t2", sourceNodeId: "b", targetNodeId: "a" }),
      ],
    };

    const { state, effects } = advanceFlow(circular, initialFlowState(), { kind: "start" });

    expect(state.status).toBe("failed");
    expect(effects.at(-1)).toMatchObject({ reason: "hop_limit" });
  });

  describe("nó de ação", () => {
    const COM_ACAO: FlowDefinition = {
      schema: 1,
      startNodeId: "a1",
      nodes: [
        no({
          id: "a1",
          type: "action",
          key: "CONSULTA",
          isStart: true,
          configuration: {
            actionKey: "consultar_normativa",
            arguments: { assunto: "tema" },
          },
        }),
        no({ id: "a2", type: "end", key: "FIM", configuration: {} }),
      ],
      transitions: [seta({ id: "t1", sourceNodeId: "a1", targetNodeId: "a2" })],
    };

    it("para e pede a execução, resolvendo os parâmetros a partir das variáveis", () => {
      const estado = { ...initialFlowState(), variables: { tema: "transporte" } };
      const { state, effects } = advanceFlow(COM_ACAO, estado, { kind: "start" });

      expect(effects).toEqual([
        {
          kind: "runAction",
          nodeId: "a1",
          actionKey: "consultar_normativa",
          arguments: { assunto: "transporte" },
        },
      ]);
      // Continua "running": quem para o relógio é o handler, não o motor.
      expect(state.status).toBe("running");
      expect(state.currentNodeId).toBe("a1");
    });

    /**
     * ⚠️ O FRACASSO TAMBÉM VIRA VARIÁVEL, e é isso que permite ao desenho ter um
     * caminho para "não encontrei". Sem essa variável, a única saída seria um
     * erro genérico, e a pessoa leria "ocorreu um erro" em vez de "não achei
     * normativa sobre esse assunto".
     */
    it("grava o desfecho da ação no contexto, inclusive quando ela não achou nada", () => {
      const parado = { ...initialFlowState(), currentNodeId: "a1" };

      const sucesso = advanceFlow(COM_ACAO, parado, {
        kind: "actionResult",
        ok: true,
        variables: { normativa_url: "https://exemplo" },
      });
      expect(sucesso.state.variables).toEqual({
        normativa_url: "https://exemplo",
        consultar_normativa_ok: "true",
      });

      const vazio = advanceFlow(COM_ACAO, parado, {
        kind: "actionResult",
        ok: false,
        variables: {},
      });
      expect(vazio.state.variables).toEqual({ consultar_normativa_ok: "false" });
      expect(vazio.state.status).toBe("completed");
    });
  });

  describe("condição por variável", () => {
    const COM_CONDICAO: FlowDefinition = {
      schema: 1,
      startNodeId: "c1",
      nodes: [
        no({ id: "c1", type: "condition", key: "E_ASSOCIADO", isStart: true }),
        no({ id: "c2", type: "end", key: "FIM_SIM", configuration: { message: "bem-vindo" } }),
        no({ id: "c3", type: "end", key: "FIM_NAO", configuration: { message: "cadastre-se" } }),
      ],
      transitions: [
        seta({
          id: "t1",
          sourceNodeId: "c1",
          targetNodeId: "c2",
          priority: 0,
          condition: { type: "variable", name: "associado", operator: "eq", value: "true" },
        }),
        // A saída "sempre" fica por último: é o padrão, e um padrão que ganhasse
        // da regra específica tornaria a bifurcação decorativa.
        seta({ id: "t2", sourceNodeId: "c1", targetNodeId: "c3", priority: 99 }),
      ],
    };

    it("escolhe o ramo cuja variável casa", () => {
      const { effects } = advanceFlow(
        COM_CONDICAO,
        { ...initialFlowState(), variables: { associado: "true" } },
        { kind: "start" },
      );
      expect(effects).toEqual([{ kind: "complete", nodeId: "c2", message: "bem-vindo" }]);
    });

    it("cai no padrão quando nenhuma variável casa", () => {
      const { effects } = advanceFlow(COM_CONDICAO, initialFlowState(), { kind: "start" });
      expect(effects).toEqual([{ kind: "complete", nodeId: "c3", message: "cadastre-se" }]);
    });
  });
});

describe("a leitura da resposta", () => {
  const OPCOES = [
    { key: "EVENTOS", label: "Eventos e inscrições" },
    { key: "FILIACAO", label: "Filiação" },
  ];

  it("aceita a chave, o rótulo e a posição — nesta ordem", () => {
    expect(casarAlternativa("EVENTOS", OPCOES)?.key).toBe("EVENTOS");
    expect(casarAlternativa("eventos e inscricoes", OPCOES)?.key).toBe("EVENTOS");
    expect(casarAlternativa("2", OPCOES)?.key).toBe("FILIACAO");
  });

  it("ignora acento e caixa no rótulo", () => {
    expect(casarAlternativa("  FILIAÇÃO  ", OPCOES)?.key).toBe("FILIACAO");
  });

  it("recusa um número fora da lista", () => {
    expect(casarAlternativa("7", OPCOES)).toBeNull();
    expect(casarAlternativa("0", OPCOES)).toBeNull();
  });

  /**
   * "2 eventos" é uma frase, não uma escolha de posição. Tratá-la como "2"
   * mandaria a pessoa para Filiação — um caminho que ela não pediu.
   */
  it("não lê um número dentro de uma frase como escolha", () => {
    expect(casarAlternativa("2 eventos por favor", OPCOES)).toBeNull();
  });

  it("recusa texto vazio e lista vazia", () => {
    expect(casarAlternativa("   ", OPCOES)).toBeNull();
    expect(casarAlternativa("EVENTOS", [])).toBeNull();
  });
});
