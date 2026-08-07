"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertPermission } from "@/lib/auth/assert-permission";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fail, mapPostgresError, ok, type ActionResult } from "@/lib/actions/errors";
import {
  attendanceCommandSchema,
  attendanceNotesFormSchema,
  type AttendanceCommandInput,
  type AttendanceNotesFormData,
} from "@/modules/attendance/attendance.schema";

/**
 * ACTION = escrita. SEMPRE retorna `ActionResult<T>`, NUNCA lança.
 *
 * Ordem obrigatória: validar → autorizar → escrever → mapear erro → revalidar.
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 *
 * As duas actions daqui só encostam em `assigned_to`, `assigned_at`,
 * `resolved_at` e `internal_notes` — e o banco impõe isso, porque a migration
 * do módulo concedeu UPDATE apenas nessas colunas. O status da conversa
 * continua sendo decisão exclusiva do motor do chat.
 */

type AttendanceUpdate = Record<string, string | null>;

/** Aplica o patch e devolve o id — ou `notFound` se nada foi atualizado. */
async function applyPatch(
  conversationId: string,
  patch: AttendanceUpdate,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();

  // O `select` depois do update não é enfeite: um UPDATE que não casa com
  // nenhuma linha (id inexistente, RLS barrando) NÃO devolve erro no
  // PostgREST. Sem ler de volta, a tela diria "salvo" sem ter salvado nada.
  // (`as never`: workaround do generic ssr/supabase-js — ver CONVENTIONS.md.)
  const { data, error } = await supabase
    .from("chat_conversations")
    .update(patch as never)
    .eq("id", conversationId)
    .select("id")
    .returns<{ id: string }[]>()
    .maybeSingle();

  if (error) {
    console.error(`[attendances] update falhou para ${conversationId}: ${error.message}`);
    return { ok: false, error: mapPostgresError(error) };
  }
  if (!data) return fail("notFound");

  revalidatePath("/attendances");
  revalidatePath(`/attendances/${conversationId}`);
  return ok({ id: conversationId });
}

/** Assumir, liberar, concluir ou reabrir o atendimento humano da conversa. */
export async function setAttendanceStateAction(
  conversationId: string,
  input: AttendanceCommandInput,
): Promise<ActionResult<{ id: string }>> {
  // 1. Validação (mesmo schema do client — defesa em profundidade).
  if (!z.string().uuid().safeParse(conversationId).success) return fail("invalidInput");

  const parsed = attendanceCommandSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  // 2. Autorização na app. A policy de `chat_conversations` é a segunda camada.
  const denied = await assertPermission<{ id: string }>("attendances.write");
  if (denied) return denied;

  const user = await getCurrentUser();
  if (!user) return fail("forbidden");

  const now = new Date().toISOString();

  switch (parsed.data.command) {
    case "assign":
      return applyPatch(conversationId, { assigned_to: user.id, assigned_at: now });

    case "release":
      return applyPatch(conversationId, { assigned_to: null, assigned_at: null });

    case "reopen":
      return applyPatch(conversationId, { resolved_at: null });

    case "resolve":
      return resolveAttendance(conversationId, user.id, now);
  }
}

/**
 * Concluir também carimba o dono quando ninguém tinha assumido.
 *
 * Sem isso, o caminho mais comum — abrir, resolver na hora, fechar — deixaria
 * `assigned_to` nulo, e a fila não saberia responder "quem atendeu?" justamente
 * nos atendimentos que deram certo.
 */
async function resolveAttendance(
  conversationId: string,
  userId: string,
  now: string,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();

  const { data: current, error } = await supabase
    .from("chat_conversations")
    .select("assigned_to")
    .eq("id", conversationId)
    .returns<{ assigned_to: string | null }[]>()
    .maybeSingle();

  if (error) {
    console.error(`[attendances] leitura antes de concluir falhou: ${error.message}`);
    return { ok: false, error: mapPostgresError(error) };
  }
  if (!current) return fail("notFound");

  return applyPatch(
    conversationId,
    current.assigned_to
      ? { resolved_at: now }
      : { resolved_at: now, assigned_to: userId, assigned_at: now },
  );
}

/** Anotação interna do time sobre o atendimento. */
export async function saveAttendanceNotesAction(
  conversationId: string,
  input: AttendanceNotesFormData,
): Promise<ActionResult<{ id: string }>> {
  if (!z.string().uuid().safeParse(conversationId).success) return fail("invalidInput");

  const parsed = attendanceNotesFormSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<{ id: string }>("attendances.write");
  if (denied) return denied;

  // Campo esvaziado vira `null`, e não string vazia: a diferença entre "não há
  // anotação" e "há uma anotação em branco" não interessa a ninguém.
  return applyPatch(conversationId, {
    internal_notes: parsed.data.internalNotes ? parsed.data.internalNotes : null,
  });
}
