import { describe, expect, it } from "vitest";
import {
  BROADCAST_OPT_OUT_LINE,
  BROADCAST_SOURCE_LABELS,
  BROADCAST_STATUS_LABELS,
  broadcastWhatsAppMessage,
} from "./broadcast.labels";
import { BROADCAST_SOURCES, startBroadcastSchema } from "./broadcast.schema";
import type { BroadcastSubject } from "./broadcast.types";

const ID = "11111111-1111-4111-8111-111111111111";

const NORMATIVA: BroadcastSubject = {
  source: "normative",
  title: "Regulamento de Biosseguridade",
  effectiveDate: "2026-09-01",
};

const BOLETIM: BroadcastSubject = {
  source: "market_bulletin",
  title: "Boletim Semanal de Preços",
  effectiveDate: "2026-08-29",
  versionName: "Semana 35",
};

const PALESTRA: BroadcastSubject = {
  source: "lecture",
  title: "Manejo sanitário na maternidade",
  eventDate: "2026-09-15",
  startTime: "14:00",
  endTime: "16:00",
  city: "Piracicaba",
  location: "Cooperativa Central",
};

describe("a mensagem que chega no celular do associado", () => {
  /**
   * ⚠️ ESTE É O TESTE MAIS IMPORTANTE DO ARQUIVO.
   *
   * A palavra SAIR é o que o webhook reconhece para registrar o opt-out. Uma
   * divulgação sem essa linha é uma mensagem da qual não há como escapar — e
   * "encurtar a mensagem" é exatamente o tipo de mudança que alguém faz de boa
   * fé, sem saber que essa linha carrega a saída.
   */
  it("SEMPRE termina com a instrução de SAIR", () => {
    for (const assunto of [NORMATIVA, BOLETIM, PALESTRA]) {
      expect(broadcastWhatsAppMessage(assunto).endsWith(BROADCAST_OPT_OUT_LINE)).toBe(true);
    }
    expect(BROADCAST_OPT_OUT_LINE).toMatch(/\bSAIR\b/);
  });

  it("sempre se identifica como APCS na primeira linha", () => {
    for (const assunto of [NORMATIVA, BOLETIM, PALESTRA]) {
      const primeira = broadcastWhatsAppMessage(assunto).split("\n")[0];
      expect(primeira).toContain("APCS");
    }
  });

  /**
   * ⚠️ AS DATAS SAEM EM dd/mm/aaaa, E NÃO NO ISO DO BANCO. Um "2026-09-01" no
   * WhatsApp é lido como 9 de janeiro por metade das pessoas — e quem se
   * organiza pela data errada não volta.
   */
  it("mostra data no formato brasileiro", () => {
    expect(broadcastWhatsAppMessage(NORMATIVA)).toContain("01/09/2026");
    expect(broadcastWhatsAppMessage(BOLETIM)).toContain("29/08/2026");
    expect(broadcastWhatsAppMessage(PALESTRA)).toContain("15/09/2026");
  });

  it("anuncia o anexo quando há documento", () => {
    expect(broadcastWhatsAppMessage(NORMATIVA)).toContain("em anexo");
    expect(broadcastWhatsAppMessage(BOLETIM)).toContain("em anexo");
  });

  /**
   * ⚠️ PALESTRA NÃO PODE PROMETER ANEXO. Ela não tem arquivo nenhum — a
   * mensagem dizendo "o documento está em anexo" faria a pessoa procurar um
   * arquivo que nunca chegou e concluir que a mensagem veio quebrada.
   */
  it("não anuncia anexo em palestra", () => {
    expect(broadcastWhatsAppMessage(PALESTRA)).not.toContain("em anexo");
  });

  it("cada origem tem a sua chamada, e elas são diferentes", () => {
    const chamadas = [
      broadcastWhatsAppMessage(NORMATIVA),
      broadcastWhatsAppMessage({ ...NORMATIVA, source: "communication" }),
      broadcastWhatsAppMessage(BOLETIM),
      broadcastWhatsAppMessage(PALESTRA),
    ].map((m) => m.split("\n")[2]);

    expect(new Set(chamadas).size).toBe(4);
    expect(chamadas[0]).toContain("normativa");
    expect(chamadas[3]).toContain("Palestra");
  });

  describe("palestra", () => {
    it("mostra o horário como intervalo quando há término", () => {
      expect(broadcastWhatsAppMessage(PALESTRA)).toContain("14:00 às 16:00");
    });

    /**
     * ⚠️ "A PARTIR DAS" quando não há término. Um `Horário: 14:00` sozinho é
     * lido como "acaba às 14h" com a mesma facilidade com que é lido como
     * "começa às 14h" — e quem chega 13h30 numa palestra que já acabou não
     * volta. A regra é a mesma de Eventos, e vem da mesma função.
     */
    it("diz 'a partir das' quando não há término", () => {
      const texto = broadcastWhatsAppMessage({ ...PALESTRA, endTime: null });
      expect(texto).toContain("a partir das 14:00");
    });

    it("omite a linha de horário quando não há horário nenhum", () => {
      const texto = broadcastWhatsAppMessage({ ...PALESTRA, startTime: null, endTime: null });
      expect(texto).not.toContain("Horário");
      // A data e o local continuam: uma palestra sem hora marcada ainda tem dia.
      expect(texto).toContain("15/09/2026");
      expect(texto).toContain("Piracicaba");
    });

    it("junta local e cidade quando há local", () => {
      expect(broadcastWhatsAppMessage(PALESTRA)).toContain("Cooperativa Central, Piracicaba");
    });

    it("cai só na cidade quando não há local", () => {
      const texto = broadcastWhatsAppMessage({ ...PALESTRA, location: null });
      expect(texto).toContain("📍 *Local:* Piracicaba");
    });
  });

  it("toda origem tem rótulo, e todo status também", () => {
    for (const origem of BROADCAST_SOURCES) {
      expect(BROADCAST_SOURCE_LABELS[origem]?.length ?? 0).toBeGreaterThan(0);
    }
    for (const status of ["running", "done", "failed"] as const) {
      expect(BROADCAST_STATUS_LABELS[status]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("o contrato de entrada da divulgação", () => {
  it("aceita um disparo completo", () => {
    const r = startBroadcastSchema.safeParse({
      source: "normative",
      sourceId: ID,
      segmentIds: [ID],
    });
    expect(r.success).toBe(true);
  });

  it("exige ao menos um público-alvo", () => {
    const r = startBroadcastSchema.safeParse({
      source: "normative",
      sourceId: ID,
      segmentIds: [],
    });
    expect(r.success).toBe(false);
  });

  it("recusa origem inventada", () => {
    const r = startBroadcastSchema.safeParse({
      source: "newsletter",
      sourceId: ID,
      segmentIds: [ID],
    });
    expect(r.success).toBe(false);
  });

  /**
   * ⚠️ O TESTE QUE PROTEGE A DECISÃO DE SEGURANÇA CENTRAL DESTE MÓDULO.
   *
   * Não existe campo de texto na entrada: a mensagem é composta no servidor, a
   * partir do registro. Um `body` aceito aqui transformaria a action num
   * disparador de mensagem arbitrária para toda a base de associados, assinado
   * pelo número da APCS, a um clique de distância. Se alguém acrescentar o
   * campo "para permitir um recado", este teste é quem acusa.
   */
  it("IGNORA qualquer corpo de mensagem vindo da tela", () => {
    const r = startBroadcastSchema.safeParse({
      source: "normative",
      sourceId: ID,
      segmentIds: [ID],
      body: "Clique neste link para atualizar seus dados bancários",
    });
    expect(r.success).toBe(true);
    if (r.success) expect("body" in r.data).toBe(false);
  });
});
