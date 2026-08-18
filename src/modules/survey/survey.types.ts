import type { Database } from "@/types/database";

/**
 * Tipos do domínio Enquetes.
 *
 * Os enums vêm do banco (via `pnpm db:types`), e não de literais escritos aqui:
 * é o que faz um valor novo no Postgres virar erro de compilação no TypeScript
 * em vez de um `default:` silencioso numa tela.
 */

export type SurveyStatus = Database["public"]["Enums"]["survey_status"];
export type SurveyAnswerType = Database["public"]["Enums"]["survey_answer_type"];
export type SurveyAudienceDimension = Database["public"]["Enums"]["survey_audience_dimension"];
export type SurveyRecipientStatus = Database["public"]["Enums"]["survey_recipient_status"];
export type SurveyDispatchStatus = Database["public"]["Enums"]["survey_dispatch_status"];
export type SurveyResponseOutcome = Database["public"]["Enums"]["survey_response_outcome"];
export type SurveyAuditAction = Database["public"]["Enums"]["survey_audit_action"];

/**
 * As LISTAS, para `z.enum` e para ordenar filtros.
 *
 * ⚠️ Os TIPOS acima vêm do banco; estas listas existem porque `z.enum` precisa
 * de uma tupla literal, que um tipo não fornece. O `satisfies` é o que impede as
 * duas de divergirem numa direção: um valor inventado aqui não compila.
 *
 * A outra direção — um valor NOVO no Postgres que ninguém trouxe para cá — é
 * pega pelos `Record<Survey...,string>` de survey.labels.ts, que ficam
 * incompletos e quebram o type-check. Por isso não há asserção extra aqui: ela
 * seria uma variável sem uso, e o lint recusaria com razão.
 */
export const SURVEY_STATUSES = [
  "draft",
  "scheduled",
  "active",
  "closed",
  "cancelled",
] as const satisfies readonly SurveyStatus[];

/**
 * As situações de onde não se sai. É a mesma lista que o grafo do banco deixa
 * sem aresta de saída — aqui ela serve para a LEITURA (o que já está encerrado),
 * não para autorizar transição, que continua sendo decisão do banco.
 */
export const TERMINAL_SURVEY_STATUSES: readonly SurveyStatus[] = ["closed", "cancelled"];

export const SURVEY_AUDIENCE_DIMENSIONS = [
  "all",
  "segment",
  "category",
  "region",
  "profile",
  "portfolio",
  "contact",
] as const satisfies readonly SurveyAudienceDimension[];

export const SURVEY_SORT_FIELDS = ["createdAt", "title", "status", "startsAt", "endsAt"] as const;

/** Quem criou ou alterou. Espelha `LectureActor`. */
export interface SurveyActor {
  id: string;
  fullName: string | null;
  email: string | null;
}

/** Uma alternativa (§7). `position` é o número que a pessoa digita no chat. */
export interface SurveyOption {
  id: string;
  position: number;
  text: string;
  active: boolean;
}

/** A pergunta (§6). No MVP existe uma por enquete. */
export interface SurveyQuestion {
  id: string;
  position: number;
  text: string;
  answerType: SurveyAnswerType;
  required: boolean;
  options: SurveyOption[];
}

/**
 * Um critério de segmentação (§23 a §30).
 *
 * `segmentId`, `contactId` e `value` são mutuamente exclusivos — qual deles vale
 * depende de `dimension`. O CHECK `survey_audience_shape` impõe isso no banco;
 * aqui o tipo apenas descreve.
 */
export interface SurveyAudienceCriterion {
  dimension: SurveyAudienceDimension;
  segmentId: string | null;
  contactId: string | null;
  value: string | null;
}

/**
 * A ETAPA DERIVADA, que é o que a pessoa precisa ler na grid.
 *
 * "Ativa" sozinho engana quando a data de encerramento já passou: a urna está
 * fechada (o portão no banco recusa resposta), mas o `status` só muda quando
 * alguém — ou a rotina — encerrar. `expired` diz isso sem exigir que ninguém
 * cruze duas colunas de cabeça.
 *
 * É o mesmo desenho de `LectureStage` e da expiração derivada de Eventos.
 */
export type SurveyStage = "draft" | "scheduled" | "open" | "expired" | "closed" | "cancelled";

export interface Survey {
  id: string;
  title: string;
  description: string | null;
  status: SurveyStatus;

  startsAt: string | null;
  endsAt: string | null;
  scheduledAt: string | null;

  isAnonymous: boolean;
  allowsResponseChange: boolean;
  singleResponseOnly: boolean;

  imagePath: string | null;
  imageMime: string | null;
  imageSizeBytes: number | null;

  createdBy: SurveyActor | null;
  createdAt: string;
  updatedBy: SurveyActor | null;
  updatedAt: string;
}

/** A enquete com a pergunta e as alternativas — o que a tela de detalhe usa. */
export interface SurveyWithQuestion extends Survey {
  question: SurveyQuestion | null;
  audience: SurveyAudienceCriterion[];
}

/** §53. Uma linha por alternativa, incluindo as que ninguém escolheu. */
export interface SurveyResultRow {
  optionId: string;
  position: number;
  text: string;
  active: boolean;
  total: number;
  percentage: number;
}

/** §51/§52. Os números da campanha. */
export interface SurveyMetrics {
  totalAudience: number;
  totalSent: number;
  totalDelivered: number;
  totalRead: number;
  totalResponses: number;
  totalErrors: number;
  participationRate: number;
}

/** §55. Só existe para enquete NÃO anônima — ver `survey_participants`. */
export interface SurveyParticipant {
  contactId: string | null;
  contactName: string | null;
  optionId: string;
  optionText: string;
  answeredAt: string;
}

/** §39/§40. O estado de cada pessoa no disparo. */
export interface SurveyRecipient {
  id: string;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  status: SurveyRecipientStatus;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  providerMessageId: string | null;
}

/** §62. Uma linha da trilha. */
export interface SurveyAuditEntry {
  id: number;
  action: SurveyAuditAction;
  actor: SurveyActor | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/**
 * §68. Os filtros da listagem paginada.
 *
 * ⚠️ `region` e `profile` filtram pelo PÚBLICO da enquete, não por um campo
 * dela: "mostre as enquetes que foram para SP" é uma pergunta sobre
 * `survey_audience_criteria`, não sobre `surveys`. Por isso viram um
 * `exists(...)` no SQL, e não uma coluna.
 *
 * ⚠️ E por isso NÃO existem `segment`, `category` nem `portfolio` aqui, embora o
 * §4 os liste: nenhuma enquete pode ter esses critérios (o banco os recusa — ver
 * o GAP 1 em docs/ENQUETES.md), então os filtros nunca devolveriam nada. Um
 * controle que só sabe devolver zero é pior que a ausência dele: manda a pessoa
 * procurar um problema nas enquetes em vez de no cadastro que falta.
 */
export interface SurveyFilters {
  query?: string;
  status?: SurveyStatus;
  from?: string;
  to?: string;
  /** UF do público-alvo (§27). */
  region?: string;
  /** Perfil do público-alvo (§28). */
  profile?: string;
}

export type SurveySortField = (typeof SURVEY_SORT_FIELDS)[number];

export interface SurveySort {
  field: SurveySortField;
  ascending: boolean;
}

export const EMPTY_SURVEY_FILTERS: SurveyFilters = {};

export const DEFAULT_SURVEY_SORT: SurveySort = { field: "createdAt", ascending: false };

export interface SurveyPage {
  items: SurveyWithQuestion[];
  total: number;
  page: number;
  pageSize: number;
}

/** O público resolvido (§32) — quem receberia a enquete hoje. */
export interface SurveyAudienceMember {
  contactId: string;
  fullName: string | null;
  phone: string | null;
}

/**
 * §35 do PROMPT 3/3. Uma CORRIDA de disparo.
 *
 * Distinta de `SurveyMetrics`: as métricas são o acumulado da campanha, esta é
 * uma execução. A diferença aparece quando alguém remanda para os que falharam
 * — a campanha tem um total, e cada corrida tem o seu.
 */
export interface SurveyDispatchRun {
  id: string;
  status: SurveyDispatchStatus;
  totalRecipients: number;
  totalSent: number;
  totalErrors: number;
  startedAt: string;
  finishedAt: string | null;
}
