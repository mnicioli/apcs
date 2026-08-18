import { createHmac, timingSafeEqual } from "node:crypto";
import type { SignatureCheck } from "./messaging.types";

/**
 * §18. A assinatura do webhook.
 *
 * ⚠️ TRÊS ARMADILHAS, TODAS CLÁSSICAS, TODAS EVITADAS AQUI:
 *
 * 1. ASSINAR O CORPO REPARSEADO. O HMAC tem de ser calculado sobre os BYTES
 *    CRUS que chegaram. `JSON.stringify(await request.json())` produz outro
 *    texto (ordem de chaves, escapes, espaços) e a assinatura nunca bate — o
 *    que costuma "resolver" com alguém desligando a verificação.
 *
 * 2. COMPARAR COM `===`. A comparação de strings sai no primeiro byte
 *    diferente, e o tempo até sair vaza quantos bytes estavam certos. Com
 *    tentativas suficientes isso constrói a assinatura byte a byte.
 *    `timingSafeEqual` leva o mesmo tempo sempre.
 *
 * 3. FALHAR ABERTO SEM SEGREDO. Se a variável não estiver configurada, a
 *    tentação é aceitar "por enquanto". Aqui o webhook RECUSA: um endpoint que
 *    aceita qualquer payload é um jeito de qualquer pessoa na internet
 *    registrar respostas em nome de associados.
 */

export const WHATSAPP_SIGNATURE_HEADER = "x-hub-signature-256";

export function verifyHmacSignature(params: {
  rawBody: string;
  header: string | null;
  secret: string | undefined;
  /** Prefixo do header, como o fornecedor o escreve. */
  prefix?: string;
}): SignatureCheck {
  const { rawBody, header } = params;
  const prefix = params.prefix ?? "sha256=";
  const secret = params.secret?.trim();

  if (!secret) {
    return { valid: false, reason: "segredo de webhook não configurado" };
  }
  if (!header) {
    return { valid: false, reason: "requisição sem assinatura" };
  }
  if (!header.startsWith(prefix)) {
    return { valid: false, reason: "assinatura em formato desconhecido" };
  }

  const recebida = header.slice(prefix.length).trim();
  // Hex de SHA-256: 64 caracteres. Recusar antes evita que `Buffer.from` com
  // lixo produza um buffer curto e faça `timingSafeEqual` LANÇAR por tamanho
  // diferente — o que viraria um 500 e, com sorte de quem está tentando, um
  // canal lateral por tipo de resposta.
  if (!/^[0-9a-f]{64}$/i.test(recebida)) {
    return { valid: false, reason: "assinatura em formato desconhecido" };
  }

  const esperada = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  const a = Buffer.from(recebida.toLowerCase(), "utf8");
  const b = Buffer.from(esperada, "utf8");
  if (a.length !== b.length) {
    return { valid: false, reason: "assinatura com tamanho inesperado" };
  }

  return timingSafeEqual(a, b)
    ? { valid: true, reason: "ok" }
    : { valid: false, reason: "assinatura não confere" };
}

/**
 * Comparação de segredo em tempo constante, para o header dos jobs.
 *
 * O mesmo raciocínio do item 2 acima: `token === process.env.X` vaza o prefixo
 * correto pelo tempo de resposta.
 */
export function safeCompare(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
