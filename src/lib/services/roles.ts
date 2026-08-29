import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { untyped } from "@/lib/supabase/untyped";
import {
  applyRoleDefinitions,
  currentRoleDefinitions,
  type RoleDefinition,
} from "@/lib/rbac/rbac.runtime";
import {
  isRole,
  ROLE_LABELS,
  type Permission,
  type Role,
  type RoleKey,
} from "@/lib/rbac/rbac.types";

/**
 * SERVICE = leitura. Os CARGOS e o TETO de cada papel-base.
 *
 * Ver a migration 20260903000100_custom_roles.sql: um cargo se apoia num papel
 * do enum (`base_role`) e só pode conter permissões que a base já tem. Esta
 * camada só lê e entrega — quem impõe a regra é o banco.
 */

interface RoleRow {
  key: string;
  label: string;
  description: string | null;
  base_role: string;
  is_builtin: boolean;
  sort_order: number;
  app_role_permissions: { permission: string }[] | null;
}

const ROLE_COLUMNS =
  "key, label, description, base_role, is_builtin, sort_order, app_role_permissions(permission)";

function toRoleDefinition(linha: RoleRow): RoleDefinition {
  return {
    key: linha.key,
    label: linha.label,
    description: linha.description,
    // Papel-base que saiu do enum (só aconteceria com um papel aposentado):
    // cai em `viewer`, que não abre nada. Falha FECHADA.
    baseRole: isRole(linha.base_role) ? linha.base_role : "viewer",
    isBuiltin: linha.is_builtin,
    sortOrder: linha.sort_order,
    permissions: (linha.app_role_permissions ?? []).map((p) => p.permission as Permission),
  };
}

/* -------------------------------------------------------------------------- */
/* O carregamento que mantém `hasPermission` síncrona                          */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ QUINZE SEGUNDOS, E O NÚMERO TEM RAZÃO DE SER.
 *
 * A matriz é consultada no começo de TODA tela do sistema. Sem cache, seria uma
 * ida ao banco a mais em cada uma. Com cache eterno, um ajuste de cargo levaria
 * até a próxima reinicialização para valer — e quem ajustou ficaria olhando a
 * tela sem entender.
 *
 * Quinze segundos é curto o bastante para ninguém notar a defasagem e longo o
 * bastante para o cache servir. Além disso, `invalidateRoleCache()` derruba o
 * retrato na hora, do lado de quem acabou de salvar.
 */
const TTL_MS = 15_000;

let carregadoEm = 0;
let carregando: Promise<void> | null = null;

async function carregar(): Promise<void> {
  try {
    const supabase = await createClient();
    const { data, error } = await untyped(supabase)
      .from("app_roles")
      .select(ROLE_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true })
      .returns<RoleRow[]>();

    if (error) throw error;

    // `applyRoleDefinitions` recusa lista vazia — ver o comentário lá. Aqui só
    // se registra o horário quando o retrato realmente entrou.
    if (applyRoleDefinitions((data ?? []).map(toRoleDefinition))) {
      carregadoEm = Date.now();
    }
  } catch (erro) {
    // ⚠️ NÃO PROPAGA, E NÃO APAGA O RETRATO ANTERIOR. Uma falha de rede na
    // consulta da matriz derrubaria todas as telas do sistema ao mesmo tempo;
    // continuar servindo o retrato de quinze segundos atrás não derruba nada.
    // Sem retrato nenhum, `hasPermission` cai na matriz do código.
    console.error(
      `[roles] não foi possível ler a matriz de cargos: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
  }
}

/**
 * Garante que `hasPermission` tem o que consultar.
 *
 * Chamada por `getCurrentUserRole()`, que é por onde TODA tela do servidor
 * passa antes de perguntar qualquer coisa sobre permissão. É esse encadeamento
 * que faz o estado de módulo de `rbac.runtime` ser seguro — ver o comentário
 * de lá.
 */
export async function ensureRoleMatrix(): Promise<readonly RoleDefinition[]> {
  const atual = currentRoleDefinitions();
  if (atual && Date.now() - carregadoEm < TTL_MS) return atual;

  // Uma carga por vez: dez telas abrindo juntas não viram dez consultas.
  carregando ??= carregar().finally(() => {
    carregando = null;
  });
  await carregando;

  return currentRoleDefinitions() ?? [];
}

/** Derruba o cache — chamada por quem acabou de escrever um cargo. */
export function invalidateRoleCache(): void {
  carregadoEm = 0;
}

/* -------------------------------------------------------------------------- */
/* Leituras das telas                                                          */
/* -------------------------------------------------------------------------- */

/** Todos os cargos, na ordem em que a matriz os mostra. Memoizado por request. */
export const listRoleDefinitions = cache(async (): Promise<readonly RoleDefinition[]> => {
  return ensureRoleMatrix();
});

/**
 * O TETO de cada papel-base: o que a RLS realmente entrega.
 *
 * É o que deixa a tela desabilitar — em vez de simplesmente recusar depois — as
 * permissões que o papel-base escolhido não tem. Sem isso, quem monta um cargo
 * marcaria uma caixa e só descobriria no "Salvar" que aquilo não era possível.
 */
export async function getRoleCeilings(): Promise<Map<Role, Set<Permission>>> {
  const supabase = await createClient();
  const { data, error } = await untyped(supabase)
    .from("app_role_ceilings")
    .select("base_role, permission")
    .returns<{ base_role: string; permission: string }[]>();

  if (error) throw error;

  const teto = new Map<Role, Set<Permission>>();
  for (const linha of data ?? []) {
    if (!isRole(linha.base_role)) continue;
    const atual = teto.get(linha.base_role) ?? new Set<Permission>();
    atual.add(linha.permission as Permission);
    teto.set(linha.base_role, atual);
  }
  return teto;
}

/**
 * Quantas contas ATIVAS têm cada cargo.
 *
 * ⚠️ SÓ ATIVAS, pelo mesmo motivo de sempre: um cargo com três pessoas, todas
 * desligadas, tem zero pessoas para a pergunta que a tela faz ("quem consegue
 * publicar hoje?").
 */
export async function countActiveUsersByRole(): Promise<Map<RoleKey, number>> {
  const supabase = await createClient();
  const { data, error } = await untyped(supabase)
    .from("profiles")
    .select("role_key")
    .eq("active", true)
    .returns<{ role_key: string | null }[]>();

  if (error) throw error;

  const contagem = new Map<RoleKey, number>();
  for (const linha of data ?? []) {
    const chave = linha.role_key ?? "viewer";
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }
  return contagem;
}

/**
 * O nome do cargo, como a pessoa o vê.
 *
 * ⚠️ CAI NO RÓTULO DO CÓDIGO E, EM ÚLTIMO CASO, NA PRÓPRIA CHAVE. Um cabeçalho
 * mostrando `editor-conteudo` é feio; um cabeçalho vazio faz parecer que a
 * pessoa não tem cargo nenhum.
 */
export async function getRoleLabel(key: RoleKey): Promise<string> {
  const cargos = await listRoleDefinitions();
  const encontrado = cargos.find((cargo) => cargo.key === key);
  if (encontrado) return encontrado.label;
  return isRole(key) ? ROLE_LABELS[key] : key;
}
