/**
 * Tipos de domínio da gestão documental (camelCase), desacoplados das linhas
 * cruas do banco (snake_case).
 *
 * Os enums espelham os do Postgres criados em
 * `supabase/migrations/20260811000000_create_documents.sql`. Ao mudar um, mude
 * os dois — o `as const` aqui é a fonte da verdade para o TypeScript.
 *
 * DOIS CONCEITOS: um `Document` é o cadastro lógico ("Selo Suíno Paulista");
 * uma `DocumentVersion` é um arquivo enviado (v1, v2, v3...). Novo upload cria
 * versão, nunca duplica o documento.
 */

export const DOCUMENT_CATEGORIES = ["normative"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_VERSION_STATUSES = ["active", "inactive"] as const;
export type DocumentVersionStatus = (typeof DOCUMENT_VERSION_STATUSES)[number];

/** Abas do filtro de status. `all` é o padrão: a grid abre mostrando tudo. */
export const DOCUMENT_STATUS_FILTERS = ["all", "active", "inactive"] as const;
export type DocumentStatusFilter = (typeof DOCUMENT_STATUS_FILTERS)[number];

export const DEFAULT_DOCUMENT_STATUS_FILTER: DocumentStatusFilter = "all";

export function isDocumentStatusFilter(value: string): value is DocumentStatusFilter {
  return (DOCUMENT_STATUS_FILTERS as readonly string[]).includes(value);
}

/** Quem fez uma operação, já com o nome resolvido para exibir. */
export interface DocumentActor {
  id: string;
  fullName: string | null;
}

/**
 * Um arquivo publicado. Imutável depois de criado: para corrigir, envia-se
 * outro, que vira a próxima versão.
 *
 * `storagePath` NÃO está aqui de propósito. O caminho no bucket nunca precisa
 * chegar ao navegador: as actions recebem `versionId` e resolvem o caminho no
 * servidor. O que não é enviado não vaza.
 */
export interface DocumentVersion {
  id: string;
  documentId: string;
  version: number;
  status: DocumentVersionStatus;
  availableForChatbot: boolean;
  originalFilename: string;
  fileSizeBytes: number;
  /** Data pura AAAA-MM-DD, sem hora e sem fuso. Informada por quem envia. */
  effectiveDate: string;
  uploadedBy: DocumentActor | null;
  uploadedAt: string;
  activatedAt: string | null;
  deactivatedAt: string | null;
}

/** Uma linha da grid: o cadastro mais a situação atual dele. */
export interface DocumentSummary {
  id: string;
  category: DocumentCategory;
  name: string;
  description: string | null;
  /** `active` quando existe versão ativa; caso contrário `inactive` (RN25). */
  status: DocumentVersionStatus;
  /**
   * A versão que a grid mostra: a ativa quando há uma; senão a mais recente,
   * para a linha não ficar vazia numa normativa que já teve versões.
   */
  currentVersion: DocumentVersion | null;
  versionCount: number;
  updatedAt: string;
}

/** O cadastro com o histórico completo, do mais novo para o mais antigo. */
export interface DocumentDetail extends DocumentSummary {
  versions: DocumentVersion[];
}

/** Filtros da grid, lidos da URL. */
export interface DocumentFilters {
  /** Busca parcial por nome. String vazia = sem filtro. */
  query: string;
  status: DocumentStatusFilter;
}
