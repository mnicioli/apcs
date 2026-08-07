import type { ChatConversationStatus } from "@/modules/chat/chat.types";
import {
  ATTENDANCE_REASONS,
  type Attendance,
  type AttendanceFilter,
  type AttendanceReason,
  type AttendanceSituation,
} from "./attendance.types";

/**
 * REGRAS DA FILA — puras, sem I/O, sem banco.
 *
 * Ficam separadas do service de propósito: decidir o que precisa de gente é a
 * única lógica de verdade deste módulo, e é a única coisa que dá para testar
 * sem subir Postgres.
 */

/**
 * Quanto tempo uma conversa em andamento precisa ficar parada para virar
 * pendência.
 *
 * Uma hora, e não alguns minutos, porque a conversa acontece no ritmo de quem
 * está do outro lado: a pessoa atende o telefone, vai ao galpão e volta. Ligar
 * para alguém que parou de digitar há dez minutos é atropelo. E o custo do
 * limite alto é zero: se ela voltar sozinha, `last_message_at` avança e a
 * conversa sai da fila sem ninguém fazer nada.
 */
export const STALLED_AFTER_MINUTES = 60;

/** O mínimo que as regras precisam saber sobre uma conversa. */
export interface AttendanceRuleInput {
  conversationStatus: ChatConversationStatus;
  /** A triagem gerou um lead? */
  hasLead: boolean;
  assignedTo: string | null;
  resolvedAt: string | null;
  lastMessageAt: string;
}

function minutesSince(isoDate: string, now: Date): number {
  const date = new Date(isoDate);
  // Data ilegível não pode fabricar pendência: devolver 0 mantém a conversa
  // fora da fila até que alguém olhe o dado.
  if (Number.isNaN(date.getTime())) return 0;
  return (now.getTime() - date.getTime()) / 60_000;
}

/**
 * Por que esta conversa precisa de uma pessoa — ou `null` se não precisa.
 *
 * `completed` não entra: a triagem fechou, o lead existe e o acompanhamento
 * comercial é em /leads. `declined` também não: sem consentimento não há dado
 * nem base legal para procurar ninguém.
 */
export function attendanceReason(
  input: AttendanceRuleInput,
  now: Date = new Date(),
): AttendanceReason | null {
  if (input.resolvedAt) return null;

  switch (input.conversationStatus) {
    case "handoff":
      // O motor marca `handoff` em dois casos: a pessoa pediu atendimento (e aí
      // o lead foi gravado) ou a gravação do lead falhou. A ausência do lead é
      // o que distingue os dois — e o segundo é mais urgente.
      return input.hasLead ? "handoff" : "lead_failed";
    case "abandoned":
      return "abandoned";
    case "active":
      return minutesSince(input.lastMessageAt, now) >= STALLED_AFTER_MINUTES ? "stalled" : null;
    case "completed":
    case "declined":
      return null;
  }
}

/** Em qual aba da Central esta conversa aparece. */
export function attendanceSituation(
  input: AttendanceRuleInput,
  now: Date = new Date(),
): AttendanceSituation {
  if (input.resolvedAt) return "resolved";
  if (input.assignedTo) return "assigned";
  return attendanceReason(input, now) ? "queued" : "no_action";
}

/** A aba `all` não filtra nada — ela é a visão de auditoria. */
export function matchesFilter(attendance: Attendance, filter: AttendanceFilter): boolean {
  return filter === "all" || attendance.situation === filter;
}

/**
 * Ordem de exibição: primeiro o que é mais urgente, depois o mais recente.
 *
 * Fora da fila (`reason` nulo) a urgência não existe e sobra só a recência —
 * por isso a prioridade de quem não tem motivo é a pior possível, e não a
 * melhor, que é o que `indexOf` devolveria para um valor ausente.
 */
export function compareAttendances(a: Attendance, b: Attendance): number {
  const priority = reasonPriority(a.reason) - reasonPriority(b.reason);
  if (priority !== 0) return priority;
  return b.lastMessageAt.localeCompare(a.lastMessageAt);
}

function reasonPriority(reason: AttendanceReason | null): number {
  return reason ? ATTENDANCE_REASONS.indexOf(reason) : ATTENDANCE_REASONS.length;
}
