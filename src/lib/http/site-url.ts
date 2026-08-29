import "server-only";
import { headers } from "next/headers";

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
 * O cabeçalho fica como último recurso porque cobre o caso legítimo em que o
 * endereço muda a cada implantação (as prévias da Vercel). Ainda assim ele não
 * é a última linha de defesa: o Supabase só redireciona para endereços da lista
 * de "Redirect URLs" do projeto — qualquer outro cai na Site URL configurada
 * lá. Ou seja, o pior caso do cabeçalho forjado é o link não funcionar, não o
 * token vazar. Mesmo assim, CONFIGURE A VARIÁVEL em produção.
 */
export async function getSiteOrigin(): Promise<string> {
  const configurada = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configurada) return configurada.replace(/\/+$/, "");

  const cabecalhos = await headers();
  const host = cabecalhos.get("x-forwarded-host") ?? cabecalhos.get("host");
  if (!host) return "";

  // Em desenvolvimento o proxy não passa o protocolo; localhost é http.
  const protocolo =
    cabecalhos.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return `${protocolo}://${host}`;
}
