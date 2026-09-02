import { describe, expect, it } from "vitest";
import { surveyValidityLine, surveyWhatsAppMessage } from "./survey.labels";

/**
 * A MENSAGEM QUE O ASSOCIADO RECEBE — o único texto deste módulo que sai da
 * APCS e chega no celular de alguém.
 *
 * ⚠️ ELA NÃO TINHA TESTE NENHUM até 02/09/2026, e é o texto de maior alcance do
 * sistema: vai para todo o público de uma campanha de uma vez só, e não tem
 * volta depois de enviada. Um rótulo órfão ("Descrição:" sem descrição) ou uma
 * data mal montada chegam para centenas de pessoas antes de alguém perceber.
 *
 * ⚠️ O QUE SE FIXA AQUI NÃO É A REDAÇÃO, É A ESTRUTURA: o que aparece, o que
 * some quando está vazio, e a formatação do WhatsApp (`*negrito*`, `_itálico_`
 * — não markdown). Trocar uma palavra da frase não deve quebrar teste; deixar
 * de esconder um campo vazio deve.
 */

const OPCOES = [
  { position: 1, text: "Sim" },
  { position: 2, text: "Não" },
];

const COMPLETA = {
  title: "Expectativa de preço",
  description: "Sua resposta orienta a negociação da semana.",
  question: "Como você vê o preço do suíno para a próxima semana?",
  options: OPCOES,
  startsAt: "2026-09-02T15:15:00.000Z",
  endsAt: "2026-09-02T18:25:00.000Z",
};

describe("surveyWhatsAppMessage", () => {
  it("abre identificando a APCS", () => {
    // Quem recebe pode não ter o número salvo: sem esta linha, a mensagem chega
    // de um desconhecido pedindo para responder um número.
    expect(surveyWhatsAppMessage(COMPLETA).startsWith("*APCS —")).toBe(true);
  });

  it("traz título, descrição, pergunta e alternativas", () => {
    const texto = surveyWhatsAppMessage(COMPLETA);

    expect(texto).toContain("*Expectativa de preço*");
    expect(texto).toContain("Sua resposta orienta a negociação da semana.");
    expect(texto).toContain("Como você vê o preço do suíno para a próxima semana?");
    expect(texto).toContain("1️⃣ Sim");
    expect(texto).toContain("2️⃣ Não");
    expect(texto).toContain("Responda com o número da opção escolhida.");
  });

  it("numera pela `position`, e não pela ordem do array", () => {
    // É como a opção 3 vira a resposta 4: `register_survey_response` valida
    // contra `position`, então a mensagem tem de mostrar a mesma fonte.
    const texto = surveyWhatsAppMessage({
      ...COMPLETA,
      options: [
        { position: 2, text: "Segunda" },
        { position: 1, text: "Primeira" },
      ],
    });

    expect(texto).toContain("2️⃣ Segunda");
    expect(texto).toContain("1️⃣ Primeira");
  });

  it("põe o prazo em itálico do WhatsApp, no fim", () => {
    const texto = surveyWhatsAppMessage(COMPLETA);
    const ultimaLinha = texto.trimEnd().split("\n").at(-1);

    // `_` e não `*`: o WhatsApp não entende markdown, e `**` apareceria literal.
    expect(ultimaLinha?.startsWith("_")).toBe(true);
    expect(ultimaLinha?.endsWith("_")).toBe(true);
    expect(ultimaLinha).toContain("02/09/2026");
  });

  it("sem descrição, não sobra rótulo nem linha em branco dobrada", () => {
    const texto = surveyWhatsAppMessage({ ...COMPLETA, description: null });

    expect(texto).toContain("*Expectativa de preço*");
    expect(texto).not.toContain("Sua resposta orienta");
    // ⚠️ Três quebras seguidas seriam um buraco visível na conversa.
    expect(texto).not.toContain("\n\n\n");
  });

  it("sem datas, a linha de prazo simplesmente não existe", () => {
    const texto = surveyWhatsAppMessage({
      ...COMPLETA,
      startsAt: null,
      endsAt: null,
    });

    expect(texto).not.toContain("_");
    expect(texto.trimEnd().endsWith("Responda com o número da opção escolhida.")).toBe(true);
  });

  it("descrição só de espaços conta como ausente", () => {
    const texto = surveyWhatsAppMessage({ ...COMPLETA, description: "   " });
    expect(texto).not.toContain("\n\n\n");
  });
});

describe("surveyValidityLine", () => {
  /**
   * ⚠️ AS DUAS DATAS SÃO OPCIONAIS NO BANCO, então as quatro combinações
   * acontecem. Uma frase única com "—" no lugar da data que falta é o que faz
   * alguém achar que perdeu o prazo.
   */
  /**
   * ⚠️ O CASO COMUM É O MESMO DIA — uma enquete abre e fecha na mesma tarde. É
   * onde a frase fica pior se repetir a data: quatro números para dizer "hoje,
   * nesses vinte minutos".
   */
  it("no mesmo dia, não repete a data", () => {
    const linha = surveyValidityLine("2026-09-02T15:15:00.000Z", "2026-09-02T18:25:00.000Z");
    expect(linha).toBe("Você pode responder em 02/09/2026, das 12:15 às 15:25.");
  });

  it("em dias diferentes, mostra as duas datas", () => {
    const linha = surveyValidityLine("2026-09-02T15:15:00.000Z", "2026-09-05T18:25:00.000Z");
    expect(linha).toBe("Você pode responder de 02/09/2026 às 12:15 até 05/09/2026 às 15:25.");
  });

  it("só com o fim, fala do prazo", () => {
    expect(surveyValidityLine(null, "2026-09-02T18:25:00.000Z")).toBe(
      "Você pode responder até 02/09/2026, às 15:25.",
    );
  });

  it("só com o início, fala da abertura", () => {
    expect(surveyValidityLine("2026-09-02T15:15:00.000Z", null)).toBe(
      "Esta enquete recebe respostas a partir de 02/09/2026, às 12:15.",
    );
  });

  it("data inválida some da frase em vez de virar 'Invalid Date'", () => {
    expect(surveyValidityLine("nao-e-data", null)).toBeNull();
  });

  it("sem nenhuma, não inventa frase", () => {
    expect(surveyValidityLine(null, null)).toBeNull();
  });

  /**
   * ⚠️ O FUSO É O DA APCS, não o do servidor. A Vercel roda em UTC: sem o
   * `timeZone` explícito de `formatDateTime`, o prazo sairia três horas
   * adiantado para todo mundo — e o associado leria um horário que não é o
   * dele.
   */
  it("formata no horário de São Paulo, e não em UTC", () => {
    const linha = surveyValidityLine(null, "2026-09-02T18:25:00.000Z");
    expect(linha).toContain("15:25");
    expect(linha).not.toContain("18:25");
  });
});
