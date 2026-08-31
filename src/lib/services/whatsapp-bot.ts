import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WhatsAppMessageKind } from "@/modules/whatsapp/whatsapp.types";

/**
 * A PORTA DE SAÍDA DO ROBÔ — o espelho de `whatsapp.ts` (a action do atendente).
 *
 * Seis funções, e nenhuma regra: tudo que decide alguma coisa está no banco, em
 * `20260915000000_whatsapp_bot.sql`. Este arquivo é o encanamento.
 *
 * ⚠️ CLIENTE `service_role`, E É OBRIGATÓRIO. Quem chama é o webhook, que
 * atende um associado ANÔNIMO: sem `auth.uid()`, sem papel. As quatro funções
 * do banco são `security definer` e só o `service_role` tem EXECUTE nelas —
 * `anon` e `authenticated` foram revogados de propósito, porque uma delas
 * escreve no histórico da APCS.
 *
 * ⚠️ O QUE AUTORIZA ISSO NÃO É ESTE COMENTÁRIO: é o fato de o destino NUNCA vir
 * de fora. `getBotChatTarget` lê `whatsapp_chats.chat_key` pelo id da conversa
 * que o próprio webhook acabou de gravar. Não existe caminho aqui em
 * que um telefone digitado por alguém vire destinatário — que é o §32.
 */

/**
 * O robô deve falar nesta conversa agora?
 *
 * Três motivos para calar (grupo, silêncio em vigor, atendimento humano aberto)
 * e todos moram na função do banco. Ver a seção 3 da migration.
 *
 * ⚠️ FALHA VIRA `false`, e é a escolha segura. Um robô que responde por não ter
 * conseguido checar atravessaria uma conversa humana; um que se cala por engano
 * deixa uma pergunta sem resposta automática — que é o que já acontecia ontem.
 */
export async function botShouldAnswer(chatId: string): Promise<boolean> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("whatsapp_bot_should_answer", {
    p_chat_id: chatId,
  });

  if (error) {
    console.error(`[whatsapp-bot] whatsapp_bot_should_answer falhou: ${error.message}`);
    return false;
  }

  return data === true;
}

/**
 * §39. A conversa está dentro do limite de uso?
 *
 * Dois números, defendendo coisas diferentes: seis mensagens por minuto contra
 * rajada, quarenta turnos por hora contra custo. Os dois moram na função do
 * banco — ver a seção 4 da migration.
 *
 * ⚠️ FALHA VIRA `true`, E É O OPOSTO DE `botShouldAnswer`. Ali o seguro é calar
 * (atravessar conversa humana é pior que ficar quieto); aqui o seguro é
 * responder. Um limite de uso que não conseguiu ser consultado silenciaria o
 * atendimento inteiro por um problema de infraestrutura — trocando um risco de
 * custo por uma queda de serviço.
 */
export async function botWithinRateLimit(chatId: string): Promise<boolean> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("whatsapp_bot_rate_ok", { p_chat_id: chatId });

  if (error) {
    console.error(`[whatsapp-bot] whatsapp_bot_rate_ok falhou: ${error.message}`);
    return true;
  }

  return data !== false;
}

/**
 * Cala o robô nesta conversa.
 *
 * Chamado quando o PRÓPRIO robô encaminha para uma pessoa: entre o "vou te
 * encaminhar" e o atendente aparecer podem se passar horas, e sem isto o robô
 * responderia a tudo que a pessoa escrevesse enquanto espera.
 *
 * Não lança: o encaminhamento já aconteceu, e a mensagem já vai sair.
 */
export async function pauseBot(chatId: string, minutes?: number): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase.rpc("whatsapp_pause_bot", {
    p_chat_id: chatId,
    // ⚠️ `undefined`, E NÃO `null`. O parâmetro tem `default null` no SQL, e é
    // esse `null` que a função traduz para `whatsapp_bot_pause_minutes()`.
    // Omitir a chave deixa o banco aplicar o próprio padrão — que é justamente
    // o que "sem minutos informados" quer dizer aqui.
    p_minutes: minutes ?? undefined,
  });

  if (error) {
    console.error(`[whatsapp-bot] whatsapp_pause_bot falhou: ${error.message}`);
  }
}

/** Para onde a resposta vai. §32: o mesmo número que perguntou, e só ele. */
export interface BotChatTarget {
  chatId: string;
  /** `whatsapp_chats.chat_key` — o que o fornecedor entende como destinatário. */
  chatKey: string;
  /** Só dígitos, quando é conversa individual. `null` em grupo. */
  phone: string | null;
  contactId: string | null;
  memberId: string | null;
}

/**
 * Os dados de destino de uma conversa.
 *
 * ⚠️ O DESTINO SAI DAQUI E DE MAIS LUGAR NENHUM. É a mesma decisão que a action
 * do atendente tomou ("o destino sai do banco, e não do formulário"), e aqui ela
 * pesa mais: o `from` do webhook é um campo de um JSON que chegou pela internet.
 * Usá-lo como destinatário faria o endereço de resposta ser escolhido por quem
 * escreveu o payload.
 */
export async function getBotChatTarget(chatId: string): Promise<BotChatTarget | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("whatsapp_chats")
    .select("id, chat_key, phone, contact_id, member_id")
    .eq("id", chatId)
    .returns<
      {
        id: string;
        chat_key: string;
        phone: string | null;
        contact_id: string | null;
        member_id: string | null;
      }[]
    >()
    .maybeSingle();

  if (error) {
    console.error(`[whatsapp-bot] getBotChatTarget falhou: ${error.message}`);
    return null;
  }
  if (!data) return null;

  return {
    chatId: data.id,
    chatKey: data.chat_key,
    phone: data.phone,
    contactId: data.contact_id,
    memberId: data.member_id,
  };
}

/**
 * Grava PENDENTE uma mensagem do robô e devolve o id.
 *
 * A coreografia é a mesma da resposta do atendente — GRAVA PENDENTE → MANDA →
 * LIQUIDA — e pelo mesmo motivo, que está escrito lá: entre o envio e a
 * resposta do fornecedor cabe uma falha, e uma mensagem ENTREGUE cuja resposta
 * se perdeu não pode sumir do CRM.
 *
 * Devolve `null` quando não deu para gravar. Quem chama NÃO deve enviar nesse
 * caso: enviar sem registro é exatamente a "mensagem invisível" que a ordem
 * grava-antes existe para evitar.
 */
export async function startBotMessage(
  chatId: string,
  body: string,
  kind: WhatsAppMessageKind = "text",
): Promise<string | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("whatsapp_start_bot_message", {
    p_chat_id: chatId,
    p_body: body,
    p_kind: kind,
  });

  if (error) {
    console.error(`[whatsapp-bot] whatsapp_start_bot_message falhou: ${error.message}`);
    return null;
  }

  return typeof data === "string" ? data : null;
}

/**
 * Fecha o envio: com id do fornecedor vira `sent`, sem ele vira `failed`.
 *
 * ⚠️ REUSA A FUNÇÃO DO ATENDENTE sem alteração nenhuma. Ela já aceita o
 * `service_role` (`whatsapp_is_writer()` vale quando `auth.uid()` é nulo) e já
 * carrega a proteção que importa: só age sobre `pending`, para que um aviso de
 * entrega que chegue ANTES da resposta do envio não faça a mensagem voltar de
 * "entregue" para "enviada".
 */
export async function settleBotMessage(
  messageId: string,
  providerMessageId: string | null,
  errorMessage: string | null,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase.rpc("whatsapp_settle_outbound_message", {
    p_message_id: messageId,
    p_provider_message_id: providerMessageId ?? undefined,
    p_error: errorMessage ?? undefined,
  });

  if (error) {
    // A mensagem PODE ter saído. Não dá para dizer "não enviou" — o que dá para
    // dizer é que o registro dela ficou incompleto, e é o que o log guarda.
    console.error(`[whatsapp-bot] settle falhou: ${error.message}`);
  }
}

/**
 * Amarra a decisão à mensagem que saiu (§46).
 *
 * A trilha já nasce com o ponteiro para a mensagem RECEBIDA; esta é a outra
 * ponta. Sem ela, ligar "o robô decidiu mandar a Bolsa" a "este PDF saiu às
 * 14h32" seria adivinhação por proximidade de horário.
 *
 * `update` direto, e não uma função: a RLS de `intelligence_interactions`
 * revoga escrita de `authenticated` e `anon`, e o `service_role` a ignora. Uma
 * função `security definer` só para isto seria mais uma superfície a proteger.
 */
export async function linkInteractionReply(
  interactionId: number,
  messageId: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("intelligence_interactions")
    .update({ reply_message_id: messageId })
    .eq("id", interactionId);

  if (error) {
    console.error(`[whatsapp-bot] linkInteractionReply falhou: ${error.message}`);
  }
}
