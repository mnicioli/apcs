import "server-only";
import { imageExtensionOf } from "@/lib/files/image";

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
 * A arte da PÁGINA DE INSCRIÇÃO: `<event_id>/landing/<uuid>.<ext>`.
 *
 * ⚠️ MESMO BUCKET, PASTA DIFERENTE — e as duas metades importam.
 *
 * Mesmo bucket porque o §8 é explícito ("Se a plataforma já possuir serviço de
 * storage, utilizar o serviço existente"): as policies, o teto de 5 MB e a
 * lista de MIME já valem para `events`, e um bucket novo seria uma segunda
 * configuração para manter em dia.
 *
 * Pasta `landing/` porque o cartaz do evento e a arte da página são arquivos
 * distintos com ciclos de vida distintos — trocar um não pode apagar o outro.
 * `discardReplacedImage` pergunta a QUAL TABELA o caminho pertence antes de
 * remover, e o prefixo é o que torna a distinção óbvia para quem olhar o
 * bucket.
 */
export function buildLandingImagePath(eventId: string, filename: string): string {
  const extension = imageExtensionOf(filename) ?? ".jpg";
  return `${eventId}/landing/${crypto.randomUUID()}${extension}`;
}

/**
 * O BANNER DE CONFIRMAÇÃO: `<event_id>/landing/success/<uuid>.<ext>`.
 *
 * ⚠️ SUBPASTA, E NÃO UM PREFIXO NO NOME DO ARQUIVO. O nome é um uuid aleatório
 * justamente para não carregar informação; codificar o papel da imagem ali
 * ("success-<uuid>") seria voltar a depender do nome do arquivo para saber o
 * que ele é. A pasta responde isso olhando o bucket, sem abrir nada.
 *
 * ⚠️ E ELE NÃO É INTERCAMBIÁVEL COM A ARTE DA PÁGINA. São duas peças de
 * comunicação diferentes — uma convida, a outra confirma —, e a separação em
 * pastas é o que impede um "trocar a imagem" de sobrescrever a outra por
 * engano. `discardReplacedImage` pergunta a QUAL COLUNA o caminho pertence
 * antes de apagar; a pasta é a mesma distinção, visível para quem olhar o
 * Storage sem consultar o banco.
 */
export function buildLandingSuccessImagePath(eventId: string, filename: string): string {
  const extension = imageExtensionOf(filename) ?? ".jpg";
  return `${eventId}/landing/success/${crypto.randomUUID()}${extension}`;
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
