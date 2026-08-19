import "server-only";
import { createHash, createHmac } from "node:crypto";

/**
 * Identificação do visitante para limite de taxa, sem guardar dado pessoal.
 *
 * Vive aqui, e não dentro de `@/lib/chat`, porque agora são DOIS canais
 * públicos usando o mesmo mecanismo: o chat e o formulário de associação. Dois
 * hashes diferentes para a mesma coisa seriam dois segredos para rotacionar e
 * duas chances de um deles ficar sem segredo nenhum.
 */

let avisouSobreSegredo = false;

/**
 * Hash do IP para limite de taxa — guardar o IP em claro seria dado pessoal sem
 * necessidade.
 *
 * É HMAC, não SHA-256 puro: o espaço de IPv4 tem só 2^32 entradas, então uma
 * tabela completa de SHA-256 se gera em minutos e o "hash" viraria o IP em
 * claro para quem tivesse acesso de leitura à tabela. Com um segredo que só o
 * servidor conhece, o valor deixa de ser reversível.
 */
export function hashIp(ip: string): string {
  const secret = process.env.APCS_IP_HASH_SECRET;

  if (!secret) {
    if (!avisouSobreSegredo) {
      avisouSobreSegredo = true;
      console.warn(
        "[security.client-ip] APCS_IP_HASH_SECRET não definida — o hash de IP fica reversível por força bruta. Defina antes de ir para produção.",
      );
    }
    return createHash("sha256").update(ip).digest("hex");
  }

  return createHmac("sha256", secret).update(ip).digest("hex");
}

/**
 * Headers que a borda REESCREVE (o cliente não consegue forjá-los), em ordem de
 * preferência. `x-forwarded-for` fica por último porque vários proxies apenas
 * ACRESCENTAM ao valor recebido: nesse caso o primeiro elemento é escolhido
 * pelo cliente, e confiar nele zeraria o limite por IP.
 */
const TRUSTED_IP_HEADERS = ["x-vercel-forwarded-for", "cf-connecting-ip", "true-client-ip"];

/**
 * Hash do IP a partir dos headers da requisição, ou `null` quando não dá para
 * saber.
 *
 * ⚠️ `null` significa "sem limite por IP", e é deliberado: recusar quem chega
 * sem header confiável barraria gente atrás de proxy legítimo. O limite de taxa
 * é uma das defesas do formulário público, não a única — a outra é a chave de
 * deduplicação, que não depende de IP nenhum.
 */
export function clientIpHashFromHeaders(headers: Headers): string | null {
  for (const header of TRUSTED_IP_HEADERS) {
    const valor = headers.get(header)?.trim();
    if (valor) return hashIp(valor);
  }

  const encaminhado = headers.get("x-forwarded-for");
  const ip = encaminhado?.split(",")[0]?.trim() ?? headers.get("x-real-ip")?.trim();
  return ip ? hashIp(ip) : null;
}
