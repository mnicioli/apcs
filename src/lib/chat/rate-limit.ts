/**
 * Limites do chat público. Sem eles, um endpoint anônimo que chama um LLM é um
 * cartão de crédito aberto na internet.
 *
 * A contagem é feita no banco (e não em memória) porque o app roda em ambiente
 * serverless: instâncias diferentes não compartilham memória.
 *
 * O pior caso por IP é o produto destes números:
 * 5 conversas/hora × 40 mensagens = 200 chamadas ao LLM por hora, por IP.
 * O fusível de custo definitivo não mora aqui — é o limite de gasto da
 * organização no console da Anthropic. Configure os dois.
 */

/** Turnos anteriores enviados ao modelo como contexto. */
export const HISTORY_LIMIT = 20;

/** Mensagens do visitante por minuto, na mesma conversa. */
export const MAX_MESSAGES_PER_MINUTE = 8;

/** Teto absoluto de mensagens numa conversa — evita loop infinito. */
export const MAX_MESSAGES_PER_CONVERSATION = 40;

/** Conversas iniciadas a partir do mesmo IP por hora. */
export const MAX_CONVERSATIONS_PER_IP_PER_HOUR = 5;

export interface RateLimitCounts {
  /** Mensagens do visitante no último minuto. */
  recentUserMessages: number;
  /** Total de mensagens do visitante na conversa. */
  totalUserMessages: number;
}

export type RateLimitVerdict =
  | { allowed: true }
  | { allowed: false; reason: "burst" | "exhausted" };

/**
 * Função pura — recebe os números já contados e decide. Fica assim para ser
 * testável sem banco.
 */
export function evaluateRateLimit(counts: RateLimitCounts): RateLimitVerdict {
  if (counts.totalUserMessages >= MAX_MESSAGES_PER_CONVERSATION) {
    return { allowed: false, reason: "exhausted" };
  }
  if (counts.recentUserMessages >= MAX_MESSAGES_PER_MINUTE) {
    return { allowed: false, reason: "burst" };
  }
  return { allowed: true };
}
