import { describe, expect, it } from "vitest";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import {
  LECTURE_ENTRY_STATUSES,
  LECTURE_NEEDS_TIME_MESSAGE,
  assignLectureSchema,
  createLectureSchema,
  lectureCalendarSchema,
  lectureCoreSchema,
  lectureOutcomeSchema,
  lectureProtocolSchema,
  lectureQuerySchema,
  lectureRequestSchema,
  lectureStatusSchema,
  rescheduleLectureSchema,
  scheduledNeedsTime,
  updateLectureSchema,
} from "./lecture.schema";

const NUCLEO = {
  name: "Mercado de Suínos",
  theme: "Custo de produção",
  city: "Toledo",
  type: "company" as const,
  eventDate: "2026-09-10",
};

describe("núcleo do formulário (§52)", () => {
  it("aceita o mínimo obrigatório", () => {
    expect(lectureCoreSchema.safeParse(NUCLEO).success).toBe(true);
  });

  it("exige nome, tema, cidade, tipo e data", () => {
    for (const campo of ["name", "theme", "city", "type", "eventDate"] as const) {
      const sem = { ...NUCLEO };
      delete (sem as Record<string, unknown>)[campo];
      expect(lectureCoreSchema.safeParse(sem).success, campo).toBe(false);
    }
  });

  it("recusa data que só parece data", () => {
    expect(lectureCoreSchema.safeParse({ ...NUCLEO, eventDate: "2026-02-31" }).success).toBe(false);
    expect(lectureCoreSchema.safeParse({ ...NUCLEO, eventDate: "10/09/2026" }).success).toBe(false);
  });

  it("§8 exige o detalhe quando o tipo é OUTROS", () => {
    expect(lectureCoreSchema.safeParse({ ...NUCLEO, type: "other" }).success).toBe(false);
    expect(
      lectureCoreSchema.safeParse({ ...NUCLEO, type: "other", typeOther: "Evento técnico" })
        .success,
    ).toBe(true);
  });

  it("§13 exige que o término seja ESTRITAMENTE posterior ao início", () => {
    const comHora = (startTime: string, endTime: string) =>
      lectureCoreSchema.safeParse({ ...NUCLEO, startTime, endTime }).success;

    expect(comHora("14:00", "16:00")).toBe(true);
    expect(comHora("14:00", "14:00")).toBe(false);
    expect(comHora("14:00", "13:00")).toBe(false);
  });

  it("§13 recusa término sem início", () => {
    expect(lectureCoreSchema.safeParse({ ...NUCLEO, endTime: "16:00" }).success).toBe(false);
  });

  it("§18 recusa estimativa zero ou negativa", () => {
    // O campo trafega como STRING: é o que um `<input type="number">` guarda, e
    // é o que mantém o tipo de entrada do schema igual ao de saída (sem isso o
    // resolver do React Hook Form deixa de bater com `useForm`).
    const comEstimativa = (attendeesEstimated: string) =>
      lectureCoreSchema.safeParse({ ...NUCLEO, attendeesEstimated }).success;

    expect(comEstimativa("0")).toBe(false);
    expect(comEstimativa("-1")).toBe(false);
    expect(comEstimativa("1")).toBe(true);
    expect(comEstimativa("80")).toBe(true);
    expect(comEstimativa("oitenta")).toBe(false);
    expect(comEstimativa("")).toBe(true); // vazio = não informado
  });

  it("aceita campo vazio como não informado", () => {
    const parsed = lectureCoreSchema.safeParse({
      ...NUCLEO,
      location: "",
      startTime: "",
      endTime: "",
      notes: "",
      attendeesEstimated: "",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("cadastro interno (§28, §53)", () => {
  const interno = { ...NUCLEO, status: "planned" as const, priority: "normal" as const };

  it("aceita os quatro pontos de entrada", () => {
    for (const status of LECTURE_ENTRY_STATUSES) {
      const horario = status === "confirmed" || status === "held" ? { startTime: "14:00" } : {};
      expect(
        createLectureSchema.safeParse({ ...interno, status, ...horario }).success,
        status,
      ).toBe(true);
    }
  });

  it("recusa nascer em situação que pressupõe um pedido anterior", () => {
    for (const status of ["under_review", "approved", "rejected", "cancelled"]) {
      expect(createLectureSchema.safeParse({ ...interno, status }).success, status).toBe(false);
    }
  });

  it("§53 aceita data no passado (registro histórico)", () => {
    expect(
      createLectureSchema.safeParse({
        ...interno,
        status: "held",
        eventDate: "2020-03-05",
        startTime: "09:00",
      }).success,
    ).toBe(true);
  });

  it("§13 exige horário para nascer confirmada ou realizada", () => {
    expect(scheduledNeedsTime({ status: "confirmed" })).toBe(LECTURE_NEEDS_TIME_MESSAGE);
    expect(scheduledNeedsTime({ status: "held" })).toBe(LECTURE_NEEDS_TIME_MESSAGE);
    expect(scheduledNeedsTime({ status: "confirmed", startTime: "14:00" })).toBeNull();
    expect(scheduledNeedsTime({ status: "planned" })).toBeNull();
  });

  it("a mensagem de horário é a MESMA do servidor", () => {
    // Duas mensagens para a mesma regra é como o usuário descobre que o
    // formulário e o servidor discordam.
    expect(LECTURE_NEEDS_TIME_MESSAGE).toBe(ACTION_ERROR_MESSAGES.lectureNeedsTime);
  });
});

describe("edição (§42)", () => {
  const edicao = {
    lectureId: "11111111-1111-4111-8111-111111111111",
    name: "Mercado",
    theme: "Custo",
    city: "Toledo",
    type: "company" as const,
    priority: "high" as const,
  };

  it("aceita os campos descritivos", () => {
    expect(updateLectureSchema.safeParse(edicao).success).toBe(true);
  });

  it("NÃO carrega data, horário nem situação — cada um tem a sua operação", () => {
    const parsed = updateLectureSchema.safeParse({
      ...edicao,
      eventDate: "2026-12-01",
      startTime: "10:00",
      status: "confirmed",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty("eventDate");
    expect(parsed.data).not.toHaveProperty("startTime");
    expect(parsed.data).not.toHaveProperty("status");
  });
});

describe("situação (§24, §25, §43)", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("pede motivo para rejeitar e cancelar", () => {
    expect(lectureStatusSchema.safeParse({ lectureId: id, status: "rejected" }).success).toBe(
      false,
    );
    expect(lectureStatusSchema.safeParse({ lectureId: id, status: "cancelled" }).success).toBe(
      false,
    );
    expect(
      lectureStatusSchema.safeParse({ lectureId: id, status: "rejected", reason: "fora do escopo" })
        .success,
    ).toBe(true);
  });

  it("não pede motivo para as demais transições", () => {
    expect(lectureStatusSchema.safeParse({ lectureId: id, status: "under_review" }).success).toBe(
      true,
    );
    expect(lectureStatusSchema.safeParse({ lectureId: id, status: "held" }).success).toBe(true);
  });

  it("recusa motivo curto demais para significar alguma coisa", () => {
    expect(
      lectureStatusSchema.safeParse({ lectureId: id, status: "cancelled", reason: "x" }).success,
    ).toBe(false);
  });
});

describe("reagendamento (§35, §44)", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("aceita data com e sem horário", () => {
    expect(
      rescheduleLectureSchema.safeParse({ lectureId: id, eventDate: "2026-12-01" }).success,
    ).toBe(true);
    expect(
      rescheduleLectureSchema.safeParse({
        lectureId: id,
        eventDate: "2026-12-01",
        startTime: "14:00",
        endTime: "16:00",
      }).success,
    ).toBe(true);
  });

  it("aplica a mesma regra de ordem dos horários", () => {
    expect(
      rescheduleLectureSchema.safeParse({
        lectureId: id,
        eventDate: "2026-12-01",
        startTime: "14:00",
        endTime: "14:00",
      }).success,
    ).toBe(false);
  });
});

describe("atribuições e realização (§26, §45, §46)", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("aceita atribuir e desatribuir", () => {
    expect(assignLectureSchema.safeParse({ lectureId: id, profileId: id }).success).toBe(true);
    expect(assignLectureSchema.safeParse({ lectureId: id, profileId: "" }).success).toBe(true);
    expect(assignLectureSchema.safeParse({ lectureId: id, profileId: "abc" }).success).toBe(false);
  });

  it("§52 aceita ZERO participantes na realização e recusa negativo", () => {
    expect(lectureOutcomeSchema.safeParse({ lectureId: id, attendeesActual: 0 }).success).toBe(
      true,
    );
    expect(lectureOutcomeSchema.safeParse({ lectureId: id, attendeesActual: -1 }).success).toBe(
      false,
    );
  });
});

describe("chatbot (§6, §7, §60)", () => {
  const pedido = {
    requesterName: "João da Silva",
    city: "Cascavel",
    type: "associate" as const,
    theme: "Custo de Produção",
    eventDate: "2026-12-01",
  };

  it("aceita os cinco campos obrigatórios do §7", () => {
    expect(lectureRequestSchema.safeParse(pedido).success).toBe(true);
  });

  it("exige cada um deles", () => {
    for (const campo of ["requesterName", "city", "type", "theme", "eventDate"] as const) {
      const sem = { ...pedido };
      delete (sem as Record<string, unknown>)[campo];
      expect(lectureRequestSchema.safeParse(sem).success, campo).toBe(false);
    }
  });

  it("§6 DESCARTA status, prioridade, responsável e palestrante se alguém os enviar", () => {
    const parsed = lectureRequestSchema.safeParse({
      ...pedido,
      status: "confirmed",
      priority: "urgent",
      responsibleId: "11111111-1111-4111-8111-111111111111",
      speakerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty("status");
    expect(parsed.data).not.toHaveProperty("priority");
    expect(parsed.data).not.toHaveProperty("responsibleId");
    expect(parsed.data).not.toHaveProperty("speakerId");
  });

  it("valida telefone e e-mail sem inventar regra de operadora", () => {
    expect(
      lectureRequestSchema.safeParse({ ...pedido, requesterPhone: "(45) 99999-0000" }).success,
    ).toBe(true);
    expect(lectureRequestSchema.safeParse({ ...pedido, requesterPhone: "asdf" }).success).toBe(
      false,
    );
    expect(
      lectureRequestSchema.safeParse({ ...pedido, requesterEmail: "joao@exemplo.com.br" }).success,
    ).toBe(true);
    expect(lectureRequestSchema.safeParse({ ...pedido, requesterEmail: "joao@" }).success).toBe(
      false,
    );
  });

  it("§60 valida o formato do protocolo e normaliza a caixa", () => {
    expect(lectureProtocolSchema.parse(" sol-000042 ")).toBe("SOL-000042");
    expect(lectureProtocolSchema.safeParse("SOL-42").success).toBe(false);
    expect(lectureProtocolSchema.safeParse("000042").success).toBe(false);
    // Passado SOL-999999 o número ganha um dígito — e continua válido.
    expect(lectureProtocolSchema.safeParse("SOL-1000000").success).toBe(true);
  });
});

describe("listagem e calendário (§31, §48, §49)", () => {
  it("tem padrões sensatos quando nada é informado", () => {
    const parsed = lectureQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(25);
    expect(parsed.sortField).toBe("requestedAt");
    expect(parsed.ascending).toBe(false);
    expect(parsed.status).toEqual([]);
  });

  it("§48 impede que a paginação vire um dump da tabela", () => {
    expect(lectureQuerySchema.safeParse({ pageSize: 100 }).success).toBe(true);
    expect(lectureQuerySchema.safeParse({ pageSize: 5000 }).success).toBe(false);
    expect(lectureQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  });

  it("§49 só ordena por coluna da lista fechada", () => {
    expect(lectureQuerySchema.safeParse({ sortField: "city" }).success).toBe(true);
    expect(lectureQuerySchema.safeParse({ sortField: "notes; drop table" }).success).toBe(false);
  });

  it("§31 exige um período coerente no calendário", () => {
    expect(
      lectureCalendarSchema.safeParse({ startDate: "2026-09-01", endDate: "2026-09-30" }).success,
    ).toBe(true);
    expect(
      lectureCalendarSchema.safeParse({ startDate: "2026-09-30", endDate: "2026-09-01" }).success,
    ).toBe(false);
    expect(lectureCalendarSchema.safeParse({ startDate: "2026-09-01" }).success).toBe(false);
  });
});

describe("horários de 5 em 5 minutos", () => {
  /**
   * A mesma grade de Eventos e Enquetes, na mesma função compartilhada
   * (`src/lib/time/step.ts`). Aqui se prova que Palestras a usa de verdade —
   * o `step` do campo não valida nada, porque os formulários são `noValidate`.
   */
  it("aceita o horário na grade", () => {
    expect(lectureCoreSchema.safeParse({ ...NUCLEO, startTime: "08:00" }).success).toBe(true);
    expect(lectureCoreSchema.safeParse({ ...NUCLEO, startTime: "08:45" }).success).toBe(true);
  });

  it("recusa o horário fora da grade", () => {
    expect(lectureCoreSchema.safeParse({ ...NUCLEO, startTime: "08:07" }).success).toBe(false);
    expect(
      lectureCoreSchema.safeParse({ ...NUCLEO, startTime: "08:00", endTime: "09:23" }).success,
    ).toBe(false);
  });

  /**
   * ⚠️ O REAGENDAMENTO É ONDE ISSO APARECE PARA QUEM JÁ TEM PALESTRA MARCADA.
   * O formulário de edição não mexe em data nem hora — elas saem por
   * "Reagendar" —, então é este schema que vai pedir o ajuste de uma palestra
   * antiga gravada em minuto quebrado.
   */
  it("vale também no reagendamento", () => {
    const base = { lectureId: "3f1b7c9e-2a4d-4f8b-9c1e-0d5a6b7c8e9f", eventDate: "2026-09-10" };
    expect(rescheduleLectureSchema.safeParse({ ...base, startTime: "14:30" }).success).toBe(true);
    expect(rescheduleLectureSchema.safeParse({ ...base, startTime: "14:33" }).success).toBe(false);
  });

  it("não atrapalha o horário em branco, que é opcional", () => {
    expect(lectureCoreSchema.safeParse({ ...NUCLEO, startTime: "" }).success).toBe(true);
  });
});
