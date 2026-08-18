import {
  DEFAULT_SURVEY_SORT,
  EMPTY_SURVEY_FILTERS,
  SURVEY_SORT_FIELDS,
  SURVEY_STATUSES,
  type SurveyFilters,
  type SurveySort,
  type SurveySortField,
  type SurveyStatus,
} from "./survey.types";

/**
 * Rotas e ESTADO DE TELA de Enquetes.
 *
 * ⚠️ Os filtros moram na URL, não em estado de componente. Três razões:
 *
 *   1. as listas são renderizadas no SERVIDOR — é a URL que precisa mudar para
 *      vir gente nova do banco (§6, §7: paginação e ordenação server-side);
 *   2. uma busca filtrada pode ser mandada por link e sobrevive ao F5;
 *   3. **a grid e a tela de Resultados compartilham a mesma serialização**, então
 *      alternar entre elas preserva o recorte sem ninguém sincronizar nada.
 *
 * Por isso a leitura e a escrita dos parâmetros vivem AQUI, num lugar só: duas
 * implementações da mesma URL sairiam de sincronia no primeiro filtro novo. É o
 * mesmo desenho de `lecture.routes.ts`.
 *
 * ⚠️ As ROTAS são em inglês (`/surveys`), como todas as outras do projeto. O
 * CLAUDE.md é explícito: código e rotas em inglês, texto de tela em PT-BR. O
 * menu diz "Enquetes".
 */

export const SURVEYS_BASE = "/surveys";
export const SURVEYS_RESULTS_BASE = "/surveys/results";

/**
 * O `[id]` da rota tem forma de uuid?
 *
 * Sem esta checagem, `/surveys/nao-e-uuid` iria direto ao banco, o Postgres
 * recusaria com "invalid input syntax for type uuid", o service lançaria e a
 * pessoa veria a tela de FALHA DO SISTEMA para o que é só um endereço que não
 * existe. Um link velho colado no WhatsApp viraria um incidente aparente.
 *
 * Mesma correção já feita em Palestras, e pelo mesmo motivo.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSurveyId(value: string): boolean {
  return UUID.test(value);
}

export function surveyHref(id: string): string {
  return `${SURVEYS_BASE}/${id}`;
}

export function surveyEditHref(id: string): string {
  return `${SURVEYS_BASE}/${id}/edit`;
}

export function surveyResultsHref(id: string): string {
  return `${SURVEYS_BASE}/${id}/results`;
}

export function surveyExportHref(id: string): string {
  return `${SURVEYS_BASE}/${id}/results/export`;
}

export function newSurveyHref(): string {
  return `${SURVEYS_BASE}/new`;
}

// ----------------------------------------------------------------------------
// Serialização dos filtros (§4, §5)
// ----------------------------------------------------------------------------

/** O que o Next entrega em `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

/**
 * Um valor da URL só entra se pertencer à lista fechada do domínio.
 *
 * Um parâmetro colado errado vira "sem filtro", e não uma lista vazia: uma URL
 * quebrada não deve parecer "não há nada aqui" — e um valor arbitrário nunca
 * chega ao SQL.
 */
function pickOne<T extends string>(
  raw: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const value = firstValue(raw);
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** Instante ISO, como `<input type="datetime-local">` produz depois de convertido. */
function pickInstant(raw: string | string[] | undefined): string | undefined {
  const value = firstValue(raw).trim();
  if (!value) return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

/** UF de duas letras, sempre em maiúscula. */
function pickUf(raw: string | string[] | undefined): string | undefined {
  const value = firstValue(raw).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : undefined;
}

/** Os perfis vivem no enum `chat_contact_profile`. */
const CONTACT_PROFILES = ["producer", "member", "supplier"] as const;

export function parseSurveyFilters(params: RawSearchParams): SurveyFilters {
  const filtros: SurveyFilters = {};

  const query = firstValue(params.q).slice(0, 120).trim();
  if (query) filtros.query = query;

  const status = pickOne<SurveyStatus>(params.status, SURVEY_STATUSES);
  if (status) filtros.status = status;

  const from = pickInstant(params.from);
  if (from) filtros.from = from;

  const to = pickInstant(params.to);
  if (to) filtros.to = to;

  const region = pickUf(params.region);
  if (region) filtros.region = region;

  const profile = pickOne(params.profile, CONTACT_PROFILES);
  if (profile) filtros.profile = profile;

  return filtros;
}

/**
 * Os filtros de volta em parâmetros.
 *
 * Só o que está preenchido entra: uma URL com seis parâmetros vazios é ilegível
 * e o botão "limpar filtros" ficaria sem efeito visível.
 */
export function surveyFiltersToParams(filters: SurveyFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.query?.trim()) params.set("q", filters.query.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.region) params.set("region", filters.region);
  if (filters.profile) params.set("profile", filters.profile);

  return params;
}

export function isSurveyFiltered(filters: SurveyFilters): boolean {
  return (
    Boolean(filters.query?.trim()) ||
    Boolean(filters.status) ||
    Boolean(filters.from) ||
    Boolean(filters.to) ||
    Boolean(filters.region) ||
    Boolean(filters.profile)
  );
}

// ----------------------------------------------------------------------------
// Ordenação e paginação (§6, §7)
// ----------------------------------------------------------------------------

export const DEFAULT_SURVEY_PAGE_SIZE = 20;
export const MAX_SURVEY_PAGE_SIZE = 100;

export function parseSurveySort(params: RawSearchParams): SurveySort {
  const field = pickOne<SurveySortField>(params.sort, SURVEY_SORT_FIELDS);
  return {
    field: field ?? DEFAULT_SURVEY_SORT.field,
    // O padrão é DESCENDENTE porque a ordenação padrão é por data de criação, e
    // ali o que importa é o que entrou por último.
    ascending: firstValue(params.dir) === "asc",
  };
}

export function parseSurveyPage(params: RawSearchParams): { page: number; pageSize: number } {
  const page = Number(firstValue(params.page));
  const size = Number(firstValue(params.size));

  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize:
      Number.isInteger(size) && size >= 1 && size <= MAX_SURVEY_PAGE_SIZE
        ? size
        : DEFAULT_SURVEY_PAGE_SIZE,
  };
}

/** O endereço de uma listagem com filtros, ordenação e página. */
function listHref(
  base: string,
  options: {
    filters?: SurveyFilters;
    sort?: SurveySort;
    page?: number;
    pageSize?: number;
  },
): string {
  const params = surveyFiltersToParams(options.filters ?? EMPTY_SURVEY_FILTERS);

  if (options.sort && options.sort.field !== DEFAULT_SURVEY_SORT.field) {
    params.set("sort", options.sort.field);
  }
  if (options.sort?.ascending) params.set("dir", "asc");
  if (options.page && options.page > 1) params.set("page", String(options.page));
  if (options.pageSize && options.pageSize !== DEFAULT_SURVEY_PAGE_SIZE) {
    params.set("size", String(options.pageSize));
  }

  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

export function surveysHref(
  options: {
    filters?: SurveyFilters;
    sort?: SurveySort;
    page?: number;
    pageSize?: number;
  } = {},
): string {
  return listHref(SURVEYS_BASE, options);
}

/**
 * A tela geral de Resultados (§59).
 *
 * Compartilha a serialização com a grid de propósito: quem filtrou "ativas de
 * agosto" e clica em Resultados continua vendo ativas de agosto.
 */
export function surveysResultsHref(
  options: {
    filters?: SurveyFilters;
    sort?: SurveySort;
    page?: number;
    pageSize?: number;
  } = {},
): string {
  return listHref(SURVEYS_RESULTS_BASE, options);
}
