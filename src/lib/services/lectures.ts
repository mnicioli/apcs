import "server-only";
import { createClient } from "@/lib/supabase/server";
import { formatTime } from "@/lib/utils";
import { compareByTime } from "@/modules/lecture/lecture.rules";
import type {
  Lecture,
  LectureAuditAction,
  LectureAuditEntry,
  LectureFilters,
  LectureFormat,
  LectureInbox,
  LectureOrigin,
  LecturePage,
  LecturePriority,
  LectureSort,
  LectureSortField,
  LectureSpeaker,
  LectureStatus,
  LectureTransition,
  LectureType,
} from "@/modules/lecture/lecture.types";
import { DEFAULT_LECTURE_SORT, EMPTY_LECTURE_FILTERS } from "@/modules/lecture/lecture.types";

/**
 * SERVICE = leitura. Retorna o dado ou LANÇA erro (o caller decide como tratar).
 *
 * Passa pelo cliente autenticado — ou seja, pela RLS de `lectures`. Quem não é
 * `admin`/`ceo`/`comercial` não vê linha nenhuma, mesmo que a checagem de
 * permissão da app falhe.
 *
 * ⚠️ A DIFERENÇA PARA EVENTOS E BOLSA: **aqui o filtro é SQL, não `.filter()`**.
 *
 * Naqueles módulos a listagem cabe inteira na memória (uma Bolsa, dezenas de
 * eventos) e filtrar em JavaScript resolve a busca com acento de graça. Aqui
 * não: o chatbot gera solicitações continuamente, o §48 exige paginação no
 * servidor, e filtrar DEPOIS de paginar devolveria páginas com buracos — a
 * página 1 com três linhas, a 2 com dezessete.
 *
 * A busca sem acento, que era o motivo de filtrar em memória, foi resolvida no
 * banco: `lectures.search_text` é uma coluna gerada, minúscula e sem acento.
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 */

/**
 * `speaker_id`, `responsible_id`, `created_by` e `updated_by` são QUATRO chaves
 * estrangeiras para `profiles` nesta tabela. Sem apontar a constraint, o
 * PostgREST não sabe qual seguir e devolve erro de ambiguidade.
 */
const LECTURE_COLUMNS =
  "id, protocol, origin, name, theme, city, location, type, type_other, format, " +
  "event_date, start_time, end_time, attendees_estimated, attendees_actual, " +
  "priority, status, notes, rejection_reason, cancellation_reason, " +
  "requested_at, held_at, outcome_notes, " +
  "requester_contact_id, requester_name, requester_email, requester_phone, requester_organization, " +
  "created_at, updated_at, " +
  "speaker:profiles!lectures_speaker_id_fkey (id, full_name, email), " +
  "speakerCatalog:lecture_speakers!lectures_speaker_catalog_id_fkey (id, name), " +
  "responsible:profiles!lectures_responsible_id_fkey (id, full_name, email), " +
  "creator:profiles!lectures_created_by_fkey (id, full_name, email), " +
  "editor:profiles!lectures_updated_by_fkey (id, full_name, email)";

/** As colunas do CALENDÁRIO. Menos que a grid: a célula do dia mostra pouco. */
const CALENDAR_COLUMNS =
  "id, protocol, origin, name, theme, city, location, type, type_other, format, " +
  "event_date, start_time, end_time, status, priority, " +
  "requested_at, held_at, created_at, updated_at, " +
  "speaker:profiles!lectures_speaker_id_fkey (id, full_name, email), " +
  "speakerCatalog:lecture_speakers!lectures_speaker_catalog_id_fkey (id, name), " +
  "responsible:profiles!lectures_responsible_id_fkey (id, full_name, email)";

/**
 * Teto do calendário. Um mês da APCS não chega perto disso; o número existe para
 * um período absurdo (`?start=2020-01-01&end=2030-12-31`) não virar um dump da
 * tabela inteira disfarçado de consulta de agenda.
 */
const CALENDAR_LIMIT = 1000;

/** Teto da trilha lida de uma vez. */
const AUDIT_LIMIT = 200;

/*
 * ⚠️ AQUI MORAVA UMA REDE DE SEGURANÇA, e ela cumpriu o papel dela.
 *
 * `lecture_speakers` nasceu em 20260905000000_lecture_speakers.sql, e o embed
 * `speakerCatalog:...` só existe depois que a migration roda. Como o código sobe
 * antes, havia uma janela em que o PostgREST responderia PGRST200 ("could not
 * find a relationship") e o módulo INTEIRO de Palestras pararia de abrir — grid,
 * calendário e detalhe passam todos por estas colunas.
 *
 * O fallback trocava esse desastre por um inconveniente: o palestrante externo
 * aparecia como "não definido" até a migration rodar.
 *
 * A migration está aplicada em produção e os tipos foram regenerados contra o
 * banco (`pnpm db:types`, 30/08). A janela fechou, e um andaime que sobrevive à
 * própria razão de existir vira código que ninguém entende por que está lá.
 */

interface ProfileRow {
  id: string;
  full_name: string | null;
  email?: string | null;
}

/** Uma linha do catálogo de palestrantes, no recorte que a tela usa. */
interface SpeakerRow {
  id: string;
  name: string;
}

interface LectureRow {
  id: string;
  protocol: string;
  origin: LectureOrigin;
  name: string;
  theme: string;
  city: string;
  location: string | null;
  type: LectureType;
  type_other: string | null;
  format: LectureFormat | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  attendees_estimated?: number | null;
  attendees_actual?: number | null;
  priority: LecturePriority;
  status: LectureStatus;
  notes?: string | null;
  rejection_reason?: string | null;
  cancellation_reason?: string | null;
  requested_at: string;
  held_at: string | null;
  outcome_notes?: string | null;
  requester_contact_id?: string | null;
  requester_name?: string | null;
  requester_email?: string | null;
  requester_phone?: string | null;
  requester_organization?: string | null;
  created_at: string;
  updated_at: string;
  speaker: ProfileRow | null;
  speakerCatalog?: SpeakerRow | null;
  responsible: ProfileRow | null;
  creator?: ProfileRow | null;
  editor?: ProfileRow | null;
}

/**
 * ⚠️ O e-mail vem junto porque `full_name` PODE SER NULO — quem ainda não
 * preencheu o perfil. Sem ele, uma palestra COM responsável aparecia como "Não
 * definido", e quem acabou de atribuir concluía que a operação tinha falhado.
 *
 * Não é exposição nova: o seletor de responsável já mostra o e-mail dos colegas
 * para exatamente o mesmo público (ver `searchDirectory`).
 */
function toActor(row: ProfileRow | null | undefined) {
  return row ? { id: row.id, fullName: row.full_name, email: row.email ?? null } : null;
}

export function toLecture(row: LectureRow): Lecture {
  return {
    id: row.id,
    protocol: row.protocol,
    origin: row.origin,
    name: row.name,
    theme: row.theme,
    city: row.city,
    location: row.location,
    type: row.type,
    typeOther: row.type_other,
    format: row.format,
    eventDate: row.event_date,
    // Colunas `time` chegam como "HH:MM:SS"; a tela não tem o que fazer com os
    // segundos.
    startTime: row.start_time ? formatTime(row.start_time) : null,
    endTime: row.end_time ? formatTime(row.end_time) : null,
    attendeesEstimated: row.attendees_estimated ?? null,
    attendeesActual: row.attendees_actual ?? null,
    speaker: toActor(row.speaker),
    speakerCatalog: row.speakerCatalog ?? null,
    responsible: toActor(row.responsible),
    priority: row.priority,
    status: row.status,
    notes: row.notes ?? null,
    rejectionReason: row.rejection_reason ?? null,
    cancellationReason: row.cancellation_reason ?? null,
    requestedAt: row.requested_at,
    heldAt: row.held_at,
    outcomeNotes: row.outcome_notes ?? null,
    requester: {
      contactId: row.requester_contact_id ?? null,
      name: row.requester_name ?? null,
      email: row.requester_email ?? null,
      phone: row.requester_phone ?? null,
      organization: row.requester_organization ?? null,
    },
    createdBy: toActor(row.creator),
    createdAt: row.created_at,
    updatedBy: toActor(row.editor),
    updatedAt: row.updated_at,
  };
}

/**
 * De campo do domínio para coluna do banco.
 *
 * É um MAPA, e não `field` direto na cláusula `order`, porque o valor vem da URL
 * — e uma string da URL virando nome de coluna é injeção esperando acontecer. O
 * Zod já restringe a entrada; este mapa é a segunda barreira, e a que garante
 * que só existe ordenação por coluna indexada.
 */
const SORT_COLUMNS: Record<LectureSortField, string> = {
  eventDate: "event_date",
  requestedAt: "requested_at",
  status: "status",
  city: "city",
  priority: "priority",
};

/**
 * Normaliza o termo de busca do mesmo jeito que a coluna `search_text` é
 * gerada: minúsculo e sem acento.
 *
 * ⚠️ Precisa concordar com o `translate()` da migration. Aqui é NFD (que remove
 * qualquer diacrítico); lá é uma lista explícita dos acentos do português. A
 * lista cobre tudo que o português produz — a diferença só apareceria com um
 * caractere que ninguém digita numa busca por cidade brasileira.
 */
function normalizeQuery(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * `%` e `_` são curingas do `like`. Sem escapá-los, procurar por "100%" viraria
 * "qualquer coisa que comece com 100" — e uma busca por "_" devolveria tudo.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * O pedaço do builder do PostgREST que os filtros usam.
 *
 * Descrito estruturalmente em vez de importado: o tipo concreto do builder muda
 * conforme as colunas do `.select()`, e a listagem e o calendário selecionam
 * conjuntos diferentes. Assim uma função serve às duas sem `any`.
 */
interface FilterableQuery<T> {
  eq(column: string, value: string): T;
  in(column: string, values: readonly string[]): T;
  gte(column: string, value: string): T;
  lte(column: string, value: string): T;
  like(column: string, pattern: string): T;
  or(filters: string): T;
}

/**
 * Aplica os filtros do §32 sobre uma consulta já iniciada.
 *
 * Um lugar só, usado pela listagem E pelo calendário: sem isso, "filtrar por
 * cidade" teria duas implementações e uma delas envelheceria.
 */
function applyFilters<T extends FilterableQuery<T>>(query: T, filters: LectureFilters): T {
  let next = query;

  if (filters.status.length > 0) next = next.in("status", filters.status);
  if (filters.origin) next = next.eq("origin", filters.origin);
  if (filters.type) next = next.eq("type", filters.type);
  if (filters.format) next = next.eq("format", filters.format);
  if (filters.priority) next = next.eq("priority", filters.priority);
  if (filters.responsibleId) next = next.eq("responsible_id", filters.responsibleId);

  // ⚠️ DUAS COLUNAS, UM FILTRO. O palestrante escolhido pode ser um perfil
  // interno ou um nome do catálogo, e quem filtra não distingue os dois — nem
  // deveria. Os dois lados são uuid, então não há risco de um valor casar com a
  // coluna errada: no máximo uma das comparações é verdadeira.
  if (filters.speakerId) {
    const id = filters.speakerId;
    next = next.or(`speaker_id.eq.${id},speaker_catalog_id.eq.${id}`);
  }

  // Inclusivo nas duas pontas: quem digita 01/08 a 31/08 espera ver o dia 31.
  if (filters.from) next = next.gte("event_date", filters.from);
  if (filters.to) next = next.lte("event_date", filters.to);

  const city = normalizeQuery(filters.city);
  if (city) next = next.like("search_text", `%${escapeLikePattern(city)}%`);

  const query_ = normalizeQuery(filters.query);
  // `like` e não `ilike`: a coluna já está em minúsculas, e `like` sobre texto
  // normalizado é uma comparação a menos por linha.
  if (query_) next = next.like("search_text", `%${escapeLikePattern(query_)}%`);

  return next;
}

/**
 * Uma página da listagem (§48, §49).
 *
 * `total` vem de `count: "exact"` na MESMA consulta — pedir a contagem à parte
 * abriria uma janela em que uma solicitação nova entra entre as duas chamadas e
 * o rodapé anuncia "26 resultados" numa lista de 25 que não muda de página.
 */
export async function listLectures(
  filters: LectureFilters = EMPTY_LECTURE_FILTERS,
  sort: LectureSort = DEFAULT_LECTURE_SORT,
  page = 1,
  pageSize = 25,
): Promise<LecturePage> {
  const supabase = await createClient();

  const from = (page - 1) * pageSize;

  const { data, error, count } = await applyFilters(
    supabase
      .from("lectures")
      .select(LECTURE_COLUMNS, { count: "exact" })
      .order(SORT_COLUMNS[sort.field], { ascending: sort.ascending })
      // Desempate ESTÁVEL. Sem ele, duas palestras com a mesma data podem
      // trocar de lugar entre uma página e outra — e uma delas some da
      // listagem sem nunca aparecer.
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1),
    filters,
  ).returns<LectureRow[]>();

  if (error) {
    // ⚠️ PGRST103 = "pedi a partir da linha 50, mas só existem 12".
    //
    // Não é entrada inválida: é uma página que EXISTIA e não existe mais. Quem
    // guardou nos favoritos a página 3 de um filtro que hoje devolve dez linhas
    // cai aqui — e também quem está na página 3 quando uma mudança de situação
    // encolhe a lista sob os próprios pés, porque o `router.refresh()` re-renderiza
    // a mesma URL contra dados menores.
    //
    // Estourar isso vira tela de erro para quem não fez nada errado. O certo é
    // uma PÁGINA VAZIA com a contagem verdadeira: a paginação então mostra os
    // números que existem e a pessoa clica de volta. A contagem custa uma ida a
    // mais, e só neste caso raro.
    if (error.code === "PGRST103") {
      return { items: [], total: await countLectures(filters), page, pageSize };
    }

    console.error(`[lectures] listLectures falhou: ${error.message}`);
    throw error;
  }

  return {
    items: (data ?? []).map(toLecture),
    total: count ?? 0,
    page,
    pageSize,
  };
}

/**
 * Quantas palestras o filtro encontra, sem trazer linha nenhuma.
 *
 * `head: true` faz o PostgREST responder só com o cabeçalho da contagem. Existe
 * para o caso de página fora do fim (acima): ali a consulta principal já falhou
 * e o que falta é o número que a paginação precisa para se desenhar.
 */
async function countLectures(filters: LectureFilters): Promise<number> {
  const supabase = await createClient();

  let query = supabase.from("lectures").select("id", { count: "exact", head: true });
  query = applyFilters(query, filters);

  const { count, error } = await query;

  if (error) {
    console.error(`[lectures] contagem falhou: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}

/** Uma palestra, com tudo. */
export async function getLecture(lectureId: string): Promise<Lecture | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("lectures")
    .select(LECTURE_COLUMNS)
    .eq("id", lectureId)
    .returns<LectureRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[lectures] getLecture falhou: ${error.message}`);
    throw error;
  }

  return data ? toLecture(data) : null;
}

/**
 * Consulta por protocolo (§47).
 *
 * O protocolo é o que a pessoa tem anotado — é por ele que a operação procura
 * quando alguém liga perguntando "e a minha palestra?". A coluna é UNIQUE, então
 * o índice já existe.
 */
export async function getLectureByProtocol(protocol: string): Promise<Lecture | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("lectures")
    .select(LECTURE_COLUMNS)
    .eq("protocol", protocol)
    .returns<LectureRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[lectures] getLectureByProtocol falhou: ${error.message}`);
    throw error;
  }

  return data ? toLecture(data) : null;
}

/**
 * As palestras de um PERÍODO, para o calendário (§31).
 *
 * O período é obrigatório e é o ponto inteiro desta função: sem ele, a tela de
 * calendário carregaria todo o histórico para desenhar um mês. Dia, semana, mês
 * e ano são o mesmo pedido com pontas diferentes.
 *
 * Já vem ordenado por dia e hora — a mesma ordem que `compareByTime` produz, e
 * reafirmada aqui para o contrato não depender da cláusula `order` continuar
 * existindo do lado do banco.
 */
export async function listLecturesInRange(
  startDate: string,
  endDate: string,
  filters: Partial<LectureFilters> = {},
): Promise<Lecture[]> {
  const supabase = await createClient();

  // O recorte de período já está aplicado abaixo; passar `from`/`to` para
  // `applyFilters` criaria duas fontes para a mesma restrição.
  const { data, error } = await applyFilters(
    supabase
      .from("lectures")
      .select(CALENDAR_COLUMNS)
      .gte("event_date", startDate)
      .lte("event_date", endDate)
      .order("event_date", { ascending: true })
      .order("start_time", { ascending: true, nullsFirst: false })
      .limit(CALENDAR_LIMIT),
    { ...EMPTY_LECTURE_FILTERS, ...filters, from: "", to: "" },
  ).returns<LectureRow[]>();

  if (error) {
    console.error(`[lectures] listLecturesInRange falhou: ${error.message}`);
    throw error;
  }

  return (data ?? []).map(toLecture).sort((a, b) => {
    if (a.eventDate !== b.eventDate) return a.eventDate.localeCompare(b.eventDate);
    return compareByTime(a, b);
  });
}

/**
 * O GRAFO DE STATUS, lido do banco.
 *
 * É o que permite a tela mostrar exatamente os botões que existem. Uma cópia em
 * TypeScript seria mais rápida e seria a segunda fonte da verdade: no dia em que
 * uma migration mudar o fluxo, a cópia continuaria oferecendo caminhos que o
 * banco recusa.
 */
export async function listStatusTransitions(): Promise<LectureTransition[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("lecture_status_transitions")
    .select("from_status, to_status")
    .returns<{ from_status: LectureStatus | null; to_status: LectureStatus }[]>();

  if (error) {
    console.error(`[lectures] listStatusTransitions falhou: ${error.message}`);
    throw error;
  }

  return (data ?? []).map((row) => ({ from: row.from_status, to: row.to_status }));
}

/**
 * A CAIXA DE ENTRADA (§57).
 *
 * Não existe central de notificações neste projeto — nenhuma tabela, nenhum job,
 * nenhum canal. O que o §57 pede de concreto ("badge, contador") é este número:
 * quantas solicitações ainda esperam decisão.
 *
 * `head: true` faz o PostgREST devolver só a contagem, sem trafegar linha
 * nenhuma. O badge aparece em toda navegação; carregar as linhas para contá-las
 * seria pagar a listagem inteira por um número.
 */
export async function getLectureInbox(): Promise<LectureInbox> {
  const supabase = await createClient();

  async function count(status: LectureStatus): Promise<number> {
    const { count: total, error } = await supabase
      .from("lectures")
      .select("id", { count: "exact", head: true })
      .eq("status", status);

    if (error) {
      console.error(`[lectures] getLectureInbox (${status}) falhou: ${error.message}`);
      throw error;
    }
    return total ?? 0;
  }

  const [requested, underReview] = await Promise.all([count("requested"), count("under_review")]);
  return { requested, underReview, total: requested + underReview };
}

/**
 * Só o NÚMERO do badge do menu (§40).
 *
 * Existe separado de `getLectureInbox` porque roda em TODA navegação do CRM, e
 * ali a divisão entre "solicitada" e "em análise" não é usada — seriam duas
 * viagens ao banco por página para mostrar um número só. `head: true` não traz
 * linha nenhuma: vem apenas a contagem no cabeçalho.
 *
 * Devolve 0 (e não lança) quando a leitura falha: um contador indisponível não
 * pode derrubar o menu de todas as telas do sistema.
 */
export async function countPendingLectures(): Promise<number> {
  try {
    const supabase = await createClient();

    const { count, error } = await supabase
      .from("lectures")
      .select("id", { count: "exact", head: true })
      .in("status", ["requested", "under_review"]);

    if (error) {
      console.error(`[lectures] countPendingLectures falhou: ${error.message}`);
      return 0;
    }
    return count ?? 0;
  } catch (error) {
    console.error(
      `[lectures] countPendingLectures falhou: ${error instanceof Error ? error.message : error}`,
    );
    return 0;
  }
}

/**
 * O CATÁLOGO DE PALESTRANTES — quem já apresentou e não tem conta no cockpit.
 *
 * Alimenta o seletor "Palestrante" do cadastro, do diálogo de atribuição e do
 * filtro do calendário. É por causa desta lista que digitar um nome em "Outro"
 * uma vez basta: na palestra seguinte ele já está no dropdown.
 *
 * Só os ATIVOS. Uma lista que só cresce vira uma lista que ninguém lê.
 *
 * ⚠️ Não lança: um catálogo indisponível deixa o seletor com o time interno e o
 * "Outro", que continua sendo um formulário utilizável. Derrubar a tela de
 * cadastro de palestra porque a lista de nomes não veio seria trocar um
 * inconveniente por uma parada.
 */
export async function listLectureSpeakers(): Promise<LectureSpeaker[]> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("lecture_speakers")
      .select("id, name")
      .eq("active", true)
      .order("name", { ascending: true })
      .returns<LectureSpeaker[]>();

    if (error) throw error;
    return data ?? [];
  } catch (error) {
    console.error(
      `[lectures] catálogo de palestrantes indisponível: ${error instanceof Error ? error.message : error}`,
    );
    return [];
  }
}

/**
 * O CATÁLOGO DE CIDADES — a lista do seletor e a do filtro, a mesma.
 *
 * Ele não é uma tabela que alguém alimenta: o gatilho `lectures_normalize_city`
 * registra cada cidade nova no momento em que uma palestra é gravada nela
 * (20260911000000_lecture_cities.sql). Digitar uma cidade em "Outra" uma vez
 * basta — na palestra seguinte ela já está no dropdown, e na tela de consulta
 * também.
 *
 * ⚠️ SUBSTITUIU UMA FUNÇÃO DE MESMO NOME que trazia `distinct lectures.city` e
 * deduplicava em memória. Ela nasceu com o módulo, com a intenção declarada de
 * "o filtro virar uma lista em vez de um campo livre", e nunca foi chamada por
 * tela nenhuma. Duas diferenças a aposentaram: ela trazia a coluna `city` de
 * TODAS as palestras a cada carregamento de tela, e não tinha como esconder uma
 * cidade digitada errada — a lista só crescia.
 *
 * Só as ATIVAS. Uma lista que só cresce vira uma lista que ninguém lê.
 *
 * ⚠️ Não lança, pela mesma razão de `listLectureSpeakers`: sem o catálogo o
 * seletor fica só com "Outra", que continua sendo um formulário utilizável.
 * Derrubar o cadastro de palestra porque a lista de cidades não veio seria
 * trocar um inconveniente por uma parada.
 */
export async function listLectureCities(): Promise<string[]> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("lecture_cities")
      .select("name")
      .eq("active", true)
      .order("name", { ascending: true })
      .returns<{ name: string }[]>();

    if (error) throw error;
    return (data ?? []).map((linha) => linha.name);
  } catch (error) {
    console.error(
      `[lectures] catálogo de cidades indisponível: ${error instanceof Error ? error.message : error}`,
    );
    return [];
  }
}

interface AuditRow {
  id: number;
  action: LectureAuditAction;
  metadata: Record<string, unknown>;
  created_at: string;
  actor: ProfileRow | null;
}

/**
 * A trilha de uma palestra, do mais recente para o mais antigo.
 *
 * A RLS já restringe isto a `admin` e `ceo` — o Atendente consulta a palestra,
 * mas o histórico de quem decidiu o quê não é dele. Uma chamada feita por quem
 * não pode simplesmente volta vazia, sem erro.
 */
export async function listLectureAudit(lectureId: string): Promise<LectureAuditEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("lecture_audit_logs")
    .select(
      "id, action, metadata, created_at, " +
        "actor:profiles!lecture_audit_logs_actor_id_fkey (id, full_name, email)",
    )
    .eq("lecture_id", lectureId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(AUDIT_LIMIT)
    .returns<AuditRow[]>();

  if (error) {
    console.error(`[lectures] listLectureAudit falhou: ${error.message}`);
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    action: row.action,
    actor: toActor(row.actor),
    // O nome CONGELADO no momento da ação. Sobrevive à saída do perfil, que
    // zeraria o `actor` acima por causa do `on delete set null`.
    actorName: typeof row.metadata.actor_name === "string" ? row.metadata.actor_name : null,
    createdAt: row.created_at,
    metadata: row.metadata,
  }));
}

/**
 * As palestras que disputam um horário (§33).
 *
 * ALERTA, nunca bloqueio. Quem decide o que fazer com a resposta é a tela — pode
 * haver mais de um palestrante disponível, e o escopo é explícito nisso.
 *
 * Vai pela função do Postgres, e não por um `.gte()/.lte()` aqui, porque a
 * semântica de sobreposição (encostar não é sobrepor; palestra sem hora de
 * término ocupa o instante do início) precisa ser UMA. Reescrevê-la em
 * TypeScript daria duas, e a que errasse erraria em silêncio.
 */
export async function findLectureConflicts(
  eventDate: string,
  startTime: string | null,
  endTime: string | null,
  excludeId?: string,
): Promise<Lecture[]> {
  if (!startTime) return [];

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("find_lecture_conflicts", {
    p_event_date: eventDate,
    p_start_time: startTime,
    p_end_time: endTime,
    p_exclude_id: excludeId ?? null,
  } as never);

  if (error) {
    console.error(`[lectures] findLectureConflicts falhou: ${error.message}`);
    throw error;
  }

  const ids = ((data ?? []) as { id: string }[]).map((row) => row.id);
  if (ids.length === 0) return [];

  // ⚠️ SEGUNDA CONSULTA, de propósito. A função devolve `setof public.lectures`
  // — linhas cruas, sem os embeds de perfil —, e o §25 do escopo manda mostrar
  // o responsável e o palestrante da palestra conflitante. Resolver os nomes
  // aqui custa uma ida a mais, mas SÓ quando existe conflito, que é o caso raro.
  //
  // A alternativa seria a função devolver os nomes, e aí a semântica de
  // sobreposição passaria a carregar junto uma decisão de apresentação.
  const { data: full, error: fullError } = await supabase
    .from("lectures")
    .select(LECTURE_COLUMNS)
    .in("id", ids)
    .order("start_time", { ascending: true, nullsFirst: false })
    .returns<LectureRow[]>();

  if (fullError) {
    console.error(`[lectures] detalhe do conflito falhou: ${fullError.message}`);
    throw fullError;
  }

  return (full ?? []).map(toLecture);
}
