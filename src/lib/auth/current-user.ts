import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isRole, type Role } from "@/lib/rbac/rbac.types";
import { toSessionUser, type SessionUser } from "./session";

/**
 * Papel de fallback quando o caminho feliz falha — DENY-BY-DEFAULT.
 * `viewer` tem zero permissões na matriz. Se algo der errado (anônimo, perfil
 * ausente, role inválido), o RBAC falha FECHADO, nunca aberto.
 */
const FALLBACK_ROLE: Role = "viewer";

/**
 * Usuário autenticado (ou `null` se anônimo). Memoizado por request com
 * `cache()`: vários chamadores no mesmo render compartilham uma ida ao banco.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // O nome e o avatar vêm de `profiles`, não de `user_metadata`: é em
  // `profiles` que `updateProfileAction` escreve. Sem esta consulta, quem
  // editasse o nome em /profile continuaria vendo o e-mail no cabeçalho.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", user.id)
    .returns<{ full_name: string | null; avatar_url: string | null }[]>()
    .maybeSingle();

  // Perfil ausente não é motivo para derrubar a sessão: `toSessionUser` cai no
  // metadata e, em último caso, no e-mail.
  return toSessionUser(user, profile);
});

/**
 * O acesso do usuário desta requisição: o papel e se a conta está ligada.
 *
 * ⚠️ AS DUAS COISAS SAEM DA MESMA CONSULTA, e é por isso que a checagem de
 * conta inativa não custa nada. Separá-las em duas funções daria duas idas ao
 * banco no layout de TODAS as telas do sistema — e a segunda pergunta
 * ("continua ativo?") é justamente a que não pode ser cara, senão vira
 * tentação de pular.
 *
 * Memoizado por request com `cache()`.
 */
const getCurrentAccess = cache(async (): Promise<{ role: Role; active: boolean }> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Anônimo: papel de fallback e "ativo". O `active: true` aqui NÃO é permissão
  // nenhuma — quem barra anônimo é o middleware, e `viewer` não lê nada. Dizer
  // "inativo" faria a tela de conta desligada aparecer para quem só está
  // deslogado, que é uma mensagem errada e assustadora.
  if (!user) return { role: FALLBACK_ROLE, active: true };

  // `.returns<>()` é um hint de tipo necessário por causa do descompasso de
  // generics entre @supabase/ssr e @supabase/supabase-js; sem ele o `from()`
  // pode inferir `never`. Remover quando os pacotes alinharem.
  let { data, error } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", user.id)
    .returns<{ role: string; active?: boolean }[]>()
    .maybeSingle();

  /*
    ⚠️ COMPATIBILIDADE COM O CÓDIGO NO AR ANTES DA MIGRATION — e este bloco
    existe para evitar uma queda TOTAL, não por capricho.

    `profiles.active` nasce em 20260831000100_admin_users.sql. Se este código
    subir antes de a migration rodar, a consulta acima falha com 42703 ("column
    does not exist"), o caminho de erro devolve `viewer`, e TODO MUNDO — inclusive
    quem administra — perde acesso a tudo ao mesmo tempo. A saída seria rodar a
    migration às cegas, sem conseguir abrir o sistema para conferir.

    Com este retry o sistema segue funcionando exatamente como antes até o SQL
    rodar. Depois que rodar, ele nunca mais é alcançado.

    REMOVER quando a migration estiver aplicada em produção — um caminho que
    não roga mais é um caminho que ninguém testa.
  */
  if (error?.code === "42703") {
    console.error(
      "[current-user] profiles.active ainda não existe — rode a migration 20260831000100_admin_users.sql. Tratando todas as contas como ativas.",
    );
    ({ data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .returns<{ role: string; active?: boolean }[]>()
      .maybeSingle());
  }

  if (error || !data) {
    console.error(
      `[current-user] perfil não encontrado para ${user.id}: ${error?.message ?? "sem linha"}`,
    );
    return { role: FALLBACK_ROLE, active: true };
  }

  // ⚠️ `!== false`, e não `=== true`. A coluna pode vir AUSENTE (o retry acima),
  // e ausente significa "este banco ainda não sabe inativar", não "inativo".
  // Fechar aqui trancaria todo mundo para fora pela razão errada; quem fecha de
  // verdade é o banco, onde `current_app_role()` já devolve `viewer` para o
  // inativo mesmo que esta linha se engane.
  const active = data.active !== false;

  if (!isRole(data.role)) {
    console.error(`[current-user] role inválido "${data.role}" para ${user.id} — usando fallback`);
    return { role: FALLBACK_ROLE, active };
  }

  return { role: data.role, active };
});

/**
 * Papel do usuário autenticado, lido de `profiles.role` (protegido por RLS).
 * Cai em `FALLBACK_ROLE` se anônimo/sem perfil/role inválido.
 *
 * ⚠️ CONTA INATIVA DEVOLVE `viewer`, e não o papel guardado. É o mesmo que
 * `current_app_role()` faz no banco desde 20260831000100_admin_users.sql — as
 * duas camadas precisam contar a mesma história, senão a tela ofereceria botões
 * que o Postgres recusa.
 */
export const getCurrentUserRole = cache(async (): Promise<Role> => {
  const { role, active } = await getCurrentAccess();
  return active ? role : FALLBACK_ROLE;
});

/** A conta está ligada. Falsa = o acesso foi desligado por um administrador. */
export const isCurrentUserActive = cache(async (): Promise<boolean> => {
  const { active } = await getCurrentAccess();
  return active;
});
