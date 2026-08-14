import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isRole, type Role } from "@/lib/rbac/rbac.types";
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

/** Uma pessoa do time, no mínimo que um seletor precisa. */
export interface DirectoryEntry {
  id: string;
  fullName: string | null;
  email: string;
  role: Role;
}

/**
 * Teto do diretório. Acima disto o seletor deixa de ser uma lista e vira uma
 * busca — e é por isso que `searchDirectory` recebe um termo.
 */
const DIRECTORY_LIMIT = 50;

/**
 * O DIRETÓRIO INTERNO — quem pode ser responsável ou palestrante.
 *
 * ⚠️ Depende da policy `profiles_select_directory`, criada na migration de
 * Palestras (20260816000000). Antes dela, um Gestor só enxergava o próprio
 * perfil e ficaria sem lista para escolher. Ver docs/PALESTRAS.md §11.
 *
 * `viewer` fica de fora: é o papel de entrada, de quem ainda não foi promovido,
 * e não faz sentido atribuir a responsabilidade de uma palestra a alguém que nem
 * consegue abri-la.
 *
 * O termo é PARÂMETRO e a busca acontece no banco (§41): carregar todos os
 * usuários para filtrar no navegador funciona com dez pessoas e para de
 * funcionar sem avisar quando forem duzentas.
 */
export async function searchDirectory(term = ""): Promise<DirectoryEntry[]> {
  const supabase = await createClient();

  let query = supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .neq("role", "viewer")
    .order("full_name", { ascending: true, nullsFirst: false })
    .limit(DIRECTORY_LIMIT);

  const busca = term.trim();
  if (busca) {
    // `%` e `_` são curingas do `like`; escapá-los impede que uma busca por
    // "100%" vire "qualquer coisa que comece com 100".
    const padrao = `%${busca.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    query = query.or(`full_name.ilike.${padrao},email.ilike.${padrao}`);
  }

  const { data, error } =
    await query.returns<{ id: string; full_name: string | null; email: string; role: string }[]>();

  if (error) {
    console.error(`[profile] searchDirectory falhou: ${error.message}`);
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: isRole(row.role) ? row.role : "viewer",
  }));
}
