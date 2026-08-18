import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  Survey,
  SurveyAuditAction,
  SurveyAudienceCriterion,
  SurveyAudienceDimension,
  SurveyAudienceMember,
  SurveyAuditEntry,
  SurveyDispatchRun,
  SurveyDispatchStatus,
  SurveyFilters,
  SurveyMetrics,
  SurveyOption,
  SurveyPage,
  SurveyParticipant,
  SurveyRecipient,
  SurveyRecipientStatus,
  SurveyResultRow,
  SurveySortField,
  SurveyStatus,
  SurveyWithQuestion,
} from "@/modules/survey/survey.types";

/**
 * SERVICE = leitura. Retorna o dado ou LANÇA erro (o caller decide como tratar).
 *
 * Passa pelo cliente autenticado — ou seja, pela RLS. Quem não é
 * `admin`/`ceo`/`comercial` não vê linha nenhuma, mesmo que a checagem de
 * permissão da aplicação falhe.
 *
 * ⚠️ AS RESPOSTAS NÃO SÃO LIDAS AQUI, E ISSO NÃO É ESQUECIMENTO.
 *
 * `survey_responses` não tem policy de SELECT — nem para o admin. Todo número
 * que este arquivo devolve sobre respostas sai de `survey_results`,
 * `survey_metrics` ou `survey_participants`, que são funções SECURITY DEFINER e
 * aplicam a regra de anonimato (§54) antes de devolver qualquer coisa. Não
 * existe um caminho "só para o painel interno" que contorne isso.
 *
 * O filtro é SQL, não `.filter()` em memória: o §67 exige paginação no servidor,
 * e filtrar DEPOIS de paginar devolveria páginas com buracos. A busca sem acento
 * está resolvida no banco por `surveys.search_text` (coluna gerada).
 */

/**
 * `created_by` e `updated_by` são DUAS chaves estrangeiras para `profiles` nesta
 * tabela. Sem apontar a constraint, o PostgREST não sabe qual seguir e devolve
 * erro de ambiguidade.
 */
const SURVEY_COLUMNS =
  "id, title, description, status, starts_at, ends_at, scheduled_at, " +
  "is_anonymous, allows_response_change, single_response_only, " +
  "image_path, image_mime, image_size_bytes, created_at, updated_at, " +
  "creator:profiles!surveys_created_by_fkey (id, full_name, email), " +
  "editor:profiles!surveys_updated_by_fkey (id, full_name, email), " +
  "survey_questions (id, position, text, answer_type, required, " +
  "survey_options (id, position, text, active)), " +
  "survey_audience_criteria (dimension, segment_id, contact_id, value)";

/**
 * As linhas que as funções de resultado devolvem.
 *
 * ⚠️ Os tipos precisam ser afirmados na mão porque o `as never` nos argumentos —
 * contorno do descompasso de generics ssr/supabase-js, o mesmo de insert/update
 * (ver CONVENTIONS.md) — colapsa também o tipo do retorno. Os campos abaixo
 * batem com `Database["public"]["Functions"]` em src/types/database.ts.
 */
interface ResultRow {
  option_id: string;
  option_position: number;
  option_text: string;
  option_active: boolean;
  total: number;
  percentage: number | string;
}

interface MetricsRow {
  total_audience: number;
  total_sent: number;
  total_delivered: number;
  total_read: number;
  total_responses: number;
  total_errors: number;
  participation_rate: number | string;
}

interface ParticipantRow {
  contact_id: string | null;
  contact_name: string | null;
  option_id: string;
  option_text: string;
  answered_at: string;
}

interface AudienceRow {
  contact_id: string;
  full_name: string | null;
  phone: string | null;
}

interface BatchMetricsRow extends MetricsRow {
  survey_id: string;
}

interface ParticipantPageRow extends ParticipantRow {
  total_count: number | string;
}

/** O contato cru de `chat_contacts`, para o autocomplete do §30. */
interface AudienceContactRow {
  id: string;
  full_name: string | null;
  phone: string | null;
}

/** Teto da trilha lida de uma vez. */
const AUDIT_LIMIT = 200;

/**
 * Teto da prévia de público (§30, §32).
 *
 * O NÚMERO vem de `count_survey_audience`, que não traz linha nenhuma. Esta
 * lista existe só para a tela mostrar uma amostra de quem seria alcançado — e um
 * "toda a base" com 50 mil contatos não pode virar um dump disfarçado de prévia.
 */
const AUDIENCE_PREVIEW_LIMIT = 200;

interface ProfileRow {
  id: string;
  full_name: string | null;
  email?: string | null;
}

interface OptionRow {
  id: string;
  position: number;
  text: string;
  active: boolean;
}

interface QuestionRow {
  id: string;
  position: number;
  text: string;
  answer_type: SurveyWithQuestion["question"] extends null
    ? never
    : NonNullable<SurveyWithQuestion["question"]>["answerType"];
  required: boolean;
  survey_options: OptionRow[] | null;
}

interface CriterionRow {
  dimension: SurveyAudienceDimension;
  segment_id: string | null;
  contact_id: string | null;
  value: string | null;
}

interface SurveyRow {
  id: string;
  title: string;
  description: string | null;
  status: SurveyStatus;
  starts_at: string | null;
  ends_at: string | null;
  scheduled_at: string | null;
  is_anonymous: boolean;
  allows_response_change: boolean;
  single_response_only: boolean;
  image_path: string | null;
  image_mime: string | null;
  image_size_bytes: number | null;
  created_at: string;
  updated_at: string;
  creator?: ProfileRow | null;
  editor?: ProfileRow | null;
  survey_questions?: QuestionRow[] | null;
  survey_audience_criteria?: CriterionRow[] | null;
}

/**
 * ⚠️ O e-mail vem junto porque `full_name` PODE SER NULO — quem ainda não
 * preencheu o perfil. Sem ele, uma enquete COM autor aparecia como "Não
 * definido". Mesma correção já feita em Palestras.
 */
function toActor(row: ProfileRow | null | undefined) {
  return row ? { id: row.id, fullName: row.full_name, email: row.email ?? null } : null;
}

function toOption(row: OptionRow): SurveyOption {
  return { id: row.id, position: row.position, text: row.text, active: row.active };
}

export function toSurvey(row: SurveyRow): SurveyWithQuestion {
  // O MVP tem uma pergunta; a modelagem comporta várias (§6). Ordenar e pegar a
  // primeira é o que faz este código continuar correto no dia em que houver
  // duas — ele mostra a primeira, em vez de uma aleatória.
  const perguntas = [...(row.survey_questions ?? [])].sort((a, b) => a.position - b.position);
  const pergunta = perguntas[0];

  const base: Survey = {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    scheduledAt: row.scheduled_at,
    isAnonymous: row.is_anonymous,
    allowsResponseChange: row.allows_response_change,
    singleResponseOnly: row.single_response_only,
    imagePath: row.image_path,
    imageMime: row.image_mime,
    imageSizeBytes: row.image_size_bytes,
    createdBy: toActor(row.creator),
    createdAt: row.created_at,
    updatedBy: toActor(row.editor),
    updatedAt: row.updated_at,
  };

  return {
    ...base,
    question: pergunta
      ? {
          id: pergunta.id,
          position: pergunta.position,
          text: pergunta.text,
          answerType: pergunta.answer_type,
          required: pergunta.required,
          options: [...(pergunta.survey_options ?? [])]
            .sort((a, b) => a.position - b.position)
            .map(toOption),
        }
      : null,
    audience: (row.survey_audience_criteria ?? []).map((c) => ({
      dimension: c.dimension,
      segmentId: c.segment_id,
      contactId: c.contact_id,
      value: c.value,
    })),
  };
}

const SORT_COLUMNS: Record<SurveySortField, string> = {
  createdAt: "created_at",
  title: "title",
  status: "status",
  startsAt: "starts_at",
  endsAt: "ends_at",
};

/**
 * §67/§68. A listagem paginada.
 *
 * ⚠️ O tratamento de `PGRST103` não é zelo excessivo: é o código que o PostgREST
 * devolve quando o offset pedido passa do fim da tabela, e ele acontece de
 * verdade em dois casos comuns — um link antigo com `?page=7` depois de a base
 * encolher, e um `router.refresh()` logo após alguém excluir os últimos
 * registros. Sem isto, a pessoa recebe uma tela de erro no lugar de uma lista
 * vazia. Mesma correção já feita em Palestras.
 */
export async function listSurveys(
  filters: SurveyFilters = {},
  sort: { field: SurveySortField; direction: "asc" | "desc" } = {
    field: "createdAt",
    direction: "desc",
  },
  page = 1,
  pageSize = 20,
): Promise<SurveyPage> {
  const supabase = await createClient();

  // §4. O filtro por público é resolvido ANTES, porque é uma pergunta sobre
  // outra tabela — ver `surveyIdsByAudience`.
  const porPublico = await surveyIdsByAudience(filters);
  if (porPublico !== null && porPublico.length === 0) {
    return { items: [], total: 0, page, pageSize };
  }

  let query = supabase.from("surveys").select(SURVEY_COLUMNS, { count: "exact" });
  query = applyFilters(query, filters);
  if (porPublico !== null) query = query.in("id", porPublico);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order(SORT_COLUMNS[sort.field], { ascending: sort.direction === "asc" })
    // Desempate estável: sem ele, duas enquetes criadas no mesmo instante podem
    // trocar de lugar entre uma página e outra, e uma delas some da listagem.
    .order("id", { ascending: true })
    .range(from, from + pageSize - 1)
    .returns<SurveyRow[]>();

  if (error) {
    if (error.code === "PGRST103") {
      return { items: [], total: await countSurveys(filters), page, pageSize };
    }
    console.error(`[surveys] listSurveys falhou: ${error.message}`);
    throw error;
  }

  return {
    items: (data ?? []).map(toSurvey),
    total: count ?? 0,
    page,
    pageSize,
  };
}

/** O total sem trazer linha nenhuma — usado quando a página pedida passou do fim. */
export async function countSurveys(filters: SurveyFilters = {}): Promise<number> {
  const supabase = await createClient();

  const porPublico = await surveyIdsByAudience(filters);
  if (porPublico !== null && porPublico.length === 0) return 0;

  let query = supabase.from("surveys").select("id", { count: "exact", head: true });
  query = applyFilters(query, filters);
  if (porPublico !== null) query = query.in("id", porPublico);

  const { count, error } = await query;
  if (error) {
    console.error(`[surveys] countSurveys falhou: ${error.message}`);
    throw error;
  }
  return count ?? 0;
}

/**
 * Os filtros do §68, aplicados em SQL.
 *
 * A busca usa `search_text` (coluna gerada, minúscula e sem acento) contra o
 * termo normalizado do mesmo jeito — é o que faz "arroba" achar "@" e "suino"
 * achar "suíno". As duas pontas precisam concordar.
 */
function applyFilters<T>(query: T, filters: SurveyFilters): T {
  // O tipo do builder do supabase-js não é nomeável sem importar internals; o
  // cast fica confinado a esta função em vez de espalhado pelas chamadas.
  let q = query as unknown as {
    ilike: (c: string, v: string) => typeof q;
    eq: (c: string, v: string) => typeof q;
    gte: (c: string, v: string) => typeof q;
    lte: (c: string, v: string) => typeof q;
  };

  if (filters.query) {
    const termo = filters.query.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (termo) q = q.ilike("search_text", `%${termo}%`);
  }
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", filters.to);

  return q as unknown as T;
}

/**
 * §4. As enquetes cujo PÚBLICO casa com região e/ou perfil.
 *
 * Devolve `null` quando não há filtro de público — o chamador então não
 * restringe nada. Devolve `[]` quando há filtro e nada casa, e essa distinção
 * importa: sem ela, "nenhuma enquete foi para o RS" viraria "sem filtro" e a
 * lista mostraria tudo.
 *
 * ⚠️ Duas consultas, e não um `!inner` embutido no select. Com `!inner` o
 * PostgREST filtraria TAMBÉM o array `survey_audience_criteria` que volta junto,
 * e o detalhe da enquete passaria a mostrar só o critério que casou com o filtro
 * — a tela mentiria sobre o público. Duas consultas custam um round-trip e
 * dizem a verdade.
 */
async function surveyIdsByAudience(filters: SurveyFilters): Promise<string[] | null> {
  if (!filters.region && !filters.profile) return null;

  const supabase = await createClient();

  // Uma consulta por dimensão, e a interseção no fim: é o AND entre dimensões
  // do §31, o mesmo que `resolve_survey_audience` aplica no banco.
  const listas: string[][] = [];

  for (const [dimension, value] of [
    ["region", filters.region],
    ["profile", filters.profile],
  ] as const) {
    if (!value) continue;

    const { data, error } = await supabase
      .from("survey_audience_criteria")
      .select("survey_id")
      .eq("dimension", dimension)
      .eq("value", value)
      .returns<{ survey_id: string }[]>();

    if (error) {
      console.error(`[surveys] filtro de público falhou: ${error.message}`);
      throw error;
    }

    listas.push((data ?? []).map((linha) => linha.survey_id));
  }

  if (listas.length === 0) return null;

  const [primeira, ...resto] = listas;
  return resto.reduce<string[]>(
    (acc, lista) => acc.filter((id) => lista.includes(id)),
    primeira ?? [],
  );
}

export async function getSurvey(id: string): Promise<SurveyWithQuestion | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("surveys")
    .select(SURVEY_COLUMNS)
    .eq("id", id)
    .returns<SurveyRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[surveys] getSurvey falhou: ${error.message}`);
    throw error;
  }
  return data ? toSurvey(data) : null;
}

/**
 * §9. O grafo de transições, lido do banco.
 *
 * A tela usa isto para decidir quais botões mostrar. Uma cópia em TypeScript
 * seria a segunda fonte da verdade que este desenho evita: no dia em que o fluxo
 * mudar por migration, a cópia continuaria oferecendo botões que o banco recusa.
 */
export async function listStatusTransitions(): Promise<
  { from: SurveyStatus | null; to: SurveyStatus }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("survey_status_transitions")
    .select("from_status, to_status")
    .returns<{ from_status: SurveyStatus | null; to_status: SurveyStatus }[]>();

  if (error) {
    console.error(`[surveys] listStatusTransitions falhou: ${error.message}`);
    throw error;
  }
  return (data ?? []).map((t) => ({ from: t.from_status, to: t.to_status }));
}

/** §53. O resultado por alternativa, incluindo as que ninguém escolheu. */
export async function getSurveyResults(surveyId: string): Promise<SurveyResultRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("survey_results", {
    p_survey_id: surveyId,
  } as never);

  if (error) {
    console.error(`[surveys] getSurveyResults falhou: ${error.message}`);
    throw error;
  }

  return ((data ?? []) as ResultRow[]).map((row) => ({
    optionId: row.option_id,
    position: row.option_position,
    text: row.option_text,
    active: row.option_active,
    total: row.total,
    percentage: Number(row.percentage),
  }));
}

/** §51/§52. Os números da campanha. */
export async function getSurveyMetrics(surveyId: string): Promise<SurveyMetrics> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("survey_metrics", {
    p_survey_id: surveyId,
  } as never);

  if (error) {
    console.error(`[surveys] getSurveyMetrics falhou: ${error.message}`);
    throw error;
  }

  const row = ((data ?? []) as MetricsRow[])[0];
  // Uma enquete sem destinatários não devolve linha; zerado é a leitura certa.
  if (!row) {
    return {
      totalAudience: 0,
      totalSent: 0,
      totalDelivered: 0,
      totalRead: 0,
      totalResponses: 0,
      totalErrors: 0,
      participationRate: 0,
    };
  }

  return {
    totalAudience: row.total_audience,
    totalSent: row.total_sent,
    totalDelivered: row.total_delivered,
    totalRead: row.total_read,
    totalResponses: row.total_responses,
    totalErrors: row.total_errors,
    participationRate: Number(row.participation_rate),
  };
}

/**
 * §2/§51/§64. As métricas de VÁRIAS enquetes numa consulta só.
 *
 * Devolve um `Map` porque quem chama tem uma lista de enquetes na mão e precisa
 * casar cada uma com os seus números — um array obrigaria cada tela a montar o
 * índice de novo.
 *
 * ⚠️ Sem isto, a grid faria uma chamada por linha. Vinte linhas, vinte idas ao
 * banco — o N+1 que o §64 manda evitar.
 */
export async function getSurveyMetricsBatch(
  surveyIds: readonly string[],
): Promise<Map<string, SurveyMetrics>> {
  const mapa = new Map<string, SurveyMetrics>();
  if (surveyIds.length === 0) return mapa;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("survey_metrics_batch", {
    p_survey_ids: [...surveyIds],
  } as never);

  if (error) {
    console.error(`[surveys] getSurveyMetricsBatch falhou: ${error.message}`);
    throw error;
  }

  for (const row of (data ?? []) as BatchMetricsRow[]) {
    mapa.set(row.survey_id, {
      totalAudience: row.total_audience,
      totalSent: row.total_sent,
      totalDelivered: row.total_delivered,
      totalRead: row.total_read,
      totalResponses: row.total_responses,
      totalErrors: row.total_errors,
      participationRate: Number(row.participation_rate),
    });
  }

  return mapa;
}

/**
 * §47/§50. Os participantes, paginados NO SERVIDOR e filtráveis por nome.
 *
 * Devolve `null` para enquete anônima, pelo mesmo motivo de
 * `getSurveyParticipants`: a tela deve NÃO MOSTRAR a seção, e não mostrar um
 * erro — o sistema está cumprindo exatamente o que foi configurado.
 */
export async function listSurveyParticipants(
  surveyId: string,
  options: { query?: string; page?: number; pageSize?: number } = {},
): Promise<{ items: SurveyParticipant[]; total: number } | null> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 200);
  const page = Math.max(options.page ?? 1, 1);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("survey_participants_page", {
    p_survey_id: surveyId,
    p_query: options.query?.trim() || null,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  } as never);

  if (error) {
    if (error.code === "SV008") return null;
    console.error(`[surveys] listSurveyParticipants falhou: ${error.message}`);
    throw error;
  }

  const linhas = (data ?? []) as ParticipantPageRow[];

  return {
    items: linhas.map((row) => ({
      contactId: row.contact_id,
      contactName: row.contact_name,
      optionId: row.option_id,
      optionText: row.option_text,
      answeredAt: row.answered_at,
    })),
    // `count(*) over ()` vem repetido em toda linha; sem linha nenhuma o total é
    // zero, e não `undefined`.
    total: Number(linhas[0]?.total_count ?? 0),
  };
}

/**
 * §55. Quem respondeu o quê — SÓ em enquete não anônima.
 *
 * ⚠️ Devolve `null` quando a enquete é anônima, em vez de lançar. A função do
 * banco levanta SV008, e essa é a barreira de verdade; aqui o `null` existe para
 * a tela poder simplesmente NÃO MOSTRAR a seção, que é o comportamento correto —
 * uma mensagem de erro sugeriria que algo falhou, quando na verdade o sistema
 * está cumprindo exatamente o que foi configurado.
 */
export async function getSurveyParticipants(surveyId: string): Promise<SurveyParticipant[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("survey_participants", {
    p_survey_id: surveyId,
  } as never);

  if (error) {
    if (error.code === "SV008") return null;
    console.error(`[surveys] getSurveyParticipants falhou: ${error.message}`);
    throw error;
  }

  return ((data ?? []) as ParticipantRow[]).map((row) => ({
    contactId: row.contact_id,
    contactName: row.contact_name,
    optionId: row.option_id,
    optionText: row.option_text,
    answeredAt: row.answered_at,
  }));
}

/** §32. Quantos contatos a segmentação atual alcança. */
export async function countSurveyAudience(surveyId: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("count_survey_audience", {
    p_survey_id: surveyId,
  } as never);

  if (error) {
    console.error(`[surveys] countSurveyAudience falhou: ${error.message}`);
    throw error;
  }
  return (data as number | null) ?? 0;
}

/** §30/§32. Uma amostra de quem seria alcançado, para a tela conferir a segmentação. */
export async function previewSurveyAudience(surveyId: string): Promise<SurveyAudienceMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("resolve_survey_audience", { p_survey_id: surveyId } as never)
    .limit(AUDIENCE_PREVIEW_LIMIT);

  if (error) {
    console.error(`[surveys] previewSurveyAudience falhou: ${error.message}`);
    throw error;
  }

  return ((data ?? []) as AudienceRow[]).map((row) => ({
    contactId: row.contact_id,
    fullName: row.full_name,
    phone: row.phone,
  }));
}

/** §39/§40. O estado de cada pessoa no disparo. */
export async function listSurveyRecipients(surveyId: string): Promise<SurveyRecipient[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("survey_recipients")
    .select(
      "id, contact_id, contact_name, contact_phone, status, attempts, last_attempt_at, last_error, provider_message_id",
    )
    .eq("survey_id", surveyId)
    .order("contact_name", { ascending: true, nullsFirst: false })
    .returns<
      {
        id: string;
        contact_id: string | null;
        contact_name: string | null;
        contact_phone: string | null;
        status: SurveyRecipientStatus;
        attempts: number;
        last_attempt_at: string | null;
        last_error: string | null;
        provider_message_id: string | null;
      }[]
    >();

  if (error) {
    console.error(`[surveys] listSurveyRecipients falhou: ${error.message}`);
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    contactId: row.contact_id,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    status: row.status,
    attempts: row.attempts,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
    providerMessageId: row.provider_message_id,
  }));
}

/** §62. A trilha. A RLS já restringe a admin e ceo. */
export async function listSurveyAudit(surveyId: string): Promise<SurveyAuditEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("survey_audit_logs")
    .select("id, action, metadata, created_at, actor:profiles (id, full_name, email)")
    .eq("survey_id", surveyId)
    .order("created_at", { ascending: false })
    .limit(AUDIT_LIMIT)
    .returns<
      {
        id: number;
        action: SurveyAuditAction;
        metadata: Record<string, unknown> | null;
        created_at: string;
        actor: ProfileRow | null;
      }[]
    >();

  if (error) {
    console.error(`[surveys] listSurveyAudit falhou: ${error.message}`);
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    action: row.action,
    actor: toActor(row.actor),
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  }));
}

/**
 * §4/§26. As UFs que existem DE FATO na base de contatos.
 *
 * ⚠️ Não é uma lista fixa das 27 unidades da federação, e a diferença importa:
 * um seletor com 27 opções em que 24 devolvem zero resultados é um seletor que
 * mente sobre o alcance da APCS. Aqui só aparece o que dá para escolher.
 *
 * Serve ao FILTRO da grid e ao SELETOR de público do formulário — os dois
 * precisam da mesma lista, e duas consultas parecidas divergiriam.
 */
export async function listAudienceRegions(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_contacts")
    .select("state")
    .not("state", "is", null)
    .not("phone", "is", null);

  if (error) {
    console.error(`[surveys] listAudienceRegions falhou: ${error.message}`);
    throw error;
  }

  const ufs = new Set<string>();
  for (const linha of (data ?? []) as { state: string | null }[]) {
    const uf = linha.state?.trim().toUpperCase();
    if (uf) ufs.add(uf);
  }

  return [...ufs].sort();
}

/**
 * Os NOMES de contatos já escolhidos como público específico (§29).
 *
 * Sem isto, um chip de contato selecionado mostraria um uuid — a pessoa
 * escolheu "João Silva" e ao reabrir a enquete veria
 * `a0000000-0000-4000-8000-000000000001`.
 */
export async function getContactNames(ids: readonly string[]): Promise<Map<string, string | null>> {
  const mapa = new Map<string, string | null>();
  if (ids.length === 0) return mapa;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_contacts")
    .select("id, full_name")
    .in("id", [...ids]);

  if (error) {
    // Nome é conforto, não correção: sem ele o chip mostra um rótulo genérico e
    // a tela continua utilizável. Derrubar a edição inteira por causa disso
    // seria a troca errada.
    console.error(`[surveys] getContactNames falhou: ${error.message}`);
    return mapa;
  }

  for (const linha of (data ?? []) as { id: string; full_name: string | null }[]) {
    mapa.set(linha.id, linha.full_name);
  }
  return mapa;
}

/**
 * O catálogo de contatos para o autocomplete do §30.
 *
 * ⚠️ Exige um termo de busca e tem teto: o §30 é explícito ("não carregar toda a
 * base quando houver grande volume"), e um endpoint que devolve a lista inteira
 * de telefones é um endpoint de exportação disfarçado de autocomplete.
 */
export async function searchContacts(term: string, limit = 20): Promise<SurveyAudienceMember[]> {
  const limpo = term.trim();
  if (limpo.length < 2) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_contacts")
    .select("id, full_name, phone")
    .not("phone", "is", null)
    .ilike("full_name", `%${limpo}%`)
    .order("full_name", { ascending: true })
    .limit(Math.min(limit, 50));

  if (error) {
    console.error(`[surveys] searchContacts falhou: ${error.message}`);
    throw error;
  }

  return ((data ?? []) as AudienceContactRow[]).map((row) => ({
    contactId: row.id,
    fullName: row.full_name,
    phone: row.phone,
  }));
}

/** Reexportado para as telas montarem os critérios de `region` sem consultar o banco. */
export type { SurveyAudienceCriterion };

/**
 * §35 do PROMPT 3/3. As CORRIDAS de disparo desta enquete.
 *
 * Uma linha por execução, e não por pessoa: a pergunta que ela responde é "o
 * disparo de terça terminou? quantas saíram? quantas falharam?". O estado por
 * pessoa continua em `listSurveyParticipants`.
 */
export async function listSurveyDispatches(surveyId: string): Promise<SurveyDispatchRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("survey_dispatches")
    .select("id, status, total_recipients, total_sent, total_errors, started_at, finished_at")
    .eq("survey_id", surveyId)
    .order("started_at", { ascending: false })
    .limit(20)
    // `.returns<>()`: o mesmo contorno do descompasso de generics ssr/supabase-js
    // que `listSurveyAudit` usa — ver docs/CONVENTIONS.md.
    .returns<
      {
        id: string;
        status: SurveyDispatchStatus;
        total_recipients: number;
        total_sent: number;
        total_errors: number;
        started_at: string;
        finished_at: string | null;
      }[]
    >();

  if (error) {
    console.error(`[surveys] listSurveyDispatches falhou: ${error.message}`);
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    totalRecipients: row.total_recipients,
    totalSent: row.total_sent,
    totalErrors: row.total_errors,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }));
}

/**
 * §49/§52/§53. Os contadores de operação.
 *
 * ⚠️ Lê com o cliente do USUÁRIO, não com `service_role`: a função do banco
 * confere `survey_is_reader()` e recusa quem não tem papel. Métrica de campanha
 * é informação de negócio — quantas mensagens a APCS mandou, quantas falharam —
 * e não pode escapar da mesma matriz de permissão do resto do módulo.
 */
export async function getSurveyOperationCounters(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("survey_observability_counters", {
    p_since: null,
  } as never);

  if (error) {
    console.error(`[surveys] getSurveyOperationCounters falhou: ${error.message}`);
    throw error;
  }

  const linhas = (data ?? []) as { metric: string; value: number }[];
  return Object.fromEntries(linhas.map((l) => [l.metric, Number(l.value)]));
}
