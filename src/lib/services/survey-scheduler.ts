import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { messagingProvider } from "@/lib/messaging/registry";
import { logSurveyEvent, newCorrelationId } from "@/lib/messaging/telemetry";
import { runSurveyDispatch, type DispatchOutcome } from "./survey-dispatch";
import type { MessagingProvider } from "@/lib/messaging/messaging.types";

/**
 * O CICLO (§22, §37 do prompt 1, §66, §87, §89).
 *
 * Uma passada faz, nesta ordem:
 *
 *   1. devolve à fila quem ficou preso em ENVIANDO (§87);
 *   2. ativa o que venceu o agendamento e encerra o que passou da data (§37/§57
 *      do prompt 1 — a função do banco, que é idempotente);
 *   3. fecha os contextos de conversa de enquetes encerradas (§41);
 *   4. dispara quem tem fila.
 *
 * ⚠️ A ORDEM NÃO É ARBITRÁRIA. Ativar antes de expirar deixaria uma enquete
 * vencida ativa por um instante; disparar antes de ativar mandaria mensagem de
 * enquete que ainda não abriu.
 *
 * ⚠️ SOBRE O RELÓGIO (§89): quem decide "já venceu?" é o Postgres, com `now()`
 * em UTC. Nem o navegador, nem o Node, nem o fuso do servidor da Vercel entram
 * nessa conta. É o que faz o mesmo agendamento valer igual para quem opera de
 * São Paulo e para o cron que roda em Washington.
 */

export interface SchedulerOutcome {
  requeued: number;
  activated: number;
  closed: number;
  expiredContexts: number;
  dispatches: DispatchOutcome[];
  providerConfigured: boolean;
  correlationId: string;
}

/** Quantas enquetes uma passada dispara. As demais ficam para a seguinte. */
const MAX_SURVEYS_PER_TICK = 5;

export async function runSurveyTick(
  provider: MessagingProvider = messagingProvider(),
): Promise<SchedulerOutcome> {
  const correlationId = newCorrelationId();
  const admin = createAdminClient();

  const resultado: SchedulerOutcome = {
    requeued: 0,
    activated: 0,
    closed: 0,
    expiredContexts: 0,
    dispatches: [],
    providerConfigured: provider.configured,
    correlationId,
  };

  const { data: presos } = await admin.rpc("requeue_stuck_survey_recipients", {} as never);
  resultado.requeued = typeof presos === "number" ? presos : 0;

  const { data: processadas, error: processError } = await admin
    .rpc("process_scheduled_surveys")
    .single();

  if (processError) {
    logSurveyEvent("error", "scheduler.tick", {
      correlationId,
      reason: processError.message,
    });
  } else if (processadas) {
    resultado.activated = processadas.activated ?? 0;
    resultado.closed = processadas.closed ?? 0;
  }

  const { data: contextos } = await admin.rpc("expire_survey_contexts");
  resultado.expiredContexts = typeof contextos === "number" ? contextos : 0;

  logSurveyEvent("info", "scheduler.tick", {
    correlationId,
    outcome: `ativadas=${resultado.activated} encerradas=${resultado.closed} presos=${resultado.requeued} contextos=${resultado.expiredContexts}`,
  });

  // ⚠️ O disparo só acontece com fornecedor configurado — mas TUDO ACIMA
  // acontece de qualquer jeito. Ativar e encerrar no horário é uma promessa da
  // tela que não depende de WhatsApp nenhum: a enquete abre para o chat da web
  // na hora marcada mesmo sem integração de mensageria.
  if (!provider.configured) return resultado;

  for (const surveyId of await surveysWithQueue(MAX_SURVEYS_PER_TICK)) {
    resultado.dispatches.push(await runSurveyDispatch(surveyId, provider));
  }

  return resultado;
}

/**
 * As enquetes ATIVAS com alguém esperando na fila.
 *
 * Uma consulta e não duas: `survey_recipients` já sabe o `survey_id`, e o
 * filtro por situação vem do join implícito do PostgREST.
 */
async function surveysWithQueue(limite: number): Promise<string[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("survey_recipients")
    .select("survey_id, surveys!inner(status)")
    .eq("status", "pending")
    .eq("surveys.status", "active")
    .limit(500);

  if (error) {
    logSurveyEvent("error", "scheduler.tick", { reason: error.message });
    return [];
  }

  const unicos = new Set((data ?? []).map((linha) => linha.survey_id));
  return [...unicos].slice(0, limite);
}
