import "server-only";
import { getAvailableEvents, getEvent } from "@/lib/services/events";
import {
  NO_ASSOCIATE_REGISTRY,
  type EventAudience,
  type EventAudienceSource,
} from "@/modules/event/event.audience";
import {
  clampChatbotLimit,
  compareChatbotEvents,
  isEventVisibleTo,
  toChatbotEvent,
  type ChatbotEvent,
  type ChatbotEventResult,
} from "@/modules/event/event.chatbot";

/**
 * A CAMADA DE DOMÍNIO QUE O CHATBOT CONSOME.
 *
 * O chatbot nunca fala com o banco, com o PostgREST nem com `EventSummary`. Ele
 * chama estas funções e recebe `ChatbotEvent` — uma lista fechada de campos,
 * sem nome de funcionário, sem status cru, sem carimbo administrativo.
 *
 * ⚠️ AINDA NÃO ESTÁ LIGADA AO `decide.ts`, e isso é deliberado: hoje todo texto
 * do bot sai do catálogo aprovado em `csp.content.ts`, sem etapa de consulta.
 * Quando essa etapa existir, ela roda ANÔNIMA — `/api/chat` é público e a RLS
 * de `events` exige papel autenticado —, então precisará de um cliente
 * `service_role` no servidor e tem de entrar por aqui. Ver docs/EVENTS.md.
 *
 * ⚠️ E NÃO EXISTE CADASTRO DE ASSOCIADOS. As funções que recebem `associateId`
 * devolvem `unknown-audience` até que uma `EventAudienceSource` real exista —
 * elas não inventam elegibilidade nem fingem que ninguém é elegível.
 */

/**
 * De onde sai "a que segmentos esta pessoa pertence".
 *
 * Uma função, e não uma constante, porque é aqui que a troca acontece no dia em
 * que houver cadastro: um `if` de configuração, e todo o resto do módulo segue
 * igual.
 */
function audienceSource(): EventAudienceSource {
  return NO_ASSOCIATE_REGISTRY;
}

export interface ChatbotEventQuery {
  /** Teto de resultados. Limitado a MAX_CHATBOT_EVENT_LIMIT. */
  limit?: number;
  /** Teto de data (AAAA-MM-DD), para "esta semana" / "próximos 30 dias". */
  untilDate?: string;
}

/**
 * Os eventos que alguém com ESTES segmentos pode ver.
 *
 * É o motor de verdade: recebe os segmentos já resolvidos e não depende de
 * existir cadastro de associados. `getAvailableEventsForAssociate` é só esta
 * função com um passo de identificação na frente.
 *
 * Lista de segmentos VAZIA devolve zero eventos — nunca "todos".
 */
export async function getAvailableEventsForSegments(
  segmentSlugs: readonly string[],
  query: ChatbotEventQuery = {},
): Promise<ChatbotEvent[]> {
  if (segmentSlugs.length === 0) return [];

  const events = await getAvailableEvents({
    segmentSlugs,
    limit: clampChatbotLimit(query.limit),
    untilDate: query.untilDate,
  });

  // O SQL já filtrou por status, data e segmento. Este `map` existe para o
  // recorte de campos; a ordenação vem do banco e é reafirmada aqui para o
  // contrato não depender da cláusula `order` continuar existindo lá.
  return events.map(toChatbotEvent).sort(compareChatbotEvents);
}

/**
 * UM evento, se e somente se a pessoa puder vê-lo.
 *
 * Os três "nãos" — não existe, já passou, não é do seu público — colapsam num
 * `unavailable` só. Distinguir "não existe" de "existe mas não é para você"
 * confirmaria a existência do evento a quem não deveria saber dele, e é assim
 * que uma varredura de ids vira um mapa da agenda.
 */
export async function getEventForSegments(
  eventId: string,
  segmentSlugs: readonly string[],
): Promise<ChatbotEventResult> {
  const event = await getEvent(eventId);
  if (!event) return { status: "unavailable" };

  const today = await currentEventDate();
  if (!isEventVisibleTo(event, segmentSlugs, today)) return { status: "unavailable" };

  return { status: "available", event: toChatbotEvent(event) };
}

/**
 * A listagem por associado — o que o chatbot vai chamar de verdade.
 *
 * Hoje devolve `unknown-audience` porque não há de onde tirar os segmentos de
 * uma pessoa. **Isso não é uma lista vazia**: "não sei quem você é" e "não há
 * eventos para você" são respostas diferentes, e o bot precisa saber qual das
 * duas deu — uma pede encaminhamento para atendimento humano, a outra não.
 */
export async function getAvailableEventsForAssociate(
  associateId: string,
  query: ChatbotEventQuery = {},
): Promise<{ status: "ok"; events: ChatbotEvent[] } | { status: "unknown-audience" }> {
  const lookup = await audienceSource().segmentsForAssociate(associateId);
  if (!lookup.available) return { status: "unknown-audience" };

  return { status: "ok", events: await getAvailableEventsForSegments(lookup.value, query) };
}

/** Um evento para um associado. Mesma regra da listagem, com o mesmo colapso. */
export async function getEventForAssociate(
  eventId: string,
  associateId: string,
): Promise<ChatbotEventResult> {
  const lookup = await audienceSource().segmentsForAssociate(associateId);
  if (!lookup.available) return { status: "unknown-audience" };

  return getEventForSegments(eventId, lookup.value);
}

/**
 * A AUDIÊNCIA DE UM EVENTO — quem seria alcançado por uma futura campanha.
 *
 * Não envia nada, não conhece WhatsApp, não conhece template. Devolve os
 * públicos do evento e, quando houver de onde, os ids dos associados, já sem
 * repetição (quem pertence a dois públicos do mesmo evento conta uma vez).
 *
 * Os quatro estados possíveis são diferentes de propósito:
 *
 *   `not-found`     o evento não existe
 *   `no-segments`   o evento existe e não tem público — a audiência É vazia
 *   `unavailable`   há público, mas não há de onde tirar os associados
 *   `resolved`      a lista de ids
 *
 * Juntar `no-segments` com `unavailable` num array vazio faria uma campanha
 * "enviar para ninguém" e reportar sucesso nos dois casos.
 */
export async function resolveEventAudience(eventId: string): Promise<EventAudience> {
  const event = await getEvent(eventId);
  if (!event) return { status: "not-found" };
  if (event.segments.length === 0) return { status: "no-segments" };

  const slugs = event.segments.map((segment) => segment.slug);
  const lookup = await audienceSource().associatesInSegments(slugs);

  if (!lookup.available) {
    return { status: "unavailable", segments: event.segments, reason: lookup.reason };
  }

  // A união/deduplicação já é responsabilidade da origem, que sabe consultar em
  // lote. O `Set` aqui é a garantia de contrato: um associado nunca sai daqui
  // duas vezes, seja qual for a implementação.
  return {
    status: "resolved",
    segments: event.segments,
    associateIds: [...new Set(lookup.value)],
  };
}

/** O "hoje" oficial da APCS, lido do banco (a Vercel roda em UTC). */
async function currentEventDate(): Promise<string> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("event_today");
  if (error) {
    console.error(`[event-chatbot] event_today falhou: ${error.message}`);
    throw error;
  }

  return data as string;
}
