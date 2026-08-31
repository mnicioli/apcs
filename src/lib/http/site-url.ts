import "server-only";
import { headers } from "next/headers";

/**
 * Normaliza o que veio da configuração para uma ORIGEM utilizável.
 *
 * Tira a barra do fim (senão o link sai com `//auth/callback`) e completa o
 * protocolo quando ele falta. A segunda parte não é preciosismo: a Vercel
 * entrega o domínio como `apcs.vercel.app`, sem `https://`, e quem preenche a
 * variável à mão copia do navegador do mesmo jeito. Sem o protocolo o
 * `redirectTo` deixa de ser uma URL absoluta e o Supabase o descarta — que é
 * exatamente a falha silenciosa que este arquivo existe para evitar.
 */
function normaliza(valor: string): string {
  const semBarra = valor.trim().replace(/\/+$/, "");
  return semBarra.includes("://") ? semBarra : `https://${semBarra}`;
}

/**
 * A ORIGEM PÚBLICA DO SISTEMA — para montar links que voltam para cá.
 *
 * Usada no `redirectTo` do e-mail de recuperação: o Supabase precisa saber para
 * onde devolver a pessoa depois de validar o token.
 *
 * ⚠️ A ORDEM É DELIBERADA, E É UMA DECISÃO DE SEGURANÇA.
 *
 * `NEXT_PUBLIC_SITE_URL` vem primeiro porque é a única fonte que NÃO vem da
 * requisição. O cabeçalho `Host` é escolhido por quem chama: um pedido forjado
 * com `Host: site-do-atacante` faria o link do e-mail apontar para lá, e a
 * pessoa entregaria o token de recuperação achando que estava no sistema da
 * APCS. Com a variável configurada, o link é sempre o nosso, venha o pedido de
 * onde vier.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` é a rede de segurança de PRODUÇÃO: a Vercel a
 * injeta sozinha com o domínio estável do projeto, então mesmo que ninguém
 * tenha preenchido a variável de cima, o link de produção nunca sai apontando
 * para `localhost`. Ela só vale quando `VERCEL_ENV` é `production` porque em
 * uma prévia ela devolveria o domínio de produção — mandaria a pessoa para o
 * ar de verdade a partir de um teste.
 *
 * O cabeçalho fica como último recurso porque cobre o desenvolvimento local e
 * as prévias da Vercel, onde o endereço muda a cada implantação. Ainda assim
 * ele não é a última linha de defesa: o Supabase só redireciona para endereços
 * da lista de "Redirect URLs" do projeto — qualquer outro cai na Site URL
 * configurada lá. Ou seja, o pior caso do cabeçalho forjado é o link não
 * funcionar, não o token vazar.
 *
 * ⚠️ O CÓDIGO SOZINHO NÃO RESOLVE. Se o endereço montado aqui não estiver em
 * Authentication > URL Configuration > Redirect URLs no painel do Supabase, ele
 * é IGNORADO e o e-mail sai com a Site URL do painel — que num projeto novo vem
 * `http://localhost:3000`. Ver `.env.example`.
 */
export async function getSiteOrigin(): Promise<string> {
  const configurada = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configurada) return normaliza(configurada);

  const producao = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (process.env.VERCEL_ENV === "production" && producao) return normaliza(producao);

  const cabecalhos = await headers();
  const host = cabecalhos.get("x-forwarded-host") ?? cabecalhos.get("host");
  if (!host) return "";

  // Em desenvolvimento o proxy não passa o protocolo; localhost é http.
  const protocolo =
    cabecalhos.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return `${protocolo}://${host}`;
}
