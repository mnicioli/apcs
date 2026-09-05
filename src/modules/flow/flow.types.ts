import type { ConditionOperator } from "./flow.operators";

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

  /* --- A política de tempo (§27 do Prompt 3) ---------------------------- */

  /**
   * Depois de quantos minutos de silêncio a conversa vence. `null` = nunca.
   *
   * ⚠️ VIVE NO FLUXO E NÃO NA VERSÃO, e é uma escolha. O tempo de espera é
   * política OPERACIONAL ("quanto tempo damos ao associado"), não desenho:
   * mudá-lo de 24h para 12h não deveria exigir publicar uma versão nova nem
   * deixar as conversas em andamento com o prazo antigo — que é justamente o
   * que o retrato congelado garantiria se ele morasse lá.
   */
  timeoutMinutes: number | null;
  timeoutAction: FlowTimeoutAction;
  /** O time do `transfer`. Cobrado por CHECK quando a ação é essa. */
  timeoutTeamId: string | null;
  /** O que a pessoa lê no lembrete ou no encerramento por tempo. */
  timeoutMessage: string | null;
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

  /* ------------------------------------------------------------------------ */
  /* Homologação (§21, §22 do Prompt 5)                                        */
  /* ------------------------------------------------------------------------ */

  /**
   * O checklist de homologação, cru como veio do jsonb.
   *
   * ⚠️ `unknown` DE PROPÓSITO. A forma dele é assunto de
   * `src/modules/flow/flow.checklist.ts`, que o lê defensivamente
   * (`readFlowChecklist`) — um item removido do código continuaria gravado numa
   * versão antiga, e tipá-lo aqui como `Record<ChecklistKey, …>` seria afirmar
   * uma forma que o banco não garante.
   */
  checklist: unknown;

  /**
   * §22. O motivo da REPROVAÇÃO. `null` em todo outro estado.
   *
   * ⚠️ ELE É LIMPO NO AVANÇO SEGUINTE, e é o certo: um motivo pendurado numa
   * versão já corrigida faria quem a abrisse procurar um problema que já não
   * existe. O registro permanente está na trilha (`flow_version_rejected`).
   */
  reviewNotes: string | null;
  reviewedAt: string | null;
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
  | {
      type: "variable";
      name: string;
      /** Ver `CONDITION_OPERATORS` em `flow.operators.ts` — os doze do §14. */
      operator: ConditionOperator;
      /** Vazio nos quatro operadores que não comparam (`existe`, `é sim`…). */
      value: string;
    };

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
  // Pergunta de resposta aberta com mais de uma saída. O motor segue pela única
  // saída; a segunda seta nunca executa, e o desenho mente sobre o que faz.
  "open_question_branches",
  // Mensagem ou pergunta sem texto. Sem esta regra o motor enviaria o NOME do
  // nó — a pessoa receberia "Mensagem 3" no WhatsApp.
  "empty_message",
  "attendant_without_team",
  // §11 do Prompt 3. Pergunta que transfere ao esgotar as tentativas e não diz
  // para qual time. O caminho só executa quando alguém erra três vezes — ou
  // seja, no pior momento da conversa, e sem ninguém ficar sabendo.
  "fallback_without_team",
  // §14 do Prompt 3. Seta com comparação e sem valor a comparar. O Zod aceita
  // (a pessoa acabou de escolher o tipo e vai digitar em seguida); o
  // atendimento, não — a condição nunca casa, e a conversa morre em
  // `no_matching_transition` no meio de uma frase.
  "condition_without_value",
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

  /* --- O que o motor de execução acrescentou (Prompt 3) ------------------ */

  /**
   * §24. O CONTADOR DA TRAVA OTIMISTA.
   *
   * Toda escrita de estado exige o número que foi lido e o incrementa. Duas
   * mensagens que cheguem juntas leem o mesmo `3`; a primeira grava `4`, e a
   * segunda — que ainda pede `3` — não encontra linha para atualizar e é
   * recusada. É o que impede as duas de avançarem a partir do mesmo nó.
   */
  lockVersion: number;

  /** §11. Respostas inválidas seguidas na pergunta atual. Zera ao avançar. */
  attemptCount: number;

  /** §27. Quando a conversa foi tocada pela última vez — o relógio do timeout. */
  lastActivityAt: string;

  /**
   * §29. Até quando o motor fica calado porque uma pessoa assumiu.
   *
   * `null` é o normal. Ver `flow_runs.automation_paused_until` na migration —
   * é ele, e não `conversation_status`, que o motor consulta antes de falar.
   */
  automationPausedUntil: string | null;

  /** §35. O código do que deu errado. A frase técnica fica no passo. */
  failureReason: string | null;
}

/* -------------------------------------------------------------------------- */
/* O motor: o estado, o que entra e o que sai                                 */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ ESTES TRÊS TIPOS MORAM AQUI, E NÃO NO MOTOR, POR UMA RAZÃO DE DIREÇÃO.
 *
 * Os executores de nó (§6 do Prompt 3) falam nesta linguagem: recebem estado,
 * devolvem efeitos. Se ela morasse em `flow.engine.ts`, todo executor teria de
 * importar o motor — e o motor importa os executores. O ciclo se fecharia na
 * primeira linha, e a saída seria um arquivo de tipos como este, mais tarde e
 * com pressa.
 *
 * `flow.engine.ts` reexporta os três: quem já os importava de lá continua
 * valendo.
 */
export interface FlowEngineState {
  currentNodeId: string | null;
  variables: FlowVariables;
  status: FlowRunStatus;
  conversationStatus: FlowConversationStatus;
  /** A chave do TIME, nunca a de uma pessoa (§11 do Prompt 1). */
  assignedTeamKey: string | null;
  /**
   * §11 do Prompt 3. Respostas inválidas SEGUIDAS na pergunta atual.
   *
   * ⚠️ ZERA AO AVANÇAR, e é o que o torna um contador de tentativas e não um
   * contador de erros da conversa. Alguém que erra duas vezes na primeira
   * pergunta e depois acerta chega à segunda pergunta com três tentativas
   * inteiras — que é o que qualquer pessoa esperaria.
   */
  attemptCount: number;

  /**
   * §10 do Prompt 5. Quantos nós ESTA CONVERSA já atravessou, somando todos os
   * turnos.
   *
   * ============================================================================
   * ⚠️ POR QUE O TETO DE SALTOS DO MOTOR NÃO BASTAVA — LEIA ANTES DE REMOVER.
   * ============================================================================
   *
   * `LIMITE_DE_SALTOS` (flow.engine.ts) conta nós dentro de UMA travessia, e ele
   * resolve o laço rápido: MENU → CONDIÇÃO → MENU sem passar por uma pergunta,
   * que travaria o webhook em segundos.
   *
   * Ele não enxerga o laço LENTO, e o laço lento é o desenho mais fácil de
   * fazer sem querer:
   *
   *     PERGUNTA A → resposta → PERGUNTA B → resposta → PERGUNTA A → …
   *
   * Cada turno gasta dois ou três saltos, muito abaixo de vinte, e o contador
   * zera na volta seguinte. A conversa circula para sempre, uma mensagem por
   * vez, e nada falha em lugar nenhum: cada turno é válido. A pessoa recebe as
   * mesmas duas perguntas até desistir, e ninguém da APCS fica sabendo.
   *
   * Por isso este número VIVE NA EXECUÇÃO (`flow_runs.node_executions`) e
   * atravessa os turnos. É a diferença entre "este turno travou" e "esta
   * conversa não vai a lugar nenhum".
   */
  nodeExecutions: number;
}

/** §16 do Prompt 3. O desfecho de uma ação de negócio. */
export const FLOW_ACTION_STATUSES = ["success", "failure", "not_found", "retry"] as const;
export type FlowActionStatus = (typeof FLOW_ACTION_STATUSES)[number];

export type FlowEngineInput =
  /** A conversa começou. Entra pelo nó inicial. */
  | { kind: "start" }
  /** A pessoa respondeu. Só faz sentido parado num nó QUESTION. */
  | { kind: "reply"; text: string }
  /**
   * O handler de uma ação terminou. É o retorno do `runAction` que o motor
   * emitiu e parou esperando — ver `FlowEffect`.
   */
  | { kind: "actionResult"; status: FlowActionStatus; variables: FlowVariables };

export interface FlowQuestionOption {
  key: string;
  label: string;
}

/**
 * O QUE FEZ O EFEITO ACONTECER.
 *
 * ⚠️ ELE NÃO MUDA O QUE A CAMADA DE ENTREGA FAZ — muda o que a TRILHA registra.
 * Uma transferência desenhada e uma transferência por tentativas esgotadas
 * produzem exatamente o mesmo efeito para o WhatsApp, e leituras opostas para
 * quem depois pergunta "por que tanta gente cai no time financeiro". Sem este
 * campo, as duas seriam a mesma linha no histórico.
 */
export type FlowEffectTrigger = "flow" | "fallback" | "timeout";

/**
 * ⚠️ EFEITOS, E NÃO EXECUÇÃO. O motor NÃO envia mensagem, NÃO grava no banco e
 * NÃO chama serviço nenhum: ele descreve o que precisa acontecer e devolve.
 *
 * É o que torna o simulador (Prompt 2) e a execução de verdade (Prompt 3)
 * possíveis sobre o MESMO motor — um imprime os efeitos na tela, o outro os
 * executa. Se o envio morasse aqui, o simulador teria de reimplementar a
 * travessia, e as duas versões divergiriam na primeira manutenção.
 */
export type FlowEffect =
  | {
      kind: "sendMessage";
      nodeId: string;
      text: string;
      /** Pausa antes de enviar, em segundos (Prompt 2, §7). */
      delaySeconds: number;
      imageUrl: string | null;
      pdfUrl: string | null;
      trigger: FlowEffectTrigger;
    }
  | { kind: "askQuestion"; nodeId: string; text: string; options: FlowQuestionOption[] }
  | {
      kind: "runAction";
      nodeId: string;
      actionKey: string;
      arguments: Record<string, string>;
      /** §25. O teto de tentativas para uma falha temporária. */
      maxAttempts: number;
    }
  | {
      kind: "assignTeam";
      nodeId: string;
      teamKey: string;
      message: string | null;
      slaMinutes: number | null;
      priority: string;
      trigger: FlowEffectTrigger;
    }
  | {
      kind: "complete";
      nodeId: string;
      message: string | null;
      trigger: FlowEffectTrigger;
    }
  /**
   * A pessoa respondeu algo que não casa com alternativa nenhuma. O motor NÃO
   * inventa uma frase: devolve o efeito com o texto que já estava escrito — o
   * `invalidText` do nó, quando existe, ou a própria pergunta.
   */
  | {
      kind: "repeatQuestion";
      nodeId: string;
      text: string;
      options: FlowQuestionOption[];
      /** Em que tentativa a pessoa está, e quantas ela tem. Para a trilha. */
      attempt: number;
      maxAttempts: number;
    }
  /** O desenho está quebrado em execução. Ver `FlowEngineFailure`. */
  | { kind: "fail"; nodeId: string | null; reason: FlowEngineFailure };

export type FlowEngineFailure =
  | "no_start_node"
  | "node_not_found"
  | "no_matching_transition"
  | "not_waiting_reply"
  | "hop_limit"
  // §11. As tentativas acabaram e o desfecho configurado é transferir, mas o
  // nó não diz para qual time. A publicação recusa isso; um retrato antigo,
  // publicado antes de o campo existir, não foi recusado por ninguém.
  | "fallback_without_team"
  /**
   * §10 do Prompt 5. A CONVERSA circulou demais — não este turno.
   *
   * ⚠️ ELE NÃO É `hop_limit` COM OUTRO NOME, e a distinção é o que torna os dois
   * úteis na tela de erros (§33):
   *
   *   `hop_limit`      um turno andou 20 nós sem parar. É um laço FECHADO no
   *                    desenho (MENU → CONDIÇÃO → MENU), e o defeito está numa
   *                    seta. Aparece na primeira conversa que passa por ali.
   *   `loop_detected`  a conversa atravessou centenas de nós ao longo de muitos
   *                    turnos. Cada turno era válido; o que está errado é o
   *                    CAMINHO não ter saída — duas perguntas que se apontam.
   *                    Só aparece depois de a pessoa insistir.
   *
   * Juntá-los faria quem lê o painel procurar a seta errada.
   */
  | "loop_detected";

export interface FlowEngineResult {
  state: FlowEngineState;
  effects: FlowEffect[];
  /**
   * §10. Quantos nós ESTE turno atravessou.
   *
   * ⚠️ ELE É SEPARADO DE `state.nodeExecutions` de propósito. O estado carrega o
   * TOTAL da conversa, que é o que a trava do laço lê; este campo é o DELTA,
   * que é o que o banco soma (`p_nodes_walked`). Mandar o total para o banco
   * faria a soma dobrar a cada turno.
   */
  nodesWalked: number;
}

/* -------------------------------------------------------------------------- */
/* O histórico de execução (§21 do Prompt 3)                                  */
/* -------------------------------------------------------------------------- */

/**
 * O desfecho de UM passo — não o da execução.
 *
 * `skipped` é o passo que não aconteceu porque não devia: a mensagem
 * desligada, o webhook reentregue. Ele fica no histórico de propósito — "não
 * executou" é uma informação, e apagá-la faria a trilha mentir por omissão
 * quando alguém fosse investigar por que a pessoa não recebeu nada.
 */
export const FLOW_STEP_STATUSES = ["succeeded", "failed", "skipped"] as const;
export type FlowStepStatus = (typeof FLOW_STEP_STATUSES)[number];

export interface FlowRunStep {
  id: number;
  flowRunId: string;
  seq: number;
  nodeId: string | null;
  /** O tipo do nó no momento da execução. Ver o aviso de `flow_run_steps`. */
  nodeType: FlowNodeType | null;
  status: FlowStepStatus;
  idempotencyKey: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  /** A frase técnica. NUNCA vai para o associado — ver §35 do Prompt 3. */
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  metadata: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Os eventos da conversa (§22 do Prompt 3)                                   */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ EVENTO E PASSO NÃO SÃO A MESMA COISA, e confundi-los foi a primeira
 * tentação deste módulo.
 *
 *   PASSO    o que o motor FEZ, e é a unidade de idempotência — um por
 *            mensagem recebida, com chave única. Reentrega não cria outro.
 *   EVENTO   o que ACONTECEU dentro daquele passo, e são vários: um passo que
 *            atravessa mensagem → condição → ação emite três.
 *
 * Uma tabela só obrigaria a escolher entre perder a granularidade da trilha
 * (§36 pede duração POR NÓ) e perder a chave de idempotência (§23 exige uma
 * linha por mensagem). São perguntas diferentes, e cada uma tem a sua tabela.
 */
export const FLOW_EVENT_TYPES = [
  "conversation_started",
  "flow_started",
  "node_started",
  "node_completed",
  "message_sent",
  "question_sent",
  "answer_received",
  "answer_rejected",
  "condition_evaluated",
  "action_executed",
  "transferred_to_team",
  "flow_completed",
  "flow_failed",
  "flow_timeout",
  // Os dois do §29/§30: o motor sai de cena e volta. Sem eles, "por que o robô
  // parou de responder às 14h" não tem resposta na trilha.
  "automation_paused",
  "automation_resumed",
] as const;
export type FlowEventType = (typeof FLOW_EVENT_TYPES)[number];

export interface FlowRunEvent {
  id: number;
  flowRunId: string;
  type: FlowEventType;
  nodeId: string | null;
  /** O contexto estruturado do §36. Sem texto de associado — ver a migration. */
  payload: Record<string, unknown>;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* O tempo (§27 do Prompt 3)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * O que fazer com uma conversa que emudeceu.
 *
 * ⚠️ NÃO EXISTE PADRÃO ÚNIVERSAL AQUI, e o escopo diz isso com todas as letras
 * ("não assumir um único comportamento fixo"). `none` é o padrão do CAMPO —
 * um fluxo que nunca configurou tempo nenhum não deve começar a encerrar
 * conversas sozinho na primeira vez que o cron rodar.
 */
export const FLOW_TIMEOUT_ACTIONS = ["none", "remind", "close", "transfer"] as const;
export type FlowTimeoutAction = (typeof FLOW_TIMEOUT_ACTIONS)[number];

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
