import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  compareKnowledgeEntries,
  matchesKnowledgeFilters,
} from "@/modules/intelligence/knowledge.rules";
import type {
  KnowledgeCategory,
  KnowledgeEntry,
  KnowledgeFilters,
  KnowledgeSearchHit,
  KnowledgeStatus,
} from "@/modules/intelligence/knowledge.types";

/**
 * SERVICE = leitura. Retorna o dado ou LANÇA erro (o caller decide como tratar).
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 *
 * ⚠️ ESTE ARQUIVO É A PORTA DO CRM, NÃO A DO CHATBOT. Ele usa o cliente
 * AUTENTICADO: cada consulta passa pela RLS de `knowledge_entries`, e quem não
 * tem `knowledge.read` não lê nada por aqui.
 *
 * A porta do chatbot é outra e mora no banco: `search_knowledge()`, que é
 * `security definer` porque o bot é anônimo. Ela é a única coisa que aplica o
 * §43 do escopo (ATIVO + disponível + vigência) — e a razão de ser uma só é a
 * de sempre: duas consultas com a mesma regra divergem no dia em que a regra
 * mudar. `searchKnowledge` abaixo chama exatamente essa função, para a tela de
 * teste responder o mesmo que o robô responderia.
 */

/**
 * Teto da leitura da grid.
 *
 * A tela lê tudo e filtra em memória, como Documentos, e pelo mesmo motivo: a
 * busca por texto usa `normalizeForSearch`, e `ilike` no Postgres é sensível a
 * acento — ninguém digita "horário" com acento numa caixa de busca.
 *
 * Com o volume de uma base de conhecimento de associação (dezenas de itens),
 * isso é uma consulta e um laço curto. Se passar deste teto, o caminho é
 * paginar e mover a busca para uma coluna normalizada com índice.
 */
const LIST_LIMIT = 300;

/**
 * ⚠️ `created_by` e `updated_by` são DUAS chaves estrangeiras para `profiles`
 * nesta tabela. Sem apontar a constraint, o PostgREST não sabe qual seguir e
 * devolve PGRST201 (ambiguidade) — não um resultado errado, um erro.
 */
const ENTRY_COLUMNS =
  "id, category_id, title, content, keywords, status, available_for_chatbot, " +
  "starts_at, ends_at, created_at, updated_at, " +
  "category:knowledge_categories (id, name), " +
  "author:profiles!knowledge_entries_created_by_fkey (id, full_name), " +
  "editor:profiles!knowledge_entries_updated_by_fkey (id, full_name)";

interface ProfileRef {
  id: string;
  full_name: string | null;
}

interface EntryRow {
  id: string;
  category_id: string;
  title: string;
  content: string;
  keywords: string[] | null;
  status: KnowledgeStatus;
  available_for_chatbot: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
  category: { id: string; name: string } | null;
  author: ProfileRef | null;
  editor: ProfileRef | null;
}

function toActor(row: ProfileRef | null) {
  return row ? { id: row.id, fullName: row.full_name } : null;
}

function toEntry(row: EntryRow): KnowledgeEntry {
  return {
    id: row.id,
    categoryId: row.category_id,
    // A categoria é `not null` com `on delete restrict`, então o embed sempre
    // vem. O fallback existe para o tipo, não para um estado que possa ocorrer.
    categoryName: row.category?.name ?? "—",
    title: row.title,
    content: row.content,
    keywords: row.keywords ?? [],
    status: row.status,
    availableForChatbot: row.available_for_chatbot,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdBy: toActor(row.author),
    createdAt: row.created_at,
    updatedBy: toActor(row.editor),
    updatedAt: row.updated_at,
  };
}

/** O catálogo inteiro — inclusive as categorias desativadas. */
export async function listKnowledgeCategories(): Promise<KnowledgeCategory[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("knowledge_categories")
    .select("id, name, active")
    .order("name")
    // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
    .returns<{ id: string; name: string; active: boolean }[]>();

  if (error) {
    console.error(`[knowledge] listKnowledgeCategories falhou: ${error.message}`);
    throw error;
  }

  return data ?? [];
}

/** A grid, já filtrada e em ordem alfabética. */
export async function listKnowledgeEntries(filters: KnowledgeFilters): Promise<KnowledgeEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("knowledge_entries")
    .select(ENTRY_COLUMNS)
    .limit(LIST_LIMIT)
    .returns<EntryRow[]>();

  if (error) {
    console.error(`[knowledge] listKnowledgeEntries falhou: ${error.message}`);
    throw error;
  }

  return (data ?? [])
    .map(toEntry)
    .filter((entry) => matchesKnowledgeFilters(entry, filters))
    .sort(compareKnowledgeEntries);
}

/** Um item, para a tela de edição. `null` quando não existe (ou a RLS barrou). */
export async function getKnowledgeEntry(id: string): Promise<KnowledgeEntry | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("knowledge_entries")
    .select(ENTRY_COLUMNS)
    .eq("id", id)
    .returns<EntryRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[knowledge] getKnowledgeEntry falhou: ${error.message}`);
    throw error;
  }

  return data ? toEntry(data) : null;
}

/**
 * O que o chatbot encontraria com esta mensagem.
 *
 * ⚠️ CHAMA A MESMA FUNÇÃO QUE O ROBÔ VAI CHAMAR, e é isso que dá valor à tela.
 * Uma busca reimplementada aqui em TypeScript responderia sobre um sistema
 * parecido com o que está no ar, e a diferença apareceria como "testei e
 * funcionava" — o pior resultado possível para uma tela de teste.
 */
export async function searchKnowledge(query: string, limit = 3): Promise<KnowledgeSearchHit[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("search_knowledge", { p_query: query, p_limit: limit } as never)
    .returns<{ id: string; title: string; content: string; category: string; score: number }[]>();

  if (error) {
    console.error(`[knowledge] searchKnowledge falhou: ${error.message}`);
    throw error;
  }

  return data ?? [];
}
