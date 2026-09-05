import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { flowDefinitionSchema } from "@/modules/flow/flow.schema";
import type { Json } from "@/types/database";
import type {
  FlowChannel,
  FlowConversationStatus,
  FlowDefinition,
  FlowEngineState,
  FlowEventType,
  FlowNodeType,
  FlowRunStatus,
  FlowStepStatus,
  FlowTimeoutAction,
  FlowVariables,
} from "@/modules/flow/flow.types";

/**
 * A PERSISTÊNCIA DO MOTOR — e ela é fina de propósito.
 *
 * ⚠️ NENHUMA REGRA MORA AQUI. Cada função abaixo é uma chamada a uma função do
 * banco, mais a tradução entre `snake_case` e o domínio. Quem decide é
 * `flow.engine.ts` (o rumo) e `runtime.ts` (a coreografia); quem garante
 * atomicidade é o Postgres, dentro das funções de 20260919000000.
 *
 * ⚠️ E É POR ISSO QUE TUDO PASSA POR RPC, e não por `.from(...).update(...)`.
 * Avançar uma conversa é mudar o nó atual, gravar as variáveis, fechar o passo
 * e registrar os eventos — quatro escritas que precisam valer todas ou nenhuma
 * (§43). Encadeadas daqui, uma falha no meio deixaria a conversa num ponto que
 * nenhuma trilha explica. Dentro de uma função, o Postgres desfaz tudo.
 *
 * ⚠️ CLIENTE `service_role`, E É OBRIGATÓRIO. Quem chama é o webhook, atendendo
 * um associado ANÔNIMO: não há `auth.uid()` nem papel. As cinco funções são
 * `security definer` e foram revogadas de `anon` e `authenticated` — não existe
 * caminho pelo qual uma sessão de navegador as alcance.
 */

/* -------------------------------------------------------------------------- */
/* O buraco do gerador de tipos                                               */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ O GERADOR DO SUPABASE NÃO MODELA PARÂMETRO DE FUNÇÃO ANULÁVEL.
 *
 * `flow_claim_step(p_node_id uuid)` aceita NULL — uma conversa que está
 * começando ainda não tem nó atual, e é justamente aí que o primeiro passo é
 * reivindicado. Mas `database.ts` declara `p_node_id: string`, porque a
 * ferramenta lê a assinatura e não sabe dizer quais colunas de entrada aceitam
 * nulo.
 *
 * As saídas ruins seriam duas: `as never` no objeto inteiro de argumentos (que
 * apaga a conferência dos outros DOZE parâmetros de `flow_commit_step` junto), ou
 * dar `default null` a todos no SQL — que não funciona, porque em PL/pgSQL um
 * parâmetro com padrão obriga todos os seguintes a terem padrão também, e
 * `p_current_node_id` vem antes de cinco obrigatórios.
 *
 * Esta função é a terceira: um nome que DIZ o que está acontecendo, aplicado
 * exatamente nos parâmetros onde o tipo gerado mente, e em nenhum outro. Todo o
 * resto continua conferido.
 */
function anulavel<T>(valor: T | null): T {
  return valor as T;
}

/**
 * ⚠️ E O SEGUNDO BURACO: `Record<string, unknown>` NÃO É `Json` PARA O
 * TYPESCRIPT, mesmo sendo a mesma coisa em execução.
 *
 * `Json` é uma união recursiva de string, número, booleano, nulo, lista e
 * objeto DE `Json`. `unknown` é mais largo que isso — poderia ser uma função,
 * um `Symbol`, um `Date` —, e o compilador está certo em recusar: nada garante
 * que o que está no `Record` sobrevive a um `JSON.stringify`.
 *
 * A garantia existe, e vem de outro lugar: os três valores que passam por aqui
 * (`variables`, `output`, `payload`) são montados pelo motor a partir de
 * texto, número e booleano, e o CHECK `jsonb_typeof(...) = 'object'` do banco
 * recusa qualquer coisa que não seja objeto. Trocar o tipo do domínio para
 * `Json` empurraria essa união recursiva para dentro de `FlowEffect` e do
 * histórico, onde ela não descreve nada de útil.
 */
function comoJson(valor: unknown): Json {
  return valor as Json;
}

/* -------------------------------------------------------------------------- */
/* O que se lê de uma execução                                                */
/* -------------------------------------------------------------------------- */

export interface LoadedFlowRun {
  runId: string;
  flowId: string;
  flowVersionId: string;
  whatsappChatId: string | null;
  /** O retrato congelado. É o que o motor executa — nunca o desenho editável. */
  definition: FlowDefinition;
  state: FlowEngineState;
  /** §24. O número que a próxima escrita precisa devolver. */
  lockVersion: number;
  /** §29. Enquanto no futuro, o motor não fala. */
  automationPausedUntil: string | null;
}

/** Um evento a gravar junto com o commit do passo (§22). */
export interface PendingFlowEvent {
  type: FlowEventType;
  nodeId?: string | null;
  payload?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Abrir                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Abre — ou reencontra — a execução de uma conversa (§3, §4, §28).
 *
 * ⚠️ NÃO RECEBE `flowId` NEM `versionId`, e a ausência é a resposta ao §37.
 * Quem escolhe o fluxo de entrada do canal e a versão publicada é o BANCO. Não
 * existe parâmetro aqui capaz de mandar o motor executar um rascunho, porque
 * não existe parâmetro.
 *
 * Devolve `null` quando o canal não tem fluxo de entrada ativo com versão
 * publicada — que não é erro: é a APCS ainda não ter ligado o atendimento
 * automático naquele canal.
 */
export async function beginFlowRun(channel: FlowChannel, chatId: string): Promise<string | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("flow_begin_run", {
    p_channel: channel,
    p_chat_id: chatId,
  });

  if (error) {
    console.error(`[flow-store] flow_begin_run falhou: ${error.message}`);
    return null;
  }

  return typeof data === "string" ? data : null;
}

/* -------------------------------------------------------------------------- */
/* Ler                                                                        */
/* -------------------------------------------------------------------------- */

interface RunRow {
  id: string;
  flow_id: string;
  flow_version_id: string;
  whatsapp_chat_id: string | null;
  current_node_id: string | null;
  status: FlowRunStatus;
  conversation_status: FlowConversationStatus;
  variables: unknown;
  attempt_count: number | null;
  node_executions: number | null;
  lock_version: number | null;
  automation_paused_until: string | null;
  assigned_team: { key: string } | null;
  version: { definition: unknown } | null;
}

/**
 * O estado de uma execução, com o retrato congelado da versão dela.
 *
 * ⚠️ A DEFINIÇÃO VEM DE `flow_versions.definition`, E NUNCA DE `flow_nodes`.
 * Ler as linhas editáveis faria uma conversa em andamento passar a executar o
 * que alguém está arrastando neste instante — que é exatamente o que o §33
 * proíbe. O jsonb é o contrato.
 *
 * ⚠️ OS DOIS EMBEDS NOMEIAM A CONSTRAINT, e não é enfeite: `flow_runs` e
 * `flow_versions` têm DUAS chaves entre si (`flow_id` de ida,
 * `active_version_id` de volta). Sem apontar qual seguir, o PostgREST recusa a
 * consulta com PGRST201 — que foi como esta tela quebrou da primeira vez.
 */
export async function loadFlowRun(runId: string): Promise<LoadedFlowRun | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("flow_runs")
    .select(
      `id, flow_id, flow_version_id, whatsapp_chat_id, current_node_id, status,
       conversation_status, variables, attempt_count, node_executions,
       lock_version, automation_paused_until,
       assigned_team:attendance_teams!flow_runs_assigned_team_id_fkey(key),
       version:flow_versions!flow_runs_version_fk(definition)`,
    )
    .eq("id", runId)
    .returns<RunRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[flow-store] loadFlowRun falhou: ${error.message}`);
    return null;
  }
  if (!data) return null;

  // ⚠️ O `parse` DO RETRATO NÃO É CERIMÔNIA. Este documento foi escrito por uma
  // versão ANTERIOR do sistema e é lido para sempre. Sem ele, o motor receberia
  // `unknown` e trataria um campo inexistente como `undefined` — decidindo o
  // caminho de um atendimento a partir de um buraco. Com ele, um formato
  // desconhecido falha alto, aqui, com a execução identificada.
  const definicao = flowDefinitionSchema.safeParse(data.version?.definition);

  if (!definicao.success) {
    console.error(
      `[flow-store] retrato congelado ilegível na execução ${runId} ` +
        `(versão ${data.flow_version_id}): ${definicao.error.message}`,
    );
    return null;
  }

  return {
    runId: data.id,
    flowId: data.flow_id,
    flowVersionId: data.flow_version_id,
    whatsappChatId: data.whatsapp_chat_id,
    definition: definicao.data as FlowDefinition,
    lockVersion: data.lock_version ?? 0,
    automationPausedUntil: data.automation_paused_until,
    state: {
      currentNodeId: data.current_node_id,
      variables: lerVariaveis(data.variables),
      status: data.status,
      conversationStatus: data.conversation_status,
      assignedTeamKey: data.assigned_team?.key ?? null,
      attemptCount: data.attempt_count ?? 0,
      // §10. O contador de laço ATRAVESSA os turnos — é essa persistência que o
      // diferencia do teto de saltos do motor. `?? 0` cobre as execuções que
      // começaram antes de a coluna existir.
      nodeExecutions: data.node_executions ?? 0,
    },
  };
}

/**
 * As variáveis, defensivamente.
 *
 * ⚠️ VALORES NÃO-TEXTO SÃO CONVERTIDOS, E NÃO DESCARTADOS. O jsonb aceita
 * número e booleano, e uma gravação antiga (ou um handler distraído) pode ter
 * posto `42` onde o domínio espera `"42"`. Descartar apagaria um dado que a
 * conversa coletou; converter preserva o dado e mantém a promessa do tipo — que
 * é o que os operadores de comparação esperam encontrar.
 */
function lerVariaveis(bruto: unknown): FlowVariables {
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return {};

  const variaveis: FlowVariables = {};
  for (const [nome, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (typeof valor === "string") variaveis[nome] = valor;
    else if (typeof valor === "number" || typeof valor === "boolean") {
      variaveis[nome] = String(valor);
    }
  }
  return variaveis;
}

/* -------------------------------------------------------------------------- */
/* Reivindicar — a idempotência (§23)                                         */
/* -------------------------------------------------------------------------- */

export interface ClaimStepInput {
  runId: string;
  /** Normalmente o id da mensagem recebida. Ver o aviso abaixo. */
  idempotencyKey: string;
  nodeId: string | null;
  nodeType: FlowNodeType | null;
  input?: Record<string, unknown>;
  inboundMessageId?: string | null;
}

/**
 * Reivindica o passo, ou descobre que ele já foi dado.
 *
 * ⚠️ `null` NÃO É ERRO — é o §23 funcionando. O WhatsApp reentrega o mesmo
 * webhook, e reentrega justamente quando a primeira resposta demorou (ou seja,
 * sob carga). Quem recebe `null` deve PARAR EM SILÊNCIO: o passo já foi
 * processado, a mensagem já saiu, e refazer qualquer parte disso duplicaria uma
 * mensagem no WhatsApp de um associado.
 */
export async function claimFlowStep(entrada: ClaimStepInput): Promise<number | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("flow_claim_step", {
    p_run_id: entrada.runId,
    p_key: entrada.idempotencyKey,
    // Nulos legítimos: uma conversa que começa agora não tem nó atual. Ver
    // `anulavel`.
    p_node_id: anulavel(entrada.nodeId),
    p_node_type: anulavel(entrada.nodeType),
    p_input: comoJson(entrada.input ?? {}),
    // ⚠️ `undefined`, E NÃO `null`. O parâmetro tem `default null` no SQL, e
    // omiti-lo deixa o banco aplicar o próprio padrão — é a mesma escolha que
    // `whatsapp_pause_bot` já fazia.
    p_inbound_message_id: entrada.inboundMessageId ?? undefined,
  });

  if (error) {
    console.error(`[flow-store] flow_claim_step falhou: ${error.message}`);
    return null;
  }

  return typeof data === "number" ? data : null;
}

/* -------------------------------------------------------------------------- */
/* Fechar — a transação (§43) e a trava (§24)                                 */
/* -------------------------------------------------------------------------- */

export interface CommitStepInput {
  stepId: number;
  /** §24. O número lido em `loadFlowRun`. Divergiu, a escrita é recusada. */
  lockVersion: number;
  state: FlowEngineState;
  stepStatus?: FlowStepStatus;
  output?: Record<string, unknown>;
  /** A frase TÉCNICA. Nunca chega ao associado (§35). */
  error?: string | null;
  failureReason?: string | null;
  events?: PendingFlowEvent[];
  /**
   * §10. Quantos nós ESTE turno atravessou. O banco SOMA no contador da
   * conversa — por isso é o delta, e não o total. Ver `FlowEngineResult`.
   */
  nodesWalked?: number;
  /**
   * §30/§47. A leitura da IA deste turno, para a trilha e as métricas.
   *
   * ⚠️ AUSENTE SIGNIFICA "NÃO HOUVE LEITURA", e o banco PRESERVA a anterior em
   * vez de apagá-la. É o oposto do que acontece com as variáveis `sys_intent*`,
   * que morrem a cada turno (`withoutFlowIntent`) — e a diferença é o uso: a
   * variável alimenta CONDIÇÕES, onde uma leitura velha decide errado; a coluna
   * alimenta a TRILHA, onde ela responde "o que a IA entendeu nesta conversa".
   */
  intent?: string | null;
  intentConfidence?: number | null;
}

/**
 * Fecha o passo e move o estado, num commit só.
 *
 * ⚠️ `false` SIGNIFICA "OUTRA MENSAGEM CHEGOU PRIMEIRO", e é o cenário do §24
 * acontecendo. Não é falha: é a trava otimista recusando uma escrita calculada
 * a partir de um estado que já não existe. Quem chamou deve reler e recalcular
 * — nunca insistir com os mesmos números, que produziria o mesmo `false` para
 * sempre.
 */
export async function commitFlowStep(entrada: CommitStepInput): Promise<boolean> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("flow_commit_step", {
    p_step_id: entrada.stepId,
    p_lock_version: entrada.lockVersion,
    p_current_node_id: anulavel(entrada.state.currentNodeId),
    p_run_status: entrada.state.status,
    p_conversation_status: entrada.state.conversationStatus,
    p_variables: comoJson(entrada.state.variables),
    p_attempt_count: entrada.state.attemptCount,
    p_team_key: entrada.state.assignedTeamKey ?? undefined,
    p_step_status: entrada.stepStatus ?? "succeeded",
    p_output: comoJson(entrada.output ?? {}),
    p_error: entrada.error ?? undefined,
    p_failure_reason: entrada.failureReason ?? undefined,
    p_events: comoJson(
      (entrada.events ?? []).map((evento) => ({
        type: evento.type,
        nodeId: evento.nodeId ?? null,
        payload: evento.payload ?? {},
      })),
    ),
    // §30. `undefined` e não `null`: o parâmetro tem `default null` no SQL, e é
    // esse default que faz a função PRESERVAR a leitura anterior. Ver `anulavel`.
    p_intent: entrada.intent ?? undefined,
    p_intent_confidence: entrada.intentConfidence ?? undefined,
    p_nodes_walked: entrada.nodesWalked ?? 0,
  });

  if (error) {
    console.error(`[flow-store] flow_commit_step falhou: ${error.message}`);
    return false;
  }

  return data === true;
}

/* -------------------------------------------------------------------------- */
/* A pausa humana (§29, §30)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Cala o robô nesta execução, ou o devolve à conversa.
 *
 * `until = null` é o §30: o atendente terminou e o fluxo automático volta a
 * valer, sem nada precisar ser desfeito.
 */
export async function setFlowAutomationPause(runId: string, until: Date | null): Promise<boolean> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("flow_set_automation_pause", {
    p_run_id: runId,
    // Nulo legítimo — é ele que significa "volte a atender". Ver `anulavel`.
    p_until: anulavel(until ? until.toISOString() : null),
  });

  if (error) {
    console.error(`[flow-store] flow_set_automation_pause falhou: ${error.message}`);
    return false;
  }

  return data === true;
}

/* -------------------------------------------------------------------------- */
/* O tempo (§27)                                                              */
/* -------------------------------------------------------------------------- */

export interface DueFlowRun {
  runId: string;
  flowId: string;
  flowVersionId: string;
  whatsappChatId: string | null;
  currentNodeId: string | null;
  lockVersion: number;
  action: FlowTimeoutAction;
  teamKey: string | null;
  message: string | null;
  silentMinutes: number;
}

/**
 * As conversas que venceram. Só leitura — quem age é o `runtime`.
 *
 * ⚠️ AS COLUNAS ANULÁVEIS SÃO TRATADAS COMO ANULÁVEIS AQUI, mesmo o tipo
 * gerado dizendo que não são. `timeout_team_key` vem de um `left join` e é nulo
 * sempre que o fluxo não transfere; confiar no tipo faria `teamKey` prometer
 * uma string que não existe, e o `if (!vencida.teamKey)` do runtime — que é a
 * defesa contra transferir para lugar nenhum — pareceria código morto.
 */
export async function dueFlowRuns(limit = 50): Promise<DueFlowRun[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("flow_timeout_due", { p_limit: limit });

  if (error) {
    console.error(`[flow-store] flow_timeout_due falhou: ${error.message}`);
    return [];
  }

  return (data ?? []).map((linha) => ({
    runId: linha.run_id,
    flowId: linha.flow_id,
    flowVersionId: linha.flow_version_id,
    whatsappChatId: linha.whatsapp_chat_id ?? null,
    currentNodeId: linha.current_node_id ?? null,
    lockVersion: linha.lock_version ?? 0,
    action: linha.timeout_action,
    teamKey: linha.timeout_team_key ?? null,
    message: linha.timeout_message ?? null,
    silentMinutes: linha.silent_minutes ?? 0,
  }));
}
