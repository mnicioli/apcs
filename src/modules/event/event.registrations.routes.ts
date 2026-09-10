import {
  DEFAULT_PRESENCE_SORT,
  DEFAULT_REGISTRATION_SORT,
  EMPTY_PRESENCE_BOARD_FILTERS,
  EMPTY_REGISTRATION_BOARD_FILTERS,
  isConfirmationFilter,
  isPresenceFilter,
  isRegistrationSort,
  type ConfirmationFilter,
  type PresenceFilter,
  type RegistrationBoardFilters,
  type RegistrationSort,
} from "./event.landing.types";

/**
 * A SERIALIZAÇÃO DOS FILTROS DE INSCRIÇÕES E DE PRESENÇA — num lugar só.
 *
 * ============================================================================
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE, E NÃO É "ORGANIZAÇÃO".
 * ============================================================================
 * Cinco lugares precisam concordar sobre o que significa `?q=abc&conf=confirmed`:
 * a página (que LÊ), os filtros (que ESCREVEM), a paginação (que troca só o
 * `page`), a ordenação (que troca só o `sort`) e a EXPORTAÇÃO (que precisa
 * receber exatamente o mesmo recorte — §19 do Prompt 4).
 *
 * Com a leitura e a escrita espalhadas, o modo de falhar é silencioso e é o
 * pior possível: exportar um arquivo que não corresponde ao que está na tela.
 * Ninguém confere linha por linha um CSV de trezentas pessoas.
 *
 * Aqui `parse` e `href` são inversas uma da outra, e há teste que prova isso.
 *
 * ============================================================================
 * ⚠️ A LISTA DE PRESENÇA ENTRA AQUI, E NÃO NUM ARQUIVO NOVO.
 * ============================================================================
 * As duas telas leem a MESMA consulta do banco (`event_registrations_board`) e
 * carregam o MESMO conjunto de filtros — busca, confirmação, presença, período,
 * ordenação e página. Um segundo serializador seria uma segunda tradução dos
 * mesmos parâmetros, e a que mudasse primeiro deixaria a outra achando gente
 * diferente da que a sua tela mostra.
 *
 * O que difere entre as duas é UMA COISA: a ordenação padrão. Inscrições abre
 * em "mais recentes"; a lista de presença abre em ordem alfabética de pessoa,
 * porque na porta do evento a pergunta é sempre "achar o fulano". Por isso
 * `queryString` recebe qual é o padrão daquela tela — sem isso, o `sort` da
 * presença apareceria em toda URL, ou o da inscrição sumiria da dela.
 */

/** O nome de cada filtro na URL. Curto, porque a URL é lida e colada. */
const PARAM = {
  query: "q",
  confirmation: "conf",
  presence: "pres",
  from: "from",
  to: "to",
  sort: "sort",
  page: "page",
} as const;

export function registrationsHref(page = 1, query = ""): string {
  return listaDeEventosHref("/events/registrations", page, query);
}

export function eventRegistrationsHref(eventId: string, filters: RegistrationBoardFilters): string {
  return `/events/registrations/${eventId}${queryString(filters, DEFAULT_REGISTRATION_SORT)}`;
}

/** A tela inicial da Lista de Presença: os eventos, para escolher um (§8). */
export function presenceHref(page = 1, query = ""): string {
  return listaDeEventosHref("/events/presence", page, query);
}

/**
 * A lista de presença de UM evento.
 *
 * ⚠️ O EVENTO VAI NA ROTA, e não em query param — é o mesmo padrão de
 * `/events/registrations/[eventId]`, e o escopo pede explicitamente para não
 * inventar uma navegação inconsistente. A consequência prática é que o endereço
 * é compartilhável e o `notFound()` de um id inventado acontece no lugar certo.
 */
export function eventPresenceHref(eventId: string, filters: RegistrationBoardFilters): string {
  return `/events/presence/${eventId}${queryString(filters, DEFAULT_PRESENCE_SORT)}`;
}

/**
 * O endereço da exportação, com o MESMO recorte da tela (§19 do Prompt 4).
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
  return `/events/registrations/${eventId}/export${queryString(
    { ...filters, page: 1 },
    DEFAULT_REGISTRATION_SORT,
  )}`;
}

function listaDeEventosHref(base: string, page: number, query: string): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set(PARAM.query, query.trim());
  if (page > 1) params.set(PARAM.page, String(page));
  const busca = params.toString();
  return busca ? `${base}?${busca}` : base;
}

/**
 * Só o que difere do padrão entra na URL.
 *
 * ⚠️ `defaultSort` É PARÂMETRO PORQUE AS DUAS TELAS TÊM PADRÕES DIFERENTES. Ver
 * o cabeçalho: com um padrão fixo, a lista de presença carregaria `sort` em
 * todo endereço que ela monta — inclusive nos da paginação, que é onde uma URL
 * limpa mais ajuda quem cola o link numa conversa.
 */
function queryString(filters: RegistrationBoardFilters, defaultSort: RegistrationSort): string {
  const params = new URLSearchParams();
  if (filters.query.trim()) params.set(PARAM.query, filters.query.trim());
  if (filters.confirmation !== "all") params.set(PARAM.confirmation, filters.confirmation);
  if (filters.presence !== "all") params.set(PARAM.presence, filters.presence);
  if (filters.from) params.set(PARAM.from, filters.from);
  if (filters.to) params.set(PARAM.to, filters.to);
  if (filters.sort !== defaultSort) params.set(PARAM.sort, filters.sort);
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
  return leFiltros(params, EMPTY_REGISTRATION_BOARD_FILTERS);
}

/** O mesmo, com a ordenação padrão da Lista de Presença. */
export function parsePresenceFilters(params: RegistrationSearchParams): RegistrationBoardFilters {
  return leFiltros(params, EMPTY_PRESENCE_BOARD_FILTERS);
}

function leFiltros(
  params: RegistrationSearchParams,
  vazios: RegistrationBoardFilters,
): RegistrationBoardFilters {
  const um = (chave: string): string => {
    const valor = params[chave];
    return (Array.isArray(valor) ? valor[0] : valor) ?? "";
  };

  const confirmation = um(PARAM.confirmation);
  const presence = um(PARAM.presence);
  const sort = um(PARAM.sort);
  const page = Number.parseInt(um(PARAM.page), 10);

  return {
    ...vazios,
    query: um(PARAM.query),
    confirmation: isConfirmationFilter(confirmation) ? (confirmation as ConfirmationFilter) : "all",
    presence: isPresenceFilter(presence) ? (presence as PresenceFilter) : "all",
    from: isCalendarDate(um(PARAM.from)) ? um(PARAM.from) : "",
    to: isCalendarDate(um(PARAM.to)) ? um(PARAM.to) : "",
    // ⚠️ O PADRÃO VEM DE `vazios`, e não da constante de Inscrições: é assim que
    // uma URL sem `sort` abre a presença em ordem alfabética e as inscrições nas
    // mais recentes, com a mesma função lendo as duas.
    sort: isRegistrationSort(sort) ? sort : vazios.sort,
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
    filters.presence !== "all" ||
    filters.from !== "" ||
    filters.to !== ""
  );
}
