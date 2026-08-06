import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Sessão do chat público.
 *
 * A conversa é identificada por um token aleatório de 256 bits guardado num
 * cookie httpOnly. No banco fica apenas o SHA-256 do token: um vazamento da
 * tabela não permite sequestrar conversas alheias.
 *
 * Não há login: o token É a credencial. Por isso ele é opaco, longo e nunca
 * aparece em URL, log ou resposta da API.
 */

export const CHAT_SESSION_COOKIE = "apcs_chat_session";

/** 30 dias — tempo de vida do cookie e, na prática, da conversa. */
export const CHAT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

let warnedAboutIpSecret = false;

/**
 * Hash do IP para rate limit — guardar o IP em claro seria dado pessoal sem
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
    if (!warnedAboutIpSecret) {
      warnedAboutIpSecret = true;
      console.warn(
        "[chat.session] APCS_IP_HASH_SECRET não definida — o hash de IP fica reversível por força bruta. Defina antes de ir para produção.",
      );
    }
    return createHash("sha256").update(ip).digest("hex");
  }

  return createHmac("sha256", secret).update(ip).digest("hex");
}

export const chatSessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: CHAT_SESSION_MAX_AGE_SECONDS,
} as const;
