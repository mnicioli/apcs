import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  MEMBERSHIP_APPLICATION_STATUSES,
  type MemberRow,
  type MembershipApplicationCounts,
  type MembershipApplicationDetail,
  type MembershipApplicationRow,
  type MembershipApplicationStatus,
  type MembershipAuditAction,
} from "@/modules/membership/membership.types";

/**
 * SERVICE = leitura. Retorna o dado ou LANÇA erro (o caller decide como tratar).
 *
 * Passa pelo cliente autenticado — ou seja, pela RLS de `membership_applications`
 * e `members`. Quem não é `admin`/`ceo`/`comercial` não vê linha nenhuma, mesmo
 * que a checagem de permissão da app falhe.
 *
 * ⚠️ ESTE ARQUIVO NÃO ESCREVE NADA. O formulário público não passa por aqui: ele
 * entra por `src/lib/actions/membership.ts`, com a chave de service_role, porque
 * o visitante não tem sessão. Ver a decisão 2 da migration.
 *
 * O filtro é SQL, não `.filter()` em memória, pelo mesmo motivo de Palestras: a
 * caixa de entrada cresce sozinha (é um formulário aberto na internet) e
 * filtrar DEPOIS de paginar devolveria páginas com buracos.
 */

const APPLICATION_COLUMNS =
  "id, protocol, status, profile_type, full_name, email, whatsapp, city, state, " +
  "organization, created_at, reviewed_at, member_id";

const APPLICATION_DETAIL_COLUMNS =
  APPLICATION_COLUMNS +
  ", farm_name, production_city, sow_count, cnpj, state_registration, " +
  "activity_area, job_title, legal_name, trade_name, interests, other_interest, " +
  "consent_at, consent_policy_version, review_note, " +
  "reviewer:profiles!membership_applications_reviewed_by_fkey (id, full_name), " +
  "member:members!membership_applications_member_id_fkey (" +
  "id, code, status, origin, profile_type, full_name, email, whatsapp, city, state, " +
  "organization, joined_at, created_at)";

const MEMBER_COLUMNS =
  "id, code, status, origin, profile_type, full_name, email, whatsapp, city, state, " +
  "organization, joined_at, created_at";

/** Tamanho da página da grid. */
export const APPLICATIONS_PAGE_SIZE = 20;

export interface MembershipApplicationFilters {
  status?: MembershipApplicationStatus | "all";
  search?: string;
  page?: number;
}

export interface MembershipApplicationPage {
  rows: MembershipApplicationRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface ApplicationRowShape {
  id: string;
  protocol: string;
  status: MembershipApplicationStatus;
  profile_type: MembershipApplicationRow["profileType"];
  full_name: string;
  email: string;
  whatsapp: string;
  city: string;
  state: string;
  organization: string | null;
  created_at: string;
  reviewed_at: string | null;
  member_id: string | null;
}

interface MemberRowShape {
  id: string;
  code: string | null;
  status: MemberRow["status"];
  origin: MemberRow["origin"];
  profile_type: MemberRow["profileType"];
  full_name: string;
  email: string | null;
  whatsapp: string | null;
  city: string | null;
  state: string | null;
  organization: string | null;
  joined_at: string | null;
  created_at: string;
}

function toApplicationRow(row: ApplicationRowShape): MembershipApplicationRow {
  return {
    id: row.id,
    protocol: row.protocol,
    status: row.status,
    profileType: row.profile_type,
    fullName: row.full_name,
    email: row.email,
    whatsapp: row.whatsapp,
    city: row.city,
    state: row.state,
    organization: row.organization,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    memberId: row.member_id,
  };
}

/**
 * A chave de comparação de telefone — a MESMA de `notification_phone_key()` no
 * Postgres: os últimos 11 dígitos (DDD + celular).
 *
 * ⚠️ ESTÁ DUPLICADA EM DOIS LUGARES DE PROPÓSITO, e a duplicação é vigiada por
 * teste. A alternativa seria uma ida ao banco por linha da lista só para
 * calcular um `substring` — cinquenta consultas para desenhar uma página. Se as
 * duas divergirem, a lista mostra "recebe" para quem pediu para sair, então o
 * teste que as compara não é decoração.
 */
export function notificationPhoneKey(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "").slice(-11);
}

/**
 * Quais destes telefones pediram para não receber.
 *
 * Uma consulta para o conjunto todo. Falha devolve conjunto VAZIO e registra —
 * ver o porquê em `listMembers`: a lista de associados é útil sem esta coluna,
 * e derrubá-la porque o opt-out não respondeu trocaria um dado a menos por uma
 * tela a menos.
 */
async function fetchBlockedPhoneKeys(
  supabase: Awaited<ReturnType<typeof createClient>>,
  phones: readonly (string | null | undefined)[],
): Promise<Set<string>> {
  const chaves = [...new Set(phones.map(notificationPhoneKey).filter(Boolean))];
  if (chaves.length === 0) return new Set();

  const { data, error } = await supabase
    .from("notification_opt_outs")
    .select("phone_key")
    .in("phone_key", chaves);

  if (error) {
    console.error(`[membership] opt-outs falharam: ${error.message}`);
    return new Set();
  }

  return new Set(
    (data ?? [])
      .map((o) => (o as { phone_key: string | null }).phone_key)
      .filter((k): k is string => Boolean(k)),
  );
}

function toMemberRow(row: MemberRowShape, blocked: ReadonlySet<string>): MemberRow {
  return {
    optedOut: blocked.has(notificationPhoneKey(row.whatsapp)),
    id: row.id,
    code: row.code,
    status: row.status,
    origin: row.origin,
    profileType: row.profile_type,
    fullName: row.full_name,
    email: row.email,
    whatsapp: row.whatsapp,
    city: row.city,
    state: row.state,
    organization: row.organization,
    joinedAt: row.joined_at,
    createdAt: row.created_at,
  };
}

/**
 * A busca aceita protocolo, nome, e-mail e telefone.
 *
 * O telefone é comparado por DÍGITOS: quem copia "(54) 99123-4567" da conversa
 * e cola aqui não encontraria nada, porque a coluna guarda só números.
 */
function buildSearch(term: string): string {
  const limpo = term
    .trim()
    .replace(/[%,()]/g, " ")
    .trim();
  const digitos = limpo.replace(/\D+/g, "");
  const partes = [
    `protocol.ilike.%${limpo}%`,
    `full_name.ilike.%${limpo}%`,
    `email.ilike.%${limpo}%`,
  ];
  if (digitos.length >= 4) partes.push(`whatsapp.ilike.%${digitos}%`);
  return partes.join(",");
}

export async function listMembershipApplications(
  filters: MembershipApplicationFilters = {},
): Promise<MembershipApplicationPage> {
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  const de = (page - 1) * APPLICATIONS_PAGE_SIZE;

  let query = supabase
    .from("membership_applications")
    .select(APPLICATION_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(de, de + APPLICATIONS_PAGE_SIZE - 1);

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  const termo = filters.search?.trim();
  if (termo) query = query.or(buildSearch(termo));

  const { data, error, count } = await query.returns<ApplicationRowShape[]>();
  if (error) throw error;

  return {
    rows: (data ?? []).map(toApplicationRow),
    total: count ?? 0,
    page,
    pageSize: APPLICATIONS_PAGE_SIZE,
  };
}

/**
 * Contadores por situação, para as abas da grid.
 *
 * Quatro consultas de contagem e não um `group by`: o PostgREST não expõe
 * agregação sem uma view, e criar uma view para contar quatro números seria
 * mais estrutura do que o problema pede. As quatro rodam em paralelo.
 */
export async function countMembershipApplications(): Promise<MembershipApplicationCounts> {
  const supabase = await createClient();

  const resultados = await Promise.all(
    MEMBERSHIP_APPLICATION_STATUSES.map(async (status) => {
      const { count, error } = await supabase
        .from("membership_applications")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      if (error) throw error;
      return [status, count ?? 0] as const;
    }),
  );

  return Object.fromEntries(resultados) as MembershipApplicationCounts;
}

/** Só o número que a navegação mostra — sem trazer linha nenhuma. */
export async function countPendingMembershipApplications(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("membership_applications")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "in_review"]);
  if (error) throw error;
  return count ?? 0;
}

export async function getMembershipApplication(
  id: string,
): Promise<MembershipApplicationDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("membership_applications")
    .select(APPLICATION_DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle()
    .returns<
      | (ApplicationRowShape & {
          farm_name: string | null;
          production_city: string | null;
          sow_count: number | null;
          cnpj: string | null;
          state_registration: string | null;
          activity_area: string | null;
          job_title: string | null;
          legal_name: string | null;
          trade_name: string | null;
          interests: string[] | null;
          other_interest: string | null;
          consent_at: string;
          consent_policy_version: string | null;
          review_note: string | null;
          reviewer: { id: string; full_name: string | null } | null;
          member: MemberRowShape | null;
        })
      | null
    >();

  if (error) throw error;
  if (!data) return null;

  return {
    ...toApplicationRow(data),
    farmName: data.farm_name,
    productionCity: data.production_city,
    sowCount: data.sow_count,
    cnpj: data.cnpj,
    stateRegistration: data.state_registration,
    activityArea: data.activity_area,
    jobTitle: data.job_title,
    legalName: data.legal_name,
    tradeName: data.trade_name,
    interests: data.interests ?? [],
    otherInterest: data.other_interest,
    consentAt: data.consent_at,
    consentPolicyVersion: data.consent_policy_version,
    reviewNote: data.review_note,
    reviewedByName: data.reviewer?.full_name ?? null,
    // Uma consulta para um associado só — é tela de detalhe, não lista.
    member: data.member
      ? toMemberRow(data.member, await fetchBlockedPhoneKeys(supabase, [data.member.whatsapp]))
      : null,
  };
}

export interface MembershipAuditEntry {
  id: string;
  action: MembershipAuditAction;
  actorName: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

/**
 * A trilha da solicitação. Só `admin` e `ceo` leem — a RLS decide isso, e para
 * quem não pode a consulta volta VAZIA (não dá erro). A tela trata a lista
 * vazia como "sem histórico para mostrar", que é o comportamento certo nos dois
 * casos: sem permissão e sem histórico.
 */
export async function listMembershipAudit(applicationId: string): Promise<MembershipAuditEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("membership_audit_logs")
    .select("id, action, actor_name, created_at, metadata")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false })
    .returns<
      {
        id: string;
        action: MembershipAuditAction;
        actor_name: string | null;
        created_at: string;
        metadata: Record<string, unknown> | null;
      }[]
    >();

  if (error) throw error;

  return (data ?? []).map((linha) => ({
    id: linha.id,
    action: linha.action,
    actorName: linha.actor_name,
    createdAt: linha.created_at,
    metadata: linha.metadata ?? {},
  }));
}

export interface MemberFilters {
  search?: string;
  status?: MemberRow["status"] | "all";
  page?: number;
}

export interface MemberPage {
  rows: MemberRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listMembers(filters: MemberFilters = {}): Promise<MemberPage> {
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  const de = (page - 1) * APPLICATIONS_PAGE_SIZE;

  let query = supabase
    .from("members")
    .select(MEMBER_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(de, de + APPLICATIONS_PAGE_SIZE - 1);

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  const termo = filters.search?.trim();
  if (termo) {
    const limpo = termo.replace(/[%,()]/g, " ").trim();
    const digitos = limpo.replace(/\D+/g, "");
    const partes = [
      `full_name.ilike.%${limpo}%`,
      `email.ilike.%${limpo}%`,
      `code.ilike.%${limpo}%`,
    ];
    if (digitos.length >= 4) partes.push(`whatsapp.ilike.%${digitos}%`);
    query = query.or(partes.join(","));
  }

  const { data, error, count } = await query.returns<MemberRowShape[]>();
  if (error) throw error;

  const rows = data ?? [];

  // ⚠️ UMA CONSULTA PARA A PÁGINA INTEIRA, não uma por associado. Cinquenta
  // linhas seriam cinquenta idas ao banco para desenhar uma tabela — e a
  // resposta é a mesma: "este telefone está na lista de quem pediu para sair?".
  const bloqueados = await fetchBlockedPhoneKeys(
    supabase,
    rows.map((r) => r.whatsapp),
  );

  return {
    rows: rows.map((row) => toMemberRow(row, bloqueados)),
    total: count ?? 0,
    page,
    pageSize: APPLICATIONS_PAGE_SIZE,
  };
}
