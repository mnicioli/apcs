import { matchesAnySegment } from "./event.audience";
import { effectiveStatus } from "./event.rules";
import type { EventSummary } from "./event.types";

/**
 * O contrato do chatbot com o módulo de eventos.
 *
 * Duas responsabilidades, e só elas: decidir se um evento pode ser mostrado a
 * alguém, e reduzi-lo ao mínimo que o bot precisa dizer.
 *
 * ⚠️ NENHUMA FRASE DE CHATBOT MORA AQUI. O domínio devolve dado estruturado; a
 * linguagem natural é responsabilidade de quem conversa. Um "Não encontrei
 * eventos para você 🙁" nesta camada apareceria igual em relatório, em API e em
 * e-mail no dia em que alguém reusar a função.
 */

/** Quantos eventos uma resposta traz quando ninguém pede outra coisa. */
export const DEFAULT_CHATBOT_EVENT_LIMIT = 10;

/**
 * O teto que ninguém passa, mesmo pedindo.
 *
 * Existe contra enumeração: sem ele, `limit=100000` viraria um dump da agenda
 * inteira numa chamada. Paginação por cursor fica para quando o chatbot
 * precisar de "mais eventos" — hoje seria complexidade sem uso.
 */
export const MAX_CHATBOT_EVENT_LIMIT = 50;

export function clampChatbotLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_CHATBOT_EVENT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_CHATBOT_EVENT_LIMIT);
}

/**
 * O evento como o chatbot o vê.
 *
 * ⚠️ É uma LISTA FECHADA, não um `Omit<EventSummary, ...>`. A diferença
 * importa: com `Omit`, um campo novo em `EventSummary` passaria a vazar
 * sozinho. Aqui, campo novo só aparece se alguém escrever o nome dele.
 *
 * O que ficou de fora, de propósito: `createdBy` e `updatedBy` (nomes de
 * funcionários da APCS), `status` cru e carimbos administrativos. Nada disso
 * ajuda um associado a decidir se vai ao evento, e tudo isso é dado interno.
 *
 * A `description` entrou em 20260904000000_event_description.sql. Ela É escrita
 * PARA o associado — é o mesmo texto que sai na divulgação de WhatsApp —, então
 * é um dos poucos campos novos que o bot pode e deve mostrar.
 */
export interface ChatbotEvent {
  id: string;
  name: string;
  /** O que o evento é. `null` quando ninguém escreveu — nunca um texto inventado. */
  description: string | null;
  location: string;
  /** AAAA-MM-DD. Formatação para leitura humana é de quem exibe. */
  eventDate: string;
  /** HH:MM. */
  startTime: string;
  /** HH:MM, ou `null` quando o evento não tem hora de término. */
  endTime: string | null;
  /** `null` quando não há inscrição. Nunca uma URL inventada. */
  registrationUrl: string | null;
  /**
   * URL assinada e temporária do cartaz, ou `null`.
   *
   * O bucket é privado: o caminho interno nunca sai daqui, e o link expira. É
   * o que permite o bot mandar a imagem sem tornar o arquivo público para
   * sempre.
   */
  imageUrl: string | null;
}

/** Reduz um evento ao que o chatbot pode ver. */
export function toChatbotEvent(event: EventSummary): ChatbotEvent {
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    location: event.location,
    eventDate: event.eventDate,
    startTime: event.startTime,
    endTime: event.endTime,
    registrationUrl: event.registrationUrl,
    imageUrl: event.imageUrl,
  };
}

/**
 * ⚠️ A REGRA DE VISIBILIDADE. Três condições, todas obrigatórias:
 *
 *   1. o evento está ATIVO (a decisão humana);
 *   2. a data não passou (a decisão do calendário);
 *   3. o associado pertence a algum dos públicos do evento (OU).
 *
 * A condição 2 é DEFESA EM PROFUNDIDADE, não redundância. Se um dia existir uma
 * rotina que marca vencidos como inativos, ela pode falhar, atrasar ou não
 * rodar; esta comparação não pode. Um evento que já aconteceu nunca é oferecido,
 * qualquer que seja o estado da coluna.
 *
 * Evento sem público-alvo não é visível para ninguém — ver `matchesAnySegment`.
 */
export function isEventVisibleTo(
  event: EventSummary,
  associateSegmentSlugs: readonly string[],
  today: string,
): boolean {
  if (effectiveStatus(event, today) !== "active") return false;
  return matchesAnySegment(event.segments, associateSegmentSlugs);
}

/** Do mais próximo para o mais distante — a ordem que o chatbot anuncia. */
export function compareChatbotEvents(a: ChatbotEvent, b: ChatbotEvent): number {
  if (a.eventDate !== b.eventDate) return a.eventDate.localeCompare(b.eventDate);
  return a.startTime.localeCompare(b.startTime);
}

/**
 * O que o chatbot recebe ao pedir UM evento.
 *
 * `unavailable` cobre os três casos — não existe, expirou, ou o associado não
 * pertence ao público — DE PROPÓSITO. Distinguir "não existe" de "existe mas
 * não é para você" confirmaria a existência de um evento a quem não deveria
 * saber dele. Quem chama não precisa dessa diferença; quem enumera ids,
 * precisa.
 */
export type ChatbotEventResult =
  | { status: "available"; event: ChatbotEvent }
  | { status: "unavailable" }
  /** Não foi possível descobrir os segmentos do associado. Ver event.audience.ts. */
  | { status: "unknown-audience" };
