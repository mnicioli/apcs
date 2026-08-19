import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { hashIp } from "@/lib/security/client-ip";

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

/**
 * O hash de IP MUDOU DE CASA: agora vive em `@/lib/security/client-ip`, porque
 * o formulário público de associação usa o mesmo mecanismo e dois hashes
 * diferentes para a mesma coisa seriam dois segredos para rotacionar.
 *
 * O reexport fica para quem já importava daqui não ter de mudar.
 */
export { hashIp };

export const chatSessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: CHAT_SESSION_MAX_AGE_SECONDS,
} as const;
