import type { Permission, Role, RoleKey } from "./rbac.types";

/**
 * O RETRATO VIVO DA MATRIZ DE ACESSO — o que os cargos abrem HOJE.
 *
 * `PERMISSION_MATRIX` (rbac.config.ts) é o que está escrito no código. Desde
 * 20260903000100_custom_roles.sql, quem decide de verdade é a tabela
 * `app_role_permissions` no banco: a APCS cria cargos e ajusta o que cada um
 * abre sem subir código. Este módulo guarda o resultado dessa consulta para que
 * `hasPermission` continue SÍNCRONA.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ POR QUE UM ESTADO DE MÓDULO, QUE NORMALMENTE É UMA MÁ IDEIA
 * ----------------------------------------------------------------------------
 * `hasPermission(cargo, permissao)` é chamada em mais de cem lugares, muitos
 * deles dentro de JSX (`{pode && <Button/>}`), onde não dá para esperar uma
 * promessa. Transformá-la em `async` mudaria essas cem chamadas — e mudaria
 * também os componentes de cliente, que não têm como consultar o banco.
 *
 * O que é guardado aqui NÃO É DADO DE USUÁRIO: é a configuração da matriz, a
 * mesma para todo mundo. Duas requisições simultâneas não têm o que embaralhar.
 * O pior caso de concorrência é uma tela desenhar com a matriz de meio segundo
 * atrás, logo depois de um administrador tê-la mudado.
 *
 * ⚠️ A REGRA QUE MANTÉM ISSO HONESTO: quem for consultar `hasPermission` no
 * servidor precisa ter passado por `getCurrentUserRole()` antes — e passou, por
 * construção, porque é de lá que sai o cargo. É `getCurrentUserRole` que garante
 * o carregamento.
 *
 * Sem retrato (no navegador, num teste, antes da primeira consulta),
 * `hasPermission` cai na matriz do código. Ver o comentário lá.
 */

/** Um cargo, como a interface precisa dele. */
export interface RoleDefinition {
  key: RoleKey;
  label: string;
  description: string | null;
  /** O papel do enum que a RLS enxerga. É o teto do que este cargo pode abrir. */
  baseRole: Role;
  /** Espelha um papel do enum. Não pode ser excluído; `admin` nem editado. */
  isBuiltin: boolean;
  sortOrder: number;
  permissions: readonly Permission[];
}

interface RoleSnapshot {
  definitions: readonly RoleDefinition[];
  matrix: ReadonlyMap<RoleKey, ReadonlySet<Permission>>;
}

let snapshot: RoleSnapshot | null = null;

/**
 * Guarda o retrato recém-lido do banco.
 *
 * ⚠️ RECUSA LISTA VAZIA, e esta linha vale um parágrafo. A tabela `app_roles`
 * sempre tem pelo menos os quatro cargos embutidos, então "zero cargos" nunca é
 * um fato: é uma consulta que não trouxe nada — RLS negando para quem não está
 * logado, uma migration que ainda não rodou. Aceitar o vazio trocaria a matriz
 * inteira por "ninguém pode nada" no processo inteiro, e o sintoma seria todo
 * mundo vendo um sistema vazio sem nenhum erro na tela.
 */
export function applyRoleDefinitions(definitions: readonly RoleDefinition[]): boolean {
  if (definitions.length === 0) return false;

  const matrix = new Map<RoleKey, ReadonlySet<Permission>>();
  for (const definicao of definitions) {
    matrix.set(definicao.key, new Set(definicao.permissions));
  }

  snapshot = { definitions, matrix };
  return true;
}

/** O retrato atual, ou `null` se ainda não houve nenhum. */
export function currentRoleMatrix(): ReadonlyMap<RoleKey, ReadonlySet<Permission>> | null {
  return snapshot?.matrix ?? null;
}

/** Os cargos do retrato atual, ou `null` se ainda não houve nenhum. */
export function currentRoleDefinitions(): readonly RoleDefinition[] | null {
  return snapshot?.definitions ?? null;
}

/** Só para teste: volta ao estado de "nunca consultei o banco". */
export function resetRoleSnapshot(): void {
  snapshot = null;
}
