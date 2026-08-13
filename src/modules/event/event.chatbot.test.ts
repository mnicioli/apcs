import { describe, expect, it } from "vitest";
import {
  clampChatbotLimit,
  compareChatbotEvents,
  DEFAULT_CHATBOT_EVENT_LIMIT,
  isEventVisibleTo,
  MAX_CHATBOT_EVENT_LIMIT,
  toChatbotEvent,
} from "./event.chatbot";
import type { EventSegment, EventSummary } from "./event.types";

const HOJE = "2026-08-12";

function segmento(slug: string): EventSegment {
  return { id: slug, slug, name: slug, description: null };
}

function evento(overrides: Partial<EventSummary> = {}): EventSummary {
  return {
    id: "e1",
    name: "Congresso APCS",
    location: "Auditório APCS",
    registrationUrl: "https://apcs.org.br/inscricao",
    eventDate: "2026-08-20",
    startTime: "14:00",
    endTime: "17:00",
    status: "active",
    imageUrl: "https://storage/assinada.jpg",
    segments: [segmento("suinos"), segmento("camara-setorial")],
    createdBy: { id: "u1", fullName: "Marcos Nicioli" },
    createdAt: "2026-08-01T12:00:00Z",
    updatedBy: { id: "u2", fullName: "Outra Pessoa" },
    updatedAt: "2026-08-02T12:00:00Z",
    ...overrides,
  };
}

describe("isEventVisibleTo — as três condições", () => {
  it("ativo, futuro e do meu segmento: visível", () => {
    expect(isEventVisibleTo(evento(), ["suinos"], HOJE)).toBe(true);
  });

  // O exemplo do escopo: João é de Suínos, Maria é de Bovinos.
  it("segmento incompatível: invisível", () => {
    expect(isEventVisibleTo(evento(), ["bovinos"], HOJE)).toBe(false);
  });

  it("evento inativado à mão: invisível mesmo para quem é do público", () => {
    expect(isEventVisibleTo(evento({ status: "inactive" }), ["suinos"], HOJE)).toBe(false);
  });

  // ⚠️ DEFESA EM PROFUNDIDADE. Mesmo com `status = 'active'` gravado — que é
  // como um evento vencido fica enquanto nenhuma rotina o toca —, a data manda.
  it("evento vencido é invisível mesmo gravado como ATIVO", () => {
    const vencido = evento({ status: "active", eventDate: "2026-08-01" });
    expect(vencido.status).toBe("active");
    expect(isEventVisibleTo(vencido, ["suinos"], HOJE)).toBe(false);
  });

  it("evento de hoje ainda é visível", () => {
    expect(isEventVisibleTo(evento({ eventDate: HOJE }), ["suinos"], HOJE)).toBe(true);
  });

  it("evento sem público-alvo é invisível para todos", () => {
    expect(isEventVisibleTo(evento({ segments: [] }), ["suinos"], HOJE)).toBe(false);
  });

  it("associado sem segmento não vê nada", () => {
    expect(isEventVisibleTo(evento(), [], HOJE)).toBe(false);
  });

  it("quem pertence aos dois públicos do evento vê — uma vez só", () => {
    expect(isEventVisibleTo(evento(), ["suinos", "camara-setorial"], HOJE)).toBe(true);
  });
});

describe("toChatbotEvent — o que sai e o que NÃO sai", () => {
  const dto = toChatbotEvent(evento());

  it("entrega o que o associado precisa para decidir se vai", () => {
    expect(dto).toEqual({
      id: "e1",
      name: "Congresso APCS",
      location: "Auditório APCS",
      eventDate: "2026-08-20",
      startTime: "14:00",
      endTime: "17:00",
      registrationUrl: "https://apcs.org.br/inscricao",
      imageUrl: "https://storage/assinada.jpg",
    });
  });

  // ⚠️ O teste que impede o vazamento. `createdBy`/`updatedBy` são NOMES DE
  // FUNCIONÁRIOS da APCS; `status` e os carimbos são dado administrativo.
  // Se alguém trocar o DTO por um `Omit<...>`, este teste cai.
  it("não vaza autoria, status nem carimbos administrativos", () => {
    for (const proibido of [
      "createdBy",
      "updatedBy",
      "createdAt",
      "updatedAt",
      "status",
      "segments",
    ]) {
      expect(dto).not.toHaveProperty(proibido);
    }
  });

  it("sem link de inscrição devolve null, e não uma URL inventada", () => {
    expect(toChatbotEvent(evento({ registrationUrl: null })).registrationUrl).toBeNull();
  });

  it("sem hora de término devolve null", () => {
    expect(toChatbotEvent(evento({ endTime: null })).endTime).toBeNull();
  });

  it("sem imagem devolve null", () => {
    expect(toChatbotEvent(evento({ imageUrl: null })).imageUrl).toBeNull();
  });

  // "Online" é um local como outro qualquer — não existe link de transmissão
  // neste modelo, e o DTO não deve sugerir que exista.
  it("evento online entrega 'Online' como local, sem inventar link", () => {
    const online = toChatbotEvent(evento({ location: "Online", registrationUrl: null }));
    expect(online.location).toBe("Online");
    expect(online.registrationUrl).toBeNull();
    expect(online).not.toHaveProperty("meetingUrl");
  });
});

describe("compareChatbotEvents — o mais próximo primeiro", () => {
  it("ordena por data e desempata pelo horário", () => {
    const ordenado = [
      toChatbotEvent(evento({ id: "c", eventDate: "2026-08-25", startTime: "09:00" })),
      toChatbotEvent(evento({ id: "a", eventDate: "2026-08-15", startTime: "14:00" })),
      toChatbotEvent(evento({ id: "b", eventDate: "2026-08-15", startTime: "09:00" })),
    ]
      .sort(compareChatbotEvents)
      .map((e) => e.id);

    expect(ordenado).toEqual(["b", "a", "c"]);
  });
});

describe("clampChatbotLimit", () => {
  it("sem pedido, usa o padrão", () => {
    expect(clampChatbotLimit()).toBe(DEFAULT_CHATBOT_EVENT_LIMIT);
    expect(clampChatbotLimit(Number.NaN)).toBe(DEFAULT_CHATBOT_EVENT_LIMIT);
  });

  it("respeita um pedido razoável", () => {
    expect(clampChatbotLimit(3)).toBe(3);
  });

  // Contra enumeração: sem o teto, `limit=100000` viraria um dump da agenda.
  it("nunca passa do teto, por mais que peçam", () => {
    expect(clampChatbotLimit(100_000)).toBe(MAX_CHATBOT_EVENT_LIMIT);
  });

  it("nunca desce abaixo de 1", () => {
    expect(clampChatbotLimit(0)).toBe(1);
    expect(clampChatbotLimit(-5)).toBe(1);
  });
});
