import type {
  ChatConversationStatus,
  ChatMessage,
  CspCollected,
  CspInterest,
} from "@/modules/chat/chat.types";
import type { CspSlotKey } from "@/modules/chat/flows/csp.flow";

/**
 * Tipos da Central de Atendimento — a camada HUMANA sobre as conversas do chat.
 *
 * Duas dimensões independentes convivem aqui, e confundi-las é o erro fácil:
 *
 *   `conversationStatus`  o que o BOT fez com a conversa (enum do banco)
 *   `situation`           o que uma PESSOA fez com ela (derivado, nunca gravado)
 *
 * A situação é sempre CALCULADA a partir de `assigned_to`/`resolved_at` e do
 * status da conversa (ver `attendance.rules.ts`). Gravá-la criaria uma segunda
 * fonte da verdade que sairia de sincronia na primeira conversa que o visitante
 * retomasse sozinho.
 */

/** Situação do atendimento humano. Mutuamente exclusivas e exaustivas. */
export const ATTENDANCE_SITUATIONS = [
  "queued", // precisa de gente e ninguém assumiu
  "assigned", // alguém assumiu
  "resolved", // uma pessoa encerrou
  "no_action", // não pede atendimento humano (virou lead, ou recusou o consentimento)
] as const;
export type AttendanceSituation = (typeof ATTENDANCE_SITUATIONS)[number];

/**
 * Por que a conversa está na fila. É o que diz ao operador o que fazer antes de
 * ele abrir o atendimento.
 *
 * A ORDEM DA LISTA É A PRIORIDADE na fila. `lead_failed` vem primeiro porque é
 * o único caso em que a pessoa foi avisada de que o time retornaria e o contato
 * não existe em nenhum outro lugar do sistema — ninguém vai encontrá-la se esta
 * tela não mostrar.
 */
export const ATTENDANCE_REASONS = [
  "lead_failed", // encaminhada sem lead gravado — o contato só existe aqui
  "handoff", // a pessoa pediu para falar com alguém do time
  "abandoned", // bateu o limite de mensagens do canal público
  "stalled", // parou no meio da triagem e não voltou
] as const;
export type AttendanceReason = (typeof ATTENDANCE_REASONS)[number];

/** Abas da fila. `all` existe para auditoria, não para trabalho do dia. */
export const ATTENDANCE_FILTERS = ["queued", "assigned", "resolved", "all"] as const;
export type AttendanceFilter = (typeof ATTENDANCE_FILTERS)[number];

export const DEFAULT_ATTENDANCE_FILTER: AttendanceFilter = "queued";

export function isAttendanceFilter(value: string): value is AttendanceFilter {
  return (ATTENDANCE_FILTERS as readonly string[]).includes(value);
}

/** Quem assumiu o atendimento. */
export interface AttendanceAssignee {
  id: string;
  fullName: string | null;
}

/** Uma conversa na lista da Central. */
export interface Attendance {
  /** É o id da CONVERSA — o atendimento não tem tabela própria. */
  id: string;
  conversationStatus: ChatConversationStatus;
  situation: AttendanceSituation;
  reason: AttendanceReason | null;
  /** Dados de triagem que a pessoa chegou a informar (pode estar vazio). */
  contactName: string | null;
  city: string | null;
  state: string | null;
  interest: CspInterest | null;
  wantsHuman: boolean;
  assignedTo: AttendanceAssignee | null;
  assignedAt: string | null;
  resolvedAt: string | null;
  /** Lead gerado por esta conversa, quando a triagem fechou. */
  leadId: string | null;
  lastMessageAt: string;
  createdAt: string;
}

/** A conversa aberta: tudo da lista + o que só faz sentido na tela de detalhe. */
export interface AttendanceDetail extends Attendance {
  collected: CspCollected;
  /** Onde a triagem parou. `null` = terminou. */
  pendingSlot: CspSlotKey | null;
  consentGivenAt: string | null;
  internalNotes: string | null;
  messages: ChatMessage[];
}

/** Contadores das abas — calculados na mesma leitura que monta a lista. */
export type AttendanceCounts = Record<AttendanceFilter, number>;
