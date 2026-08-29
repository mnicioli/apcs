import {
  MEMBERSHIP_APPLICATION_STATUSES,
  MEMBER_STATUSES,
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
}

export function parseMemberParams(params: RawSearchParams): MemberListParams {
  const status = first(params, "status");
  const page = Number(first(params, "page") ?? "1");

  return {
    status:
      status && (MEMBER_STATUSES as readonly string[]).includes(status)
        ? (status as MemberStatus)
        : "all",
    search: (first(params, "q") ?? "").trim(),
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
  };
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
  atual: { status: string; search: string; page: number },
  mudanca: Partial<{ status: string; search: string; page: number }>,
): string {
  const proximo = { ...atual, ...mudanca };
  if (mudanca.status !== undefined || mudanca.search !== undefined) proximo.page = 1;

  const query = new URLSearchParams();
  if (proximo.status && proximo.status !== "all") query.set("status", proximo.status);
  if (proximo.search) query.set("q", proximo.search);
  if (proximo.page > 1) query.set("page", String(proximo.page));

  const texto = query.toString();
  return texto ? `${base}?${texto}` : base;
}
