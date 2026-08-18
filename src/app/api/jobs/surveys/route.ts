import { NextResponse, type NextRequest } from "next/server";
import { authorizeJob } from "@/lib/messaging/job-auth";
import { messagingProvider } from "@/lib/messaging/registry";
import { logSurveyEvent } from "@/lib/messaging/telemetry";
import { runSurveyTick } from "@/lib/services/survey-scheduler";

/**
 * O CICLO DE ENQUETES (§22, §66, §87).
 *
 * Uma passada: destrava o que ficou preso, ativa o que venceu, encerra o que
 * passou da data, fecha contextos de enquete encerrada e manda o que estiver na
 * fila.
 *
 * Como acionar (as duas funcionam):
 *
 *   • Vercel Cron — acrescente ao `vercel.json`:
 *       { "crons": [{ "path": "/api/jobs/surveys", "schedule": "* / 5 * * * *" }] }
 *     e defina `CRON_SECRET` no projeto. O Vercel manda o Bearer sozinho.
 *
 *   • Qualquer cron externo:
 *       curl -X POST https://<host>/api/jobs/surveys \
 *            -H "x-apcs-job-secret: $APCS_JOB_SECRET"
 *
 * ⚠️ CHAMAR DUAS VEZES SEGUIDAS É SEGURO. Toda função que ela invoca é
 * idempotente por construção: as varreduras filtram por situação, a fila
 * reivindica com `skip locked` e o destinatário só sai de `pending` uma vez.
 * Isso é o que permite deixar o cron agressivo sem medo.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O orçamento do serviço é de 45 s; 60 dá folga para a resposta sair. Se a
 * plataforma não permitir este teto, ela reduz — e o ciclo seguinte continua de
 * onde parou, que é o comportamento normal e não uma falha.
 */
export const maxDuration = 60;

async function executar(request: NextRequest) {
  const auth = authorizeJob(request.headers);
  if (!auth.ok) {
    logSurveyEvent("error", "scheduler.tick", { reason: auth.reason, outcome: "recusado" });
    return NextResponse.json(
      { error: auth.status === 503 ? "job_not_configured" : "unauthorized" },
      { status: auth.status },
    );
  }

  try {
    const provider = messagingProvider();
    const resultado = await runSurveyTick(provider);

    return NextResponse.json({
      ok: true,
      provider: { name: provider.name, configured: provider.configured, missing: provider.missing },
      requeued: resultado.requeued,
      activated: resultado.activated,
      closed: resultado.closed,
      expiredContexts: resultado.expiredContexts,
      dispatches: resultado.dispatches.map((d) => ({
        surveyId: d.surveyId,
        sent: d.sent,
        errors: d.errors,
        blocked: d.blocked,
        released: d.released,
        remaining: d.remaining,
        skipped: d.skipped,
      })),
      correlationId: resultado.correlationId,
    });
  } catch (error) {
    logSurveyEvent("error", "scheduler.tick", {
      reason: error instanceof Error ? error.message : String(error),
    });
    // A mensagem crua fica no log. O que sai é genérico: esta rota é pública, e
    // detalhe de erro num endpoint aberto mapeia o sistema para quem estiver
    // medindo.
    return NextResponse.json({ error: "tick_failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return executar(request);
}

/**
 * O Vercel Cron chama por GET. Como a autorização é a mesma e a operação é
 * idempotente, aceitar os dois verbos evita uma configuração a mais para dar
 * errado — sem afrouxar nada.
 */
export async function GET(request: NextRequest) {
  return executar(request);
}
