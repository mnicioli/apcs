import { describe, expect, it } from "vitest";
import { normalizeReply, readSurveyReply, repeatOptionsMessage } from "./survey.inbound";
import type { SurveyOption } from "./survey.types";

/**
 * §10 a §13, §32, §39. COMO SE LÊ O QUE A PESSOA ESCREVEU.
 *
 * ⚠️ A distinção mais importante deste arquivo é entre ERROU A RESPOSTA e NÃO
 * ESTAVA RESPONDENDO. Colapsar as duas produziria o pior atendimento possível:
 * quem manda "bom dia" recebe "escolha uma das opções apresentadas", e três
 * bons-dias depois é expulso da enquete por excesso de erro.
 */

function opcao(position: number, text: string, active = true): SurveyOption {
  return { id: `op-${position}`, position, text, active };
}

const CINCO = [
  opcao(1, "Aumentar muito"),
  opcao(2, "Aumentar"),
  opcao(3, "Manter"),
  opcao(4, "Reduzir"),
  opcao(5, "Reduzir muito"),
];

describe("normalizeReply", () => {
  it("tira acento, caixa e pontuação", () => {
    expect(normalizeReply("  OPÇÃO 1!  ")).toBe("opcao 1");
    expect(normalizeReply("Não")).toBe("nao");
  });

  it("⚠️ o teclado numérico do WhatsApp vira dígito", () => {
    // O WhatsApp entrega "1" do teclado como 1 + U+FE0F + U+20E3. Para um
    // regex de dígito isso NÃO é um dígito — e a pessoa que clicou exatamente
    // no número que o bot mandou receberia "opção inválida".
    expect(normalizeReply("1️⃣")).toBe("1");
    expect(normalizeReply("3️⃣")).toBe("3");
  });
});

describe("§10. O número", () => {
  it("aceita o número puro", () => {
    expect(readSurveyReply("3", CINCO)).toEqual({
      kind: "option",
      position: 3,
      matchedBy: "number",
    });
  });

  it("aceita com espaços em volta", () => {
    expect(readSurveyReply("  1  ", CINCO)).toMatchObject({ kind: "option", position: 1 });
  });

  it("aceita o emoji do teclado", () => {
    expect(readSurveyReply("5️⃣", CINCO)).toMatchObject({ kind: "option", position: 5 });
  });

  it("aceita os prefixos que o §10 cita e os que aparecem na prática", () => {
    for (const texto of [
      "opção 2",
      "opcao 2",
      "Opção 2",
      "alternativa 2",
      "resposta 2",
      "item 2",
      "numero 2",
      "n 2",
      "n. 2",
      "2.",
      "2)",
      "2 -",
    ]) {
      expect(readSurveyReply(texto, CINCO), texto).toMatchObject({ kind: "option", position: 2 });
    }
  });

  it("⚠️ número fora da faixa é ERRO DE RESPOSTA, não conversa alheia (§11)", () => {
    // Quem digita "7" numa enquete de 5 está claramente tentando escolher.
    expect(readSurveyReply("7", CINCO)).toEqual({ kind: "invalid" });
    expect(readSurveyReply("0", CINCO)).toEqual({ kind: "invalid" });
    expect(readSurveyReply("opção 9", CINCO)).toEqual({ kind: "invalid" });
  });

  it("alternativa inativa não pode ser escolhida", () => {
    const comInativa = [...CINCO.slice(0, 4), opcao(5, "Reduzir muito", false)];
    expect(readSurveyReply("5", comInativa)).toEqual({ kind: "invalid" });
  });
});

describe("§13. O texto da alternativa", () => {
  it("texto exato escolhe", () => {
    expect(readSurveyReply("Manter", CINCO)).toEqual({
      kind: "option",
      position: 3,
      matchedBy: "text",
    });
  });

  it("sem acento e em caixa qualquer também escolhe", () => {
    expect(readSurveyReply("REDUZIR MUITO", CINCO)).toMatchObject({ kind: "option", position: 5 });
  });

  it('⚠️ "Aumentar" escolhe "Aumentar", e não empata com "Aumentar muito"', () => {
    // O exato ganha do parcial. Sem esta ordem, a resposta mais natural que
    // existe ("Aumentar") viraria ambiguidade e a pessoa teria de responder de
    // novo sem entender por quê.
    expect(readSurveyReply("Aumentar", CINCO)).toEqual({
      kind: "option",
      position: 2,
      matchedBy: "text",
    });
  });

  it("parcial inequívoco escolhe", () => {
    // "Manter" é a única que começa assim.
    expect(readSurveyReply("manter o preço", CINCO)).toMatchObject({
      kind: "option",
      position: 3,
    });
  });

  it('⚠️ "Reduzir mu" é AMBÍGUO, e é certo que seja', () => {
    // Ela casa por prefixo com "Reduzir" E com "Reduzir muito". A tentação é
    // preferir a mais longa; o §13 diz o contrário, e com razão: um voto errado
    // registrado como certo não deixa sintoma, porque a urna não guarda o texto
    // que a pessoa mandou.
    const r = readSurveyReply("Reduzir mu", CINCO);
    expect(r.kind).toBe("ambiguous_text");
    expect(r.kind === "ambiguous_text" && r.positions.sort()).toEqual([4, 5]);
  });

  it("⚠️ parcial AMBÍGUO NÃO escolhe (§13)", () => {
    // Duas alternativas plausíveis e um palpite errado é um voto errado
    // registrado como certo — e ninguém descobre, porque a urna não guarda o
    // texto que a pessoa mandou.
    const r = readSurveyReply("Aument", CINCO);
    expect(r.kind).toBe("ambiguous_text");
    expect(r.kind === "ambiguous_text" && r.positions.sort()).toEqual([1, 2]);
  });

  it("alternativas idênticas viram ambiguidade, não sorteio", () => {
    const repetidas = [opcao(1, "Sim"), opcao(2, "Sim")];
    expect(readSurveyReply("Sim", repetidas).kind).toBe("ambiguous_text");
  });
});

describe("§39. O que NÃO é resposta de enquete", () => {
  it("⚠️ conversa comum não conta como erro", () => {
    for (const texto of [
      "bom dia",
      "preciso de ajuda com a filiação",
      "obrigado",
      "quando sai o boletim?",
    ]) {
      expect(readSurveyReply(texto, CINCO), texto).toEqual({ kind: "unrelated" });
    }
  });

  it("mensagem vazia é ignorada", () => {
    expect(readSurveyReply("", CINCO)).toEqual({ kind: "unrelated" });
    expect(readSurveyReply("   ", CINCO)).toEqual({ kind: "unrelated" });
    expect(readSurveyReply("😀", CINCO)).toEqual({ kind: "unrelated" });
  });
});

describe("§32. Sair da lista", () => {
  it("reconhece os pedidos de saída", () => {
    for (const texto of ["SAIR", "sair", "parar", "STOP", "descadastrar", "não quero receber"]) {
      expect(readSurveyReply(texto, CINCO), texto).toEqual({ kind: "opt_out" });
    }
  });

  it('"cancelar" pede saída, mas "cancelar minha inscrição no evento" não', () => {
    // A lista é de correspondência EXATA: uma frase que contém a palavra é
    // conversa, e tirar alguém da lista por engano é pior que não tirar.
    expect(readSurveyReply("cancelar", CINCO)).toEqual({ kind: "opt_out" });
    expect(readSurveyReply("quero cancelar minha inscrição no evento", CINCO)).toEqual({
      kind: "unrelated",
    });
  });
});

describe("§39. Falar com gente", () => {
  it("reconhece o pedido de atendimento humano", () => {
    for (const texto of ["atendente", "humano", "quero falar com alguém", "suporte"]) {
      expect(readSurveyReply(texto, CINCO), texto).toEqual({ kind: "wants_human" });
    }
  });
});

describe("repeatOptionsMessage (§11)", () => {
  it("repete a lista junto com o pedido", () => {
    // "Escolha uma das opções apresentadas" sem as opções manda a pessoa
    // procurar uma mensagem que pode ter subido dezenas de linhas no histórico.
    const texto = repeatOptionsMessage("Não identificamos uma opção válida.", CINCO);
    expect(texto).toContain("1 - Aumentar muito");
    expect(texto).toContain("5 - Reduzir muito");
  });

  it("usa a posição, não o índice do array", () => {
    // É `position` que o banco guarda e que `register_survey_response` valida.
    const texto = repeatOptionsMessage("Escolha:", [opcao(2, "Aumentar"), opcao(4, "Reduzir")]);
    expect(texto).toContain("2 - Aumentar");
    expect(texto).toContain("4 - Reduzir");
    expect(texto).not.toContain("1 - Aumentar");
  });
});
