import { intentDefinition } from "./intent.registry";
import { confidenceBand, type IntentName } from "./intent.types";
import {
  CONTEXT_TTL_MINUTES,
  EMPTY_CONTEXT,
  type RouterContext,
  type RouterDecision,
  type RouterOutcome,
  type RouterTurn,
} from "./intelligence.types";

/**
 * O ROTEADOR — e ele é de propósito burro e determinístico.
 *
 * Recebe o contexto da conversa + o que aconteceu no turno, e devolve O QUE
 * FAZER. Não tem I/O, não chama LLM, não toca no banco: dá para testar cada
 * regra isoladamente.
 *
 * ⚠️ É O MESMO DESENHO DE `src/lib/chat/decide.ts`, e a razão é a mesma. O §2 do
 * escopo diz que a IA interpreta e o CRM responde; a única forma de isso ser
 * VERDADE, e não uma intenção, é a decisão sair de um lugar onde texto gerado
 * não entra. `RouterDecision` não tem campo de texto livre: ou é uma chave de
 * mensagem configurada, ou é uma ferramenta que consulta o CRM.
 *
 * A única frase que este arquivo produz é a de confirmação, e ela vem escrita
 * no registro de intenções — não é montada aqui, e muito menos pelo modelo.
 */

/** O contexto vencido não conta. Ver `CONTEXT_TTL_MINUTES`. */
function vigente(context: RouterContext, agora: Date): RouterContext {
  if (!context.expiresAt) return context;
  return new Date(context.expiresAt).getTime() > agora.getTime() ? context : EMPTY_CONTEXT;
}

function expiraEm(agora: Date): string {
  return new Date(agora.getTime() + CONTEXT_TTL_MINUTES * 60_000).toISOString();
}

/** O que fazer com uma intenção já decidida — sem mais nenhuma dúvida. */
function executar(intent: IntentName, subject: string | null): RouterDecision {
  const definicao = intentDefinition(intent);

  // ⚠️ O ENCAMINHAMENTO VEM DO REGISTRO, e não de um `if` por nome de intenção.
  // Ligar uma segunda intenção ao atendimento humano é uma linha lá, não uma
  // condição aqui — que é o §11.
  if (definicao.handoff) return { kind: "handoff", intent };
  if (definicao.tool) return { kind: "tool", intent, tool: definicao.tool, subject };

  // ⚠️ SAUDAÇÃO E AJUDA COMPARTILHAM A MENSAGEM DE BOAS-VINDAS, e é deliberado.
  // A frase de boas-vindas É, por construção, a lista do que o robô sabe fazer
  // — que é exatamente a resposta a "o que você faz?". Um texto de ajuda
  // separado seria uma segunda cópia da mesma lista, e a segunda cópia é a que
  // envelhece: alguém liga um módulo novo, atualiza a saudação e esquece a
  // ajuda.
  if (intent === "saudacao" || intent === "ajuda") return { kind: "message", message: "welcome" };

  return { kind: "message", message: "fallback" };
}

export function routeTurn(
  contextoBruto: RouterContext,
  turn: RouterTurn,
  agora: Date = new Date(),
): RouterOutcome {
  const context = vigente(contextoBruto, agora);

  /* ---------------------------------------------------------------------- */
  /* O classificador não respondeu (§40)                                     */
  /* ---------------------------------------------------------------------- */
  if (turn.kind === "unavailable") {
    // ⚠️ O CONTEXTO É PRESERVADO, INCLUSIVE O PENDENTE. Uma falha do modelo não
    // é a pessoa mudando de assunto: apagar a pergunta pendente aqui faria o
    // "sim" seguinte cair no vazio, e ela teria de recomeçar por causa de um
    // problema que não foi dela.
    return {
      decision: { kind: "message", message: "error" },
      context: { ...context, expiresAt: expiraEm(agora) },
    };
  }

  /* ---------------------------------------------------------------------- */
  /* A resposta a uma confirmação (§23, §24)                                 */
  /* ---------------------------------------------------------------------- */
  if (turn.kind === "affirmation") {
    if (!context.pendingIntent) {
      // "Sim" sem pergunta pendente não quer dizer nada. Não é erro da pessoa —
      // costuma ser o contexto tendo expirado entre a pergunta e a resposta —,
      // então a saída é a frase que lista o que dá para pedir.
      return {
        decision: { kind: "message", message: "fallback" },
        context: { ...context, expiresAt: expiraEm(agora) },
      };
    }

    if (turn.reply === "no") {
      return {
        decision: { kind: "message", message: "fallback" },
        // ⚠️ O PENDENTE SAI E O ATUAL FICA. "Não" recusa aquela pergunta, não a
        // conversa inteira — zerar `currentIntent` aqui faria a próxima frase
        // curta ("então me manda a outra") perder o fio.
        context: {
          ...context,
          pendingIntent: null,
          pendingSubject: null,
          expiresAt: expiraEm(agora),
        },
      };
    }

    const intent = context.pendingIntent;
    const subject = context.pendingSubject;

    return {
      decision: executar(intent, subject),
      context: {
        currentIntent: intent,
        currentSubject: subject,
        pendingIntent: null,
        pendingSubject: null,
        expiresAt: expiraEm(agora),
      },
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Uma mensagem interpretada                                              */
  /* ---------------------------------------------------------------------- */
  const { analysis } = turn;

  /**
   * ⚠️ A HERANÇA DE CONTEXTO — é ela que faz o §28 funcionar.
   *
   * "E a Câmara Setorial?" não tem verbo: sozinha, ela é ininteligível, e o
   * classificador devolve `desconhecido` com o assunto preenchido. Herdando a
   * intenção do turno anterior, ela vira "consultar normativa da Câmara
   * Setorial" — que é o que a pessoa quis dizer.
   *
   * ⚠️ SÓ HERDA QUANDO HÁ ASSUNTO NOVO. Um "desconhecido" sem assunto nenhum é
   * a pessoa dizendo algo que ninguém entendeu — repetir a última intenção ali
   * faria o robô mandar de novo o que acabou de mandar, e a conversa entraria
   * em laço.
   */
  const herdou =
    analysis.intent === "desconhecido" &&
    analysis.subject !== null &&
    context.currentIntent !== null;

  const intent = herdou ? (context.currentIntent as IntentName) : analysis.intent;
  const subject = analysis.subject ?? (herdou ? context.currentSubject : null);

  const definicao = intentDefinition(intent);
  // ⚠️ A HERANÇA NÃO EMPRESTA CONFIANÇA. Herdar a intenção é uma inferência
  // nossa, não uma leitura do modelo — tratá-la como certa faria uma frase solta
  // disparar uma ferramenta. Ela entra na faixa média, que pergunta antes.
  const faixa = herdou ? "medium" : confidenceBand(analysis.confidence, definicao.sensitive);

  if (faixa === "high") {
    return {
      decision: executar(intent, subject),
      context: {
        currentIntent: intent,
        currentSubject: subject ?? context.currentSubject,
        pendingIntent: null,
        pendingSubject: null,
        expiresAt: expiraEm(agora),
      },
    };
  }

  if (faixa === "medium" && definicao.confirmation) {
    return {
      decision: {
        kind: "confirm",
        intent,
        subject,
        question: definicao.confirmation,
      },
      context: {
        ...context,
        pendingIntent: intent,
        pendingSubject: subject,
        expiresAt: expiraEm(agora),
      },
    };
  }

  /**
   * ⚠️ FAIXA BAIXA — E TAMBÉM A MÉDIA SEM PERGUNTA DE CONFIRMAÇÃO.
   *
   * Uma intenção sem frase de confirmação no registro não tem como ser
   * confirmada, e executar assim mesmo seria contornar a faixa média em vez de
   * respeitá-la. Cair no fallback é a direção segura: a frase lista o que o robô
   * sabe fazer e oferece um atendente.
   *
   * O contexto ATUAL não é apagado — a pessoa pode estar reformulando a mesma
   * pergunta, e o fio serve para a próxima tentativa.
   */
  return {
    decision: { kind: "message", message: "fallback" },
    context: {
      ...context,
      pendingIntent: null,
      pendingSubject: null,
      expiresAt: expiraEm(agora),
    },
  };
}
