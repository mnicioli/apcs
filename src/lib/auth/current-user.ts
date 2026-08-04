import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isRole, type Role } from "@/lib/rbac/rbac.types";
import { toSessionUser, type SessionUser } from "./session";

/**
 * Papel de fallback quando o caminho feliz falha — DENY-BY-DEFAULT.
 * `viewer` tem zero permissões na matriz. Se algo der errado (anônimo, perfil
 * ausente, role inválido), o RBAC falha FECHADO, nunca aberto.
 */
const FALLBACK_ROLE: Role = "viewer";

/**
 * Usuário autenticado (ou `null` se anônimo). Memoizado por request com
 * `cache()`: vários chamadores no mesmo render compartilham uma ida ao banco.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? toSessionUser(user) : null;
});

/**
 * Papel do usuário autenticado, lido de `profiles.role` (protegido por RLS).
 * Cai em `FALLBACK_ROLE` se anônimo/sem perfil/role inválido. Memoizado por request.
 */
export const getCurrentUserRole = cache(async (): Promise<Role> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return FALLBACK_ROLE;

  // `.returns<>()` é um hint de tipo necessário por causa do descompasso de
  // generics entre @supabase/ssr e @supabase/supabase-js; sem ele o `from()`
  // pode inferir `never`. Remover quando os pacotes alinharem.
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .returns<{ role: string }[]>()
    .maybeSingle();

  if (error || !data) {
    console.error(
      `[current-user] perfil não encontrado para ${user.id}: ${error?.message ?? "sem linha"}`,
    );
    return FALLBACK_ROLE;
  }

  if (!isRole(data.role)) {
    console.error(`[current-user] role inválido "${data.role}" para ${user.id} — usando fallback`);
    return FALLBACK_ROLE;
  }

  return data.role;
});
