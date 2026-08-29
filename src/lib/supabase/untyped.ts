import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O MESMO CLIENTE, SEM OS TIPOS GERADOS — uma ponte temporária.
 *
 * `src/types/database.ts` é gerado por `pnpm db:types` contra o banco, e ele
 * ainda não conhece as tabelas e funções que nasceram em
 * 20260903000100_custom_roles.sql (`app_roles`, `app_role_permissions`,
 * `app_role_ceilings`, `create_app_role`, …). Enquanto não for regenerado,
 * `supabase.from("app_roles")` não compila: o nome não está no tipo.
 *
 * ⚠️ ISTO NÃO AFROUXA NENHUMA REGRA DE ACESSO. É o mesmo cliente autenticado,
 * com os mesmos cookies, sujeito à mesma RLS. O que se perde é a conferência de
 * nome de coluna em tempo de compilação — por isso toda leitura que passa por
 * aqui declara o formato com `.returns<T>()`, que é onde o tipo volta.
 *
 * ⚠️ COMO REMOVER: rode `pnpm db:types` e troque `untyped(supabase)` por
 * `supabase` nos dois arquivos que a usam (`services/roles.ts` e
 * `actions/roles.ts`). O type-check aponta o que sobrar.
 */
export function untyped(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}
