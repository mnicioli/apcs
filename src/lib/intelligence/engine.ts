import "server-only";
import { readAffirmation } from "./affirmation";
import { aiProvider } from "./ai/registry";
import { readMenuChoice } from "@/modules/intelligence/menu";
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
  type ToolContext,
  type ToolResult,
  type ToolSource,
} from "@/modules/intelligence/intelligence.types";
import type { AIHistoryItem, AIUsage } from "./ai/ai.types";
import type { IntentName, ToolName } from "@/modules/intelligence/intent.types";

/**
 * O ENCANAMENTO — contexto → interpretação → decisão → ferramenta → resposta.
 *
 * ⚠️ ELE NÃO ENVIA NADA, e continua não enviando. Devolve a resposta pronta;
 * quem a coloca no WhatsApp é `deliver.ts`, chamado por
 * `intelligence-inbox.ts`. A separação não é burocracia: assim toda a conversa
 * é testável sem fornecedor, sem rede e sem número de telefone.
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
  history?: readonly AIHistoryItem[];
  /** §36. Viaja no log de ponta a ponta. */
  correlationId: string;
}

/** O que sai do turno antes de a trilha ser gravada. */
interface Resposta {
  /** O texto a enviar. Nunca vazio. */
  body: string;
  attachments: ToolAttachment[];
  handoff: boolean;
  /** §17. De onde veio o conteúdo, quando veio de algum lugar. */
  source: ToolSource | null;
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
  let uso: AIUsage | null = null;

  const afirmacao = contexto.pendingIntent ? readAffirmation(input.message) : "unknown";

  /**
   * ⚠️ §46 e §81. A ESCOLHA DE MENU TAMBÉM É LIDA SEM MODELO.
   *
   * As duas leituras determinísticas vêm antes por razões diferentes:
   *
   *   a confirmação  decide se uma AÇÃO acontece, e isso não pode depender de
   *                  um classificador achar que "pode ser" era um sim;
   *   o menu         existe justamente para quando o classificador está fora do
   *                  ar — passar a escolha por ele seria pedir ao morto que
   *                  atestasse o próprio óbito.
   *
   * E as duas servem ao §81 de graça: um "sim" ou um "2" resolvidos sem chamar
   * o modelo são dois turnos que não custam nada.
   */
  const escolha = readMenuChoice(input.message, contexto.menuShownAt);

  if (afirmacao !== "unknown") {
    turno = { kind: "affirmation", reply: afirmacao };
  } else if (escolha) {
    turno = { kind: "menuChoice", intent: escolha };
  } else {
    const leitura = await aiProvider().classifyIntent({
      message: input.message,
      history: input.history,
    });

    if (leitura.ok) {
      turno = { kind: "analysis", analysis: leitura.analysis };
      confianca = leitura.analysis.confidence;
      uso = leitura.usage;
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
    // §17, §32, §33. De onde saiu a resposta — qual normativa, qual boletim,
    // qual item da Base. `tool` sozinho diz que foi uma normativa, não QUAL.
    source: reply.source,
    // §78, §80. Nulos quando o turno não passou pelo modelo (um "sim", uma
    // escolha de menu) — e nulo NÃO é zero: ver a view de métricas.
    usage: uso,
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

/** O contexto que toda ferramenta recebe. Um lugar só, para não divergirem. */
function contextoDeFerramenta(input: HandleMessageInput): ToolContext {
  return {
    message: input.message,
    memberId: input.memberId,
    phone: input.phone,
    correlationId: input.correlationId,
  };
}

/**
 * §43. O RESGATE PELA BASE DE CONHECIMENTO — a última tentativa antes de dizer
 * "não entendi".
 *
 * ----------------------------------------------------------------------------
 * ⚠️ POR QUE ELE EXISTE
 * ----------------------------------------------------------------------------
 * A Base de Conhecimento só era consultada quando o classificador devolvia
 * `consultar_conhecimento`. E o classificador NÃO CONHECE as palavras-chave
 * cadastradas — o prompt diz isso com todas as letras. Ele decide pelo FORMATO
 * da pergunta, não pelo conteúdo dela.
 *
 * O efeito, medido em 01/09/2026: uma chave cadastrada que não pareça pergunta
 * institucional ("jets", "disponível") era classificada como `desconhecido` com
 * confiança 0.1–0.3, e o item nunca era alcançado. Quem cadastrou leu no
 * formulário que "é por elas que o chatbot encontra a resposta" e estava certo
 * sobre a intenção do desenho, não sobre o que o código fazia.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ POR QUE AQUI, E NÃO ANTES DO CLASSIFICADOR
 * ----------------------------------------------------------------------------
 * Consultar a base antes da IA resolveria o mesmo caso e abriria um bem pior: a
 * busca casa por TRECHO, então uma chave infeliz — "bolsa", "manda", "material"
 * — sequestraria as consultas de Bolsa, normativa e comunicado, que são a
 * função principal do robô. E sequestraria em silêncio, para todo mundo, a
 * partir de um cadastro que ninguém revisou.
 *
 * Aqui o resgate só age onde HOJE NÃO HÁ RESPOSTA NENHUMA. O pior caso deixa de
 * ser "o robô parou de mandar a Bolsa" e passa a ser "o robô respondeu um item
 * da base em vez de dizer que não entendeu" — que é o que se estava pedindo.
 *
 * ⚠️ E A TRILHA REGISTRA A VERDADE: `intent` continua sendo o que o
 * classificador disse (`desconhecido`), com `tool: getKnowledge` ao lado. O par
 * é o que torna o resgate MENSURÁVEL — dá para contar quantos "não entendi" a
 * base salvou, que é o número que diz se este caminho vale a pena.
 */
async function resgatarNaBase(
  input: HandleMessageInput,
): Promise<{ reply: Resposta; outcome: InteractionOutcome; tool: ToolName } | null> {
  const resultado = await toolFor("getKnowledge").run(null, contextoDeFerramenta(input));

  // Só "ok" resgata. `empty` é o caso normal (a base não tem esse assunto) e
  // `error` já foi registrado lá dentro — nos dois, o "não entendi" configurado
  // continua sendo a resposta certa, e é ele que lista o que o robô sabe fazer.
  if (resultado.status !== "ok") return null;

  return {
    reply: {
      body: resultado.body,
      attachments: resultado.attachments,
      handoff: false,
      source: resultado.source,
    },
    outcome: "tool_ok",
    tool: "getKnowledge",
  };
}

async function executar(
  decision: RouterDecision,
  input: HandleMessageInput,
  mensagens: Awaited<ReturnType<typeof loadChatbotMessages>>,
): Promise<{ reply: Resposta; outcome: InteractionOutcome; tool: ToolName | null }> {
  switch (decision.kind) {
    case "message": {
      // ⚠️ SÓ NO "não entendi". As outras frases — boas-vindas, despedida — são
      // a resposta certa e completa; procurar na base antes delas trocaria uma
      // saudação por um item de FAQ que casou por acaso.
      if (decision.message === "fallback") {
        const resgate = await resgatarNaBase(input);
        if (resgate) return resgate;
      }

      return {
        reply: { body: mensagens(decision.message), attachments: [], handoff: false, source: null },
        outcome: "message",
        tool: null,
      };
    }

    case "confirm":
      return {
        reply: {
          body: confirmationBody(decision.question),
          attachments: [],
          handoff: false,
          source: null,
        },
        outcome: "confirmed",
        tool: null,
      };

    case "handoff":
      return {
        reply: { body: mensagens("humanHandoff"), attachments: [], handoff: true, source: null },
        outcome: "handoff",
        tool: null,
      };

    case "tool": {
      const ferramenta = toolFor(decision.tool);
      const resultado = await ferramenta.run(decision.subject, contextoDeFerramenta(input));

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
      return {
        body: resultado.body,
        attachments: resultado.attachments,
        handoff: false,
        source: resultado.source,
      };
    // ⚠️ OS TRÊS SEM CONTEÚDO NÃO TÊM ORIGEM, e é o certo: `source` responde "de
    // onde saiu o que foi entregue". Não tendo sido entregue nada, uma origem
    // aqui seria a afirmação falsa de que um documento foi consultado com
    // sucesso — e ela contaria como "documento mais pedido" no §76.
    case "empty":
      return { body: mensagens("noResult"), attachments: [], handoff: false, source: null };
    case "unidentified":
      return { body: mensagens("unidentified"), attachments: [], handoff: false, source: null };
    case "error":
      return { body: mensagens("error"), attachments: [], handoff: false, source: null };
  }
}
