import "server-only";
import { backoffDelayMs } from "@/lib/messaging/resilience";
import { maskPhone } from "@/lib/messaging/phone";
import { logIntelligenceEvent } from "@/lib/messaging/telemetry";
import { settleBotMessage, startBotMessage, type BotChatTarget } from "@/lib/services/whatsapp-bot";
import { BOT_UNNAMED_FILE } from "@/modules/intelligence/intelligence.labels";
import type { MessagingProvider, SendResult } from "@/lib/messaging/messaging.types";
import type { BotReply } from "./engine";
import type { WhatsAppMessageKind } from "@/modules/whatsapp/whatsapp.types";

/**
 * O QUE COLOCA A RESPOSTA NO WHATSAPP (§13, §14, §32, §42, §44).
 *
 * O motor decide e devolve `BotReply`; este arquivo transforma isso em
 * mensagens de verdade. É a única fronteira entre a inteligência e a rede — e
 * ela existe separada para que `engine.ts` continue testável sem fornecedor,
 * sem rede e sem número de telefone.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ §14, E O DESVIO DELIBERADO: A LEGENDA VAI DENTRO DO ANEXO
 * ----------------------------------------------------------------------------
 * O §14 pede "mensagem introdutória → imagem → PDF", três mensagens. Aqui a
 * introdução é a LEGENDA da imagem, e não um balão antes dela.
 *
 * A razão está escrita em `messaging.types.ts`, e é anterior a este módulo:
 *
 *   "duas mensagens separadas chegam como dois balões que o WhatsApp pode
 *    entregar fora de ordem, e a pessoa vê um cartaz sem explicação — ou, pior,
 *    a explicação antes do cartaz"
 *
 * A ordem que a pessoa lê é a que o §14 quer. O que muda é não existir balão
 * solto capaz de chegar trocado. Os dois fornecedores aceitam legenda no
 * anexo, então isto não é uma limitação contornada: é o recurso certo.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ §32. O DESTINO NÃO VEM DO PAYLOAD
 * ----------------------------------------------------------------------------
 * `target.chatKey` foi lido de `whatsapp_chats` pelo id da conversa. O `from`
 * do webhook — um campo de um JSON que chegou pela internet — não chega aqui.
 * Não existe parâmetro nesta função que aponte para outro número.
 */

/**
 * §42. Tentativas por peça — DUAS, e não as três das campanhas.
 *
 * ⚠️ O TETO NÃO É PREFERÊNCIA, É ARITMÉTICA DE PRAZO. O timeout do fornecedor é
 * de 15 s e a rota do webhook tem `maxDuration = 60`. Três tentativas que
 * estourem o timeout são 45 s — e com a classificação antes e o download de
 * anexo depois, a função seria MORTA pela plataforma no meio do envio, deixando
 * a mensagem presa em `pending` sem ninguém para curá-la.
 *
 * E há a razão humana, que é a mesma conclusão por outro caminho: `MAX_SEND_
 * ATTEMPTS = 3` foi dimensionado para uma campanha, em que ninguém está
 * esperando. Aqui há uma pessoa olhando a tela do celular. Quem escreveu "qual a
 * bolsa hoje?" já desistiu bem antes da terceira tentativa; o que a serve melhor
 * é a mensagem virar falha visível na caixa de entrada, onde um atendente a vê.
 */
const MAX_BOT_SEND_ATTEMPTS = 2;

/** Uma peça da resposta: o que vira UMA mensagem no WhatsApp. */
interface Peca {
  kind: WhatsAppMessageKind;
  /**
   * O texto. Vai para o histórico do CRM **e** como legenda no fornecedor — os
   * dois iguais, de propósito: um registro que não bate com o que a pessoa
   * recebeu é pior que nenhum registro.
   */
  body: string;
  url: string | null;
  fileName: string | null;
}

export interface DeliveryOutcome {
  /** Quantas peças saíram. */
  sent: number;
  /** `true` quando alguma peça não saiu. */
  failed: boolean;
  /** §46. A PRIMEIRA mensagem enviada — a ponta final da rastreabilidade. */
  firstMessageId: string | null;
  /** Quantos ANEXOS saíram. É o "MEDIA_SENT" do §48. */
  attachmentsSent: number;
}

/**
 * Quebra a resposta nas mensagens que vão sair.
 *
 * Sem anexo, é uma mensagem de texto. Com anexos, **não há mensagem de texto**:
 * o corpo vira a legenda do primeiro anexo (ver o cabeçalho), e os seguintes
 * levam o nome do arquivo — que é o que a pessoa vê embaixo do PDF na conversa
 * e o que ela vai procurar seis meses depois.
 */
export function montarPecas(reply: BotReply): Peca[] {
  const corpo = reply.body.trim();

  if (reply.attachments.length === 0) {
    return corpo === "" ? [] : [{ kind: "text", body: corpo, url: null, fileName: null }];
  }

  return reply.attachments.map((anexo, indice) => {
    const nome = anexo.fileName?.trim() || null;
    // ⚠️ NUNCA VAZIO. `whatsapp_start_bot_message` recusa corpo em branco, e com
    // razão: um balão vazio no histórico faz o atendente concluir que a
    // mensagem falhou. A escada é corpo → nome do arquivo → rótulo genérico.
    const legenda = (indice === 0 ? corpo : "") || nome || BOT_UNNAMED_FILE;

    return { kind: anexo.kind, body: legenda, url: anexo.url, fileName: nome };
  });
}

export interface DeliverParams {
  target: BotChatTarget;
  reply: BotReply;
  provider: MessagingProvider;
  correlationId: string;
}

/**
 * Entrega a resposta, uma peça de cada vez.
 *
 * ⚠️ SEQUENCIAL, E NÃO EM PARALELO. Duas chamadas simultâneas chegam na ordem
 * em que o fornecedor as processar, e o §14 é sobre ordem: o PDF antes da
 * imagem inverteria a leitura.
 *
 * ⚠️ FALHA PERMANENTE INTERROMPE O RESTO. Se a imagem com a explicação não sai,
 * mandar o PDF sozinho entrega um documento sem nenhum contexto — a pessoa
 * recebe um arquivo que não pediu, do nada. Melhor uma resposta faltando por
 * inteiro, visível como falha na caixa de entrada, do que meia resposta que
 * parece completa.
 */
export async function deliverBotReply(params: DeliverParams): Promise<DeliveryOutcome> {
  const { target, reply, provider, correlationId } = params;
  const resultado: DeliveryOutcome = {
    sent: 0,
    failed: false,
    firstMessageId: null,
    attachmentsSent: 0,
  };

  for (const peca of montarPecas(reply)) {
    // GRAVA PENDENTE → MANDA → LIQUIDA. Ver `whatsapp-bot.ts`.
    const messageId = await startBotMessage(target.chatId, peca.body, peca.kind);

    if (!messageId) {
      // ⚠️ NÃO ENVIA SEM REGISTRO. Uma mensagem que a pessoa recebe e que não
      // existe no CRM é a "mensagem invisível" que a ordem grava-antes existe
      // para evitar — e o atendente a repetiria.
      resultado.failed = true;
      logIntelligenceEvent("error", "bot.send_failed", {
        correlationId,
        chatId: target.chatId,
        reason: "nao gravou a mensagem; envio cancelado",
        phone: maskPhone(target.phone),
      });
      return resultado;
    }

    resultado.firstMessageId ??= messageId;

    const envio = await enviarComRetry(peca, target, provider, correlationId);

    await settleBotMessage(
      messageId,
      envio.ok ? envio.providerMessageId : null,
      envio.ok ? null : envio.message,
    );

    if (!envio.ok) {
      resultado.failed = true;
      logIntelligenceEvent("error", "bot.send_failed", {
        correlationId,
        provider: provider.name,
        chatId: target.chatId,
        messageId,
        reason: envio.code,
        phone: maskPhone(target.phone),
      });
      return resultado;
    }

    resultado.sent += 1;
    if (peca.kind !== "text") resultado.attachmentsSent += 1;

    logIntelligenceEvent("info", "bot.send_ok", {
      correlationId,
      provider: provider.name,
      chatId: target.chatId,
      messageId,
      providerMessageId: envio.providerMessageId,
      outcome: peca.kind,
      phone: maskPhone(target.phone),
    });
  }

  return resultado;
}

/**
 * §42. Tenta de novo o que vale a pena tentar.
 *
 * ⚠️ SÓ O `retryable`, e a distinção não é nossa — é o adaptador traduzindo o
 * fornecedor. Um 429 ou 503 é a rede tendo um dia ruim; "este número não tem
 * WhatsApp" é definitivo, e insistir queima a cota de envio da conta sem
 * nenhuma chance de sucesso.
 *
 * O backoff é o mesmo das campanhas (`resilience.ts`), com jitter — mas o TETO
 * de tentativas não é: ver `MAX_BOT_SEND_ATTEMPTS`. A única espera possível aqui
 * é a primeira, de 0 a 1 s.
 */
async function enviarComRetry(
  peca: Peca,
  target: BotChatTarget,
  provider: MessagingProvider,
  correlationId: string,
): Promise<SendResult> {
  let ultimo: SendResult = {
    ok: false,
    retryable: false,
    code: "no_attempt",
    message: "Nenhuma tentativa de envio foi feita.",
  };

  for (let tentativa = 1; tentativa <= MAX_BOT_SEND_ATTEMPTS; tentativa += 1) {
    ultimo = await enviarPeca(peca, target, provider, correlationId);
    if (ultimo.ok || !ultimo.retryable) return ultimo;

    logIntelligenceEvent("error", "bot.send_failed", {
      correlationId,
      provider: provider.name,
      chatId: target.chatId,
      attempt: tentativa,
      reason: ultimo.code,
      outcome: "vai tentar de novo",
      phone: maskPhone(target.phone),
    });

    if (tentativa < MAX_BOT_SEND_ATTEMPTS) await esperar(backoffDelayMs(tentativa));
  }

  return ultimo;
}

/** A tradução peça → chamada do adaptador. Nada além disto acontece aqui. */
function enviarPeca(
  peca: Peca,
  target: BotChatTarget,
  provider: MessagingProvider,
  correlationId: string,
): Promise<SendResult> {
  // §32. Sempre `target.chatKey`. Não há outro destino possível nesta função.
  const to = target.chatKey;

  if (peca.kind === "image" && peca.url) {
    return provider.sendImage({ to, imageUrl: peca.url, caption: peca.body, correlationId });
  }

  if (peca.kind === "document" && peca.url) {
    return provider.sendDocument({
      to,
      documentUrl: peca.url,
      fileName: peca.fileName ?? BOT_UNNAMED_FILE,
      caption: peca.body,
      correlationId,
    });
  }

  // Texto — e também o anexo que chegou sem URL, que não deveria acontecer: as
  // portas de chatbot recusam a publicação inteira quando não conseguem assinar
  // o arquivo. Cair para texto é melhor que não responder nada.
  return provider.send({ to, body: peca.body, correlationId });
}

function esperar(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
