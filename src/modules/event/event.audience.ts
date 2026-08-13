import type { EventSegment } from "./event.types";

/**
 * A audiência de um evento — quem, entre os associados, é elegível a recebê-lo.
 *
 * ⚠️ LEIA ISTO ANTES DE MEXER: **não existe cadastro de associados neste
 * sistema.** Foi verificado contra o banco, não suposto:
 *
 *   - as tabelas de pessoas são `profiles` (usuários do CRM) e `chat_contacts`;
 *   - `chat_contacts` grava UMA LINHA POR TRIAGEM CONCLUÍDA e não tem nenhuma
 *     restrição única além da chave primária — hoje são 10 linhas para 7
 *     telefones distintos. É um registro de leads, não de identidade;
 *   - `contact_profile` ('producer' | 'member' | 'supplier') é uma resposta que
 *     a própria pessoa deu na triagem, não uma filiação verificada;
 *   - nenhuma tabela relaciona pessoas a `event_segments`.
 *
 * Então este arquivo entrega o que dá para entregar com honestidade: TODA a
 * lógica de elegibilidade (união dos segmentos, OU, deduplicação), e uma PORTA
 * declarada para a origem dos associados — sem implementá-la com dado
 * inventado.
 *
 * No dia em que o cadastro existir, escreve-se uma implementação de
 * `EventAudienceSource` e nada mais neste módulo muda.
 */

/** Por que a audiência não pôde ser resolvida. Hoje só existe um motivo. */
export type AudienceUnavailableReason = "no-associate-registry";

/**
 * O resultado de uma consulta à origem de associados.
 *
 * ⚠️ `{ available: false }` NÃO é `{ available: true, value: [] }`, e a
 * diferença é a razão de este tipo existir.
 *
 *   "não sei quem são"  →  não dá para decidir nada
 *   "não é ninguém"     →  a resposta é zero pessoas
 *
 * Colapsar os dois num array vazio faria uma futura campanha "enviar para
 * ninguém" e reportar sucesso. É o mesmo erro que o escopo proíbe do outro
 * lado (nunca ler "sem segmento" como "todos os associados"): ausência de dado
 * não é um valor.
 */
export type AudienceLookup<T> =
  | { available: true; value: T }
  | { available: false; reason: AudienceUnavailableReason };

/**
 * A PORTA. Quem souber ligar uma pessoa a segmentos implementa isto.
 *
 * Mínima de propósito: dois métodos, os dois necessários hoje (um para a
 * consulta do chatbot, outro para a futura campanha). Nada especulativo —
 * telefone, opt-in e canal NÃO entram aqui, porque quem envia é que resolve
 * isso, não quem decide elegibilidade (ver docs/EVENTS.md).
 */
export interface EventAudienceSource {
  /** Identifica a implementação nos logs. */
  readonly id: string;
  /** Os slugs de segmento a que um associado pertence. */
  segmentsForAssociate(associateId: string): Promise<AudienceLookup<string[]>>;
  /** Os ids de associado que pertencem a QUALQUER um dos segmentos (OU). */
  associatesInSegments(segmentSlugs: string[]): Promise<AudienceLookup<string[]>>;
}

/**
 * A única implementação de hoje: a que admite que não sabe.
 *
 * Não é um stub preguiçoso — é a resposta correta enquanto não houver cadastro
 * de associados. Devolver `[]` seria afirmar que ninguém é elegível, o que é
 * uma mentira diferente da verdade "esta pergunta ainda não tem fonte".
 */
export const NO_ASSOCIATE_REGISTRY: EventAudienceSource = {
  id: "no-associate-registry",
  async segmentsForAssociate() {
    return { available: false, reason: "no-associate-registry" };
  },
  async associatesInSegments() {
    return { available: false, reason: "no-associate-registry" };
  },
};

/**
 * A união dos associados de vários segmentos, SEM repetir ninguém.
 *
 * A regra é OU (o escopo é explícito: nunca E por padrão): pertencer a um
 * segmento do evento basta. E quem pertence a dois segmentos do mesmo evento
 * aparece UMA vez — senão a campanha mandaria a mesma mensagem duas vezes para
 * a mesma pessoa.
 *
 * `Set` preserva a ordem de primeira aparição, o que torna o resultado estável
 * e o teste legível.
 */
export function unionAudience(lists: readonly (readonly string[])[]): string[] {
  return [...new Set(lists.flat())];
}

/** O associado pertence a algum dos segmentos do evento? (OU) */
export function matchesAnySegment(
  eventSegments: readonly Pick<EventSegment, "slug">[],
  associateSegmentSlugs: readonly string[],
): boolean {
  // Evento sem público-alvo não alcança ninguém. Ler ausência de segmento como
  // "todos" é exatamente o que geraria comunicação indevida.
  if (eventSegments.length === 0) return false;

  const pertence = new Set(associateSegmentSlugs);
  return eventSegments.some((segment) => pertence.has(segment.slug));
}

/** O que `resolveEventAudience` devolve. */
export type EventAudience =
  | { status: "resolved"; segments: EventSegment[]; associateIds: string[] }
  /** O evento existe e tem público, mas não há de onde tirar os associados. */
  | { status: "unavailable"; segments: EventSegment[]; reason: AudienceUnavailableReason }
  /**
   * O evento existe e NÃO tem público-alvo. A audiência é vazia, e isso é uma
   * afirmação — não a mesma coisa que "não sei". Estado que o cadastro impede
   * de criar; existe para o caso de inconsistência histórica.
   */
  | { status: "no-segments" }
  | { status: "not-found" };
