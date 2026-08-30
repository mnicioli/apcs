import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { IntentName, ToolName } from "@/modules/intelligence/intent.types";

/**
 * A TRILHA DE DECISÃO (§26, §34, §36).
 *
 * Uma linha por mensagem que o roteador processou. Ela responde o que a conversa
 * sozinha não responde:
 *
 *   "o robô está entendendo as pessoas?"     → distribuição de `intent`
 *   "está chutando?"                         → distribuição de `confidence`
 *   "está achando o conteúdo?"               → `tool_ok` contra `tool_empty`
 *   "está quebrando?"                        → `tool_error`
 *   "está empurrando tudo para o humano?"    → `handoff`
 *
 * ⚠️ ELA NÃO GUARDA O TEXTO DA MENSAGEM (§35). Ele já vive em
 * `whatsapp_messages`, com a política de retenção daquele módulo; copiá-lo para
 * cá criaria um segundo lugar com dado pessoal, com outro ciclo de vida. O que
 * fica é o RACIOCÍNIO e o ponteiro para a mensagem.
 *
 * ⚠️ E NUNCA LANÇA. Registrar é importante; não é mais importante que responder.
 * Um erro aqui vira log de servidor, e a pessoa recebe a resposta que já foi
 * decidida — o contrário faria uma falha de auditoria derrubar o atendimento.
 */

export type InteractionOutcome =
  | "tool_ok"
  | "tool_empty"
  | "tool_error"
  | "confirmed"
  | "message"
  | "handoff";

export interface InteractionRecord {
  chatId: string | null;
  messageId: string | null;
  intent: IntentName;
  /** Ausente quando o turno não passou pelo classificador (um "sim", por exemplo). */
  confidence: number | null;
  tool: ToolName | null;
  outcome: InteractionOutcome;
  /** O termo que a pessoa usou. Teto de 200 no banco. */
  subject: string | null;
  latencyMs: number | null;
  correlationId: string;
}

export async function recordInteraction(record: InteractionRecord): Promise<void> {
  try {
    const supabase = createAdminClient();

    const { error } = await supabase.from("intelligence_interactions").insert({
      whatsapp_chat_id: record.chatId,
      whatsapp_message_id: record.messageId,
      intent: record.intent,
      // ⚠️ TRÊS CASAS, como a coluna `numeric(4,3)`. Sem o arredondamento aqui,
      // um `0.8333333333` do modelo estoura a escala e o INSERT falha inteiro —
      // levando junto o registro de um turno que funcionou.
      confidence: record.confidence === null ? null : Number(record.confidence.toFixed(3)),
      tool: record.tool,
      outcome: record.outcome,
      // O CHECK do banco recusa acima de 200. Cortar aqui é preferível a perder
      // a linha por causa do tamanho de um termo.
      subject: record.subject ? record.subject.slice(0, 200) : null,
      latency_ms: record.latencyMs,
      correlation_id: record.correlationId,
    } as never);

    if (error) throw error;
  } catch (erro) {
    console.error(`[intelligence.log] não registrou a decisão`, {
      correlationId: record.correlationId,
      intent: record.intent,
      outcome: record.outcome,
      motivo: erro instanceof Error ? erro.message : String(erro),
    });
  }
}
