import { describe, expect, it } from "vitest";
import {
  attendanceReason,
  attendanceSituation,
  compareAttendances,
  matchesFilter,
  STALLED_AFTER_MINUTES,
  type AttendanceRuleInput,
} from "./attendance.rules";
import type { Attendance, AttendanceReason } from "./attendance.types";

const AGORA = new Date("2026-08-07T14:00:00Z");

/** Uma conversa em andamento, mexida agora e sem nenhuma marca de atendimento. */
function conversa(patch: Partial<AttendanceRuleInput> = {}): AttendanceRuleInput {
  return {
    conversationStatus: "active",
    hasLead: false,
    assignedTo: null,
    resolvedAt: null,
    lastMessageAt: AGORA.toISOString(),
    ...patch,
  };
}

function minutosAtras(minutes: number): string {
  return new Date(AGORA.getTime() - minutes * 60_000).toISOString();
}

describe("attendanceReason", () => {
  it("aponta quem pediu para falar com o time", () => {
    expect(
      attendanceReason(conversa({ conversationStatus: "handoff", hasLead: true }), AGORA),
    ).toBe("handoff");
  });

  // O caso que a fila existe para não deixar passar: a pessoa foi avisada de
  // que o time retornaria e o contato não ficou registrado em lugar nenhum.
  it("distingue o encaminhamento sem lead gravado", () => {
    expect(
      attendanceReason(conversa({ conversationStatus: "handoff", hasLead: false }), AGORA),
    ).toBe("lead_failed");
  });

  it("aponta a conversa encerrada pelo limite de mensagens", () => {
    expect(attendanceReason(conversa({ conversationStatus: "abandoned" }), AGORA)).toBe(
      "abandoned",
    );
  });

  it("só considera parada a conversa que passou do limite de tempo", () => {
    const emCima = conversa({ lastMessageAt: minutosAtras(STALLED_AFTER_MINUTES) });
    const umPoucoAntes = conversa({ lastMessageAt: minutosAtras(STALLED_AFTER_MINUTES - 1) });

    expect(attendanceReason(emCima, AGORA)).toBe("stalled");
    expect(attendanceReason(umPoucoAntes, AGORA)).toBeNull();
  });

  it("não cobra atendimento de quem já virou lead", () => {
    expect(
      attendanceReason(conversa({ conversationStatus: "completed", hasLead: true }), AGORA),
    ).toBeNull();
  });

  // Sem consentimento não há dado nem base legal para procurar ninguém —
  // colocar isso na fila seria pedir para alguém violar a LGPD.
  it("não cobra atendimento de quem recusou o consentimento", () => {
    expect(attendanceReason(conversa({ conversationStatus: "declined" }), AGORA)).toBeNull();
  });

  it("tira da fila o que já foi concluído, mesmo pendente pelo status", () => {
    const resolvida = conversa({
      conversationStatus: "handoff",
      hasLead: true,
      resolvedAt: minutosAtras(5),
    });
    expect(attendanceReason(resolvida, AGORA)).toBeNull();
  });

  // Data ilegível não pode inventar pendência: seria uma linha na fila que
  // ninguém consegue explicar nem resolver.
  it("não transforma data inválida em conversa parada", () => {
    expect(attendanceReason(conversa({ lastMessageAt: "não é uma data" }), AGORA)).toBeNull();
  });
});

describe("attendanceSituation", () => {
  it("põe na fila quem precisa de gente e ninguém assumiu", () => {
    expect(attendanceSituation(conversa({ conversationStatus: "abandoned" }), AGORA)).toBe(
      "queued",
    );
  });

  it("sai da fila assim que alguém assume", () => {
    const assumida = conversa({ conversationStatus: "abandoned", assignedTo: "user-1" });
    expect(attendanceSituation(assumida, AGORA)).toBe("assigned");
  });

  it("concluído vence a atribuição", () => {
    const concluida = conversa({ assignedTo: "user-1", resolvedAt: minutosAtras(1) });
    expect(attendanceSituation(concluida, AGORA)).toBe("resolved");
  });

  it("marca como sem pendência a conversa que não pede ninguém", () => {
    expect(
      attendanceSituation(conversa({ conversationStatus: "completed", hasLead: true }), AGORA),
    ).toBe("no_action");
  });
});

describe("compareAttendances", () => {
  function item(reason: AttendanceReason | null, lastMessageAt: string): Attendance {
    return {
      id: `${reason ?? "sem-motivo"}-${lastMessageAt}`,
      conversationStatus: "active",
      situation: reason ? "queued" : "no_action",
      reason,
      contactName: null,
      city: null,
      state: null,
      interest: null,
      wantsHuman: false,
      assignedTo: null,
      assignedAt: null,
      resolvedAt: null,
      leadId: null,
      lastMessageAt,
      createdAt: lastMessageAt,
    };
  }

  it("ordena por urgência antes de qualquer outra coisa", () => {
    const antigo = minutosAtras(600);
    const ordenado = [
      item("stalled", AGORA.toISOString()),
      item("handoff", AGORA.toISOString()),
      item("lead_failed", antigo),
      item("abandoned", AGORA.toISOString()),
    ]
      .sort(compareAttendances)
      .map((a) => a.reason);

    expect(ordenado).toEqual(["lead_failed", "handoff", "abandoned", "stalled"]);
  });

  it("desempata pelo mais recente", () => {
    const ordenado = [
      item("handoff", minutosAtras(90)),
      item("handoff", minutosAtras(10)),
      item("handoff", minutosAtras(50)),
    ]
      .sort(compareAttendances)
      .map((a) => a.lastMessageAt);

    expect(ordenado).toEqual([minutosAtras(10), minutosAtras(50), minutosAtras(90)]);
  });

  // Sem motivo não é urgência máxima — é ausência de urgência.
  it("joga para o fim quem não tem motivo", () => {
    const ordenado = [item(null, AGORA.toISOString()), item("stalled", minutosAtras(600))]
      .sort(compareAttendances)
      .map((a) => a.reason);

    expect(ordenado).toEqual(["stalled", null]);
  });
});

describe("matchesFilter", () => {
  const naFila = {
    situation: "queued",
  } as Attendance;

  it("casa a aba com a situação", () => {
    expect(matchesFilter(naFila, "queued")).toBe(true);
    expect(matchesFilter(naFila, "resolved")).toBe(false);
  });

  it("a aba de auditoria não filtra nada", () => {
    expect(matchesFilter(naFila, "all")).toBe(true);
    expect(matchesFilter({ situation: "no_action" } as Attendance, "all")).toBe(true);
  });
});
