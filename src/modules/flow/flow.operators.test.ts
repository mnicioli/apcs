import { describe, expect, it } from "vitest";
import {
  CONDITION_OPERATORS,
  CONDITION_OPERATOR_REGISTRY,
  evaluateCondition,
  isConditionOperator,
  operatorNeedsValue,
} from "./flow.operators";

/**
 * OS DOZE OPERADORES (§14 do Prompt 3).
 *
 * ⚠️ O QUE ESTES TESTES DE FATO GUARDAM não é "eq compara igualdade" — é o
 * comportamento diante do que NÃO É um caso feliz: a variável ausente, o texto
 * onde se esperava número, o operador que este build não conhece. São esses três
 * que decidem o rumo de um atendimento por acidente quando estão errados, e
 * nenhum deles aparece quando se testa só o caminho normal.
 */

describe("o registro de operadores", () => {
  it("toda chave da lista tem definição, e vice-versa", () => {
    // O `Record` completo já obriga isto no type-check. O teste guarda o
    // inverso — uma definição órfã, cuja chave saiu da lista e que continuaria
    // sendo exportada sem nunca ser oferecida a ninguém.
    expect(Object.keys(CONDITION_OPERATOR_REGISTRY).sort()).toEqual(
      [...CONDITION_OPERATORS].sort(),
    );
  });

  it("cada operador tem um rótulo em português que completa a frase", () => {
    for (const chave of CONDITION_OPERATORS) {
      const { label } = CONDITION_OPERATOR_REGISTRY[chave];
      // "assunto <label> EVENTOS" precisa se ler como frase. Um rótulo em
      // branco, ou com a chave crua, apareceria na seta do canvas.
      expect(label.trim(), chave).not.toBe("");
      expect(label, chave).not.toContain("_");
    }
  });

  it("só os quatro que perguntam sobre a variável dispensam o valor", () => {
    const semValor = CONDITION_OPERATORS.filter((k) => !operatorNeedsValue(k));
    expect([...semValor].sort()).toEqual(["exists", "is_false", "is_true", "not_exists"]);
  });
});

describe("igualdade e texto", () => {
  it("eq e neq comparam o valor exato", () => {
    expect(evaluateCondition("EVENTOS", "eq", "EVENTOS")).toBe(true);
    expect(evaluateCondition("EVENTOS", "eq", "BOLSA")).toBe(false);
    expect(evaluateCondition("EVENTOS", "neq", "BOLSA")).toBe(true);
  });

  it("contains e not_contains ignoram acento e caixa", () => {
    // Quem escreve "filiacao" no WhatsApp está falando de "Filiação", e o fluxo
    // não pode discordar disso.
    expect(evaluateCondition("Quero saber de Filiação", "contains", "filiacao")).toBe(true);
    expect(evaluateCondition("Quero saber de Filiação", "not_contains", "bolsa")).toBe(true);
    expect(evaluateCondition("Quero saber de Filiação", "not_contains", "FILIACAO")).toBe(false);
  });
});

describe("números", () => {
  /**
   * ⚠️ O TESTE QUE JUSTIFICA A RECUSA DO TEXTO. Em ordem alfabética, "10" é
   * MENOR que "9" — um fluxo que mandasse pedidos acima de 9 unidades para
   * outro time atenderia errado sem nunca falhar.
   */
  it("gt e lt comparam como número, não como texto", () => {
    expect(evaluateCondition("10", "gt", "9")).toBe(true);
    expect(evaluateCondition("10", "lt", "9")).toBe(false);
  });

  it("gte e lte incluem o limite", () => {
    expect(evaluateCondition("18", "gte", "18")).toBe(true);
    expect(evaluateCondition("18", "gt", "18")).toBe(false);
    expect(evaluateCondition("60", "lte", "60")).toBe(true);
  });

  it("aceita a vírgula decimal, que é como se escreve no WhatsApp", () => {
    expect(evaluateCondition("12,5", "gt", "12")).toBe(true);
  });

  /**
   * ⚠️ NÃO CASAR É A RESPOSTA CERTA. A tentação é comparar como texto "para dar
   * alguma resposta" — e essa resposta estaria errada de um jeito plausível,
   * que é o pior tipo de erro. Sem casar, o desenho segue para a saída padrão,
   * que é previsível e visível no canvas.
   */
  it("um texto onde se esperava número não casa em nenhuma direção", () => {
    for (const operador of ["gt", "gte", "lt", "lte"]) {
      expect(evaluateCondition("abc", operador, "10"), operador).toBe(false);
    }
  });
});

describe("a variável ausente", () => {
  /**
   * ⚠️ O CASO MAIS IMPORTANTE DESTE ARQUIVO. É tentador dizer que "não definido
   * é diferente de EVENTOS" — mas isso faria uma pergunta que a pessoa AINDA
   * NÃO RESPONDEU escolher um caminho. Adivinhação com cara de regra.
   */
  it("nunca casa em comparação nenhuma, nem em neq", () => {
    for (const operador of CONDITION_OPERATORS) {
      if (operador === "not_exists") continue;
      expect(evaluateCondition(undefined, operador, "EVENTOS"), operador).toBe(false);
    }
  });

  it("quem pergunta sobre a ausência é not_exists, e ele casa", () => {
    expect(evaluateCondition(undefined, "not_exists", "")).toBe(true);
    expect(evaluateCondition("EVENTOS", "not_exists", "")).toBe(false);
  });

  /** Vazio não é presente: a resposta em branco não "foi respondida". */
  it("string vazia conta como ausente para exists", () => {
    expect(evaluateCondition("", "exists", "")).toBe(false);
    expect(evaluateCondition("   ", "exists", "")).toBe(false);
    expect(evaluateCondition("EVENTOS", "exists", "")).toBe(true);
  });
});

describe("sim e não", () => {
  it("entende as chaves da pergunta de sim/não e o desfecho de uma ação", () => {
    // `SIM`/`NAO` vêm de `YES_NO_OPTIONS`; `true`/`false` vêm do `<acao>_ok`
    // que o motor grava. Os dois vocabulários precisam funcionar.
    expect(evaluateCondition("SIM", "is_true", "")).toBe(true);
    expect(evaluateCondition("NAO", "is_false", "")).toBe(true);
    expect(evaluateCondition("true", "is_true", "")).toBe(true);
    expect(evaluateCondition("false", "is_false", "")).toBe(true);
  });

  /**
   * ⚠️ "TALVEZ" NÃO É SIM NEM NÃO. Tratar tudo que não é "não" como "sim" faria
   * uma resposta ambígua escolher um ramo que ninguém pediu.
   */
  it("o que não é nenhum dos dois não casa com nenhum dos dois", () => {
    expect(evaluateCondition("talvez", "is_true", "")).toBe(false);
    expect(evaluateCondition("talvez", "is_false", "")).toBe(false);
  });
});

describe("um operador desconhecido", () => {
  /**
   * ⚠️ UM RETRATO CONGELADO PODE CITAR O QUE ESTE BUILD NÃO ENTENDE. Ele foi
   * escrito por outra versão do sistema e é lido para sempre. A resposta certa
   * é NÃO DECIDIR — não é chutar o caminho mais provável.
   */
  it("não escolhe caminho nenhum", () => {
    expect(isConditionOperator("regex")).toBe(false);
    expect(evaluateCondition("EVENTOS", "regex", "^EV")).toBe(false);
  });
});
