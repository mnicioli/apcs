import {
  DEFAULT_REGISTRATION_SORT,
  EMPTY_REGISTRATION_BOARD_FILTERS,
  isConfirmationFilter,
  isRegistrationSort,
  type ConfirmationFilter,
  type RegistrationBoardFilters,
} from "./event.landing.types";

/**
 * A SERIALIZAÇÃO DOS FILTROS DE INSCRIÇÕES — num lugar só.
 *
 * ============================================================================
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE, E NÃO É "ORGANIZAÇÃO".
 * ============================================================================
 * Cinco lugares precisam concordar sobre o que significa `?q=abc&conf=confirmed`:
 * a página (que LÊ), os filtros (que ESCREVEM), a paginação (que troca só o
 * `page`), a ordenação (que troca só o `sort`) e a EXPORTAÇÃO (que precisa
 * receber exatamente o mesmo recorte — §19).
 *
 * Com a leitura e a escrita espalhadas, o modo de falhar é silencioso e é o
 * pior possível: exportar um arquivo que não corresponde ao que está na tela.
 * Ninguém confere linha por linha um CSV de trezentas pessoas.
 *
 * Aqui `parse` e `href` são inversas uma da outra, e há teste que prova isso.
 */

/** O nome de cada filtro na URL. Curto, porque a URL é lida e colada. */
const PARAM = {
  query: "q",
  confirmation: "conf",
  from: "from",
  to: "to",
  sort: "sort",
  page: "page",
} as const;

export function registrationsHref(page = 1, query = ""): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set(PARAM.query, query.trim());
  if (page > 1) params.set(PARAM.page, String(page));
  const busca = params.toString();
  return busca ? `/events/registrations?${busca}` : "/events/registrations";
}

export function eventRegistrationsHref(eventId: string, filters: RegistrationBoardFilters): string {
  return `/events/registrations/${eventId}${queryString(filters)}`;
}

/**
 * O endereço da exportação, com o MESMO recorte da tela (§19).
 *
 * ⚠️ É A MESMA `queryString`, e é isso que faz o §19 valer. "Exportar somente os
 * participantes correspondentes ao resultado atual" não é uma regra a lembrar:
 * o botão é um link montado pela mesma função que monta a paginação.
 *
 * `page` sai fora de propósito — a exportação leva o recorte inteiro, não a
 * página que está na tela.
 */
export function registrationsExportHref(
  eventId: string,
  filters: RegistrationBoardFilters,
): string {
  return `/events/registrations/${eventId}/export${queryString({ ...filters, page: 1 })}`;
}

function queryString(filters: RegistrationBoardFilters): string {
  const params = new URLSearchParams();
  if (filters.query.trim()) params.set(PARAM.query, filters.query.trim());
  if (filters.confirmation !== "all") params.set(PARAM.confirmation, filters.confirmation);
  if (filters.from) params.set(PARAM.from, filters.from);
  if (filters.to) params.set(PARAM.to, filters.to);
  if (filters.sort !== DEFAULT_REGISTRATION_SORT) params.set(PARAM.sort, filters.sort);
  if (filters.page > 1) params.set(PARAM.page, String(filters.page));

  const busca = params.toString();
  return busca ? `?${busca}` : "";
}

/** O que veio na URL. */
export type RegistrationSearchParams = Partial<Record<string, string | string[]>>;

/**
 * Lê os filtros da URL, sem nunca falhar.
 *
 * ⚠️ VALOR DESCONHECIDO CAI NO PADRÃO em vez de derrubar a tela ou devolver
 * lista vazia. Uma URL colada errada, ou de uma versão anterior do sistema, não
 * deve parecer "não há inscrições neste evento" — que é a conclusão que alguém
 * tiraria de uma grid vazia sem explicação.
 */
export function parseRegistrationFilters(
  params: RegistrationSearchParams,
): RegistrationBoardFilters {
  const um = (chave: string): string => {
    const valor = params[chave];
    return (Array.isArray(valor) ? valor[0] : valor) ?? "";
  };

  const confirmation = um(PARAM.confirmation);
  const sort = um(PARAM.sort);
  const page = Number.parseInt(um(PARAM.page), 10);

  return {
    ...EMPTY_REGISTRATION_BOARD_FILTERS,
    query: um(PARAM.query),
    confirmation: isConfirmationFilter(confirmation) ? (confirmation as ConfirmationFilter) : "all",
    from: isCalendarDate(um(PARAM.from)) ? um(PARAM.from) : "",
    to: isCalendarDate(um(PARAM.to)) ? um(PARAM.to) : "",
    sort: isRegistrationSort(sort) ? sort : DEFAULT_REGISTRATION_SORT,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/**
 * AAAA-MM-DD, e nada mais.
 *
 * A data entra numa consulta ao banco. O driver parametriza (não há injeção
 * possível por aqui), mas um texto que não é data faria o Postgres recusar a
 * chamada inteira — e a tela quebraria por causa de um caractere na URL.
 */
function isCalendarDate(valor: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

export function hasActiveFilters(filters: RegistrationBoardFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.confirmation !== "all" ||
    filters.from !== "" ||
    filters.to !== ""
  );
}
