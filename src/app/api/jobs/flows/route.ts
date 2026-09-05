import { NextResponse, type NextRequest } from "next/server";
import { authorizeJob } from "@/lib/messaging/job-auth";
import { messagingProvider } from "@/lib/messaging/registry";
import { newCorrelationId, logFlowEngineEvent } from "@/lib/messaging/telemetry";
import { runFlowTimeoutTick } from "@/lib/flow/timeout";

/**
 * O RELÓGIO DOS FLUXOS DE ATENDIMENTO (§27 do Prompt 3).
 *
 * Uma passada: acha as conversas que emudeceram além do prazo do fluxo delas e
 * aplica a ação configurada — lembrete, encerramento ou transferência.
 *
 * ⚠️ POR QUE UM CRON, E NÃO UM AGENDAMENTO POR CONVERSA. Um `setTimeout` morre
 * com o processo; um job agendado por conversa criaria uma linha de fila para
 * cada pergunta enviada — dezenas de milhares delas, quase todas canceladas
 * segundos depois porque a pessoa respondeu. A varredura pergunta uma vez a
 * cada ciclo e paga só pelo que de fato venceu (o índice parcial
 * `flow_runs_timeout_idx` é o que torna isso barato).
 *
 * Como acionar (as duas funcionam):
 *
 *   • Vercel Cron — acrescente ao `vercel.json`:
 *       { "crons": [{ "path": "/api/jobs/flows", "schedule": "0 * * * *" }] }
 *     e defina `CRON_SECRET` no projeto. O Vercel manda o Bearer sozinho.
 *
 *   • Qualquer cron externo:
 *       curl -X POST https://<host>/api/jobs/flows \
 *            -H "x-apcs-job-secret: $APCS_JOB_SECRET"
 *
 * A cadência de hora em hora é folgada de propósito: o menor prazo configurável
 * é de cinco minutos (`flows_timeout_shape`), mas prazos reais de atendimento
 * se medem em horas. Um cron mais frequente não erra — só trabalha à toa.
 *
 * ⚠️ CHAMAR DUAS VEZES SEGUIDAS É SEGURO. A chave de idempotência do passo
 * carrega o `lock_version` da execução: sem nada ter mudado no meio, a segunda
 * passada pede a mesma chave e é recusada pelo índice único.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** O orçamento do serviço é de 45 s; 60 dá folga para a resposta sair. */
export const maxDuration = 60;

async function executar(request: NextRequest) {
  const auth = authorizeJob(request.headers);

  if (!auth.ok) {
    logFlowEngineEvent("error", "flow.timeout", { reason: auth.reason, status: "recusado" });
    return NextResponse.json(
      { error: auth.status === 503 ? "job_not_configured" : "unauthorized" },
      { status: auth.status },
    );
  }

  const correlationId = newCorrelationId();

  try {
    const provider = messagingProvider();
    const resultado = await runFlowTimeoutTick(provider, correlationId);

    logFlowEngineEvent("info", "flow.timeout", {
      correlationId,
      count: resultado.examined,
      status: "tick concluido",
    });

    return NextResponse.json({
      ok: true,
      provider: { name: provider.name, configured: provider.configured, missing: provider.missing },
      ...resultado,
      correlationId,
    });
  } catch (error) {
    logFlowEngineEvent("error", "flow.timeout", {
      correlationId,
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
