import { describe, expect, it } from "vitest";
import { APCS_INTENTS, type IntentAnalysis, type IntentName } from "./intent.types";
import { INTENT_REGISTRY } from "./intent.registry";
import { routeTurn } from "./router";
import {
  CHATBOT_MESSAGES,
  EMPTY_CONTEXT,
  type RouterContext,
  type RouterTurn,
} from "./intelligence.types";

const AGORA = new Date("2026-09-14T12:00:00Z");

function analise(patch: Partial<IntentAnalysis> = {}): RouterTurn {
  return {
    kind: "analysis",
    analysis: { intent: "consultar_bolsa", confidence: 0.95, subject: null, ...patch },
  };
}

function contexto(patch: Partial<RouterContext> = {}): RouterContext {
  return { ...EMPTY_CONTEXT, expiresAt: "2026-09-14T12:20:00Z", ...patch };
}

/**
 * ⚠️ A GARANTIA ESTRUTURAL DO §2, e é a razão de este arquivo existir antes de
 * qualquer outro teste da camada.
 *
 * `decide.test.ts` faz o mesmo para o chat da web: percorre as combinações e
 * afirma que nenhuma produz texto fora do catálogo. Aqui a afirmação é que
 * nenhuma produz texto NENHUM — `RouterDecision` só carrega chave de mensagem
 * configurada, nome de ferramenta e a frase de confirmação que está escrita no
 * registro.
 */
describe("nenhum caminho do roteador inventa texto", () => {
  it("toda combinação de intenção × confiança cai num desfecho conhecido", () => {
    const confiancas = [0, 0.2, 0.44, 0.45, 0.6, 0.74, 0.75, 0.84, 0.85, 1];

    for (const intent of APCS_INTENTS) {
      for (const confidence of confiancas) {
        for (const subject of [null, "Câmara Ambiental"]) {
          const { decision } = routeTurn(
            EMPTY_CONTEXT,
            analise({ intent, confidence, subject }),
            AGORA,
          );

          switch (decision.kind) {
            case "message":
              expect(CHATBOT_MESSAGES).toContain(decision.message);
              break;
            case "confirm":
              // A frase é a do registro, palavra por palavra — não é montada.
              expect(decision.question).toBe(INTENT_REGISTRY[decision.intent].confirmation);
              break;
            case "tool":
              expect(INTENT_REGISTRY[decision.intent].tool).toBe(decision.tool);
              break;
            case "handoff":
              expect(INTENT_REGISTRY[decision.intent].handoff).toBe(true);
              break;
          }
        }
      }
    }
  });

  it("confiança absurda ou NaN nunca executa", () => {
    // O número vem de um modelo. "Não sei ler isto" tem de falhar para o lado
    // que pergunta de novo, nunca para o que age.
    for (const confidence of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const { decision } = routeTurn(EMPTY_CONTEXT, analise({ confidence }), AGORA);
      expect(decision.kind).toBe("message");
    }
  });
});

describe("as três faixas de confiança (§23)", () => {
  it("alta executa a ferramenta", () => {
    const { decision } = routeTurn(EMPTY_CONTEXT, analise({ confidence: 0.8 }), AGORA);
    expect(decision).toEqual({
      kind: "tool",
      intent: "consultar_bolsa",
      tool: "getActiveBolsa",
      subject: null,
    });
  });

  /**
   * ⚠️ O EXEMPLO DO §24, PALAVRA POR PALAVRA. "Quero saber o valor" não pode
   * virar Bolsa automaticamente — pode ser a anuidade, pode ser um evento.
   */
  it("média pergunta antes de fazer", () => {
    const { decision, context } = routeTurn(EMPTY_CONTEXT, analise({ confidence: 0.6 }), AGORA);

    expect(decision).toMatchObject({
      kind: "confirm",
      intent: "consultar_bolsa",
      question: "Você deseja consultar o valor da Bolsa de Suínos?",
    });
    // A pergunta só serve se a resposta encontrar o que foi perguntado.
    expect(context.pendingIntent).toBe("consultar_bolsa");
  });

  it("baixa devolve a frase que lista o que o robô faz", () => {
    const { decision } = routeTurn(EMPTY_CONTEXT, analise({ confidence: 0.3 }), AGORA);
    expect(decision).toEqual({ kind: "message", message: "fallback" });
  });

  /**
   * ⚠️ A REGRA QUE O §23 EXIGE EM TEXTO: "nunca executar uma ação sensível com
   * baixa confiança". Solicitar palestra ABRE uma solicitação que alguém vai ter
   * de despachar, e ela não se desfaz sozinha.
   */
  it("ação sensível exige mais confiança que uma consulta", () => {
    const quaseCerto = { confidence: 0.8 };

    const consulta = routeTurn(EMPTY_CONTEXT, analise({ ...quaseCerto }), AGORA);
    expect(consulta.decision.kind).toBe("tool");

    const sensivel = routeTurn(
      EMPTY_CONTEXT,
      analise({ ...quaseCerto, intent: "solicitar_palestra" }),
      AGORA,
    );
    expect(sensivel.decision.kind).toBe("confirm");

    const acimaDoTeto = routeTurn(
      EMPTY_CONTEXT,
      analise({ confidence: 0.9, intent: "solicitar_palestra" }),
      AGORA,
    );
    expect(acimaDoTeto.decision.kind).toBe("handoff");
  });

  /**
   * ⚠️ SOLICITAR PALESTRA E RESPONDER ENQUETE ENCAMINHAM, e é uma decisão
   * registrada: as duas precisam coletar campos ao longo de vários turnos
   * (nome, cidade, contato; ou a pergunta corrente da enquete), e isso é
   * roteiro — `csp.flow.ts` —, não roteador. As portas do banco já existem e
   * estão esperando o roteiro.
   */
  it("as intenções de ESCRITA chamam uma pessoa em vez de fingir que executam", () => {
    for (const intent of ["solicitar_palestra", "participar_enquete"] as const) {
      expect(INTENT_REGISTRY[intent].tool).toBeNull();
      expect(INTENT_REGISTRY[intent].handoff).toBe(true);

      const { decision } = routeTurn(EMPTY_CONTEXT, analise({ intent, confidence: 0.95 }), AGORA);
      expect(decision).toEqual({ kind: "handoff", intent });
    }
  });

  it("encaminhar para uma pessoa também é sensível", () => {
    const medio = routeTurn(
      EMPTY_CONTEXT,
      analise({ intent: "falar_com_atendente", confidence: 0.8 }),
      AGORA,
    );
    expect(medio.decision.kind).toBe("confirm");

    const alto = routeTurn(
      EMPTY_CONTEXT,
      analise({ intent: "falar_com_atendente", confidence: 0.95 }),
      AGORA,
    );
    expect(alto.decision).toEqual({ kind: "handoff", intent: "falar_com_atendente" });
  });

  it("intenção sem frase de confirmação não é confirmada — cai no fallback", () => {
    // Confirmar exige ter o que perguntar. Executar assim mesmo seria contornar
    // a faixa média em vez de respeitá-la.
    const semPergunta = APCS_INTENTS.filter(
      (i) => INTENT_REGISTRY[i].confirmation === null && INTENT_REGISTRY[i].tool !== null,
    );
    expect(semPergunta).toContain("consultar_conhecimento");

    const { decision } = routeTurn(
      EMPTY_CONTEXT,
      analise({ intent: "consultar_conhecimento", confidence: 0.6 }),
      AGORA,
    );
    expect(decision).toEqual({ kind: "message", message: "fallback" });
  });
});

describe("a confirmação", () => {
  const pendente = contexto({ pendingIntent: "solicitar_palestra", pendingSubject: "Pinhal" });

  it("“sim” executa o que estava pendente", () => {
    const { decision, context } = routeTurn(pendente, { kind: "affirmation", reply: "yes" }, AGORA);

    expect(decision).toEqual({ kind: "handoff", intent: "solicitar_palestra" });
    expect(context.pendingIntent).toBeNull();
  });

  /**
   * ⚠️ UM ENCAMINHAMENTO NÃO VIRA "O ASSUNTO DA CONVERSA". `currentIntent` existe
   * para ser herdada por uma frase sem verbo, e não há o que fazer com um
   * assunto novo aplicado a "chamar uma pessoa". Ver `fioDaConversa`.
   *
   * Na prática o motor zera o contexto inteiro no encaminhamento (§32); esta
   * regra é a mesma conclusão vista do lado do roteador, que é puro e não sabe
   * disso.
   */
  it("confirmar um encaminhamento não vira o fio da conversa", () => {
    const { context } = routeTurn(pendente, { kind: "affirmation", reply: "yes" }, AGORA);
    expect(context.currentIntent).toBeNull();
  });

  it("confirmar uma CONSULTA vira o fio — ela aceita um assunto novo depois", () => {
    const aguardando = contexto({
      pendingIntent: "consultar_normativa",
      pendingSubject: "Câmara Ambiental",
    });
    const { context } = routeTurn(aguardando, { kind: "affirmation", reply: "yes" }, AGORA);

    expect(context.currentIntent).toBe("consultar_normativa");
  });

  it("“sim” a uma consulta executa a ferramenta, com o assunto guardado", () => {
    const aguardando = contexto({
      pendingIntent: "consultar_normativa",
      pendingSubject: "Câmara Ambiental",
    });
    const { decision } = routeTurn(aguardando, { kind: "affirmation", reply: "yes" }, AGORA);

    expect(decision).toEqual({
      kind: "tool",
      intent: "consultar_normativa",
      tool: "getActiveNormativa",
      subject: "Câmara Ambiental",
    });
  });

  /**
   * ⚠️ "NÃO" RECUSA A PERGUNTA, NÃO A CONVERSA. Zerar `currentIntent` aqui faria
   * a frase curta seguinte ("então me manda a outra") perder o fio.
   */
  it("“não” limpa só o pendente", () => {
    const comHistorico = { ...pendente, currentIntent: "consultar_normativa" as IntentName };
    const { decision, context } = routeTurn(
      comHistorico,
      { kind: "affirmation", reply: "no" },
      AGORA,
    );

    expect(decision).toEqual({ kind: "message", message: "fallback" });
    expect(context.pendingIntent).toBeNull();
    expect(context.currentIntent).toBe("consultar_normativa");
  });

  it("“sim” sem pergunta pendente não dispara nada", () => {
    const { decision } = routeTurn(EMPTY_CONTEXT, { kind: "affirmation", reply: "yes" }, AGORA);
    expect(decision).toEqual({ kind: "message", message: "fallback" });
  });
});

/**
 * O §28 — a conversa que continua sem repetir o verbo.
 *
 *   — Quero a normativa da Câmara Ambiental.   → documento
 *   — E a Câmara Setorial?                     → a MESMA intenção, outro assunto
 */
describe("herança de contexto (§28)", () => {
  it("frase sem verbo herda a intenção anterior", () => {
    const anterior = contexto({
      currentIntent: "consultar_normativa",
      currentSubject: "Câmara Ambiental",
    });

    const { decision } = routeTurn(
      anterior,
      analise({ intent: "desconhecido", confidence: 0.3, subject: "Câmara Setorial" }),
      AGORA,
    );

    // ⚠️ CONFIRMA, NÃO EXECUTA. A herança é inferência nossa, não leitura do
    // modelo — tratá-la como certa faria uma frase solta disparar ferramenta.
    expect(decision).toMatchObject({
      kind: "confirm",
      intent: "consultar_normativa",
      subject: "Câmara Setorial",
    });
  });

  it("“não entendi” SEM assunto não herda — senão a conversa entra em laço", () => {
    const anterior = contexto({ currentIntent: "consultar_bolsa", currentSubject: "Suínos" });

    const { decision } = routeTurn(
      anterior,
      analise({ intent: "desconhecido", confidence: 0.9, subject: null }),
      AGORA,
    );

    expect(decision).toEqual({ kind: "message", message: "fallback" });
  });

  it("sem contexto anterior, não há o que herdar", () => {
    const { decision } = routeTurn(
      EMPTY_CONTEXT,
      analise({ intent: "desconhecido", confidence: 0.9, subject: "Câmara Setorial" }),
      AGORA,
    );
    expect(decision).toEqual({ kind: "message", message: "fallback" });
  });
});

/**
 * O §30 — o contexto não pode ser infinito.
 */
describe("expiração do contexto (§30)", () => {
  it("contexto vencido não é herdado nem responde a “sim”", () => {
    const vencido = contexto({
      currentIntent: "consultar_normativa",
      pendingIntent: "solicitar_palestra",
      expiresAt: "2026-09-14T11:59:00Z", // um minuto antes de AGORA
    });

    // Um "sim" de ontem não abre solicitação de palestra hoje.
    const sim = routeTurn(vencido, { kind: "affirmation", reply: "yes" }, AGORA);
    expect(sim.decision).toEqual({ kind: "message", message: "fallback" });

    const heranca = routeTurn(
      vencido,
      analise({ intent: "desconhecido", confidence: 0.3, subject: "Câmara Setorial" }),
      AGORA,
    );
    expect(heranca.decision).toEqual({ kind: "message", message: "fallback" });
  });

  it("todo turno estende o prazo — a pessoa continua na conversa", () => {
    const { context } = routeTurn(EMPTY_CONTEXT, analise(), AGORA);
    expect(context.expiresAt).toBe("2026-09-14T12:30:00.000Z");
  });
});

describe("o classificador fora do ar (§46)", () => {
  /**
   * ⚠️ A RESPOSTA É O MENU, E NÃO "TIVEMOS UM ERRO".
   *
   * Sem interpretação de linguagem o robô ainda sabe fazer tudo o que fazia —
   * falta só descobrir o que a pessoa quer. Um menu numerado obtém essa
   * informação por um caminho que não passa pelo modelo, que é o único tipo de
   * fallback que funciona quando o modelo é justamente o que caiu.
   */
  it("oferece o menu numerado", () => {
    const { decision } = routeTurn(EMPTY_CONTEXT, { kind: "unavailable" }, AGORA);
    expect(decision).toEqual({ kind: "message", message: "menu" });
  });

  it("marca quando o menu foi mostrado — é o que autoriza ler o número depois", () => {
    const { context } = routeTurn(EMPTY_CONTEXT, { kind: "unavailable" }, AGORA);
    expect(context.menuShownAt).toBe(AGORA.toISOString());
  });

  it("PRESERVA a pergunta pendente", () => {
    const pendente = contexto({ pendingIntent: "consultar_bolsa", pendingSubject: null });
    const { context } = routeTurn(pendente, { kind: "unavailable" }, AGORA);

    // Um soluço do modelo não é a pessoa mudando de assunto: apagar o pendente
    // faria o "sim" seguinte cair no vazio.
    expect(context.pendingIntent).toBe("consultar_bolsa");
  });
});

describe("§46. A escolha do menu", () => {
  it("executa direto, sem pedir confirmação", () => {
    // A pessoa apontou. Confirmar uma escolha explícita de menu é insultuoso —
    // e o menu só existe porque o caminho normal está indisponível.
    const { decision } = routeTurn(
      EMPTY_CONTEXT,
      { kind: "menuChoice", intent: "consultar_bolsa" },
      AGORA,
    );

    expect(decision).toEqual({
      kind: "tool",
      intent: "consultar_bolsa",
      tool: "getActiveBolsa",
      subject: null,
    });
  });

  /**
   * ⚠️ SEM ISTO, O PRÓXIMO NÚMERO DA CONVERSA SERIA UMA SEGUNDA ESCOLHA. Alguém
   * que escolhe "1" e depois escreve "2 caminhões" receberia a Normativa.
   */
  it("o menu sai de cena depois de usado", () => {
    const comMenu = contexto({ menuShownAt: AGORA.toISOString() });
    const { context } = routeTurn(
      comMenu,
      { kind: "menuChoice", intent: "consultar_bolsa" },
      AGORA,
    );

    expect(context.menuShownAt).toBeNull();
  });
});

describe("§51. Encerramento", () => {
  /**
   * ⚠️ ELA EXISTE PORQUE O ROBÔ ERA MAL-EDUCADO: sem esta intenção, "obrigado"
   * caía em `desconhecido` e a resposta era "não entendi" — a última coisa que
   * a pessoa lia era uma recusa.
   */
  it("responde com a despedida, e não com o fallback", () => {
    const { decision } = routeTurn(
      EMPTY_CONTEXT,
      analise({ intent: "encerramento", confidence: 0.95 }),
      AGORA,
    );

    expect(decision).toEqual({ kind: "message", message: "closing" });
  });

  /**
   * ⚠️ ENCERRAR NÃO APAGA A MEMÓRIA. Quem diz "obrigado" e trinta segundos
   * depois escreve "ah, e a Setorial?" perderia o fio — e o "obrigado" viraria
   * uma armadilha.
   */
  it("não zera o contexto da conversa", () => {
    const comFio = contexto({
      currentIntent: "consultar_normativa",
      currentSubject: "Câmara Ambiental",
    });
    const { context } = routeTurn(
      comFio,
      analise({ intent: "encerramento", confidence: 0.95 }),
      AGORA,
    );

    expect(context.currentIntent).toBe("consultar_normativa");
  });
});

describe("saudação e ajuda", () => {
  it("as duas respondem com a mensagem de boas-vindas", () => {
    // Ela É, por construção, a lista do que o robô sabe fazer. Um texto de ajuda
    // separado seria uma segunda cópia da mesma lista — e a segunda é a que
    // envelhece quando um módulo novo é ligado.
    for (const intent of ["saudacao", "ajuda"] as const) {
      const { decision } = routeTurn(EMPTY_CONTEXT, analise({ intent, confidence: 1 }), AGORA);
      expect(decision).toEqual({ kind: "message", message: "welcome" });
    }
  });
});
