import { describe, expect, it } from "vitest";
import { cspLeadDataSchema, parseStoredCollected, parseTurnAnalysis } from "./chat.schema";

/**
 * Estes testes cobrem a barreira entre o LLM e o banco. Um dado que passa aqui
 * vai parar numa tabela e depois na tela do time comercial — por isso a
 * validação é rígida e o comportamento em caso de erro precisa ser previsível.
 */

describe("parseTurnAnalysis", () => {
  it("aceita uma extração bem formada", () => {
    const result = parseTurnAnalysis({
      intent: "answering",
      slots: { fullName: "João da Silva", city: "Piracicaba", state: "sp" },
    });

    expect(result).toEqual({
      intent: "answering",
      slots: { fullName: "João da Silva", city: "Piracicaba", state: "SP" },
    });
  });

  it("descarta o campo inválido e mantém o resto do turno", () => {
    const result = parseTurnAnalysis({
      intent: "answering",
      slots: { fullName: "Maria", state: "XX", interest: "feed" },
    });

    expect(result?.intent).toBe("answering");
    expect(result?.slots).toEqual({ fullName: "Maria", interest: "feed" });
    expect(result?.slots.state).toBeUndefined();
  });

  it("ignora campos que não existem na triagem", () => {
    const result = parseTurnAnalysis({
      intent: "answering",
      // `wantsHuman` é estado controlado pelo motor — o LLM não pode marcá-lo.
      slots: { fullName: "Ana", wantsHuman: true, cpf: "123" },
    });

    expect(result?.slots).toEqual({ fullName: "Ana" });
  });

  it("normaliza telefone para só dígitos", () => {
    const result = parseTurnAnalysis({
      intent: "answering",
      slots: { phone: "(19) 99999-1234" },
    });

    expect(result?.slots.phone).toBe("19999991234");
  });

  it("recusa telefone curto demais", () => {
    const result = parseTurnAnalysis({ intent: "answering", slots: { phone: "1234" } });
    expect(result?.slots.phone).toBeUndefined();
  });

  it("perde o turno quando nem a intenção é válida", () => {
    expect(parseTurnAnalysis({ intent: "conversar", slots: {} })).toBeNull();
    expect(parseTurnAnalysis(null)).toBeNull();
    expect(parseTurnAnalysis("texto solto")).toBeNull();
  });
});

describe("parseStoredCollected", () => {
  it("lê o estado de conversa que o motor grava", () => {
    expect(parseStoredCollected({ fullName: "Ana", wantsHuman: true })).toEqual({
      fullName: "Ana",
      wantsHuman: true,
    });
  });

  it("aceita objeto vazio ou ausente (conversa recém-aberta)", () => {
    expect(parseStoredCollected({})).toEqual({});
    expect(parseStoredCollected(null)).toEqual({});
    expect(parseStoredCollected("lixo")).toEqual({});
  });

  it("um campo corrompido não apaga a triagem inteira", () => {
    // Sem isso o bot recomeçaria do "qual o seu nome?" por causa de um campo.
    expect(parseStoredCollected({ fullName: "Ana", state: "XX", interest: "feed" })).toEqual({
      fullName: "Ana",
      interest: "feed",
    });
  });

  it("não deixa chave de protótipo derrubar a validação", () => {
    // `"constructor" in shape` é true por herança — o filtro usa Object.hasOwn.
    expect(() =>
      parseStoredCollected(JSON.parse('{"constructor":1,"__proto__":{"x":1},"fullName":"Ana"}')),
    ).not.toThrow();
    expect(parseStoredCollected(JSON.parse('{"constructor":1,"fullName":"Ana"}'))).toEqual({
      fullName: "Ana",
    });
  });
});

describe("cspLeadDataSchema", () => {
  const complete = {
    fullName: "João da Silva",
    city: "Piracicaba",
    state: "SP",
    contactProfile: "producer",
    interest: "feed",
    volumeRange: "from_200_to_1000",
    preferredChannel: "whatsapp",
    preferredTime: "morning",
    phone: "19999991234",
  };

  it("aceita uma triagem completa", () => {
    expect(cspLeadDataSchema.safeParse(complete).success).toBe(true);
  });

  it("recusa triagem sem campo obrigatório", () => {
    const { interest: _interest, ...incomplete } = complete;
    expect(cspLeadDataSchema.safeParse(incomplete).success).toBe(false);
  });
});
