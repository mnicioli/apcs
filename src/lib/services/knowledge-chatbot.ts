import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { KnowledgeSearchHit } from "@/modules/intelligence/knowledge.types";

/**
 * A PORTA DO CHATBOT PARA A BASE DE CONHECIMENTO — a única.
 *
 * ⚠️ ARQUIVO SEPARADO DE `knowledge.ts`, e é a lição de `document-chatbot.ts`
 * aplicada antes de doer. Aquele service atende o CRM e usa o cliente do
 * USUÁRIO, com a RLS valendo. Este atende o robô, que é ANÔNIMO, e usa
 * `service_role`. Um arquivo com os dois clientes é um arquivo em que a próxima
 * função vai usar o errado — e o erro não dá exceção, dá resposta vazia.
 *
 * ⚠️ A REGRA DO §43 NÃO ESTÁ AQUI. Ela está no `where` de `search_knowledge()`,
 * que é `security definer` — ATIVO + disponível para o chatbot + dentro da
 * vigência. Este arquivo não tem como relaxar o filtro nem por engano: não
 * existe parâmetro para isso.
 *
 * ⚠️ E É A MESMA FUNÇÃO QUE A TELA DE TESTE CHAMA (`/knowledge`, painel "Testar
 * o que o chatbot encontraria"). É o que faz aquele teste valer alguma coisa:
 * se fossem duas buscas, ela responderia sobre um sistema parecido com o que
 * está no ar.
 */

/** Quantos itens trazer. O robô responde com o primeiro; o resto é diagnóstico. */
const DEFAULT_LIMIT = 3;

export async function searchKnowledgeForChatbot(
  query: string,
  limit = DEFAULT_LIMIT,
): Promise<KnowledgeSearchHit[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .rpc("search_knowledge", { p_query: query, p_limit: limit })
    // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
    .returns<KnowledgeSearchHit[]>();

  if (error) {
    console.error(`[knowledge-chatbot] searchKnowledgeForChatbot falhou: ${error.message}`);
    throw error;
  }

  return data ?? [];
}
