import type {
  ChatContactChannel,
  ChatContactProfile,
  ChatContactTime,
  ChatConversationStatus,
  CspInterest,
  CspVolumeRange,
  LeadStatus,
} from "./chat.types";

/**
 * Rótulos PT-BR dos enums do domínio. Ficam aqui (e não espalhados) porque são
 * usados nos dois lados: nas opções que o bot oferece no chat público e nas
 * telas do backoffice.
 */

export const CONTACT_PROFILE_LABELS: Record<ChatContactProfile, string> = {
  producer: "Produtor",
  member: "Associado",
  supplier: "Fornecedor",
};

export const INTEREST_LABELS: Record<CspInterest, string> = {
  input: "Insumo",
  feed: "Ração",
  logistics: "Logística",
  information: "Informação",
};

// TODO(APCS): confirmar as faixas oficiais de porte da granja com o time.
export const VOLUME_RANGE_LABELS: Record<CspVolumeRange, string> = {
  up_to_50: "Até 50 matrizes",
  from_50_to_200: "De 50 a 200 matrizes",
  from_200_to_1000: "De 200 a 1.000 matrizes",
  above_1000: "Mais de 1.000 matrizes",
  not_applicable: "Não se aplica",
};

export const CONTACT_CHANNEL_LABELS: Record<ChatContactChannel, string> = {
  whatsapp: "WhatsApp",
  phone: "Telefone",
  email: "E-mail",
};

export const CONTACT_TIME_LABELS: Record<ChatContactTime, string> = {
  morning: "Manhã",
  afternoon: "Tarde",
  evening: "Fim do dia",
  any: "Qualquer horário",
};

/**
 * O que o BOT fez com a conversa. Descreve o desfecho da triagem, não o
 * atendimento humano — esse é derivado e vive em `src/modules/attendance/`.
 */
export const CONVERSATION_STATUS_LABELS: Record<ChatConversationStatus, string> = {
  active: "Em andamento",
  completed: "Triagem concluída",
  handoff: "Encaminhada ao time",
  declined: "Consentimento recusado",
  abandoned: "Encerrada pelo limite",
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "Novo",
  in_contact: "Em contato",
  qualified: "Qualificado",
  discarded: "Descartado",
};
