import { describe, expect, it } from "vitest";
import {
  backoffDelayMs,
  CircuitBreaker,
  DEFAULT_MESSAGES_PER_SECOND,
  MAX_SEND_ATTEMPTS,
  throttleDelayMs,
} from "./resilience";

/** §19, §21, §24, §75. Backoff, ritmo e disjuntor. */

describe("backoffDelayMs (§24, §75)", () => {
  it("cresce exponencialmente", () => {
    // `random = () => 1` fixa o jitter no teto, o que deixa a progressão
    // visível: 1 s, 2 s, 4 s, 8 s.
    expect(backoffDelayMs(1, () => 1)).toBe(1000);
    expect(backoffDelayMs(2, () => 1)).toBe(2000);
    expect(backoffDelayMs(3, () => 1)).toBe(4000);
    expect(backoffDelayMs(4, () => 1)).toBe(8000);
  });

  it("tem teto — não espera meia hora na décima tentativa", () => {
    expect(backoffDelayMs(20, () => 1)).toBe(30_000);
  });

  it("⚠️ o jitter espalha o retorno", () => {
    // Sem jitter, quinhentas mensagens que falharam juntas (porque o fornecedor
    // caiu) voltam JUNTAS 1 s depois e derrubam de novo o serviço que estava se
    // recuperando. Com jitter cheio, o mesmo `attempt` produz esperas
    // diferentes.
    expect(backoffDelayMs(3, () => 0)).toBe(0);
    expect(backoffDelayMs(3, () => 0.5)).toBe(2000);
    expect(backoffDelayMs(3, () => 1)).toBe(4000);
  });

  it("tentativa zero ou negativa não quebra", () => {
    expect(backoffDelayMs(0, () => 1)).toBe(1000);
    expect(backoffDelayMs(-5, () => 1)).toBe(1000);
  });

  it("o teto de tentativas existe e é pequeno", () => {
    expect(MAX_SEND_ATTEMPTS).toBeGreaterThanOrEqual(2);
    expect(MAX_SEND_ATTEMPTS).toBeLessThanOrEqual(5);
  });
});

describe("throttleDelayMs (§24)", () => {
  it("converte mensagens por segundo em espera", () => {
    expect(throttleDelayMs(5)).toBe(200);
    expect(throttleDelayMs(1)).toBe(1000);
    expect(throttleDelayMs(10)).toBe(100);
  });

  it("valor absurdo vira 1 por segundo em vez de divisão por zero", () => {
    expect(throttleDelayMs(0)).toBe(1000);
    expect(throttleDelayMs(-3)).toBe(1000);
    expect(throttleDelayMs(Number.NaN)).toBe(1000);
    expect(throttleDelayMs(Number.POSITIVE_INFINITY)).toBe(1000);
  });

  it("o padrão é conservador", () => {
    // Estourar o limite do WhatsApp não devolve só um 429 — degrada a
    // reputação do número, que é o ativo mais caro de recuperar aqui.
    expect(DEFAULT_MESSAGES_PER_SECOND).toBeLessThanOrEqual(10);
  });
});

describe("CircuitBreaker (§21)", () => {
  it("começa fechado e deixa passar", () => {
    const d = new CircuitBreaker(3, 1000);
    expect(d.state(0)).toBe("closed");
    expect(d.allows(0)).toBe(true);
  });

  it("abre depois do limite de falhas", () => {
    const d = new CircuitBreaker(3, 1000);
    d.recordFailure(0);
    d.recordFailure(0);
    expect(d.allows(0)).toBe(true);
    d.recordFailure(0);
    expect(d.state(0)).toBe("open");
    expect(d.allows(0)).toBe(false);
  });

  it("⚠️ um sucesso no meio zera a contagem", () => {
    // Falhas ESPARSAS ao longo de uma campanha grande são normais. Sem o zerar,
    // a quinta falha em dez mil mensagens abriria o disjuntor e pararia tudo.
    const d = new CircuitBreaker(3, 1000);
    d.recordFailure(0);
    d.recordFailure(0);
    d.recordSuccess();
    d.recordFailure(0);
    d.recordFailure(0);
    expect(d.allows(0)).toBe(true);
  });

  it("passado o descanso vira meio-aberto e deixa uma passar", () => {
    const d = new CircuitBreaker(2, 1000);
    d.recordFailure(0);
    d.recordFailure(0);
    expect(d.allows(500)).toBe(false);
    expect(d.state(1000)).toBe("half_open");
    expect(d.allows(1000)).toBe(true);
  });

  it("sucesso no meio-aberto fecha de vez", () => {
    const d = new CircuitBreaker(2, 1000);
    d.recordFailure(0);
    d.recordFailure(0);
    d.recordSuccess();
    expect(d.state(0)).toBe("closed");
  });

  it("reset devolve ao estado inicial", () => {
    const d = new CircuitBreaker(1, 1000);
    d.recordFailure(0);
    expect(d.allows(0)).toBe(false);
    d.reset();
    expect(d.allows(0)).toBe(true);
  });
});
