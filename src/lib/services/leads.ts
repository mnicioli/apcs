import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  LEAD_STATUSES,
  type CspLead,
  type CspLeadsSummary,
  type LeadStatus,
} from "@/modules/chat/chat.types";
import type { Database } from "@/types/database";

/**
 * SERVICE = leitura. Retorna o dado ou LANÇA erro (o caller decide como tratar).
 *
 * Todas as consultas aqui passam pelo cliente autenticado — ou seja, pela RLS.
 * Quem não tem papel `admin`/`ceo`/`comercial` simplesmente não vê linha
 * nenhuma, mesmo que a checagem de permissão da app falhe.
 *
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 */

type LeadRow = Database["public"]["Tables"]["csp_leads"]["Row"];

function toLead(row: LeadRow): CspLead {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    fullName: row.full_name,
    city: row.city,
    state: row.state,
    contactProfile: row.contact_profile,
    interest: row.interest,
    volumeRange: row.volume_range,
    preferredChannel: row.preferred_channel,
    preferredTime: row.preferred_time,
    phone: row.phone,
    email: row.email,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

const LEAD_COLUMNS =
  "id, conversation_id, full_name, city, state, contact_profile, interest, volume_range, preferred_channel, preferred_time, phone, email, status, notes, created_at";

export async function listCspLeads(): Promise<CspLead[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("csp_leads")
    .select(LEAD_COLUMNS)
    .order("created_at", { ascending: false })
    // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
    .returns<LeadRow[]>();

  if (error) {
    console.error(`[leads] listCspLeads falhou: ${error.message}`);
    throw error;
  }
  return (data ?? []).map(toLead);
}

/** Os leads mais recentes, para o painel de abertura. */
export async function listRecentCspLeads(limit = 5): Promise<CspLead[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("csp_leads")
    .select(LEAD_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<LeadRow[]>();

  if (error) {
    console.error(`[leads] listRecentCspLeads falhou: ${error.message}`);
    throw error;
  }
  return (data ?? []).map(toLead);
}

/**
 * Contagem de leads por status.
 *
 * Traz só a coluna `status` e conta em memória. Com o volume de uma associação
 * — dezenas a centenas de leads por ano — isso é uma consulta e um laço curto,
 * mais simples que quatro `count` separados ou uma view só para agregar. Se um
 * dia passar de alguns milhares de linhas, o certo é trocar por um `group by`
 * no banco; até lá, isto é a solução do tamanho do problema.
 */
export async function getCspLeadsSummary(): Promise<CspLeadsSummary> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("csp_leads")
    .select("status")
    .returns<{ status: LeadStatus }[]>();

  if (error) {
    console.error(`[leads] getCspLeadsSummary falhou: ${error.message}`);
    throw error;
  }

  // Parte de zero em TODOS os status para o painel nunca omitir uma coluna.
  const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<
    LeadStatus,
    number
  >;

  for (const row of data ?? []) {
    // Guarda contra um status que o banco tenha e o enum do TypeScript não —
    // sem isto, uma migration que adicione valor ao enum quebraria a contagem
    // silenciosamente, criando uma chave fantasma no objeto.
    if (row.status in byStatus) byStatus[row.status] += 1;
  }

  return { total: data?.length ?? 0, byStatus };
}

export async function getCspLead(id: string): Promise<CspLead | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("csp_leads")
    .select(LEAD_COLUMNS)
    .eq("id", id)
    .returns<LeadRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[leads] getCspLead falhou: ${error.message}`);
    throw error;
  }
  return data ? toLead(data) : null;
}
