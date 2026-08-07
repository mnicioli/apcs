import { describe, expect, it } from "vitest";
import { formatDateTime, formatRelativeDate } from "@/lib/utils";

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

describe("formatDateTime", () => {
  it("formata no padrão brasileiro, no fuso de São Paulo", () => {
    expect(formatDateTime("2026-08-04T17:32:00Z")).toBe("04/08/2026, 14:32");
  });

  it("devolve travessão para data inválida", () => {
    expect(formatDateTime("")).toBe("—");
  });
});
