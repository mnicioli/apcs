"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertPermission } from "@/lib/auth/assert-permission";
import { fail, mapPostgresError, ok, type ActionResult } from "@/lib/actions/errors";
import { leadStatusFormSchema, type LeadStatusFormData } from "@/modules/chat/chat.schema";

/**
 * ACTION = escrita. SEMPRE retorna `ActionResult<T>`, NUNCA lança.
 *
 * Ordem obrigatória: validar → autorizar → escrever → mapear erro → revalidar.
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 */
export async function updateLeadStatusAction(
  leadId: string,
  input: LeadStatusFormData,
): Promise<ActionResult<{ id: string }>> {
  // 1. Validação (mesmo schema do client — defesa em profundidade).
  if (!z.string().uuid().safeParse(leadId).success) return fail("invalidInput");

  const parsed = leadStatusFormSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  // 2. Autorização na app. A RLS de `csp_leads` é a segunda camada.
  const denied = await assertPermission<{ id: string }>("leads.write");
  if (denied) return denied;

  // 3. Escrita. (`as never`: workaround do generic ssr/supabase-js — ver CONVENTIONS.md.)
  const supabase = await createClient();
  const { error } = await supabase
    .from("csp_leads")
    .update({
      status: parsed.data.status,
      notes: parsed.data.notes ? parsed.data.notes : null,
    } as never)
    .eq("id", leadId);

  // 4. Mapeia o erro do banco para um código estável (sem vazar mensagem crua).
  if (error) {
    console.error(`[leads.updateStatus] falhou para ${leadId}: ${error.message}`);
    return { ok: false, error: mapPostgresError(error) };
  }

  // 5. Revalida as rotas que mostram o dado.
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  return ok({ id: leadId });
}
