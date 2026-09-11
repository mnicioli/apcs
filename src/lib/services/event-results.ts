import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  RESULTS_PAGE_SIZE,
  type ResultsExport,
  type ResultsFilters,
  type ResultsPendingMetrics,
  type ResultsPendingPage,
  type ResultsPendingRow,
  type ResultsResponseDetail,
  type ResultsResponsePage,
  type ResultsResponseRow,
  type ResultsSection,
  type ResultsSummary,
} from "@/modules/event/event.results.types";

/**
 * AS LEITURAS DOS RESULTADOS.
 *
 * Ver docs/SERVICE-ACTION-PATTERN.md: leitura é `server-only`, LANÇA erro (a
 * página tem `error.tsx`), e nunca escreve.
 *
 * ============================================================================
 * ⚠️ ESTE ARQUIVO NÃO CALCULA NADA, E É O §44.
 * ============================================================================
 * "O frontend NÃO deve ser responsável pela regra de negócio dos indicadores.
 * Não fazer: buscar 10.000 respostas → frontend calcula média."
 *
 * Média, mínimo, máximo, distribuição, contagem de elegíveis, taxa e a
 * separação por versão saem PRONTOS do Postgres. O que este arquivo faz é
 * chamar a função, conferir o formato e devolver — nenhum `reduce`, nenhum
 * `filter` sobre respostas.
 *
 * ⚠️ E SÃO CINCO FUNÇÕES SEPARADAS, e não uma que devolve tudo (§43: "evitar
 * criar um endpoint gigantesco retornando absolutamente todos os dados"). A aba
 * de Painel não carrega a lista de pendentes; a de Respostas não recalcula a
 * distribuição. Cada tela pede o que desenha.
 *
 * ⚠️ AS CINCO SÃO `SECURITY INVOKER` NO BANCO, então a RLS continua valendo: quem
 * não passa em `evaluations_is_reader()` recebe zero linhas mesmo que a checagem
 * de permissão da aplicação falhe (§45). Duas barreiras, como em todo o resto.
 */

/**
 * Os números do topo (§3, §5, §28).
 *
 * ⚠️ DEVOLVE `null` QUANDO O EVENTO NÃO EXISTE, e não lança. Quem chama é uma
 * página com `[eventId]` na rota, e o certo ali é `notFound()` — um erro 500
 * para um id inventado na barra de endereço seria a tela de falha onde deveria
 * estar a de "não encontrado".
 *
 * ⚠️ E EVENTO INEXISTENTE E EVENTO BARRADO PELA RLS CHEGAM IGUAIS (§45).
 * Distinguir contaria a quem está tentando que o id acertado é real.
 */
export async function getResultsSummary(eventId: string): Promise<ResultsSummary | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("event_results_summary", {
    p_event_id: eventId,
  } as never);

  if (error) {
    // ⚠️ O CÓDIGO, E NUNCA A MENSAGEM CRUA. Mensagem de Postgres carrega nome de
    // tabela e de constraint.
    console.error(`[event-results] getResultsSummary falhou: ${error.code}`);
    throw error;
  }

  if (!data || typeof data !== "object") return null;

  const resumo = data as unknown as ResultsSummary;
  return resumo.eventId ? resumo : null;
}

/** A tabulação por bloco e pergunta (§7 a §11, §33, §36, §37). */
export async function getResultsQuestions(eventId: string): Promise<ResultsSection[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("event_results_questions", {
    p_event_id: eventId,
  } as never);

  if (error) {
    console.error(`[event-results] getResultsQuestions falhou: ${error.code}`);
    throw error;
  }

  return Array.isArray(data) ? (data as unknown as ResultsSection[]) : [];
}

/** A lista de quem respondeu (§16, §17, §18). */
export async function getResultsResponses(
  eventId: string,
  filters: ResultsFilters,
  pageSize: number = RESULTS_PAGE_SIZE,
): Promise<ResultsResponsePage> {
  const supabase = await createClient();
  const paginaAtual = Math.max(1, filters.page);

  const { data, error } = await supabase.rpc("event_results_responses", {
    p_event_id: eventId,
    p_query: filters.query.trim() || undefined,
    p_filter: filters.filter === "all" ? undefined : filters.filter,
    p_limit: pageSize,
    p_offset: (paginaAtual - 1) * pageSize,
  } as never);

  if (error) {
    console.error(`[event-results] getResultsResponses falhou: ${error.code}`);
    throw error;
  }

  const bruto = (data ?? {}) as { total?: unknown; rows?: unknown; withComment?: unknown };

  return {
    rows: Array.isArray(bruto.rows) ? (bruto.rows as ResultsResponseRow[]) : [],
    total: typeof bruto.total === "number" ? bruto.total : 0,
    withComment: typeof bruto.withComment === "number" ? bruto.withComment : 0,
    page: paginaAtual,
    pageSize,
  };
}

/**
 * O detalhe de uma resposta (§15).
 *
 * ⚠️ O EVENTO VAI JUNTO, E É O §45 (IDOR). O banco confere que a avaliação
 * pertence AO EVENTO antes de devolver qualquer coisa; passar só o id da
 * avaliação deixaria essa conferência sem os dois lados.
 */
export async function getResponseDetail(
  eventId: string,
  participantEvaluationId: string,
): Promise<ResultsResponseDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("event_results_response_detail", {
    p_event_id: eventId,
    p_participant_evaluation_id: participantEvaluationId,
  } as never);

  if (error) {
    console.error(`[event-results] getResponseDetail falhou: ${error.code}`);
    throw error;
  }

  if (!data || typeof data !== "object") return null;

  const detalhe = data as unknown as ResultsResponseDetail;
  return detalhe.participantEvaluationId ? detalhe : null;
}

/** Presentes que ainda não responderam (§31). */
export async function getResultsPending(
  eventId: string,
  filters: ResultsFilters,
  pageSize: number = RESULTS_PAGE_SIZE,
): Promise<ResultsPendingPage> {
  const supabase = await createClient();
  const paginaAtual = Math.max(1, filters.page);

  const { data, error } = await supabase.rpc("event_results_pending", {
    p_event_id: eventId,
    p_query: filters.query.trim() || undefined,
    p_limit: pageSize,
    p_offset: (paginaAtual - 1) * pageSize,
  } as never);

  if (error) {
    console.error(`[event-results] getResultsPending falhou: ${error.code}`);
    throw error;
  }

  const bruto = (data ?? {}) as { total?: unknown; rows?: unknown; metrics?: unknown };
  const metricas = (bruto.metrics ?? {}) as Partial<ResultsPendingMetrics>;

  return {
    rows: Array.isArray(bruto.rows) ? (bruto.rows as ResultsPendingRow[]) : [],
    metrics: {
      notCreated: metricas.notCreated ?? 0,
      queued: metricas.queued ?? 0,
      sent: metricas.sent ?? 0,
      expired: metricas.expired ?? 0,
      failed: metricas.failed ?? 0,
    },
    total: typeof bruto.total === "number" ? bruto.total : 0,
    page: paginaAtual,
    pageSize,
  };
}

/**
 * As linhas da exportação, com as colunas dinâmicas (§25, §27).
 *
 * ⚠️ `pageSize` GENEROSO E EXPLÍCITO. O §27 proíbe exportar só a página
 * carregada; o teto existe para uma consulta acidental não virar um arquivo de
 * gigabytes, e não para limitar uso legítimo — é o mesmo raciocínio (e o mesmo
 * número) da exportação de Inscrições.
 */
export async function getResultsExport(
  eventId: string,
  filters: Pick<ResultsFilters, "query" | "filter">,
  limite = 5000,
): Promise<ResultsExport | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("event_results_export", {
    p_event_id: eventId,
    p_query: filters.query.trim() || undefined,
    p_filter: filters.filter === "all" ? undefined : filters.filter,
    p_limit: limite,
  } as never);

  if (error) {
    console.error(`[event-results] getResultsExport falhou: ${error.code}`);
    throw error;
  }

  if (!data || typeof data !== "object") return null;

  const bruto = data as unknown as ResultsExport;
  return {
    eventName: bruto.eventName ?? "",
    eventDate: bruto.eventDate ?? "",
    questions: Array.isArray(bruto.questions) ? bruto.questions : [],
    rows: Array.isArray(bruto.rows) ? bruto.rows : [],
  };
}
