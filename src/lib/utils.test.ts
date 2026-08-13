import { describe, expect, it } from "vitest";
import {
  formatCalendarDate,
  formatDateTime,
  formatFileSize,
  formatRelativeDate,
  formatRelativeTime,
  normalizeForSearch,
  todayInSaoPaulo,
} from "@/lib/utils";

// Todas as datas abaixo estão em UTC. São Paulo é UTC-3, então 03:00Z é
// meia-noite daqui — é nessa faixa que os erros de fuso aparecem.
describe("formatRelativeDate", () => {
  const agora = new Date("2026-08-07T14:00:00Z"); // 11h de 07/08 em São Paulo

  it("diz 'hoje' para algo do mesmo dia", () => {
    expect(formatRelativeDate("2026-08-07T12:00:00Z", agora)).toBe("hoje");
  });

  it("diz 'ontem' para o dia anterior", () => {
    expect(formatRelativeDate("2026-08-06T12:00:00Z", agora)).toBe("ontem");
  });

  it("conta os dias até a primeira semana", () => {
    expect(formatRelativeDate("2026-08-04T12:00:00Z", agora)).toBe("3 dias");
    expect(formatRelativeDate("2026-08-02T12:00:00Z", agora)).toBe("5 dias");
  });

  it("volta à data absoluta a partir de uma semana", () => {
    // "12 dias" obriga a pessoa a calcular; a data ela lê direto.
    expect(formatRelativeDate("2026-07-26T12:00:00Z", agora)).toBe("26/07/2026");
  });

  // O caso que motivou calcular por data de calendário em vez de subtrair
  // timestamps: 23h30 em São Paulo já é o dia seguinte em UTC.
  it("usa o calendário de São Paulo, não o de UTC", () => {
    const criadoTarde = "2026-08-07T02:30:00Z"; // 23h30 de 06/08 em São Paulo
    expect(formatRelativeDate(criadoTarde, agora)).toBe("ontem");
  });

  it("trata a virada da meia-noite local como dia novo", () => {
    const logoApos = "2026-08-07T03:30:00Z"; // 00h30 de 07/08 em São Paulo
    expect(formatRelativeDate(logoApos, agora)).toBe("hoje");
  });

  // Relógio do servidor atrasado não pode produzir "-1 dias" na tela.
  it("trata data no futuro como hoje", () => {
    expect(formatRelativeDate("2026-08-09T12:00:00Z", agora)).toBe("hoje");
  });

  it("devolve travessão para data inválida", () => {
    expect(formatRelativeDate("nao é uma data", agora)).toBe("—");
  });
});

describe("formatRelativeTime", () => {
  const agora = new Date("2026-08-07T14:00:00Z"); // 11h de 07/08 em São Paulo

  it("chama de 'agora' o que acabou de acontecer", () => {
    expect(formatRelativeTime("2026-08-07T13:59:30Z", agora)).toBe("agora");
  });

  it("conta os minutos dentro da primeira hora", () => {
    expect(formatRelativeTime("2026-08-07T13:48:00Z", agora)).toBe("há 12 min");
    expect(formatRelativeTime("2026-08-07T13:01:00Z", agora)).toBe("há 59 min");
  });

  it("vira hora ao completar sessenta minutos", () => {
    expect(formatRelativeTime("2026-08-07T13:00:00Z", agora)).toBe("há 1 h");
    expect(formatRelativeTime("2026-08-07T05:00:00Z", agora)).toBe("há 9 h");
  });

  // Passado um dia a precisão de relógio não ajuda mais a priorizar nada.
  it("passa a bola para a data relativa depois de um dia", () => {
    expect(formatRelativeTime("2026-08-06T10:00:00Z", agora)).toBe("ontem");
    expect(formatRelativeTime("2026-07-26T12:00:00Z", agora)).toBe("26/07/2026");
  });

  // Relógio do servidor adiantado não pode produzir "há -3 min" na tela.
  it("trata data no futuro como agora", () => {
    expect(formatRelativeTime("2026-08-07T15:00:00Z", agora)).toBe("agora");
  });

  it("devolve travessão para data inválida", () => {
    expect(formatRelativeTime("nao é uma data", agora)).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("formata no padrão brasileiro, no fuso de São Paulo", () => {
    expect(formatDateTime("2026-08-04T17:32:00Z")).toBe("04/08/2026, 14:32");
  });

  it("devolve travessão para data inválida", () => {
    expect(formatDateTime("")).toBe("—");
  });
});

describe("todayInSaoPaulo", () => {
  it("devolve o dia no formato ordenável AAAA-MM-DD", () => {
    expect(todayInSaoPaulo(new Date("2026-08-12T15:00:00Z"))).toBe("2026-08-12");
  });

  // ⚠️ O teste que justifica a função existir. Às 02:00Z de 13/08 ainda são
  // 23:00 de 12/08 em São Paulo. Um `toISOString().slice(0,10)` diria "13" e um
  // evento marcado para hoje apareceria como expirado três horas antes da hora.
  it("não vira o dia antes da meia-noite de São Paulo", () => {
    expect(todayInSaoPaulo(new Date("2026-08-13T02:00:00Z"))).toBe("2026-08-12");
    expect(todayInSaoPaulo(new Date("2026-08-13T03:00:00Z"))).toBe("2026-08-13");
  });
});

describe("formatCalendarDate", () => {
  // O bug que esta função existe para evitar: `new Date("2026-08-15")` é
  // meia-noite UTC, que em São Paulo é 21h de 14/08. A tela mostraria a data um
  // dia antes do que está escrito no cadastro.
  it("não desloca o dia por causa de fuso", () => {
    expect(formatCalendarDate("2026-08-15")).toBe("15/08/2026");
    expect(formatCalendarDate("2026-01-01")).toBe("01/01/2026");
  });

  it("devolve travessão para valor que não é data", () => {
    expect(formatCalendarDate("15/08/2026")).toBe("—");
    expect(formatCalendarDate("")).toBe("—");
  });
});

describe("normalizeForSearch", () => {
  // Ninguém digita acento numa caixa de busca.
  it("ignora acento e caixa", () => {
    expect(normalizeForSearch("  CÂMARA Ambiental ")).toBe("camara ambiental");
  });

  it("mantém o ç legível", () => {
    expect(normalizeForSearch("Produção")).toBe("producao");
  });
});

describe("formatFileSize", () => {
  it("usa a unidade que a pessoa consegue ler", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
  });

  // Uma casa decimal perto do teto: "5 MB" para 4,9 e para 5,4 não explicaria
  // por que um passou e o outro foi recusado.
  it("mostra a casa decimal perto do limite de 5 MB", () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5,0 MB");
    expect(formatFileSize(Math.round(4.9 * 1024 * 1024))).toBe("4,9 MB");
  });

  it("não inventa tamanho para valor inválido", () => {
    expect(formatFileSize(Number.NaN)).toBe("—");
    expect(formatFileSize(-1)).toBe("—");
  });
});
