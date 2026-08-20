import type { Database } from "@/types/database";

/**
 * Tipos da caixa de entrada do WhatsApp.
 *
 * ⚠️ OS ENUMS SÃO DERIVADOS DO BANCO, não redigitados.
 * `Database["public"]["Enums"]` vem de `pnpm db:types`, que lê o schema real.
 * Redigitar a lista aqui criaria uma segunda verdade que só divergiria no dia
 * em que alguém acrescentasse um valor pela migration — e o sintoma seria um
 * `never` num `switch` a três arquivos de distância.
 */

export type WhatsAppDirection = Database["public"]["Enums"]["whatsapp_direction"];
export type WhatsAppMessageKind = Database["public"]["Enums"]["whatsapp_message_kind"];
export type WhatsAppDeliveryStatus = Database["public"]["Enums"]["whatsapp_delivery_status"];
export type WhatsAppMessageOrigin = Database["public"]["Enums"]["whatsapp_message_origin"];
export type WhatsAppMediaStatus = Database["public"]["Enums"]["whatsapp_media_status"];

/**
 * As abas da caixa, e elas são as do WhatsApp de propósito.
 *
 * "Todas", "Não lidas", "Grupos" e "Arquivadas" é o vocabulário que quem atende
 * já usa no celular oito horas por dia. Inventar outro recorte ("pendentes",
 * "em aberto") obrigaria a pessoa a traduzir mentalmente entre as duas telas
 * que ela olha alternadamente.
 */
export const WHATSAPP_FILTERS = ["all", "unread", "groups", "archived"] as const;
export type WhatsAppFilter = (typeof WHATSAPP_FILTERS)[number];

export const DEFAULT_WHATSAPP_FILTER: WhatsAppFilter = "all";

export function isWhatsAppFilter(value: string): value is WhatsAppFilter {
  return (WHATSAPP_FILTERS as readonly string[]).includes(value);
}

/** Uma conversa na lista da esquerda. */
export interface WhatsAppChat {
  id: string;
  /** Telefone em E.164 (só dígitos). Nulo em grupo. */
  phone: string | null;
  isGroup: boolean;
  /** Como o WhatsApp chama a conversa. Pode ser nulo — aí só há o número. */
  name: string | null;
  photoUrl: string | null;
  contactId: string | null;
  memberId: string | null;
  unreadCount: number;
  archived: boolean;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageFromMe: boolean | null;
}

/** O anexo de uma mensagem, já resolvido para a tela. */
export interface WhatsAppMedia {
  status: WhatsAppMediaStatus;
  /** URL assinada e de vida curta do nosso bucket. Nula se não deu para gerar. */
  url: string | null;
  mimeType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
}

/** Uma mensagem na transcrição. */
export interface WhatsAppMessage {
  id: string;
  direction: WhatsAppDirection;
  origin: WhatsAppMessageOrigin;
  kind: WhatsAppMessageKind;
  body: string;
  senderName: string | null;
  participantPhone: string | null;
  status: WhatsAppDeliveryStatus;
  errorMessage: string | null;
  /** Nome de quem enviou pelo CRM. Nulo nas demais origens. */
  sentByName: string | null;
  occurredAt: string;
  media: WhatsAppMedia | null;
}

/** A conversa aberta: a linha da lista mais a transcrição. */
export interface WhatsAppConversation extends WhatsAppChat {
  messages: WhatsAppMessage[];
}

/** Contadores das abas — apurados na mesma leitura que monta a lista. */
export type WhatsAppCounts = Record<WhatsAppFilter, number>;

/** O que a caixa precisa saber sobre a integração para ser honesta na tela. */
export interface WhatsAppIntegrationStatus {
  /** Nome do adaptador em uso (`z_api`, `whatsapp_cloud_api`, `fake`...). */
  provider: string;
  configured: boolean;
  /** O que falta configurar. Vazio quando `configured`. */
  missing: readonly string[];
}
