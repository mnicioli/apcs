import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { maskPhone } from "@/lib/messaging/phone";
import { logIntelligenceEvent } from "@/lib/messaging/telemetry";
import { deliverBotReply } from "@/lib/intelligence/deliver";
import { handleIncomingMessage } from "@/lib/intelligence/engine";
import { chatbotEnabled } from "@/lib/intelligence/flags";
import {
  botShouldAnswer,
  botWithinRateLimit,
  getBotChatTarget,
  linkInteractionReply,
  pauseBot,
} from "@/lib/services/whatsapp-bot";
import type { AIHistoryItem } from "@/lib/intelligence/ai/ai.types";
import type { MessagingProvider } from "@/lib/messaging/messaging.types";
import type { RecordedMessage } from "@/lib/services/whatsapp-inbox";

/**
 * O CONSUMIDOR DO ROBÔ — o pedaço que faltava entre o webhook e a inteligência.
 *
 *     webhook → livro-razão → opt-out → enquetes → [ ESTE ARQUIVO ] → WhatsApp
 *
 * É o quarto consumidor da mesma lista de eventos, e o ÚLTIMO de propósito.
 * Cada um dos três anteriores tem precedência sobre ele por uma razão diferente:
 *
 *   opt-out    quem pediu para não ser incomodado não recebe resposta nenhuma
 *   enquetes   um "3" no meio de uma enquete é voto, e não pergunta
 *   atendente  conversa humana em andamento não se atravessa (via `pauseBot`)
 *
 * ⚠️ NADA AQUI LANÇA PARA FORA. Uma exceção viraria 500 no webhook, o fornecedor
 * reentregaria o payload e o resultado seria um laço de reentrega sobre um erro
 * que não se resolve sozinho — cada mensagem é tratada por conta própria.
 */

/**
 * §49. Teto do que vai para o classificador.
 *
 * ⚠️ NÃO É SOBRE CUSTO. O corpo da mensagem é a única entrada deste sistema
 * escrita por quem está do lado de fora, e ela viaja para um modelo. Um texto
 * de cem mil caracteres é um pedido de negação de serviço com aparência de
 * pergunta. O corte preserva o começo, que é onde a pergunta de verdade está.
 */
const MAX_MESSAGE_CHARS = 2000;

/** Quantas falas anteriores acompanham a mensagem (§24, contexto). */
const HISTORY_MESSAGES = 6;

export interface IntelligenceInboxOutcome {
  answered: number;
  skipped: number;
  failed: number;
}

/**
 * Responde às mensagens que sobraram para o robô.
 *
 * `handled` são os ids que os consumidores anteriores já consumiram — quem está
 * numa enquete ou acabou de pedir para sair não recebe resposta do robô por
 * cima.
 */
export async function processChatbotMessages(
  messages: readonly RecordedMessage[],
  handled: ReadonlySet<string>,
  provider: MessagingProvider,
  correlationId: string,
): Promise<IntelligenceInboxOutcome> {
  const resultado: IntelligenceInboxOutcome = { answered: 0, skipped: 0, failed: 0 };

  if (!provider.configured) {
    // Sem fornecedor não há a quem responder. Recusar ANTES de classificar evita
    // gastar o modelo e, principalmente, evita gravar uma resposta pendente que
    // nunca vai sair — que ficaria na conversa como uma falha do associado.
    logIntelligenceEvent("error", "bot.skipped", {
      correlationId,
      provider: provider.name,
      reason: "fornecedor nao configurado",
      count: messages.length,
    });
    return { ...resultado, skipped: messages.length };
  }

  /**
   * §83. A CHAVE GERAL, e ela é consultada UMA VEZ POR LOTE.
   *
   * Não por mensagem: um lote do webhook é um punhado de eventos do mesmo
   * instante, e o estado do interruptor não muda no meio dele. Uma consulta por
   * mensagem seria N idas ao banco para ler a mesma linha.
   *
   * ⚠️ E ELA VEM ANTES DE TUDO. Desligado, o robô não classifica, não consulta e
   * não responde — mas as mensagens JÁ ESTÃO no livro-razão, gravadas antes de
   * qualquer consumidor. Desligar o robô não perde nada: perde a resposta
   * automática, que é exatamente o que se quis desligar.
   */
  if (!(await chatbotEnabled())) {
    logIntelligenceEvent("info", "bot.skipped", {
      correlationId,
      reason: "robo desligado na configuracao",
      count: messages.length,
    });
    return { ...resultado, skipped: messages.length };
  }

  for (const mensagem of messages) {
    const motivo = motivoParaPular(mensagem, handled);

    if (motivo) {
      resultado.skipped += 1;
      logIntelligenceEvent("info", "bot.skipped", {
        correlationId,
        chatId: mensagem.chatId,
        messageId: mensagem.messageId,
        reason: motivo,
        phone: maskPhone(mensagem.phone),
      });
      continue;
    }

    try {
      const respondeu = await responder(mensagem, provider, correlationId);
      if (respondeu === "answered") resultado.answered += 1;
      else if (respondeu === "skipped") resultado.skipped += 1;
      else resultado.failed += 1;
    } catch (erro) {
      resultado.failed += 1;
      logIntelligenceEvent("error", "bot.turn_failed", {
        correlationId,
        chatId: mensagem.chatId,
        messageId: mensagem.messageId,
        reason: erro instanceof Error ? erro.message : String(erro),
        phone: maskPhone(mensagem.phone),
      });
    }
  }

  return resultado;
}

/**
 * As recusas que não precisam ir ao banco. Todas são de graça e todas importam.
 *
 * A ordem é da mais barata para a mais cara; a checagem que precisa do banco
 * (`whatsapp_bot_should_answer`) vem depois, em `responder`.
 */
function motivoParaPular(mensagem: RecordedMessage, handled: ReadonlySet<string>): string | null {
  // §41. Reentrega do webhook. O livro-razão já sabia; aqui só se obedece.
  // Sem isto, a Z-API reentregando o mesmo payload faria a Bolsa sair duas
  // vezes — dois PDFs iguais para quem pediu um.
  if (mensagem.duplicate) return "reentrega";

  // ⚠️ O QUE SAIU DO NOSSO NÚMERO NÃO É PERGUNTA DE NINGUÉM. Inclui o que o
  // próprio robô acabou de mandar: sem isto ele responderia à própria resposta,
  // em laço, com a conta pagando cada volta.
  if (mensagem.fromMe) return "saiu do nosso numero";

  // Grupo nunca. A regra completa está em `whatsapp_bot_should_answer`; aqui é
  // só para não ir ao banco perguntar o óbvio.
  if (mensagem.isGroup) return "grupo";

  if (handled.has(mensagem.eventId)) return "tratado por outro fluxo";

  /**
   * ⚠️ MENSAGEM SÓ COM ANEXO NÃO É RESPONDIDA, e é uma decisão, não um
   * esquecimento.
   *
   * Uma foto ou um áudio não têm o que classificar — o §36 é explícito que o
   * MVP não interpreta mídia. As duas saídas eram responder "não entendi" ou
   * ficar calado, e o calado ganha por um motivo concreto: a conversa fica com
   * o contador de não lidas ACESO na caixa de entrada, que é o caminho real de
   * escalada. Um "não entendi" automático faria a pessoa achar que foi
   * atendida, e ela pararia de esperar.
   *
   * O dia em que houver transcrição de áudio, esta condição some. Está em
   * docs/INTELIGENCIA.md, nas pendências.
   */
  if (mensagem.text.trim() === "") return "mensagem sem texto";

  return null;
}

type Desfecho = "answered" | "skipped" | "failed";

async function responder(
  mensagem: RecordedMessage,
  provider: MessagingProvider,
  correlationId: string,
): Promise<Desfecho> {
  // ⚠️ A PERGUNTA "DEVO FALAR?" VEM ANTES DE TUDO QUE CUSTA. Grupo, silêncio em
  // vigor e atendimento humano aberto, os três numa consulta só. Ver a seção 3
  // de 20260915000000_whatsapp_bot.sql.
  if (!(await botShouldAnswer(mensagem.chatId))) {
    logIntelligenceEvent("info", "bot.skipped", {
      correlationId,
      chatId: mensagem.chatId,
      messageId: mensagem.messageId,
      reason: "conversa calada (atendimento humano ou pausa)",
      phone: maskPhone(mensagem.phone),
    });
    return "skipped";
  }

  /**
   * §39. O LIMITE DE USO — e ele vem DEPOIS de "devo falar?" e ANTES do modelo.
   *
   * Depois porque calar por atendimento humano é uma decisão de produto, e
   * estourar o limite é uma anomalia: contá-la junto embaralharia as duas na
   * hora de ler o log.
   *
   * Antes porque é o modelo que custa. Um limite consultado depois da
   * classificação protegeria contra tudo menos contra a única coisa que ele
   * existe para proteger.
   *
   * ⚠️ ESTOURAR É FICAR CALADO, e não avisar. Quem manda sete mensagens num
   * minuto não está esperando resposta — e uma frase automática de repreensão a
   * um associado é pior que o silêncio. A conversa continua acesa na aba "Não
   * lidas", que é onde uma PESSOA a vê.
   */
  if (!(await botWithinRateLimit(mensagem.chatId))) {
    logIntelligenceEvent("info", "bot.skipped", {
      correlationId,
      chatId: mensagem.chatId,
      messageId: mensagem.messageId,
      reason: "limite de uso",
      phone: maskPhone(mensagem.phone),
    });
    return "skipped";
  }

  // §32. O destino sai do banco, e não do payload. Ver `getBotChatTarget`.
  const alvo = await getBotChatTarget(mensagem.chatId);
  if (!alvo) {
    logIntelligenceEvent("error", "bot.turn_failed", {
      correlationId,
      chatId: mensagem.chatId,
      reason: "conversa nao encontrada",
    });
    return "failed";
  }

  const reply = await handleIncomingMessage({
    chatId: alvo.chatId,
    messageId: mensagem.messageId,
    memberId: alvo.memberId,
    phone: alvo.phone,
    message: mensagem.text.slice(0, MAX_MESSAGE_CHARS),
    history: await carregarHistorico(alvo.chatId, mensagem.messageId),
    correlationId,
  });

  /**
   * ⚠️ O SILÊNCIO VEM ANTES DO ENVIO (§22, §31).
   *
   * Entre o "vou te encaminhar" e o atendente aparecer podem se passar horas, e
   * sem calar aqui o robô responderia alegremente a tudo que a pessoa
   * escrevesse enquanto espera — inclusive ao "obrigado" dela, o que reabriria
   * a conversa como se nada tivesse sido pedido.
   *
   * Antes do envio, e não depois, porque o envio pode falhar: se falhar, a
   * pessoa vai reescrever, e aí o certo continua sendo uma pessoa atendendo.
   */
  if (reply.handoff) {
    await pauseBot(alvo.chatId);
    logIntelligenceEvent("info", "bot.handoff", {
      correlationId,
      chatId: alvo.chatId,
      messageId: mensagem.messageId,
      intent: reply.intent,
      phone: maskPhone(alvo.phone),
    });
  }

  const entrega = await deliverBotReply({ target: alvo, reply, provider, correlationId });

  // §46. A ponta final da corrente: qual mensagem saiu por causa desta decisão.
  if (reply.interactionId !== null && entrega.firstMessageId !== null) {
    await linkInteractionReply(reply.interactionId, entrega.firstMessageId);
  }

  logIntelligenceEvent(entrega.failed ? "error" : "info", "bot.turn", {
    correlationId,
    provider: provider.name,
    chatId: alvo.chatId,
    messageId: mensagem.messageId,
    replyMessageId: entrega.firstMessageId ?? undefined,
    intent: reply.intent,
    tool: reply.tool ?? undefined,
    outcome: reply.outcome,
    attachments: entrega.attachmentsSent,
    phone: maskPhone(alvo.phone),
  });

  return entrega.failed ? "failed" : "answered";
}

/**
 * As falas anteriores da conversa, para o modelo entender uma frase sem verbo.
 *
 * É o §24: "Agora me manda a da Câmara Setorial" só significa alguma coisa
 * depois de "Quero a normativa da Câmara Ambiental". O contexto persistido
 * (`conversation_context`) guarda a INTENÇÃO; isto dá ao modelo as palavras.
 *
 * ⚠️ A PRÓPRIA MENSAGEM FICA DE FORA. Ela já vai como o turno atual — repetida
 * no histórico, o modelo a leria duas vezes e trataria a segunda como
 * insistência.
 *
 * Falha vira histórico vazio, nunca exceção: sem as falas anteriores o robô
 * responde pior, e responder pior é melhor que não responder.
 */
async function carregarHistorico(
  chatId: string,
  exceptMessageId: string,
): Promise<AIHistoryItem[]> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("whatsapp_messages")
      .select("id, direction, body")
      .eq("chat_id", chatId)
      .neq("id", exceptMessageId)
      // Ordena por `seq` pelo mesmo motivo da transcrição da tela: o carimbo do
      // fornecedor tem granularidade de segundo, e duas mensagens seguidas
      // empatariam — o histórico sairia embaralhado de vez em quando.
      .order("seq", { ascending: false })
      .limit(HISTORY_MESSAGES)
      .returns<{ id: string; direction: "inbound" | "outbound"; body: string }[]>();

    if (error || !data) return [];

    return data
      .slice()
      .reverse()
      .filter((linha) => linha.body.trim() !== "")
      .map((linha) => ({
        role: linha.direction === "inbound" ? ("user" as const) : ("bot" as const),
        content: linha.body,
      }));
  } catch (erro) {
    console.error(`[intelligence-inbox] histórico indisponível: ${String(erro)}`);
    return [];
  }
}
