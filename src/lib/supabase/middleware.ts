import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Renova o token de autenticação a cada navegação e protege rotas.
 *
 * Chamado pelo `src/middleware.ts`. Sem isto, a sessão expira no meio do uso
 * e Server Components começam a ver o usuário como deslogado.
 */
export async function updateSession(request: NextRequest) {
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
  const isPublicRoute = pathname.startsWith("/login") || pathname.startsWith("/auth");

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
