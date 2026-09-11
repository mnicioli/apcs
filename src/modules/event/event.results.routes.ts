import {
  EMPTY_RESULTS_FILTERS,
  isResultsFilter,
  isResultsTab,
  type ResultsFilter,
  type ResultsFilters,
  type ResultsTab,
} from "./event.results.types";
import { eventListHref } from "./event.registrations.routes";

/**
 * A SERIALIZAÇÃO DOS FILTROS DOS RESULTADOS.
 *
 * ⚠️ ARQUIVO PRÓPRIO, pelo mesmo motivo de `event.evaluation.routes.ts`: os
 * filtros são outros. Aqui existe uma ABA (§43 separa painel, respostas e
 * pendentes) e existem filtros de NOTA que dependem da pergunta geral —
 * nenhuma das duas coisas cabe nos serializadores vizinhos sem obrigá-los a
 * carregar campos que as telas deles ignoram.
 *
 * ⚠️ `parse` E `href` SÃO INVERSAS, e há teste que prova. É isso que faz a
 * EXPORTAÇÃO levar o mesmo recorte da tela (§27): o botão é um link montado por
 * `resultsExportHref`, e os dois lados leem os mesmos parâmetros.
 */

/** O nome de cada filtro na URL. Curto, porque a URL é lida e colada. */
const PARAM = {
  tab: "aba",
  query: "q",
  filter: "f",
  page: "page",
} as const;

/**
 * A tela inicial: os eventos, para escolher um (§3).
 *
 * ⚠️ DELEGA PARA `eventListHref` — ver o cabeçalho daquela função. As quatro
 * telas de seleção montam o mesmo endereço, e é ela que `EventSearchBox` chama
 * a partir do `basePath` que recebe.
 */
export function resultsHref(page = 1, query = ""): string {
  return eventListHref("/events/results", page, query);
}

/**
 * Os resultados de UM evento.
 *
 * ⚠️ O EVENTO VAI NA ROTA — o mesmo padrão de `/events/presence/[eventId]` e
 * `/events/evaluations/[eventId]`. O endereço fica compartilhável e o
 * `notFound()` de um id inventado acontece no lugar certo.
 */
export function eventResultsHref(
  eventId: string,
  filters: ResultsFilters = EMPTY_RESULTS_FILTERS,
): string {
  return `/events/results/${eventId}${queryString(filters)}`;
}

/**
 * O endereço da exportação, com o MESMO recorte da tela (§27).
 *
 * ⚠️ `page` SAI FORA de propósito: a exportação leva o recorte inteiro, e não a
 * página que está na tela ("não gerar Excel apenas com os dados atualmente
 * carregados na página quando houver paginação"). `tab` também sai — o arquivo é
 * sempre o das respostas.
 */
export function resultsExportHref(eventId: string, filters: ResultsFilters): string {
  const params = new URLSearchParams();
  if (filters.query.trim()) params.set(PARAM.query, filters.query.trim());
  if (filters.filter !== "all") params.set(PARAM.filter, filters.filter);
  const busca = params.toString();
  return `/events/results/${eventId}/export${busca ? `?${busca}` : ""}`;
}

/** O detalhe de uma resposta (§15). */
export function responseDetailHref(eventId: string, participantEvaluationId: string): string {
  return `/events/results/${eventId}/respostas/${participantEvaluationId}`;
}

/** Só o que difere do padrão entra na URL. */
function queryString(filters: ResultsFilters): string {
  const params = new URLSearchParams();
  if (filters.tab !== "dashboard") params.set(PARAM.tab, filters.tab);
  if (filters.query.trim()) params.set(PARAM.query, filters.query.trim());
  if (filters.filter !== "all") params.set(PARAM.filter, filters.filter);
  if (filters.page > 1) params.set(PARAM.page, String(filters.page));

  const busca = params.toString();
  return busca ? `?${busca}` : "";
}

export type ResultsSearchParams = Partial<Record<string, string | string[]>>;

/**
 * Lê os filtros da URL, sem nunca falhar.
 *
 * ⚠️ VALOR DESCONHECIDO CAI NO PADRÃO em vez de derrubar a tela ou devolver
 * lista vazia. Uma URL colada errada, ou de uma versão anterior do sistema, não
 * deve parecer "este evento não teve respostas" — que é a conclusão que alguém
 * tiraria de um painel zerado sem explicação.
 */
export function parseResultsFilters(params: ResultsSearchParams): ResultsFilters {
  const um = (chave: string): string => {
    const valor = params[chave];
    return (Array.isArray(valor) ? valor[0] : valor) ?? "";
  };

  const tab = um(PARAM.tab);
  const filtro = um(PARAM.filter);
  const page = Number.parseInt(um(PARAM.page), 10);

  return {
    tab: isResultsTab(tab) ? (tab as ResultsTab) : "dashboard",
    query: um(PARAM.query),
    filter: isResultsFilter(filtro) ? (filtro as ResultsFilter) : "all",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function hasActiveResultsFilters(filters: ResultsFilters): boolean {
  return filters.query.trim() !== "" || filters.filter !== "all";
}
