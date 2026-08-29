import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { maskPhone, toWhatsAppNumber } from "@/lib/messaging/phone";
import { logEventDispatch } from "@/lib/messaging/telemetry";
import { isOptOutRequest } from "@/modules/survey/survey.inbound";
import type { InboundEvent, MessagingProvider } from "@/lib/messaging/messaging.types";

/**
 * O "NÃO ME MANDE MAIS" — para QUALQUER mensagem, não só para enquete.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE
 * ----------------------------------------------------------------------------
 * Um associado recebeu a divulgação de um evento, respondeu SAIR, e continuou
 * recebendo. O reconhecimento da palavra estava certo — o problema era onde ele
 * rodava: só dentro de `survey-inbox.ts`, e só quando havia uma conversa de
 * enquete aberta. Quem recebeu um evento nunca tem esse contexto.
 *
 * Um pedido para parar de receber NÃO PODE DEPENDER DO CANAL que motivou o
 * pedido. Ele é anterior a qualquer roteiro: a pessoa está dizendo que não quer
 * ser incomodada, e a única resposta aceitável é parar.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ ELE RODA ANTES DAS ENQUETES, E É DE PROPÓSITO
 * ----------------------------------------------------------------------------
 * `survey-inbox` também sabe tratar SAIR (dentro de uma enquete) e responde
 * confirmando. Se os dois rodassem, quem respondesse SAIR a uma enquete
 * receberia DUAS confirmações — e a segunda mensagem chegaria depois de a
 * pessoa ter pedido para não receber mensagens, que é a pior hora possível.
 *
 * Então o webhook chama este primeiro e RETIRA da lista o que foi tratado aqui.
 */

/** O que a pessoa recebe de volta. Uma frase, e a confirmação de que parou. */
const OPT_OUT_CONFIRMED =
  "Pronto. Você não receberá mais mensagens da APCS. " +
  "Se mudar de ideia, é só falar com a associação.";

export interface OptOutOutcome {
  /** Os `eventId` das mensagens que ESTE serviço tratou. */
  handled: string[];
  registered: number;
}

/**
 * Trata os pedidos de saída de um lote de eventos do webhook.
 *
 * Não lança: um erro aqui não pode derrubar a ingestão da caixa de entrada, que
 * já gravou a mensagem e é a parte que não pode se perder.
 */
export async function processOptOutRequests(
  events: InboundEvent[],
  provider: MessagingProvider,
  correlationId: string,
): Promise<OptOutOutcome> {
  const resultado: OptOutOutcome = { handled: [], registered: 0 };

  const pedidos = events.filter(
    (e): e is Extract<InboundEvent, { kind: "message" }> =>
      e.kind === "message" &&
      // ⚠️ O que sai do NOSSO número não é pedido de ninguém. A Z-API avisa
      // sobre as mensagens que o próprio número mandou; um "SAIR" escrito pelo
      // atendente bloquearia o associado com quem ele estava falando.
      e.conversation?.fromMe !== true &&
      isOptOutRequest(e.text),
  );

  if (pedidos.length === 0) return resultado;

  const admin = createAdminClient();

  for (const pedido of pedidos) {
    const telefone = toWhatsAppNumber(pedido.from);
    if (!telefone.ok) {
      // Não dá para bloquear um número que não conseguimos normalizar. Marcamos
      // como tratado assim mesmo: repassá-lo às enquetes não ajudaria.
      resultado.handled.push(pedido.eventId);
      logEventDispatch("error", "send.ineligible", {
        correlationId,
        reason: `opt-out com telefone inválido: ${telefone.reason}`,
        phone: maskPhone(pedido.from),
      });
      continue;
    }

    // Quem é, se for conhecido. Serve só para a tela mostrar o nome depois — o
    // bloqueio não depende disso, e é justamente essa independência que
    // conserta o bug.
    const { data: contato } = await admin
      .from("chat_contacts")
      .select("id")
      .eq("phone", pedido.from)
      .limit(1)
      .maybeSingle();

    const { error } = await admin.rpc("register_notification_opt_out", {
      p_phone: telefone.e164,
      p_channel: "whatsapp",
      p_source: "chatbot",
      p_note: null,
      p_contact_id: contato?.id ?? null,
    } as never);

    if (error) {
      logEventDispatch("error", "send.error", {
        correlationId,
        reason: `não foi possível registrar o opt-out: ${error.message}`,
        phone: maskPhone(pedido.from),
      });
      // NÃO marca como tratado: sem registro, deixar as enquetes tentarem é
      // melhor do que engolir o pedido em silêncio.
      continue;
    }

    resultado.registered += 1;
    resultado.handled.push(pedido.eventId);

    logEventDispatch("info", "send.ok", {
      correlationId,
      outcome: "opt-out registrado",
      phone: maskPhone(pedido.from),
    });

    // A confirmação. ⚠️ É a ÚLTIMA mensagem que esta pessoa recebe — e ela
    // precisa existir: sem resposta, a pessoa não sabe se funcionou e a única
    // saída restante seria bloquear o número da APCS. Número bloqueado por
    // muita gente é número que o WhatsApp derruba.
    const envio = await provider.send({
      to: telefone.e164,
      body: OPT_OUT_CONFIRMED,
      correlationId,
    });

    if (!envio.ok) {
      logEventDispatch("error", "send.error", {
        correlationId,
        reason: `confirmação de opt-out não saiu: ${envio.message}`,
        phone: maskPhone(pedido.from),
      });
    }
  }

  return resultado;
}
