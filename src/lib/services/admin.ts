import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { messagingProvider } from "@/lib/messaging/registry";
import { isRole } from "@/lib/rbac/rbac.types";
import { SETTING_KEYS, type SettingKey } from "@/modules/admin/admin.labels";
import { formatCalendarDate } from "@/lib/utils";
import type {
  AdminAuditAction,
  AdminAuditEntry,
  AdminSegment,
  AdminUser,
  ConsentText,
  NotificationBlock,
  NotificationBlockPage,
  SegmentUse,
  WhatsAppIntegrationStatus,
} from "@/modules/admin/admin.types";

/**
 * SERVICE = leitura. Retorna o dado ou LANÇA erro.
 *
 * Tudo aqui passa pelo cliente autenticado, então pela RLS. As telas de
 * Administração checam `users.manage` / `settings.manage` antes de chamar, mas
 * essa checagem é a PRIMEIRA camada: quem chegar sem ser admin recebe lista
 * vazia (nas tabelas com policy) ou 42501 (nas funções `SECURITY DEFINER`).
 */

export const BLOCKS_PAGE_SIZE = 50;

/* -------------------------------------------------------------------------- */
/* Usuários                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Todo mundo que tem acesso ao CRM.
 *
 * ⚠️ A policy `profiles_select_own_or_admin` já faz o recorte: um não-admin que
 * chegasse aqui receberia UMA linha (a própria), não um erro. A tela ainda
 * redireciona antes — mas se algum dia ela esquecer, o pior caso é a pessoa ver
 * o próprio nome, não a lista inteira.
 */
interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  role_key?: string | null;
  created_at: string;
  active: boolean;
}

const USER_COLUMNS = "id, email, full_name, role, role_key, created_at, active";

/**
 * ⚠️ MESMA REDE DE SEGURANÇA DE `current-user.ts`, PELO MESMO MOTIVO.
 *
 * `profiles.role_key` nasce em 20260903000100_custom_roles.sql. Se este código
 * subir antes de a migration rodar, a consulta falha com 42703 e a tela de
 * Usuários — justamente a de quem precisaria consertar — para de abrir.
 *
 * REMOVER quando a migration estiver aplicada em produção.
 */
const USER_COLUMNS_LEGADO = "id, email, full_name, role, created_at, active";

function toAdminUser(linha: UserRow, selfId: string | undefined): AdminUser {
  return {
    id: linha.id,
    email: linha.email,
    fullName: linha.full_name,
    role: isRole(linha.role) ? linha.role : "viewer",
    // Sem cargo (banco anterior à migration), o papel do enum faz as vezes: os
    // quatro cargos embutidos têm exatamente as chaves do enum.
    roleKey: linha.role_key ?? linha.role,
    createdAt: linha.created_at,
    active: linha.active,
    isSelf: linha.id === selfId,
  };
}

export async function listUsers(): Promise<AdminUser[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  async function consultar(colunas: string) {
    return (
      supabase
        .from("profiles")
        .select(colunas)
        // ⚠️ INATIVOS PRIMEIRO NÃO — ordem de entrada. A lista é lida para achar
        // uma pessoa, não para auditar desligamentos: quem procura "a Ana" quer
        // encontrá-la onde ela sempre esteve, e não descobrir que ela mudou de
        // lugar porque alguém desligou a conta dela.
        .order("created_at", { ascending: true })
        .returns<UserRow[]>()
    );
  }

  let { data, error } = await consultar(USER_COLUMNS);
  if (error?.code === "42703") ({ data, error } = await consultar(USER_COLUMNS_LEGADO));

  if (error) throw error;

  return (data ?? []).map((linha) => toAdminUser(linha, user?.id));
}

/**
 * Uma pessoa, pelo id. Devolve `null` quando não existe — a tela responde 404
 * em vez de estourar, porque um link velho para alguém que saiu é normal.
 */
export async function getAdminUser(id: string): Promise<AdminUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  async function consultar(colunas: string) {
    return supabase
      .from("profiles")
      .select(colunas)
      .eq("id", id)
      .maybeSingle()
      .returns<UserRow | null>();
  }

  let { data, error } = await consultar(USER_COLUMNS);
  if (error?.code === "42703") ({ data, error } = await consultar(USER_COLUMNS_LEGADO));

  if (error) throw error;
  if (!data) return null;

  return toAdminUser(data, user?.id);
}

/** Quantos administradores ATIVOS existem — o número que trava a inativação. */
export async function countActiveAdmins(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("active", true);

  if (error) throw error;
  return count ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Públicos-alvo                                                              */
/* -------------------------------------------------------------------------- */

/**
 * O catálogo, com quantos eventos apontam para cada público.
 *
 * ⚠️ A CONTAGEM NÃO É ENFEITE: desativar um público que dez eventos usam é uma
 * decisão diferente de desativar um que ninguém usa. Sem o número, as duas
 * parecem o mesmo clique.
 */
interface SegmentRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  active: boolean;
  event_segment_links: { events: { id: string; name: string; event_date: string } | null }[] | null;
  survey_audience_criteria: { surveys: { id: string; title: string } | null }[] | null;
}

/**
 * ⚠️ A MESMA COISA PODE APARECER DUAS VEZES NA RESPOSTA, e por isso existe esta
 * função. Uma enquete pode ter mais de uma linha em `survey_audience_criteria`
 * apontando para o mesmo público (o editor de público não impede), e aí ela
 * viria repetida — a tela diria "usado por 2 enquetes" sobre uma enquete só.
 */
function dedupe(itens: SegmentUse[]): SegmentUse[] {
  const vistos = new Set<string>();
  return itens.filter((item) => (vistos.has(item.id) ? false : (vistos.add(item.id), true)));
}

export async function listSegments(): Promise<AdminSegment[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_segments")
    .select(
      "id, slug, name, description, active, event_segment_links(events(id, name, event_date)), survey_audience_criteria(surveys(id, title))",
    )
    .order("active", { ascending: false })
    .order("name", { ascending: true })
    .returns<SegmentRow[]>();

  if (error) throw error;

  return (data ?? []).map((linha) => ({
    id: linha.id,
    slug: linha.slug,
    name: linha.name,
    description: linha.description,
    active: linha.active,
    events: dedupe(
      (linha.event_segment_links ?? [])
        .map((elo) => elo.events)
        .filter((evento) => evento !== null)
        .map((evento) => ({
          id: evento.id,
          title: evento.name,
          href: `/events/${evento.id}`,
          detail: formatCalendarDate(evento.event_date),
        })),
    ),
    surveys: dedupe(
      (linha.survey_audience_criteria ?? [])
        .map((criterio) => criterio.surveys)
        .filter((enquete) => enquete !== null)
        .map((enquete) => ({
          id: enquete.id,
          title: enquete.title,
          href: `/surveys/${enquete.id}`,
          detail: null,
        })),
    ),
  }));
}

/* -------------------------------------------------------------------------- */
/* Bloqueios de notificação                                                   */
/* -------------------------------------------------------------------------- */

interface BlockRow {
  id: string;
  phone_key: string | null;
  source: string;
  note: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_note: string | null;
  member_id: string | null;
  member_name: string | null;
  contact_name: string | null;
  total_count: number;
}

export async function listNotificationBlocks(
  page = 1,
  includeRevoked = false,
): Promise<NotificationBlockPage> {
  const supabase = await createClient();
  const pagina = Math.max(1, page);

  const { data, error } = await supabase.rpc("list_notification_blocks", {
    p_limit: BLOCKS_PAGE_SIZE,
    p_offset: (pagina - 1) * BLOCKS_PAGE_SIZE,
    p_include_revoked: includeRevoked,
  } as never);

  if (error) throw error;

  const linhas = (data ?? []) as BlockRow[];

  return {
    // ⚠️ O total vem repetido em CADA linha (é uma janela dentro da função), e
    // a lista vazia não traz linha nenhuma — daí o `?? 0`. A alternativa seria
    // uma segunda consulta de contagem para desenhar a paginação.
    total: linhas[0]?.total_count ?? 0,
    page: pagina,
    pageSize: BLOCKS_PAGE_SIZE,
    rows: linhas.map(
      (l): NotificationBlock => ({
        id: l.id,
        phoneKey: l.phone_key,
        source: l.source,
        note: l.note,
        createdAt: l.created_at,
        revokedAt: l.revoked_at,
        revokedNote: l.revoked_note,
        memberId: l.member_id,
        memberName: l.member_name,
        contactName: l.contact_name,
      }),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Textos                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * As configurações de texto, já como mapa.
 *
 * Falha devolve mapa VAZIO em vez de lançar: quem chama tem um valor padrão
 * escrito no código (ver `readSetting`), e uma tela de configurações que não
 * abre porque uma consulta falhou é pior que uma que abre mostrando o padrão.
 */
export async function getAppSettings(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .returns<{ key: string; value: string }[]>();

  if (error) {
    console.error(`[admin] app_settings falhou: ${error.message}`);
    return new Map();
  }

  return new Map((data ?? []).map((linha) => [linha.key, linha.value]));
}

/**
 * ⚠️ O PADRÃO ESCRITO NO CÓDIGO É A REDE DE SEGURANÇA, e ele não é opcional.
 *
 * Se a linha sumir do banco (uma restauração parcial, uma migration não
 * aplicada), o valor abaixo é o que impede a APCS de mandar uma mensagem vazia
 * — que, na confirmação de opt-out, seria a pessoa achando que o pedido dela
 * não funcionou.
 */
export const SETTING_FALLBACKS: Record<SettingKey, string> = {
  [SETTING_KEYS.optOutConfirmed]:
    "Pronto. Você não receberá mais mensagens da APCS. " +
    "Se mudar de ideia, é só falar com a associação.",

  // ⚠️ AS CINCO DO CHATBOT SÃO IGUAIS AO SEED de 20260913000100_knowledge.sql, e
  // a duplicação é deliberada — é exatamente a rede de segurança descrita
  // acima. O banco é quem manda; isto é o que sobra se a linha não existir.
  //
  // Um bot sem frase de erro não fica calado: fica mandando string vazia, que
  // no WhatsApp é uma mensagem que nem chega a ser enviada. A pessoa vê a
  // própria pergunta e nenhuma resposta, e conclui que ninguém leu.
  [SETTING_KEYS.chatbotWelcome]:
    "Olá! 👋 Sou o assistente virtual da APCS.\n\n" +
    "Posso ajudar com Bolsa de Suínos, normativas, comunicados, eventos e palestras. O que você precisa?",
  [SETTING_KEYS.chatbotFallback]:
    "Não consegui entender sua solicitação. Posso ajudar com informações sobre Bolsa, " +
    "Normativas, Comunicação, Eventos ou Palestras.\n\n" +
    "Se preferir, posso encaminhar você para um atendente.",
  [SETTING_KEYS.chatbotNoResult]:
    "No momento, não encontramos uma publicação disponível para consulta. " +
    "Posso encaminhar você para um atendente?",
  [SETTING_KEYS.chatbotError]:
    "Não consegui consultar essa informação agora. Posso encaminhar você para um atendente?",
  [SETTING_KEYS.chatbotHumanHandoff]:
    "Certo! Já avisei a equipe da APCS. Alguém vai falar com você por aqui mesmo, " +
    "no horário de atendimento.",
  [SETTING_KEYS.chatbotUnidentified]:
    "Não encontrei este número no cadastro de associados da APCS, e a agenda de eventos " +
    "depende disso. Posso encaminhar você para um atendente?",
  // ⚠️ A ORDEM DAS OPÇÕES CASA COM `MENU_OPTIONS`, e as duas precisam continuar
  // casando. Ver o aviso em `src/modules/intelligence/menu.ts`.
  [SETTING_KEYS.chatbotMenu]:
    "Estou com uma limitação no atendimento automático agora. Posso ajudar por aqui:\n\n" +
    "1 - Bolsa de Suínos\n2 - Normativas\n3 - Comunicação (ISP, revista, calendário)\n" +
    "4 - Eventos\n5 - Falar com um atendente\n\nResponda com o número.",
  [SETTING_KEYS.chatbotClosing]: "De nada! Se precisar de mais alguma coisa, é só chamar. 👍",
  // ⚠️ O PADRÃO É "LIGADO", e é a escolha certa para uma CHAVE GERAL: a ausência
  // da configuração precisa significar o comportamento de antes de ela existir.
  // Um padrão "off" faria o robô nascer mudo em qualquer base onde a linha
  // sumisse — e o sintoma seria silêncio, que ninguém percebe.
  [SETTING_KEYS.chatbotEnabled]: "on",
};

export function readSetting(settings: Map<string, string>, key: SettingKey): string {
  return settings.get(key)?.trim() || SETTING_FALLBACKS[key];
}

/**
 * ⚠️ O TEXTO PADRÃO DO CONSENTIMENTO, e ele é diferente dos outros padrões.
 *
 * Se a tabela estiver vazia (migration não aplicada), a landing pública precisa
 * de ALGUM texto — um formulário que pede "aceito" sem dizer o que se aceita é
 * pior que um formulário fora do ar. A versão `fallback` é deliberadamente
 * feia: ela aparecendo na tela é o sinal de que a migration não rodou.
 */
export const CONSENT_FALLBACK: ConsentText = {
  version: "fallback",
  body:
    "Autorizo a APCS a tratar meus dados para análise do cadastro e comunicação " +
    "institucional, conforme a Lei Geral de Proteção de Dados.",
  createdAt: "",
  isCurrent: true,
};

/**
 * O texto vigente — o que a landing PÚBLICA mostra.
 *
 * ⚠️ NÃO USA `createClient()`, E ISSO NÃO É INCONSISTÊNCIA. Aquele cliente lê
 * `cookies()`, e no App Router qualquer leitura de cookie torna a página
 * DINÂMICA: a landing deixaria de ser HTML pré-gerado e passaria a bater no
 * servidor e no banco a cada visita. É a página pública mais acessada do
 * sistema, e ela pagaria isso por um texto que muda duas vezes por ano.
 *
 * Um cliente anônimo sem cookie nenhum resolve: a policy de `consent_texts` é
 * aberta a `anon` de propósito (ver a migration), então não há sessão a
 * carregar. Com isso a página volta a ser gerada estaticamente, e o
 * `revalidatePath("/associe-se")` da publicação é o que a atualiza na hora.
 */
export async function getCurrentConsentText(): Promise<ConsentText> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return CONSENT_FALLBACK;

  const supabase = createSupabaseClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("consent_texts")
    .select("version, body, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    .returns<{ version: string; body: string; created_at: string } | null>();

  if (error || !data) {
    if (error) console.error(`[admin] consent_texts falhou: ${error.message}`);
    return CONSENT_FALLBACK;
  }

  return { version: data.version, body: data.body, createdAt: data.created_at, isCurrent: true };
}

/** Todo o histórico de consentimento, do mais novo para o mais antigo. */
export async function listConsentTexts(): Promise<ConsentText[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consent_texts")
    .select("version, body, created_at")
    .order("created_at", { ascending: false })
    .returns<{ version: string; body: string; created_at: string }[]>();

  if (error) throw error;

  return (data ?? []).map((linha, indice) => ({
    version: linha.version,
    body: linha.body,
    createdAt: linha.created_at,
    // A vigente é a mais recente. Ver `current_consent_text()` no banco: não há
    // coluna de "ativa" justamente para não existirem duas ao mesmo tempo.
    isCurrent: indice === 0,
  }));
}

/* -------------------------------------------------------------------------- */
/* Integração de WhatsApp                                                     */
/* -------------------------------------------------------------------------- */

/**
 * O diagnóstico da integração.
 *
 * ⚠️ CADA NÚMERO AQUI VEM DE UM FATO, não de uma configuração. "Configurado"
 * responde se as variáveis existem; só a última mensagem que ENTROU prova que o
 * webhook está chegando, e só a última que SAIU prova que o envio funciona. As
 * três juntas são a diferença entre "deveria estar no ar" e "está".
 *
 * Consultas que falham não derrubam a tela: cada bloco cai para `null`/0 e o
 * resto continua respondendo. Uma página de diagnóstico que não abre é a pior
 * hora possível para uma página de diagnóstico não abrir.
 */
export async function getWhatsAppIntegrationStatus(): Promise<WhatsAppIntegrationStatus> {
  const supabase = await createClient();
  const provider = messagingProvider();

  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [entrada, saida, falhas, bloqueios] = await Promise.all([
    supabase
      .from("whatsapp_messages")
      .select("occurred_at")
      .eq("direction", "inbound")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .returns<{ occurred_at: string } | null>(),
    supabase
      .from("whatsapp_messages")
      .select("occurred_at")
      .eq("direction", "outbound")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .returns<{ occurred_at: string } | null>(),
    supabase
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "outbound")
      .eq("delivery_status", "failed")
      .gte("occurred_at", desde),
    supabase
      .from("notification_opt_outs")
      .select("id", { count: "exact", head: true })
      .is("revoked_at", null),
  ]);

  return {
    provider: provider.name,
    configured: provider.configured,
    missing: provider.missing,
    lastInboundAt: entrada.data?.occurred_at ?? null,
    lastOutboundAt: saida.data?.occurred_at ?? null,
    failedLast24h: falhas.count ?? 0,
    activeBlocks: bloqueios.count ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Trilha                                                                     */
/* -------------------------------------------------------------------------- */

export async function listAdminAudit(limit = 30, target?: string): Promise<AdminAuditEntry[]> {
  const supabase = await createClient();

  let consulta = supabase
    .from("admin_audit_logs")
    .select("id, action, target, actor_name, created_at, metadata")
    .order("created_at", { ascending: false })
    .limit(limit);

  // ⚠️ O ALVO É O E-MAIL, e é por isso que o histórico de alguém pode parecer
  // incompleto: as linhas gravadas ANTES de uma troca de endereço ficaram com o
  // endereço antigo. É o preço de a trilha guardar um texto legível em vez de
  // um id — e é o certo, porque a trilha precisa continuar legível depois que a
  // conta some.
  if (target) consulta = consulta.eq("target", target);

  const { data, error } = await consulta.returns<
    {
      id: string;
      action: AdminAuditAction;
      target: string | null;
      actor_name: string | null;
      created_at: string;
      metadata: Record<string, unknown> | null;
    }[]
  >();

  if (error) throw error;

  return (data ?? []).map((linha) => ({
    id: linha.id,
    action: linha.action,
    target: linha.target,
    actorName: linha.actor_name,
    createdAt: linha.created_at,
    metadata: linha.metadata ?? {},
  }));
}
