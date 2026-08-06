import { z } from "zod";
import {
  CHAT_CONTACT_CHANNELS,
  CHAT_CONTACT_PROFILES,
  CHAT_CONTACT_TIMES,
  CHAT_INTENTS,
  CSP_INTERESTS,
  CSP_VOLUME_RANGES,
  LEAD_STATUSES,
  type ChatTurnAnalysis,
  type CspCollected,
} from "./chat.types";

/** Unidades federativas válidas — usado para validar o que o LLM extraiu. */
export const BRAZILIAN_STATES = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

/** Só dígitos — telefone chega do LLM em formatos variados. */
export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

const fullNameSchema = z.string().trim().min(2).max(120);
const citySchema = z.string().trim().min(2).max(120);
const stateSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v): v is (typeof BRAZILIAN_STATES)[number] =>
    (BRAZILIAN_STATES as readonly string[]).includes(v),
  );
// Fixo/celular brasileiro: 10 ou 11 dígitos com DDD.
const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((v) => v.length === 10 || v.length === 11);
const emailSchema = z.string().trim().toLowerCase().email().max(254);

/**
 * Campos da triagem do CSP. Tudo opcional — cada turno extrai só o que a
 * pessoa acabou de dizer. Este schema é a barreira entre o LLM e o banco:
 * qualquer campo inválido é descartado (ver `parseTurnAnalysis`).
 */
export const cspCollectedSchema = z.object({
  fullName: fullNameSchema.optional(),
  city: citySchema.optional(),
  state: stateSchema.optional(),
  contactProfile: z.enum(CHAT_CONTACT_PROFILES).optional(),
  interest: z.enum(CSP_INTERESTS).optional(),
  volumeRange: z.enum(CSP_VOLUME_RANGES).optional(),
  preferredChannel: z.enum(CHAT_CONTACT_CHANNELS).optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  preferredTime: z.enum(CHAT_CONTACT_TIMES).optional(),
});

/** Saída esperada do LLM a cada turno. */
export const chatTurnAnalysisSchema = z.object({
  intent: z.enum(CHAT_INTENTS),
  slots: cspCollectedSchema,
});

/**
 * Valida a saída do LLM campo a campo.
 *
 * Diferente de um `safeParse` no objeto inteiro, aqui um campo ruim (UF que não
 * existe, telefone curto) é DESCARTADO e o resto do turno continua valendo — o
 * bot só vai perguntar de novo aquele dado. Descartar o turno inteiro por causa
 * de um campo faria o visitante ver "erro técnico" sem motivo.
 *
 * Se nem a intenção vier válida, aí sim o turno é perdido (`null`).
 */
export function parseTurnAnalysis(raw: unknown): ChatTurnAnalysis | null {
  const envelope = z
    .object({
      intent: z.enum(CHAT_INTENTS),
      slots: z.record(z.unknown()).optional(),
    })
    .safeParse(raw);

  if (!envelope.success) return null;

  return {
    intent: envelope.data.intent,
    slots: pickValidSlots(envelope.data.slots ?? {}),
  };
}

/**
 * Mesma validação campo a campo, aplicada ao que está gravado em
 * `chat_conversations.collected`.
 *
 * Um `safeParse` no objeto inteiro seria pior aqui: um único campo corrompido
 * apagaria a triagem toda e o bot recomeçaria do "qual seu nome?".
 */
export function parseStoredCollected(raw: unknown): CspCollected {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const source = raw as Record<string, unknown>;
  const collected = pickValidSlots(source);

  // `wantsHuman` não é campo de triagem — é estado que o motor controla.
  if (Object.hasOwn(source, "wantsHuman") && source.wantsHuman === true) {
    collected.wantsHuman = true;
  }
  return collected;
}

/**
 * Filtra um objeto arbitrário deixando só os campos de triagem válidos.
 *
 * `Object.hasOwn` (e não `key in`) é deliberado: `"constructor" in shape` é
 * `true` por herança de protótipo, e `shape["constructor"]` não tem
 * `.safeParse` — bastaria isso para derrubar com TypeError justamente a função
 * que existe para conter entrada não confiável.
 */
function pickValidSlots(source: Record<string, unknown>): CspCollected {
  const slots: Record<string, unknown> = {};
  const fieldSchemas = cspCollectedSchema.shape;

  for (const [key, value] of Object.entries(source)) {
    if (!Object.hasOwn(fieldSchemas, key)) continue;
    const fieldSchema = fieldSchemas[key as keyof typeof fieldSchemas];
    const parsed = fieldSchema.safeParse(value);
    if (parsed.success && parsed.data !== undefined) slots[key] = parsed.data;
  }

  return slots as CspCollected;
}

/** Mensagem enviada pelo visitante do chat público. */
export const chatMessageInputSchema = z.object({
  message: z.string().trim().min(1, "Escreva uma mensagem.").max(1000, "Mensagem muito longa."),
  /**
   * Valor da opção clicada, quando a mensagem veio de um botão. É o que torna o
   * consentimento LGPD determinístico: o servidor não depende de o LLM
   * classificar "Sim, autorizo" — ele compara o valor. Texto livre continua
   * funcionando (ver `classifyConsentReply`).
   */
  optionValue: z.string().max(40).optional(),
});

export type ChatMessageInput = z.infer<typeof chatMessageInputSchema>;

/**
 * Triagem completa — o que precisa estar preenchido para virar lead.
 * Deriva de `cspCollectedSchema` exigindo os campos obrigatórios.
 */
export const cspLeadDataSchema = z.object({
  fullName: fullNameSchema,
  city: citySchema,
  state: stateSchema,
  contactProfile: z.enum(CHAT_CONTACT_PROFILES),
  interest: z.enum(CSP_INTERESTS),
  volumeRange: z.enum(CSP_VOLUME_RANGES).optional(),
  preferredChannel: z.enum(CHAT_CONTACT_CHANNELS),
  preferredTime: z.enum(CHAT_CONTACT_TIMES).optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
});

export type CspLeadData = z.infer<typeof cspLeadDataSchema>;

/** Formulário de gestão do lead no backoffice. */
export const leadStatusFormSchema = z.object({
  status: z.enum(LEAD_STATUSES),
  notes: z.string().trim().max(2000, "Observação muito longa.").optional(),
});

export type LeadStatusFormData = z.infer<typeof leadStatusFormSchema>;
