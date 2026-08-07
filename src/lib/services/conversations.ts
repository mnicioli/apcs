import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ChatMessage } from "@/modules/chat/chat.types";

/**
 * SERVICE = leitura. Retorna o dado ou LANÇA erro (o caller decide como tratar).
 *
 * A conversa em si — usada tanto pelo detalhe do lead quanto pela Central de
 * Atendimento. Fica num arquivo próprio porque não pertence a nenhum dos dois:
 * o lead é um DESFECHO da conversa, e o atendimento é o que uma pessoa faz com
 * ela depois.
 *
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 */

/** Transcrição completa de uma conversa, na ordem em que aconteceu. */
export async function getConversationMessages(conversationId: string): Promise<ChatMessage[]> {
  const supabase = await createClient();

  // Ordena por `seq`: as mensagens que o bot grava num mesmo insert dividem o
  // `created_at` (timestamp da transação) e sairiam fora de ordem.
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, content_key, created_at")
    .eq("conversation_id", conversationId)
    .order("seq", { ascending: true })
    // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
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
    console.error(`[conversations] getConversationMessages falhou: ${error.message}`);
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
