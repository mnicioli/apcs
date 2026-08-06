import { describe, expect, it } from "vitest";
import {
  evaluateRateLimit,
  MAX_MESSAGES_PER_CONVERSATION,
  MAX_MESSAGES_PER_MINUTE,
} from "./rate-limit";

/**
 * O chat é anônimo e cada mensagem custa uma chamada de LLM. Sem limite, o
 * endpoint é um cartão de crédito aberto na internet.
 */
describe("evaluateRateLimit", () => {
  it("libera o uso normal", () => {
    expect(evaluateRateLimit({ recentUserMessages: 2, totalUserMessages: 10 })).toEqual({
      allowed: true,
    });
  });

  it("segura rajada de mensagens no mesmo minuto", () => {
    expect(
      evaluateRateLimit({
        recentUserMessages: MAX_MESSAGES_PER_MINUTE,
        totalUserMessages: 10,
      }),
    ).toEqual({ allowed: false, reason: "burst" });
  });

  it("encerra a conversa ao atingir o teto absoluto", () => {
    expect(
      evaluateRateLimit({
        recentUserMessages: 1,
        totalUserMessages: MAX_MESSAGES_PER_CONVERSATION,
      }),
    ).toEqual({ allowed: false, reason: "exhausted" });
  });

  it("o teto absoluto tem prioridade sobre a rajada", () => {
    const verdict = evaluateRateLimit({
      recentUserMessages: MAX_MESSAGES_PER_MINUTE + 5,
      totalUserMessages: MAX_MESSAGES_PER_CONVERSATION + 5,
    });
    expect(verdict).toEqual({ allowed: false, reason: "exhausted" });
  });
});
