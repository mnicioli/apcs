import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { MEMBERS_REGISTRY } from "@/lib/services/event-audience";
import { getAvailableEvents, getEvent, type EventReader } from "@/lib/services/events";
import { type EventAudience, type EventAudienceSource } from "@/modules/event/event.audience";
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
 * ⚠️ TODA LEITURA DAQUI PASSA PELO `service_role`, E É OBRIGATÓRIO.
 *
 * Quem chama é o robô, que é ANÔNIMO: sem `auth.uid()`, sem papel, e a RLS de
 * `events` exige papel autenticado. Este arquivo nasceu delegando para
 * `getAvailableEvents`/`getEvent` com o cliente do USUÁRIO — ligado assim, ele
 * devolveria lista vazia SEMPRE, e o sintoma seria o bot dizendo "não há
 * eventos" com a agenda cheia na tela ao lado.
 *
 * O leitor é passado explicitamente (`EventReader`) em vez de duplicar a
 * consulta aqui: a cláusula de status, a de data, a ordenação e a assinatura da
 * imagem continuam existindo em UM lugar só.
 */

/**
 * De onde sai "a que segmentos esta pessoa pertence".
 *
 * ⚠️ ERA `NO_ASSOCIATE_REGISTRY` — a implementação que admite não saber —
 * porque em agosto não havia cadastro de associados. Há desde
 * `20260821000000_create_membership.sql`, e `event.audience.ts` prometia
 * exatamente isto: "no dia em que o cadastro existir, escreve-se uma
 * implementação e nada mais neste módulo muda". Nada mais mudou.
 *
 * Continua sendo uma função, e não uma constante, porque é aqui que a troca
 * acontece — e o dia em que houver uma segunda origem, é um `if` neste corpo.
 */
function audienceSource(): EventAudienceSource {
  return MEMBERS_REGISTRY;
}

/** O leitor do robô. Ver o aviso no topo do arquivo. */
function chatbotReader(): EventReader {
  return createAdminClient() as unknown as EventReader;
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

  const events = await getAvailableEvents(
    {
      segmentSlugs,
      limit: clampChatbotLimit(query.limit),
      untilDate: query.untilDate,
    },
    chatbotReader(),
  );

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
  const event = await getEvent(eventId, chatbotReader());
  if (!event) return { status: "unavailable" };

  const today = await currentEventDate();
  if (!isEventVisibleTo(event, segmentSlugs, today)) return { status: "unavailable" };

  return { status: "available", event: toChatbotEvent(event) };
}

/**
 * A listagem por associado — o que o chatbot chama de verdade.
 *
 * ⚠️ `unknown-audience` NÃO É LISTA VAZIA, e é a razão de os dois estados
 * existirem. "Não sei quem você é" e "não há eventos para você" pedem respostas
 * diferentes do bot: a primeira é encaminhamento (ou convite à filiação), a
 * segunda é só a agenda estando vazia para aquele público.
 *
 * Desde `20260914000000_event_audience_members.sql` o primeiro caso é raro e
 * significa o que diz: o telefone que escreveu não está no cadastro, ou o
 * associado está inativo.
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
  const event = await getEvent(eventId, chatbotReader());
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
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("event_today");
  if (error) {
    console.error(`[event-chatbot] event_today falhou: ${error.message}`);
    throw error;
  }

  return data as string;
}
