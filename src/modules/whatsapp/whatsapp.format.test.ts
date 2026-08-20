import { describe, expect, it } from "vitest";
import {
  whatsappClock,
  whatsappDayKey,
  whatsappDayLabel,
  whatsappDuration,
  whatsappFileSize,
  whatsappListStamp,
} from "./whatsapp.format";

/**
 * Data e hora da caixa de entrada.
 *
 * ⚠️ O QUE ESTES TESTES REALMENTE PROTEGEM É O FUSO. Sem `timeZone` explícito,
 * o `Intl` usa o relógio do SERVIDOR — que na Vercel é UTC. Das 21h à
 * meia-noite, uma mensagem recebida hoje apareceria sob o separador de amanhã,
 * e o defeito só existiria em produção, à noite: exatamente o mais difícil de
 * reproduzir. Os horários abaixo são escolhidos nessa faixa de propósito.
 */

describe("whatsappClock", () => {
  it("mostra a hora de São Paulo, não a do servidor", () => {
    // 21/09/2021 às 23:30 UTC = 20:30 em São Paulo.
    expect(whatsappClock("2021-09-21T23:30:00.000Z")).toBe("20:30");
  });

  it("carimbo ilegível vira vazio, e não “Invalid Date”", () => {
    expect(whatsappClock("nao-e-data")).toBe("");
  });
});

describe("whatsappDayKey", () => {
  it("⚠️ às 23h de UTC ainda é o dia anterior no Brasil", () => {
    // O caso que quebraria sem o fuso: 01/01 às 02:00 UTC é 31/12 aqui.
    expect(whatsappDayKey("2026-01-01T02:00:00.000Z")).toBe("2025-12-31");
  });

  it("dá uma chave ordenável", () => {
    expect(whatsappDayKey("2026-08-19T15:00:00.000Z")).toBe("2026-08-19");
  });
});

describe("whatsappDayLabel", () => {
  const agora = new Date("2026-08-19T15:00:00.000Z");

  it("hoje, ontem e a data", () => {
    expect(whatsappDayLabel("2026-08-19T12:00:00.000Z", agora)).toBe("Hoje");
    expect(whatsappDayLabel("2026-08-18T12:00:00.000Z", agora)).toBe("Ontem");
    expect(whatsappDayLabel("2026-08-12T12:00:00.000Z", agora)).toBe("12/08/2026");
  });

  it("⚠️ compara por DIA DE CALENDÁRIO, não por “faz menos de 24 h”", () => {
    // Às 8h da manhã, uma mensagem de ontem às 22h tem 10 horas de idade. Uma
    // comparação por diferença de horas a colocaria sob "Hoje", que é o
    // separador errado.
    const manha = new Date("2026-08-19T11:00:00.000Z"); // 08:00 em São Paulo
    const ontemANoite = "2026-08-19T01:00:00.000Z"; // 18/08 às 22:00 em São Paulo
    expect(whatsappDayLabel(ontemANoite, manha)).toBe("Ontem");
  });
});

describe("whatsappListStamp", () => {
  const agora = new Date("2026-08-19T15:00:00.000Z");

  it("hoje mostra a hora; ontem, “ontem”; antes, a data", () => {
    expect(whatsappListStamp("2026-08-19T13:45:00.000Z", agora)).toBe("10:45");
    expect(whatsappListStamp("2026-08-18T13:45:00.000Z", agora)).toBe("ontem");
    expect(whatsappListStamp("2026-07-30T13:45:00.000Z", agora)).toBe("30/07/2026");
  });

  it("conversa sem mensagem nenhuma não mostra carimbo", () => {
    expect(whatsappListStamp(null, agora)).toBe("");
  });
});

describe("whatsappFileSize", () => {
  it("escolhe a unidade legível", () => {
    expect(whatsappFileSize(512)).toBe("512 B");
    expect(whatsappFileSize(2048)).toBe("2 KB");
    expect(whatsappFileSize(1_500_000)).toBe("1,4 MB");
  });

  it("sem tamanho, não inventa um", () => {
    expect(whatsappFileSize(null)).toBe("");
    expect(whatsappFileSize(-1)).toBe("");
  });
});

describe("whatsappDuration", () => {
  it("minutos e segundos, com o zero à esquerda", () => {
    expect(whatsappDuration(67)).toBe("1:07");
    expect(whatsappDuration(9)).toBe("0:09");
    expect(whatsappDuration(600)).toBe("10:00");
  });

  it("sem duração, vazio", () => {
    expect(whatsappDuration(null)).toBe("");
  });
});
