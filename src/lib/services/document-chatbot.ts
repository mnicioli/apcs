import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DOCUMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/documents/storage";
import type { DocumentCategory, DocumentChatbotView } from "@/modules/document/document.types";

/**
 * A PORTA DO CHATBOT PARA NORMATIVAS E COMUNICAÇÃO — a única.
 *
 * A regra oficial de disponibilidade, e nenhuma condição a menos:
 *
 *   1. a versão é a ATIVA          (`status = 'active'`)
 *   2. está liberada para o robô   (`available_for_chatbot = true`)
 *
 * ⚠️ `null` NÃO SIGNIFICA "USE A ANTERIOR". Significa que não há documento
 * oficial publicado agora, e o atendimento deve ser encaminhado para uma
 * pessoa. Não existe caminho aqui que devolva "a mais recente" quando a atual
 * não serve: citar uma normativa revogada é pior do que "não tenho essa
 * informação".
 *
 * ----------------------------------------------------------------------------
 * ⚠️ ARQUIVO PRÓPRIO, E ELE NASCEU DE UM DEFEITO
 * ----------------------------------------------------------------------------
 * Estas duas funções moravam em `documents.ts`, o service do CRM, e usavam o
 * cliente do USUÁRIO. Quem chama é o robô, que é ANÔNIMO: sem `auth.uid()`, sem
 * papel, e a RLS de `document_versions` exige papel autenticado.
 *
 * Ou seja: ligadas como estavam, devolveriam vazio SEMPRE — e o sintoma seria o
 * pior possível, o bot dizendo "não encontrei essa normativa" com a normativa
 * publicada e ativa na tela ao lado.
 *
 * Saíram de lá também porque um service não deve misturar os dois clientes.
 * `documents.ts` responde ao CRM com a RLS valendo; este responde ao robô com
 * `service_role`. Um arquivo que faz as duas coisas é um arquivo em que a
 * próxima função vai usar o cliente errado — e o erro é silencioso.
 *
 * É a mesma separação que Bolsa, Eventos, Palestras e Enquetes já tinham.
 *
 * ⚠️ O QUE AUTORIZA O `service_role` NÃO É ESTE COMENTÁRIO: é o fato de aqui só
 * existir LEITURA, e só de linhas que passam pelas duas condições acima. Não há
 * escrita, nem parâmetro que relaxe o filtro.
 */

/**
 * ⚠️ `storage_path` É LIDO AQUI E NUNCA SAI DAQUI. Ele vira uma URL assinada
 * antes de a função retornar — é por isso que `DocumentVersion` (o tipo do CRM)
 * não tem esse campo, e é por isso que este arquivo não usa aquele tipo.
 */
const CHATBOT_COLUMNS =
  "document_id, version, effective_date, storage_path, original_filename, " +
  "document:documents!inner (id, name, category)";

interface ChatbotRow {
  document_id: string;
  version: number;
  effective_date: string;
  storage_path: string;
  original_filename: string;
  document: { id: string; name: string; category: DocumentCategory };
}

async function toView(row: ChatbotRow): Promise<DocumentChatbotView | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);

  // Sem o arquivo acessível não há resposta a dar. Devolver os metadados sem a
  // URL faria o bot anunciar uma normativa que ele não consegue mandar.
  if (!data) {
    console.error(`[document-chatbot] URL assinada falhou: ${error?.message ?? "sem dados"}`);
    return null;
  }

  return {
    documentId: row.document.id,
    category: row.document.category,
    name: row.document.name,
    version: row.version,
    effectiveDate: row.effective_date,
    fileName: row.original_filename,
    pdfUrl: data.signedUrl,
  };
}

/** A versão oficial de um documento, ou `null`. */
export async function getDocumentForChatbot(
  documentId: string,
): Promise<DocumentChatbotView | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("document_versions")
    .select(CHATBOT_COLUMNS)
    .eq("document_id", documentId)
    .eq("status", "active")
    .eq("available_for_chatbot", true)
    // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
    .returns<ChatbotRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[document-chatbot] getDocumentForChatbot falhou: ${error.message}`);
    throw error;
  }
  if (!data) return null;

  return toView(data);
}

/**
 * A mesma porta, procurando pelo NOME dentro de uma categoria.
 *
 * Existe porque o chatbot vai perguntar por "Câmara Ambiental" ou "ISP", não
 * por uuid — ele não conhece (nem deve conhecer) os ids do banco.
 *
 * A comparação ignora caixa pelo mesmo motivo do índice
 * `documents_category_name_key`: "revista" e "Revista" são o mesmo documento, e
 * a unicidade por categoria garante que a busca não fique ambígua.
 */
export async function getDocumentForChatbotByName(
  category: DocumentCategory,
  name: string,
): Promise<DocumentChatbotView | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("documents")
    .select("id")
    .eq("category", category)
    .ilike("name", name.trim())
    .returns<{ id: string }[]>()
    .maybeSingle();

  if (error) {
    console.error(`[document-chatbot] getDocumentForChatbotByName falhou: ${error.message}`);
    throw error;
  }
  if (!data) return null;

  return getDocumentForChatbot(data.id);
}

/**
 * O catálogo do que o robô PODE citar numa categoria.
 *
 * ⚠️ NÃO É A LISTA DE DOCUMENTOS — é a lista dos que têm versão ativa e
 * liberada. O roteador usa isto para duas coisas: casar o nome que a pessoa
 * escreveu ("me manda a da câmara ambiental") e, quando não casa nenhum,
 * oferecer o que existe em vez de responder só "não encontrei".
 */
export async function listChatbotDocumentNames(
  category: DocumentCategory,
): Promise<{ id: string; name: string }[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("document_versions")
    .select("document:documents!inner (id, name, category)")
    .eq("status", "active")
    .eq("available_for_chatbot", true)
    .eq("document.category", category)
    .returns<{ document: { id: string; name: string; category: DocumentCategory } }[]>();

  if (error) {
    console.error(`[document-chatbot] listChatbotDocumentNames falhou: ${error.message}`);
    throw error;
  }

  return (data ?? [])
    .map((row) => ({ id: row.document.id, name: row.document.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
