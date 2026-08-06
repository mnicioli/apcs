import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ChatMessage, CspLead } from "@/modules/chat/chat.types";
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

/** Transcrição da conversa que gerou o lead. */
export async function getConversationMessages(conversationId: string): Promise<ChatMessage[]> {
  const supabase = await createClient();

  // Ordena por `seq`: as mensagens que o bot grava num mesmo insert dividem o
  // `created_at` (timestamp da transação) e sairiam fora de ordem.
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, content_key, created_at")
    .eq("conversation_id", conversationId)
    .order("seq", { ascending: true })
    .returns<
      {
        id: string;
        role: ChatMessage["role"];
        content: string;
        content_key: string | null;
        created_at: string;
      }[]
    >();

  if (error) {
    console.error(`[leads] getConversationMessages falhou: ${error.message}`);
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    contentKey: row.content_key,
    createdAt: row.created_at,
  }));
}
