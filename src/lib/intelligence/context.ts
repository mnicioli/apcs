import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isIntentName } from "@/modules/intelligence/intent.types";
import { EMPTY_CONTEXT, type RouterContext } from "@/modules/intelligence/intelligence.types";

/**
 * A MEMÓRIA DA CONVERSA — lida e gravada por conversa, e nada mais.
 *
 * ⚠️ CLIENTE `service_role`: quem escreve aqui é o webhook, no caminho de uma
 * mensagem anônima. `conversation_context` não tem policy de escrita para
 * ninguém, de propósito — uma trilha ou uma memória que dá para forjar de fora
 * não serve para nada.
 *
 * ⚠️ FALHA DE LEITURA VIRA CONTEXTO VAZIO, E NÃO EXCEÇÃO. Perder a memória da
 * conversa degrada o atendimento (a pessoa vai ter de repetir o assunto);
 * derrubar o webhook faz o fornecedor reentregar a mensagem em laço. O primeiro
 * é ruim, o segundo é um incidente.
 */

interface ContextRow {
  current_intent: string | null;
  current_subject: string | null;
  pending_intent: string | null;
  pending_subject: string | null;
  menu_shown_at: string | null;
  expires_at: string | null;
}

/**
 * ⚠️ INTENÇÃO DESCONHECIDA NO BANCO VIRA `null`, e isso é uma trava real.
 *
 * A coluna é `text` (ver a migration: o registro de intenções vive no código,
 * para o §11 valer). O preço é que uma linha antiga pode carregar uma intenção
 * que foi APOSENTADA — e devolvê-la ao roteador faria ele procurar no registro
 * uma chave que não existe mais.
 *
 * Descartar é a direção certa: a conversa perde o fio e a pessoa repete o
 * assunto, em vez de o robô quebrar.
 */
function lerIntencao(valor: string | null) {
  return valor && isIntentName(valor) ? valor : null;
}

export async function loadContext(chatId: string): Promise<RouterContext> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("conversation_context")
      .select(
        "current_intent, current_subject, pending_intent, pending_subject, menu_shown_at, expires_at",
      )
      .eq("whatsapp_chat_id", chatId)
      // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
      .returns<ContextRow[]>()
      .maybeSingle();

    if (error) throw error;
    if (!data) return EMPTY_CONTEXT;

    const currentIntent = lerIntencao(data.current_intent);
    const pendingIntent = lerIntencao(data.pending_intent);

    return {
      currentIntent,
      // Assunto sem intenção não significa nada — some junto.
      currentSubject: currentIntent ? data.current_subject : null,
      pendingIntent,
      pendingSubject: pendingIntent ? data.pending_subject : null,
      menuShownAt: data.menu_shown_at,
      expiresAt: data.expires_at,
    };
  } catch (erro) {
    console.error(
      `[intelligence.context] leitura falhou: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
    return EMPTY_CONTEXT;
  }
}

/**
 * Grava o contexto depois do turno.
 *
 * ⚠️ UPSERT POR CONVERSA. A chave primária é o id da conversa, então não existe
 * "acumular contexto": cada turno substitui o anterior. É o que dispensa
 * rotina de limpeza — ver a migration.
 *
 * Não lança: uma memória que não gravou custa a pessoa repetir o assunto, e
 * isso não pode derrubar a resposta que já foi decidida.
 */
export async function saveContext(chatId: string, context: RouterContext): Promise<void> {
  try {
    const supabase = createAdminClient();

    const { error } = await supabase.from("conversation_context").upsert(
      {
        whatsapp_chat_id: chatId,
        current_intent: context.currentIntent,
        current_subject: context.currentSubject,
        pending_intent: context.pendingIntent,
        // O CHECK `conversation_context_pending_pair` recusa assunto pendente
        // sem intenção pendente. Garantir aqui evita que um estado inconsistente
        // do roteador vire um erro de banco no meio do webhook.
        pending_subject: context.pendingIntent ? context.pendingSubject : null,
        menu_shown_at: context.menuShownAt,
        expires_at: context.expiresAt,
      } as never,
      { onConflict: "whatsapp_chat_id" },
    );

    if (error) throw error;
  } catch (erro) {
    console.error(
      `[intelligence.context] gravação falhou: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
  }
}

/**
 * Esquece a conversa.
 *
 * ⚠️ É O §32: quando o atendimento humano assume, o robô sai. Deixar o contexto
 * de pé faria a próxima mensagem da pessoa — dirigida ao atendente — ser lida
 * como continuação de um assunto que o robô estava tratando.
 */
export async function clearContext(chatId: string): Promise<void> {
  await saveContext(chatId, EMPTY_CONTEXT);
}
