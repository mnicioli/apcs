import "server-only";
import { createClient } from "@/lib/supabase/server";
import { EVENTS_BUCKET, IMAGE_SIGNED_URL_TTL_SECONDS } from "@/lib/events/storage";
import { formatTime, todayInSaoPaulo } from "@/lib/utils";
import {
  compareLandingPages,
  matchesLandingFilters,
  readLandingFields,
} from "@/modules/event/event.landing.rules";
import { REGISTRATION_PAGE_SIZE } from "@/modules/event/event.landing.types";
import type {
  EventRegistrationSummary,
  EventRegistrationSummaryPage,
  RegistrationBoardFilters,
  RegistrationBoardMetrics,
  RegistrationBoardPage,
  RegistrationBoardRow,
  LandingPageFilters,
  LandingPageStatus,
  LandingPageWithEvent,
  LandingSuccessMessage,
  ParticipantConfirmation,
  ParticipantRow,
  RegistrationAuditAction,
  RegistrationAuditEntry,
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
 * ⚠️ NÃO VALE PARA PARTICIPANTES. A leitura deles é `getRegistrationBoard`, que
 * pagina no banco — ver o fim deste arquivo.
 */
const LANDING_LIMIT = 200;

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
  eventEmbed(false);

/**
 * A MESMA LISTA, COM JUNÇÃO INTERNA NO EVENTO.
 *
 * ⚠️ EXISTE PARA O FILTRO DE PERÍODO PODER IR AO SQL. O PostgREST só aceita
 * `.gte("event.event_date", …)` quando o embed é uma junção INTERNA — com a
 * externa (o padrão) ele não tem como filtrar a linha de fora pela de dentro.
 *
 * Seguro aqui porque `event_id` é `not null`: toda página tem evento, e a
 * junção interna não descarta linha nenhuma.
 */
const LANDING_COLUMNS_INNER =
  LANDING_COLUMNS.slice(0, LANDING_COLUMNS.indexOf("event:events")) + eventEmbed(true);

/**
 * O embed do evento, nas duas formas.
 *
 * Uma função, e não duas strings: a lista de colunas do evento é a mesma nos
 * dois casos, e mantê-la escrita duas vezes é como uma delas fica para trás no
 * dia em que o evento ganhar um campo.
 */
function eventEmbed(inner: boolean): string {
  return (
    `event:events!event_landing_pages_event_id_fkey${inner ? "!inner" : ""} (` +
    "id, name, event_date, start_time, end_time, location, description, image_path)"
  );
}

const REGISTRATION_COLUMNS =
  "id, event_id, landing_page_id, company_name, status, origin, registered_at, updated_at, " +
  "creator:profiles!event_registrations_created_by_fkey (id, full_name), " +
  "editor:profiles!event_registrations_updated_by_fkey (id, full_name), " +
  // ⚠️ A CONSTRAINT É NOMEADA — ver `countParticipantsByLanding`. Sem isto o
  // PostgREST recusa o embed inteiro, e a inscrição volta SEM participantes.
  "participants:event_participants!event_participants_registration_id_fkey (" +
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
 * ============================================================================
 * ⚠️ O EMBED NOMEIA A CONSTRAINT, E ISSO NÃO É ESTILO — É O QUE FAZ A CONSULTA
 * FUNCIONAR.
 * ============================================================================
 * `event_participants` tem DUAS chaves estrangeiras para `event_registrations`:
 * a da coluna (`registration_id`) e a COMPOSTA da decisão 3 do Prompt 1
 * (`(registration_id, event_id)`, que guarda a cópia de `event_id`). O PostgREST
 * vê as duas, não sabe qual seguir e recusa o embed inteiro com
 * "more than one relationship was found".
 *
 * ⚠️ ESTE DEFEITO EXISTIU DO PROMPT 1 ATÉ A HOMOLOGAÇÃO, E NINGUÉM VIU. A
 * consulta falhava SEMPRE; o tratamento de erro devolvia mapa vazio; a grid
 * mostrava "0 inscritos" para todo mundo. Um número errado e PLAUSÍVEL não
 * levanta suspeita — e os testes não pegaram porque mockam o Supabase, que é
 * justamente quem recusava. Só apareceu quando uma Landing Page de verdade foi
 * criada e alguém leu o console.
 *
 * É a mesma disambiguação que `LANDING_COLUMNS` já fazia para os três
 * `profiles` — a lição é que ela vale para QUALQUER embed deste módulo.
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
    .select(
      "landing_page_id, participants:event_participants!event_participants_registration_id_fkey (id)",
    )
    .in("landing_page_id", landingIds)
    .eq("status", "active")
    .returns<{ landing_page_id: string; participants: { id: string }[] }[]>();

  if (error) {
    console.error(`[event-landing] contagem de participantes falhou: ${error.message}`);
    // ⚠️ ZERO, E NÃO EXCEÇÃO — MAS ESSA ESCOLHA JÁ ESCONDEU UM DEFEITO POR
    // QUATRO ETAPAS, e vale saber disso antes de confiar nela.
    //
    // O embed acima era ambíguo (ver o aviso do cabeçalho desta função), então
    // esta consulta falhava SEMPRE. O `catch` transformava a falha em "0
    // inscritos", a grid abria normalmente, e ninguém tinha por que desconfiar
    // de um número plausível. Só apareceu quando alguém criou uma Landing Page
    // de verdade e olhou o console.
    //
    // A decisão continua certa — uma grid que não carrega não responde nada, e
    // o número que MANDA é o do banco, dentro da transação de gravação. Mas o
    // log é a ÚNICA pista que sobra: quem mexer aqui precisa lê-lo.
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

  /**
   * ⚠️ O PERÍODO VAI PARA O SQL, e não é detalhe de desempenho — é o que faz o
   * filtro do §4 funcionar de verdade.
   *
   * Com o recorte só em memória, procurar "eventos de outubro" leria as
   * primeiras `LANDING_LIMIT` páginas por data de criação e filtraria o que
   * viesse: uma página de outubro criada há muito tempo simplesmente não
   * apareceria, e `truncated` avisaria que "pode faltar coisa" sem que ninguém
   * soubesse o quê.
   *
   * O filtro é sobre a data do EVENTO, que mora na tabela vizinha — daí a
   * junção interna, que é o que permite ao PostgREST filtrar por ela.
   *
   * O nome e a situação continuam em memória, pelos mesmos motivos de
   * `listEvents`: `ilike` do Postgres é sensível a acento, e a situação efetiva
   * é derivada — compará-la em SQL exigiria repetir a regra em dois lugares.
   */
  const temPeriodo = filters.from !== "" || filters.to !== "";

  let query = supabase
    .from("event_landing_pages")
    .select(temPeriodo ? LANDING_COLUMNS_INNER : LANDING_COLUMNS);
  if (filters.from) query = query.gte("event.event_date", filters.from);
  if (filters.to) query = query.lte("event.event_date", filters.to);

  const { data, error } = await query
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

/**
 * ============================================================================
 * ⚠️ `listRegistrations` FOI REMOVIDA NA HOMOLOGAÇÃO, E A NOTA FICA NO LUGAR.
 * ============================================================================
 * Ela era o caminho de leitura que o Prompt 1 preparou para a tela de
 * Inscrições: lia até mil INSCRIÇÕES do evento e filtrava em memória. O Prompt 4
 * a substituiu por `getRegistrationBoard`, que pagina, busca e conta NO BANCO —
 * porque a grid é de PARTICIPANTES e a busca atravessa duas tabelas.
 *
 * Manter as duas seria deixar uma armadilha: quem precisasse listar inscrições
 * encontraria primeiro a versão que traz mil linhas de dado pessoal para a
 * memória do servidor e filtra ali — exatamente o que o §7 do Prompt 4 proíbe.
 * Código morto que ainda COMPILA e ainda FUNCIONA é o mais perigoso, porque
 * parece uma escolha legítima.
 *
 * Foram junto: `RegistrationListPage`, `REGISTRATION_LIMIT`,
 * `matchesRegistrationFilters` e `countByConfirmation` — todas parte do mesmo
 * caminho, todas sem chamador fora dos próprios testes.
 */

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

/** Um evento que ainda pode receber uma página de inscrição. */
export interface EventForLanding {
  id: string;
  name: string;
  eventDate: string;
  startTime: string;
  endTime: string | null;
  location: string;
}

/**
 * OS EVENTOS QUE PODEM GANHAR UMA LANDING PAGE (§5 do Prompt 2).
 *
 * ⚠️ DOIS RECORTES, E OS DOIS SÃO "EVENTO VÁLIDO" NO SENTIDO DO PROMPT 1:
 *
 *   1. **Ainda não tem página.** `event_landing_pages.event_id` é `unique`, e
 *      `create_event_landing_page` recusa a segunda com LP005. Oferecer o
 *      evento na lista e recusá-lo no clique seria mandar a pessoa descobrir a
 *      regra por tentativa.
 *
 *   2. **A data não passou.** `set_event_landing_page_status` recusa publicar a
 *      página de um evento vencido (EV001, a mesma regra de `set_event_status`).
 *      Um rascunho que nunca poderá ir ao ar não é um começo de trabalho — é um
 *      beco.
 *
 * ⚠️ A EXCLUSÃO É FEITA EM MEMÓRIA, e não com `not.in(...)`. A lista de ids de
 * páginas existentes viraria query string — e o PostgREST cobra isso em
 * tamanho de URL, que falha de uma vez em vez de degradar. Duas leituras
 * pequenas e um `Set` custam menos e não têm teto escondido.
 */
export async function listEventsWithoutLandingPage(
  today: string = todayInSaoPaulo(),
): Promise<EventForLanding[]> {
  const supabase = await createClient();

  const [eventos, paginas] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, event_date, start_time, end_time, location")
      .gte("event_date", today)
      .order("event_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(LANDING_LIMIT)
      .returns<
        {
          id: string;
          name: string;
          event_date: string;
          start_time: string;
          end_time: string | null;
          location: string;
        }[]
      >(),
    supabase.from("event_landing_pages").select("event_id").returns<{ event_id: string }[]>(),
  ]);

  if (eventos.error) {
    console.error(`[event-landing] listEventsWithoutLandingPage falhou: ${eventos.error.message}`);
    throw eventos.error;
  }

  // ⚠️ FALHA AQUI NÃO ESCONDE EVENTO. Se a leitura das páginas der errado, o
  // conjunto fica vazio e todos os eventos aparecem — a criação então é
  // recusada pelo banco com a mensagem certa (LP005). O contrário — esconder
  // tudo — faria a tela dizer "não há eventos disponíveis", que é uma mentira
  // sobre o cadastro.
  if (paginas.error) {
    console.error(
      `[event-landing] leitura das páginas existentes falhou: ${paginas.error.message}`,
    );
  }

  const jaTem = new Set((paginas.data ?? []).map((linha) => linha.event_id));

  return (eventos.data ?? [])
    .filter((evento) => !jaTem.has(evento.id))
    .map((evento) => ({
      id: evento.id,
      name: evento.name,
      eventDate: evento.event_date,
      startTime: formatTime(evento.start_time),
      endTime: evento.end_time ? formatTime(evento.end_time) : null,
      location: evento.location,
    }));
}

/* -------------------------------------------------------------------------- */
/* O backoffice de Inscrições (Prompt 4)                                      */
/* -------------------------------------------------------------------------- */

/**
 * A TELA INICIAL DE INSCRIÇÕES (§4) — os eventos que têm página de inscrição.
 *
 * ⚠️ POR RPC, E NÃO POR `select` COM EMBEDS. Cada linha mostra quatro contagens
 * (inscrições, participantes, confirmados, não confirmados). Pelo PostgREST
 * isso seria a grid inteira vindo com os participantes dentro, para o
 * TypeScript contar em memória — dado pessoal de centenas de terceiros
 * trafegando para responder "quantos são" (§25). A função conta no banco e
 * devolve números.
 */
export async function listEventRegistrationSummaries(
  query: string,
  page: number,
  pageSize: number = REGISTRATION_PAGE_SIZE,
): Promise<EventRegistrationSummaryPage> {
  const supabase = await createClient();
  const paginaAtual = Math.max(1, page);

  const { data, error } = await supabase.rpc("event_registration_summaries", {
    p_query: query.trim() || undefined,
    p_limit: pageSize,
    p_offset: (paginaAtual - 1) * pageSize,
  } as never);

  if (error) {
    console.error(`[event-landing] listEventRegistrationSummaries falhou: ${error.code}`);
    throw error;
  }

  const bruto = (data ?? {}) as { total?: unknown; rows?: unknown };

  return {
    rows: Array.isArray(bruto.rows) ? (bruto.rows as EventRegistrationSummary[]) : [],
    total: typeof bruto.total === "number" ? bruto.total : 0,
    page: paginaAtual,
    pageSize,
  };
}

/**
 * A GRID DE PARTICIPANTES DE UM EVENTO (§6, §7, §8, §9, §21).
 *
 * ============================================================================
 * ⚠️ MÉTRICAS, LINHAS E TOTAL VÊM DA MESMA CONSULTA — E É O §6, NÃO DESEMPENHO.
 * ============================================================================
 * "Os indicadores devem respeitar os filtros ativos." Com uma consulta para a
 * lista e outra para os contadores, o mesmo `where` existiria em dois lugares, e
 * o dia em que um filtro novo entrasse só num deles a tela diria "12
 * confirmados" sobre uma lista de 5. Ninguém confere a soma à mão.
 *
 * ⚠️ E A BUSCA É DO BANCO (§7: "não carregar todos os participantes para o
 * frontend apenas para realizar a busca"). Ela atravessa DUAS tabelas — a
 * granja mora na inscrição, a pessoa mora no participante —, e é por isso que
 * é uma função e não um `or=` do PostgREST, que não cruza a junção.
 *
 * A RLS continua valendo: `event_registrations_board` é SECURITY INVOKER, então
 * quem não tem `registrations_is_reader()` recebe zero linhas mesmo que a
 * checagem de permissão da aplicação falhe.
 */
export async function getRegistrationBoard(
  eventId: string,
  filters: RegistrationBoardFilters,
  pageSize: number = REGISTRATION_PAGE_SIZE,
): Promise<RegistrationBoardPage> {
  const supabase = await createClient();
  const paginaAtual = Math.max(1, filters.page);

  const { data, error } = await supabase.rpc("event_registrations_board", {
    p_event_id: eventId,
    p_query: filters.query.trim() || undefined,
    p_confirmation: filters.confirmation === "all" ? undefined : filters.confirmation,
    // ⚠️ AS DATAS VÃO CRUAS, EM AAAA-MM-DD, E O FUSO É APLICADO NO BANCO.
    //
    // A primeira versão montava o instante aqui (`${filters.from}T00:00:00`), e
    // isso custou um defeito de TRÊS HORAS: um literal sem fuso é lido pelo
    // Postgres no fuso do SERVIDOR (UTC na Supabase), então "a partir de 06/09"
    // virava 05/09 às 21h em São Paulo. Ver o cabeçalho de
    // 20260925000200_event_registration_period.sql.
    //
    // Quem sabe o que é "o dia 6" é o calendário de quem olha a tela, e a
    // conversão mora onde `event_today()` já mora.
    p_from: filters.from || undefined,
    p_to: filters.to || undefined,
    p_sort: filters.sort,
    p_limit: pageSize,
    p_offset: (paginaAtual - 1) * pageSize,
  } as never);

  if (error) {
    // ⚠️ SÓ O CÓDIGO E O EVENTO (§25). O termo buscado pode ser o e-mail ou o
    // telefone de alguém — um log de erro que o carregue é dado pessoal
    // vazando por um caminho que ninguém audita.
    console.error(`[event-landing] getRegistrationBoard falhou (${eventId}): ${error.code}`);
    throw error;
  }

  const bruto = (data ?? {}) as { rows?: unknown; metrics?: unknown; total?: unknown };
  const metricas = (bruto.metrics ?? {}) as Partial<RegistrationBoardMetrics>;

  return {
    rows: Array.isArray(bruto.rows) ? (bruto.rows as RegistrationBoardRow[]) : [],
    metrics: {
      registrations: metricas.registrations ?? 0,
      participants: metricas.participants ?? 0,
      confirmed: metricas.confirmed ?? 0,
      notConfirmed: metricas.notConfirmed ?? 0,
      companies: metricas.companies ?? 0,
    },
    total: typeof bruto.total === "number" ? bruto.total : 0,
    page: paginaAtual,
    pageSize,
  };
}
