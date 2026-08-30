"use server";

import { revalidatePath } from "next/cache";
import { fail, mapPostgresError, ok, type ActionResult } from "@/lib/actions/errors";
import { assertPermission } from "@/lib/auth/assert-permission";
import { createClient } from "@/lib/supabase/server";
import { invalidateRoleCache } from "@/lib/services/roles";
import {
  createRoleSchema,
  deleteRoleSchema,
  setUserRoleKeySchema,
  updateRoleSchema,
  type CreateRoleInput,
  type DeleteRoleInput,
  type SetUserRoleKeyInput,
  type UpdateRoleInput,
} from "@/modules/admin/role.schema";

/**
 * ACTION = escrita. SEMPRE retorna `ActionResult<T>`, NUNCA lança.
 *
 * ⚠️ TODAS AS ESCRITAS DAQUI PASSAM POR FUNÇÃO `SECURITY DEFINER` QUE CHECA
 * `is_admin()` NO BANCO. As tabelas de cargo não têm policy de escrita para
 * ninguém — nem para administrador —, então uma chamada direta ao PostgREST não
 * tem por onde entrar. O `assertPermission` abaixo é a primeira camada, e existe
 * para a pessoa ver "você não tem permissão" em vez de um erro cru.
 *
 * ⚠️ TODA ESCRITA DERRUBA O CACHE DA MATRIZ (`invalidateRoleCache`). Sem isso,
 * quem acabou de tirar uma permissão de um cargo continuaria vendo a tela antiga
 * por até quinze segundos e concluiria que o botão não funcionou. E o
 * `revalidatePath` do layout é o que redesenha o MENU: mudar um cargo muda o que
 * aparece na navegação, que é desenhada no layout e não na página.
 */

function revalidateRoles(): void {
  invalidateRoleCache();
  revalidatePath("/permissions", "page");
  revalidatePath("/users", "page");
  revalidatePath("/users/[id]", "page");
  // O menu é desenhado no layout das rotas autenticadas: sem isto, a navegação
  // de quem tem o cargo alterado continuaria mostrando o que ele não abre mais.
  revalidatePath("/", "layout");
}

export async function createRoleAction(input: CreateRoleInput): Promise<ActionResult<string>> {
  const parsed = createRoleSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<string>("users.manage");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("create_app_role", {
      p_key: parsed.data.key,
      p_label: parsed.data.label,
      p_description: parsed.data.description ?? null,
      p_base_role: parsed.data.baseRole,
      p_permissions: parsed.data.permissions,
    } as never);

    if (error) return fail(mapPostgresError(error).code);

    revalidateRoles();
    return ok(parsed.data.key);
  } catch (erro) {
    console.error("[roles.create] erro inesperado:", erro);
    return fail("unexpected");
  }
}

export async function updateRoleAction(input: UpdateRoleInput): Promise<ActionResult<null>> {
  const parsed = updateRoleSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<null>("users.manage");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_app_role", {
      p_key: parsed.data.key,
      p_label: parsed.data.label,
      p_description: parsed.data.description ?? null,
      p_permissions: parsed.data.permissions,
    } as never);

    if (error) return fail(mapPostgresError(error).code);

    revalidateRoles();
    return ok(null);
  } catch (erro) {
    console.error("[roles.update] erro inesperado:", erro);
    return fail("unexpected");
  }
}

export async function deleteRoleAction(input: DeleteRoleInput): Promise<ActionResult<null>> {
  const parsed = deleteRoleSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<null>("users.manage");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_app_role", { p_key: parsed.data.key } as never);

    if (error) return fail(mapPostgresError(error).code);

    revalidateRoles();
    return ok(null);
  } catch (erro) {
    console.error("[roles.delete] erro inesperado:", erro);
    return fail("unexpected");
  }
}

/**
 * Dá um cargo a alguém.
 *
 * ⚠️ SUBSTITUI `setUserRoleAction` NA TELA DE USUÁRIOS. Aquela troca o PAPEL do
 * enum; esta troca o CARGO, que é o que a pessoa realmente tem. O banco mantém
 * as duas colunas de acordo por trigger — ver `profiles_sync_role_key`.
 */
export async function setUserRoleKeyAction(
  input: SetUserRoleKeyInput,
): Promise<ActionResult<null>> {
  const parsed = setUserRoleKeySchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<null>("users.manage");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_user_role_key", {
      p_user_id: parsed.data.userId,
      p_role_key: parsed.data.roleKey,
    } as never);

    if (error) return fail(mapPostgresError(error).code);

    revalidateRoles();
    return ok(null);
  } catch (erro) {
    console.error("[roles.setUserRoleKey] erro inesperado:", erro);
    return fail("unexpected");
  }
}
