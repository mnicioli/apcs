import { NextResponse, type NextRequest } from "next/server";
import { authorizeJob } from "@/lib/messaging/job-auth";
import { messagingProvider } from "@/lib/messaging/registry";
import { logEvaluationDispatch } from "@/lib/messaging/telemetry";
import { runEventEvaluationTick } from "@/lib/services/event-evaluation-dispatch";
import { getSiteOrigin } from "@/lib/http/site-url";

/**
 * O CICLO DA AVALIAÇÃO DE EVENTO (§14).
 *
 * Uma passada: expira o que venceu o prazo, cria a avaliação de quem esteve
 * PRESENTE em evento já terminado + atraso, e manda o que estiver na fila.
 *
 * ============================================================================
 * ⚠️ TERCEIRA ROTA DE JOB, E NÃO UM CRON PARALELO.
 * ============================================================================
 * O §14 manda "não criar um cron paralelo se já existir infraestrutura para
 * isso". A infraestrutura deste projeto é esta: uma rota HTTP por domínio,
 * protegida por `authorizeJob`, acionada de fora. `/api/jobs/surveys` e
 * `/api/jobs/flows` já existem, e esta é a terceira, com a mesma forma.
 *
 * ⚠️ ROTA PRÓPRIA, E NÃO UM PASSO DENTRO DE `/api/jobs/surveys`. Os dois
 * domínios têm ritmos diferentes (enquete dispara o dia inteiro; avaliação
 * dispara algumas vezes por mês, sempre depois de um evento) e orçamentos de
 * tempo que competem: uma campanha de enquete grande consumiria os 60 s e o
 * convite de avaliação nunca sairia. Separadas, cada uma tem o seu.
 *
 * Como acionar (as duas funcionam):
 *
 *   • Vercel Cron — acrescente ao `vercel.json`:
 *       { "crons": [{ "path": "/api/jobs/event-evaluations", "schedule": "* / 10 * * * *" }] }
 *     e defina `CRON_SECRET` no projeto. O Vercel manda o Bearer sozinho.
 *
 *   • Qualquer cron externo:
 *       curl -X POST https://<host>/api/jobs/event-evaluations \
 *            -H "x-apcs-job-secret: $APCS_JOB_SECRET"
 *
 * ⚠️ CHAMAR DUAS VEZES SEGUIDAS É SEGURO (§15). Toda função que ela invoca é
 * idempotente por construção: o agendamento esbarra no índice único
 * `(event_id, participant_id)`, a reivindicação usa `skip locked` com
 * arrendamento de dez minutos, e a marcação só sai de um estado que ainda não
 * foi marcado. Isso é o que permite deixar o cron agressivo sem medo.
 *
 * ⚠️ DEZ MINUTOS BASTA, e cinco seria desperdício. O atraso configurável do §9 é
 * de 30 minutos para cima; um convite sair até dez minutos depois da hora exata
 * não muda nada para quem recebe, e a metade das execuções não encontraria
 * trabalho nenhum.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O orçamento do serviço é de 40 s; 60 dá folga para a resposta sair. Se a
 * plataforma não permitir este teto, ela reduz — e o ciclo seguinte continua de
 * onde parou, que é o comportamento normal e não uma falha.
 */
export const maxDuration = 60;

async function executar(request: NextRequest) {
  const auth = authorizeJob(request.headers);
  if (!auth.ok) {
    logEvaluationDispatch("error", "tick.skipped", { reason: auth.reason, outcome: "recusado" });
    return NextResponse.json(
      { error: auth.status === 503 ? "job_not_configured" : "unauthorized" },
      { status: auth.status },
    );
  }

  try {
    /**
     * ⚠️ O ENDEREÇO É RESOLVIDO AQUI, e passado para o worker — ele não o
     * descobre sozinho. O link do convite é ABSOLUTO (vai para o WhatsApp, não
     * para o navegador de quem já está no sistema), e `getSiteOrigin()` depende
     * de `headers()`, que só existe dentro de uma requisição.
     *
     * Deixar o worker chamá-la o prenderia a um contexto de requisição — e o
     * teste dele teria de simular um. Recebendo o endereço, ele é uma função
     * comum.
     */
    const origin = await getSiteOrigin();

    if (!origin) {
      // ⚠️ SEM ENDEREÇO NÃO SE MANDA NADA. Um convite com link relativo chega
      // ao WhatsApp como texto solto, e a pessoa não tem para onde ir — pior
      // que não receber, porque ela sabe que existe uma avaliação e não
      // consegue respondê-la.
      logEvaluationDispatch("error", "tick.skipped", {
        reason: "NEXT_PUBLIC_SITE_URL não configurada",
      });
      return NextResponse.json({ error: "site_url_missing" }, { status: 503 });
    }

    const provider = messagingProvider();
    const resultado = await runEventEvaluationTick(origin, provider);

    return NextResponse.json({
      ok: true,
      provider: { name: provider.name, configured: provider.configured, missing: provider.missing },
      created: resultado.created,
      events: resultado.events,
      expired: resultado.expired,
      // §5 e §14 do Prompt 4. O que a passada ignorou, e por quê — "evento
      // processado, 0 presentes, 0 envios" precisa sair em algum lugar.
      skippedNoPresent: resultado.skippedNoPresent,
      skippedNoQuestions: resultado.skippedNoQuestions,
      claimed: resultado.claimed,
      sent: resultado.sent,
      errors: resultado.errors,
      ineligible: resultado.ineligible,
      // §22. Convites barrados por o texto estar sem {{link_avaliacao}}.
      misconfigured: resultado.misconfigured,
      unsettled: resultado.unsettled,
      correlationId: resultado.correlationId,
    });
  } catch (error) {
    logEvaluationDispatch("error", "tick.skipped", {
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
