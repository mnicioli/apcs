/**
 * Tipos de domínio de Eventos (camelCase), desacoplados das linhas cruas do
 * banco (snake_case).
 *
 * Os enums espelham os do Postgres criados em
 * `supabase/migrations/20260813000000_create_events.sql`. Ao mudar um, mude os
 * dois — o `as const` aqui é a fonte da verdade para o TypeScript.
 *
 * ⚠️ DOIS CONCEITOS DE STATUS, e confundi-los é o erro fácil deste módulo:
 *
 *   `status`           o que uma PESSOA decidiu (enum do banco: active/inactive)
 *   `effectiveStatus`  o que VALE agora, derivado da data (active/inactive/expired)
 *
 * Só o primeiro é gravado. "Expirado" nunca é escrito em lugar nenhum: é
 * calculado toda vez que alguém lê. Ver `event.rules.ts` e o cabeçalho da
 * migration.
 */

/** O que se grava: apenas a decisão humana. */
export const EVENT_STATUSES = ["active", "inactive"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/**
 * O que se lê. `expired` não existe no banco — é a leitura de um evento que
 * ninguém inativou mas cuja data já passou.
 */
export const EVENT_EFFECTIVE_STATUSES = ["active", "inactive", "expired"] as const;
export type EventEffectiveStatus = (typeof EVENT_EFFECTIVE_STATUSES)[number];

/**
 * Por que o evento não está no ar. É a `status_reason` do escopo, derivada em
 * vez de gravada: com a expiração calculada, uma coluna seria sempre uma cópia
 * do que já se sabe — e cópias saem de sincronia.
 */
export type EventStatusReason = "manual" | "expired";

/** Abas do filtro de status. `all` é o padrão: a grid abre mostrando tudo. */
export const EVENT_STATUS_FILTERS = ["all", "active", "inactive"] as const;
export type EventStatusFilter = (typeof EVENT_STATUS_FILTERS)[number];

export const DEFAULT_EVENT_STATUS_FILTER: EventStatusFilter = "all";

export function isEventStatusFilter(value: string): value is EventStatusFilter {
  return (EVENT_STATUS_FILTERS as readonly string[]).includes(value);
}

/** Quem fez uma operação, já com o nome resolvido para exibir. */
export interface EventActor {
  id: string;
  fullName: string | null;
}

/**
 * Um público-alvo do catálogo.
 *
 * `slug` é a chave estável para o futuro resolvedor de audiência; `name` é
 * rótulo de tela e pode ser renomeado sem quebrar nada.
 */
export interface EventSegment {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

/**
 * O atalho "Toda a base".
 *
 * Não é um público como os outros: escolhê-lo faz o BANCO trocá-lo pelos
 * públicos reais na hora de gravar (`expand_event_segments`), e ele mesmo nunca
 * fica vinculado a evento nenhum.
 *
 * O slug é `all-members` por história — foi o primeiro público do catálogo, e
 * renomeá-lo na tela não muda a chave. É exatamente para isso que o slug é
 * imutável.
 *
 * ⚠️ Só a APRESENTAÇÃO conhece este valor, para pôr o atalho no topo da lista.
 * Nenhuma regra de elegibilidade o consulta: `matchesAnySegment` continua sem
 * caso especial, e é disso que vem a confiança nela.
 */
export const AUDIENCE_SHORTCUT_SLUG = "all-members";

/**
 * Um evento, na forma que as telas e o chatbot consomem.
 *
 * `imagePath` NÃO está aqui de propósito — o caminho no bucket nunca precisa
 * chegar ao navegador. O que vai é `imageUrl`, uma URL assinada de vida curta
 * emitida no servidor depois de checar a permissão.
 */
export interface EventSummary {
  id: string;
  name: string;
  location: string;
  registrationUrl: string | null;
  /** Data pura AAAA-MM-DD, sem hora e sem fuso. */
  eventDate: string;
  /** "HH:MM" — já recortado do `time` do Postgres, que vem como "HH:MM:SS". */
  startTime: string;
  endTime: string | null;
  /** A decisão humana gravada. Para exibir, use `effectiveStatus`. */
  status: EventStatus;
  /** URL assinada da imagem, ou `null` se não foi possível emitir. */
  imageUrl: string | null;
  segments: EventSegment[];
  createdBy: EventActor | null;
  createdAt: string;
  updatedBy: EventActor | null;
  updatedAt: string;
}

/** Uma entrada da trilha de auditoria. */
export interface EventAuditEntry {
  id: number;
  action: EventAuditAction;
  actor: EventActor | null;
  createdAt: string;
  /** Livre por ação. Para `event_updated`, traz `changes: EventFieldChange[]`. */
  metadata: Record<string, unknown>;
}

export const EVENT_AUDIT_ACTIONS = [
  "event_created",
  "event_updated",
  "event_activated",
  "event_deactivated",
  "event_image_uploaded",
  "event_image_replaced",
  "event_segments_updated",
] as const;
export type EventAuditAction = (typeof EVENT_AUDIT_ACTIONS)[number];

/** Uma alteração registrada: campo, valor anterior, novo valor. */
export interface EventFieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

/** Filtros da grid, lidos da URL. */
export interface EventFilters {
  /** Busca parcial por nome. String vazia = sem filtro. */
  query: string;
  status: EventStatusFilter;
  /** Recorte por período, inclusivo nas duas pontas. Vazio = sem limite. */
  from: string;
  to: string;
}
