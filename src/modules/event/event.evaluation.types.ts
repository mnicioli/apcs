import type { Database } from "@/types/database";

/**
 * Tipos do domínio Avaliação de Evento (Prompt 2).
 *
 * ⚠️ FICAM EM `src/modules/event/`, e não num módulo novo — a mesma decisão de
 * `event.landing.types.ts`, pela mesma razão. Uma avaliação sem evento não é
 * nada, e a jornada inteira é uma só:
 *
 *   EVENTO → INSCRIÇÕES → PARTICIPANTES → PRESENÇA → AVALIAÇÃO
 *
 * Um `src/modules/evaluation/` obrigaria os dois a se importarem para responder
 * qualquer pergunta interessante ("de que evento é esta avaliação?", "quem
 * esteve presente?"), que é o formato de uma divisão errada.
 *
 * Os enums vêm do banco (via `pnpm db:types`) e não de literais escritos aqui:
 * é o que faz um valor novo no Postgres virar erro de compilação em vez de um
 * `default:` silencioso numa tela.
 */

export type EvaluationQuestionType = Database["public"]["Enums"]["event_evaluation_question_type"];
export type EvaluationStatus = Database["public"]["Enums"]["event_evaluation_status"];
export type EvaluationAuditAction = Database["public"]["Enums"]["event_evaluation_audit_action"];

/**
 * As LISTAS, para `z.enum` e para ordenar filtros.
 *
 * Os TIPOS acima vêm do banco; estas listas existem porque `z.enum` precisa de
 * uma tupla literal, que um tipo não fornece. O `satisfies` impede as duas de
 * divergirem numa direção: um valor inventado aqui não compila. A outra direção
 * — um valor novo no Postgres que ninguém trouxe para cá — é pega pelos
 * `Record<...>` de `event.evaluation.labels.ts`, que ficam incompletos.
 */
export const EVALUATION_QUESTION_TYPES = [
  "rating",
  "single_choice",
  "multiple_choice",
  "yes_no",
  "free_text",
] as const satisfies readonly EvaluationQuestionType[];

export const EVALUATION_STATUSES = [
  "pending",
  "scheduled",
  "sent",
  "answered",
  "expired",
  "cancelled",
] as const satisfies readonly EvaluationStatus[];

/**
 * Os tipos que guardam UMA alternativa escolhida.
 *
 * ⚠️ `multiple_choice` NÃO ESTÁ AQUI, e é a única diferença de comportamento
 * entre os cinco tipos na tela pública: ela desenha caixas de seleção e os
 * outros desenham botões de rádio. Uma lista, em vez de um `if` espalhado por
 * três componentes.
 */
export const SINGLE_ANSWER_TYPES: readonly EvaluationQuestionType[] = [
  "rating",
  "single_choice",
  "yes_no",
];

/** Os tipos que têm alternativas para o construtor editar (§24). */
export const OPTION_BEARING_TYPES: readonly EvaluationQuestionType[] = [
  "rating",
  "single_choice",
  "multiple_choice",
];

export function isEvaluationQuestionType(value: string): value is EvaluationQuestionType {
  return (EVALUATION_QUESTION_TYPES as readonly string[]).includes(value);
}

export function isEvaluationStatus(value: string): value is EvaluationStatus {
  return (EVALUATION_STATUSES as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* A estrutura do formulário                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Uma alternativa (§5).
 *
 * ⚠️ `value` É O NÚMERO DA ESCALA, e não a posição. Ele é obrigatório em
 * `rating` (o banco recusa sem — ver AV003) e nulo no resto. É por ele que a
 * tabulação do Prompt 3 vai somar; a posição é só onde a alternativa aparece
 * na tela.
 */
export interface EvaluationOption {
  id: string;
  label: string;
  value: number | null;
  position: number;
}

export interface EvaluationQuestion {
  id: string;
  prompt: string;
  type: EvaluationQuestionType;
  required: boolean;
  /**
   * ⚠️ A PERGUNTA DE AVALIAÇÃO GERAL (Prompt 3, §34). No máximo UMA por versão,
   * e só do tipo `rating` — o banco impõe as duas coisas.
   *
   * Ela é o que a "Nota média geral" do painel de Resultados mede, e é a
   * pergunta contra a qual os filtros de nota da lista de respostas rodam. Sem
   * nenhuma marcada, o painel mostra "N/A" em vez de inventar uma média a
   * partir de perguntas que medem coisas diferentes.
   */
  isOverall: boolean;
  position: number;
  options: EvaluationOption[];
}

export interface EvaluationSection {
  id: string;
  title: string;
  description: string | null;
  position: number;
  questions: EvaluationQuestion[];
}

/* -------------------------------------------------------------------------- */
/* A tela administrativa (§21, §22)                                            */
/* -------------------------------------------------------------------------- */

/** Uma linha da grid de eventos (§21). */
export interface EvaluationSummary {
  eventId: string;
  eventName: string;
  eventDate: string;
  startTime: string;
  endTime: string | null;
  /**
   * ⚠️ OS DOIS ABAIXO ENTRARAM NO PROMPT 3 (§3), e a tela de Avaliações os
   * ignora. Eles vêm de `public.events`, que já estava no `from` da consulta —
   * não há leitura a mais, e a grid de Avaliações continua idêntica.
   */
  location: string;
  status: Database["public"]["Enums"]["event_status"];
  configured: boolean;
  enabled: boolean;
  delayMinutes: number | null;
  responseWindowDays: number | null;
  /** Nulo quando o evento não tem `endTime` — ver `evaluationStage`. */
  sendAt: string | null;
  participants: number;
  present: number;
  sent: number;
  answered: number;
  queued: number;
}

export interface EvaluationSummaryPage {
  rows: EvaluationSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EvaluationTemplateOption {
  id: string;
  name: string;
  isDefault: boolean;
}

/** A gestão de um evento (§22). */
export interface EvaluationDetail {
  eventId: string;
  eventName: string;
  eventDate: string;
  startTime: string;
  endTime: string | null;
  enabled: boolean;
  delayMinutes: number;
  responseWindowDays: number | null;
  sendAt: string | null;
  evaluationId: string | null;
  evaluationName: string | null;
  versionId: string | null;
  version: number | null;
  /**
   * ⚠️ A TELA PRECISA DISSO ANTES DE A PESSOA SALVAR (§23). Com respostas na
   * versão corrente, salvar não edita: cria uma v+1. Descobrir isso depois de
   * clicar seria descobrir tarde.
   */
  versionHasAnswers: boolean;
  sections: EvaluationSection[];
  present: number;
  sent: number;
  answered: number;
  templates: EvaluationTemplateOption[];
}

/** Uma linha do andamento por participante (§21). */
export interface EvaluationParticipantRow {
  participantId: string;
  /** Nulo enquanto a rotina não criou a avaliação desta pessoa. */
  participantEvaluationId: string | null;
  fullName: string;
  email: string;
  companyName: string;
  confirmation: Database["public"]["Enums"]["event_participant_confirmation"];
  present: boolean;
  status: EvaluationStatus | null;
  scheduledFor: string | null;
  sentAt: string | null;
  answeredAt: string | null;
  expiresAt: string | null;
  attempts: number;
  lastError: string | null;
}

export interface EvaluationParticipantMetrics {
  present: number;
  sent: number;
  answered: number;
  failed: number;
}

export interface EvaluationParticipantPage {
  rows: EvaluationParticipantRow[];
  metrics: EvaluationParticipantMetrics;
  total: number;
  page: number;
  pageSize: number;
}

/* -------------------------------------------------------------------------- */
/* Filtros                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * O filtro de situação do andamento.
 *
 * ⚠️ `not_created` NÃO É UM VALOR DO ENUM DO BANCO, e é o filtro mais útil da
 * tela: são as pessoas presentes para quem a rotina ainda não criou nada —
 * porque o evento não terminou, porque o atraso não venceu, ou porque alguém
 * habilitou a avaliação depois do prazo. Sem ele, "cadê o convite do fulano?"
 * não tem como ser respondido pela tela.
 */
export const EVALUATION_PARTICIPANT_FILTERS = [
  "all",
  "not_created",
  ...EVALUATION_STATUSES,
] as const;

export type EvaluationParticipantFilter = (typeof EVALUATION_PARTICIPANT_FILTERS)[number];

export function isEvaluationParticipantFilter(value: string): value is EvaluationParticipantFilter {
  return (EVALUATION_PARTICIPANT_FILTERS as readonly string[]).includes(value);
}

export interface EvaluationParticipantFilters {
  query: string;
  status: EvaluationParticipantFilter;
  page: number;
}

export const EMPTY_EVALUATION_FILTERS: EvaluationParticipantFilters = {
  query: "",
  status: "all",
  page: 1,
};

/* -------------------------------------------------------------------------- */
/* A página pública (§27)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * O que o token devolve.
 *
 * ⚠️ `not_found` É UM ESTADO, E NÃO UM ERRO, e essa escolha é do §33/§34: a
 * página mostra a mesma frase neutra para token inexistente e para avaliação
 * cancelada. Distinguir os dois seria um oráculo — quem estivesse tentando
 * adivinhar saberia quando acertasse o formato.
 */
export type PublicEvaluationState = "ok" | "answered" | "expired" | "cancelled" | "not_found";

export interface PublicEvaluation {
  state: PublicEvaluationState;
  eventName: string | null;
  eventDate: string | null;
  eventLocation: string | null;
  /** ⚠️ O PRIMEIRO NOME, e não o nome inteiro — ver §29/§33 na migration. */
  firstName: string | null;
  expiresAt: string | null;
  sections: EvaluationSection[];
}
