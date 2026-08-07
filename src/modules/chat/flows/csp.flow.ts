import {
  CHAT_CONTACT_CHANNELS,
  CHAT_CONTACT_PROFILES,
  CHAT_CONTACT_TIMES,
  CSP_INTERESTS,
  CSP_VOLUME_RANGES,
  type ChatOption,
  type CspCollected,
} from "../chat.types";
import {
  CONTACT_CHANNEL_LABELS,
  CONTACT_PROFILE_LABELS,
  CONTACT_TIME_LABELS,
  INTEREST_LABELS,
  VOLUME_RANGE_LABELS,
} from "../chat.labels";
import type { CspContentKey } from "./csp.content";

/**
 * Definição do fluxo CSP: quais campos preencher, em que ordem, com qual
 * pergunta aprovada e quais opções oferecer.
 *
 * O motor é burro de propósito — ele só percorre esta lista. Mudar a ordem das
 * perguntas ou acrescentar um campo é mexer só aqui.
 */

export const CSP_SLOT_KEYS = [
  "fullName",
  "location",
  "contactProfile",
  "interest",
  "volumeRange",
  "contactChannel",
  "contactValue",
  "preferredTime",
] as const;

export type CspSlotKey = (typeof CSP_SLOT_KEYS)[number];

/**
 * Nome de cada campo para o backoffice — é assim que a Central de Atendimento
 * diz "a triagem parou em Porte da granja". Não são as perguntas do bot (essas
 * vivem no catálogo aprovado), são rótulos de tela.
 */
export const CSP_SLOT_LABELS: Record<CspSlotKey, string> = {
  fullName: "Nome",
  location: "Cidade e estado",
  contactProfile: "Perfil",
  interest: "Interesse",
  volumeRange: "Porte da granja",
  contactChannel: "Canal de contato",
  contactValue: "Telefone ou e-mail",
  preferredTime: "Melhor horário",
};

export interface CspSlot {
  key: CspSlotKey;
  /** Pergunta aprovada usada para preencher este campo. */
  askKey: CspContentKey;
  /** Já temos o dado? */
  isFilled: (collected: CspCollected) => boolean;
  /** Precisamos deste dado para este contato? */
  isRequired: (collected: CspCollected) => boolean;
  /** Opções clicáveis (campos de enum). Texto livre continua valendo. */
  options?: (collected: CspCollected) => ChatOption[];
}

function toOptions<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): ChatOption[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

export const CSP_SLOTS: readonly CspSlot[] = [
  {
    key: "fullName",
    askKey: "askFullName",
    isFilled: (c) => Boolean(c.fullName),
    isRequired: () => true,
  },
  {
    key: "location",
    askKey: "askLocation",
    isFilled: (c) => Boolean(c.city && c.state),
    isRequired: () => true,
  },
  {
    key: "contactProfile",
    askKey: "askContactProfile",
    isFilled: (c) => Boolean(c.contactProfile),
    isRequired: () => true,
    options: () => toOptions(CHAT_CONTACT_PROFILES, CONTACT_PROFILE_LABELS),
  },
  {
    key: "interest",
    askKey: "askInterest",
    isFilled: (c) => Boolean(c.interest),
    isRequired: () => true,
    options: () => toOptions(CSP_INTERESTS, INTEREST_LABELS),
  },
  {
    key: "volumeRange",
    askKey: "askVolumeRange",
    isFilled: (c) => Boolean(c.volumeRange),
    // Fornecedor não tem granja — não faz sentido perguntar o porte.
    isRequired: (c) => c.contactProfile !== "supplier",
    options: () =>
      toOptions(
        CSP_VOLUME_RANGES.filter((v) => v !== "not_applicable"),
        VOLUME_RANGE_LABELS,
      ),
  },
  {
    key: "contactChannel",
    askKey: "askContactChannel",
    isFilled: (c) => Boolean(c.preferredChannel),
    isRequired: () => true,
    options: () => toOptions(CHAT_CONTACT_CHANNELS, CONTACT_CHANNEL_LABELS),
  },
  {
    key: "contactValue",
    askKey: "askContactValue",
    isFilled: (c) => (c.preferredChannel === "email" ? Boolean(c.email) : Boolean(c.phone)),
    // Só dá para pedir o dado depois de saber o canal.
    isRequired: (c) => Boolean(c.preferredChannel),
  },
  {
    key: "preferredTime",
    askKey: "askPreferredTime",
    isFilled: (c) => Boolean(c.preferredTime),
    // Horário só importa para contato por voz/mensagem, não para e-mail.
    isRequired: (c) => c.preferredChannel !== "email",
    options: () => toOptions(CHAT_CONTACT_TIMES, CONTACT_TIME_LABELS),
  },
];

/**
 * Regras derivadas do próprio fluxo, aplicadas depois de cada extração.
 * Evita campo em branco no backoffice quando a pergunta nem chegou a ser feita.
 */
export function applyCspDefaults(collected: CspCollected): CspCollected {
  if (collected.contactProfile === "supplier" && !collected.volumeRange) {
    return { ...collected, volumeRange: "not_applicable" };
  }
  return collected;
}

/** Próximo campo a perguntar, ou `null` se a triagem terminou. */
export function nextCspSlot(collected: CspCollected): CspSlot | null {
  return CSP_SLOTS.find((slot) => slot.isRequired(collected) && !slot.isFilled(collected)) ?? null;
}

export function isCspTriageComplete(collected: CspCollected): boolean {
  return nextCspSlot(collected) === null;
}

/**
 * Resumo da triagem mostrado na confirmação final. É o único ponto em que
 * dados digitados pela pessoa voltam para a tela — sempre como texto puro,
 * escapado pelo React.
 */
export function buildCspSummary(collected: CspCollected): string {
  const lines: string[] = [];
  if (collected.fullName) lines.push(`Nome: ${collected.fullName}`);
  if (collected.city && collected.state) {
    lines.push(`Cidade: ${collected.city}/${collected.state}`);
  }
  if (collected.contactProfile) {
    lines.push(`Perfil: ${CONTACT_PROFILE_LABELS[collected.contactProfile]}`);
  }
  if (collected.interest) lines.push(`Interesse: ${INTEREST_LABELS[collected.interest]}`);
  if (collected.volumeRange) lines.push(`Porte: ${VOLUME_RANGE_LABELS[collected.volumeRange]}`);
  if (collected.preferredChannel) {
    const value = collected.preferredChannel === "email" ? collected.email : collected.phone;
    const channel = CONTACT_CHANNEL_LABELS[collected.preferredChannel];
    lines.push(value ? `Contato: ${channel} — ${value}` : `Contato: ${channel}`);
  }
  if (collected.preferredTime)
    lines.push(`Horário: ${CONTACT_TIME_LABELS[collected.preferredTime]}`);
  return lines.join("\n");
}

/** Junta o que já foi coletado com o que o LLM extraiu neste turno. */
export function mergeCollected(current: CspCollected, incoming: CspCollected): CspCollected {
  const merged: CspCollected = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === "") continue;
    // `Object.entries` perde o tipo; o schema Zod já validou cada campo.
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}
