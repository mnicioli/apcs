import type { Database } from "@/types/database";
import type { EvaluationQuestionType, EvaluationStatus } from "./event.evaluation.types";

/**
 * Tipos do domínio Resultados da Avaliação (Prompt 3).
 *
 * ⚠️ FICAM EM `src/modules/event/`, junto de `event.evaluation.*`, e não num
 * módulo novo — a mesma decisão dos dois prompts anteriores. Um resultado sem
 * avaliação, e uma avaliação sem evento, não são nada.
 *
 * ⚠️ E NÃO HÁ ENUM NOVO AQUI. O §29 é explícito: "Reutilizar os status
 * efetivamente implementados no Prompt 2. Não criar uma segunda enumeração."
 * `EvaluationStatus` é importado de lá, inteiro.
 *
 * ⚠️ "FALHA" NÃO É UM STATUS, e é a pegadinha deste módulo. O §29 lista
 * "Pendente · Enviada · Respondida · Expirada · Falha", mas o enum do banco não
 * tem `failed` — o Prompt 2 decidiu que falha é TENTATIVA e não destino, então
 * ela é `scheduled` com `last_error` preenchido. O §28 pede a CONTAGEM de
 * falhas, e ela sai daí. Inventar um sexto valor de enum seria a segunda
 * enumeração que o §29 proíbe.
 */

export type EventStatus = Database["public"]["Enums"]["event_status"];

/* -------------------------------------------------------------------------- */
/* Os números do topo (§3, §5, §28)                                            */
/* -------------------------------------------------------------------------- */

export interface ResultsSummary {
  eventId: string;
  eventName: string;
  eventDate: string;
  startTime: string;
  endTime: string | null;
  location: string;
  status: EventStatus;

  participants: number;
  present: number;
  /**
   * ⚠️ SEMPRE IGUAL A `present` (§4), e existe como campo próprio mesmo assim.
   *
   * "120 inscritos, 90 confirmados, 80 presentes → elegíveis = 80. Não: 90." O
   * campo separado é o que torna a regra LEGÍVEL na tela: quem lê "Presentes 80
   * · Elegíveis 80" entende que uma coisa decorre da outra. Deduzir os elegíveis
   * de "presentes" exigiria que quem olha soubesse a regra de cor.
   */
  eligible: number;
  sent: number;
  answered: number;
  /** Quem recebeu (ou está na fila) e ainda não respondeu. */
  pending: number;
  expired: number;
  cancelled: number;
  /** `last_error` preenchido e ainda não respondida — ver o cabeçalho. */
  failed: number;
  /** Presentes para quem a rotina ainda não criou avaliação nenhuma. */
  notCreated: number;

  /** Nula quando não há pergunta marcada como geral, ou quando ninguém respondeu. */
  overallAverage: number | null;
  overallCount: number;
  /** §34. Sem ela, a tela mostra "N/A" em vez de inventar uma média. */
  hasOverallQuestion: boolean;
  /** §21. Mais de uma significa que o formulário mudou no meio do caminho. */
  answeredVersions: number;
}

/* -------------------------------------------------------------------------- */
/* A tabulação por pergunta (§7 a §11, §33, §36, §37)                          */
/* -------------------------------------------------------------------------- */

export interface ResultsOption {
  optionId: string;
  label: string;
  /** Nulo em escolha sem peso — e é o que a mantém fora das médias (§35). */
  value: number | null;
  position: number;
  total: number;
}

export interface ResultsQuestion {
  questionId: string;
  prompt: string;
  type: EvaluationQuestionType;
  required: boolean;
  isOverall: boolean;
  position: number;
  /**
   * ⚠️ QUANTAS PESSOAS responderam — e é este o denominador do percentual
   * (decisão 3 da migration). Em múltipla escolha ele é menor que `answers`, e é
   * por isso que a soma dos percentuais passa de 100% (§36).
   */
  respondents: number;
  /** Quantas LINHAS de resposta com valor numérico. */
  answers: number;
  average: number | null;
  min: number | null;
  max: number | null;
  /** §13/§35. Texto livre tem quantidade, não distribuição. */
  textCount: number;
  options: ResultsOption[];
}

export interface ResultsSection {
  sectionId: string;
  title: string;
  description: string | null;
  position: number;
  versionId: string;
  version: number;
  /** §33. Média das respostas quantitativas do bloco — nula quando não há. */
  average: number | null;
  questions: ResultsQuestion[];
}

/* -------------------------------------------------------------------------- */
/* A lista de respostas (§16, §17, §18)                                        */
/* -------------------------------------------------------------------------- */

export interface ResultsResponseRow {
  participantEvaluationId: string;
  participantId: string;
  fullName: string;
  companyName: string;
  email: string;
  phone: string | null;
  whatsapp: string | null;
  answeredAt: string;
  /** A nota dada à pergunta geral. Nula quando o formulário não tem uma. */
  overallValue: number | null;
  overallLabel: string | null;
  comment: string | null;
}

export interface ResultsResponsePage {
  rows: ResultsResponseRow[];
  total: number;
  withComment: number;
  page: number;
  pageSize: number;
}

/* -------------------------------------------------------------------------- */
/* O detalhe de uma resposta (§15)                                             */
/* -------------------------------------------------------------------------- */

export interface ResultsDetailAnswer {
  label: string | null;
  value: number | null;
  text: string | null;
}

export interface ResultsDetailQuestion {
  prompt: string;
  type: EvaluationQuestionType;
  isOverall: boolean;
  position: number;
  answers: ResultsDetailAnswer[];
}

export interface ResultsDetailSection {
  title: string;
  position: number;
  questions: ResultsDetailQuestion[];
}

export interface ResultsResponseDetail {
  participantEvaluationId: string;
  fullName: string;
  companyName: string;
  email: string;
  whatsapp: string | null;
  answeredAt: string;
  /** §21. A versão que ESTA pessoa leu — não a atual. */
  version: number;
  round: number;
  sections: ResultsDetailSection[];
}

/* -------------------------------------------------------------------------- */
/* Quem não respondeu (§31)                                                    */
/* -------------------------------------------------------------------------- */

export interface ResultsPendingRow {
  participantId: string;
  /** Nulo quando a rotina ainda não criou a avaliação desta pessoa. */
  participantEvaluationId: string | null;
  fullName: string;
  companyName: string;
  email: string;
  whatsapp: string | null;
  phone: string | null;
  status: EvaluationStatus | null;
  sentAt: string | null;
  scheduledFor: string | null;
  expiresAt: string | null;
  attempts: number;
  lastError: string | null;
}

export interface ResultsPendingMetrics {
  notCreated: number;
  queued: number;
  sent: number;
  expired: number;
  failed: number;
}

export interface ResultsPendingPage {
  rows: ResultsPendingRow[];
  metrics: ResultsPendingMetrics;
  total: number;
  page: number;
  pageSize: number;
}

/* -------------------------------------------------------------------------- */
/* A exportação (§25)                                                          */
/* -------------------------------------------------------------------------- */

export interface ResultsExportQuestion {
  questionId: string;
  /** "Infraestrutura - Recepção" — ou com a versão na frente quando há duas. */
  label: string;
}

export interface ResultsExportRow {
  fullName: string;
  companyName: string;
  email: string;
  phone: string | null;
  whatsapp: string | null;
  answeredAt: string;
  overallValue: number | null;
  comment: string | null;
  /**
   * ⚠️ UM MAPA `questionId → resposta`, e não um array na ordem das colunas. O
   * array dependeria de a rota iterar exatamente na ordem de `questions`, e o
   * dia em que as duas divergissem cada valor entraria na coluna do vizinho, em
   * silêncio. Com o mapa, a rota procura pela CHAVE.
   */
  answers: Record<string, string>;
}

export interface ResultsExport {
  eventName: string;
  eventDate: string;
  questions: ResultsExportQuestion[];
  rows: ResultsExportRow[];
}

/* -------------------------------------------------------------------------- */
/* Filtros (§14, §18)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ OS FILTROS DE NOTA USAM A PERGUNTA GERAL, E SÓ ELA (§18). "Não aplicar
 * filtro de nota indiscriminadamente a todas as perguntas" — filtrar "nota 5"
 * contra qualquer pergunta traria quem deu 5 ao café e 1 ao evento, que responde
 * a pergunta errada.
 *
 * Quando o formulário não tem pergunta geral, a tela esconde estas cinco opções
 * em vez de oferecê-las para não devolver nada.
 */
export const RESULTS_FILTERS = [
  "all",
  "with_comment",
  "rating_5",
  "rating_4",
  "rating_3",
  "rating_2",
  "rating_1",
] as const;

export type ResultsFilter = (typeof RESULTS_FILTERS)[number];

/** As que só fazem sentido com uma pergunta de avaliação geral marcada. */
export const RATING_FILTERS: readonly ResultsFilter[] = [
  "rating_5",
  "rating_4",
  "rating_3",
  "rating_2",
  "rating_1",
];

export function isResultsFilter(value: string): value is ResultsFilter {
  return (RESULTS_FILTERS as readonly string[]).includes(value);
}

/** Qual aba da tela está aberta. Mora na URL como o resto. */
export const RESULTS_TABS = ["dashboard", "responses", "pending"] as const;
export type ResultsTab = (typeof RESULTS_TABS)[number];

export function isResultsTab(value: string): value is ResultsTab {
  return (RESULTS_TABS as readonly string[]).includes(value);
}

export interface ResultsFilters {
  tab: ResultsTab;
  query: string;
  filter: ResultsFilter;
  page: number;
}

export const EMPTY_RESULTS_FILTERS: ResultsFilters = {
  tab: "dashboard",
  query: "",
  filter: "all",
  page: 1,
};

export const RESULTS_PAGE_SIZE = 25;
