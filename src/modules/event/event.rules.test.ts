import { describe, expect, it } from "vitest";
import {
  canActivate,
  canDeactivate,
  compareEvents,
  effectiveStatus,
  formatTime,
  formatTimeRange,
  matchesEventFilters,
  statusReason,
} from "./event.rules";
import type { EventFilters, EventSummary } from "./event.types";

/** Filtro que não filtra nada — o ponto de partida de cada caso abaixo. */
const SEM_FILTRO: EventFilters = { query: "", status: "all", from: "", to: "" };

/** O "hoje" de referência de todo este arquivo. Nada aqui lê o relógio. */
const HOJE = "2026-08-12";
const ONTEM = "2026-08-11";
const AMANHA = "2026-08-13";

function evento(overrides: Partial<EventSummary> = {}): EventSummary {
  return {
    id: "e1",
    name: "Workshop APCS",
    description: null,
    location: "Auditório APCS",
    registrationUrl: null,
    eventDate: AMANHA,
    startTime: "14:00",
    endTime: "17:00",
    status: "active",
    imageUrl: null,
    segments: [],
    createdBy: null,
    createdAt: "2026-08-01T12:00:00Z",
    updatedBy: null,
    updatedAt: "2026-08-01T12:00:00Z",
    ...overrides,
  };
}

function filtros(overrides: Partial<EventFilters> = {}): EventFilters {
  return { ...SEM_FILTRO, ...overrides };
}

describe("effectiveStatus", () => {
  it("evento ativo com data futura está ativo", () => {
    expect(effectiveStatus(evento({ eventDate: AMANHA }), HOJE)).toBe("active");
  });

  // A EXPIRAÇÃO AUTOMÁTICA, sem nenhuma rotina ter rodado: a data passou, e a
  // leitura já reflete isso.
  it("evento ativo com data passada aparece como expirado", () => {
    expect(effectiveStatus(evento({ eventDate: ONTEM }), HOJE)).toBe("expired");
  });

  // A FRONTEIRA. Um evento marcado para hoje ainda não aconteceu — expirar às
  // 00:00 do próprio dia esconderia o evento de quem vai a ele hoje à tarde.
  it("evento de hoje continua ativo o dia inteiro", () => {
    expect(effectiveStatus(evento({ eventDate: HOJE }), HOJE)).toBe("active");
  });

  it("evento inativado à mão fica inativo", () => {
    expect(effectiveStatus(evento({ status: "inactive" }), HOJE)).toBe("inactive");
  });

  // ⚠️ A propriedade central do desenho: a derivação SÓ SABE REBAIXAR. Nenhuma
  // passagem de tempo, e nenhuma data futura, faz um evento inativado à mão
  // voltar a aparecer como ativo.
  it("a derivação nunca reativa um evento inativado à mão", () => {
    const inativado = evento({ status: "inactive", eventDate: "2030-01-01" });
    expect(effectiveStatus(inativado, HOJE)).toBe("inactive");
    expect(effectiveStatus(inativado, "2029-12-31")).toBe("inactive");
  });

  it("inativação manual vence a expiração quando as duas valem", () => {
    expect(effectiveStatus(evento({ status: "inactive", eventDate: ONTEM }), HOJE)).toBe(
      "inactive",
    );
  });
});

describe("statusReason", () => {
  it("evento no ar não tem motivo", () => {
    expect(statusReason(evento(), HOJE)).toBeNull();
  });

  it("distingue MANUAL de EXPIRADO", () => {
    expect(statusReason(evento({ status: "inactive" }), HOJE)).toBe("manual");
    expect(statusReason(evento({ eventDate: ONTEM }), HOJE)).toBe("expired");
  });
});

describe("canActivate", () => {
  it("permite ativar um evento inativo com data futura", () => {
    expect(canActivate(evento({ status: "inactive", eventDate: AMANHA }), HOJE)).toBe(true);
  });

  // A regra que o banco também impõe (EV001). Sem ela, a expiração derivada
  // teria um furo: bastaria mandar "ativar" num evento de ontem.
  it("recusa ativar um evento cuja data já passou", () => {
    expect(canActivate(evento({ status: "inactive", eventDate: ONTEM }), HOJE)).toBe(false);
  });

  it("não oferece ativar o que já está ativo", () => {
    expect(canActivate(evento({ status: "active" }), HOJE)).toBe(false);
  });

  it("permite inativar só o que está ativo", () => {
    expect(canDeactivate(evento({ status: "active" }))).toBe(true);
    expect(canDeactivate(evento({ status: "inactive" }))).toBe(false);
  });
});

describe("formatTime e formatTimeRange", () => {
  it("corta os segundos que o Postgres devolve", () => {
    expect(formatTime("14:00:00")).toBe("14:00");
    expect(formatTime("09:30:00")).toBe("09:30");
  });

  it("monta a faixa e omite o término quando não há", () => {
    expect(formatTimeRange("14:00", "17:00")).toBe("14:00 às 17:00");
    expect(formatTimeRange("14:00", null)).toBe("14:00");
  });

  it("devolve travessão para horário ausente", () => {
    expect(formatTimeRange("", null)).toBe("—");
  });
});

describe("compareEvents", () => {
  // "Eventos mais próximos primeiro" lido ao pé da letra (tudo em ordem
  // crescente) colocaria o evento de 2024 no topo. Os passados vão para o fim.
  it("põe os próximos primeiro e joga os passados para o fim", () => {
    const ordenado = [
      evento({ id: "passado-antigo", eventDate: "2026-01-10" }),
      evento({ id: "futuro-distante", eventDate: "2026-09-01" }),
      evento({ id: "passado-recente", eventDate: "2026-08-01" }),
      evento({ id: "futuro-proximo", eventDate: "2026-08-15" }),
    ]
      .sort((a, b) => compareEvents(a, b, HOJE))
      .map((e) => e.id);

    expect(ordenado).toEqual([
      "futuro-proximo",
      "futuro-distante",
      "passado-recente",
      "passado-antigo",
    ]);
  });

  it("desempata pelo horário e depois pelo nome", () => {
    const ordenado = [
      evento({ id: "c", eventDate: AMANHA, startTime: "14:00", name: "Zebu" }),
      evento({ id: "a", eventDate: AMANHA, startTime: "09:00", name: "Manhã" }),
      evento({ id: "b", eventDate: AMANHA, startTime: "14:00", name: "Almoço" }),
    ]
      .sort((a, b) => compareEvents(a, b, HOJE))
      .map((e) => e.id);

    expect(ordenado).toEqual(["a", "b", "c"]);
  });
});

describe("matchesEventFilters", () => {
  const workshop = evento({ id: "w", name: "Workshop Suíno", eventDate: "2026-08-20" });
  const camara = evento({ id: "c", name: "Reunião Câmara Ambiental", eventDate: "2026-09-05" });
  const antigo = evento({ id: "a", name: "Encontro Anual", eventDate: "2026-07-01" });

  it("filtro vazio não esconde nada", () => {
    expect(matchesEventFilters(workshop, filtros(), HOJE)).toBe(true);
  });

  it("busca parcial por nome", () => {
    expect(matchesEventFilters(workshop, filtros({ query: "Workshop" }), HOJE)).toBe(true);
    expect(matchesEventFilters(camara, filtros({ query: "Workshop" }), HOJE)).toBe(false);
  });

  // Ninguém digita acento numa caixa de busca.
  it("acha a Câmara sem o acento", () => {
    expect(matchesEventFilters(camara, filtros({ query: "camara" }), HOJE)).toBe(true);
  });

  it("filtra por status ativo", () => {
    expect(matchesEventFilters(workshop, filtros({ status: "active" }), HOJE)).toBe(true);
    expect(matchesEventFilters(antigo, filtros({ status: "active" }), HOJE)).toBe(false);
  });

  // O escopo tem três opções de filtro; "Expirado" cai dentro de "Inativo",
  // porque para quem olha a tela os dois são "não está no ar".
  it("o filtro Inativo pega tanto o manual quanto o expirado", () => {
    expect(matchesEventFilters(antigo, filtros({ status: "inactive" }), HOJE)).toBe(true);
    expect(
      matchesEventFilters(evento({ status: "inactive" }), filtros({ status: "inactive" }), HOJE),
    ).toBe(true);
    expect(matchesEventFilters(workshop, filtros({ status: "inactive" }), HOJE)).toBe(false);
  });

  it("recorta por período, incluindo as duas pontas", () => {
    const periodo = filtros({ from: "2026-08-01", to: "2026-08-31" });
    expect(matchesEventFilters(workshop, periodo, HOJE)).toBe(true);
    expect(matchesEventFilters(camara, periodo, HOJE)).toBe(false);

    // O evento do último dia do intervalo tem de entrar.
    const ultimoDia = evento({ eventDate: "2026-08-31" });
    expect(matchesEventFilters(ultimoDia, periodo, HOJE)).toBe(true);
  });

  it("combina nome, status e período", () => {
    const combinado = filtros({ query: "workshop", status: "active", from: "2026-08-01" });
    expect(matchesEventFilters(workshop, combinado, HOJE)).toBe(true);
    expect(matchesEventFilters(camara, combinado, HOJE)).toBe(false);
  });
});
