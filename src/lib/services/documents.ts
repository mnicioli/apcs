import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  compareDocuments,
  compareVersionsDesc,
  currentVersion,
  documentStatus,
  matchesDocumentFilters,
} from "@/modules/document/document.rules";
import type {
  DocumentCategory,
  DocumentDetail,
  DocumentFilters,
  DocumentSummary,
  DocumentVersion,
  DocumentVersionStatus,
} from "@/modules/document/document.types";

/**
 * SERVICE = leitura. Retorna o dado ou LANÇA erro (o caller decide como tratar).
 *
 * Passa pelo cliente autenticado — ou seja, pela RLS de `documents` e
 * `document_versions`. Quem não é `admin`/`ceo`/`comercial` não vê linha
 * nenhuma, mesmo que a checagem de permissão da app falhe.
 *
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 */

/**
 * Teto da leitura da grid.
 *
 * A tela lê os documentos com todas as versões embutidas e filtra em memória,
 * em vez de filtrar no SQL. A razão é a busca por nome: `ilike` no Postgres é
 * sensível a acento, e ninguém digita "Câmara" com circunflexo numa caixa de
 * busca. Filtrar aqui usa `normalizeForSearch` e resolve isso sem depender da
 * extensão `unaccent`.
 *
 * Com o volume de uma associação (unidades de normativas, dezenas de versões)
 * isso é uma consulta e um laço curto. Se passar deste teto, o caminho é paginar
 * e mover a busca para uma coluna normalizada com índice.
 */
const LIST_LIMIT = 200;

/**
 * `uploaded_by` é uma de TRÊS chaves estrangeiras para `profiles` nesta tabela
 * (as outras são `activated_by` e `deactivated_by`). Sem apontar a constraint,
 * o PostgREST não sabe qual seguir e devolve erro de ambiguidade.
 */
const VERSION_COLUMNS =
  "id, document_id, version, status, available_for_chatbot, original_filename, " +
  "file_size_bytes, effective_date, uploaded_at, activated_at, deactivated_at, " +
  "uploader:profiles!document_versions_uploaded_by_fkey (id, full_name)";

const DOCUMENT_COLUMNS =
  `id, category, name, description, updated_at, ` +
  // Aqui `documents` é o lado PAI, então o embed devolve uma LISTA — que é
  // exatamente o que a grid e o histórico precisam.
  `versions:document_versions (${VERSION_COLUMNS})`;

interface VersionRow {
  id: string;
  document_id: string;
  version: number;
  status: DocumentVersionStatus;
  available_for_chatbot: boolean;
  original_filename: string;
  file_size_bytes: number;
  effective_date: string;
  uploaded_at: string;
  activated_at: string | null;
  deactivated_at: string | null;
  uploader: { id: string; full_name: string | null } | null;
}

interface DocumentRow {
  id: string;
  category: DocumentCategory;
  name: string;
  description: string | null;
  updated_at: string;
  versions: VersionRow[];
}

function toVersion(row: VersionRow): DocumentVersion {
  return {
    id: row.id,
    documentId: row.document_id,
    version: row.version,
    status: row.status,
    availableForChatbot: row.available_for_chatbot,
    originalFilename: row.original_filename,
    fileSizeBytes: row.file_size_bytes,
    effectiveDate: row.effective_date,
    uploadedBy: row.uploader ? { id: row.uploader.id, fullName: row.uploader.full_name } : null,
    uploadedAt: row.uploaded_at,
    activatedAt: row.activated_at,
    deactivatedAt: row.deactivated_at,
  };
}

function toSummary(row: DocumentRow, versions: DocumentVersion[]): DocumentSummary {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    description: row.description,
    status: documentStatus(versions),
    currentVersion: currentVersion(versions),
    versionCount: versions.length,
    updatedAt: row.updated_at,
  };
}

/** A grid de uma categoria (hoje, as normativas), já filtrada e ordenada. */
export async function listDocuments(
  category: DocumentCategory,
  filters: DocumentFilters,
): Promise<DocumentSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("category", category)
    .limit(LIST_LIMIT)
    // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
    .returns<DocumentRow[]>();

  if (error) {
    console.error(`[documents] listDocuments falhou: ${error.message}`);
    throw error;
  }

  return (data ?? [])
    .map((row) => toSummary(row, row.versions.map(toVersion)))
    .filter((document) => matchesDocumentFilters(document, filters))
    .sort(compareDocuments);
}

/** Uma normativa com o histórico completo, do mais novo para o mais antigo. */
export async function getDocument(documentId: string): Promise<DocumentDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("id", documentId)
    .returns<DocumentRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[documents] getDocument falhou: ${error.message}`);
    throw error;
  }
  if (!data) return null;

  const versions = data.versions.map(toVersion).sort(compareVersionsDesc);
  return { ...toSummary(data, versions), versions };
}

/*
 * ⚠️ AS DUAS PORTAS DO CHATBOT SAÍRAM DAQUI em 20260913 (Etapa 2 do módulo
 * Inteligência) e agora moram em `document-chatbot.ts`.
 *
 * `getActiveChatbotVersion` e `getActiveChatbotVersionByName` usavam o cliente
 * do USUÁRIO — o mesmo deste arquivo — para atender um consumidor ANÔNIMO. A
 * RLS de `document_versions` exige papel autenticado, então ligadas como
 * estavam elas devolveriam vazio SEMPRE, e o sintoma seria o robô dizendo "não
 * encontrei essa normativa" com a normativa publicada e ativa na tela.
 *
 * Não as traga de volta. Um service que mistura o cliente do usuário com o
 * `service_role` é um service em que a próxima função vai usar o errado — e
 * esse erro não dá exceção, dá resposta vazia.
 *
 * `src/test/chatbot-doors.test.ts` reprova quem tentar.
 */
