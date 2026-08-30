import "server-only";
import { readAffirmation } from "./affirmation";
import { classifyMessage, type ClassifyHistoryItem } from "./classify";
import { loadContext, saveContext } from "./context";
import { recordInteraction, type InteractionOutcome } from "./log";
import { loadChatbotMessages } from "./messages";
import { toolFor } from "./tools";
import { confirmationBody } from "@/modules/intelligence/intelligence.labels";
import { routeTurn } from "@/modules/intelligence/router";
import {
  EMPTY_CONTEXT,
  type RouterDecision,
  type RouterTurn,
  type ToolAttachment,
  type ToolResult,
} from "@/modules/intelligence/intelligence.types";
import type { IntentName, ToolName } from "@/modules/intelligence/intent.types";

/**
 * O ENCANAMENTO — contexto → interpretação → decisão → ferramenta → resposta.
 *
 * ⚠️ ELE NÃO ENVIA NADA, e continua não enviando. Devolve a resposta pronta;
 * quem a coloca no WhatsApp é `deliver.ts`, chamado por
 * `intelligence-inbox.ts`. A separação não é burocracia: assim toda a conversa
 * é testável sem fornecedor, sem rede e sem número de telefone, do mesmo jeito
 * que `src/lib/chat/engine.ts` já é.
 *
 * ⚠️ E ELE NÃO DECIDE NADA. Quem decide é `router.ts`, que é puro. Este arquivo
 * só executa a decisão e cuida do que tem I/O: ler o contexto, chamar o modelo,
 * rodar a ferramenta, gravar a trilha.
 *
 * ⚠️ NADA AQUI LANÇA PARA FORA. Uma exceção viraria 500 no webhook, o fornecedor
 * reentregaria o payload e o resultado seria um laço de reentrega sobre um erro
 * que não se resolve sozinho.
 */

export interface HandleMessageInput {
  /** A conversa em `whatsapp_chats`. É a chave da memória. */
  chatId: string;
  /** A mensagem que originou este turno, para a trilha. */
  messageId: string | null;
  /** Associado reconhecido pelo telefone, quando há. */
  memberId: string | null;
  /** Só dígitos, E.164. */
  phone: string | null;
  message: string;
  /** Falas anteriores, quando quem chama já as tem em mãos. */
  history?: readonly ClassifyHistoryItem[];
  /** §36. Viaja no log de ponta a ponta. */
  correlationId: string;
}

/** O que sai do turno antes de a trilha ser gravada. */
interface Resposta {
  /** O texto a enviar. Nunca vazio. */
  body: string;
  attachments: ToolAttachment[];
  handoff: boolean;
}

/**
 * A resposta pronta, mais o que a trilha precisa para fechar a corrente do §46.
 *
 * `handoff` vem de `Resposta`: `true` quando a conversa passou para uma pessoa
 * (§31). Quem chama decide o que fazer com isso — hoje, calar o robô naquela
 * conversa (`pauseBot`) e deixar o contador de não lidas de pé, que é o que faz
 * a conversa aparecer para o atendente.
 */
export interface BotReply extends Resposta {
  /**
   * A linha da trilha deste turno, para amarrar a resposta que sair (§46).
   *
   * `null` quando o registro falhou. Registrar é importante; não é mais
   * importante que responder — ver `recordInteraction`.
   */
  interactionId: number | null;
  /** Para o log de quem entrega. Vocabulário fechado, nunca texto da pessoa. */
  intent: IntentName;
  tool: ToolName | null;
  outcome: InteractionOutcome;
}

/** O desfecho de uma ferramenta, no vocabulário da trilha. */
function desfecho(resultado: ToolResult): InteractionOutcome {
  switch (resultado.status) {
    case "ok":
      return "tool_ok";
    case "error":
      return "tool_error";
    // ⚠️ `unidentified` CONTA COMO `tool_empty`, e é a leitura certa: a
    // ferramenta funcionou e não havia o que entregar. Um valor próprio no enum
    // seria mais preciso e responderia uma pergunta que ninguém faz — quem lê a
    // trilha quer saber se o robô ENTREGOU, e nos dois casos ele não entregou.
    default:
      return "tool_empty";
  }
}

export async function handleIncomingMessage(input: HandleMessageInput): Promise<BotReply> {
  const comecou = Date.now();

  const contexto = await loadContext(input.chatId);
  const mensagens = await loadChatbotMessages();

  /**
   * ⚠️ A LEITURA DE "SIM/NÃO" VEM ANTES DO MODELO, e só quando há pergunta
   * pendente. Duas razões:
   *
   *   • uma confirmação decide se uma AÇÃO acontece, e isso não pode depender
   *     de um classificador achar que "pode ser" era um sim;
   *   • sem pergunta pendente, um "sim" solto não significa nada — deixá-lo
   *     virar `affirmation` faria o roteador tratar ruído como resposta.
   */
  let turno: RouterTurn;
  let confianca: number | null = null;

  const afirmacao = contexto.pendingIntent ? readAffirmation(input.message) : "unknown";

  if (afirmacao !== "unknown") {
    turno = { kind: "affirmation", reply: afirmacao };
  } else {
    const leitura = await classifyMessage({
      message: input.message,
      history: input.history,
    });

    if (leitura.ok) {
      turno = { kind: "analysis", analysis: leitura.analysis };
      confianca = leitura.analysis.confidence;
    } else {
      turno = { kind: "unavailable" };
    }
  }

  const { decision, context: proximoContexto } = routeTurn(contexto, turno);

  const { reply, outcome, tool } = await executar(decision, input, mensagens);

  /**
   * ⚠️ O CONTEXTO É ZERADO NO ENCAMINHAMENTO (§32). Com o atendimento humano
   * assumindo, as próximas mensagens são para a PESSOA — e um contexto de pé
   * faria a seguinte ser lida como continuação de um assunto do robô.
   */
  await saveContext(input.chatId, decision.kind === "handoff" ? EMPTY_CONTEXT : proximoContexto);

  const intent = intencaoDe(decision);

  const interactionId = await recordInteraction({
    chatId: input.chatId,
    messageId: input.messageId,
    intent,
    confidence: confianca,
    tool,
    outcome,
    subject: assuntoDe(decision),
    latencyMs: Date.now() - comecou,
    correlationId: input.correlationId,
  });

  return { ...reply, interactionId, intent, tool, outcome };
}

/** A intenção que a trilha registra para esta decisão. */
function intencaoDe(decision: RouterDecision): IntentName {
  return decision.kind === "message" ? "desconhecido" : decision.intent;
}

function assuntoDe(decision: RouterDecision): string | null {
  return decision.kind === "tool" || decision.kind === "confirm" ? decision.subject : null;
}

async function executar(
  decision: RouterDecision,
  input: HandleMessageInput,
  mensagens: Awaited<ReturnType<typeof loadChatbotMessages>>,
): Promise<{ reply: Resposta; outcome: InteractionOutcome; tool: ToolName | null }> {
  switch (decision.kind) {
    case "message":
      return {
        reply: { body: mensagens(decision.message), attachments: [], handoff: false },
        outcome: "message",
        tool: null,
      };

    case "confirm":
      return {
        reply: { body: confirmationBody(decision.question), attachments: [], handoff: false },
        outcome: "confirmed",
        tool: null,
      };

    case "handoff":
      return {
        reply: { body: mensagens("humanHandoff"), attachments: [], handoff: true },
        outcome: "handoff",
        tool: null,
      };

    case "tool": {
      const ferramenta = toolFor(decision.tool);
      const resultado = await ferramenta.run(decision.subject, {
        memberId: input.memberId,
        phone: input.phone,
        correlationId: input.correlationId,
      });

      return {
        reply: respostaDaFerramenta(resultado, mensagens),
        outcome: desfecho(resultado),
        tool: decision.tool,
      };
    }
  }
}

/**
 * ⚠️ OS QUATRO DESFECHOS TÊM QUATRO FRASES, e nenhuma delas é inventada aqui:
 * três vêm de `app_settings` e a quarta é o conteúdo oficial do CRM.
 *
 * Juntar `empty` com `error` numa frase só é exatamente o que o §22 e o §40
 * proíbem separadamente — um é trabalho de quem publica, o outro de quem cuida
 * do sistema, e a pessoa que atende depois precisa saber qual dos dois foi.
 */
function respostaDaFerramenta(
  resultado: ToolResult,
  mensagens: Awaited<ReturnType<typeof loadChatbotMessages>>,
): Resposta {
  switch (resultado.status) {
    case "ok":
      return { body: resultado.body, attachments: resultado.attachments, handoff: false };
    case "empty":
      return { body: mensagens("noResult"), attachments: [], handoff: false };
    case "unidentified":
      return { body: mensagens("unidentified"), attachments: [], handoff: false };
    case "error":
      return { body: mensagens("error"), attachments: [], handoff: false };
  }
}
