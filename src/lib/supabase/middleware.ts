import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Renova o token de autenticação a cada navegação e protege rotas.
 *
 * Chamado pelo `src/middleware.ts`. Sem isto, a sessão expira no meio do uso
 * e Server Components começam a ver o usuário como deslogado.
 */
/**
 * AS ROTAS DE MÁQUINA — as que não têm gente do outro lado.
 *
 * Três famílias, e todas compartilham a mesma característica: não existe sessão
 * de usuário para renovar, não existe usuário para proteger, e cada uma
 * autentica quem a chamou por conta própria.
 *
 *   `/chat`, `/api/chat`   o atendimento público. A conversa é identificada por
 *                          um cookie httpOnly próprio; as tabelas do chat têm
 *                          RLS fechada para `anon`.
 *
 *   `/api/webhooks/*`      quem chama é o fornecedor de WhatsApp. A autorização
 *                          é a assinatura HMAC do corpo (Meta) ou o segredo no
 *                          caminho da URL (Z-API, que não assina nada).
 *
 *   `/api/jobs/*`          quem chama é o cron. A autorização é um segredo
 *                          comparado em tempo constante (`authorizeJob`), que
 *                          RECUSA quando não está configurado.
 *
 * ⚠️ POR QUE ELAS PRECISAM SAIR ANTES, E NÃO ENTRAR NA LISTA DE ROTAS PÚBLICAS.
 *
 * Não é otimização — é correção. Sem esta saída, o fluxo abaixo não acha
 * `user`, conclui "não logado em rota protegida" e devolve um REDIRECT 302 para
 * `/login`. Do lado do fornecedor isso é uma resposta que não é 200, ou seja
 * "não recebi": ele reentrega o mesmo evento por horas, para sempre, e nenhuma
 * mensagem jamais é gravada. O sintoma seria "o WhatsApp não chega no CRM", sem
 * erro nenhum em lugar nenhum — o webhook responde 200 (a página de login) para
 * quem seguir o redirect, e 302 para quem não seguir.
 *
 * O mesmo valia para `/api/webhooks/whatsapp` e `/api/jobs/surveys` desde que
 * foram escritos. Nunca apareceu porque nenhum dos dois chegou a ser ligado a
 * uma conta real (ver o cabeçalho de `providers/cloud-api.ts`).
 */
function isMachineRoute(pathname: string): boolean {
  return (
    pathname === "/chat" ||
    pathname.startsWith("/chat/") ||
    pathname === "/api/chat" ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/jobs/")
  );
}

export async function updateSession(request: NextRequest) {
  // As rotas de máquina saem ANTES de tocar no Supabase. Ver `isMachineRoute`:
  // sem isto o webhook recebe um redirect para `/login` em vez de executar, e o
  // fornecedor reentrega o evento para sempre sem nada ser gravado.
  //
  // `/login` e `/auth` continuam passando pelo fluxo abaixo porque precisam da
  // sessão para redirecionar quem já está logado.
  if (isMachineRoute(request.nextUrl.pathname)) {
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
  //
  // ⚠️ `/eventos` É A PÁGINA PÚBLICA DE INSCRIÇÃO, e vale para ela tudo o que
  // vale para `/associe-se`: aberta na internet, sem sessão, e ESCREVENDO no
  // banco por uma Server Action que usa `service_role`. As tabelas de Landing
  // Pages e Inscrições têm `revoke all ... from anon` justamente porque toda
  // leitura e toda escrita passam por função — ver a decisão 1 de
  // supabase/migrations/20260924000000_event_landing_public.sql.
  //
  // ⚠️ NÃO CONFUNDIR COM `/events`, que é a tela do CRM e continua protegida.
  // São duas rotas diferentes (uma em português, outra em inglês), e é o que
  // permite que a mesma informação tenha duas portas com regras opostas.
  //
  // ⚠️ `/avaliacoes` É A TERCEIRA, e ela é a mais delicada das três: chega-se a
  // ela por um TOKEN mandado no WhatsApp, e não por um endereço que alguém
  // divulga. Vale tudo o que vale para as outras duas — sem sessão, escrevendo
  // por Server Action com `service_role`, com as tabelas fechadas para `anon` —
  // e mais uma coisa: a função de leitura devolve `state: "not_found"` em vez de
  // erro para um token desconhecido, para a página não virar um oráculo de
  // quais tokens existem. Ver a decisão 5 de
  // supabase/migrations/20261002000100_event_evaluation.sql.
  //
  // ⚠️ E NÃO CONFUNDIR COM `/events/evaluations`, que é a gestão no CRM. Mesmo
  // par português/inglês de `/eventos` e `/events`.
  const isPublicRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/associe-se") ||
    pathname.startsWith("/eventos") ||
    pathname.startsWith("/avaliacoes");

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
