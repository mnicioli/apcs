import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getConversationMessages } from "@/lib/services/conversations";
import {
  attendanceReason,
  attendanceSituation,
  compareAttendances,
  matchesFilter,
  type AttendanceRuleInput,
} from "@/modules/attendance/attendance.rules";
import type {
  Attendance,
  AttendanceCounts,
  AttendanceDetail,
  AttendanceFilter,
} from "@/modules/attendance/attendance.types";
import { parseStoredCollected } from "@/modules/chat/chat.schema";
import type { ChatConversationStatus } from "@/modules/chat/chat.types";
import { nextCspSlot } from "@/modules/chat/flows/csp.flow";

/**
 * SERVICE = leitura. Retorna o dado ou LANÇA erro (o caller decide como tratar).
 *
 * Passa pelo cliente autenticado — ou seja, pela RLS de `chat_conversations`.
 * Quem não é `admin`/`ceo`/`comercial` não vê linha nenhuma, mesmo que a
 * checagem de permissão da app falhe.
 *
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 */

/**
 * Teto da leitura da fila.
 *
 * A tela lê as conversas e classifica em memória, em vez de filtrar no SQL. A
 * razão é que a classificação depende do RELÓGIO (uma conversa vira pendência
 * ao completar uma hora parada) e dos contadores de TODAS as abas — que só
 * existem se as linhas passarem por aqui de qualquer jeito.
 *
 * Com o volume de uma associação isso é uma consulta e um laço curto. Se um dia
 * passar deste teto, o certo é paginar e mover a classificação para uma view no
 * banco; até lá, isto é a solução do tamanho do problema.
 */
const LIST_LIMIT = 500;

const ATTENDANCE_COLUMNS =
  "id, status, collected, assigned_to, assigned_at, resolved_at, last_message_at, created_at, " +
  // Embutir o perfil evita uma segunda ida ao banco só para descobrir o nome de
  // quem assumiu. A FK aponta para a PK de `profiles`, então o PostgREST devolve
  // UM objeto (ou null) — não uma lista.
  "assignee:profiles!chat_conversations_assigned_to_fkey (id, full_name)";

interface AttendanceRow {
  id: string;
  status: ChatConversationStatus;
  collected: unknown;
  assigned_to: string | null;
  assigned_at: string | null;
  resolved_at: string | null;
  last_message_at: string;
  created_at: string;
  assignee: { id: string; full_name: string | null } | null;
}

function toAttendance(row: AttendanceRow, leadId: string | null, now: Date): Attendance {
  const collected = parseStoredCollected(row.collected);

  const rules: AttendanceRuleInput = {
    conversationStatus: row.status,
    hasLead: leadId !== null,
    assignedTo: row.assigned_to,
    resolvedAt: row.resolved_at,
    lastMessageAt: row.last_message_at,
  };

  return {
    id: row.id,
    conversationStatus: row.status,
    situation: attendanceSituation(rules, now),
    reason: attendanceReason(rules, now),
    contactName: collected.fullName ?? null,
    city: collected.city ?? null,
    state: collected.state ?? null,
    interest: collected.interest ?? null,
    wantsHuman: collected.wantsHuman === true,
    assignedTo: row.assignee ? { id: row.assignee.id, fullName: row.assignee.full_name } : null,
    assignedAt: row.assigned_at,
    resolvedAt: row.resolved_at,
    leadId,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  };
}

/**
 * Quais conversas já geraram lead.
 *
 * É uma consulta separada, e não um `select` embutido, de propósito: aqui
 * `chat_conversations` é o lado PAI da relação, e se o PostgREST tratar a FK
 * como um-para-muitos o campo volta como lista em vez de objeto. Uma consulta a
 * mais custa menos que um `null` silencioso em "sem lead gravado" — que é
 * justamente o alarme mais importante da fila.
 */
async function leadIdsByConversation(conversationIds: string[]): Promise<Map<string, string>> {
  if (conversationIds.length === 0) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("csp_leads")
    .select("id, conversation_id")
    .in("conversation_id", conversationIds)
    .returns<{ id: string; conversation_id: string }[]>();

  if (error) {
    console.error(`[attendances] leadIdsByConversation falhou: ${error.message}`);
    throw error;
  }

  return new Map((data ?? []).map((row) => [row.conversation_id, row.id]));
}

/** A fila, já filtrada, mais os contadores de todas as abas. */
export async function listAttendances(
  filter: AttendanceFilter,
): Promise<{ items: Attendance[]; counts: AttendanceCounts }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("chat_conversations")
    .select(ATTENDANCE_COLUMNS)
    .order("last_message_at", { ascending: false })
    .limit(LIST_LIMIT)
    // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
    .returns<AttendanceRow[]>();

  if (error) {
    console.error(`[attendances] listAttendances falhou: ${error.message}`);
    throw error;
  }

  const rows = data ?? [];
  const leadIds = await leadIdsByConversation(rows.map((row) => row.id));

  // UM relógio para a leitura inteira: classificar cada linha com um `new Date()`
  // próprio deixaria duas conversas na mesma fronteira de uma hora caírem em
  // abas diferentes, e os contadores não fechariam com a lista.
  const now = new Date();
  const all = rows.map((row) => toAttendance(row, leadIds.get(row.id) ?? null, now));

  const counts: AttendanceCounts = {
    queued: 0,
    assigned: 0,
    resolved: 0,
    all: all.length,
  };
  for (const attendance of all) {
    // `no_action` não tem aba própria — só aparece em "Todas".
    if (attendance.situation !== "no_action") counts[attendance.situation] += 1;
  }

  const items = all.filter((attendance) => matchesFilter(attendance, filter));
  items.sort(compareAttendances);

  return { items, counts };
}

/** Uma conversa aberta na Central: triagem, transcrição e estado do atendimento. */
export async function getAttendance(conversationId: string): Promise<AttendanceDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("chat_conversations")
    .select(`${ATTENDANCE_COLUMNS}, consent_given_at, internal_notes`)
    .eq("id", conversationId)
    .returns<
      (AttendanceRow & { consent_given_at: string | null; internal_notes: string | null })[]
    >()
    .maybeSingle();

  if (error) {
    console.error(`[attendances] getAttendance falhou: ${error.message}`);
    throw error;
  }
  if (!data) return null;

  const leadIds = await leadIdsByConversation([data.id]);
  const messages = await getConversationMessages(data.id);
  const collected = parseStoredCollected(data.collected);

  return {
    ...toAttendance(data, leadIds.get(data.id) ?? null, new Date()),
    collected,
    pendingSlot: nextCspSlot(collected)?.key ?? null,
    consentGivenAt: data.consent_given_at,
    internalNotes: data.internal_notes,
    messages,
  };
}
