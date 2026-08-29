import "server-only";
import { cookies } from "next/headers";

/**
 * "LEMBRAR MINHAS CREDENCIAIS" — que aqui quer dizer LEMBRAR O E-MAIL.
 *
 * ⚠️ A SENHA NUNCA É GUARDADA. Não em cookie, não em `localStorage`, não em
 * lugar nenhum deste código. Guardar senha do lado do cliente é entregá-la a
 * qualquer XSS futuro e a quem tiver o computador na mão; e não é isso que a
 * caixinha precisa fazer para poupar o trabalho de quem entra todo dia. Quem
 * guarda senha com segurança é o gerenciador do navegador — por isso o campo
 * mantém `autoComplete="current-password"`, que é o que pede a ele para agir.
 *
 * O que sobra, e resolve o incômodo real, é o e-mail vir preenchido.
 *
 * ⚠️ O COOKIE É `httpOnly`. Ele é lido pelo SERVIDOR, que renderiza o campo já
 * preenchido — nenhum script da página precisa (nem consegue) enxergá-lo. Um
 * cookie legível por JavaScript entregaria de graça a um XSS o e-mail de quem
 * usa o sistema, que é meio caminho para um phishing dirigido.
 *
 * ⚠️ É OPT-IN, e desmarcar APAGA. Num computador compartilhado, o e-mail de
 * quem entrou por último é informação — a pessoa tem de poder tirá-la de lá, e
 * desmarcar a caixa é o gesto óbvio para isso.
 */
export const REMEMBER_EMAIL_COOKIE = "apcs.remember_email";

/** Seis meses: longo o bastante para servir, curto o bastante para expirar. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

/**
 * Teto de tamanho do que se aceita gravar.
 *
 * O e-mail chega de um formulário, e formulário é entrada de fora. Sem limite,
 * um POST fabricado escreveria quilobytes num cookie que o navegador devolve em
 * TODA requisição ao domínio — inclusive nas do webhook e do cron.
 */
const MAX_EMAIL_LENGTH = 254;

/**
 * Normaliza o que veio do formulário; devolve `null` se não servir.
 *
 * Função pura de propósito: é a parte que tem regra, e regra se testa sem
 * levantar um servidor.
 */
export function sanitizeRememberedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH) return null;
  // Uma checagem de forma, não de existência: o cookie só precisa não conter
  // lixo. Quem valida o e-mail de verdade é o Supabase, no login.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  // Quebra de linha em cookie é injeção de cabeçalho. O regex acima já barra
  // (`\s`), mas a intenção fica escrita.
  if (/[\r\n;]/.test(email)) return null;
  return email;
}

/** O e-mail lembrado, para preencher o campo. */
export async function readRememberedEmail(): Promise<string> {
  const store = await cookies();
  return sanitizeRememberedEmail(store.get(REMEMBER_EMAIL_COOKIE)?.value) ?? "";
}

/** Grava ou apaga, conforme a caixinha. Chamado de dentro de uma Server Action. */
export async function writeRememberedEmail(email: string | null): Promise<void> {
  const store = await cookies();

  if (!email) {
    store.delete(REMEMBER_EMAIL_COOKIE);
    return;
  }

  store.set(REMEMBER_EMAIL_COOKIE, email, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}
