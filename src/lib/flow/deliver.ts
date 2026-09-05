import "server-only";
import { backoffDelayMs } from "@/lib/messaging/resilience";
import { logFlowEngineEvent } from "@/lib/messaging/telemetry";
import { startBotMessage, settleBotMessage, type BotChatTarget } from "@/lib/services/whatsapp-bot";
import type { MessagingProvider, SendResult } from "@/lib/messaging/messaging.types";
import type { WhatsAppMessageKind } from "@/modules/whatsapp/whatsapp.types";
import type { FlowEffect, FlowQuestionOption } from "@/modules/flow/flow.types";

/**
 * A SAÍDA DO MOTOR PARA O WHATSAPP — o §7 do Prompt 3.
 *
 * ⚠️ ELE NÃO É UM SEGUNDO CANAL DE ENVIO. A coreografia que importa —
 * GRAVA PENDENTE → MANDA → LIQUIDA — mora em `whatsapp-bot.ts` e é reusada
 * inteira aqui. O que este arquivo acrescenta é a tradução de `FlowEffect` para
 * mensagem, que é a única coisa específica do motor.
 *
 * A ordem grava-antes está explicada lá e vale igual: entre o envio e a
 * resposta do fornecedor cabe uma falha, e uma mensagem ENTREGUE cuja resposta
 * se perdeu não pode sumir do CRM.
 *
 * ⚠️ O QUE ESTE ARQUIVO NÃO FAZ: decidir. Ele recebe efeitos já calculados e os
 * executa. Nenhuma linha aqui escolhe um caminho, monta uma frase ou consulta o
 * desenho — se um dia precisar, a decisão está no lugar errado.
 */

/** Quantas vezes uma peça é tentada. O mesmo teto do robô de intenções. */
const MAX_ATTEMPTS = 3;

/**
 * ⚠️ O TETO DE ESPERA DE UM LOTE, E ELE EXISTE POR CAUSA DO §44.
 *
 * `delaySeconds` deixa o desenhador espaçar uma sequência de mensagens para ela
 * não chegar como um bloco só — é uma boa ideia e vale até 60 s por nó. Mas o
 * webhook do fornecedor tem orçamento de tempo: três mensagens com 20 s cada
 * estourariam a requisição, o fornecedor reentregaria o payload, e a
 * reentrega encontraria o passo já reivindicado (§23) — ou seja, a pessoa
 * receberia metade da sequência e nada completaria o resto.
 *
 * Oito segundos por LOTE é o que cabe com folga. O que passar disso é ignorado,
 * e o log diz que foi — porque uma pausa que não aconteceu é diferente de uma
 * pausa que ninguém pediu.
 */
const MAX_DELAY_BUDGET_MS = 8_000;

export interface FlowDeliveryContext {
  target: BotChatTarget;
  provider: MessagingProvider;
  runId: string;
  correlationId?: string;
}

export interface FlowDeliveryOutcome {
  sent: number;
  failed: number;
  /** A PRIMEIRA mensagem que saiu. Amarra o passo à conversa na trilha. */
  firstMessageId: string | null;
}

/* -------------------------------------------------------------------------- */
/* A tradução                                                                 */
/* -------------------------------------------------------------------------- */

interface Peca {
  kind: WhatsAppMessageKind;
  body: string;
  url: string | null;
  delayMs: number;
}

/**
 * As alternativas escritas como a pessoa vai lê-las.
 *
 * ⚠️ O NÚMERO É APRESENTAÇÃO, E NÃO REGRA — que é o §41. Ele nasce aqui, na
 * hora de escrever a mensagem, e morre em `matchOption`, que o traduz de volta
 * para a CHAVE na primeira linha em que o lê. Nada entre os dois sabe que
 * existiu um número: reordenar as alternativas no Builder muda o que a pessoa
 * lê e não muda uma única condição do desenho.
 */
function listarAlternativas(options: readonly FlowQuestionOption[]): string {
  if (options.length === 0) return "";
  return (
    "\n\n" +
    options.map((opcao, indice) => `${indice + 1}. ${opcao.label.trim() || opcao.key}`).join("\n")
  );
}

/**
 * Que mensagens este efeito produz.
 *
 * ⚠️ NEM TODO EFEITO VIRA MENSAGEM, e os que não viram são a maioria em número:
 * `runAction` é trabalho, `fail` é registro, e `assignTeam` só fala se o nó
 * tiver uma frase escrita. Devolver lista vazia é o normal.
 */
export function pecasDoEfeito(effect: FlowEffect): Peca[] {
  const delayMs = "delaySeconds" in effect ? Math.max(0, effect.delaySeconds) * 1000 : 0;

  switch (effect.kind) {
    case "sendMessage": {
      const pecas: Peca[] = [];
      const corpo = effect.text.trim();

      // ⚠️ ANEXO PRIMEIRO, COM O TEXTO COMO LEGENDA — e não texto + anexo em
      // duas mensagens. É a mesma decisão de `montarPecas` no robô de
      // intenções: um PDF chegando sozinho, depois de um balão de texto, faz a
      // pessoa ver um arquivo sem contexto se a segunda mensagem atrasar.
      if (effect.imageUrl) {
        pecas.push({ kind: "image", body: corpo || " ", url: effect.imageUrl, delayMs });
      }
      if (effect.pdfUrl) {
        pecas.push({
          kind: "document",
          body: pecas.length === 0 ? corpo || " " : " ",
          url: effect.pdfUrl,
          delayMs: pecas.length === 0 ? delayMs : 0,
        });
      }
      if (pecas.length === 0 && corpo !== "") {
        pecas.push({ kind: "text", body: corpo, url: null, delayMs });
      }

      return pecas;
    }

    case "askQuestion":
    case "repeatQuestion": {
      const corpo = (effect.text.trim() + listarAlternativas(effect.options)).trim();
      return corpo === "" ? [] : [{ kind: "text", body: corpo, url: null, delayMs: 0 }];
    }

    case "assignTeam":
    case "complete": {
      // A frase é opcional: um nó de encerramento sem texto encerra em silêncio,
      // que é legítimo quando a mensagem anterior já se despediu.
      const corpo = effect.message?.trim() ?? "";
      return corpo === "" ? [] : [{ kind: "text", body: corpo, url: null, delayMs: 0 }];
    }

    case "runAction":
    case "fail":
      // ⚠️ A FALHA NÃO VIRA MENSAGEM AQUI, E É O §35. O associado não pode
      // receber "no_matching_transition". Quem decide o que ele lê é o desenho,
      // ou a frase de erro configurada — nunca o vocabulário técnico do motor.
      return [];
  }
}

/* -------------------------------------------------------------------------- */
/* A entrega                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Entrega os efeitos de uma passada, na ordem.
 *
 * ⚠️ SEQUENCIAL, E NÃO EM PARALELO. Duas chamadas simultâneas chegam na ordem em
 * que o fornecedor as processar — e a ordem é o conteúdo: "vou te transferir"
 * depois de "aguarde um momento" é uma conversa; ao contrário, é um susto.
 */
export async function deliverFlowEffects(
  effects: readonly FlowEffect[],
  ctx: FlowDeliveryContext,
): Promise<FlowDeliveryOutcome> {
  const resultado: FlowDeliveryOutcome = { sent: 0, failed: 0, firstMessageId: null };

  if (!ctx.provider.configured) {
    // Sem fornecedor não há a quem responder. Recusar ANTES de gravar evita
    // deixar mensagens pendentes que nunca vão sair — elas ficariam na conversa
    // parecendo falha do associado.
    logFlowEngineEvent("error", "flow.step_skipped", {
      correlationId: ctx.correlationId,
      runId: ctx.runId,
      reason: "fornecedor nao configurado",
      count: effects.length,
    });
    return { ...resultado, failed: effects.length };
  }

  let orcamentoDeEspera = MAX_DELAY_BUDGET_MS;

  for (const effect of effects) {
    for (const peca of pecasDoEfeito(effect)) {
      if (peca.delayMs > 0) {
        const espera = Math.min(peca.delayMs, orcamentoDeEspera);
        orcamentoDeEspera -= espera;

        if (espera < peca.delayMs) {
          logFlowEngineEvent("info", "flow.node", {
            correlationId: ctx.correlationId,
            runId: ctx.runId,
            // `?? undefined` porque o efeito de FALHA carrega `nodeId: null`, e
            // o campo do log é opcional, não anulável — `null` viraria a string
            // "null" na linha de JSON.
            nodeId: effect.nodeId ?? undefined,
            reason: "pausa encurtada pelo orcamento do lote",
          });
        }
        if (espera > 0) await esperar(espera);
      }

      // GRAVA PENDENTE → MANDA → LIQUIDA. Ver `whatsapp-bot.ts`.
      const messageId = await startBotMessage(ctx.target.chatId, peca.body, peca.kind);

      if (!messageId) {
        // ⚠️ NÃO ENVIA SEM REGISTRO. Uma mensagem que a pessoa recebe e que não
        // existe no CRM é invisível para quem for atender depois — e o
        // atendente concluiria que ela nunca foi respondida.
        resultado.failed += 1;
        logFlowEngineEvent("error", "flow.node", {
          correlationId: ctx.correlationId,
          runId: ctx.runId,
          reason: "nao foi possivel gravar a mensagem",
        });
        continue;
      }

      const envio = await enviarComRetry(peca, ctx);

      // LIQUIDA: com id do fornecedor vira `sent`, sem ele vira `failed`. É a
      // função do atendente, reusada sem alteração — ver `settleBotMessage`.
      await settleBotMessage(
        messageId,
        envio.ok ? envio.providerMessageId : null,
        envio.ok ? null : envio.message,
      );

      if (envio.ok) {
        resultado.sent += 1;
        resultado.firstMessageId ??= messageId;
      } else {
        resultado.failed += 1;
      }
    }
  }

  return resultado;
}

async function enviarComRetry(peca: Peca, ctx: FlowDeliveryContext): Promise<SendResult> {
  let ultimo: SendResult = {
    ok: false,
    retryable: false,
    code: "no_attempt",
    message: "Nenhuma tentativa de envio foi feita.",
  };

  for (let tentativa = 1; tentativa <= MAX_ATTEMPTS; tentativa += 1) {
    ultimo = await enviarPeca(peca, ctx);
    if (ultimo.ok || !ultimo.retryable) return ultimo;

    logFlowEngineEvent("error", "flow.node", {
      correlationId: ctx.correlationId,
      runId: ctx.runId,
      attempt: tentativa,
      maxAttempts: MAX_ATTEMPTS,
      reason: ultimo.code,
    });

    if (tentativa < MAX_ATTEMPTS) await esperar(backoffDelayMs(tentativa));
  }

  return ultimo;
}

/** A tradução peça → chamada do adaptador. Nada além disto acontece aqui. */
function enviarPeca(peca: Peca, ctx: FlowDeliveryContext): Promise<SendResult> {
  // ⚠️ O DESTINO SAI DE `chatKey`, E DE MAIS LUGAR NENHUM. Ele foi lido do banco
  // pelo id da conversa que o webhook gravou — nunca do `from` de um JSON que
  // chegou pela internet. Ver `getBotChatTarget`.
  const to = ctx.target.chatKey;
  const correlationId = ctx.correlationId ?? ctx.runId;

  if (peca.kind === "image" && peca.url) {
    return ctx.provider.sendImage({ to, imageUrl: peca.url, caption: peca.body, correlationId });
  }

  if (peca.kind === "document" && peca.url) {
    return ctx.provider.sendDocument({
      to,
      documentUrl: peca.url,
      fileName: nomeDoArquivo(peca.url),
      caption: peca.body,
      correlationId,
    });
  }

  return ctx.provider.send({ to, body: peca.body, correlationId });
}

/**
 * O nome que a pessoa vê embaixo do PDF na conversa.
 *
 * Sai da própria URL porque é o que existe: o nó guarda um ENDEREÇO (o arquivo
 * já foi publicado pelo módulo dono dele), e não um upload com metadados.
 */
function nomeDoArquivo(url: string): string {
  const ultimo = url.split("?")[0]?.split("/").pop() ?? "";
  return ultimo.trim() === "" ? "documento.pdf" : decodeURIComponent(ultimo);
}

function esperar(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
