import "server-only";
import { cookies } from "next/headers";

/**
 * O SALVO-CONDUTO DA TROCA DE SENHA.
 *
 * ⚠️ POR QUE ELE EXISTE. Um link de recuperação do Supabase, ao ser aberto,
 * cria uma SESSÃO COMPLETA — a pessoa fica logada de verdade. Se `/auth/reset-
 * password` exigisse apenas "estar logado", qualquer sessão aberta serviria:
 * quem sentasse num computador destravado trocaria a senha sem saber a antiga,
 * mudaria o acesso e trancaria o dono para fora. Trocar senha sem provar quem
 * se é não pode depender só de uma aba esquecida aberta.
 *
 * Este cookie é a prova de que a sessão VEIO DO LINK do e-mail, e não de um
 * login comum. Ele é escrito só por `/auth/callback`, depois de o Supabase
 * validar o token, e é queimado assim que a senha muda.
 *
 * ⚠️ ELE NÃO É A AUTORIZAÇÃO — é a segunda tranca. Quem autoriza a escrita é a
 * sessão do Supabase; sem ela, `updateUser` falha mesmo com o cookie na mão.
 * Um cookie forjado não vira acesso: vira um formulário que não grava.
 *
 * Trinta minutos: tempo de sobra para ler o e-mail e escolher uma senha, curto
 * o bastante para não ficar valendo o dia inteiro numa máquina compartilhada.
 */
export const RECOVERY_COOKIE = "apcs.recovery";

const MAX_AGE_SECONDS = 60 * 30;

export async function grantRecovery(): Promise<void> {
  const store = await cookies();
  store.set(RECOVERY_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function hasRecovery(): Promise<boolean> {
  const store = await cookies();
  return store.get(RECOVERY_COOKIE)?.value === "1";
}

export async function clearRecovery(): Promise<void> {
  const store = await cookies();
  store.delete(RECOVERY_COOKIE);
}
