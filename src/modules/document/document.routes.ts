import { DOCUMENT_CATEGORIES, type DocumentCategory } from "./document.types";

/**
 * Endereços das telas de documentos.
 *
 * Existe uma rota só — `/documents/[category]` — servindo todas as categorias.
 * Duplicar a página por categoria significaria duplicar grid, filtros, diálogos
 * e estados vazios a cada submenu novo; aqui, acrescentar Procedimentos ou
 * Manuais é um valor de enum, um slug e um item de menu.
 *
 * O SLUG É PARTE DO CONTRATO PÚBLICO. `normatives` já está em uso e em links
 * salvos — mudar quebra endereço de quem guardou. Por isso o mapa é explícito, e
 * não uma transformação automática do nome da categoria.
 */
export const DOCUMENT_CATEGORY_SLUGS: Record<DocumentCategory, string> = {
  normative: "normatives",
  communication: "communication",
};

/**
 * Resolve o segmento da URL para uma categoria, ou `null` se não for uma.
 *
 * Devolver `null` (e a página chamar `notFound()`) é diferente de cair numa
 * categoria padrão: `/documents/qualquer-coisa` renderizando a grid vazia faria
 * a pessoa ler "nenhum documento cadastrado" e achar que o dado sumiu.
 */
export function categoryFromSlug(slug: string): DocumentCategory | null {
  return DOCUMENT_CATEGORIES.find((category) => DOCUMENT_CATEGORY_SLUGS[category] === slug) ?? null;
}

/** URL da grid de uma categoria, ou do histórico de um documento dela. */
export function documentsHref(category: DocumentCategory, documentId?: string): string {
  const base = `/documents/${DOCUMENT_CATEGORY_SLUGS[category]}`;
  return documentId ? `${base}/${documentId}` : base;
}

/**
 * Caminhos para invalidar o cache depois de escrever.
 *
 * São os PADRÕES de rota, não endereços concretos: as funções transacionais
 * devolvem o `document_id`, não a categoria, e ir ao banco de novo só para
 * descobrir isso custaria uma consulta por operação. Invalidar as duas
 * categorias numa tela de backoffice não custa nada.
 */
export const DOCUMENT_ROUTE_PATTERNS = ["/documents/[category]", "/documents/[category]/[id]"];
