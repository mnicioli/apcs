"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fail, mapPostgresError, ok, type ActionResult } from "@/lib/actions/errors";
import { profileFormSchema, type ProfileFormData } from "@/modules/profile/profile.schema";

/**
 * ACTION = escrita. Convenção: SEMPRE retorna `ActionResult<T>`, NUNCA lança.
 *
 * Esta action é a REFERÊNCIA do padrão de escrita. A ordem dos passos
 * (validar → autenticar → escrever → mapear erro → revalidar) deve ser
 * repetida em toda action. Veja docs/SERVICE-ACTION-PATTERN.md.
 */
export async function updateProfileAction(
  input: ProfileFormData,
): Promise<ActionResult<{ id: string }>> {
  // 1. Validação (mesmo schema do client — defesa em profundidade).
  const parsed = profileFormSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  // 2. Autenticação.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("forbidden");

  // 3. Escrita. (`as never`: workaround do generic ssr/supabase-js — ver CONVENTIONS.md.)
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName } as never)
    .eq("id", user.id);

  // 4. Mapeia o erro do banco para um código estável (sem vazar mensagem crua).
  if (error) {
    console.error(`[profile.update] falhou para ${user.id}: ${error.message}`);
    return { ok: false, error: mapPostgresError(error) };
  }

  // 5. Revalida a rota para a UI refletir o dado novo.
  revalidatePath("/profile");
  return ok({ id: user.id });
}
