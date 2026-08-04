import "server-only";
import { hasPermission } from "@/lib/rbac/rbac.config";
import type { Permission } from "@/lib/rbac/rbac.types";
import { fail, type ActionResult } from "@/lib/actions/errors";
import { getCurrentUserRole } from "./current-user";

/**
 * Guard de permissão para Server Actions (defesa em profundidade).
 *
 * Chame no INÍCIO de toda action de escrita, ANTES de tocar no banco:
 *
 *   const denied = await assertPermission<MyResult>("clients.write");
 *   if (denied) return denied;
 *
 * Retorna `null` se autorizado, ou um `ActionResult` `forbidden` para o caller
 * devolver direto (sem throw — o contrato das actions é sempre ActionResult).
 *
 * Por que existe, se já temos RLS? Porque a matriz da app pode ser mais
 * restrita que a policy do banco, e queremos negar cedo com mensagem clara.
 */
export async function assertPermission<T>(permission: Permission): Promise<ActionResult<T> | null> {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, permission)) return fail("forbidden");
  return null;
}
