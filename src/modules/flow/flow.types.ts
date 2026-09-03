/**
 * Os tipos dos FLUXOS DE ATENDIMENTO.
 *
 * ⚠️ DUAS REPRESENTAÇÕES DO MESMO DESENHO, E ELAS NÃO SÃO INTERCAMBIÁVEIS:
 *
 *   `FlowNode` / `FlowTransition`     as LINHAS editáveis de um rascunho
 *   `FlowDefinition`                  o RETRATO CONGELADO de uma versão publicada
 *
 * Quem edita fala com as primeiras; quem EXECUTA fala com a segunda, e só com
 * ela. A travessia entre as duas acontece uma vez, na publicação, dentro de
 * `compile_flow_definition()` no banco — ver
 * supabase/migrations/20260917000100_flows.sql, seções 4 e 11.
 *
 * Misturá-las é o erro que este arquivo existe para tornar difícil: o motor que
 * lesse `FlowNode` estaria lendo um desenho que alguém pode estar arrastando
 * neste instante.
 */

/* -------------------------------------------------------------------------- */
/* Enums — espelham os tipos da migration 20260917000000_flow_enums.sql        */
/* -------------------------------------------------------------------------- */

export const FLOW_CHANNELS = ["whatsapp", "web"] as const;
export type FlowChannel = (typeof FLOW_CHANNELS)[number];

/** O interruptor do fluxo. Não confundir com o ciclo de vida da VERSÃO. */
export const FLOW_STATUSES = ["active", "inactive"] as const;
export type FlowStatus = (typeof FLOW_STATUSES)[number];

/**
 * O ciclo de vida de uma versão (§4).
 *
 * A ORDEM DA LISTA É A ORDEM DO CICLO, e a interface conta com isso para
 * desenhar a trilha de etapas. `superseded` fica no fim porque é o destino de
 * quem já foi publicada — não uma etapa que se percorre.
 */
export const FLOW_VERSION_STATUSES = [
  "draft",
  "testing",
  "pending_approval",
  "approved",
  "published",
  "superseded",
] as const;
export type FlowVersionStatus = (typeof FLOW_VERSION_STATUSES)[number];

export const FLOW_NODE_TYPES = [
  "message",
  "question",
  "condition",
  "action",
  "attendant",
  "end",
] as const;
export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];

export const FLOW_RUN_STATUSES = [
  "running",
  "waiting_reply",
  "handed_off",
  "completed",
  "failed",
  "cancelled",
] as const;
export type FlowRunStatus = (typeof FLOW_RUN_STATUSES)[number];

export const FLOW_CONVERSATION_STATUSES = [
  "new",
  "triage",
  "waiting_reply",
  "in_service",
  "waiting_customer",
  "resolved",
  "closed",
] as const;
export type FlowConversationStatus = (typeof FLOW_CONVERSATION_STATUSES)[number];

export const ATTENDANCE_TEAM_STATUSES = ["active", "inactive"] as const;
export type AttendanceTeamStatus = (typeof ATTENDANCE_TEAM_STATUSES)[number];

/* -------------------------------------------------------------------------- */
/* Times de atendimento (§11)                                                 */
/* -------------------------------------------------------------------------- */

export interface AttendanceTeamMember {
  profileId: string;
  fullName: string | null;
  email: string | null;
  addedAt: string;
}

export interface AttendanceTeam {
  id: string;
  /** A chave estável — `TIME_MARKETING`. É o que a versão publicada guarda. */
  key: string;
  name: string;
  description: string | null;
  status: AttendanceTeamStatus;
  /** Quantas pessoas estão no time agora. Trocar isso não mexe em fluxo (§11). */
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceTeamDetail extends AttendanceTeam {
  members: AttendanceTeamMember[];
}

/* -------------------------------------------------------------------------- */
/* Quem mexeu                                                                 */
/* -------------------------------------------------------------------------- */

export interface FlowActor {
  id: string;
  fullName: string | null;
}

/* -------------------------------------------------------------------------- */
/* Fluxo e versão                                                             */
/* -------------------------------------------------------------------------- */

export interface Flow {
  id: string;
  name: string;
  description: string | null;
  channel: FlowChannel;
  status: FlowStatus;
  /** Onde a conversa começa naquele canal. No máximo um por canal. */
  isEntry: boolean;
  /** A versão que está no ar. `null` enquanto nenhuma foi publicada. */
  activeVersionId: string | null;
  /** O número da versão no ar — o que a grid mostra ("v3"). */
  activeVersionNumber: number | null;
  /** Quantas versões existem, inclusive as substituídas. Nada se apaga (§22). */
  versionCount: number;
  createdBy: FlowActor | null;
  createdAt: string;
  updatedBy: FlowActor | null;
  updatedAt: string;
}

export interface FlowVersion {
  id: string;
  flowId: string;
  version: number;
  status: FlowVersionStatus;
  notes: string | null;
  /**
   * ⚠️ `null` ENQUANTO RASCUNHO, E ISSO É A REGRA, NÃO UM DADO FALTANDO. Uma
   * versão só ganha retrato congelado ao ser publicada — antes disso a
   * autoridade são as linhas de `flow_nodes`/`flow_transitions`. Ver o CHECK
   * `flow_versions_definition_shape`.
   */
  definition: FlowDefinition | null;
  publishedAt: string | null;
  publishedBy: FlowActor | null;
  createdBy: FlowActor | null;
  createdAt: string;
  updatedBy: FlowActor | null;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* O desenho editável                                                         */
/* -------------------------------------------------------------------------- */

/** Onde o nó aparece no canvas (§7). O Prompt 2 é quem vai desenhá-lo. */
export interface FlowNodePosition {
  x: number;
  y: number;
}

export interface FlowNode {
  id: string;
  flowVersionId: string;
  type: FlowNodeType;
  /** Chave estável dentro da versão — `PERGUNTA_ASSUNTO` (§10). */
  key: string;
  name: string;
  /** A forma depende do tipo. Validada por `flowNodeConfigurationSchema`. */
  configuration: Record<string, unknown>;
  position: FlowNodePosition;
  metadata: Record<string, unknown>;
  isStart: boolean;
}

/**
 * A condição de uma transição (§9, §10).
 *
 * ⚠️ NUNCA UM NÚMERO DE OPÇÃO. `{ type: "answer", optionKey: "EVENTOS" }`
 * continua valendo quando alguém reordenar as alternativas na tela; um
 * `{ option: 1 }` passaria a mandar para Filiação sem que nada acusasse.
 */
export type FlowTransitionCondition =
  | { type: "always" }
  | { type: "answer"; optionKey: string }
  | { type: "variable"; name: string; equals: string };

export interface FlowTransition {
  id: string;
  flowVersionId: string;
  sourceNodeId: string;
  targetNodeId: string;
  condition: FlowTransitionCondition;
  /** O que a seta mostra no desenho. É rótulo, não regra. */
  label: string | null;
  /** Desempate quando mais de uma condição casa. Menor primeiro. */
  priority: number;
}

/* -------------------------------------------------------------------------- */
/* O retrato congelado — o que o MOTOR lê                                     */
/* -------------------------------------------------------------------------- */

export interface CompiledFlowNode {
  id: string;
  key: string;
  type: FlowNodeType;
  name: string;
  isStart: boolean;
  configuration: Record<string, unknown>;
  position: FlowNodePosition;
  metadata: Record<string, unknown>;
}

export interface CompiledFlowTransition {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  condition: FlowTransitionCondition;
  label: string | null;
  priority: number;
}

/**
 * O documento que `compile_flow_definition()` monta na publicação (§24).
 *
 * `schema: 1` não é enfeite: ele é o que permite mudar a forma deste documento
 * um dia sem ter de adivinhar, diante de um jsonb gravado em 2026, qual leitor
 * usar. Versões antigas nunca são reescritas (§22), então o leitor é que
 * precisa saber com o que está falando.
 */
export interface FlowDefinition {
  schema: 1;
  startNodeId: string | null;
  nodes: CompiledFlowNode[];
  transitions: CompiledFlowTransition[];
}

/* -------------------------------------------------------------------------- */
/* Validação (§19)                                                            */
/* -------------------------------------------------------------------------- */

export const FLOW_VALIDATION_CODES = [
  "version_not_found",
  "missing_start",
  "missing_end",
  "dead_end",
  "unreachable",
  "question_without_options",
  "attendant_without_team",
] as const;
export type FlowValidationCode = (typeof FLOW_VALIDATION_CODES)[number];

export interface FlowValidationIssue {
  code: FlowValidationCode;
  detail: string;
}

/* -------------------------------------------------------------------------- */
/* Execução (§12, §13)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * O que a conversa já contou. Valores sempre em texto: eles vêm de mensagens de
 * WhatsApp, e converter para número ou data aqui esconderia o dado bruto de
 * quem for atender depois.
 */
export type FlowVariables = Record<string, string>;

export interface FlowRun {
  id: string;
  flowId: string;
  flowName: string;
  /** A versão em que a execução COMEÇOU — publicar outra não a move. */
  flowVersionId: string;
  flowVersionNumber: number;
  whatsappChatId: string | null;
  currentNodeId: string | null;
  status: FlowRunStatus;
  /** A situação do ATENDIMENTO. Independente de `status` (§13). */
  conversationStatus: FlowConversationStatus;
  variables: FlowVariables;
  intent: string | null;
  intentConfidence: number | null;
  assignedTeamId: string | null;
  assignedTeamKey: string | null;
  assignedUserId: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/* -------------------------------------------------------------------------- */
/* Filtros da grid                                                            */
/* -------------------------------------------------------------------------- */

export const FLOW_STATUS_FILTERS = ["all", "active", "inactive", "draft"] as const;
export type FlowStatusFilter = (typeof FLOW_STATUS_FILTERS)[number];

export const DEFAULT_FLOW_STATUS_FILTER: FlowStatusFilter = "all";

export function isFlowStatusFilter(value: string): value is FlowStatusFilter {
  return (FLOW_STATUS_FILTERS as readonly string[]).includes(value);
}

export interface FlowFilters {
  query: string;
  status: FlowStatusFilter;
  channel: FlowChannel | "";
}
