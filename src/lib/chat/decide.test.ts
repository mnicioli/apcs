import { describe, expect, it } from "vitest";
import { decideTurn, openingDecision, type ConversationState, type TurnInput } from "./decide";
import { CSP_CONTENT } from "@/modules/chat/flows/csp.content";
import { CHAT_INTENTS, type ChatIntent, type CspCollected } from "@/modules/chat/chat.types";

/**
 * O motor decide QUAL mensagem aprovada enviar. Os testes abaixo cobrem as
 * garantias que sustentam o fluxo:
 *   1. nada é coletado antes do consentimento (LGPD), e a revogação é atendida;
 *   2. a triagem avança na ordem certa e fecha gerando lead;
 *   3. um tropeço do LLM não deixa a pessoa sem saída;
 *   4. nenhuma decisão consegue produzir texto fora do catálogo aprovado.
 */

const TRIAGE_DONE: CspCollected = {
  fullName: "João da Silva",
  city: "Piracicaba",
  state: "SP",
  contactProfile: "producer",
  interest: "feed",
  volumeRange: "from_200_to_1000",
  preferredChannel: "whatsapp",
  phone: "19999991234",
  preferredTime: "morning",
};

function state(overrides: Partial<ConversationState> = {}): ConversationState {
  return { status: "active", consentGiven: true, collected: {}, ...overrides };
}

function answering(slots: CspCollected = {}): TurnInput {
  return { kind: "analysis", analysis: { intent: "answering", slots } };
}

function intent(value: ChatIntent, slots: CspCollected = {}): TurnInput {
  return { kind: "analysis", analysis: { intent: value, slots } };
}

describe("abertura", () => {
  it("apresenta o bot e pede consentimento antes de qualquer pergunta", () => {
    const decision = openingDecision();
    expect(decision.contentKeys).toEqual(["welcome", "consentRequest"]);
    expect(decision.options.map((o) => o.value)).toEqual(["accept", "decline"]);
  });
});

describe("gate de consentimento (LGPD)", () => {
  const noConsent = state({ consentGiven: false });

  it("resposta ininteligível repete o pedido e mantém os botões", () => {
    const decision = decideTurn(noConsent, { kind: "consent", reply: "unclear" });

    expect(decision.contentKeys).toEqual(["consentReminder"]);
    expect(decision.consentGiven).toBe(false);
    expect(decision.options.map((o) => o.value)).toEqual(["accept", "decline"]);
  });

  it("não registra dado nenhum enquanto o consentimento não vier", () => {
    // Mesmo que uma análise chegue aqui por engano, os slots são ignorados.
    const decision = decideTurn(noConsent, answering({ fullName: "João da Silva" }));

    expect(decision.collected).toEqual({});
    expect(decision.consentGiven).toBe(false);
    expect(decision.contentKeys).toEqual(["consentReminder"]);
  });

  it("encerra a conversa quando a pessoa recusa", () => {
    const decision = decideTurn(noConsent, { kind: "consent", reply: "decline" });

    expect(decision.status).toBe("declined");
    expect(decision.contentKeys).toEqual(["consentDeclined"]);
    expect(decision.collected).toEqual({});
    expect(decision.options).toEqual([]);
  });

  it("ao aceitar, explica o CSP e faz a primeira pergunta", () => {
    const decision = decideTurn(noConsent, { kind: "consent", reply: "accept" });

    expect(decision.consentGiven).toBe(true);
    expect(decision.contentKeys).toEqual(["cspIntro", "askFullName"]);
  });

  it("atende a revogação depois do consentimento já dado", () => {
    const decision = decideTurn(state({ collected: { fullName: "João" } }), {
      kind: "consent",
      reply: "decline",
    });

    expect(decision.status).toBe("declined");
    expect(decision.contentKeys).toEqual(["consentDeclined"]);
  });

  it("atende a revogação vinda por texto livre (classificada pelo LLM)", () => {
    const decision = decideTurn(
      state({ collected: { fullName: "João" } }),
      intent("consent_decline"),
    );

    expect(decision.status).toBe("declined");
    expect(decision.contentKeys).toEqual(["consentDeclined"]);
  });
});

describe("avanço da triagem", () => {
  it("pergunta o próximo campo em branco", () => {
    const decision = decideTurn(state({ collected: { fullName: "João" } }), answering());
    expect(decision.contentKeys).toEqual(["askLocation"]);
  });

  it("registra o que foi extraído e segue para a pergunta seguinte", () => {
    const decision = decideTurn(
      state({ collected: { fullName: "João" } }),
      answering({ city: "Piracicaba", state: "SP" }),
    );

    expect(decision.collected).toMatchObject({ city: "Piracicaba", state: "SP" });
    expect(decision.contentKeys).toEqual(["askContactProfile"]);
    expect(decision.options.map((o) => o.value)).toEqual(["producer", "member", "supplier"]);
  });

  it("não pergunta porte de granja para fornecedor", () => {
    const decision = decideTurn(
      state({ collected: { fullName: "Ana", city: "Campinas", state: "SP" } }),
      answering({ contactProfile: "supplier", interest: "logistics" }),
    );

    expect(decision.collected.volumeRange).toBe("not_applicable");
    expect(decision.contentKeys).toEqual(["askContactChannel"]);
  });

  it("fecha a triagem e manda gerar o lead", () => {
    const { preferredTime: _omit, ...almostDone } = TRIAGE_DONE;
    const decision = decideTurn(
      state({ collected: almostDone }),
      answering({ preferredTime: "morning" }),
    );

    expect(decision.createLead).toBe(true);
    expect(decision.status).toBe("completed");
    expect(decision.contentKeys).toEqual(["completed"]);
  });
});

describe("limites do bot", () => {
  it("recusa o que está fora do conteúdo aprovado e retoma a triagem", () => {
    const decision = decideTurn(state({ collected: { fullName: "João" } }), intent("out_of_scope"));
    expect(decision.contentKeys).toEqual(["outOfScope", "askLocation"]);
  });

  it("marca pedido de atendimento humano e fecha como handoff", () => {
    const { preferredTime: _omit, ...almostDone } = TRIAGE_DONE;
    const decision = decideTurn(
      state({ collected: almostDone }),
      intent("wants_human", { preferredTime: "any" }),
    );

    expect(decision.collected.wantsHuman).toBe(true);
    expect(decision.status).toBe("handoff");
    expect(decision.contentKeys).toEqual(["handoffCompleted"]);
    expect(decision.createLead).toBe(true);
  });

  it("responde indisponibilidade quando o LLM falha, sem mexer no estado", () => {
    const before = state({ collected: { fullName: "João" } });
    const decision = decideTurn(before, { kind: "unavailable" });

    expect(decision.contentKeys).toEqual(["unavailable"]);
    expect(decision.collected).toEqual(before.collected);
    expect(decision.status).toBe("active");
    expect(decision.createLead).toBe(false);
  });

  it("falha do LLM não apaga os botões de consentimento", () => {
    const decision = decideTurn(state({ consentGiven: false }), { kind: "unavailable" });

    expect(decision.contentKeys).toEqual(["unavailable"]);
    expect(decision.options.map((o) => o.value)).toEqual(["accept", "decline"]);
  });

  it("falha do LLM devolve as opções da pergunta pendente", () => {
    const decision = decideTurn(
      state({ collected: { fullName: "João", city: "Piracicaba", state: "SP" } }),
      { kind: "unavailable" },
    );

    expect(decision.options.map((o) => o.value)).toEqual(["producer", "member", "supplier"]);
  });

  it("não reabre conversa encerrada", () => {
    const decision = decideTurn(
      state({ status: "completed", collected: TRIAGE_DONE }),
      answering({ fullName: "Outra Pessoa" }),
    );

    expect(decision.contentKeys).toEqual(["conversationClosed"]);
    expect(decision.collected.fullName).toBe(TRIAGE_DONE.fullName);
    expect(decision.options).toEqual([]);
  });
});

describe("guardrail: só sai texto aprovado", () => {
  const scenarios: ConversationState[] = [
    state({ consentGiven: false }),
    state(),
    state({ collected: { fullName: "João" } }),
    state({ collected: TRIAGE_DONE }),
    state({ status: "handoff", collected: TRIAGE_DONE }),
  ];

  it("toda combinação de estado e turno só produz chaves do catálogo", () => {
    const turns: TurnInput[] = [
      { kind: "unavailable" },
      { kind: "consent", reply: "accept" },
      { kind: "consent", reply: "decline" },
      { kind: "consent", reply: "unclear" },
      ...CHAT_INTENTS.map((value) => intent(value)),
    ];

    for (const scenario of scenarios) {
      for (const turn of turns) {
        const decision = decideTurn(scenario, turn);
        expect(decision.contentKeys.length).toBeGreaterThan(0);
        for (const key of decision.contentKeys) {
          expect(CSP_CONTENT).toHaveProperty(key);
        }
      }
    }
  });
});
