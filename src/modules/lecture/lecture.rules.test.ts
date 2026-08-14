import { describe, expect, it } from "vitest";
import {
  actorLabel,
  canTransition,
  closingReason,
  compareByTime,
  entryStatuses,
  findConflicts,
  groupByDate,
  isAwaitingOutcome,
  isOpen,
  isTerminal,
  lectureStage,
  nextStatuses,
  occupiesAgenda,
  overlaps,
  typeDescription,
} from "./lecture.rules";
import { LECTURE_TYPE_LABELS } from "./lecture.labels";
import type { Lecture, LectureStatus, LectureTransition } from "./lecture.types";

/**
 * O GRAFO usado nos testes ÃƒÂ© o mesmo que a migration insere. Ele ÃƒÂ© dado de
 * entrada, e nÃƒÂ£o constante do mÃƒÂ³dulo, exatamente como em produÃƒÂ§ÃƒÂ£o: as funÃƒÂ§ÃƒÂµes
 * recebem o grafo do banco. Se um dia a migration mudar e este objeto nÃƒÂ£o, os
 * testes continuam corretos sobre a funÃƒÂ§ÃƒÂ£o Ã¢â‚¬â€ e ÃƒÂ© o teste SQL
 * (158 casos, em transaÃƒÂ§ÃƒÂ£o revertida) que cobre a concordÃƒÂ¢ncia com o banco.
 */
const GRAFO: LectureTransition[] = [
  { from: null, to: "requested" },
  { from: null, to: "planned" },
  { from: null, to: "confirmed" },
  { from: null, to: "held" },
  { from: "requested", to: "under_review" },
  { from: "under_review", to: "approved" },
  { from: "under_review", to: "rejected" },
  { from: "approved", to: "planned" },
  { from: "planned", to: "confirmed" },
  { from: "confirmed", to: "held" },
  { from: "requested", to: "cancelled" },
  { from: "under_review", to: "cancelled" },
  { from: "approved", to: "cancelled" },
  { from: "planned", to: "cancelled" },
  { from: "confirmed", to: "cancelled" },
];

function palestra(overrides: Partial<Lecture> = {}): Lecture {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    protocol: "SOL-000001",
    origin: "internal",
    name: "Mercado de SuÃƒÂ­nos",
    theme: "Mercado",
    city: "Toledo",
    location: null,
    type: "company",
    typeOther: null,
    format: "in_person",
    eventDate: "2026-09-10",
    startTime: "10:00",
    endTime: "11:00",
    attendeesEstimated: null,
    attendeesActual: null,
    speaker: null,
    responsible: null,
    priority: "normal",
    status: "planned",
    notes: null,
    rejectionReason: null,
    cancellationReason: null,
    requestedAt: "2026-08-01T12:00:00Z",
    heldAt: null,
    outcomeNotes: null,
    requester: { contactId: null, name: null, email: null, phone: null, organization: null },
    createdBy: null,
    createdAt: "2026-08-01T12:00:00Z",
    updatedBy: null,
    updatedAt: "2026-08-01T12:00:00Z",
    ...overrides,
  };
}

describe("grafo de status (Ã‚Â§5)", () => {
  it("percorre o fluxo principal do escopo", () => {
    const fluxo: LectureStatus[] = [
      "requested",
      "under_review",
      "approved",
      "planned",
      "confirmed",
      "held",
    ];

    for (let i = 0; i < fluxo.length - 1; i += 1) {
      const de = fluxo[i];
      const para = fluxo[i + 1];
      if (!de || !para) throw new Error("fluxo mal montado");
      expect(canTransition(GRAFO, de, para)).toBe(true);
    }
  });

  it("recusa pular etapas", () => {
    expect(canTransition(GRAFO, "requested", "approved")).toBe(false);
    expect(canTransition(GRAFO, "approved", "confirmed")).toBe(false);
    expect(canTransition(GRAFO, "requested", "held")).toBe(false);
  });

  it("recusa voltar atrÃƒÂ¡s Ã¢â‚¬â€ a lacuna conhecida do mÃƒÂ³dulo", () => {
    expect(canTransition(GRAFO, "confirmed", "planned")).toBe(false);
    expect(canTransition(GRAFO, "approved", "under_review")).toBe(false);
  });

  it("rejeita sÃƒÂ³ depois da anÃƒÂ¡lise", () => {
    expect(canTransition(GRAFO, "requested", "rejected")).toBe(false);
    expect(canTransition(GRAFO, "under_review", "rejected")).toBe(true);
  });

  it("cancela de qualquer situaÃƒÂ§ÃƒÂ£o nÃƒÂ£o terminal, e de nenhuma terminal", () => {
    for (const de of ["requested", "under_review", "approved", "planned", "confirmed"] as const) {
      expect(canTransition(GRAFO, de, "cancelled")).toBe(true);
    }
    for (const de of ["held", "rejected", "cancelled"] as const) {
      expect(canTransition(GRAFO, de, "cancelled")).toBe(false);
    }
  });

  it("lista os prÃƒÂ³ximos passos de cada situaÃƒÂ§ÃƒÂ£o", () => {
    expect(nextStatuses(GRAFO, "requested")).toEqual(["under_review", "cancelled"]);
    expect(nextStatuses(GRAFO, "under_review")).toEqual(["approved", "rejected", "cancelled"]);
    expect(nextStatuses(GRAFO, "held")).toEqual([]);
  });

  it("lista os pontos de entrada", () => {
    expect(entryStatuses(GRAFO)).toEqual(["requested", "planned", "confirmed", "held"]);
  });

  it("reconhece os status terminais", () => {
    expect(isTerminal("held")).toBe(true);
    expect(isTerminal("rejected")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("confirmed")).toBe(false);
  });

  it("sabe quais status ocupam a agenda", () => {
    expect(occupiesAgenda("planned")).toBe(true);
    expect(occupiesAgenda("confirmed")).toBe(true);
    expect(occupiesAgenda("held")).toBe(true);
    expect(occupiesAgenda("requested")).toBe(false);
    expect(occupiesAgenda("approved")).toBe(false);
    expect(occupiesAgenda("cancelled")).toBe(false);
  });
});

describe("etapa derivada (Ã‚Â§53, Ã‚Â§56)", () => {
  const hoje = "2026-09-10";

  it("classifica o que ainda nÃƒÂ£o entrou na agenda", () => {
    expect(lectureStage(palestra({ status: "requested" }), hoje)).toBe("pending");
    expect(lectureStage(palestra({ status: "under_review" }), hoje)).toBe("pending");
    expect(lectureStage(palestra({ status: "approved" }), hoje)).toBe("pending");
  });

  it("classifica o que estÃƒÂ¡ agendado para hoje ou o futuro", () => {
    expect(lectureStage(palestra({ status: "planned", eventDate: hoje }), hoje)).toBe("scheduled");
    expect(lectureStage(palestra({ status: "confirmed", eventDate: "2026-12-01" }), hoje)).toBe(
      "scheduled",
    );
  });

  it("marca como aguardando registro o que estava marcado e cuja data passou", () => {
    expect(lectureStage(palestra({ status: "confirmed", eventDate: "2026-09-09" }), hoje)).toBe(
      "awaiting_outcome",
    );
    expect(isAwaitingOutcome(palestra({ status: "planned", eventDate: "2020-01-01" }), hoje)).toBe(
      true,
    );
  });

  it("Ã‚Â§56 NUNCA transforma data passada em realizada Ã¢â‚¬â€ sÃƒÂ³ muda a leitura", () => {
    const vencida = palestra({ status: "confirmed", eventDate: "2020-01-01" });
    expect(lectureStage(vencida, hoje)).toBe("awaiting_outcome");
    // O dado gravado continua o mesmo. Ãƒâ€° o ponto inteiro do desenho.
    expect(vencida.status).toBe("confirmed");
  });

  it("encerrada ÃƒÂ© encerrada, tenha a data passado ou nÃƒÂ£o", () => {
    expect(lectureStage(palestra({ status: "held", eventDate: "2020-01-01" }), hoje)).toBe(
      "closed",
    );
    expect(lectureStage(palestra({ status: "cancelled", eventDate: "2030-01-01" }), hoje)).toBe(
      "closed",
    );
    expect(lectureStage(palestra({ status: "rejected" }), hoje)).toBe("closed");
  });

  it("sabe o que ainda estÃƒÂ¡ em jogo", () => {
    expect(isOpen(palestra({ status: "planned" }))).toBe(true);
    expect(isOpen(palestra({ status: "cancelled" }))).toBe(false);
  });
});

describe("conflito de horÃƒÂ¡rio (Ã‚Â§33)", () => {
  const dia = "2026-10-01";
  const slot = (startTime: string | null, endTime: string | null) => ({
    eventDate: dia,
    startTime,
    endTime,
  });

  // Os mesmos casos que foram conferidos contra o `OVERLAPS` do Postgres antes
  // de a funÃƒÂ§ÃƒÂ£o existir. Se um dia divergirem, ÃƒÂ© aqui que aparece.
  it("acusa sobreposiÃƒÂ§ÃƒÂ£o parcial", () => {
    expect(overlaps(slot("10:00", "11:00"), slot("10:30", "11:30"))).toBe(true);
  });

  it("NÃƒÆ’O acusa quando as palestras apenas se encostam", () => {
    expect(overlaps(slot("10:00", "11:00"), slot("11:00", "12:00"))).toBe(false);
    expect(overlaps(slot("10:00", "11:00"), slot("09:00", "10:00"))).toBe(false);
  });

  it("acusa horÃƒÂ¡rios idÃƒÂªnticos e contidos", () => {
    expect(overlaps(slot("10:00", "11:00"), slot("10:00", "11:00"))).toBe(true);
    expect(overlaps(slot("10:00", "11:00"), slot("10:15", "10:45"))).toBe(true);
  });

  it("trata palestra sem tÃƒÂ©rmino como um instante", () => {
    expect(overlaps(slot("10:30", null), slot("09:00", "11:00"))).toBe(true);
    expect(overlaps(slot("10:00", null), slot("10:00", null))).toBe(true);
    expect(overlaps(slot("11:00", null), slot("10:00", "11:00"))).toBe(false);
  });

  it("nÃƒÂ£o compara dias diferentes nem palestras sem horÃƒÂ¡rio", () => {
    expect(
      overlaps({ eventDate: dia, startTime: "10:00", endTime: "11:00" }, slot("10:00", "11:00")),
    ).toBe(true);
    expect(
      overlaps(
        { eventDate: "2026-10-02", startTime: "10:00", endTime: "11:00" },
        slot("10:00", "11:00"),
      ),
    ).toBe(false);
    expect(overlaps(slot(null, null), slot("10:00", "11:00"))).toBe(false);
  });

  it("sÃƒÂ³ considera as palestras que ocupam a agenda", () => {
    const agenda = [
      palestra({
        id: "a",
        status: "planned",
        eventDate: dia,
        startTime: "10:00",
        endTime: "11:00",
      }),
      palestra({
        id: "b",
        status: "requested",
        eventDate: dia,
        startTime: "10:00",
        endTime: "11:00",
      }),
      palestra({
        id: "c",
        status: "cancelled",
        eventDate: dia,
        startTime: "10:00",
        endTime: "11:00",
      }),
    ];

    expect(findConflicts(slot("10:30", "11:30"), agenda).map((l) => l.id)).toEqual(["a"]);
  });

  it("ignora a prÃƒÂ³pria palestra quando ela ÃƒÂ© reagendada", () => {
    const agenda = [
      palestra({
        id: "a",
        status: "planned",
        eventDate: dia,
        startTime: "10:00",
        endTime: "11:00",
      }),
    ];
    expect(findConflicts(slot("10:00", "11:00"), agenda, "a")).toEqual([]);
  });
});

describe("apresentaÃƒÂ§ÃƒÂ£o", () => {
  it("mostra o detalhe quando o tipo ÃƒÂ© OUTROS", () => {
    expect(
      typeDescription({ type: "other", typeOther: "Evento tÃƒÂ©cnico" }, LECTURE_TYPE_LABELS),
    ).toBe("Outros: Evento tÃƒÂ©cnico");
    expect(typeDescription({ type: "company", typeOther: null }, LECTURE_TYPE_LABELS)).toBe(
      "Empresa",
    );
  });

  it("devolve o motivo do encerramento pela porta certa", () => {
    expect(
      closingReason({
        status: "rejected",
        rejectionReason: "fora do escopo",
        cancellationReason: null,
      }),
    ).toBe("fora do escopo");
    expect(
      closingReason({ status: "cancelled", rejectionReason: null, cancellationReason: "sem sala" }),
    ).toBe("sem sala");
    expect(
      closingReason({ status: "planned", rejectionReason: null, cancellationReason: null }),
    ).toBeNull();
  });

  it("ordena o dia por horÃƒÂ¡rio e joga as sem hora para o fim", () => {
    const lista = [
      palestra({ id: "sem-hora", name: "C", startTime: null, endTime: null }),
      palestra({ id: "tarde", name: "B", startTime: "14:00" }),
      palestra({ id: "manha", name: "A", startTime: "09:00" }),
    ];

    expect([...lista].sort(compareByTime).map((l) => l.id)).toEqual(["manha", "tarde", "sem-hora"]);
  });

  it("agrupa por dia, com cada dia jÃƒÂ¡ ordenado", () => {
    const dias = groupByDate([
      palestra({ id: "b", eventDate: "2026-10-01", startTime: "14:00" }),
      palestra({ id: "a", eventDate: "2026-10-01", startTime: "09:00" }),
      palestra({ id: "c", eventDate: "2026-10-02", startTime: "09:00" }),
    ]);

    expect([...dias.keys()]).toEqual(["2026-10-01", "2026-10-02"]);
    expect(dias.get("2026-10-01")?.map((l) => l.id)).toEqual(["a", "b"]);
  });
});

describe("actorLabel", () => {
  it("usa o nome quando existe", () => {
    expect(actorLabel({ id: "1", fullName: "Marcos Nicioli", email: "m@apcs.com.br" })).toBe(
      "Marcos Nicioli",
    );
  });

  it("cai no e-mail quando o perfil não tem nome preenchido", () => {
    // O defeito que originou esta função: a tela dizia "Não definido" para uma
    // palestra que TINHA palestrante, só porque aquele perfil estava sem nome.
    expect(actorLabel({ id: "1", fullName: null, email: "valdomiro@apcs.com.br" })).toBe(
      "valdomiro@apcs.com.br",
    );
  });

  it("nome só com espaços conta como sem nome", () => {
    expect(actorLabel({ id: "1", fullName: "   ", email: "v@apcs.com.br" })).toBe("v@apcs.com.br");
  });

  it("sem nome e sem e-mail, diz o que está havendo", () => {
    expect(actorLabel({ id: "1", fullName: null, email: null })).toBe(
      "Usuário sem nome cadastrado",
    );
  });

  it("NINGUÉM atribuído continua sendo nulo — quem chama decide como dizer", () => {
    expect(actorLabel(null)).toBeNull();
    expect(actorLabel(undefined)).toBeNull();
  });
});
