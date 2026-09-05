import { describe, expect, it } from "vitest";
import {
  FLOW_INTENT_UNAVAILABLE,
  FLOW_INTENT_VARIABLES,
  FLOW_SYSTEM_VARIABLE_PREFIX,
  flowIntentVariables,
  readFlowIntent,
  unavailableFlowIntent,
  withFlowIntent,
} from "./flow.intent";
import {
  CONFIDENCE_HIGH,
  CONFIDENCE_HIGH_SENSITIVE,
  CONFIDENCE_MEDIUM,
  confidenceBand,
} from "@/modules/intelligence/intent.types";
import type { IntentAnalysis } from "@/modules/intelligence/intent.types";

const LIMITES = { high: 0.9, medium: 0.7 };

function analise(confidence: number, extra: Partial<IntentAnalysis> = {}): IntentAnalysis {
  return { intent: "consultar_bolsa", confidence, subject: null, ...extra };
}

/* -------------------------------------------------------------------------- */
/* §14 — os limites configuráveis, sem duplicar a regra                       */
/* -------------------------------------------------------------------------- */

describe("confidenceBand com limites configurados", () => {
  /**
   * ⚠️ ESTE É O TESTE QUE GUARDA A DECISÃO DE NÃO DUPLICAR. `confidenceBand`
   * ganhou um parâmetro opcional em vez de o módulo de fluxos ganhar uma segunda
   * função com os mesmos três `if`. Se alguém escrever a segunda, este teste
   * continua passando — mas o de baixo, o do comportamento intacto, é o que
   * denuncia se o parâmetro mudar o caminho de quem não o passa.
   */
  it("usa os limites recebidos", () => {
    expect(confidenceBand(0.95, false, LIMITES)).toBe("high");
    expect(confidenceBand(0.9, false, LIMITES)).toBe("high");
    expect(confidenceBand(0.89, false, LIMITES)).toBe("medium");
    expect(confidenceBand(0.7, false, LIMITES)).toBe("medium");
    expect(confidenceBand(0.69, false, LIMITES)).toBe("low");
  });

  it("mantém intacto o comportamento de quem não passa limites", () => {
    expect(confidenceBand(CONFIDENCE_HIGH, false)).toBe("high");
    expect(confidenceBand(CONFIDENCE_HIGH - 0.01, false)).toBe("medium");
    expect(confidenceBand(CONFIDENCE_MEDIUM, false)).toBe("medium");
    expect(confidenceBand(CONFIDENCE_MEDIUM - 0.01, false)).toBe("low");
    expect(confidenceBand(CONFIDENCE_HIGH_SENSITIVE - 0.01, true)).toBe("medium");
  });

  /**
   * ⚠️ A BARRA SENSÍVEL SOBREVIVE AO LIMITE CONFIGURADO, e é o que impede o
   * campo de virar porta dos fundos: quem baixa a "confiança mínima" para 0,60
   * numa tela está pensando em consultar a Bolsa, e não em autorizar
   * solicitações de palestra erradas.
   */
  it("não deixa um limite baixo afrouxar a ação sensível", () => {
    const frouxo = { high: 0.6, medium: 0.3 };
    expect(confidenceBand(0.7, true, frouxo)).toBe("medium");
    expect(confidenceBand(CONFIDENCE_HIGH_SENSITIVE, true, frouxo)).toBe("high");
    // E não sensível continua obedecendo ao limite frouxo.
    expect(confidenceBand(0.7, false, frouxo)).toBe("high");
  });

  it("cai em low quando a confiança não é um número", () => {
    expect(confidenceBand(Number.NaN, false, LIMITES)).toBe("low");
    expect(confidenceBand(Number.POSITIVE_INFINITY, false, LIMITES)).toBe("low");
  });
});

/* -------------------------------------------------------------------------- */
/* §13 — a IA vira variável, e nunca caminho                                  */
/* -------------------------------------------------------------------------- */

describe("readFlowIntent", () => {
  it("traduz a análise para o vocabulário do fluxo", () => {
    const leitura = readFlowIntent(analise(0.96, { subject: "Câmara Ambiental" }), LIMITES);

    expect(leitura).toEqual({
      intent: "consultar_bolsa",
      confidence: 0.96,
      band: "high",
      subject: "Câmara Ambiental",
    });
  });

  /**
   * ⚠️ `sensitive: false` SEMPRE, e o teste registra o porquê: aqui a
   * classificação não EXECUTA nada — ela grava uma variável. Quem transforma
   * isso numa solicitação de palestra é uma seta que alguém desenhou, e a
   * proteção contra ação sensível neste caminho é o DESENHO (a pergunta de
   * confirmação do §15), não a barra.
   */
  it("não aplica a barra sensível — quem protege aqui é o desenho", () => {
    const leitura = readFlowIntent(analise(0.91, { intent: "solicitar_palestra" }), LIMITES);
    expect(leitura.band).toBe("high");
  });
});

describe("unavailableFlowIntent", () => {
  /**
   * ⚠️ "NÃO CONSEGUI LER" É DIFERENTE DE "NÃO ENTENDI", e a distinção paga por
   * si: repetir "não entendi" quando o modelo caiu culpa a pessoa por uma falha
   * nossa. Com os dois separados, o desenhador manda um para o menu numerado
   * (que funciona sem IA) e o outro para "tente escrever de outro jeito".
   */
  it("não se confunde com desconhecido", () => {
    expect(unavailableFlowIntent().intent).toBe(FLOW_INTENT_UNAVAILABLE);
    expect(unavailableFlowIntent().intent).not.toBe("desconhecido");
  });

  it("nunca chega em high", () => {
    expect(unavailableFlowIntent().band).toBe("low");
    expect(unavailableFlowIntent().confidence).toBe(0);
  });
});

describe("flowIntentVariables", () => {
  it("produz as quatro variáveis do sistema", () => {
    expect(flowIntentVariables(readFlowIntent(analise(0.82), LIMITES))).toEqual({
      sys_intent: "consultar_bolsa",
      sys_intent_confidence: "0.82",
      sys_intent_band: "medium",
      sys_intent_subject: "",
    });
  });

  /**
   * ⚠️ PONTO DECIMAL, E NUNCA VÍRGULA. Os operadores numéricos do motor
   * (`gt`, `gte`, `lt`, `lte`) fazem `Number(...)` do texto, e "0,82" vira
   * `NaN` — a condição não casaria e o fluxo pegaria outro caminho, sem nada
   * falhar. É a razão de esta variável escapar do PT-BR do resto da interface.
   */
  it.each([0.9, 0.82, 0.5, 0.07, 1])(
    "formata %s de um jeito que os operadores numéricos leem",
    (confianca) => {
      const variaveis = flowIntentVariables(readFlowIntent(analise(confianca), LIMITES));
      const cru = variaveis[FLOW_INTENT_VARIABLES.confidence] ?? "";

      expect(cru).not.toContain(",");
      expect(Number.isNaN(Number(cru))).toBe(false);
      // Duas casas: o suficiente para comparar, e nada além disso na trilha.
      expect(Number(cru)).toBeCloseTo(confianca, 2);
    },
  );

  /**
   * ⚠️ O ASSUNTO AUSENTE VIRA STRING VAZIA, E NÃO SOME. Variável ausente não
   * casa com operador nenhum — nem com `neq` — então o desenhador não
   * conseguiria perguntar "veio assunto?". Gravando vazio, `exists` responde.
   */
  it("grava o assunto ausente como vazio, em vez de omiti-lo", () => {
    const variaveis = flowIntentVariables(unavailableFlowIntent());
    expect(FLOW_INTENT_VARIABLES.subject in variaveis).toBe(true);
    expect(variaveis[FLOW_INTENT_VARIABLES.subject]).toBe("");
  });

  it("marca tudo com o prefixo do motor", () => {
    for (const nome of Object.values(FLOW_INTENT_VARIABLES)) {
      expect(nome.startsWith(FLOW_SYSTEM_VARIABLE_PREFIX)).toBe(true);
    }
  });
});

describe("withFlowIntent", () => {
  it("preserva o que o fluxo já tinha coletado", () => {
    const antes = { cidade: "Piracicaba", assunto: "financeiro" };
    const depois = withFlowIntent(antes, readFlowIntent(analise(0.95), LIMITES));

    expect(depois["cidade"]).toBe("Piracicaba");
    expect(depois["assunto"]).toBe("financeiro");
    expect(depois["sys_intent"]).toBe("consultar_bolsa");
  });

  /**
   * ⚠️ O MOTOR TEM A ÚLTIMA PALAVRA SOBRE `sys_`. Nada no schema impede alguém
   * de nomear uma variável `sys_intent` no Builder; o que impede aquilo de
   * envenenar uma condição é a ordem do spread, e é isto que este teste guarda.
   */
  it("sobrescreve uma variável do desenho que invada o prefixo do sistema", () => {
    const invasora = { sys_intent: "consultar_evento", sys_intent_band: "high" };
    const depois = withFlowIntent(invasora, unavailableFlowIntent());

    expect(depois["sys_intent"]).toBe(FLOW_INTENT_UNAVAILABLE);
    expect(depois["sys_intent_band"]).toBe("low");
  });
});
