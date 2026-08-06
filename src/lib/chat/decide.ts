import type {
  ChatConversationStatus,
  ChatOption,
  ChatTurnAnalysis,
  CspCollected,
} from "@/modules/chat/chat.types";
import type { CspContentKey } from "@/modules/chat/flows/csp.content";
import { applyCspDefaults, mergeCollected, nextCspSlot } from "@/modules/chat/flows/csp.flow";
import { CONSENT_OPTIONS, type ConsentReply } from "@/lib/chat/consent";

/**
 * O CÉREBRO DA CONVERSA — e ele é de propósito burro e determinístico.
 *
 * Recebe o estado da conversa + o que aconteceu no turno, e devolve quais
 * mensagens APROVADAS enviar. Não tem I/O, não chama LLM, não toca no banco:
 * dá para testar cada regra isoladamente.
 *
 * A regra que sustenta tudo: `contentKeys` só pode conter chaves do catálogo
 * (`CspContentKey`). Não existe caminho em que texto gerado por IA chegue ao
 * usuário.
 */

export interface ConversationState {
  status: ChatConversationStatus;
  consentGiven: boolean;
  collected: CspCollected;
}

/**
 * O que chegou neste turno. Note que o gate de consentimento tem um tipo
 * próprio: antes do aceite o LLM nem é chamado (ver `consent.ts`).
 */
export type TurnInput =
  | { kind: "consent"; reply: ConsentReply }
  | { kind: "analysis"; analysis: ChatTurnAnalysis }
  /** LLM falhou, recusou ou devolveu lixo. */
  | { kind: "unavailable" };

export interface TurnDecision {
  /** Mensagens aprovadas a enviar, na ordem. */
  contentKeys: CspContentKey[];
  /** Estado da triagem depois deste turno. */
  collected: CspCollected;
  consentGiven: boolean;
  status: ChatConversationStatus;
  /** Opções clicáveis da pergunta atual. */
  options: ChatOption[];
  /** Triagem fechou — hora de gerar o lead. */
  createLead: boolean;
}

/**
 * Opções da pergunta que continua pendente. Todo caminho que NÃO avança a
 * conversa (erro, rate limit, resposta ininteligível) precisa reoferecê-las —
 * senão um tropeço do LLM apaga os botões de consentimento para sempre.
 */
export function pendingOptions(state: ConversationState): ChatOption[] {
  if (state.status !== "active") return [];
  if (!state.consentGiven) return CONSENT_OPTIONS;
  const slot = nextCspSlot(state.collected);
  return slot?.options?.(state.collected) ?? [];
}

/** Primeira interação: apresentação + pedido de consentimento. */
export function openingDecision(): TurnDecision {
  return {
    contentKeys: ["welcome", "consentRequest"],
    collected: {},
    consentGiven: false,
    status: "active",
    options: CONSENT_OPTIONS,
    createLead: false,
  };
}

/**
 * Avança a triagem: acrescenta a próxima pergunta (ou o fechamento) depois das
 * mensagens de contexto que já foram decididas.
 */
function withNextQuestion(
  partial: Omit<TurnDecision, "contentKeys" | "options" | "createLead">,
  prefix: CspContentKey[],
): TurnDecision {
  const slot = nextCspSlot(partial.collected);

  if (!slot) {
    const wantsHuman = partial.collected.wantsHuman === true;
    return {
      ...partial,
      // `handoff` vira redundante quando o fechamento já é o de encaminhamento.
      contentKeys: [
        ...prefix.filter((key) => key !== "handoff"),
        wantsHuman ? "handoffCompleted" : "completed",
      ],
      status: wantsHuman ? "handoff" : "completed",
      options: [],
      createLead: true,
    };
  }

  return {
    ...partial,
    contentKeys: [...prefix, slot.askKey],
    options: slot.options?.(partial.collected) ?? [],
    createLead: false,
  };
}

export function decideTurn(state: ConversationState, turn: TurnInput): TurnDecision {
  const unchanged = {
    collected: state.collected,
    consentGiven: state.consentGiven,
    status: state.status,
    options: pendingOptions(state),
    createLead: false,
  };

  if (state.status !== "active") {
    return { ...unchanged, options: [], contentKeys: ["conversationClosed"] };
  }

  if (turn.kind === "unavailable") {
    return { ...unchanged, contentKeys: ["unavailable"] };
  }

  // ---------------------------------------------------------------------------
  // Antes do consentimento (LGPD): decidido sem LLM, e NADA é registrado — nem
  // os dados de triagem, nem o texto cru da mensagem (ver `engine.ts`).
  // ---------------------------------------------------------------------------
  if (!state.consentGiven) {
    const reply = turn.kind === "consent" ? turn.reply : "unclear";

    switch (reply) {
      case "accept":
        return withNextQuestion(
          { collected: state.collected, consentGiven: true, status: "active" },
          ["cspIntro"],
        );
      case "decline":
        return {
          ...unchanged,
          status: "declined",
          options: [],
          contentKeys: ["consentDeclined"],
        };
      default:
        return { ...unchanged, contentKeys: ["consentReminder"] };
    }
  }

  // ---------------------------------------------------------------------------
  // Com consentimento: registra o que foi extraído e segue a triagem.
  // ---------------------------------------------------------------------------
  if (turn.kind === "consent") {
    // Clique/`sim`/`não` fora do gate. Recusa aqui é REVOGAÇÃO — respeitar.
    if (turn.reply === "decline") {
      return { ...unchanged, status: "declined", options: [], contentKeys: ["consentDeclined"] };
    }
    return withNextQuestion(
      { collected: state.collected, consentGiven: true, status: "active" },
      [],
    );
  }

  const { analysis } = turn;

  // Revogação também chega por texto livre, classificada pelo LLM.
  if (analysis.intent === "consent_decline") {
    return { ...unchanged, status: "declined", options: [], contentKeys: ["consentDeclined"] };
  }

  let collected = applyCspDefaults(mergeCollected(state.collected, analysis.slots));
  if (analysis.intent === "wants_human") {
    collected = { ...collected, wantsHuman: true };
  }

  const prefix: CspContentKey[] = (() => {
    switch (analysis.intent) {
      case "asking_about_csp":
        return ["cspIntro", "cspMaterial"];
      case "out_of_scope":
        return ["outOfScope"];
      case "wants_human":
        return ["handoff"];
      case "unclear":
        return ["unclear"];
      default:
        return [];
    }
  })();

  return withNextQuestion({ collected, consentGiven: true, status: "active" }, prefix);
}
