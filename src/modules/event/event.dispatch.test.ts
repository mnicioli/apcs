import { describe, expect, it } from "vitest";
import { eventWhatsAppMessage, formatEventDateBr } from "./event.labels";

/**
 * A MENSAGEM QUE SAI NO WHATSAPP.
 *
 * É o arquivo mais barato de testar do módulo e um dos mais caros de errar:
 * este texto vai para centenas de aparelhos de uma vez, e não tem desfazer.
 */

const base = {
  name: "Workshop de Sanidade",
  location: "Sede da APCS, Campinas",
  eventDate: "2026-09-01",
  startTime: "08:00",
  endTime: "17:00",
  registrationUrl: "https://apcs.org.br/inscricao",
};

describe("formatEventDateBr", () => {
  it("converte data ISO em data brasileira", () => {
    expect(formatEventDateBr("2026-09-01")).toBe("01/09/2026");
  });

  /**
   * ⚠️ O TESTE QUE JUSTIFICA A FUNÇÃO EXISTIR.
   *
   * `new Date("2026-01-01")` é meia-noite UTC, que em São Paulo (UTC-3) é
   * 31/12/2025 às 21h. Um evento de Ano Novo seria anunciado como sendo no ano
   * anterior — e a mensagem já teria saído quando alguém percebesse.
   */
  it("não recua um dia na virada do ano (o furo do fuso)", () => {
    expect(formatEventDateBr("2026-01-01")).toBe("01/01/2026");
  });

  it("devolve a entrada quando ela não é uma data", () => {
    expect(formatEventDateBr("qualquer coisa")).toBe("qualquer coisa");
  });
});

describe("eventWhatsAppMessage", () => {
  it("traz nome, data, horário e local", () => {
    const texto = eventWhatsAppMessage(base);

    expect(texto).toContain("Workshop de Sanidade");
    expect(texto).toContain("01/09/2026");
    expect(texto).toContain("08:00 às 17:00");
    expect(texto).toContain("Sede da APCS, Campinas");
  });

  it("identifica a APCS logo na primeira linha", () => {
    // Quem recebe não tem o número salvo. Sem o remetente na primeira linha, a
    // mensagem parece spam e é denunciada — e denúncia derruba o número.
    expect(eventWhatsAppMessage(base).split("\n")[0]).toContain("APCS");
  });

  /**
   * ⚠️ A SAÍDA NÃO É OPCIONAL, e não é só conformidade legal.
   *
   * Sem uma saída escrita na mensagem, a única forma de parar de receber é
   * bloquear o número da APCS — e um número bloqueado por muita gente é um
   * número que o WhatsApp derruba. Este teste protege o canal.
   */
  it("sempre oferece a saída, com ou sem link de inscrição", () => {
    expect(eventWhatsAppMessage(base)).toContain("SAIR");
    expect(eventWhatsAppMessage({ ...base, registrationUrl: null })).toContain("SAIR");
  });

  it("omite a linha de inscrições quando não há link", () => {
    const texto = eventWhatsAppMessage({ ...base, registrationUrl: null });
    expect(texto).not.toContain("Inscrições:");
  });

  it("mostra só a hora de início quando não há hora de término", () => {
    const texto = eventWhatsAppMessage({ ...base, endTime: null });
    expect(texto).toContain("08:00");
    expect(texto).not.toContain("às 17:00");
  });

  /**
   * O link vai por último de propósito: a Z-API sempre gera prévia de link e
   * não há como desligar. Com o link no meio, a prévia empurraria data e local
   * para fora da primeira tela do aparelho.
   */
  it("põe o link depois dos dados do evento", () => {
    const texto = eventWhatsAppMessage(base);
    expect(texto.indexOf("Sede da APCS")).toBeLessThan(texto.indexOf("Inscrições:"));
  });
});
