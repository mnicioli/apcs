"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertPermission } from "@/lib/auth/assert-permission";
import { messagingProvider } from "@/lib/messaging/registry";
import { maskPhone } from "@/lib/messaging/phone";
import { logWhatsAppEvent, newCorrelationId } from "@/lib/messaging/telemetry";
import {
  archiveWhatsAppChatSchema,
  sendWhatsAppMessageSchema,
  uuidSchema,
  type ArchiveWhatsAppChatInput,
  type SendWhatsAppMessageInput,
} from "@/modules/whatsapp/whatsapp.schema";
import { fail, mapPostgresError, ok, type ActionResult } from "./errors";

/**
 * ACTION = escrita. Retorna `ActionResult`, NUNCA lança.
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 *
 * ⚠️ TRÊS CAMADAS AUTORIZAM CADA ESCRITA DAQUI, e nenhuma é redundante:
 *
 *   1. `assertPermission` — nega cedo, com mensagem clara, sem tocar no banco;
 *   2. `whatsapp_is_writer()` dentro da função SQL — vale mesmo se alguém
 *      chamar a RPC por fora da aplicação;
 *   3. a ausência de policy de escrita — não existe caminho de INSERT direto.
 *
 * A primeira é conveniência. A terceira é a que realmente protege.
 */

const WHATSAPP_PATH = "/whatsapp";

/**
 * Responder uma conversa.
 *
 * ⚠️ A ORDEM É: GRAVA PENDENTE → MANDA → LIQUIDA. Nunca manda-e-grava.
 *
 * Entre o clique e a resposta do fornecedor existe uma chamada HTTP que pode
 * demorar 15 segundos, falhar, ou ter sucesso sem que a resposta volte. Se a
 * linha só nascesse depois, uma mensagem ENTREGUE numa chamada cuja resposta se
 * perdeu sumiria do CRM — e o atendente a mandaria de novo, para um associado
 * que já a recebeu. Gravar antes troca "mensagem invisível duplicada" por
 * "mensagem visível marcada como falha", que é um problema que se enxerga.
 */
export async function sendWhatsAppMessageAction(
  input: SendWhatsAppMessageInput,
): Promise<ActionResult<{ messageId: string }>> {
  const denied = await assertPermission<{ messageId: string }>("whatsapp.write");
  if (denied) return denied;

  const parsed = sendWhatsAppMessageSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const { chatId, body } = parsed.data;
  const correlationId = newCorrelationId();
  const provider = messagingProvider();

  // Recusa ANTES de gravar quando a integração não existe: uma mensagem
  // "falhada" na conversa por falta de configuração faria parecer que o
  // associado tem um problema, quando quem tem é o `.env`.
  if (!provider.configured) {
    return fail("whatsappNotConfigured");
  }

  const supabase = await createClient();

  // O destino sai do banco, e não do formulário. Um `to` vindo do cliente
  // transformaria a tela de atendimento num disparador para qualquer número.
  const { data: chat, error: chatError } = await supabase
    .from("whatsapp_chats")
    .select("chat_key")
    .eq("id", chatId)
    .returns<{ chat_key: string }[]>()
    .maybeSingle();

  if (chatError) {
    console.error(`[whatsapp] leitura da conversa falhou: ${chatError.message}`);
    return { ok: false, error: mapPostgresError(chatError) };
  }
  // A RLS esconde o que a pessoa não pode ver, então "não encontrada" e "não é
  // sua" chegam aqui iguais — e devem mesmo: distinguir contaria que existe.
  if (!chat) return fail("notFound");

  const { data: novaId, error: startError } = await supabase.rpc(
    "whatsapp_start_outbound_message",
    // Descompasso de generics ssr/supabase-js. Ver CONVENTIONS.md.
    { p_chat_id: chatId, p_body: body } as never,
  );

  if (startError) {
    console.error(`[whatsapp] start falhou: ${startError.message}`);
    return { ok: false, error: mapPostgresError(startError) };
  }

  const messageId = novaId as unknown as string;

  const enviada = await provider.send({ to: chat.chat_key, body, correlationId });

  const { error: settleError } = await supabase.rpc("whatsapp_settle_outbound_message", {
    p_message_id: messageId,
    p_provider_message_id: enviada.ok ? enviada.providerMessageId : null,
    p_error: enviada.ok ? null : enviada.message,
  } as never);

  if (settleError) {
    // A mensagem PODE ter saído. Não dá para dizer "não enviou" — o que dá para
    // dizer é que o registro dela ficou incompleto, e é o que o log guarda.
    console.error(`[whatsapp] settle falhou: ${settleError.message}`);
  }

  revalidatePath(WHATSAPP_PATH);

  if (!enviada.ok) {
    logWhatsAppEvent("error", "inbox.reply_failed", {
      correlationId,
      provider: provider.name,
      chatId,
      messageId,
      phone: maskPhone(chat.chat_key),
      reason: enviada.code,
    });
    return fail("whatsappSendFailed");
  }

  logWhatsAppEvent("info", "inbox.reply_sent", {
    correlationId,
    provider: provider.name,
    chatId,
    messageId,
    providerMessageId: enviada.providerMessageId,
    phone: maskPhone(chat.chat_key),
  });

  return ok({ messageId });
}

/**
 * Marcar a conversa como lida NO CRM.
 *
 * ⚠️ Não mexe no "lido" do aparelho — são dois contadores diferentes e vão
 * continuar sendo. O do CRM responde "alguém do time já olhou isto?"; o do
 * celular responde outra coisa e pertence a quem está com o aparelho.
 */
export async function markWhatsAppChatReadAction(chatId: string): Promise<ActionResult<null>> {
  const denied = await assertPermission<null>("whatsapp.write");
  if (denied) return denied;

  const parsed = uuidSchema.safeParse(chatId);
  if (!parsed.success) return fail("invalidInput");

  const supabase = await createClient();
  const { error } = await supabase.rpc("whatsapp_mark_chat_read", {
    p_chat_id: parsed.data,
  } as never);

  if (error) {
    console.error(`[whatsapp] marcar como lida falhou: ${error.message}`);
    return { ok: false, error: mapPostgresError(error) };
  }

  revalidatePath(WHATSAPP_PATH);
  return ok(null);
}

/** Arquivar ou desarquivar. Mensagem nova desarquiva sozinha (ver a migration). */
export async function archiveWhatsAppChatAction(
  input: ArchiveWhatsAppChatInput,
): Promise<ActionResult<null>> {
  const denied = await assertPermission<null>("whatsapp.write");
  if (denied) return denied;

  const parsed = archiveWhatsAppChatSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const supabase = await createClient();
  const { error } = await supabase.rpc("whatsapp_set_chat_archived", {
    p_chat_id: parsed.data.chatId,
    p_archived: parsed.data.archived,
  } as never);

  if (error) {
    console.error(`[whatsapp] arquivar falhou: ${error.message}`);
    return { ok: false, error: mapPostgresError(error) };
  }

  revalidatePath(WHATSAPP_PATH);
  return ok(null);
}
