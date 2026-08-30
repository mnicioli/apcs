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

/**
 * Vida da URL assinada quando quem vai buscar o arquivo é o FORNECEDOR.
 *
 * ⚠️ OS CINCO MINUTOS ACIMA FORAM DIMENSIONADOS PARA UM NAVEGADOR, com uma
 * pessoa olhando a tela. No caminho do WhatsApp não há navegador: nós entregamos
 * a URL à Z-API e é o servidor DELA que baixa o PDF, quando ELE processar o
 * envio — o que pode ser bem depois de a assinatura ter sido feita.
 *
 * O `broadcast-dispatch.ts` já tinha aprendido isso e assina com uma hora, com o
 * comentário no lugar: "uma URL curta demais expiraria no meio da fila e as
 * últimas pessoas receberiam só o texto — sem erro nenhum, que é a pior forma de
 * falhar". A mesma folga vale aqui.
 *
 * O risco de segurança é o mesmo dos disparos, que já mandam estes arquivos para
 * estas pessoas: a URL vai para o WhatsApp de quem pediu, e ela é reencaminhável
 * de qualquer jeito enquanto valer.
 */
export const CHATBOT_SIGNED_URL_TTL_SECONDS = 3600;
