/**
 * Timeout, backoff e disjuntor (§19, §20, §21, §24, §75).
 *
 * Funções puras e uma classe sem I/O — o teste controla o relógio passando
 * `now`. Sem `server-only` pelo mesmo motivo de `phone.ts`.
 */

/** §20. Nenhuma chamada ao fornecedor fica pendurada. */
export const PROVIDER_TIMEOUT_MS = 15_000;

/** §24/§75. Teto de tentativas por destinatário, contando a primeira. */
export const MAX_SEND_ATTEMPTS = 3;

/**
 * §24. Espera entre tentativas, em milissegundos.
 *
 * ⚠️ O JITTER NÃO É ENFEITE. Sem ele, quinhentas mensagens que falharam juntas
 * (porque o fornecedor caiu) voltam juntas exatamente 1 s depois, e derrubam de
 * novo o serviço que estava se recuperando. Com jitter elas se espalham.
 *
 * `attempt` é 1-based: a espera DEPOIS da primeira falha é `attempt = 1`.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(1000 * 2 ** Math.max(0, attempt - 1), 30_000);
  // Jitter cheio (0..base): espalha melhor que o jitter parcial, e a espera
  // média continua sendo metade do teto.
  return Math.floor(base * random());
}

/**
 * §24. O ritmo do envio, em mensagens por segundo.
 *
 * O padrão é conservador de propósito: o limite real depende do nível de
 * qualidade da conta no WhatsApp, que muda sozinho conforme as pessoas
 * bloqueiam ou não a APCS. Estourar o limite não devolve só um 429 — degrada a
 * reputação do número, que é o ativo mais caro de recuperar aqui.
 */
export const DEFAULT_MESSAGES_PER_SECOND = 5;

export function throttleDelayMs(messagesPerSecond: number): number {
  const taxa = Number.isFinite(messagesPerSecond) && messagesPerSecond > 0 ? messagesPerSecond : 1;
  return Math.ceil(1000 / taxa);
}

export type BreakerState = "closed" | "open" | "half_open";

/**
 * §21. O DISJUNTOR.
 *
 * O projeto não tem mecanismo de resiliência para reutilizar (procurado: não há
 * `p-retry`, `cockatiel`, nem nada equivalente em `package.json`), então ele
 * nasce aqui — pequeno, sem dependência e sem estado global escondido.
 *
 * ⚠️ POR QUE UM DISJUNTOR NUMA FILA QUE JÁ TEM RETRY.
 *
 * O retry protege UMA mensagem. O disjuntor protege a CAMPANHA: com o
 * fornecedor fora do ar, mil destinatários gerariam mil chamadas que vão
 * falhar, cada uma esperando o timeout de 15 s — a corrida levaria horas para
 * descobrir o que a terceira chamada já sabia. Aberto o disjuntor, o worker
 * devolve todo mundo para a fila na hora e tenta de novo no próximo ciclo.
 *
 * O estado vive na instância, que vive no processo. Em serverless cada
 * instância tem o seu — o que é aceitável: o objetivo é abortar A CORRIDA em
 * curso, e a corrida acontece dentro de um processo. Um disjuntor
 * compartilhado precisaria de Redis, que este projeto não tem.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 60_000,
  ) {}

  state(now: number = Date.now()): BreakerState {
    if (this.openedAt === null) return "closed";
    // Passado o descanso, deixa UMA chamada passar para descobrir se voltou.
    if (now - this.openedAt >= this.cooldownMs) return "half_open";
    return "open";
  }

  allows(now: number = Date.now()): boolean {
    return this.state(now) !== "open";
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  /**
   * ⚠️ Só falha de INFRAESTRUTURA conta. "Este número não tem WhatsApp" é o
   * fornecedor funcionando perfeitamente e dando uma resposta correta —
   * contá-la abriria o disjuntor no meio de uma campanha por causa de cinco
   * cadastros ruins, e a campanha inteira pararia por um problema que não é do
   * fornecedor.
   */
  recordFailure(now: number = Date.now()): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openedAt = now;
    }
  }

  reset(): void {
    this.failures = 0;
    this.openedAt = null;
  }
}

/**
 * §20. `fetch` com timeout de verdade.
 *
 * `AbortSignal.timeout` existe no Node 20, mas envolvemos assim mesmo para que
 * o estouro vire uma falha REPORTÁVEL (`timeout`) em vez de um `AbortError`
 * genérico que o adaptador teria de adivinhar.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<{ ok: true; response: Response } | { ok: false; timedOut: boolean; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return { ok: true, response };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return {
      ok: false,
      timedOut,
      error: timedOut
        ? `Sem resposta do fornecedor em ${timeoutMs} ms.`
        : error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
