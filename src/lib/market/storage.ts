import "server-only";
import { IMAGE_EXTENSION_MIME, imageExtensionOf } from "@/lib/files/image";
import type { BulletinFileKind } from "@/modules/market/market.schema";

/**
 * Endereçamento dos arquivos no bucket privado `market-bulletins`.
 *
 * `server-only`: o navegador nunca precisa saber onde o arquivo mora. As
 * actions recebem o id da versão e resolvem o caminho aqui; o que não é enviado
 * não vaza.
 */

export const MARKET_BUCKET = "market-bulletins";

/**
 * Onde os arquivos ficam:
 *
 *   `<bulletin_id>/<version_id>/image/<uuid>.<ext>`
 *   `<bulletin_id>/<version_id>/pdf/<uuid>.pdf`
 *
 * A PASTA DA VERSÃO é o que amarra o par. Imagem e PDF de uma publicação moram
 * no mesmo lugar, e os CHECKs `mb_versions_image_path_scope` /
 * `mb_versions_pdf_path_scope` provam isso no banco — não dá para gravar uma
 * versão apontando para o arquivo de outra.
 *
 * O nome que a pessoa enviou NÃO entra no caminho; ele é guardado só como
 * metadado. Isso mata de uma vez traversal por `../`, colisão entre dois
 * "bolsa.pdf" e caractere que o storage não aceita. A extensão é a única coisa
 * aproveitada do nome original, e ela é conferida contra a allowlist antes de
 * chegar aqui.
 */
export function buildFilePath(
  bulletinId: string,
  versionId: string,
  kind: BulletinFileKind,
  filename: string,
): string {
  return `${bulletinId}/${versionId}/${kind}/${crypto.randomUUID()}${safeExtension(kind, filename)}`;
}

/**
 * A extensão que entra no caminho — conferida AQUI, não confiada de fora.
 *
 * ⚠️ Isto é defesa em profundidade, e o motivo é concreto: a extensão é a única
 * parte do nome enviado que sobrevive até o caminho físico. `imageExtensionOf`
 * devolve tudo que vier depois do último ponto, então um nome como
 * `foto.jpg/../../outro` produziria uma extensão com barra — e o CHECK do banco
 * usa `LIKE`, onde `%` casa com barra também.
 *
 * A action já valida a extensão contra a allowlist antes de chegar aqui. Mas
 * "já foi validado antes" é uma garantia que se perde no dia em que alguém
 * chamar esta função de outro lugar. Conferir de novo custa uma busca num mapa
 * de quatro entradas.
 */
function safeExtension(kind: BulletinFileKind, filename: string): string {
  if (kind === "pdf") return ".pdf";

  const extension = imageExtensionOf(filename);
  return extension && extension in IMAGE_EXTENSION_MIME ? extension : ".jpg";
}

/**
 * O prefixo de uma publicação — usado para apagar os dois arquivos de uma vez
 * quando a validação reprova.
 */
export function versionFolder(bulletinId: string, versionId: string): string {
  return `${bulletinId}/${versionId}/`;
}

/**
 * Vida das URLs assinadas, em segundos.
 *
 * Cinco minutos para o PDF: o suficiente para o navegador carregar 5 MB e a
 * pessoa começar a ler, e curto o bastante para uma URL copiada não virar
 * acesso permanente fora do controle de permissão. É o mesmo prazo das
 * normativas, e pelo mesmo motivo.
 */
export const PDF_SIGNED_URL_TTL_SECONDS = 300;

/**
 * Uma hora para a imagem, e a diferença tem razão concreta: a grid emite as
 * URLs na RENDERIZAÇÃO, então uma lista deixada aberta enquanto alguém almoça
 * viraria uma tela de imagens quebradas. Uma miniatura de boletim numa janela
 * de uma hora é risco menor do que isso — e o arquivo continua inacessível para
 * quem nunca teve permissão de abrir a tela.
 */
export const IMAGE_SIGNED_URL_TTL_SECONDS = 3600;

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
