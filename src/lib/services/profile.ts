import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isRole } from "@/lib/rbac/rbac.types";
import type { Profile } from "@/modules/profile/profile.types";

/**
 * SERVICE = leitura. Convenção: retorna o dado ou LANÇA erro (o caller decide
 * como tratar). Nunca faz escrita — isso é trabalho das actions.
 *
 * Este service é a REFERÊNCIA do padrão de leitura. Veja
 * docs/SERVICE-ACTION-PATTERN.md.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, role")
    .eq("id", user.id)
    // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
    .returns<
      {
        id: string;
        email: string;
        full_name: string | null;
        avatar_url: string | null;
        role: string;
      }[]
    >()
    .maybeSingle();

  if (error) {
    console.error(`[profile] getCurrentProfile falhou: ${error.message}`);
    throw error;
  }
  if (!data) return null;

  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    avatarUrl: data.avatar_url,
    role: isRole(data.role) ? data.role : "viewer",
  };
}
