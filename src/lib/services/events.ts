import "server-only";
import { createClient } from "@/lib/supabase/server";
import { EVENTS_BUCKET, IMAGE_SIGNED_URL_TTL_SECONDS } from "@/lib/events/storage";
import { todayInSaoPaulo } from "@/lib/utils";
import { matchesAnySegment } from "@/modules/event/event.audience";
import { compareEvents, formatTime, matchesEventFilters } from "@/modules/event/event.rules";
import {
  AUDIENCE_SHORTCUT_SLUG,
  type EventAuditAction,
  type EventAuditEntry,
  type EventFilters,
  type EventSegment,
  type EventStatus,
  type EventSummary,
} from "@/modules/event/event.types";

/**
 * SERVICE = leitura. Retorna o dado ou LANÇA erro (o caller decide como tratar).
 *
 * Passa pelo cliente autenticado — ou seja, pela RLS de `events`,
 * `event_segment_links` e `event_audit_logs`. Quem não é `admin`/`ceo`/
 * `comercial` não vê linha nenhuma, mesmo que a checagem de permissão da app
 * falhe.
 *
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 */

/**
 * Teto de leitura POR LADO da grid — os que estão por vir e os que já passaram.
 *
 * O projeto não tem paginação server-side em módulo nenhum, e não é aqui que
 * ela nasce. O recorte por PERÍODO vai para o SQL (usa o índice `events_date_idx`
 * e é o filtro que de fato corta volume); nome e status ficam em memória.
 *
 * O nome fica em memória por um motivo concreto: `ilike` no Postgres é sensível
 * a acento, e ninguém digita "Câmara" com circunflexo numa caixa de busca.
 * `normalizeForSearch` resolve isso sem depender da extensão `unaccent`. O
 * status fica junto porque depende do status EFETIVO — que é derivado, não uma
 * coluna que dê para comparar em SQL sem repetir a regra em dois lugares.
 *
 * ⚠️ POR LADO, e não um teto único, por causa de onde o corte cai. Uma leitura
 * só, ordenada por data crescente, guardaria os 200 eventos MAIS ANTIGOS — numa
 * agenda com histórico, isso esconderia justamente os próximos, que é para o que
 * a tela existe. Lendo os dois lados separadamente, o que sobra é sempre a
 * vizinhança de hoje.
 */
const SIDE_LIMIT = 100;

/**
 * Quantos eventos futuros varrer quando há filtro por público.
 *
 * O filtro de público é aplicado em MEMÓRIA sobre os públicos que já vêm no
 * mesmo `select`. A alternativa — perguntar antes "quais eventos têm estes
 * públicos?" e mandar a lista de ids num `in(...)` — não tem teto: ela devolve
 * todo evento já vinculado àqueles públicos, inclusive os passados e os
 * inativos, e a lista inteira vira query string. Algumas centenas de eventos já
 * produzem uma URL de dezenas de kB, que falha de uma vez em vez de degradar.
 */
const SEGMENT_SCAN_LIMIT = 200;

/**
 * `created_by` e `updated_by` são DUAS chaves estrangeiras para `profiles` nesta
 * tabela. Sem apontar a constraint, o PostgREST não sabe qual seguir e devolve
 * erro de ambiguidade.
 */
const EVENT_COLUMNS =
  "id, name, location, registration_url, event_date, start_time, end_time, status, " +
  "image_path, created_at, updated_at, " +
  "creator:profiles!events_created_by_fkey (id, full_name), " +
  "editor:profiles!events_updated_by_fkey (id, full_name), " +
  "links:event_segment_links (segment:event_segments (id, slug, name, description))";

interface ProfileRow {
  id: string;
  full_name: string | null;
}

interface SegmentRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

interface EventRow {
  id: string;
  name: string;
  location: string;
  registration_url: string | null;
  event_date: string;
  start_time: string;
  end_time: string | null;
  status: EventStatus;
  image_path: string;
  created_at: string;
  updated_at: string;
  creator: ProfileRow | null;
  editor: ProfileRow | null;
  links: { segment: SegmentRow | null }[];
}

function toActor(row: ProfileRow | null) {
  return row ? { id: row.id, fullName: row.full_name } : null;
}

function toSegment(row: SegmentRow): EventSegment {
  return { id: row.id, slug: row.slug, name: row.name, description: row.description };
}

/** Os públicos de uma linha, sem os vínculos que a RLS possa ter escondido. */
function rowSegments(row: EventRow): SegmentRow[] {
  return row.links
    .map((link) => link.segment)
    .filter((segment): segment is SegmentRow => segment !== null);
}

function toEvent(row: EventRow, imageUrl: string | null): EventSummary {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    registrationUrl: row.registration_url,
    eventDate: row.event_date,
    // O Postgres devolve `time` com os segundos ("14:00:00"). O domínio inteiro
    // trabalha em "HH:MM", que é o que o `<input type="time">` produz e o que a
    // comparação de ordem dos horários espera.
    startTime: formatTime(row.start_time),
    endTime: row.end_time ? formatTime(row.end_time) : null,
    status: row.status,
    imageUrl,
    segments: rowSegments(row)
      .map(toSegment)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    createdBy: toActor(row.creator),
    createdAt: row.created_at,
    updatedBy: toActor(row.editor),
    updatedAt: row.updated_at,
  };
}

/**
 * URLs assinadas para vários caminhos de uma vez.
 *
 * Uma chamada para a grid inteira, e não uma por linha: vinte eventos seriam
 * vinte idas ao Storage no meio da renderização.
 *
 * Falha aqui devolve `null` para o caminho afetado em vez de derrubar a página.
 * Uma grid com a imagem faltando ainda responde "que eventos existem"; uma
 * grid que não carrega não responde nada.
 */
async function signImageUrls(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(EVENTS_BUCKET)
    .createSignedUrls(paths, IMAGE_SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.error(`[events] URLs assinadas falharam: ${error.message}`);
    return urls;
  }

  for (const item of data ?? []) {
    if (item.signedUrl && item.path) urls.set(item.path, item.signedUrl);
  }

  return urls;
}

async function toEvents(rows: EventRow[]): Promise<EventSummary[]> {
  const urls = await signImageUrls(rows.map((row) => row.image_path));
  return rows.map((row) => toEvent(row, urls.get(row.image_path) ?? null));
}

/** O que a grid recebe: os eventos e o aviso de que a leitura bateu no teto. */
export interface EventListPage {
  events: EventSummary[];
  /**
   * `true` quando um dos lados encheu — pode haver evento fora desta lista, e a
   * busca por nome (que roda em memória) pode não tê-lo alcançado. A tela avisa
   * em vez de deixar a pessoa concluir que o evento não existe.
   */
  truncated: boolean;
}

/** A grid, já filtrada e ordenada (próximos primeiro). */
export async function listEvents(
  filters: EventFilters,
  today: string = todayInSaoPaulo(),
): Promise<EventListPage> {
  const supabase = await createClient();

  // O recorte por período vai para o banco: é o único filtro que corta volume
  // de verdade, e o índice `events_date_idx` já existe para ele.
  function scoped() {
    let query = supabase.from("events").select(EVENT_COLUMNS);
    if (filters.from) query = query.gte("event_date", filters.from);
    if (filters.to) query = query.lte("event_date", filters.to);
    return query;
  }

  // Os dois lados de "hoje", cada um lido do lado certo: os próximos em ordem
  // crescente (o primeiro é o mais iminente), os passados em decrescente (o
  // primeiro é o mais recente). Ver o comentário de SIDE_LIMIT.
  const [upcoming, past] = await Promise.all([
    scoped()
      .gte("event_date", today)
      .order("event_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(SIDE_LIMIT)
      // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
      .returns<EventRow[]>(),
    scoped()
      .lt("event_date", today)
      .order("event_date", { ascending: false })
      .order("start_time", { ascending: false })
      .limit(SIDE_LIMIT)
      .returns<EventRow[]>(),
  ]);

  for (const { error } of [upcoming, past]) {
    if (error) {
      console.error(`[events] listEvents falhou: ${error.message}`);
      throw error;
    }
  }

  const rows = [...(upcoming.data ?? []), ...(past.data ?? [])];
  // Uma assinatura de URLs para os dois lados juntos, e não uma por leitura.
  const events = await toEvents(rows);

  return {
    events: events
      .filter((event) => matchesEventFilters(event, filters, today))
      .sort((a, b) => compareEvents(a, b, today)),
    truncated: (upcoming.data?.length ?? 0) >= SIDE_LIMIT || (past.data?.length ?? 0) >= SIDE_LIMIT,
  };
}

/** Um evento pelo id, ou `null` se não existir (ou a RLS o esconder). */
export async function getEvent(eventId: string): Promise<EventSummary | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", eventId)
    .returns<EventRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[events] getEvent falhou: ${error.message}`);
    throw error;
  }
  if (!data) return null;

  const [event] = await toEvents([data]);
  return event ?? null;
}

/**
 * O catálogo de públicos-alvo, para o formulário. Só os ativos.
 *
 * O atalho "Toda a base" vai PRIMEIRO, fora da ordem alfabética. Por nome ele
 * cairia entre "Técnicos" e "Universidades" — no meio das caixas de seleção
 * comuns, sendo a única com semântica diferente (escolhê-lo grava os outros
 * quatro). Um controle que faz outra coisa não pode parecer igual aos vizinhos.
 */
export async function listEventSegments(): Promise<EventSegment[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_segments")
    .select("id, slug, name, description")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<SegmentRow[]>();

  if (error) {
    console.error(`[events] listEventSegments falhou: ${error.message}`);
    throw error;
  }

  return (data ?? []).map(toSegment).sort(compareSegmentsForForm);
}

/** Atalho primeiro; o resto em ordem alfabética de PT-BR. */
function compareSegmentsForForm(a: EventSegment, b: EventSegment): number {
  const aShortcut = a.slug === AUDIENCE_SHORTCUT_SLUG;
  const bShortcut = b.slug === AUDIENCE_SHORTCUT_SLUG;
  if (aShortcut !== bShortcut) return aShortcut ? -1 : 1;
  return a.name.localeCompare(b.name, "pt-BR");
}

interface AuditRow {
  id: number;
  action: EventAuditAction;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor: ProfileRow | null;
}

/**
 * A trilha de um evento, da mais recente para a mais antiga.
 *
 * A RLS de `event_audit_logs` só libera `admin` e `ceo` — para um `comercial`
 * isto devolve lista vazia SEM erro, que é como a RLS funciona (ela filtra
 * linhas, não recusa a consulta). Por isso a tela também precisa checar a
 * permissão antes de renderizar a seção: senão mostraria "nenhum registro" onde
 * o correto é não mostrar a seção.
 */
export async function listEventAuditLogs(eventId: string): Promise<EventAuditEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_audit_logs")
    .select(
      "id, action, metadata, created_at, actor:profiles!event_audit_logs_actor_id_fkey (id, full_name)",
    )
    .eq("event_id", eventId)
    .order("id", { ascending: false })
    .returns<AuditRow[]>();

  if (error) {
    console.error(`[events] listEventAuditLogs falhou: ${error.message}`);
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    action: row.action,
    actor: toActor(row.actor),
    createdAt: row.created_at,
    metadata: row.metadata ?? {},
  }));
}

/**
 * O evento alcança QUALQUER um dos públicos pedidos? (OU — nunca E.)
 *
 * Lê os públicos que já vieram no mesmo `select`, sem ida extra ao banco. Um
 * evento vinculado a dois dos públicos pedidos responde `true` uma vez só — a
 * deduplicação é consequência de a resposta ser booleana, não um passo à parte.
 *
 * A decisão em si é `matchesAnySegment`, a MESMA função que o chatbot usa. Uma
 * segunda cópia da regra aqui é como as duas pontas passariam a discordar —
 * inclusive no caso que importa, o de evento sem público não alcançar ninguém.
 */
function rowMatchesSegments(row: EventRow, segmentSlugs: readonly string[]): boolean {
  return matchesAnySegment(rowSegments(row), segmentSlugs);
}

/**
 * A PORTA DO CHATBOT — os eventos que podem ser oferecidos agora.
 *
 * A regra, e só ela: `status = 'active'` E a data ainda não passou. Não existe
 * caminho aqui que devolva um evento inativo ou vencido — anunciar um evento
 * que já aconteceu é pior do que não anunciar nada.
 *
 * O corte por data é feito no SQL contra `public.event_today()`, a MESMA função
 * que as regras de ativação usam. Se o corte fosse feito aqui em cima com o
 * relógio do processo, a Vercel (que roda em UTC) mudaria o dia às 21h.
 *
 * Ainda NÃO está ligada ao motor do chat: hoje todo texto do bot sai do catálogo
 * aprovado em `src/modules/chat/flows/csp.content.ts`, sem etapa de consulta a
 * eventos. Quando essa etapa existir, ela roda ANÔNIMA — `/api/chat` é público
 * e a RLS de `events` exige papel autenticado —, então precisará de
 * `service_role` no servidor e tem de passar por esta mesma função, para as
 * duas entradas não divergirem no dia em que a regra mudar.
 *
 * `segmentSlugs` restringe aos eventos de QUALQUER um dos públicos (OU — nunca
 * E). Passar uma lista VAZIA devolve zero eventos, e não "todos": ler ausência
 * de público como alcance total é exatamente o que geraria comunicação
 * indevida. Quem não quer restringir simplesmente não passa a opção.
 *
 * A resolução "público → quais associados" NÃO existe: não há cadastro de
 * associados neste banco. Ver `event.audience.ts` e docs/EVENTS.md.
 */
export async function getAvailableEvents(options?: {
  segmentSlugs?: readonly string[];
  limit?: number;
  /** Teto de data, para "esta semana" / "próximos 30 dias". AAAA-MM-DD. */
  untilDate?: string;
}): Promise<EventSummary[]> {
  const supabase = await createClient();

  const { data: today, error: todayError } = await supabase.rpc("event_today");
  if (todayError) {
    console.error(`[events] event_today falhou: ${todayError.message}`);
    throw todayError;
  }

  const limit = options?.limit ?? SEGMENT_SCAN_LIMIT;
  const slugs = options?.segmentSlugs ?? null;

  // Lista de públicos VAZIA devolve zero eventos, e não "todos": ler ausência de
  // público como alcance total é exatamente o que geraria comunicação indevida.
  if (slugs?.length === 0) return [];

  let query = supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("status", "active")
    .gte("event_date", today as string);

  if (options?.untilDate) query = query.lte("event_date", options.untilDate);

  const { data, error } = await query
    .order("event_date", { ascending: true })
    .order("start_time", { ascending: true })
    // Com filtro de público é preciso ler além do `limit`: o recorte acontece
    // depois, e parar em 10 devolveria menos de 10 eventos elegíveis.
    .limit(slugs ? Math.max(limit, SEGMENT_SCAN_LIMIT) : limit)
    .returns<EventRow[]>();

  if (error) {
    console.error(`[events] getAvailableEvents falhou: ${error.message}`);
    throw error;
  }

  const rows = data ?? [];
  const eligible = slugs ? rows.filter((row) => rowMatchesSegments(row, slugs)) : rows;

  // O recorte vem ANTES de assinar as URLs: assinar a varredura inteira para
  // devolver dez eventos seria pagar vinte vezes pelo que se usa.
  return toEvents(eligible.slice(0, limit));
}
