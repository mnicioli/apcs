import {
  DEFAULT_CALENDAR_VIEW,
  isCalendarDate,
  isCalendarView,
  normalizeAnchor,
  type CalendarView,
} from "./lecture.calendar";
import { DEFAULT_LECTURE_PAGE_SIZE, MAX_LECTURE_PAGE_SIZE } from "./lecture.schema";
import {
  EMPTY_LECTURE_FILTERS,
  LECTURE_FORMATS,
  LECTURE_ORIGINS,
  LECTURE_PRIORITIES,
  LECTURE_SORT_FIELDS,
  LECTURE_STATUSES,
  LECTURE_TYPES,
  type LectureFilters,
  type LectureFormat,
  type LectureOrigin,
  type LecturePriority,
  type LectureSort,
  type LectureSortField,
  type LectureStatus,
  type LectureType,
} from "./lecture.types";

/**
 * Rotas e ESTADO DE TELA de Palestras.
 *
 * ⚠️ Os filtros moram na URL, não em estado de componente. Três razões, e a
 * terceira é o §48 do escopo:
 *
 *   1. as listas são renderizadas no SERVIDOR — é a URL que precisa mudar para
 *      vir gente nova do banco;
 *   2. uma busca filtrada pode ser mandada por link e sobrevive ao F5;
 *   3. **grid e calendário compartilham a mesma serialização**, então alternar
 *      entre as duas telas preserva os filtros sem ninguém sincronizar nada.
 *
 * Por isso a leitura e a escrita dos parâmetros vivem AQUI, num lugar só: duas
 * implementações da mesma URL sairiam de sincronia no primeiro filtro novo.
 *
 * ⚠️ As ROTAS são em inglês (`/lectures`), como todas as outras do projeto
 * (`/events`, `/market`, `/documents`). O escopo escreve `/palestras`, mas o
 * CLAUDE.md é explícito: código e rotas em inglês, texto de tela em PT-BR. O
 * menu diz "Palestras".
 */

export const LECTURES_BASE = "/lectures";
export const LECTURES_CALENDAR_BASE = "/lectures/calendar";

/**
 * O `[id]` da rota tem forma de uuid?
 *
 * ⚠️ ACHADO NO NAVEGADOR: sem esta checagem, `/lectures/nao-e-uuid` ia direto ao
 * banco, o Postgres recusava com "invalid input syntax for type uuid", o service
 * lançava e a pessoa via **"Não foi possível carregar"** — a tela de FALHA DO
 * SISTEMA para o que é só um endereço que não existe. Um link velho colado no
 * WhatsApp virava um incidente aparente.
 *
 * Não achar e não poder existir têm a mesma resposta para quem está olhando:
 * esta palestra não está aqui. E, de quebra, entrada malformada para de virar
 * consulta (§73).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLectureId(value: string): boolean {
  return UUID.test(value);
}

export function lectureHref(id: string): string {
  return `${LECTURES_BASE}/${id}`;
}

export function lectureEditHref(id: string): string {
  return `${LECTURES_BASE}/${id}/edit`;
}

export function newLectureHref(prefill?: { date?: string; startTime?: string }): string {
  const params = new URLSearchParams();
  if (prefill?.date) params.set("date", prefill.date);
  if (prefill?.startTime) params.set("time", prefill.startTime);

  const search = params.toString();
  return search ? `${LECTURES_BASE}/new?${search}` : `${LECTURES_BASE}/new`;
}

// ----------------------------------------------------------------------------
// Serialização dos filtros
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
): T | null {
  const value = firstValue(raw);
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** `status=planned,confirmed` ou `status=planned&status=confirmed` — os dois funcionam. */
function pickMany<T extends string>(
  raw: string | string[] | undefined,
  allowed: readonly T[],
): T[] {
  const values = Array.isArray(raw) ? raw : raw ? raw.split(",") : [];
  const unique = new Set(values.map((value) => value.trim()));
  return allowed.filter((option) => unique.has(option));
}

function pickDate(raw: string | string[] | undefined): string {
  const value = firstValue(raw);
  return isCalendarDate(value) ? value : "";
}

function pickUuid(raw: string | string[] | undefined): string | null {
  const value = firstValue(raw);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export function parseLectureFilters(params: RawSearchParams): LectureFilters {
  return {
    query: firstValue(params.q).slice(0, 120),
    status: pickMany<LectureStatus>(params.status, LECTURE_STATUSES),
    origin: pickOne<LectureOrigin>(params.origin, LECTURE_ORIGINS),
    type: pickOne<LectureType>(params.type, LECTURE_TYPES),
    format: pickOne<LectureFormat>(params.format, LECTURE_FORMATS),
    priority: pickOne<LecturePriority>(params.priority, LECTURE_PRIORITIES),
    city: firstValue(params.city).slice(0, 120),
    responsibleId: pickUuid(params.responsible),
    speakerId: pickUuid(params.speaker),
    from: pickDate(params.from),
    to: pickDate(params.to),
  };
}

/**
 * Os filtros de volta em parâmetros.
 *
 * Só o que está preenchido entra: uma URL com dez parâmetros vazios é ilegível e
 * o botão "limpar filtros" ficaria sem efeito visível.
 */
export function lectureFiltersToParams(filters: LectureFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (filters.status.length > 0) params.set("status", filters.status.join(","));
  if (filters.origin) params.set("origin", filters.origin);
  if (filters.type) params.set("type", filters.type);
  if (filters.format) params.set("format", filters.format);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.city.trim()) params.set("city", filters.city.trim());
  if (filters.responsibleId) params.set("responsible", filters.responsibleId);
  if (filters.speakerId) params.set("speaker", filters.speakerId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);

  return params;
}

export function isLectureFiltered(filters: LectureFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.status.length > 0 ||
    filters.origin !== null ||
    filters.type !== null ||
    filters.format !== null ||
    filters.priority !== null ||
    filters.city.trim() !== "" ||
    filters.responsibleId !== null ||
    filters.speakerId !== null ||
    filters.from !== "" ||
    filters.to !== ""
  );
}

// ----------------------------------------------------------------------------
// Ordenação e paginação (§17, §18)
// ----------------------------------------------------------------------------

export function parseLectureSort(params: RawSearchParams): LectureSort {
  const field = pickOne<LectureSortField>(params.sort, LECTURE_SORT_FIELDS);
  return {
    field: field ?? "requestedAt",
    // O padrão é DESCENDENTE porque a ordenação padrão é por data da
    // solicitação, e ali o que importa é o que chegou por último.
    ascending: firstValue(params.dir) === "asc",
  };
}

export function parseLecturePage(params: RawSearchParams): { page: number; pageSize: number } {
  const page = Number(firstValue(params.page));
  const size = Number(firstValue(params.size));

  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize:
      Number.isInteger(size) && size >= 1 && size <= MAX_LECTURE_PAGE_SIZE
        ? size
        : DEFAULT_LECTURE_PAGE_SIZE,
  };
}

/** O endereço da grid com filtros, ordenação e página. */
export function lecturesHref(
  options: {
    filters?: LectureFilters;
    sort?: LectureSort;
    page?: number;
    pageSize?: number;
  } = {},
): string {
  const params = lectureFiltersToParams(options.filters ?? EMPTY_LECTURE_FILTERS);

  if (options.sort && options.sort.field !== "requestedAt") params.set("sort", options.sort.field);
  if (options.sort?.ascending) params.set("dir", "asc");
  if (options.page && options.page > 1) params.set("page", String(options.page));
  if (options.pageSize && options.pageSize !== DEFAULT_LECTURE_PAGE_SIZE) {
    params.set("size", String(options.pageSize));
  }

  const search = params.toString();
  return search ? `${LECTURES_BASE}?${search}` : LECTURES_BASE;
}

// ----------------------------------------------------------------------------
// Calendário (§2, §48)
// ----------------------------------------------------------------------------

export interface CalendarState {
  view: CalendarView;
  /** A âncora já NORMALIZADA para a visão (dia 1 do mês, segunda da semana...). */
  anchor: string;
}

/**
 * A visão e a data do calendário, lidas da URL.
 *
 * `today` entra como parâmetro (e não `new Date()` aqui dentro) porque o "hoje"
 * da APCS é decidido no servidor: o relógio do navegador pode estar em outro
 * fuso, e o calendário abriria num mês diferente do que a grid considera atual.
 */
export function parseCalendarState(params: RawSearchParams, today: string): CalendarState {
  const rawView = firstValue(params.view);
  const view = isCalendarView(rawView) ? rawView : DEFAULT_CALENDAR_VIEW;

  const rawDate = firstValue(params.date);
  const anchor = isCalendarDate(rawDate) ? rawDate : today;

  return { view, anchor: normalizeAnchor(view, anchor) };
}

/**
 * O endereço do calendário — carregando os filtros junto.
 *
 * É esta função que faz o §48 acontecer: quem sai da grid filtrada por "Toledo,
 * confirmadas" e clica em Calendário continua vendo Toledo e confirmadas.
 */
export function lectureCalendarHref(
  options: {
    view?: CalendarView;
    anchor?: string;
    filters?: LectureFilters;
  } = {},
): string {
  const params = lectureFiltersToParams(options.filters ?? EMPTY_LECTURE_FILTERS);

  if (options.view && options.view !== DEFAULT_CALENDAR_VIEW) params.set("view", options.view);
  if (options.anchor) params.set("date", options.anchor);

  const search = params.toString();
  return search ? `${LECTURES_CALENDAR_BASE}?${search}` : LECTURES_CALENDAR_BASE;
}
