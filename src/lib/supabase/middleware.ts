import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Renova o token de autenticação a cada navegação e protege rotas.
 *
 * Chamado pelo `src/middleware.ts`. Sem isto, a sessão expira no meio do uso
 * e Server Components começam a ver o usuário como deslogado.
 */
/**
 * Atendimento público: a página do chat e sua API. Não têm sessão para renovar
 * nem usuário para proteger — a conversa é identificada por um cookie httpOnly
 * próprio, e as tabelas do chat têm RLS fechada para `anon`.
 */
function isChatRoute(pathname: string): boolean {
  return pathname === "/chat" || pathname.startsWith("/chat/") || pathname === "/api/chat";
}

export async function updateSession(request: NextRequest) {
  // O atendimento público sai ANTES de tocar no Supabase: criar um cliente e
  // chamar `getUser()` a cada mensagem do chat seria trabalho jogado fora no
  // caminho mais quente do sistema — e acopla o canal público à camada de auth.
  // `/login` e `/auth` continuam passando pelo fluxo abaixo porque precisam da
  // sessão para redirecionar quem já está logado.
  if (isChatRoute(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }[],
        ) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // NÃO coloque lógica entre `createServerClient` e `getUser()`: bugs sutis de
  // sessão surgem quando algo roda no meio. (Recomendação oficial do Supabase.)
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // Refresh token inválido (sessão expirada/rotacionada): apaga os cookies sb-*
  // para o SDK parar de logar "Invalid Refresh Token" a cada navegação.
  if (
    error?.code === "refresh_token_not_found" ||
    error?.code === "refresh_token_already_used" ||
    error?.code === "session_not_found"
  ) {
    request.cookies
      .getAll()
      .filter((c) => c.name.startsWith("sb-"))
      .forEach((c) => supabaseResponse.cookies.delete(c.name));
  }

  const { pathname } = request.nextUrl;
  // O chat já saiu lá em cima; aqui restam as rotas de autenticação e a landing
  // de associação.
  //
  // ⚠️ `/associe-se` é PÚBLICA de propósito: é o formulário de cadastro de
  // novos associados, aberto na internet. Ela passa por este fluxo (em vez de
  // sair antes, como o chat) porque não custa nada — a página é estática e o
  // `getUser()` já rodou — e porque manter uma lista só de rotas públicas é
  // mais fácil de auditar que duas.
  //
  // Ela NÃO escreve no banco pela sessão do visitante: a solicitação entra por
  // uma Server Action que usa o cliente `service_role`, e as tabelas de
  // Associados não têm policy de escrita para `anon`. Ver a decisão 2 de
  // supabase/migrations/20260821000000_create_membership.sql.
  const isPublicRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/associe-se");

  // Não logado tentando acessar rota protegida → manda para o login.
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Já logado tentando ver o login → manda para o dashboard.
  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
