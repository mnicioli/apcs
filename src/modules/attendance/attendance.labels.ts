import { STALLED_AFTER_MINUTES } from "./attendance.rules";
import type { AttendanceFilter, AttendanceReason, AttendanceSituation } from "./attendance.types";

/** Rótulos PT-BR da Central de Atendimento. */

export const ATTENDANCE_SITUATION_LABELS: Record<AttendanceSituation, string> = {
  queued: "Na fila",
  assigned: "Em atendimento",
  resolved: "Concluído",
  no_action: "Sem pendência",
};

export const ATTENDANCE_FILTER_LABELS: Record<AttendanceFilter, string> = {
  queued: "Na fila",
  assigned: "Em atendimento",
  resolved: "Concluídos",
  all: "Todas",
};

export const ATTENDANCE_REASON_LABELS: Record<AttendanceReason, string> = {
  lead_failed: "Sem lead gravado",
  handoff: "Pediu atendimento",
  abandoned: "Interrompida pelo limite",
  stalled: "Parou no meio",
};

/**
 * O que fazer com cada motivo. O rótulo cabe num selo; a frase é o que evita
 * que a pessoa precise ler a transcrição inteira para descobrir o que houve.
 */
export const ATTENDANCE_REASON_HINTS: Record<AttendanceReason, string> = {
  lead_failed:
    "A conversa foi encaminhada, mas o lead não chegou a ser gravado. " +
    "Os dados informados estão na transcrição — vale registrar o contato à mão.",
  handoff: "A pessoa pediu para falar com alguém da APCS e está esperando retorno.",
  abandoned: "A conversa atingiu o limite de mensagens do chat público e foi encerrada.",
  stalled: `A triagem começou e parou. Sem resposta há mais de ${STALLED_AFTER_MINUTES} minutos.`,
};
