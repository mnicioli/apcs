import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { messagingProvider } from "@/lib/messaging/registry";
import { isRole } from "@/lib/rbac/rbac.types";
import { SETTING_KEYS, type SettingKey } from "@/modules/admin/admin.labels";
import type {
  AdminAuditAction,
  AdminAuditEntry,
  AdminSegment,
  AdminUser,
  ConsentText,
  NotificationBlock,
  NotificationBlockPage,
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
export async function listUsers(): Promise<AdminUser[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, created_at")
    .order("created_at", { ascending: true })
    .returns<
      {
        id: string;
        email: string;
        full_name: string | null;
        role: string;
        created_at: string;
      }[]
    >();

  if (error) throw error;

  return (data ?? []).map((linha) => ({
    id: linha.id,
    email: linha.email,
    fullName: linha.full_name,
    role: isRole(linha.role) ? linha.role : "viewer",
    createdAt: linha.created_at,
    isSelf: linha.id === user?.id,
  }));
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
export async function listSegments(): Promise<AdminSegment[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_segments")
    .select("id, slug, name, description, active, event_segment_links(count)")
    .order("active", { ascending: false })
    .order("name", { ascending: true })
    .returns<
      {
        id: string;
        slug: string;
        name: string;
        description: string | null;
        active: boolean;
        event_segment_links: { count: number }[] | null;
      }[]
    >();

  if (error) throw error;

  return (data ?? []).map((linha) => ({
    id: linha.id,
    slug: linha.slug,
    name: linha.name,
    description: linha.description,
    active: linha.active,
    eventCount: linha.event_segment_links?.[0]?.count ?? 0,
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

export async function listAdminAudit(limit = 30): Promise<AdminAuditEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("admin_audit_logs")
    .select("id, action, target, actor_name, created_at, metadata")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<
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
