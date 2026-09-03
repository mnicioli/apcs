import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O MESMO CLIENTE, SEM OS TIPOS GERADOS — uma ponte temporária.
 *
 * `src/types/database.ts` é gerado por `pnpm db:types` contra o banco, e ele
 * ainda não conhece as tabelas e funções que nasceram em
 * 20260917000100_flows.sql (`flows`, `flow_versions`, `flow_nodes`,
 * `flow_transitions`, `flow_runs`, `attendance_teams`, `publish_flow_version`,
 * …). Enquanto não for regenerado, `supabase.from("flows")` não compila: o nome
 * não está no tipo.
 *
 * ⚠️ ISTO NÃO AFROUXA NENHUMA REGRA DE ACESSO. É o mesmo cliente autenticado,
 * com os mesmos cookies, sujeito à mesma RLS. O que se perde é a conferência de
 * nome de coluna em tempo de compilação — por isso toda leitura que passa por
 * aqui declara o formato com `.returns<T>()`, que é onde o tipo volta.
 *
 * ⚠️ ESTE ARQUIVO JÁ EXISTIU E JÁ FOI DERRUBADO. Ele nasceu para
 * 20260903000100_custom_roles.sql e caiu em 39eb961, quando os tipos foram
 * regenerados. Voltar a criá-lo é o procedimento normal deste projeto para a
 * janela entre "a migration foi escrita" e "a migration foi aplicada" — e não
 * uma invenção deste módulo.
 *
 * ⚠️ COMO REMOVER: aplique a migration (`pnpm db:push`), rode `pnpm db:types` e
 * troque `untyped(supabase)` por `supabase` em `src/lib/services/flows.ts` e
 * `src/lib/actions/flows.ts`. O type-check aponta o que sobrar; quando não
 * sobrar nada, apague este arquivo.
 */
export function untyped(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}
