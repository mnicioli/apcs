import { describe, expect, it } from "vitest";
import { eventTimeRangeBr, eventWhatsAppMessage, formatEventDateBr } from "./event.labels";

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

describe("eventTimeRangeBr", () => {
  it("mostra a faixa quando há término", () => {
    expect(eventTimeRangeBr("08:00", "17:00")).toBe("08:00 às 17:00");
  });

  /**
   * ⚠️ "A PARTIR DAS" não é enfeite. Um "Horário: 19:00" sozinho é lido como
   * "acaba às 19h" com a mesma facilidade com que é lido como "começa às 19h" —
   * e quem chega às 18h30 num evento que já acabou não volta.
   */
  it("diz 'a partir das' quando o término não foi informado", () => {
    expect(eventTimeRangeBr("19:00", null)).toBe("a partir das 19:00");
  });
});

describe("eventWhatsAppMessage — os rótulos", () => {
  /**
   * ⚠️ O QUE ESTE BLOCO PROTEGE é a LEGIBILIDADE, não a presença do dado.
   *
   * Os dados sempre estiveram na mensagem; o que não estava era um rótulo em
   * cada linha. Numa tela de celular, "Data", "Horário" e "Local" alinhados são
   * o que deixa alguém conferir o dia sem ler o texto inteiro — e foi a falta
   * disso que fez a mensagem parecer incompleta para quem a recebeu.
   */
  it("rotula cada informação em sua própria linha", () => {
    const linhas = eventWhatsAppMessage(base).split("\n");

    expect(linhas.some((l) => l.includes("*Data:*") && l.includes("01/09/2026"))).toBe(true);
    expect(linhas.some((l) => l.includes("*Horário:*") && l.includes("08:00 às 17:00"))).toBe(true);
    expect(linhas.some((l) => l.includes("*Local:*") && l.includes("Sede da APCS, Campinas"))).toBe(
      true,
    );
  });

  it("põe o nome do evento em negrito, sozinho na linha", () => {
    const linhas = eventWhatsAppMessage(base).split("\n");
    expect(linhas).toContain("*Workshop de Sanidade*");
  });

  /**
   * O link sozinho na última linha: a Z-API sempre gera prévia e não há como
   * desligar. Um link no meio de uma frase faz o cartão que o WhatsApp monta
   * empurrar data e local para fora da primeira tela.
   */
  it("deixa a URL sozinha na própria linha", () => {
    const linhas = eventWhatsAppMessage(base).split("\n");
    expect(linhas).toContain("https://apcs.org.br/inscricao");
  });

  it("cabe na legenda de uma imagem", () => {
    // A legenda de anexo tem teto (1024 na Cloud API). Um texto que estoura o
    // limite faz a Meta recusar a MENSAGEM INTEIRA — não corta.
    const gigante = eventWhatsAppMessage({
      ...base,
      name: "N".repeat(120),
      location: "L".repeat(200),
      registrationUrl: `https://apcs.org.br/${"x".repeat(200)}`,
    });
    expect(gigante.length).toBeLessThan(1024);
  });
});

/**
 * A DESCRIÇÃO NA MENSAGEM (pedido de 29/08/2026).
 *
 * O evento passou a ter um texto livre, e ele sai logo abaixo do nome. O que
 * estes testes seguram é a FORMA — porque a forma é o que faz a mensagem ser
 * lida de relance num celular.
 */
describe("eventWhatsAppMessage — a descrição", () => {
  const comDescricao = {
    ...base,
    description: "Dois dias de painéis sobre mercado, sanidade e novidades do setor.",
  };

  it("vem na linha imediatamente abaixo do nome", () => {
    const linhas = eventWhatsAppMessage(comDescricao).split("\n");
    const iNome = linhas.indexOf("*Workshop de Sanidade*");

    expect(iNome).toBeGreaterThan(-1);
    expect(linhas[iNome + 1]).toBe(comDescricao.description);
  });

  /**
   * ⚠️ A LINHA EM BRANCO VEM DEPOIS DA DESCRIÇÃO, não entre ela e o nome.
   * Nome e descrição são um bloco só — "o que é isto" —, separado do bloco de
   * "quando e onde". Com a linha em branco no meio, viram três pedaços soltos.
   */
  it("deixa uma linha em branco entre a descrição e os dados", () => {
    const linhas = eventWhatsAppMessage(comDescricao).split("\n");
    const iDescricao = linhas.indexOf(comDescricao.description);

    expect(linhas[iDescricao + 1]).toBe("");
    expect(linhas[iDescricao + 2]).toContain("*Data:*");
  });

  it("sem descrição, a mensagem fica exatamente como era antes", () => {
    expect(eventWhatsAppMessage({ ...base, description: null })).toBe(eventWhatsAppMessage(base));
    expect(eventWhatsAppMessage({ ...base, description: "   " })).toBe(eventWhatsAppMessage(base));
  });

  /**
   * ⚠️ O TESTE QUE JUSTIFICA O ORÇAMENTO DE CARACTERES EXISTIR.
   *
   * Estourar a legenda não corta o texto: faz o fornecedor RECUSAR A MENSAGEM
   * INTEIRA. Com nome, local, link e descrição todos no máximo que o formulário
   * aceita, a soma passa de 1024 — e a divulgação inteira falharia, para todo
   * mundo, sem que ninguém tivesse feito nada de errado.
   */
  it("cabe na legenda mesmo com TODOS os campos no máximo", () => {
    const gigante = eventWhatsAppMessage({
      ...base,
      name: "N".repeat(160),
      description: "D".repeat(600),
      location: "L".repeat(200),
      registrationUrl: `https://apcs.org.br/${"x".repeat(200)}`,
    });

    expect(gigante.length).toBeLessThanOrEqual(1024);
    // A data e a saída sobrevivem ao corte: quem cede espaço é a descrição.
    expect(gigante).toContain("*Data:*");
    expect(gigante).toContain("SAIR");
    expect(gigante).toContain("…");
  });

  it("descrição que cabe não é cortada", () => {
    const texto = eventWhatsAppMessage(comDescricao);
    expect(texto).toContain(comDescricao.description);
    expect(texto).not.toContain("…");
  });
});
