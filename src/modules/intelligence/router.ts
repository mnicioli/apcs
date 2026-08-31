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

/**
 * A intenção que fica na memória como "o assunto da conversa".
 *
 * ⚠️ SÓ AS QUE ACEITAM UM ASSUNTO ENTRAM AQUI, e a razão é o uso: `currentIntent`
 * existe para ser HERDADA por uma frase sem verbo ("e a Câmara Setorial?").
 * Herdar uma intenção que não tem o que fazer com um assunto novo não ajuda —
 * e numa delas chega a fazer mal.
 *
 * ⚠️ O CASO QUE MOSTROU ISSO FOI `encerramento`. Guardando-a, a sequência
 *
 *     "obrigado"            → "de nada!"     (currentIntent = encerramento)
 *     "ah, e a Setorial?"   → herda encerramento → "de nada!" de novo
 *
 * respondia a despedida duas vezes, e a pergunta de verdade se perdia. Valia
 * também para `saudacao`: um "oi" no meio da conversa apagaria o fio.
 *
 * Preservar a anterior é o certo — "oi" e "obrigado" não mudam de assunto, só
 * pontuam a conversa.
 */
function fioDaConversa(intent: IntentName, anterior: IntentName | null): IntentName | null {
  return intentDefinition(intent).tool ? intent : anterior;
}

/** O que fazer com uma intenção já decidida — sem mais nenhuma dúvida. */
function executar(intent: IntentName, subject: string | null): RouterDecision {
  const definicao = intentDefinition(intent);

  // ⚠️ O ENCAMINHAMENTO VEM DO REGISTRO, e não de um `if` por nome de intenção.
  // Ligar uma segunda intenção ao atendimento humano é uma linha lá, não uma
  // condição aqui — que é o §11.
  if (definicao.handoff) return { kind: "handoff", intent };
  if (definicao.tool) return { kind: "tool", intent, tool: definicao.tool, subject };

  // ⚠️ A FRASE TAMBÉM VEM DO REGISTRO. Isto era
  // `if (intent === "saudacao" || intent === "ajuda")`, e cada intenção nova que
  // respondesse com uma frase acrescentava uma perna àquela escada —
  // `encerramento` seria a terceira. Com o campo no registro, o roteador deixou
  // de ter qualquer `if` por NOME de intenção. É o §11 de verdade.
  return { kind: "message", message: definicao.message ?? "fallback" };
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
    //
    // ⚠️ §46. A RESPOSTA É O MENU, E NÃO "TIVEMOS UM ERRO". Sem interpretação de
    // linguagem, o robô ainda sabe fazer tudo o que fazia — falta só saber o que
    // a pessoa quer. Um menu numerado devolve essa informação por um caminho que
    // não passa pelo modelo, e é o único fallback que funciona quando o modelo é
    // justamente o que caiu.
    //
    // `menuShownAt` é o que autoriza a leitura do número no turno seguinte.
    return {
      decision: { kind: "message", message: "menu" },
      context: {
        ...context,
        menuShownAt: agora.toISOString(),
        expiresAt: expiraEm(agora),
      },
    };
  }

  /* ---------------------------------------------------------------------- */
  /* §46. A escolha de um número do menu                                     */
  /* ---------------------------------------------------------------------- */
  if (turn.kind === "menuChoice") {
    // Sem dúvida a resolver: a pessoa apontou. Executa direto, sem confirmar —
    // pedir confirmação de uma escolha explícita de menu é insultuoso, e o menu
    // só existe porque o caminho normal está indisponível.
    return {
      decision: executar(turn.intent, null),
      context: {
        currentIntent: fioDaConversa(turn.intent, context.currentIntent),
        currentSubject: null,
        pendingIntent: null,
        pendingSubject: null,
        // ⚠️ O MENU SAI DE CENA depois de usado. Mantê-lo aceso faria o próximo
        // número da conversa ("são 2 sacas") virar uma segunda escolha.
        menuShownAt: null,
        expiresAt: expiraEm(agora),
      },
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
        currentIntent: fioDaConversa(intent, context.currentIntent),
        currentSubject: subject,
        pendingIntent: null,
        pendingSubject: null,
        // Houve interpretação: o menu de emergência não está mais em cena.
        menuShownAt: null,
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
        currentIntent: fioDaConversa(intent, context.currentIntent),
        currentSubject: subject ?? context.currentSubject,
        pendingIntent: null,
        pendingSubject: null,
        // O classificador respondeu: o menu de emergência não está mais em cena.
        menuShownAt: null,
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
