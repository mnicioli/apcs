import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listAdminAudit } from "@/lib/services/admin";
import type { AdminAuditEntry } from "@/modules/admin/admin.types";
import type { FlowNodeType } from "@/modules/flow/flow.types";

/**
 * O MONITORAMENTO DOS FLUXOS — §28 a §35 do Prompt 5.
 *
 * ============================================================================
 * ⚠️ TODA AGREGAÇÃO ACONTECE NO BANCO. LEIA ANTES DE "SIMPLIFICAR".
 * ============================================================================
 *
 * A tentação é buscar as execuções e contar em JavaScript — é mais fácil de ler
 * e não precisa de migration. Ela quebra em seis meses, e quebra do pior jeito:
 * a página de monitoramento carrega TODAS as execuções do período para a
 * memória do servidor. Com alguns milhares de conversas isso é lento; com
 * dezenas de milhares é o processo caindo — e cai justamente na tela que
 * alguém abriu para investigar por que o atendimento está estranho.
 *
 * `flow_metrics`, `flow_error_totals` e `flow_sla_queue` devolvem linhas já
 * contadas. O que chega aqui tem o tamanho da resposta, e não o do histórico.
 *
 * ⚠️ E ELES SÃO `stable` E SOMENTE LEITURA no banco, então esta tela não tem
 * como escrever nada por engano.
 *
 * ⚠️ CLIENTE AUTENTICADO, e não `service_role`. O monitoramento é uma tela
 * interna: quem não tem `flows.read` não deve ler indicador de atendimento. As
 * funções são `security definer` para poder cruzar `flow_run_steps` com
 * `flows`, mas o `revoke ... from public, anon` mantém a porta fechada para
 * quem não está autenticado.
 */

/* -------------------------------------------------------------------------- */
/* §29, §30 — os indicadores                                                  */
/* -------------------------------------------------------------------------- */

export interface FlowMetrics {
  flowId: string;
  flowName: string;
  /** Conversas iniciadas no período. */
  started: number;
  completed: number;
  handedOff: number;
  failed: number;
  /**
   * Nem terminou nem falou nas últimas 24 horas.
   *
   * ⚠️ O CORTE DE TEMPO É PARTE DA DEFINIÇÃO. Sem ele, toda conversa EM
   * ANDAMENTO contaria como abandonada — inclusive a que começou há dois
   * minutos e está esperando a pessoa digitar.
   */
  abandoned: number;
  /** §31. Conversas que passaram por pelo menos uma resposta recusada. */
  fallbackRuns: number;
  avgDurationSeconds: number | null;
  avgConfidence: number | null;
  identifiedIntent: number;
}

interface MetricsRow {
  flow_id: string;
  flow_name: string;
  started: number;
  completed: number;
  handed_off: number;
  failed: number;
  abandoned: number;
  fallback_runs: number;
  avg_duration_seconds: number | null;
  avg_confidence: number | null;
  identified_intent: number;
}

export async function getFlowMetrics(days = 30, flowId?: string): Promise<FlowMetrics[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("flow_metrics", {
    p_days: days,
    // ⚠️ `undefined` E NÃO `null`: o parâmetro tem `default null` no SQL, e é
    // esse default que significa "todos os fluxos". Ver CONVENTIONS.md.
    p_flow_id: flowId ?? undefined,
    /**
     * ⚠️ `as never` NOS ARGUMENTOS E CAST NA SAÍDA — o padrão de todo rpc com
     * parâmetros neste projeto (ver `getSurveyMetrics`).
     *
     * `.returns<T[]>()` NÃO funciona aqui: encadeado depois de um argumento
     * `never`, ele resolve o genérico para `never` e o TypeScript passa a
     * recusar o `.map` com "Property 'map' does not exist on type 'never'".
     */
  } as never);

  if (error) throw error;

  return ((data ?? []) as MetricsRow[]).map((linha) => ({
    flowId: linha.flow_id,
    flowName: linha.flow_name,
    started: Number(linha.started ?? 0),
    completed: Number(linha.completed ?? 0),
    handedOff: Number(linha.handed_off ?? 0),
    failed: Number(linha.failed ?? 0),
    abandoned: Number(linha.abandoned ?? 0),
    fallbackRuns: Number(linha.fallback_runs ?? 0),
    // ⚠️ `avg` DO POSTGRES VOLTA COMO TEXTO em `numeric`. Sem o `Number`, a
    // tela formataria "1234.5678901" — e uma comparação com `>` compararia
    // strings, que ordena "9" depois de "10".
    avgDurationSeconds:
      linha.avg_duration_seconds === null ? null : Number(linha.avg_duration_seconds),
    avgConfidence: linha.avg_confidence === null ? null : Number(linha.avg_confidence),
    identifiedIntent: Number(linha.identified_intent ?? 0),
  }));
}

/* -------------------------------------------------------------------------- */
/* §31 — o funil                                                              */
/* -------------------------------------------------------------------------- */

export interface FlowFunnelStep {
  label: string;
  value: number;
  /** Percentual sobre o topo do funil. `null` quando o topo é zero. */
  share: number | null;
}

/**
 * O funil do §31, montado a partir dos indicadores.
 *
 * ⚠️ ELE NÃO É UMA CONSULTA NOVA. São os mesmos números de `getFlowMetrics`
 * arranjados na ordem em que a conversa acontece — e é isso que garante que o
 * funil e a tabela de indicadores nunca discordem na mesma tela. Uma segunda
 * consulta, com os seus próprios `where`, discordaria da primeira no dia em que
 * alguém mexesse numa delas.
 *
 * ⚠️ AS ETAPAS NÃO SÃO SUBCONJUNTOS PERFEITAS UMAS DAS OUTRAS, e o rótulo diz
 * isso: "resolvidas pelo bot" é `completed`, que inclui quem foi encerrado por
 * fallback. Fingir uma hierarquia limpa exigiria contagens que o modelo não
 * guarda — e um funil que parece exato e não é engana mais que um aproximado
 * que se apresenta como tal.
 */
export function buildFlowFunnel(metrics: FlowMetrics): FlowFunnelStep[] {
  const topo = metrics.started;
  const share = (n: number) => (topo === 0 ? null : Math.round((n / topo) * 1000) / 10);

  return [
    { label: "Conversas iniciadas", value: topo, share: share(topo) },
    {
      label: "Intenção identificada",
      value: metrics.identifiedIntent,
      share: share(metrics.identifiedIntent),
    },
    { label: "Resolvidas pelo bot", value: metrics.completed, share: share(metrics.completed) },
    {
      label: "Transferidas para um time",
      value: metrics.handedOff,
      share: share(metrics.handedOff),
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* §33 — os erros                                                             */
/* -------------------------------------------------------------------------- */

export interface FlowErrorTotal {
  flowId: string;
  flowName: string;
  nodeId: string | null;
  nodeType: FlowNodeType | null;
  reason: string;
  occurrences: number;
  lastSeen: string | null;
}

interface ErrorRow {
  flow_id: string;
  flow_name: string;
  node_id: string | null;
  node_type: FlowNodeType | null;
  failure_reason: string | null;
  occurrences: number;
  last_seen: string | null;
}

export async function getFlowErrors(days = 30, limit = 50): Promise<FlowErrorTotal[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("flow_error_totals", {
    p_days: days,
    p_limit: limit,
    // Ver o aviso em `getFlowMetrics` sobre `as never` + cast na saída.
  } as never);

  if (error) throw error;

  return ((data ?? []) as ErrorRow[]).map((linha) => ({
    flowId: linha.flow_id,
    flowName: linha.flow_name,
    nodeId: linha.node_id,
    nodeType: linha.node_type,
    reason: linha.failure_reason ?? "desconhecido",
    occurrences: Number(linha.occurrences ?? 0),
    lastSeen: linha.last_seen,
  }));
}

/* -------------------------------------------------------------------------- */
/* §35 — a fila com prazo                                                     */
/* -------------------------------------------------------------------------- */

export interface FlowSlaEntry {
  runId: string;
  flowName: string;
  teamKey: string | null;
  teamName: string | null;
  whatsappChatId: string | null;
  assignedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  slaMinutes: number | null;
  minutesWaiting: number;
  breached: boolean;
}

interface SlaRow {
  run_id: string;
  flow_name: string;
  team_key: string | null;
  team_name: string | null;
  whatsapp_chat_id: string | null;
  assigned_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  sla_minutes: number | null;
  minutes_waiting: number;
  breached: boolean;
}

export async function getFlowSlaQueue(limit = 100): Promise<FlowSlaEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("flow_sla_queue", {
    p_limit: limit,
    // Ver o aviso em `getFlowMetrics` sobre `as never` + cast na saída.
  } as never);

  if (error) throw error;

  return ((data ?? []) as SlaRow[]).map((linha) => ({
    runId: linha.run_id,
    flowName: linha.flow_name,
    teamKey: linha.team_key,
    teamName: linha.team_name,
    whatsappChatId: linha.whatsapp_chat_id,
    assignedAt: linha.assigned_at,
    firstResponseAt: linha.first_response_at,
    resolvedAt: linha.resolved_at,
    slaMinutes: linha.sla_minutes,
    minutesWaiting: Number(linha.minutes_waiting ?? 0),
    breached: linha.breached === true,
  }));
}

/* -------------------------------------------------------------------------- */
/* §54 — a saúde de um fluxo                                                  */
/* -------------------------------------------------------------------------- */

export type FlowHealth = "healthy" | "warning" | "error" | "idle";

export interface FlowHealthReading {
  status: FlowHealth;
  /** Uma frase em PT-BR dizendo POR QUÊ. Vazia quando está saudável. */
  reason: string;
}

/**
 * §54. A saúde de um fluxo, derivada dos indicadores.
 *
 * ============================================================================
 * ⚠️ ELA É DERIVADA, E NÃO ARMAZENADA. Isso é a decisão inteira desta função.
 * ============================================================================
 *
 * Uma coluna `health` em `flows` precisaria de alguém para mantê-la — um job,
 * um gatilho, uma rotina — e o dia em que esse alguém falhasse, a tela mostraria
 * "HEALTHY" em verde sobre um fluxo quebrado. Um indicador de saúde que pode
 * estar desatualizado é pior que nenhum: ele produz confiança sem fundamento.
 *
 * Calculando na leitura, o pior caso é a tela demorar um pouco mais. O número
 * nunca mente.
 *
 * ⚠️ OS CORTES SÃO CONSERVADORES DE PROPÓSITO. Um alerta que dispara à toa
 * ensina a equipe a ignorá-lo, e a partir daí ele não existe mais — mas
 * continua ocupando espaço na tela parecendo uma proteção.
 */
const AMOSTRA_MINIMA = 10;
const TAXA_ERRO_ALERTA = 0.05;
const TAXA_FALLBACK_ALERTA = 0.1;

export function readFlowHealth(metrics: FlowMetrics): FlowHealthReading {
  /**
   * ⚠️ SEM CONVERSAS NÃO HÁ SAÚDE A MEDIR, e `idle` não é `healthy`.
   *
   * Um fluxo publicado que ninguém acionou pode estar perfeito ou pode estar
   * inalcançável — não tem canal de entrada, não é o fluxo de entrada do
   * WhatsApp. Pintá-lo de verde afirmaria a primeira hipótese sem evidência
   * nenhuma, e é justamente a segunda que precisa ser notada.
   */
  if (metrics.started === 0) {
    return { status: "idle", reason: "Nenhuma conversa no período." };
  }

  const taxaErro = metrics.failed / metrics.started;

  if (taxaErro > TAXA_ERRO_ALERTA && metrics.started >= AMOSTRA_MINIMA) {
    return {
      status: "error",
      reason: `${(taxaErro * 100).toFixed(1)}% das conversas falharam.`,
    };
  }

  // ⚠️ UMA FALHA EM POUCAS CONVERSAS AINDA MERECE AVISO. Com amostra pequena a
  // taxa não é confiável, mas "houve falha" é um fato — e num fluxo novo, que é
  // quando a amostra é pequena, é exatamente o que se quer ver.
  if (metrics.failed > 0) {
    return {
      status: "warning",
      reason: `${metrics.failed} ${metrics.failed === 1 ? "conversa falhou" : "conversas falharam"}.`,
    };
  }

  const taxaFallback = metrics.fallbackRuns / metrics.started;
  if (taxaFallback > TAXA_FALLBACK_ALERTA && metrics.started >= AMOSTRA_MINIMA) {
    return {
      status: "warning",
      reason: `${(taxaFallback * 100).toFixed(1)}% das conversas tiveram resposta não entendida.`,
    };
  }

  if (metrics.abandoned > 0 && metrics.abandoned / metrics.started > 0.2) {
    return {
      status: "warning",
      reason: `${metrics.abandoned} conversas pararam no meio sem terminar.`,
    };
  }

  return { status: "healthy", reason: "" };
}

/* -------------------------------------------------------------------------- */
/* §37, §38 — o histórico                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A trilha de um fluxo, pelo NOME.
 *
 * ⚠️ PELO NOME, E NÃO PELO ID, porque é assim que `log_admin_action` grava o
 * alvo — as funções do banco passam `(select f.name from public.flows f …)`.
 * A consequência precisa estar escrita: RENOMEAR UM FLUXO PARTE O HISTÓRICO
 * DELE EM DOIS. As linhas antigas ficam com o nome antigo, e esta consulta não
 * as encontra mais.
 *
 * É o mesmo preço que `listAdminAudit(target)` já paga com o e-mail de um
 * usuário, e é o mesmo motivo: a trilha guarda um texto LEGÍVEL, para continuar
 * legível depois que a linha de origem some. Trocar para id resolveria o
 * histórico e quebraria a leitura de um fluxo excluído.
 */
export async function listFlowAudit(flowName: string, limit = 30): Promise<AdminAuditEntry[]> {
  return listAdminAudit(limit, flowName);
}
