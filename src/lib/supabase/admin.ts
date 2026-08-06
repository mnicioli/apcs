import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Cliente Supabase com a chave `service_role` — IGNORA RLS.
 *
 * ⚠️ Use APENAS onde não existe usuário autenticado e a autorização é feita em
 * código. Hoje isso significa exatamente um lugar: o chat público
 * (`/api/chat`), onde a pessoa é anônima e a conversa é identificada por um
 * cookie httpOnly. As tabelas do chat não têm policy de escrita para `anon`
 * justamente porque toda escrita passa por aqui.
 *
 * Regras inegociáveis:
 * - `server-only`: importar isto de um Client Component quebra o build.
 * - A chave NUNCA pode virar `NEXT_PUBLIC_*`.
 * - Para qualquer leitura/escrita em nome de um usuário logado, use
 *   `@/lib/supabase/server` (que respeita RLS).
 */
type AdminClient = ReturnType<typeof createSupabaseClient<Database>>;

// Reaproveitado entre requisições: não há sessão de usuário para vazar de uma
// para outra (a chave é fixa e não guarda estado de auth).
let cachedClient: AdminClient | null = null;

export function createAdminClient(): AdminClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase admin indisponível: defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local.",
    );
  }

  cachedClient = createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}
