import "server-only";

/**
 * Endereçamento dos arquivos no bucket privado `documents`.
 *
 * `server-only`: o navegador nunca precisa saber onde o arquivo mora. As
 * actions recebem `versionId` e resolvem o caminho aqui; o que não é enviado
 * não vaza.
 */

export const DOCUMENTS_BUCKET = "documents";

/**
 * Onde o PDF fica: `<document_id>/<uuid aleatório>.pdf`.
 *
 * O nome que a pessoa enviou NÃO entra no caminho — ele é guardado só como
 * metadado, em `original_filename` (item 16 do escopo). Isso mata de uma vez
 * traversal por `../`, colisão entre dois "normativa.pdf" e nome com caractere
 * que o storage não aceita. A identidade funcional da versão é
 * "normativa + número", nunca o nome do arquivo.
 */
export function buildStoragePath(documentId: string): string {
  return `${documentId}/${crypto.randomUUID()}.pdf`;
}

/**
 * Vida da URL assinada, em segundos.
 *
 * Cinco minutos: o suficiente para o navegador carregar um PDF de 5 MB e a
 * pessoa começar a ler, e curto o bastante para uma URL copiada não virar um
 * acesso permanente fora do controle de permissão.
 */
export const SIGNED_URL_TTL_SECONDS = 300;
