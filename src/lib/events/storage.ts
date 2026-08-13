import "server-only";
import { imageExtensionOf } from "@/modules/event/event.schema";

/**
 * Endereçamento das imagens no bucket privado `events`.
 *
 * `server-only`: o navegador nunca precisa saber onde o arquivo mora. As
 * actions recebem `eventId` e resolvem o caminho aqui; o que não é enviado não
 * vaza.
 */

export const EVENTS_BUCKET = "events";

/**
 * Onde a imagem fica: `<event_id>/<uuid aleatório>.<ext>`.
 *
 * O nome que a pessoa enviou NÃO entra no caminho. Isso mata de uma vez
 * traversal por `../`, colisão entre dois "cartaz.png" e caractere que o
 * storage não aceita. A extensão é a única coisa aproveitada do nome original,
 * e ela é conferida contra a allowlist antes de chegar aqui.
 */
export function buildImagePath(eventId: string, filename: string): string {
  const extension = imageExtensionOf(filename) ?? ".jpg";
  return `${eventId}/${crypto.randomUUID()}${extension}`;
}

/**
 * Vida da URL assinada da imagem, em segundos.
 *
 * Uma hora, e não os 300 s das normativas. A diferença tem uma razão concreta:
 * a grid emite as URLs na RENDERIZAÇÃO, então uma lista deixada aberta enquanto
 * alguém almoça viraria uma tela de imagens quebradas. Um cartaz promocional
 * numa janela de uma hora é um risco menor do que isso — e o arquivo continua
 * inacessível para quem nunca teve permissão de abrir a tela.
 */
export const IMAGE_SIGNED_URL_TTL_SECONDS = 3600;
