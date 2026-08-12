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

/** No singular, para frases como "Esta normativa não tem versão ativa". */
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  normative: "normativa",
  communication: "publicação",
};

/** Plural, para títulos de tela e menu. */
export const DOCUMENT_CATEGORY_PLURAL_LABELS: Record<DocumentCategory, string> = {
  normative: "Normativas",
  communication: "Comunicação",
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
 * O texto de cada tela, por categoria.
 *
 * As duas telas são a mesma, mas não dizem a mesma coisa. Uma normativa é
 * documento regulatório que o bot cita ao responder; a Comunicação é material
 * institucional. Um subtítulo genérico ("gerencie seus documentos") não ajudaria
 * ninguém a entender o que aquela versão ativa significa na prática.
 *
 * Como é um `Record<DocumentCategory, …>`, o TypeScript cobra este arquivo
 * quando alguém acrescentar uma categoria — não dá para esquecer o texto.
 */
export interface DocumentCategoryCopy {
  /** Título da tela e rótulo no menu. */
  title: string;
  subtitle: string;
  /** Coluna que nomeia o documento na grid. */
  columnLabel: string;
  emptyList: string;
  emptyFiltered: string;
  newDocumentLabel: string;
  newDocumentHint: string;
  /** Exemplo no campo de nome — usa um documento real da categoria. */
  namePlaceholder: string;
  backToList: string;
}

export const DOCUMENT_CATEGORY_COPY: Record<DocumentCategory, DocumentCategoryCopy> = {
  normative: {
    title: "Normativas",
    subtitle: "Os documentos oficiais da APCS. A versão ativa é a que o chatbot pode citar.",
    columnLabel: "Normativa",
    emptyList: "Nenhuma normativa cadastrada.",
    emptyFiltered: "Nenhuma normativa encontrada para os filtros selecionados.",
    newDocumentLabel: "Nova normativa",
    newDocumentHint: "O cadastro nasce sem arquivo. O primeiro upload vira a v1.",
    namePlaceholder: "Ex.: Câmara Ambiental",
    backToList: "Voltar para as normativas",
  },
  communication: {
    title: "Comunicação",
    subtitle:
      "As publicações institucionais da APCS. A versão ativa é a que vale hoje e a que o chatbot pode entregar.",
    columnLabel: "Documento",
    emptyList: "Nenhum documento cadastrado.",
    emptyFiltered: "Nenhum documento encontrado para os filtros selecionados.",
    newDocumentLabel: "Novo documento",
    newDocumentHint: "O cadastro nasce sem arquivo. O primeiro upload vira a v1.",
    namePlaceholder: "Ex.: Revista",
    backToList: "Voltar para Comunicação",
  },
};

/**
 * "Disponível para Chatbot" na grid. Hoje é sempre o espelho do status, mas a
 * coluna é exibida assim mesmo: quem publica precisa ver, sem abrir nada, que
 * ativar um documento é o mesmo que soltá-lo para o robô responder.
 */
export function chatbotAvailabilityLabel(available: boolean): string {
  return available ? "Sim" : "Não";
}
