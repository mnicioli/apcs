import {
  EMPTY_EVALUATION_FILTERS,
  isEvaluationParticipantFilter,
  type EvaluationParticipantFilter,
  type EvaluationParticipantFilters,
} from "./event.evaluation.types";
import { eventListHref } from "./event.registrations.routes";

/**
 * A SERIALIZAÇÃO DOS FILTROS DE AVALIAÇÕES.
 *
 * ⚠️ ARQUIVO PRÓPRIO, E NÃO UMA SEÇÃO EM `event.registrations.routes.ts`. Aquele
 * arquivo serve às duas telas que leem `event_registrations_board` — Inscrições
 * e Lista de Presença —, e o cabeçalho dele explica que estar junto é o que
 * impede as duas de acharem gente diferente.
 *
 * Avaliações não lê aquela consulta e não carrega aqueles filtros: não há
 * confirmação, não há período, não há ordenação escolhível (a lista é sempre
 * alfabética — na tela de andamento a pergunta é sempre "cadê o fulano?").
 * O que ela tem é uma situação que aquele arquivo desconhece, incluindo um valor
 * que nem é do enum do banco (`not_created`).
 *
 * Juntar as duas obrigaria `RegistrationBoardFilters` a ganhar um campo que
 * quatro telas ignoram — e o `queryString` de lá a decidir, por tela, quais
 * parâmetros valem. É o tipo de generalização que fica mais difícil de ler do
 * que as duas versões separadas.
 *
 * Como lá, `parse` e `href` são inversas uma da outra, e há teste que prova.
 */

/** O nome de cada filtro na URL. Curto, porque a URL é lida e colada. */
const PARAM = {
  query: "q",
  status: "st",
  page: "page",
} as const;

/**
 * A tela inicial: os eventos, para escolher um (§21).
 *
 * ⚠️ DELEGA PARA `eventListHref`, e não repete a serialização. As quatro telas
 * de seleção de evento montam o MESMO endereço (`?q=&page=`), e a cópia é o que
 * envelhece — além de ser o que `EventSearchBox` precisa poder chamar a partir
 * de um `basePath`. Ver o cabeçalho daquela função.
 */
export function evaluationsHref(page = 1, query = ""): string {
  return eventListHref("/events/evaluations", page, query);
}

/**
 * A gestão da avaliação de UM evento.
 *
 * ⚠️ O EVENTO VAI NA ROTA, e não em query param — o mesmo padrão de
 * `/events/registrations/[eventId]` e `/events/presence/[eventId]`. A
 * consequência prática é que o endereço é compartilhável e o `notFound()` de um
 * id inventado acontece no lugar certo.
 */
export function eventEvaluationHref(
  eventId: string,
  filters: EvaluationParticipantFilters = EMPTY_EVALUATION_FILTERS,
): string {
  return `/events/evaluations/${eventId}${queryString(filters)}`;
}

/** Só o que difere do padrão entra na URL. */
function queryString(filters: EvaluationParticipantFilters): string {
  const params = new URLSearchParams();
  if (filters.query.trim()) params.set(PARAM.query, filters.query.trim());
  if (filters.status !== "all") params.set(PARAM.status, filters.status);
  if (filters.page > 1) params.set(PARAM.page, String(filters.page));

  const busca = params.toString();
  return busca ? `?${busca}` : "";
}

export type EvaluationSearchParams = Partial<Record<string, string | string[]>>;

/**
 * Lê os filtros da URL, sem nunca falhar.
 *
 * ⚠️ VALOR DESCONHECIDO CAI NO PADRÃO em vez de derrubar a tela ou devolver
 * lista vazia. Uma URL colada errada, ou de uma versão anterior do sistema, não
 * deve parecer "ninguém esteve presente neste evento" — que é a conclusão que
 * alguém tiraria de uma grid vazia sem explicação.
 */
export function parseEvaluationFilters(
  params: EvaluationSearchParams,
): EvaluationParticipantFilters {
  const um = (chave: string): string => {
    const valor = params[chave];
    return (Array.isArray(valor) ? valor[0] : valor) ?? "";
  };

  const status = um(PARAM.status);
  const page = Number.parseInt(um(PARAM.page), 10);

  return {
    query: um(PARAM.query),
    status: isEvaluationParticipantFilter(status) ? (status as EvaluationParticipantFilter) : "all",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function hasActiveEvaluationFilters(filters: EvaluationParticipantFilters): boolean {
  return filters.query.trim() !== "" || filters.status !== "all";
}
