import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  EvaluationDetail,
  EvaluationParticipantFilters,
  EvaluationParticipantMetrics,
  EvaluationParticipantPage,
  EvaluationParticipantRow,
  EvaluationSummary,
  EvaluationSummaryPage,
} from "@/modules/event/event.evaluation.types";

/**
 * AS LEITURAS DA AVALIAÇÃO DE EVENTO.
 *
 * Ver docs/SERVICE-ACTION-PATTERN.md: leitura é `server-only`, LANÇA erro (a
 * página tem `error.tsx`), e nunca escreve.
 *
 * ⚠️ AS TRÊS CONSULTAS SÃO FUNÇÕES `SECURITY INVOKER` DO BANCO, e isso é o que
 * mantém a RLS valendo: quem não passa em `evaluations_is_reader()` recebe zero
 * linhas mesmo que a checagem de permissão da aplicação falhe. Duas barreiras,
 * como em todo o resto do projeto.
 *
 * ⚠️ E MÉTRICAS, LINHAS E TOTAL VÊM DA MESMA CHAMADA. É a mesma decisão de
 * `getRegistrationBoard`: contadores numa consulta e lista em outra divergem no
 * dia em que um filtro entrar só numa delas, e ninguém confere a soma à mão.
 */

/** A grid de eventos cabe em 20 linhas; a lista de pessoas, em 25. */
export const EVALUATION_EVENT_PAGE_SIZE = 20;
export const EVALUATION_PARTICIPANT_PAGE_SIZE = 25;

/**
 * A tela de seleção: os eventos com participante (§21).
 */
export async function listEvaluationSummaries(
  query: string,
  page: number,
  pageSize: number = EVALUATION_EVENT_PAGE_SIZE,
): Promise<EvaluationSummaryPage> {
  const supabase = await createClient();
  const paginaAtual = Math.max(1, page);

  const { data, error } = await supabase.rpc("event_evaluation_summaries", {
    p_query: query.trim() || undefined,
    p_limit: pageSize,
    p_offset: (paginaAtual - 1) * pageSize,
  } as never);

  if (error) {
    // ⚠️ O CÓDIGO, E NUNCA A MENSAGEM CRUA. Mensagem de Postgres carrega nome de
    // tabela e de constraint, e o log de uma aplicação vai parar em lugares que
    // ninguém controla.
    console.error(`[event-evaluation] listEvaluationSummaries falhou: ${error.code}`);
    throw error;
  }

  const bruto = (data ?? {}) as { total?: unknown; rows?: unknown };

  return {
    rows: Array.isArray(bruto.rows) ? (bruto.rows as EvaluationSummary[]) : [],
    total: typeof bruto.total === "number" ? bruto.total : 0,
    page: paginaAtual,
    pageSize,
  };
}

/**
 * A configuração e a estrutura de UM evento (§22).
 *
 * ⚠️ DEVOLVE `null` QUANDO O EVENTO NÃO EXISTE, e não lança. Quem chama é uma
 * página com `[eventId]` na rota, e o certo ali é `notFound()` — um erro 500
 * para um id inventado na barra de endereço seria a tela de falha onde deveria
 * estar a de "não encontrado".
 */
export async function getEvaluationDetail(eventId: string): Promise<EvaluationDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("event_evaluation_detail", {
    p_event_id: eventId,
  } as never);

  if (error) {
    console.error(`[event-evaluation] getEvaluationDetail falhou: ${error.code}`);
    throw error;
  }

  if (!data || typeof data !== "object") return null;

  const detalhe = data as unknown as EvaluationDetail;

  // ⚠️ A FUNÇÃO DO BANCO DEVOLVE `null` PARA EVENTO INEXISTENTE **E** PARA QUEM
  // A RLS BARRA — e os dois casos chegam aqui iguais, de propósito. Distinguir
  // "não existe" de "existe e não é seu" contaria a quem está tentando que o id
  // acertado é real.
  return detalhe.eventId ? detalhe : null;
}

/**
 * O andamento por participante presente (§21).
 *
 * ⚠️ SÓ PRESENTES, e o recorte está na função do banco, não aqui. É o §11: quem
 * não apareceu não é elegível, e listá-lo com "—" em toda coluna faria a taxa de
 * resposta da tela parecer pior do que é.
 */
export async function getEvaluationParticipants(
  eventId: string,
  filters: EvaluationParticipantFilters,
  pageSize: number = EVALUATION_PARTICIPANT_PAGE_SIZE,
): Promise<EvaluationParticipantPage> {
  const supabase = await createClient();
  const paginaAtual = Math.max(1, filters.page);

  const { data, error } = await supabase.rpc("event_evaluation_participants", {
    p_event_id: eventId,
    p_query: filters.query.trim() || undefined,
    p_status: filters.status === "all" ? undefined : filters.status,
    p_limit: pageSize,
    p_offset: (paginaAtual - 1) * pageSize,
  } as never);

  if (error) {
    console.error(`[event-evaluation] getEvaluationParticipants falhou: ${error.code}`);
    throw error;
  }

  const bruto = (data ?? {}) as { total?: unknown; rows?: unknown; metrics?: unknown };
  const metricas = (bruto.metrics ?? {}) as Partial<EvaluationParticipantMetrics>;

  return {
    rows: Array.isArray(bruto.rows) ? (bruto.rows as EvaluationParticipantRow[]) : [],
    metrics: {
      present: metricas.present ?? 0,
      sent: metricas.sent ?? 0,
      answered: metricas.answered ?? 0,
      failed: metricas.failed ?? 0,
    },
    total: typeof bruto.total === "number" ? bruto.total : 0,
    page: paginaAtual,
    pageSize,
  };
}
