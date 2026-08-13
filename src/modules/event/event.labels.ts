import type {
  EventAuditAction,
  EventEffectiveStatus,
  EventStatusFilter,
  EventStatusReason,
} from "./event.types";

/**
 * Rótulos PT-BR de Eventos. Todo texto que o usuário lê sai daqui — a UI não
 * inventa string. Sendo `Record`s completos, o TypeScript aponta cada lugar que
 * falta quando um valor novo entra num enum.
 */

/**
 * "Expirado" aparece na tela mesmo o escopo listando só ATIVO/INATIVO como
 * status. O motivo é prático: um evento marcado "Inativo" que ninguém inativou
 * faz a pessoa procurar quem foi. O FILTRO continua com três opções (Todos,
 * Ativo, Inativo) — Expirado cai dentro de Inativo.
 */
export const EVENT_STATUS_LABELS: Record<EventEffectiveStatus, string> = {
  active: "Ativo",
  inactive: "Inativo",
  expired: "Expirado",
};

export const EVENT_STATUS_FILTER_LABELS: Record<EventStatusFilter, string> = {
  all: "Todos",
  active: "Ativo",
  inactive: "Inativo",
};

export const EVENT_STATUS_REASON_LABELS: Record<EventStatusReason, string> = {
  manual: "Inativado manualmente",
  expired: "A data do evento já passou",
};

export const EVENT_AUDIT_ACTION_LABELS: Record<EventAuditAction, string> = {
  event_created: "Evento cadastrado",
  event_updated: "Evento editado",
  event_activated: "Evento ativado",
  event_deactivated: "Evento inativado",
  event_image_uploaded: "Imagem enviada",
  event_image_replaced: "Imagem substituída",
  event_segments_updated: "Público-alvo alterado",
};

/**
 * Nome de campo para a trilha de auditoria.
 *
 * O banco grava a chave em camelCase (`eventDate`); quem lê a auditoria precisa
 * ver "Data do evento". Campo desconhecido cai no próprio nome em vez de sumir:
 * um registro de auditoria incompleto é pior que um rótulo feio.
 */
const AUDIT_FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  location: "Local",
  registrationUrl: "Link de inscrição",
  eventDate: "Data do evento",
  startTime: "Hora de início",
  endTime: "Hora de término",
};

export function auditFieldLabel(field: string): string {
  return AUDIT_FIELD_LABELS[field] ?? field;
}

/** Texto das confirmações de ativação e inativação (itens 22 do escopo). */
export const EVENT_CONFIRMATION_COPY = {
  activate:
    "Deseja ativar este evento? Ele poderá ser disponibilizado para consulta e " +
    "comunicação aos associados conforme sua segmentação.",
  deactivate:
    "Deseja realmente inativar este evento? Eventos inativos não serão " +
    "disponibilizados para o chatbot e futuras comunicações.",
} as const;
