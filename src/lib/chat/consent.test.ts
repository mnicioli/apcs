import { describe, expect, it } from "vitest";
import { classifyConsentReply } from "./consent";

/**
 * O consentimento LGPD é o único ponto da conversa com efeito jurídico, e por
 * isso é decidido aqui — sem LLM. Um falso positivo libera a coleta de dados
 * que a pessoa recusou, então a regra é: na dúvida, "unclear".
 */
describe("classifyConsentReply", () => {
  it("o clique no botão decide por igualdade, sem interpretar texto", () => {
    expect(classifyConsentReply({ message: "qualquer coisa", optionValue: "accept" })).toBe(
      "accept",
    );
    expect(classifyConsentReply({ message: "qualquer coisa", optionValue: "decline" })).toBe(
      "decline",
    );
  });

  it("reconhece aceite em texto livre", () => {
    for (const message of ["sim", "Sim, autorizo", "aceito", "ok", "claro!", "pode sim", "s"]) {
      expect(classifyConsentReply({ message })).toBe("accept");
    }
  });

  it("reconhece recusa em texto livre", () => {
    for (const message of ["não", "nao", "Não autorizo", "NÃO, obrigado", "recuso", "n"]) {
      expect(classifyConsentReply({ message })).toBe("decline");
    }
  });

  it("recusa vence quando a frase contém as duas palavras", () => {
    // "não autorizo" contém "autorizo" — a ordem de teste importa.
    expect(classifyConsentReply({ message: "não autorizo" })).toBe("decline");
    expect(classifyConsentReply({ message: "nao, nao autorizo isso" })).toBe("decline");
  });

  it("na dúvida não decide", () => {
    for (const message of ["quanto custa a ração?", "oi", "", "   ", "talvez"]) {
      expect(classifyConsentReply({ message })).toBe("unclear");
    }
  });

  it("ignora optionValue desconhecido e cai no texto", () => {
    expect(classifyConsentReply({ message: "sim", optionValue: "producer" })).toBe("accept");
    expect(classifyConsentReply({ message: "oi", optionValue: "producer" })).toBe("unclear");
  });
});
