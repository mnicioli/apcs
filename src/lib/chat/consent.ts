import type { ChatOption } from "@/modules/chat/chat.types";

/**
 * Gate de consentimento LGPD — 100% determinístico, sem LLM.
 *
 * Duas razões para não usar o modelo aqui:
 *
 * 1. **Jurídica.** O consentimento precisa ser "livre, informado e inequívoco"
 *    (LGPD art. 5º XII). Registrar um aceite porque um classificador achou que
 *    a pessoa disse sim não é registro de ato afirmativo — e um falso positivo
 *    liberaria a coleta de dados que a pessoa recusou.
 * 2. **Privacidade.** Antes do aceite não existe base legal para mandar o texto
 *    do visitante (que costuma já conter nome e telefone) para um processador
 *    terceiro fora do país. Classificando aqui, nada sai do servidor.
 *
 * O clique no botão manda `optionValue` e resolve por igualdade. Texto livre
 * cai no reconhecimento de padrões abaixo; qualquer dúvida vira "unclear" e o
 * bot repete a pergunta — falhar para "não decidiu" é sempre o lado seguro.
 */

export type ConsentReply = "accept" | "decline" | "unclear";

export const CONSENT_ACCEPT_VALUE = "accept";
export const CONSENT_DECLINE_VALUE = "decline";

export const CONSENT_OPTIONS: ChatOption[] = [
  { value: CONSENT_ACCEPT_VALUE, label: "Sim, autorizo" },
  { value: CONSENT_DECLINE_VALUE, label: "Não autorizo" },
];

/** Minúsculas, sem acento, sem pontuação — "Não, obrigado!" → "nao obrigado". */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A recusa é testada primeiro de propósito: "nao autorizo" contém "autorizo".
const DECLINE_PATTERNS = [
  /^nao\b/,
  /^n$/,
  /^nem\b/,
  /^negativo\b/,
  /^nunca\b/,
  /^recuso\b/,
  /^discordo\b/,
  /^prefiro que nao\b/,
];

const ACCEPT_PATTERNS = [
  /^sim\b/,
  /^s$/,
  /^aceito\b/,
  /^autorizo\b/,
  /^concordo\b/,
  /^ok\b/,
  /^okay\b/,
  /^claro\b/,
  /^pode\b/,
  /^podemos\b/,
  /^positivo\b/,
  /^de acordo\b/,
  /^tudo bem\b/,
  /^beleza\b/,
];

export function classifyConsentReply(input: {
  message: string;
  optionValue?: string;
}): ConsentReply {
  if (input.optionValue === CONSENT_ACCEPT_VALUE) return "accept";
  if (input.optionValue === CONSENT_DECLINE_VALUE) return "decline";

  const text = normalize(input.message);
  if (!text) return "unclear";

  if (DECLINE_PATTERNS.some((pattern) => pattern.test(text))) return "decline";
  if (ACCEPT_PATTERNS.some((pattern) => pattern.test(text))) return "accept";
  return "unclear";
}
