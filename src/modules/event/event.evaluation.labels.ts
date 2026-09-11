import type {
  EvaluationAuditAction,
  EvaluationQuestionType,
  EvaluationParticipantFilter,
  EvaluationStatus,
} from "./event.evaluation.types";

/**
 * Os textos PT-BR da Avaliação de Evento.
 *
 * ⚠️ OS `Record<Enum, string>` SÃO UMA BARREIRA, e não uma conveniência. Um
 * valor novo no enum do Postgres chega ao TypeScript pelo `pnpm db:types` e
 * derruba o type-check aqui, porque o `Record` fica incompleto. Sem isso, a
 * tela mostraria a chave crua do banco ("invitation_failed") para quem opera —
 * ou, pior, `undefined`.
 */

export const EVALUATION_MODULE_TITLE = "Avaliações";
export const EVALUATION_MODULE_SUBTITLE =
  "A pesquisa de opinião que vai para quem esteve presente no evento.";

export const EVALUATION_QUESTION_TYPE_LABELS: Record<EvaluationQuestionType, string> = {
  // "Nota", e não "rating": é a palavra que aparece no formulário de papel que a
  // APCS usa hoje, e quem vai montar a avaliação conhece essa.
  rating: "Nota (escala)",
  single_choice: "Escolha única",
  multiple_choice: "Múltipla escolha",
  yes_no: "Sim / Não",
  free_text: "Texto livre",
};

export const EVALUATION_QUESTION_TYPE_HELP: Record<EvaluationQuestionType, string> = {
  rating:
    "Uma escala com valor numérico em cada alternativa. É o que vira média na apuração — as outras não viram.",
  single_choice: "Uma alternativa entre várias, sem peso numérico.",
  multiple_choice: "Quantas alternativas a pessoa quiser.",
  yes_no: "As alternativas são geradas pelo sistema: Sim e Não.",
  free_text: "Um campo aberto. Não entra em média nenhuma — é para ler.",
};

export const EVALUATION_STATUS_LABELS: Record<EvaluationStatus, string> = {
  pending: "Sem data de envio",
  scheduled: "Na fila",
  sent: "Enviada",
  answered: "Respondida",
  expired: "Expirada",
  cancelled: "Cancelada",
};

export type EvaluationBadgeVariant = "default" | "attention" | "done" | "alert";

/**
 * ⚠️ `attention` É "PEDE AÇÃO DE ALGUÉM", e por isso `sent` NÃO o usa. Uma
 * avaliação enviada está esperando a pessoa responder — não há nada para a APCS
 * fazer. O que pede olho humano é a falha, e ela chega por `lastError`, não por
 * situação (ver `event.evaluation.rules.ts`).
 */
export const EVALUATION_STATUS_VARIANTS: Record<EvaluationStatus, EvaluationBadgeVariant> = {
  pending: "alert",
  scheduled: "default",
  sent: "default",
  answered: "done",
  expired: "done",
  cancelled: "done",
};

export const EVALUATION_PARTICIPANT_FILTER_LABELS: Record<EvaluationParticipantFilter, string> = {
  all: "Todas as situações",
  not_created: "Ainda não gerada",
  pending: "Sem data de envio",
  scheduled: "Na fila",
  sent: "Enviada",
  answered: "Respondida",
  expired: "Expirada",
  cancelled: "Cancelada",
};

export const EVALUATION_AUDIT_LABELS: Record<EvaluationAuditAction, string> = {
  evaluation_created: "Avaliação criada",
  settings_changed: "Configuração de envio alterada",
  structure_changed: "Perguntas alteradas",
  version_published: "Nova versão publicada",
  invitation_sent: "Convite enviado",
  invitation_failed: "Falha no envio do convite",
  invitation_resent: "Convite reenviado",
  invitation_cancelled: "Convite cancelado",
  evaluation_answered: "Avaliação respondida",
  evaluation_reopened: "Avaliação reaberta",
  // Prompt 3, §42. A única ação de RESULTADOS que deixa rastro — ver o
  // cabeçalho de 20261003000000_event_evaluation_results_enums.sql.
  results_exported: "Planilha de resultados baixada",
};

/**
 * A frase que a grid mostra na coluna "Situação" (§21).
 *
 * ⚠️ ELA NÃO É UM ENUM DO BANCO, e não deve ser. É a leitura de quatro fatos —
 * habilitada, configurada, o evento tem término, já passou da hora — e gravá-la
 * criaria uma quinta cópia que sai de sincronia com os quatro. É o mesmo
 * raciocínio de `LandingPageStatusReason` e de `SurveyStage`.
 */
export type EvaluationStage = "disabled" | "blocked_no_end_time" | "waiting" | "sending" | "done";

export const EVALUATION_STAGE_LABELS: Record<EvaluationStage, string> = {
  disabled: "Desligada",
  blocked_no_end_time: "Falta o término do evento",
  waiting: "Aguardando o evento",
  sending: "Enviando",
  done: "Envio concluído",
};

export const EVALUATION_STAGE_VARIANTS: Record<EvaluationStage, EvaluationBadgeVariant> = {
  disabled: "default",
  // ⚠️ O ÚNICO `alert` DA LISTA. Habilitada e sem poder enviar é a combinação
  // que a pessoa precisa ver de longe: o evento vai passar e ninguém vai receber
  // nada. Ver §10 e AV001.
  blocked_no_end_time: "alert",
  waiting: "attention",
  sending: "attention",
  done: "done",
};

/**
 * A mensagem PADRÃO do convite (§13).
 *
 * ⚠️ ELA NÃO É A MENSAGEM — é o que sobra se a linha sumir do banco. O texto de
 * verdade mora em `app_settings`, na chave `events.evaluation_invite`, editável
 * em Configurações → Textos e LGPD sem deploy. É o mesmo desenho de
 * `SETTING_FALLBACKS`, e a duplicação é deliberada: um convite vazio no WhatsApp
 * é uma mensagem que nem chega a ser enviada, e a pessoa nunca saberia que havia
 * uma avaliação.
 */
export const EVALUATION_INVITE_FALLBACK =
  "Olá, {{nome}}! 👋\n\n" +
  "Obrigado por participar do evento {{evento}}, em {{data_evento}}.\n\n" +
  "Gostaríamos de saber a sua opinião. A avaliação leva poucos minutos e nos " +
  "ajuda a melhorar os próximos encontros.\n\n" +
  "👉 Responder: {{link_avaliacao}}\n\n" +
  "Obrigado!\nAPCS";

/**
 * As variáveis que o convite aceita (§13).
 *
 * ⚠️ LISTA FECHADA, e é ela que a tela de Textos mostra como ajuda. Uma variável
 * escrita errado no texto (`{{nome_completo}}`) não quebra nada: ela sai
 * literal na mensagem. Por isso a lista precisa estar VISÍVEL onde o texto é
 * editado — não há validação que a substitua.
 */
export const EVALUATION_INVITE_VARIABLES = [
  "{{nome}}",
  "{{evento}}",
  "{{data_evento}}",
  "{{link_avaliacao}}",
] as const;

/** Os textos da página pública (§27, §28). */
export const PUBLIC_EVALUATION_COPY = {
  title: "Pesquisa de opinião",
  greeting: (firstName: string | null) => (firstName ? `Olá, ${firstName}!` : "Olá!"),
  intro:
    "Sua opinião ajuda a APCS a melhorar os próximos encontros. " +
    "São poucos minutos e as perguntas marcadas com * são obrigatórias.",
  submit: "Enviar avaliação",
  submitting: "Enviando…",

  // ⚠️ AS TRÊS FRASES DE BECO SEM SAÍDA. Nenhuma delas oferece um botão, e é de
  // propósito: quem chega aqui não tem o que fazer na página, e um "tente
  // novamente" mandaria a pessoa repetir a única coisa que nunca vai funcionar.
  answeredTitle: "Esta avaliação já foi respondida.",
  answeredBody: "Obrigado pela participação!",
  expiredTitle: "Esta avaliação não está mais disponível.",
  expiredBody: "O prazo de resposta terminou. Obrigado pelo interesse!",
  // ⚠️ A MESMA FRASE PARA TOKEN INEXISTENTE E PARA CANCELADA (§33). Distinguir
  // as duas contaria a quem estiver adivinhando quando o palpite acertou.
  unavailableTitle: "Esta avaliação não está disponível.",
  unavailableBody: "Confira se o link está completo ou fale com a APCS.",

  successTitle: "Avaliação enviada!",
  successBody: "Obrigado por dedicar alguns minutos. Sua opinião chegou à APCS.",
} as const;

/** "30 minutos" / "2 horas" — o atraso do §9 escrito como gente fala. */
export function delayLabel(minutes: number): string {
  if (minutes === 0) return "assim que o evento terminar";
  if (minutes < 60) return `${minutes} minuto${minutes === 1 ? "" : "s"} após o término`;

  const horas = minutes / 60;
  if (Number.isInteger(horas)) {
    return `${horas} hora${horas === 1 ? "" : "s"} após o término`;
  }
  return `${minutes} minutos após o término`;
}

/** "7 dias para responder" / "sem prazo" (§9, §20). */
export function responseWindowLabel(days: number | null): string {
  if (days === null) return "sem prazo para responder";
  return `${days} dia${days === 1 ? "" : "s"} para responder`;
}
