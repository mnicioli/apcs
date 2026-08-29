import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { grantRecovery } from "@/lib/auth/recovery";

/**
 * Os tipos de link que esta rota atende.
 *
 * Lista fechada em vez de repassar o que veio na URL: o Supabase recusaria um
 * valor inventado de qualquer forma, mas o `as EmailOtpType` num texto de fora
 * é uma mentira para o TypeScript — e mentira de tipo é o que faz o próximo
 * refator confiar num dado que ninguém conferiu.
 */
const TIPOS_ACEITOS = ["recovery", "invite", "signup", "magiclink", "email_change"] as const;

function tipoAceito(valor: string | null): EmailOtpType | null {
  return (TIPOS_ACEITOS as readonly string[]).includes(valor ?? "")
    ? (valor as EmailOtpType)
    : null;
}

/**
 * O RETORNO DO LINK DO E-MAIL.
 *
 * O Supabase valida o token do lado dele e devolve a pessoa para cá. Aqui a
 * sessão é criada e a pessoa segue para a tela que pediu o link.
 *
 * ⚠️ DUAS FORMAS DE LINK SÃO ACEITAS, e as duas precisam existir.
 *
 *   `token_hash` + `type`   é o formato RECOMENDADO para aplicações que rodam
 *                           no servidor, e o que o Supabase manda quando o
 *                           modelo de e-mail usa `{{ .TokenHash }}`.
 *
 *   `code`                  é o formato PKCE, que o modelo padrão
 *                           (`{{ .ConfirmationURL }}`) produz.
 *
 * Aceitar só um dos dois faria a recuperação depender de uma configuração de
 * painel que ninguém deste lado versiona: bastaria alguém restaurar o modelo
 * padrão do Supabase para todo mundo perder o acesso, com "link inválido" e
 * nenhuma pista do motivo. Os dois caminhos custam quinze linhas.
 *
 * ⚠️ O `code` DO PKCE EXIGE O MESMO NAVEGADOR que pediu o link — o verificador
 * fica num cookie daqui. Quem pede pelo celular e abre o e-mail no computador
 * cai no erro; a mensagem manda pedir outro link, que é o que resolve. O
 * caminho `token_hash` não tem essa amarra, e é por isso que ele é o preferido.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = tipoAceito(searchParams.get("type"));
  const code = searchParams.get("code");

  const supabase = await createClient();

  let ok = false;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  if (!ok) {
    return NextResponse.redirect(new URL("/auth/forgot-password?erro=link", request.url));
  }

  const destino = destinoSeguro(searchParams.get("next"));

  // O salvo-conduto só é emitido para o destino que o exige. Ver `recovery.ts`:
  // ele é o que separa "esta sessão veio do e-mail" de "esta aba estava aberta".
  if (destino === "/auth/reset-password") await grantRecovery();

  return NextResponse.redirect(new URL(destino, request.url));
}

/**
 * ⚠️ O `next` VEM DA URL, E URL É ENTRADA DE FORA — mesmo esta, que o nosso
 * código montou: o link viaja por e-mail e volta editável. Sem esta checagem,
 * `?next=https://site-do-atacante` faria um redirecionamento aberto a partir de
 * um domínio da APCS, logo depois de autenticar — a montagem perfeita de um
 * phishing. Só caminho interno passa, e `//` é barrado porque o navegador o lê
 * como "outro domínio", não como pasta.
 */
function destinoSeguro(valor: string | null): string {
  if (!valor || !valor.startsWith("/") || valor.startsWith("//")) return "/dashboard";
  return valor;
}
