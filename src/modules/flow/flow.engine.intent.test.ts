import { describe, expect, it } from "vitest";
import { advanceFlow } from "./flow.engine";
import {
  readFlowIntent,
  unavailableFlowIntent,
  withFlowIntent,
  withoutFlowIntent,
} from "./flow.intent";
import type { IntentName } from "@/modules/intelligence/intent.types";
import type {
  CompiledFlowNode,
  CompiledFlowTransition,
  FlowDefinition,
  FlowEngineState,
  FlowVariables,
} from "./flow.types";

/**
 * §12, §13 E §16 DO PROMPT 4 — menu e texto livre na mesma pergunta.
 *
 * ============================================================================
 * ⚠️ O QUE ESTE ARQUIVO PROVA, E POR QUE ELE NÃO CHAMA IA NENHUMA
 * ============================================================================
 *
 * O §13 diz que a IA não pode decidir `next_node = X`. Nos testes isso aparece
 * de um jeito muito concreto: **não há mock de modelo aqui**, porque não há
 * nada para mockar. O motor não conhece a IA.
 *
 * A leitura do modelo entra como VARIÁVEL (`withFlowIntent`, exatamente como a
 * camada de runtime a injeta), e quem escolhe o caminho são as transições de
 * condição que o desenho declara. Se algum dia alguém enfiar uma chamada de IA
 * dentro de `flow.engine.ts`, este arquivo para de compilar por falta de
 * dependência — que é a forma de a garantia ser mecânica em vez de prometida.
 *
 * ============================================================================
 * O DESENHO: o menu do §11, com texto livre ligado
 * ============================================================================
 *
 *   MENU ┬── (resposta "2" / "Bolsa")            → BOLSA
 *        ├── sys_intent = consultar_bolsa
 *        │   E sys_intent_band = high            → BOLSA
 *        ├── sys_intent_band = medium            → CONFIRMA   (§15)
 *        ├── sys_intent = sys_ia_indisponivel    → MENU_NUMERADO
 *        └── (nada casou)                        → repete a pergunta
 */

function no(
  parcial: Partial<CompiledFlowNode> & Pick<CompiledFlowNode, "id" | "type">,
): CompiledFlowNode {
  return {
    key: parcial.id.toUpperCase(),
    name: parcial.id,
    isStart: false,
    configuration: {},
    position: { x: 0, y: 0 },
    metadata: {},
    ...parcial,
  };
}

function seta(
  parcial: Partial<CompiledFlowTransition> &
    Pick<CompiledFlowTransition, "id" | "sourceNodeId" | "targetNodeId">,
): CompiledFlowTransition {
  return { condition: { type: "always" }, label: null, priority: 0, ...parcial };
}

const MENU_OPTIONS = [
  { key: "EVENTOS", label: "Eventos" },
  { key: "BOLSA_SUINOS", label: "Bolsa de Suínos" },
  { key: "ATENDENTE", label: "Falar com um atendente" },
];

function desenho(interpretIntent: boolean): FlowDefinition {
  return {
    schema: 1,
    startNodeId: "menu",
    nodes: [
      no({
        id: "menu",
        type: "question",
        key: "MENU",
        isStart: true,
        configuration: {
          text: "Como podemos ajudar?",
          kind: "buttons",
          variable: "assunto",
          maxAttempts: 3,
          options: MENU_OPTIONS,
          interpretIntent,
        },
      }),
      no({ id: "bolsa", type: "message", configuration: { text: "Segue a Bolsa." } }),
      no({
        id: "confirma",
        type: "question",
        configuration: {
          text: "Entendi. Você quer consultar a Bolsa de Suínos?",
          kind: "yes_no",
          variable: "confirmou",
        },
      }),
      no({ id: "menu_numerado", type: "message", configuration: { text: "1 Bolsa\n2 Eventos" } }),
      no({ id: "fim", type: "end", configuration: {} }),
    ],
    transitions: [
      /* A escolha explícita do menu. Prioridade 0: ela vem antes de tudo. */
      seta({
        id: "t_opcao",
        sourceNodeId: "menu",
        targetNodeId: "bolsa",
        priority: 0,
        condition: { type: "answer", optionKey: "BOLSA_SUINOS" },
      }),

      /**
       * §13 e §14. A INTENÇÃO COM CONFIANÇA ALTA.
       *
       * ⚠️ SÃO DUAS CONDIÇÕES EM DUAS SETAS, e não uma só: o motor avalia UMA
       * condição por seta. A da faixa vem depois, com prioridade maior, e a
       * ordem é o que faz "alta" ganhar de "média" — ver `resolveTransition`.
       */
      seta({
        id: "t_intent_alta",
        sourceNodeId: "menu",
        targetNodeId: "bolsa",
        priority: 1,
        condition: {
          type: "variable",
          name: "sys_intent_band",
          operator: "eq",
          value: "high",
        },
      }),

      /* §15. A faixa do meio pergunta antes de agir. */
      seta({
        id: "t_intent_media",
        sourceNodeId: "menu",
        targetNodeId: "confirma",
        priority: 2,
        condition: {
          type: "variable",
          name: "sys_intent_band",
          operator: "eq",
          value: "medium",
        },
      }),

      /* §46 do módulo de inteligência: sem IA, o menu numerado. */
      seta({
        id: "t_sem_ia",
        sourceNodeId: "menu",
        targetNodeId: "menu_numerado",
        priority: 3,
        condition: {
          type: "variable",
          name: "sys_intent",
          operator: "eq",
          value: "sys_ia_indisponivel",
        },
      }),

      seta({ id: "t_bolsa_fim", sourceNodeId: "bolsa", targetNodeId: "fim" }),
      seta({ id: "t_menu_fim", sourceNodeId: "menu_numerado", targetNodeId: "fim" }),
      seta({ id: "t_confirma_fim", sourceNodeId: "confirma", targetNodeId: "fim" }),
    ],
  };
}

const COM_TEXTO_LIVRE = desenho(true);
const SO_MENU = desenho(false);

const LIMITES = { high: 0.9, medium: 0.7 };

/** Parado no menu, esperando resposta — como o runtime carregaria do banco. */
function esperandoNoMenu(variables: FlowVariables = {}): FlowEngineState {
  return {
    currentNodeId: "menu",
    variables,
    status: "waiting_reply",
    conversationStatus: "triage",
    assignedTeamKey: null,
    attemptCount: 0,
    nodeExecutions: 0,
  };
}

/**
 * O que o `runtime.ts` faz antes de chamar o motor: lê a frase, grava a leitura
 * como variável, e SÓ ENTÃO deixa o motor decidir. A ordem é o §13.
 */
function comLeituraDaIA(
  confidence: number,
  intent: IntentName = "consultar_bolsa",
): FlowEngineState {
  return esperandoNoMenu(
    withFlowIntent({}, readFlowIntent({ intent, confidence, subject: null }, LIMITES)),
  );
}

/* -------------------------------------------------------------------------- */
/* §16 — o menu continua funcionando, e vem primeiro                          */
/* -------------------------------------------------------------------------- */

describe("§16 — a alternativa é lida primeiro, sempre", () => {
  /**
   * ⚠️ ESTE É O TESTE QUE PROTEGE O FLUXO CONTRA A QUEDA DA IA. Quem digita o
   * número sai pela alternativa, e nenhuma leitura de intenção participa da
   * decisão — nem quando há uma gravada no contexto.
   */
  it("o número escolhe a opção mesmo com texto livre ligado", () => {
    const resultado = advanceFlow(COM_TEXTO_LIVRE, esperandoNoMenu(), {
      kind: "reply",
      text: "2",
    });

    expect(resultado.state.currentNodeId).toBe("fim");
    expect(resultado.state.variables["assunto"]).toBe("BOLSA_SUINOS");
    expect(resultado.effects.some((e) => e.kind === "sendMessage")).toBe(true);
  });

  /**
   * ============================================================================
   * ⚠️ ESTE TESTE ENCONTROU UM DEFEITO DE VERDADE, E É POR ISSO QUE ELE EXISTE.
   * ============================================================================
   *
   * Escrito primeiro como "a alternativa ganha de uma leitura contraditória", ele
   * falhou — e a falha estava CERTA. O motor casava a seta de variável com um
   * `sys_intent_band=high` que sobrara de um turno anterior:
   *
   *   turno 1  "quero saber o valor do suíno" → IA lê Bolsa, confiança 0,99
   *   turno 2  a pessoa digita "3" (Falar com um atendente)
   *            → `matchOption` casa ATENDENTE, mas não há seta `answer` para
   *              ele; o motor desce para as setas de variável, e a leitura
   *              VELHA ainda estava lá → ela recebia a Bolsa.
   *
   * A correção não foi no motor: foi `withoutFlowIntent`, chamado pelo runtime
   * no início de todo turno. A leitura vale por UM turno, como a chave da
   * resposta já valia.
   *
   * Este teste guarda os dois lados: com leitura fresca a seta casa (é o teste
   * de confiança alta, mais abaixo); com leitura velha — que é o que o runtime
   * apaga — ela não deve existir para casar.
   */
  it("uma leitura já apagada pelo runtime não sequestra a escolha da pessoa", () => {
    // Exatamente o que `comVariaveisDoSistema` entrega ao motor no turno 2:
    // a leitura anterior apagada, porque "3" casou com uma alternativa e
    // nenhuma classificação nova foi pedida.
    const estado = esperandoNoMenu(withoutFlowIntent(comLeituraDaIA(0.99).variables));

    expect(estado.variables["sys_intent_band"]).toBeUndefined();

    const resultado = advanceFlow(COM_TEXTO_LIVRE, estado, { kind: "reply", text: "3" });

    expect(resultado.state.variables["assunto"]).toBe("ATENDENTE");

    /**
     * ⚠️ E O DESFECHO É UMA FALHA BARULHENTA, que é justamente o ponto.
     *
     * Este desenho não tem seta para ATENDENTE — é um desenho incompleto, e a
     * publicação o recusaria (`flow.rules.ts`). Com a leitura velha viva, o
     * buraco ficava ESCONDIDO: a seta de intenção casava e a pessoa recebia a
     * Bolsa, com o fluxo parecendo funcionar.
     *
     * Sem ela, o motor diz `no_matching_transition` — o desenho se denuncia em
     * vez de atender errado. Um defeito visível vale mais que um atendimento
     * que parece certo.
     */
    expect(resultado.state.currentNodeId).toBe("menu");
    const falha = resultado.effects.find((e) => e.kind === "fail");
    expect(falha?.kind === "fail" && falha.reason).toBe("no_matching_transition");
  });
});

/* -------------------------------------------------------------------------- */
/* §12, §13 — o texto livre vira variável, e o desenho decide                  */
/* -------------------------------------------------------------------------- */

describe("§13 — a IA interpreta, o desenho decide", () => {
  it("confiança alta segue a seta de alta", () => {
    const estado = comLeituraDaIA(0.96);
    const resultado = advanceFlow(COM_TEXTO_LIVRE, estado, {
      kind: "reply",
      text: "quero saber o valor do suíno hoje",
    });

    expect(resultado.state.currentNodeId).toBe("fim");
    expect(resultado.effects.some((e) => e.kind === "sendMessage")).toBe(true);
  });

  /** §15. A faixa do meio pergunta antes de agir — e a pergunta é um NÓ. */
  it("confiança média cai na confirmação desenhada", () => {
    const estado = comLeituraDaIA(0.82);
    const resultado = advanceFlow(COM_TEXTO_LIVRE, estado, {
      kind: "reply",
      text: "queria saber alguma coisa sobre eventos",
    });

    expect(resultado.state.currentNodeId).toBe("confirma");
    expect(resultado.effects.some((e) => e.kind === "askQuestion")).toBe(true);
  });

  /**
   * §45. CONFIANÇA BAIXA NÃO ESCOLHE NADA. Nenhuma seta casa, e o motor faz o
   * que sempre fez com uma resposta que não serve: repete a pergunta.
   */
  it("confiança baixa repete a pergunta", () => {
    const estado = comLeituraDaIA(0.4);
    const resultado = advanceFlow(COM_TEXTO_LIVRE, estado, {
      kind: "reply",
      text: "sei lá, qualquer coisa",
    });

    expect(resultado.state.currentNodeId).toBe("menu");
    expect(resultado.state.attemptCount).toBe(1);
    expect(resultado.effects.some((e) => e.kind === "repeatQuestion")).toBe(true);
  });

  /**
   * §46 do módulo de inteligência. "NÃO CONSEGUI LER" TEM CAMINHO PRÓPRIO, e é
   * por isso que ele não é `desconhecido`: o desenho manda quem caiu na falha da
   * IA para um menu numerado, que funciona sem modelo nenhum.
   */
  it("a IA fora do ar segue para o menu numerado", () => {
    const estado = esperandoNoMenu(withFlowIntent({}, unavailableFlowIntent()));
    const resultado = advanceFlow(COM_TEXTO_LIVRE, estado, {
      kind: "reply",
      text: "quero saber o valor do suíno",
    });

    expect(resultado.state.currentNodeId).toBe("fim");
    const mensagem = resultado.effects.find((e) => e.kind === "sendMessage");
    expect(mensagem?.kind === "sendMessage" && mensagem.text).toContain("1 Bolsa");
  });
});

/* -------------------------------------------------------------------------- */
/* A garantia: sem a marcação, nada disso acontece                            */
/* -------------------------------------------------------------------------- */

describe("interpretIntent desligado", () => {
  /**
   * ⚠️ ESTE TESTE É O QUE TORNA A MUDANÇA SEGURA PARA OS FLUXOS QUE JÁ EXISTEM.
   *
   * Todo fluxo publicado antes do Prompt 4 tem `interpretIntent` ausente, que o
   * schema lê como `false`. Com o mesmo estado e a mesma frase do teste de
   * confiança alta acima, o resultado tem de ser o de sempre: repete a pergunta.
   *
   * Se este teste começar a falhar, alguém tornou o comportamento novo o padrão
   * — e todo menu numerado da APCS passou a pagar uma chamada de modelo por
   * resposta errada, sem ninguém ter pedido.
   */
  it("ignora a leitura de intenção e repete a pergunta", () => {
    const estado = comLeituraDaIA(0.99);
    const resultado = advanceFlow(SO_MENU, estado, {
      kind: "reply",
      text: "quero saber o valor do suíno hoje",
    });

    expect(resultado.state.currentNodeId).toBe("menu");
    expect(resultado.effects.some((e) => e.kind === "repeatQuestion")).toBe(true);
  });

  it("continua atendendo a escolha do menu", () => {
    const resultado = advanceFlow(SO_MENU, esperandoNoMenu(), { kind: "reply", text: "2" });
    expect(resultado.state.variables["assunto"]).toBe("BOLSA_SUINOS");
  });
});

/* -------------------------------------------------------------------------- */
/* O que o texto livre NÃO faz                                                */
/* -------------------------------------------------------------------------- */

describe("a frase não vira a resposta da pergunta", () => {
  /**
   * ⚠️ A VARIÁVEL DO NÓ FICA VAZIA NO CAMINHO DA INTENÇÃO, e é deliberado.
   *
   * Gravar "quero saber o valor do suíno hoje" em `assunto` faria uma condição
   * adiante comparar essa frase com a chave `BOLSA_SUINOS` e não casar — o
   * fluxo pegaria um caminho errado sem nada falhar. O que a pessoa escreveu
   * está em `sys_intent_subject`, que é onde ele é utilizável.
   */
  it("mantém a variável do nó livre de texto solto", () => {
    const estado = comLeituraDaIA(0.96);
    const resultado = advanceFlow(COM_TEXTO_LIVRE, estado, {
      kind: "reply",
      text: "quero saber o valor do suíno hoje",
    });

    expect(resultado.state.variables["assunto"]).toBeUndefined();
    expect(resultado.state.variables["sys_intent"]).toBe("consultar_bolsa");
  });

  /** Texto vazio não é resposta nenhuma — nem com interpretação ligada. */
  it("não interpreta uma resposta vazia", () => {
    const resultado = advanceFlow(COM_TEXTO_LIVRE, esperandoNoMenu(), {
      kind: "reply",
      text: "   ",
    });

    expect(resultado.state.currentNodeId).toBe("menu");
    expect(resultado.effects.some((e) => e.kind === "repeatQuestion")).toBe(true);
  });
});
