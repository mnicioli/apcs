import { describe, expect, it } from "vitest";
import {
  NODE_PALETTE,
  alternativas,
  conditionForConnection,
  defaultNodeConfiguration,
  handleForTransition,
  nodeMatchesSearch,
  nodeOutlets,
  suggestNodeKey,
  transitionLabel,
} from "./flow.builder";
import { validateFlowGraph } from "./flow.rules";
import { flowNodeFormSchema } from "./flow.schema";
import { FLOW_NODE_TYPES, type FlowNode } from "./flow.types";

/**
 * As decisões do Builder que não dependem de React.
 *
 * ⚠️ O TESTE MAIS IMPORTANTE DESTE ARQUIVO É "cada alternativa tem o próprio
 * ponto de saída, carregando a CHAVE". Ele é o §9 feito interface: se as
 * bolinhas passarem a carregar posição em vez de chave, a tela continua igual, o
 * desenho continua igual — e reordenar as alternativas passa a mandar as pessoas
 * para o time errado.
 */

function no(parcial: Partial<FlowNode> & Pick<FlowNode, "type">): FlowNode {
  return {
    id: "n1",
    flowVersionId: "v1",
    key: "NO",
    name: "Nó",
    configuration: {},
    position: { x: 0, y: 0 },
    metadata: {},
    isStart: false,
    ...parcial,
  };
}

const PERGUNTA = no({
  type: "question",
  key: "PERGUNTA_ASSUNTO",
  configuration: {
    text: "Como podemos ajudar?",
    kind: "buttons",
    variable: "assunto",
    options: [
      { key: "EVENTOS", label: "Eventos e inscrições" },
      { key: "FILIACAO", label: "Filiação" },
    ],
  },
});

/* -------------------------------------------------------------------------- */

describe("a caixa de ferramentas", () => {
  it("oferece exatamente os seis tipos de etapa", () => {
    expect(NODE_PALETTE.map((i) => i.type)).toEqual([...FLOW_NODE_TYPES]);
  });

  it("todo item tem símbolo, rótulo e explicação", () => {
    for (const item of NODE_PALETTE) {
      expect(item.glyph, item.type).not.toBe("");
      expect(item.label, item.type).not.toBe("");
      expect(item.hint.length, item.type).toBeGreaterThan(10);
    }
  });
});

describe("um nó novo", () => {
  /**
   * ⚠️ O TESTE QUE PEGOU O DEFEITO. Arrastar uma caixinha para o canvas CRIA o
   * nó no banco na hora, com a configuração inicial — e a gravação passa pelo
   * Zod. Enquanto o texto da mensagem tinha `min(1)`, o primeiro clique do
   * desenhador era recusado com "dados inválidos" antes de a caixinha aparecer.
   *
   * A regra que ficou é a do módulo inteiro: o Zod confere a FORMA, a publicação
   * confere se está COMPLETO. Rascunho é trabalho em andamento.
   */
  it.each(FLOW_NODE_TYPES)("uma etapa de %s recém-arrastada consegue ser gravada", (tipo) => {
    const resultado = flowNodeFormSchema.safeParse({
      type: tipo,
      key: "ETAPA",
      name: "Etapa",
      position: { x: 0, y: 0 },
      isStart: false,
      configuration: defaultNodeConfiguration(tipo),
    });

    expect(
      resultado.success,
      `a configuração inicial de "${tipo}" é recusada na gravação — arrastar essa caixinha falharia`,
    ).toBe(true);
  });

  /**
   * A outra ponta: nascer gravável não é nascer publicável. O que falta
   * preencher tem de aparecer como pendência, não como erro de gravação.
   */
  it("mas ela nasce com pendência para a publicação", () => {
    const mensagem = no({
      type: "message",
      key: "MENSAGEM",
      configuration: defaultNodeConfiguration("message"),
      isStart: true,
    });
    const fim = no({ id: "n2", type: "end", key: "FIM" });

    const problemas = validateFlowGraph(
      {
        nodes: [mensagem, fim],
        transitions: [
          {
            id: "t1",
            flowVersionId: "v1",
            sourceNodeId: "n1",
            targetNodeId: "n2",
            condition: { type: "always" },
            label: null,
            priority: 0,
          },
        ],
      },
      [],
    );

    expect(problemas.map((p) => p.code)).toContain("empty_message");
  });

  it("a chave sugerida é livre e no formato do banco", () => {
    expect(suggestNodeKey("message", [])).toBe("MENSAGEM");
    expect(suggestNodeKey("message", ["MENSAGEM"])).toBe("MENSAGEM_2");
    expect(suggestNodeKey("message", ["MENSAGEM", "MENSAGEM_2"])).toBe("MENSAGEM_3");
  });

  it("toda chave sugerida passa no CHECK do banco", () => {
    for (const tipo of FLOW_NODE_TYPES) {
      expect(suggestNodeKey(tipo, []), tipo).toMatch(/^[A-Z][A-Z0-9_]{2,39}$/);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("os pontos de saída de um nó (§6, §9)", () => {
  /**
   * ⚠️ ESTE É O §9 FEITO INTERFACE. Cada alternativa vira uma bolinha, e a
   * bolinha CARREGA A CHAVE. Não existe caminho pelo qual uma seta acabe ligada
   * a uma posição, porque não existe posição em lugar nenhum deste retorno.
   */
  it("uma pergunta de botões tem uma saída por alternativa, com a chave", () => {
    const saidas = nodeOutlets(PERGUNTA);

    expect(saidas).toEqual([
      {
        id: "EVENTOS",
        label: "Eventos e inscrições",
        condition: { type: "answer", optionKey: "EVENTOS" },
      },
      { id: "FILIACAO", label: "Filiação", condition: { type: "answer", optionKey: "FILIACAO" } },
    ]);
  });

  it("reordenar as alternativas move as bolinhas e preserva as chaves", () => {
    const invertida = no({
      ...PERGUNTA,
      configuration: {
        ...PERGUNTA.configuration,
        options: [
          { key: "FILIACAO", label: "Filiação" },
          { key: "EVENTOS", label: "Eventos e inscrições" },
        ],
      },
    });

    const saidas = nodeOutlets(invertida);
    expect(saidas.map((s) => s.id)).toEqual(["FILIACAO", "EVENTOS"]);
    // A condição continua colada na chave — não na ordem.
    expect(saidas[0]?.condition).toEqual({ type: "answer", optionKey: "FILIACAO" });
  });

  it("sim/não tem duas saídas fixas que não estão no desenho", () => {
    const simNao = no({
      type: "question",
      configuration: { text: "Você já é associado?", kind: "yes_no", variable: "associado" },
    });

    expect(nodeOutlets(simNao).map((s) => s.id)).toEqual(["SIM", "NAO"]);
  });

  /**
   * Texto livre e número gravam a variável e seguem por uma saída só — é o que
   * `open_question_branches` cobra na publicação.
   */
  it.each(["free_text", "number"] as const)("a pergunta %s tem uma saída só", (kind) => {
    const aberta = no({
      type: "question",
      configuration: { text: "Qual seu nome?", kind, variable: "nome" },
    });

    expect(nodeOutlets(aberta)).toHaveLength(1);
    expect(nodeOutlets(aberta)[0]?.condition).toEqual({ type: "always" });
  });

  it("o nó de encerramento não tem saída", () => {
    expect(nodeOutlets(no({ type: "end" }))).toEqual([]);
  });

  it.each(["message", "condition", "action", "attendant"] as const)(
    "%s tem uma saída única",
    (tipo) => {
      expect(nodeOutlets(no({ type: tipo }))).toHaveLength(1);
    },
  );
});

describe("a condição de uma ligação nova", () => {
  it("sai da bolinha de onde a seta partiu", () => {
    expect(conditionForConnection(PERGUNTA, "FILIACAO")).toEqual({
      type: "answer",
      optionKey: "FILIACAO",
    });
  });

  it("é 'sempre' num nó de saída única", () => {
    expect(conditionForConnection(no({ type: "message" }), "out")).toEqual({ type: "always" });
  });

  /**
   * Acontece quando alguém apaga uma alternativa e o canvas ainda não recarregou.
   * Devolver `null` faz a ligação simplesmente não acontecer — melhor do que
   * criar uma seta apontando para uma alternativa que não existe mais.
   */
  it("devolve nulo quando a bolinha não existe mais", () => {
    expect(conditionForConnection(PERGUNTA, "APAGADA")).toBeNull();
  });

  it("uma seta existente volta para a bolinha certa", () => {
    expect(handleForTransition({ type: "answer", optionKey: "EVENTOS" })).toBe("EVENTOS");
    expect(handleForTransition({ type: "always" })).toBe("out");
    expect(handleForTransition({ type: "variable", name: "x", operator: "eq", value: "1" })).toBe(
      "out",
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("o rótulo da seta", () => {
  it("o texto escrito à mão ganha da condição", () => {
    expect(
      transitionLabel(
        { condition: { type: "answer", optionKey: "EVENTOS" }, label: "cliente quer evento" },
        [{ key: "EVENTOS", label: "Eventos" }],
      ),
    ).toBe("cliente quer evento");
  });

  it("sem texto, mostra o rótulo da alternativa", () => {
    expect(
      transitionLabel({ condition: { type: "answer", optionKey: "EVENTOS" }, label: null }, [
        { key: "EVENTOS", label: "Eventos e inscrições" },
      ]),
    ).toBe("Eventos e inscrições");
  });

  /**
   * ⚠️ A CHAVE APARECE JUSTAMENTE QUANDO A ALTERNATIVA SUMIU. É o único momento
   * em que ela é útil na tela: a seta ficou órfã, e mostrar "" faria a pessoa
   * ver uma seta sem explicação nenhuma.
   */
  it("mostra a chave quando a alternativa foi apagada", () => {
    expect(
      transitionLabel({ condition: { type: "answer", optionKey: "EVENTOS" }, label: null }, []),
    ).toBe("EVENTOS");
  });

  it("descreve a comparação em português", () => {
    expect(
      transitionLabel({
        condition: { type: "variable", name: "quantidade", operator: "gt", value: "10" },
        label: null,
      }),
    ).toBe("quantidade maior que 10");
  });

  it("a seta 'sempre' não recebe rótulo — não há o que explicar", () => {
    expect(transitionLabel({ condition: { type: "always" }, label: null })).toBe("");
  });
});

/* -------------------------------------------------------------------------- */

describe("a busca no desenho (§19)", () => {
  /**
   * ⚠️ PROCURAR DENTRO DO TEXTO É O QUE FAZ A BUSCA SERVIR. Num fluxo de cem
   * nós, ninguém lembra em qual caixinha está a frase — mas é a frase que a
   * pessoa quer achar.
   */
  it("acha pelo texto da mensagem", () => {
    const mensagem = no({
      type: "message",
      name: "Mensagem 14",
      configuration: { text: "Nosso horário de atendimento é das 8h às 18h." },
    });

    expect(nodeMatchesSearch(mensagem, "horário")).toBe(true);
    expect(nodeMatchesSearch(mensagem, "18h")).toBe(true);
  });

  it("acha pelo nome, pela chave e pela alternativa", () => {
    expect(nodeMatchesSearch(PERGUNTA, "assunto")).toBe(true);
    expect(nodeMatchesSearch(PERGUNTA, "FILIACAO")).toBe(true);
    expect(nodeMatchesSearch(PERGUNTA, "inscrições")).toBe(true);
  });

  it("ignora caixa", () => {
    expect(nodeMatchesSearch(PERGUNTA, "eventos")).toBe(true);
  });

  it("busca vazia não casa com nada — senão tudo ficaria destacado", () => {
    expect(nodeMatchesSearch(PERGUNTA, "   ")).toBe(false);
  });
});

describe("a leitura das alternativas", () => {
  it("sobrevive a uma configuração torta", () => {
    expect(alternativas({})).toEqual([]);
    expect(alternativas({ options: "nada disso" })).toEqual([]);
    expect(alternativas({ options: [null, 42, { key: "OK", label: "Ok" }] })).toEqual([
      { key: "OK", label: "Ok" },
    ]);
  });

  it("aceita alternativa sem rótulo — é o estado de quem acabou de criá-la", () => {
    expect(alternativas({ options: [{ key: "OPCAO_1" }] })).toEqual([
      { key: "OPCAO_1", label: "" },
    ]);
  });
});
