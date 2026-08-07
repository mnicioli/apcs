/**
 * Tipos de domínio do chat de atendimento (camelCase), desacoplados das linhas
 * cruas do banco (snake_case). Services e o motor mapeiam Row → estes tipos.
 *
 * Os valores dos enums espelham os enums do Postgres criados em
 * `supabase/migrations/20260804000000_create_chat_csp.sql`. Ao mudar um, mude
 * os dois — o `as const` aqui é a fonte da verdade para o TypeScript.
 */

export const CHAT_FLOW_KEYS = ["csp"] as const;
export type ChatFlowKey = (typeof CHAT_FLOW_KEYS)[number];

export const CHAT_MESSAGE_ROLES = ["user", "bot"] as const;
export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];

export const CHAT_CONVERSATION_STATUSES = [
  "active",
  "completed",
  "handoff",
  "declined",
  "abandoned",
] as const;
export type ChatConversationStatus = (typeof CHAT_CONVERSATION_STATUSES)[number];

export const CHAT_CONTACT_PROFILES = ["producer", "member", "supplier"] as const;
export type ChatContactProfile = (typeof CHAT_CONTACT_PROFILES)[number];

export const CHAT_CONTACT_CHANNELS = ["whatsapp", "phone", "email"] as const;
export type ChatContactChannel = (typeof CHAT_CONTACT_CHANNELS)[number];

export const CHAT_CONTACT_TIMES = ["morning", "afternoon", "evening", "any"] as const;
export type ChatContactTime = (typeof CHAT_CONTACT_TIMES)[number];

export const CSP_INTERESTS = ["input", "feed", "logistics", "information"] as const;
export type CspInterest = (typeof CSP_INTERESTS)[number];

export const CSP_VOLUME_RANGES = [
  "up_to_50",
  "from_50_to_200",
  "from_200_to_1000",
  "above_1000",
  "not_applicable",
] as const;
export type CspVolumeRange = (typeof CSP_VOLUME_RANGES)[number];

export const LEAD_STATUSES = ["new", "in_contact", "qualified", "discarded"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * Campos da tabela de triagem do CSP, preenchidos ao longo da conversa.
 * Tudo opcional: a conversa vai completando aos poucos.
 */
export interface CspCollected {
  fullName?: string;
  city?: string;
  state?: string;
  contactProfile?: ChatContactProfile;
  interest?: CspInterest;
  volumeRange?: CspVolumeRange;
  preferredChannel?: ChatContactChannel;
  phone?: string;
  email?: string;
  preferredTime?: ChatContactTime;
  /**
   * A pessoa pediu para falar com alguém do time. Não é campo de triagem — é
   * estado da conversa, gravado no mesmo jsonb. Quem marca é o motor, nunca o
   * LLM (o schema de extração não conhece este campo).
   */
  wantsHuman?: boolean;
}

/**
 * Intenção detectada pelo LLM em cada turno. É a ÚNICA decisão que o modelo
 * toma sobre o rumo da conversa — qual texto enviar é decisão do motor, a
 * partir do catálogo aprovado. Ver `src/lib/chat/engine.ts`.
 */
export const CHAT_INTENTS = [
  "answering", // respondeu a uma pergunta da triagem
  "asking_about_csp", // quer entender o que é o CSP
  "out_of_scope", // pediu algo fora do conteúdo aprovado
  "wants_human", // quer falar com uma pessoa
  "consent_accept", // aceitou o uso dos dados
  "consent_decline", // recusou o uso dos dados
  "unclear", // não deu para entender
] as const;
export type ChatIntent = (typeof CHAT_INTENTS)[number];

/** Resultado da análise de um turno pelo LLM (já validado). */
export interface ChatTurnAnalysis {
  intent: ChatIntent;
  slots: CspCollected;
}

/** Opção clicável oferecida pelo bot (o texto livre continua funcionando). */
export interface ChatOption {
  value: string;
  label: string;
}

/** Uma conversa carregada do banco. */
export interface ChatConversation {
  id: string;
  contactId: string | null;
  flowKey: ChatFlowKey;
  status: ChatConversationStatus;
  consentGivenAt: string | null;
  collected: CspCollected;
  createdAt: string;
}

/** Uma mensagem do histórico. */
export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  contentKey: string | null;
  createdAt: string;
}

/**
 * Contagem de leads por status, para o painel de abertura.
 *
 * `byStatus` cobre TODOS os status do enum, inclusive os zerados: um painel que
 * esconde a linha quando o valor é zero faz a pessoa duvidar se o dado sumiu ou
 * se não existe.
 */
export interface CspLeadsSummary {
  total: number;
  byStatus: Record<LeadStatus, number>;
}

/** Lead do CSP, como exibido no backoffice. */
export interface CspLead {
  id: string;
  conversationId: string;
  fullName: string;
  city: string;
  state: string;
  contactProfile: ChatContactProfile;
  interest: CspInterest;
  volumeRange: CspVolumeRange | null;
  preferredChannel: ChatContactChannel;
  preferredTime: ChatContactTime | null;
  phone: string | null;
  email: string | null;
  status: LeadStatus;
  notes: string | null;
  createdAt: string;
}
