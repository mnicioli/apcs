"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSiteOrigin } from "@/lib/http/site-url";
import { newPasswordSchema, resetRequestSchema } from "./password";
import { clearRecovery, hasRecovery } from "./recovery";
import { sanitizeRememberedEmail, writeRememberedEmail } from "./remember";
import type { AuthActionState, AuthErrorCode } from "./types";

/**
 * Traduz o erro do Supabase para o nosso vocabulário.
 *
 * Olha `code` E `status` porque as duas coisas mudam de versão para versão do
 * SDK: um `429` sem código continua sendo excesso de tentativas, e um
 * `weak_password` sem status continua sendo senha curta.
 */
function traduzErro(erro: { code?: string; status?: number } | null): AuthErrorCode {
  if (!erro) return "generic";
  if (erro.code === "over_email_send_rate_limit" || erro.status === 429) return "tooManyRequests";
  if (erro.code === "weak_password") return "weakPassword";
  if (erro.code === "same_password") return "samePassword";
  if (erro.code === "validation_failed") return "invalidEmail";
  return "generic";
}

export async function loginAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const lembrar = formData.get("remember") === "on";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    // Desmarcar a caixa apaga o e-mail lembrado MESMO COM A SENHA ERRADA. É o
    // caso de quem senta num computador emprestado e quer sair sem deixar
    // rastro: essa intenção não pode depender de acertar a senha.
    if (!lembrar) await writeRememberedEmail(null);
    return { error: "invalidCredentials" };
  }

  // Só a partir daqui o e-mail está confirmado como real. Guardar o que foi
  // digitado antes disso encheria o cookie de erros de digitação.
  await writeRememberedEmail(lembrar ? sanitizeRememberedEmail(email) : null);

  redirect("/dashboard");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * PEDIDO DE RECUPERAÇÃO DE SENHA.
 *
 * ⚠️ A RESPOSTA É A MESMA EXISTA OU NÃO A CONTA, e isso não é preguiça de
 * tratar o caso. Um "e-mail não encontrado" transforma esta tela num verificador
 * de cadastro: quem quiser saber quem trabalha na APCS testa endereços um a um
 * e monta a lista, que é a matéria-prima de um phishing dirigido. O Supabase
 * também não distingue os dois casos na resposta — a decisão dele é a mesma.
 *
 * O único erro que aparece é o de excesso de tentativas, porque ele fala do
 * PEDIDO e não da conta: sem ele, quem clicasse duas vezes veria a mesma
 * confirmação e ficaria esperando um e-mail que o Supabase recusou mandar.
 */
export async function requestPasswordResetAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const analise = resetRequestSchema.safeParse({ email: formData.get("email") });
  if (!analise.success) return { error: "invalidEmail" };

  const origem = await getSiteOrigin();
  const supabase = await createClient();

  const { error } = await supabase.auth.resetPasswordForEmail(analise.data.email, {
    redirectTo: `${origem}/auth/callback?next=/auth/reset-password`,
  });

  if (error) {
    const codigo = traduzErro(error);
    if (codigo === "tooManyRequests") return { error: codigo };
    // Qualquer outra falha vira confirmação: ver o cabeçalho. O erro real fica
    // no log do servidor, onde quem opera consegue ver e quem sonda não.
    console.error("[auth] resetPasswordForEmail falhou", error);
  }

  return { sent: true };
}

/**
 * GRAVA A SENHA NOVA.
 *
 * Exige DUAS coisas ao mesmo tempo: a sessão criada pelo link (sem ela o
 * Supabase recusa a escrita) e o cookie de recuperação (sem ele qualquer aba
 * logada serviria — ver `recovery.ts`).
 *
 * ⚠️ TERMINA DESLOGANDO. A sessão que veio do e-mail é descartada e a pessoa
 * entra de novo com a senha nova. São dois ganhos: o link deixa de valer como
 * acesso no instante em que cumpre sua função, e a primeira coisa que acontece
 * depois de trocar a senha é justamente provar que a senha nova funciona.
 */
export async function updatePasswordAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!(await hasRecovery())) return { error: "recoveryLinkInvalid" };

  const analise = newPasswordSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    confirmation: String(formData.get("confirmation") ?? ""),
  });

  if (!analise.success) {
    const problema = analise.error.issues[0];
    return { error: problema?.path[0] === "confirmation" ? "passwordsDoNotMatch" : "weakPassword" };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "recoveryLinkInvalid" };

  const { error } = await supabase.auth.updateUser({ password: analise.data.password });
  if (error) return { error: traduzErro(error) };

  await clearRecovery();
  await supabase.auth.signOut();

  redirect("/login?senha=alterada");
}
