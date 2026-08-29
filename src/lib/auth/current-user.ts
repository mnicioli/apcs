import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { permissionsOf } from "@/lib/rbac/rbac.config";
import { ensureRoleMatrix } from "@/lib/services/roles";
import type { Permission, RoleKey } from "@/lib/rbac/rbac.types";
import { toSessionUser, type SessionUser } from "./session";

/**
 * Cargo de fallback quando o caminho feliz falha — DENY-BY-DEFAULT.
 * `viewer` tem zero permissões na matriz. Se algo der errado (anônimo, perfil
 * ausente, cargo inválido), o RBAC falha FECHADO, nunca aberto.
 */
const FALLBACK_ROLE: RoleKey = "viewer";

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
const getCurrentAccess = cache(async (): Promise<{ role: RoleKey; active: boolean }> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Anônimo: papel de fallback e "ativo". O `active: true` aqui NÃO é permissão
  // nenhuma — quem barra anônimo é o middleware, e `viewer` não lê nada. Dizer
  // "inativo" faria a tela de conta desligada aparecer para quem só está
  // deslogado, que é uma mensagem errada e assustadora.
  //
  // ⚠️ SAI ANTES DE CARREGAR A MATRIZ, de propósito: a policy de `app_roles` é
  // `to authenticated`, então um anônimo leria zero linhas — e um retrato vazio
  // é justamente o que `applyRoleDefinitions` recusa. Não vale gastar a
  // consulta para ser recusado.
  if (!user) return { role: FALLBACK_ROLE, active: true };

  // ⚠️ ISTO É O QUE FAZ `hasPermission` PODER SER SÍNCRONA no resto do sistema.
  // Toda tela do servidor passa por `getCurrentUserRole()` antes de perguntar
  // sobre permissão, e é aqui que o retrato da matriz é garantido. Ver
  // src/lib/rbac/rbac.runtime.ts.
  await ensureRoleMatrix();

  // `.returns<>()` é um hint de tipo necessário por causa do descompasso de
  // generics entre @supabase/ssr e @supabase/supabase-js; sem ele o `from()`
  // pode inferir `never`. Remover quando os pacotes alinharem.
  let { data, error } = await supabase
    .from("profiles")
    .select("role, active, role_key")
    .eq("id", user.id)
    .returns<{ role: string; active?: boolean; role_key?: string | null }[]>()
    .maybeSingle();

  /*
    ⚠️ MESMA REDE DE SEGURANÇA DE `active`, PARA A COLUNA `role_key`.

    Ela nasce em 20260903000100_custom_roles.sql. Se este código subir antes de
    a migration rodar, a consulta acima falha com 42703 e o caminho de erro
    devolve `viewer` para TODO MUNDO — inclusive para quem administra, que
    ficaria sem como abrir o sistema para rodar a migration.

    Com este retry o sistema segue funcionando como antes até o SQL rodar:
    ninguém tem cargo, e o papel do enum decide tudo, exatamente como decidia.

    REMOVER quando a migration estiver aplicada em produção.
  */
  if (error?.code === "42703") {
    console.error(
      "[current-user] profiles.role_key ainda não existe — rode a migration 20260903000100_custom_roles.sql. Usando o papel do enum como cargo.",
    );
    ({ data, error } = await supabase
      .from("profiles")
      .select("role, active")
      .eq("id", user.id)
      .returns<{ role: string; active?: boolean; role_key?: string | null }[]>()
      .maybeSingle());
  }

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

  // ⚠️ O CARGO É `role_key`; `role` É O PAPEL-BASE. Quando a coluna ainda não
  // existe (o retry acima), o papel do enum FAZ AS VEZES de cargo — e funciona,
  // porque os quatro cargos embutidos têm exatamente as chaves do enum.
  const cargo = data.role_key ?? data.role;

  if (typeof cargo !== "string" || cargo.length === 0) {
    console.error(`[current-user] cargo inválido para ${user.id} — usando fallback`);
    return { role: FALLBACK_ROLE, active };
  }

  return { role: cargo, active };
});

/**
 * O CARGO do usuário autenticado, lido de `profiles.role_key` (protegido por
 * RLS). Cai em `FALLBACK_ROLE` se anônimo, sem perfil ou sem cargo.
 *
 * ⚠️ O NOME CONTINUA "ROLE" POR CAUSA DAS CEM CHAMADAS, mas o que ele devolve
 * desde 20260903000100 é a chave do CARGO — que pode ser um dos quatro
 * embutidos (`admin`, `comercial`, …) ou um criado pela APCS
 * (`editor-conteudo`). Quem precisa do papel-base — o que a RLS enxerga — não
 * pergunta aqui: pergunta ao banco, que é quem o guarda.
 *
 * ⚠️ CONTA INATIVA DEVOLVE `viewer`, e não o cargo guardado. É o mesmo que
 * `current_app_role()` faz no banco desde 20260831000100_admin_users.sql — as
 * duas camadas precisam contar a mesma história, senão a tela ofereceria botões
 * que o Postgres recusa.
 */
export const getCurrentUserRole = cache(async (): Promise<RoleKey> => {
  const { role, active } = await getCurrentAccess();
  return active ? role : FALLBACK_ROLE;
});

/**
 * Tudo o que o cargo desta pessoa abre.
 *
 * Existe para os componentes de CLIENTE, que não conseguem consultar a matriz:
 * o servidor resolve a lista e a passa como propriedade. É o que a Sidebar
 * recebe — ver o comentário de `rbac.runtime.ts` sobre por que
 * `hasPermission` não funciona no navegador para cargos criados pela APCS.
 */
export const getCurrentPermissions = cache(async (): Promise<readonly Permission[]> => {
  return permissionsOf(await getCurrentUserRole());
});

/** A conta está ligada. Falsa = o acesso foi desligado por um administrador. */
export const isCurrentUserActive = cache(async (): Promise<boolean> => {
  const { active } = await getCurrentAccess();
  return active;
});
