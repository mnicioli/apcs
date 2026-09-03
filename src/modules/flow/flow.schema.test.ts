import { describe, expect, it } from "vitest";
import {
  attendanceTeamFormSchema,
  flowDefinitionSchema,
  flowNodeFormSchema,
  flowTransitionConditionSchema,
} from "./flow.schema";

/**
 * A validação de entrada — a primeira camada, não a única.
 *
 * ⚠️ O QUE ESTES TESTES GUARDAM É A DIFERENÇA ENTRE "ERRO AGORA" E "ERRO NA
 * PUBLICAÇÃO". Um nó ATTENDANT sem time e um QUESTION sem alternativas passam
 * pelo banco (a coluna `configuration` é jsonb livre, de propósito) e só caem em
 * `validate_flow_version()`, no fim — quando o desenho já tem quarenta nós e a
 * pessoa precisa caçar os três buracos.
 *
 * A união discriminada é o que cobra na hora de salvar cada nó.
 */

const NO_BASE = { key: "PERGUNTA_ASSUNTO", name: "Assunto", position: { x: 0, y: 0 } };

describe("a chave estável (§10)", () => {
  it("aceita MAIÚSCULAS com sublinhado", () => {
    const resultado = flowNodeFormSchema.safeParse({
      ...NO_BASE,
      key: "PERGUNTA_ASSUNTO_2",
      type: "message",
      configuration: { text: "olá" },
    });
    expect(resultado.success).toBe(true);
  });

  /**
   * ⚠️ MINÚSCULA É RECUSADA DE PROPÓSITO. A chave viaja para dentro do jsonb
   * congelado, onde ela precisa ser distinguível do RÓTULO numa leitura rápida
   * — `EVENTOS` é regra, "Eventos e inscrições" é texto de tela.
   */
  it.each(["eventos", "Eventos", "EV", "EVENTOS-2", "1EVENTOS", "EVENTOS COM ESPACO"])(
    "recusa %s",
    (chave) => {
      const resultado = flowNodeFormSchema.safeParse({
        ...NO_BASE,
        key: chave,
        type: "message",
        configuration: { text: "olá" },
      });
      expect(resultado.success).toBe(false);
    },
  );
});

describe("a configuração por tipo de nó (§8, §19)", () => {
  it("recusa um nó de mensagem sem texto", () => {
    const resultado = flowNodeFormSchema.safeParse({
      ...NO_BASE,
      type: "message",
      configuration: {},
    });
    expect(resultado.success).toBe(false);
  });

  it("recusa uma pergunta com menos de duas alternativas", () => {
    const resultado = flowNodeFormSchema.safeParse({
      ...NO_BASE,
      type: "question",
      configuration: {
        text: "Como podemos ajudar?",
        variable: "assunto",
        options: [{ key: "EVENTOS", label: "Eventos" }],
      },
    });
    expect(resultado.success).toBe(false);
  });

  /**
   * ⚠️ O DEFEITO SILENCIOSO DESTE MÓDULO. Duas alternativas com a chave
   * `EVENTOS` fazem a transição casar sempre com a primeira, e a segunda vira um
   * caminho que nunca executa. Nada quebra; o fluxo só atende errado.
   */
  it("recusa duas alternativas com a mesma chave", () => {
    const resultado = flowNodeFormSchema.safeParse({
      ...NO_BASE,
      type: "question",
      configuration: {
        text: "Como podemos ajudar?",
        variable: "assunto",
        options: [
          { key: "EVENTOS", label: "Eventos" },
          { key: "EVENTOS", label: "Eventos e inscrições" },
        ],
      },
    });

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues[0]?.path).toEqual(["configuration", "options", 1, "key"]);
    }
  });

  it("aceita rótulos repetidos — o que não pode repetir é a chave", () => {
    const resultado = flowNodeFormSchema.safeParse({
      ...NO_BASE,
      type: "question",
      configuration: {
        text: "Como podemos ajudar?",
        variable: "assunto",
        options: [
          { key: "EVENTOS", label: "Outros" },
          { key: "FILIACAO", label: "Outros" },
        ],
      },
    });
    expect(resultado.success).toBe(true);
  });

  it("exige a variável onde a resposta será guardada (§15)", () => {
    const resultado = flowNodeFormSchema.safeParse({
      ...NO_BASE,
      type: "question",
      configuration: {
        text: "Como podemos ajudar?",
        options: [
          { key: "EVENTOS", label: "Eventos" },
          { key: "FILIACAO", label: "Filiação" },
        ],
      },
    });
    expect(resultado.success).toBe(false);
  });

  it("recusa transferência sem time (§11)", () => {
    const resultado = flowNodeFormSchema.safeParse({
      ...NO_BASE,
      type: "attendant",
      configuration: {},
    });
    expect(resultado.success).toBe(false);
  });

  it("recusa uma ação que não existe no registro (§26)", () => {
    const resultado = flowNodeFormSchema.safeParse({
      ...NO_BASE,
      type: "action",
      configuration: { actionKey: "consultar_o_que_nao_existe" },
    });
    expect(resultado.success).toBe(false);
  });

  it("aceita uma ação do registro", () => {
    const resultado = flowNodeFormSchema.safeParse({
      ...NO_BASE,
      type: "action",
      configuration: { actionKey: "consultar_bolsa" },
    });
    expect(resultado.success).toBe(true);
  });

  /**
   * ⚠️ O NÓ FINAL NÃO PRECISA DE NADA, e isso é intencional: obrigar uma
   * mensagem de despedida faria todo fluxo terminar com um texto que ninguém
   * quis escrever. A migration tem o mesmo entendimento — não há CHECK sobre a
   * configuração de um nó `end`.
   */
  it("aceita um nó final sem configuração", () => {
    const resultado = flowNodeFormSchema.safeParse({
      ...NO_BASE,
      key: "FIM",
      type: "end",
      configuration: {},
    });
    expect(resultado.success).toBe(true);
  });
});

describe("a condição de uma transição (§9)", () => {
  it("aceita as três formas conhecidas", () => {
    expect(flowTransitionConditionSchema.safeParse({ type: "always" }).success).toBe(true);
    expect(
      flowTransitionConditionSchema.safeParse({ type: "answer", optionKey: "EVENTOS" }).success,
    ).toBe(true);
    expect(
      flowTransitionConditionSchema.safeParse({
        type: "variable",
        name: "assunto",
        equals: "EVENTOS",
      }).success,
    ).toBe(true);
  });

  /**
   * ⚠️ ESTE É O §9 EM UMA ASSERÇÃO. Não existe forma de escrever uma condição
   * por POSIÇÃO — nem `{option: 1}`, nem uma chave numérica. Reordenar as
   * alternativas na tela tem de continuar sendo inofensivo.
   */
  it("não existe condição por número de opção", () => {
    expect(flowTransitionConditionSchema.safeParse({ type: "answer", option: 1 }).success).toBe(
      false,
    );
    expect(flowTransitionConditionSchema.safeParse({ type: "option", index: 1 }).success).toBe(
      false,
    );
    expect(
      flowTransitionConditionSchema.safeParse({ type: "answer", optionKey: "1" }).success,
    ).toBe(false);
  });
});

describe("o retrato congelado lido de volta (§22, §24)", () => {
  const RETRATO = {
    schema: 1,
    startNodeId: "11111111-1111-4111-8111-111111111111",
    nodes: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        key: "BOAS_VINDAS",
        type: "message",
        name: "Boas-vindas",
        isStart: true,
        configuration: { text: "olá" },
        position: { x: 0, y: 0 },
        metadata: {},
      },
    ],
    transitions: [],
  };

  it("aceita o documento que o banco monta", () => {
    expect(flowDefinitionSchema.safeParse(RETRATO).success).toBe(true);
  });

  /**
   * ⚠️ UM RETRATO DE FORMATO DESCONHECIDO PRECISA FALHAR ALTO. Ele foi escrito
   * por uma versão anterior do sistema e nunca é reescrito (§22) — sem este
   * parse, o motor receberia campos ausentes como `undefined` e decidiria o
   * caminho de um atendimento a partir de um buraco.
   */
  it("recusa um documento de outro esquema", () => {
    expect(flowDefinitionSchema.safeParse({ ...RETRATO, schema: 2 }).success).toBe(false);
  });

  /**
   * O oposto: um campo NOVO num retrato antigo não é erro. É o futuro sendo
   * tolerante com o passado, que é a direção certa quando o dado é imutável.
   */
  it("tolera um campo que ainda não conhece", () => {
    const comExtra = {
      ...RETRATO,
      nodes: [{ ...RETRATO.nodes[0], campoDoFuturo: "algo" }],
    };
    expect(flowDefinitionSchema.safeParse(comExtra).success).toBe(true);
  });

  it("recusa um retrato sem a lista de nós", () => {
    expect(flowDefinitionSchema.safeParse({ schema: 1, startNodeId: null }).success).toBe(false);
  });
});

describe("o time de atendimento", () => {
  it("exige chave no formato TIME_ALGO", () => {
    const bom = attendanceTeamFormSchema.safeParse({
      key: "TIME_MARKETING",
      name: "Marketing",
      description: "",
      status: "active",
    });
    expect(bom.success).toBe(true);

    const ruim = attendanceTeamFormSchema.safeParse({
      key: "time marketing",
      name: "Marketing",
      description: "",
      status: "active",
    });
    expect(ruim.success).toBe(false);
  });
});
