"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/assert-permission";
import { fail, failFromPostgres, ok, type ActionResult } from "@/lib/actions/errors";
import { createClient } from "@/lib/supabase/server";
import { parseKeywords } from "@/modules/intelligence/knowledge.rules";
import {
  knowledgeCommandSchema,
  knowledgeEntryFormSchema,
  knowledgeSearchSchema,
  updateKnowledgeEntrySchema,
  type KnowledgeCommandInput,
  type KnowledgeEntryFormData,
  type KnowledgeSearchInput,
  type UpdateKnowledgeEntryInput,
} from "@/modules/intelligence/knowledge.schema";
import type { KnowledgeSearchHit } from "@/modules/intelligence/knowledge.types";
import { searchKnowledge } from "@/lib/services/knowledge";

/**
 * ACTION = escrita. Sempre `ActionResult`, nunca `throw`.
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 *
 * ⚠️ NENHUMA DESTAS FUNÇÕES ESCREVE A TRILHA DE AUDITORIA, e isso é de
 * propósito. Quem escreve é o gatilho `on_knowledge_entries_audit` no banco
 * (20260913000100_knowledge.sql, seção 6). O resto do projeto chama
 * `log_admin_action` no fim de cada função de escrita; aqui a auditoria mora na
 * FORMA do dado, e não existe caminho — tela, script, psql — que grave sem
 * passar por ela. Uma chamada aqui além do gatilho gravaria a mesma ação duas
 * vezes.
 */

const ROTA = "/knowledge";

/** O caminho de volta quando a categoria vem digitada, e não escolhida. */
type Resolucao = { ok: true; id: string } | { ok: false; erro: ActionResult<never> };

/**
 * A categoria do item: a escolhida no seletor, ou a digitada em "Nova
 * categoria…".
 *
 * ⚠️ PROCURA ANTES DE CRIAR, e depois procura DE NOVO se a criação colidir. O
 * índice único é por `name_key` (minúsculas, sem acento), então duas pessoas
 * cadastrando "Serviços" e "servicos" ao mesmo tempo produzem um 23505 na
 * segunda — que não é erro nenhum do ponto de vista de quem clicou: a categoria
 * que ela queria existe. Devolver "já existe um registro com esses dados" ali
 * seria transformar uma corrida em culpa do usuário.
 */
async function resolverCategoria(
  supabase: Awaited<ReturnType<typeof createClient>>,
  categoryId: string,
  categoryName: string,
): Promise<Resolucao> {
  if (categoryId) return { ok: true, id: categoryId };

  const nome = categoryName.trim();
  if (!nome) return { ok: false, erro: fail("invalidInput") };

  const procurar = async (): Promise<string | null> => {
    const { data, error } = await supabase
      .from("knowledge_categories")
      .select("id")
      // `ilike` sem curinga é comparação sem caixa. Não cobre acento — e não
      // precisa: o desempate final é o índice único sobre `name_key`, e o
      // segundo `procurar()` depois do 23505 é quem fecha o caso.
      .ilike("name", nome)
      // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
      .returns<{ id: string }[]>()
      .maybeSingle();

    if (error) throw error;
    return data?.id ?? null;
  };

  try {
    const existente = await procurar();
    if (existente) return { ok: true, id: existente };

    const { data, error } = await supabase
      .from("knowledge_categories")
      .insert({ name: nome } as never)
      .select("id")
      .returns<{ id: string }[]>()
      .single();

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        const concorrente = await procurar();
        if (concorrente) return { ok: true, id: concorrente };
      }
      return { ok: false, erro: failFromPostgres("knowledge.category", error, { nome }) };
    }

    return { ok: true, id: data.id };
  } catch (error) {
    return { ok: false, erro: failFromPostgres("knowledge.category", error, { nome }) };
  }
}

/** As colunas que o formulário escreve — as mesmas no insert e no update. */
function montarPayload(data: {
  title: string;
  content: string;
  keywords: string;
  status: "active" | "inactive";
  availableForChatbot: boolean;
  startsAt: string;
  endsAt: string;
}) {
  return {
    title: data.title,
    content: data.content,
    keywords: parseKeywords(data.keywords),
    status: data.status,
    available_for_chatbot: data.availableForChatbot,
    // String vazia vira `null`: uma coluna `date` não aceita "", e "sem data" é
    // o estado normal deste campo, não uma exceção.
    starts_at: data.startsAt || null,
    ends_at: data.endsAt || null,
  };
}

/**
 * O 23505 desta tabela só pode vir de um índice: `(category_id, title)`. Dizer
 * qual campo colidiu é a diferença entre corrigir o título e reler oito campos.
 */
function traduzirColisao(error: unknown, escopo: string, contexto: Record<string, unknown>) {
  const codigo = (error as { code?: string } | null)?.code;
  if (codigo === "23505") return fail("knowledgeTitleTaken");
  return failFromPostgres(escopo, error, contexto);
}

export async function createKnowledgeEntryAction(
  input: KnowledgeEntryFormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = knowledgeEntryFormSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<{ id: string }>("knowledge.write");
  if (denied) return denied;

  const supabase = await createClient();

  const categoria = await resolverCategoria(
    supabase,
    parsed.data.categoryId,
    parsed.data.categoryName,
  );
  if (!categoria.ok) return categoria.erro;

  // `created_by` NÃO vai no payload: a coluna tem `default auth.uid()` e a
  // policy de insert exige `created_by = auth.uid()`. Autoria que a aplicação
  // envia é autoria que a aplicação pode errar.
  const { data, error } = await supabase
    .from("knowledge_entries")
    .insert({ category_id: categoria.id, ...montarPayload(parsed.data) } as never)
    .select("id")
    .returns<{ id: string }[]>()
    .single();

  if (error) return traduzirColisao(error, "knowledge.create", { categoria: categoria.id });

  revalidatePath(ROTA);
  return ok({ id: data.id });
}

export async function updateKnowledgeEntryAction(
  input: UpdateKnowledgeEntryInput,
): Promise<ActionResult<null>> {
  const parsed = updateKnowledgeEntrySchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<null>("knowledge.write");
  if (denied) return denied;

  const supabase = await createClient();

  const categoria = await resolverCategoria(
    supabase,
    parsed.data.data.categoryId,
    parsed.data.data.categoryName,
  );
  if (!categoria.ok) return categoria.erro;

  const { error } = await supabase
    .from("knowledge_entries")
    .update({ category_id: categoria.id, ...montarPayload(parsed.data.data) } as never)
    .eq("id", parsed.data.id);

  if (error) return traduzirColisao(error, "knowledge.update", { id: parsed.data.id });

  revalidatePath(ROTA);
  revalidatePath(`${ROTA}/${parsed.data.id}/edit`);
  return ok(null);
}

/**
 * Ativar e inativar.
 *
 * ⚠️ ESCREVE SÓ `status`, E ISSO NÃO É ECONOMIA. A trilha distingue
 * `knowledge_activated` de `knowledge_updated` olhando se o status mudou (o
 * gatilho da seção 6). Uma action que reenviasse o item inteiro junto faria
 * toda ativação parecer também uma edição — e "desde quando o bot passou a
 * dizer isso?" deixaria de ser respondível filtrando a trilha.
 */
export async function setKnowledgeStatusAction(
  input: KnowledgeCommandInput,
): Promise<ActionResult<null>> {
  const parsed = knowledgeCommandSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<null>("knowledge.write");
  if (denied) return denied;

  const supabase = await createClient();

  const { error } = await supabase
    .from("knowledge_entries")
    .update({ status: parsed.data.command === "activate" ? "active" : "inactive" } as never)
    .eq("id", parsed.data.id);

  if (error) {
    return failFromPostgres("knowledge.status", error, {
      id: parsed.data.id,
      comando: parsed.data.command,
    });
  }

  revalidatePath(ROTA);
  return ok(null);
}

/**
 * A busca de teste da tela.
 *
 * ⚠️ É UMA LEITURA NUMA ACTION, e o motivo é que ela acontece por clique, não
 * por navegação — o painel de teste roda no cliente. `documents.ts` já faz o
 * mesmo com a URL assinada. A permissão continua sendo checada aqui, e a
 * consulta continua passando pela mesma função que o robô usa.
 */
export async function searchKnowledgeAction(
  input: KnowledgeSearchInput,
): Promise<ActionResult<KnowledgeSearchHit[]>> {
  const parsed = knowledgeSearchSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<KnowledgeSearchHit[]>("knowledge.read");
  if (denied) return denied;

  try {
    return ok(await searchKnowledge(parsed.data.query));
  } catch (error) {
    return failFromPostgres("knowledge.search", error, {});
  }
}
