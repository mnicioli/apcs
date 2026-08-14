import type {
  LectureAuditAction,
  LectureFormat,
  LectureOrigin,
  LecturePriority,
  LectureSortField,
  LectureStage,
  LectureStatus,
  LectureType,
} from "./lecture.types";

/**
 * Rótulos PT-BR de Palestras. Ficam aqui, e não espalhados pelas telas, para o
 * vocabulário ser um só: se a grid diz "Em análise", o calendário e o filtro
 * dizem "Em análise" — é assim que a pessoa aprende a se localizar no sistema.
 *
 * É também o único lugar onde `Lecture` vira "Palestra": o código fala inglês, a
 * tela fala português.
 */

export const LECTURE_MODULE_TITLE = "Palestras";

export const LECTURE_MODULE_SUBTITLE =
  "As palestras da APCS — as que pedem pelo chatbot e as que o time marca.";

export const LECTURE_LABEL = "palestra";

/** O rótulo de uma palestra que ainda é só um pedido. */
export const LECTURE_REQUEST_LABEL = "solicitação";

export const LECTURE_STATUS_LABELS: Record<LectureStatus, string> = {
  requested: "Solicitada",
  under_review: "Em análise",
  approved: "Aprovada",
  rejected: "Rejeitada",
  planned: "Planejada",
  confirmed: "Confirmada",
  held: "Realizada",
  cancelled: "Cancelada",
};

/**
 * O que cada situação significa, em uma frase.
 *
 * Existe porque "Aprovada" e "Planejada" soam parecido para quem chega agora, e
 * a diferença entre elas — já tem data e responsável, ou não — é exatamente o
 * que decide o que fazer em seguida.
 */
export const LECTURE_STATUS_HINTS: Record<LectureStatus, string> = {
  requested: "Chegou e ainda não foi analisada.",
  under_review: "Alguém está avaliando o pedido.",
  approved: "Vai acontecer. Falta marcar data, horário e responsável.",
  rejected: "A APCS não vai realizar esta palestra.",
  planned: "Data definida. Ainda não foi acordada com o solicitante.",
  confirmed: "Data e horário acordados. Está na agenda.",
  held: "Aconteceu.",
  cancelled: "Não vai mais acontecer.",
};

/**
 * A etapa derivada — o que a pessoa realmente precisa ler na grid.
 *
 * "Confirmada" sozinho engana quando a data já passou: a palestra provavelmente
 * aconteceu e ninguém fechou o registro. "Aguardando registro" diz isso sem
 * exigir que ninguém cruze duas colunas de cabeça.
 */
export const LECTURE_STAGE_LABELS: Record<LectureStage, string> = {
  pending: "Em tratativa",
  scheduled: "Agendada",
  awaiting_outcome: "Aguardando registro",
  closed: "Encerrada",
};

export const LECTURE_STAGE_HINTS: Record<LectureStage, string> = {
  pending: "Ainda não entrou na agenda.",
  scheduled: "Está na agenda e a data não chegou.",
  awaiting_outcome: "A data já passou. Registre se aconteceu ou cancele.",
  closed: "Realizada, rejeitada ou cancelada.",
};

export const LECTURE_TYPE_LABELS: Record<LectureType, string> = {
  company: "Empresa",
  associate: "Associado",
  university: "Universidades",
  other: "Outros",
};

export const LECTURE_FORMAT_LABELS: Record<LectureFormat, string> = {
  in_person: "Presencial",
  online: "Online",
  hybrid: "Híbrido",
};

export const LECTURE_PRIORITY_LABELS: Record<LecturePriority, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

/**
 * A origem, dita do jeito que importa para quem opera.
 *
 * "Chatbot" não é detalhe técnico aqui: é a diferença entre um pedido de fora,
 * que espera resposta, e uma palestra que a própria APCS decidiu fazer.
 */
export const LECTURE_ORIGIN_LABELS: Record<LectureOrigin, string> = {
  chatbot: "Solicitada pelo chatbot",
  internal: "Cadastrada pelo time",
};

export const LECTURE_ORIGIN_SHORT_LABELS: Record<LectureOrigin, string> = {
  chatbot: "Chatbot",
  internal: "Interno",
};

export const LECTURE_SORT_LABELS: Record<LectureSortField, string> = {
  eventDate: "Data da palestra",
  requestedAt: "Data da solicitação",
  status: "Situação",
  city: "Cidade",
  priority: "Prioridade",
};

/**
 * A trilha em linguagem de quem lê o histórico.
 *
 * Sem jargão de banco: quem abre a auditoria quer saber o que aconteceu, não
 * qual enum foi gravado.
 */
export const LECTURE_AUDIT_ACTION_LABELS: Record<LectureAuditAction, string> = {
  lecture_created: "Palestra cadastrada",
  lecture_updated: "Cadastro alterado",
  lecture_status_changed: "Situação alterada",
  lecture_rescheduled: "Data ou horário alterados",
  lecture_responsible_assigned: "Responsável definido",
  lecture_speaker_assigned: "Palestrante definido",
  lecture_cancelled: "Palestra cancelada",
  lecture_rejected: "Solicitação rejeitada",
  lecture_outcome_registered: "Resultado registrado",
};

/** Os nomes dos campos no diff da auditoria. */
export const LECTURE_FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  theme: "Tema",
  city: "Cidade",
  location: "Local",
  type: "Tipo",
  typeOther: "Detalhe do tipo",
  format: "Formato",
  attendeesEstimated: "Participantes estimados",
  attendeesActual: "Participantes presentes",
  priority: "Prioridade",
  notes: "Observações",
  eventDate: "Data",
  startTime: "Hora de início",
  endTime: "Hora de término",
  heldAt: "Data de realização",
  outcomeNotes: "Observações da realização",
};

/**
 * O aviso de conflito de horário (§33).
 *
 * Diz o que foi encontrado e devolve a decisão a quem está olhando — nomear
 * isso como erro faria a pessoa achar que precisa desfazer algo que talvez
 * esteja certo (pode haver mais de um palestrante disponível).
 */
export function conflictWarning(count: number): string {
  if (count <= 0) return "";
  return count === 1
    ? "Há outra palestra marcada neste mesmo horário. Confira se há palestrante disponível para as duas."
    : `Há ${count} palestras marcadas neste mesmo horário. Confira se há palestrante disponível para todas.`;
}

/**
 * A resposta do chatbot quando a solicitação entra (§58).
 *
 * O protocolo vem primeiro porque é a única coisa que a pessoa precisa guardar,
 * e a frase seguinte diz o que vai acontecer — sem prometer prazo, que a APCS
 * não definiu.
 */
export function lectureRequestReceived(protocol: string): string {
  return (
    `Sua solicitação de palestra foi registrada com sucesso. Protocolo: ${protocol}. ` +
    `Nossa equipe irá analisar a solicitação e entrar em contato.`
  );
}

/**
 * A resposta do chatbot quando algo dá errado (§59).
 *
 * Uma frase só, sem detalhe de infraestrutura: nome de tabela, código de erro
 * ou stack trace numa janela de chat público não ajudam ninguém e mapeiam o
 * sistema para quem estiver medindo.
 */
export const LECTURE_REQUEST_FAILED =
  "Não consegui registrar sua solicitação agora. Tente novamente em alguns minutos.";

/** O que o chatbot responde quando o protocolo consultado não é dele. */
export const LECTURE_PROTOCOL_NOT_FOUND =
  "Não encontrei nenhuma solicitação com esse protocolo. Confira o número e tente novamente.";

/** O motivo de "voltar atrás" não estar disponível. Ver o GAP em docs/PALESTRAS.md. */
export const LECTURE_NO_BACKWARD_TRANSITION =
  "O fluxo só avança. Se a palestra não vai mais acontecer como está, cancele informando o motivo.";
