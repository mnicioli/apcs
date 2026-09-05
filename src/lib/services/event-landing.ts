import "server-only";
import { createClient } from "@/lib/supabase/server";
import { EVENTS_BUCKET, IMAGE_SIGNED_URL_TTL_SECONDS } from "@/lib/events/storage";
import { formatTime, todayInSaoPaulo } from "@/lib/utils";
import {
  compareLandingPages,
  matchesLandingFilters,
  matchesRegistrationFilters,
  readLandingFields,
} from "@/modules/event/event.landing.rules";
import type {
  LandingPageFilters,
  LandingPageStatus,
  LandingPageWithEvent,
  LandingSuccessMessage,
  ParticipantConfirmation,
  ParticipantRow,
  RegistrationAuditAction,
  RegistrationAuditEntry,
  RegistrationFilters,
  RegistrationOrigin,
  RegistrationRow,
  RegistrationStatus,
} from "@/modules/event/event.landing.types";

/**
 * SERVICE = leitura. Retorna o dado ou LANÇA erro (o caller decide como tratar).
 *
 * Passa pelo cliente autenticado — ou seja, pela RLS de `event_landing_pages`,
 * `event_registrations` e `event_participants`. Quem não tem papel não vê linha
 * nenhuma, mesmo que a checagem de permissão da aplicação falhe.
 *
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 *
 * ⚠️ NÃO EXISTE AQUI NENHUMA FUNÇÃO PARA A PÁGINA PÚBLICA, e a ausência é
 * deliberada. A leitura anônima da landing publicada é o Prompt 3, e o caminho
 * dela não é este arquivo: será uma função Postgres estreita chamada com
 * `service_role`, como `submit_membership_application`. Uma função aqui que
 * aceitasse um "leitor" opcional — o padrão de `getEvent` — abriria uma costura
 * para dado PESSOAL de terceiros, que é justamente onde ela não deve existir.
 */

/**
 * Teto de leitura da grid.
 *
 * O projeto não tem paginação server-side em módulo nenhum, e não é aqui que
 * ela nasce. O recorte que corta volume de verdade — a data do evento — vai
 * para o SQL; nome e situação ficam em memória, pelos mesmos motivos de
 * `listEvents`: `ilike` do Postgres é sensível a acento, e a situação efetiva é
 * derivada e não daria para comparar em SQL sem repetir a regra.
 *
 * ⚠️ NÃO VALE PARA PARTICIPANTES. Uma landing pode ter centenas de inscritos, e
 * o teto ali é outro — ver `REGISTRATION_LIMIT`.
 */
const LANDING_LIMIT = 200;

/**
 * Teto de inscrições lidas de uma vez.
 *
 * ⚠️ ESTE NÚMERO ENCOSTA NUM LIMITE REAL, ao contrário do da grid: um evento
 * grande da APCS pode passar de mil pessoas. `truncated` avisa a tela em vez de
 * deixar quem procura concluir que a pessoa não se inscreveu — e a exportação
 * do Prompt 4 vai precisar de um caminho próprio, que lê em lotes.
 */
const REGISTRATION_LIMIT = 1000;

/**
 * `created_by`, `updated_by` e `published_by` são TRÊS chaves estrangeiras para
 * `profiles` nesta tabela. Sem apontar a constraint, o PostgREST não sabe qual
 * seguir e devolve erro de ambiguidade.
 */
const LANDING_COLUMNS =
  "id, event_id, status, slug, description, image_path, form_fields, " +
  "success_title, success_message, success_footer, closes_at, max_participants, " +
  "created_at, updated_at, published_at, " +
  "creator:profiles!event_landing_pages_created_by_fkey (id, full_name), " +
  "editor:profiles!event_landing_pages_updated_by_fkey (id, full_name), " +
  "publisher:profiles!event_landing_pages_published_by_fkey (id, full_name), " +
  "event:events!event_landing_pages_event_id_fkey (" +
  "id, name, event_date, start_time, end_time, location, description, image_path)";

const REGISTRATION_COLUMNS =
  "id, event_id, landing_page_id, company_name, status, origin, registered_at, updated_at, " +
  "creator:profiles!event_registrations_created_by_fkey (id, full_name), " +
  "editor:profiles!event_registrations_updated_by_fkey (id, full_name), " +
  "participants:event_participants (" +
  "id, full_name, email, phone, whatsapp, confirmation, created_at, updated_at)";

interface ProfileRow {
  id: string;
  full_name: string | null;
}

interface EventRow {
  id: string;
  name: string;
  event_date: string;
  start_time: string;
  end_time: string | null;
  location: string;
  description: string | null;
  image_path: string;
}

interface LandingRow {
  id: string;
  event_id: string;
  status: LandingPageStatus;
  slug: string;
  description: string | null;
  image_path: string | null;
  form_fields: unknown;
  success_title: string | null;
  success_message: string | null;
  success_footer: string | null;
  closes_at: string | null;
  max_participants: number | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  creator: ProfileRow | null;
  editor: ProfileRow | null;
  publisher: ProfileRow | null;
  event: EventRow | null;
}

interface ParticipantDbRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  whatsapp: string | null;
  confirmation: ParticipantConfirmation;
  created_at: string;
  updated_at: string;
}

interface RegistrationDbRow {
  id: string;
  event_id: string;
  landing_page_id: string;
  company_name: string;
  status: RegistrationStatus;
  origin: RegistrationOrigin;
  registered_at: string;
  updated_at: string;
  creator: ProfileRow | null;
  editor: ProfileRow | null;
  participants: ParticipantDbRow[];
}

function toActor(row: ProfileRow | null) {
  return row ? { id: row.id, fullName: row.full_name } : null;
}

/**
 * URLs assinadas para vários caminhos de uma vez — uma chamada para a grid
 * inteira, e não uma por linha.
 *
 * Falha devolve `null` para o caminho afetado em vez de derrubar a página. Uma
 * grid com a imagem faltando ainda responde "que páginas existem"; uma grid que
 * não carrega não responde nada. Mesma decisão de `signImageUrls` em Eventos.
 */
async function signImages(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unicos = [...new Set(paths.filter((p) => p.length > 0))];
  if (unicos.length === 0) return urls;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(EVENTS_BUCKET)
    .createSignedUrls(unicos, IMAGE_SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.error(`[event-landing] URLs assinadas falharam: ${error.message}`);
    return urls;
  }

  for (const item of data ?? []) {
    if (item.signedUrl && item.path) urls.set(item.path, item.signedUrl);
  }

  return urls;
}

function toLandingPage(
  row: LandingRow,
  participantCount: number,
  urls: Map<string, string>,
): LandingPageWithEvent | null {
  // Sem evento não há página: a FK garante que ele existe, então `null` aqui só
  // acontece se a RLS de `events` o escondeu — e mostrar uma página de inscrição
  // sem dizer de que evento ela é seria pior que não mostrar.
  if (!row.event) return null;

  return {
    id: row.id,
    eventId: row.event_id,
    status: row.status,
    slug: row.slug,
    description: row.description,
    imageUrl: row.image_path ? (urls.get(row.image_path) ?? null) : null,
    formFields: readLandingFields(row.form_fields),
    successTitle: row.success_title,
    successMessage: row.success_message,
    successFooter: row.success_footer,
    closesAt: row.closes_at,
    maxParticipants: row.max_participants,
    participantCount,
    createdBy: toActor(row.creator),
    createdAt: row.created_at,
    updatedBy: toActor(row.editor),
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    publishedBy: toActor(row.publisher),
    event: {
      id: row.event.id,
      name: row.event.name,
      eventDate: row.event.event_date,
      // O Postgres devolve `time` com os segundos ("14:00:00"). O domínio
      // inteiro trabalha em "HH:MM".
      startTime: formatTime(row.event.start_time),
      endTime: row.event.end_time ? formatTime(row.event.end_time) : null,
      location: row.event.location,
      description: row.event.description,
      imageUrl: urls.get(row.event.image_path) ?? null,
    },
  };
}

/**
 * Quantas PESSOAS há em cada página, numa consulta só.
 *
 * ⚠️ EXISTE PARA NÃO FAZER N+1. A alternativa óbvia — chamar
 * `event_landing_participant_count` por linha — são vinte idas ao banco numa
 * grid de vinte páginas, no meio da renderização. Aqui é uma leitura das
 * inscrições ativas e a contagem em memória.
 *
 * ⚠️ E LÊ SÓ O QUE PRECISA: `event_participants(id)` traz o mínimo para contar.
 * O nome e o e-mail das pessoas não têm por que trafegar para responder
 * "quantos são" — é o §29 aplicado a uma consulta de listagem.
 */
async function countParticipantsByLanding(landingIds: string[]): Promise<Map<string, number>> {
  const contagem = new Map<string, number>();
  if (landingIds.length === 0) return contagem;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_registrations")
    .select("landing_page_id, participants:event_participants (id)")
    .in("landing_page_id", landingIds)
    .eq("status", "active")
    .returns<{ landing_page_id: string; participants: { id: string }[] }[]>();

  if (error) {
    console.error(`[event-landing] contagem de participantes falhou: ${error.message}`);
    // Zero, e não exceção: a grid mostrando "0 inscritos" ainda diz quais
    // páginas existem. O número que MANDA é o do banco, dentro da transação de
    // gravação — este é informativo.
    return contagem;
  }

  for (const linha of data ?? []) {
    contagem.set(
      linha.landing_page_id,
      (contagem.get(linha.landing_page_id) ?? 0) + linha.participants.length,
    );
  }

  return contagem;
}

/** O que a grid recebe: as páginas e o aviso de que a leitura bateu no teto. */
export interface LandingPageListPage {
  pages: LandingPageWithEvent[];
  truncated: boolean;
}

/** A grid de Landing Pages, já filtrada e ordenada (eventos próximos primeiro). */
export async function listLandingPages(
  filters: LandingPageFilters,
  today: string = todayInSaoPaulo(),
  now: Date = new Date(),
): Promise<LandingPageListPage> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_landing_pages")
    .select(LANDING_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(LANDING_LIMIT)
    // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
    .returns<LandingRow[]>();

  if (error) {
    console.error(`[event-landing] listLandingPages falhou: ${error.message}`);
    throw error;
  }

  const rows = data ?? [];
  const contagem = await countParticipantsByLanding(rows.map((row) => row.id));
  const urls = await signImages([
    ...rows.map((row) => row.image_path ?? ""),
    ...rows.map((row) => row.event?.image_path ?? ""),
  ]);

  const pages = rows
    .map((row) => toLandingPage(row, contagem.get(row.id) ?? 0, urls))
    .filter((page): page is LandingPageWithEvent => page !== null);

  return {
    pages: pages
      .filter((page) => matchesLandingFilters(page, filters, now))
      .sort((a, b) => compareLandingPages(a, b, today)),
    truncated: rows.length >= LANDING_LIMIT,
  };
}

/** Uma Landing Page pelo id, ou `null` se não existir (ou a RLS a esconder). */
export async function getLandingPage(landingPageId: string): Promise<LandingPageWithEvent | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_landing_pages")
    .select(LANDING_COLUMNS)
    .eq("id", landingPageId)
    .returns<LandingRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[event-landing] getLandingPage falhou: ${error.message}`);
    throw error;
  }
  if (!data) return null;

  const contagem = await countParticipantsByLanding([data.id]);
  const urls = await signImages([data.image_path ?? "", data.event?.image_path ?? ""]);

  return toLandingPage(data, contagem.get(data.id) ?? 0, urls);
}

/**
 * A Landing Page de um evento, ou `null` quando ele ainda não tem uma.
 *
 * ⚠️ `null` NÃO É ERRO AQUI: é a resposta certa para a maioria dos eventos. A
 * tela de detalhe do evento usa isto para decidir entre "Criar página de
 * inscrição" e mostrar a que existe.
 */
export async function getLandingPageByEvent(eventId: string): Promise<LandingPageWithEvent | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_landing_pages")
    .select(LANDING_COLUMNS)
    .eq("event_id", eventId)
    .returns<LandingRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[event-landing] getLandingPageByEvent falhou: ${error.message}`);
    throw error;
  }
  if (!data) return null;

  const contagem = await countParticipantsByLanding([data.id]);
  const urls = await signImages([data.image_path ?? "", data.event?.image_path ?? ""]);

  return toLandingPage(data, contagem.get(data.id) ?? 0, urls);
}

/**
 * O texto padrão de confirmação da plataforma (§18).
 *
 * ⚠️ TEM PADRÃO EMBUTIDO, e ele não contradiz o §18. As três chaves são
 * semeadas pela migration; este `??` é para o caso de alguém as ter apagado do
 * banco — e uma página de confirmação em branco é pior que um texto genérico.
 * O que o §18 proíbe é a mensagem MORAR no código, e ela não mora: quem manda é
 * `app_settings`, editável em /settings/texts.
 */
export async function getRegistrationSuccessDefaults(): Promise<LandingSuccessMessage> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", [
      "events.registration_success_title",
      "events.registration_success_message",
      "events.registration_success_footer",
    ])
    .returns<{ key: string; value: string }[]>();

  if (error) {
    console.error(`[event-landing] textos de confirmação falharam: ${error.message}`);
  }

  const porChave = new Map((data ?? []).map((linha) => [linha.key, linha.value]));

  return {
    title: porChave.get("events.registration_success_title") ?? "INSCRIÇÃO CONFIRMADA!",
    message:
      porChave.get("events.registration_success_message") ??
      "Seu cadastro para o <EVENTO> foi realizado com sucesso.",
    footer:
      porChave.get("events.registration_success_footer") ?? "Esperamos você! Nos vemos no evento.",
  };
}

/* -------------------------------------------------------------------------- */
/* Inscrições                                                                 */
/* -------------------------------------------------------------------------- */

function toRegistration(row: RegistrationDbRow): RegistrationRow {
  return {
    id: row.id,
    eventId: row.event_id,
    landingPageId: row.landing_page_id,
    companyName: row.company_name,
    status: row.status,
    origin: row.origin,
    registeredAt: row.registered_at,
    participants: row.participants
      .map(
        (pessoa): ParticipantRow => ({
          id: pessoa.id,
          fullName: pessoa.full_name,
          email: pessoa.email,
          phone: pessoa.phone,
          whatsapp: pessoa.whatsapp,
          confirmation: pessoa.confirmation,
          createdAt: pessoa.created_at,
          updatedAt: pessoa.updated_at,
        }),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "pt-BR")),
    createdBy: toActor(row.creator),
    updatedBy: toActor(row.editor),
    updatedAt: row.updated_at,
  };
}

export interface RegistrationListPage {
  registrations: RegistrationRow[];
  truncated: boolean;
}

/**
 * As inscrições de um EVENTO, mais recentes primeiro.
 *
 * ⚠️ POR EVENTO, E NÃO POR LANDING PAGE, mesmo com a landing sendo 1:1 com o
 * evento. A pergunta que a tela faz é "quem vai a este evento", e ela precisa
 * continuar respondível no dia em que uma inscrição tiver entrado por outro
 * caminho. `event_registrations_event_idx` existe exatamente para esta consulta.
 */
export async function listRegistrations(
  eventId: string,
  filters: RegistrationFilters,
): Promise<RegistrationListPage> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_registrations")
    .select(REGISTRATION_COLUMNS)
    .eq("event_id", eventId)
    .order("registered_at", { ascending: false })
    .limit(REGISTRATION_LIMIT)
    .returns<RegistrationDbRow[]>();

  if (error) {
    console.error(`[event-landing] listRegistrations falhou: ${error.message}`);
    throw error;
  }

  const rows = data ?? [];

  return {
    registrations: rows
      .map(toRegistration)
      .filter((registro) => matchesRegistrationFilters(registro, filters)),
    truncated: rows.length >= REGISTRATION_LIMIT,
  };
}

/** Uma inscrição pelo id, com os participantes dela. */
export async function getRegistration(registrationId: string): Promise<RegistrationRow | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_registrations")
    .select(REGISTRATION_COLUMNS)
    .eq("id", registrationId)
    .returns<RegistrationDbRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[event-landing] getRegistration falhou: ${error.message}`);
    throw error;
  }

  return data ? toRegistration(data) : null;
}

interface AuditRow {
  id: number;
  action: RegistrationAuditAction;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor: ProfileRow | null;
}

/**
 * A trilha de uma inscrição, da mais recente para a mais antiga.
 *
 * A RLS de `event_registration_audit_logs` só libera o administrador — para um
 * `comercial` isto devolve lista vazia SEM erro, que é como a RLS funciona (ela
 * filtra linhas, não recusa a consulta). Por isso a tela também precisa checar
 * a permissão antes de renderizar a seção: senão mostraria "nenhum registro"
 * onde o correto é não mostrar a seção. Mesma armadilha de `listEventAuditLogs`.
 */
export async function listRegistrationAuditLogs(
  registrationId: string,
): Promise<RegistrationAuditEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_registration_audit_logs")
    .select(
      "id, action, metadata, created_at, " +
        "actor:profiles!event_registration_audit_logs_actor_id_fkey (id, full_name)",
    )
    .eq("registration_id", registrationId)
    .order("id", { ascending: false })
    .returns<AuditRow[]>();

  if (error) {
    console.error(`[event-landing] listRegistrationAuditLogs falhou: ${error.message}`);
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
