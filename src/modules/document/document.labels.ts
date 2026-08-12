import type {
  DocumentCategory,
  DocumentStatusFilter,
  DocumentVersionStatus,
} from "./document.types";

/**
 * Rótulos PT-BR da gestão documental. Ficam aqui, e não espalhados pelas telas,
 * para o vocabulário ser um só: se a grid diz "Ativo", o histórico e o filtro
 * dizem "Ativo" — é assim que a pessoa aprende a se localizar no sistema.
 */

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  normative: "Normativa",
};

/** Plural, para títulos de tela e menu. */
export const DOCUMENT_CATEGORY_PLURAL_LABELS: Record<DocumentCategory, string> = {
  normative: "Normativas",
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentVersionStatus, string> = {
  active: "Ativo",
  inactive: "Inativo",
};

export const DOCUMENT_STATUS_FILTER_LABELS: Record<DocumentStatusFilter, string> = {
  all: "Todos",
  active: "Ativo",
  inactive: "Inativo",
};

/**
 * "Disponível para Chatbot" na grid. Hoje é sempre o espelho do status, mas a
 * coluna é exibida assim mesmo: quem publica precisa ver, sem abrir nada, que
 * ativar um documento é o mesmo que soltá-lo para o robô responder.
 */
export function chatbotAvailabilityLabel(available: boolean): string {
  return available ? "Sim" : "Não";
}
