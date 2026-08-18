import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Cliente Supabase com a chave `service_role` — IGNORA RLS.
 *
 * ⚠️ Use APENAS onde não existe usuário autenticado e a autorização é feita em
 * código ou pela assinatura da função no banco. Hoje são quatro lugares, todos
 * sem sessão de usuário por natureza:
 *
 *   • `/api/chat` — o chat público: a pessoa é anônima e a conversa é
 *     identificada por um cookie httpOnly;
 *   • as portas de chatbot dos módulos (`*-chatbot.ts`) — o mesmo caso;
 *   • `/api/webhooks/whatsapp` — quem chama é o fornecedor, e a autorização é a
 *     assinatura HMAC do corpo (§18);
 *   • `/api/jobs/surveys` — quem chama é o cron, e a autorização é um segredo
 *     comparado em tempo constante.
 *
 * Nos quatro, as tabelas envolvidas NÃO têm policy de escrita para `anon`
 * justamente porque toda escrita passa por aqui — e as funções que este cliente
 * chama são estreitas de propósito: `register_survey_response` não tem
 * parâmetro capaz de mudar uma enquete, só de registrar um voto.
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
