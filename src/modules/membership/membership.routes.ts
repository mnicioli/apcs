import {
  DEFAULT_MEMBER_SORT,
  MEMBERSHIP_APPLICATION_STATUSES,
  MEMBER_SORT_DEFAULT_ASCENDING,
  MEMBER_SORT_FIELDS,
  MEMBER_STATUSES,
  type MemberSort,
  type MemberSortField,
  type MemberStatus,
  type MembershipApplicationStatus,
} from "./membership.types";

/**
 * Rotas e ESTADO DE TELA de Associados.
 *
 * ⚠️ Os filtros moram na URL, não em estado de componente — mesmo desenho de
 * Enquetes e Palestras: as listas são renderizadas no SERVIDOR, então é a URL
 * que precisa mudar para vir gente nova do banco; e um recorte filtrado pode
 * ser mandado por link e sobrevive ao F5.
 *
 * ⚠️ As rotas do CRM são em inglês (`/members`), como todas as outras. A landing
 * PÚBLICA é a exceção: ela mora em `/associe-se`, em português, porque é um
 * endereço de divulgação — vai em cartaz, em rodapé de e-mail e na boca das
 * pessoas, e ninguém dita "barra members" no telefone.
 */

export const MEMBERS_BASE = "/members";
export const APPLICATIONS_BASE = "/members/applications";

/**
 * O `[id]` da rota tem forma de uuid?
 *
 * Sem esta checagem, `/members/applications/nao-e-uuid` iria direto ao banco, o
 * Postgres recusaria com "invalid input syntax for type uuid", o service
 * lançaria e a pessoa veria a tela de FALHA DO SISTEMA para o que é só um
 * endereço que não existe.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMembershipId(value: string): boolean {
  return UUID.test(value);
}

export function applicationHref(id: string): string {
  return `${APPLICATIONS_BASE}/${id}`;
}

/**
 * A ficha do associado.
 *
 * ⚠️ `/members/[id]` e `/members/applications` são rotas IRMÃS, e a ordem em que
 * o Next resolve importa: `applications` é um segmento estático e vence o
 * dinâmico `[id]`, então `/members/applications` continua sendo a caixa de
 * entrada e não uma ficha de associado com id "applications". Não é sorte — é
 * regra do App Router (estático antes de dinâmico) —, mas é o tipo de coisa que
 * ninguém lembra ao renomear uma pasta.
 */
export function memberHref(id: string): string {
  return `${MEMBERS_BASE}/${id}`;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(params: RawSearchParams, key: string): string | undefined {
  const valor = params[key];
  return Array.isArray(valor) ? valor[0] : valor;
}

export interface ApplicationListParams {
  status: MembershipApplicationStatus | "all";
  search: string;
  page: number;
}

export function parseApplicationParams(params: RawSearchParams): ApplicationListParams {
  const status = first(params, "status");
  const page = Number(first(params, "page") ?? "1");

  return {
    // Qualquer valor fora da lista vira "todas" em silêncio, e é de propósito:
    // um `?status=xyz` colado errado deve mostrar a tela, não um erro.
    status:
      status && (MEMBERSHIP_APPLICATION_STATUSES as readonly string[]).includes(status)
        ? (status as MembershipApplicationStatus)
        : "all",
    search: (first(params, "q") ?? "").trim(),
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
  };
}

export interface MemberListParams {
  status: MemberStatus | "all";
  search: string;
  page: number;
  sort: MemberSort;
}

export function parseMemberParams(params: RawSearchParams): MemberListParams {
  const status = first(params, "status");
  const page = Number(first(params, "page") ?? "1");
  const campo = first(params, "sort");
  const field = (
    campo && (MEMBER_SORT_FIELDS as readonly string[]).includes(campo)
      ? campo
      : DEFAULT_MEMBER_SORT.field
  ) as MemberSortField;
  const dir = first(params, "dir");

  return {
    status:
      status && (MEMBER_STATUSES as readonly string[]).includes(status)
        ? (status as MemberStatus)
        : "all",
    search: (first(params, "q") ?? "").trim(),
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
    // Mesmo silêncio do `status`: um `?sort=xyz` colado errado cai no padrão em
    // vez de virar erro. É estado de tela, não comando.
    sort: {
      field,
      ascending:
        dir === "asc" ? true : dir === "desc" ? false : MEMBER_SORT_DEFAULT_ASCENDING[field],
    },
  };
}

/**
 * A ordem em parâmetros de URL — o ÚNICO lugar que sabe como ela se escreve.
 *
 * Devolve LISTA VAZIA para a ordem padrão: a lista alfabética, que é o caso
 * comum, continua morando em `/members` limpo. Um endereço cheio de parâmetros
 * que só repetem o padrão é ilegível e não se distingue de um recorte de
 * verdade.
 *
 * Existe como função (e não inline no `listHref`) porque o formulário de busca
 * precisa dos MESMOS parâmetros como `<input type="hidden">` — um `<form
 * method="get">` reescreve a query inteira, e sem eles buscar dentro de uma
 * lista ordenada por data jogaria a pessoa de volta para a alfabética.
 */
export function memberSortParams(sort: MemberSort): { name: string; value: string }[] {
  const saida: { name: string; value: string }[] = [];
  if (sort.field !== DEFAULT_MEMBER_SORT.field) saida.push({ name: "sort", value: sort.field });
  if (sort.ascending !== MEMBER_SORT_DEFAULT_ASCENDING[sort.field]) {
    saida.push({ name: "dir", value: sort.ascending ? "asc" : "desc" });
  }
  return saida;
}

/** O endereço que troca a ordem — clicar no critério já ativo INVERTE o sentido. */
export function memberSortHref(atual: MemberListParams, field: MemberSortField): string {
  const ascending =
    atual.sort.field === field ? !atual.sort.ascending : MEMBER_SORT_DEFAULT_ASCENDING[field];
  return listHref(MEMBERS_BASE, atual, { sort: { field, ascending } });
}

/**
 * Monta a URL da lista preservando o que já estava aplicado.
 *
 * Trocar de aba SEMPRE volta para a página 1 — quem estava na página 4 de
 * "Aguardando" e clica em "Aprovadas" não quer a página 4 das aprovadas: quer o
 * começo da lista nova.
 */
export function listHref(
  base: string,
  atual: { status: string; search: string; page: number; sort?: MemberSort },
  mudanca: Partial<{ status: string; search: string; page: number; sort: MemberSort }>,
): string {
  const proximo = { ...atual, ...mudanca };
  // Trocar a ORDEM também volta para a página 1, pelo mesmo motivo de trocar de
  // aba: a página 4 de uma ordem que acabou de deixar de existir é um pedaço
  // arbitrário do meio da lista.
  if (mudanca.status !== undefined || mudanca.search !== undefined || mudanca.sort !== undefined) {
    proximo.page = 1;
  }

  const query = new URLSearchParams();
  if (proximo.status && proximo.status !== "all") query.set("status", proximo.status);
  if (proximo.search) query.set("q", proximo.search);
  if (proximo.sort) {
    for (const { name, value } of memberSortParams(proximo.sort)) query.set(name, value);
  }
  if (proximo.page > 1) query.set("page", String(proximo.page));

  const texto = query.toString();
  return texto ? `${base}?${texto}` : base;
}
