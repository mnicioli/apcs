import { NextResponse, type NextRequest } from "next/server";
import { messagingProvider } from "@/lib/messaging/registry";
import { CloudApiProvider } from "@/lib/messaging/providers/cloud-api";
import { logSurveyEvent, newCorrelationId } from "@/lib/messaging/telemetry";
import { processInboundEvents } from "@/lib/services/survey-inbox";

/**
 * O WEBHOOK DO WHATSAPP (§17, §18, §19).
 *
 * `GET`  → o handshake de verificação que a Meta faz ao cadastrar a URL.
 * `POST` → os eventos: respostas das pessoas e avisos de entrega/leitura.
 *
 * ⚠️ ELE RESPONDE 200 QUASE SEMPRE, E ISSO É DE PROPÓSITO (§19).
 *
 * Para o fornecedor, qualquer coisa diferente de 200 significa "não recebi,
 * mande de novo" — e ele reentrega com backoff por horas. Um payload que não
 * entendemos, ou um evento de uma mensagem que não é nossa, não melhora sendo
 * reentregue mil vezes: melhora sendo registrado e ignorado.
 *
 * As DUAS exceções, e só elas:
 *   • 401 — assinatura ausente ou inválida (§18): não é a Meta falando.
 *   • 413 — corpo grande demais: nem chega a ser lido.
 */

// `node:crypto` (HMAC) e o cliente service_role exigem runtime Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Teto do corpo. Um lote da Cloud API com dezenas de status cabe folgado em
 * 256 KB; acima disso é anomalia, e bufferizar sem teto é o convite clássico a
 * derrubar o processo por memória.
 */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * §17. O handshake de cadastro da URL.
 *
 * A Meta chama com `hub.mode=subscribe`, `hub.verify_token=<o que você
 * configurou>` e `hub.challenge=<número>`. Devolver o challenge em texto puro é
 * o que confirma que a URL é sua.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const provider = messagingProvider();

  const aprovado =
    provider instanceof CloudApiProvider &&
    provider.verifyChallenge(params.get("hub.mode"), params.get("hub.verify_token"));

  if (!aprovado) {
    logSurveyEvent("error", "webhook.rejected", {
      provider: provider.name,
      reason: "handshake recusado",
    });
    return new NextResponse("forbidden", { status: 403 });
  }

  const challenge = params.get("hub.challenge") ?? "";
  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  const provider = messagingProvider();

  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  // ⚠️ O CORPO CRU, e nunca `await request.json()`.
  //
  // O HMAC do §18 é calculado sobre os BYTES que chegaram. Reserializar o JSON
  // produz outro texto (ordem de chaves, escapes, espaços) e a assinatura nunca
  // bate — o que costuma "resolver" com alguém desligando a verificação.
  const rawBody = await request.text();

  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  const assinatura = provider.verifySignature(rawBody, request.headers);
  if (!assinatura.valid) {
    logSurveyEvent("error", "webhook.rejected", {
      correlationId,
      provider: provider.name,
      reason: assinatura.reason,
    });
    // Resposta genérica: dizer QUAL parte da assinatura falhou ajudaria quem
    // estiver tentando forjar uma.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Assinado corretamente mas ilegível: registra e aceita. Reentregar não vai
    // consertar o JSON.
    logSurveyEvent("error", "webhook.rejected", {
      correlationId,
      provider: provider.name,
      reason: "corpo não é JSON",
    });
    return NextResponse.json({ ok: true, ignored: true });
  }

  const eventos = provider.parseWebhook(payload);

  logSurveyEvent("info", "webhook.received", {
    correlationId,
    provider: provider.name,
    count: eventos.length,
  });

  if (eventos.length === 0) return NextResponse.json({ ok: true, events: 0 });

  try {
    const resultado = await processInboundEvents(eventos, provider, correlationId);
    return NextResponse.json({
      ok: true,
      events: eventos.length,
      processed: resultado.processed,
      duplicates: resultado.duplicates,
      ignored: resultado.ignored,
    });
  } catch (error) {
    logSurveyEvent("error", "webhook.received", {
      correlationId,
      provider: provider.name,
      outcome: "falhou",
      reason: error instanceof Error ? error.message : String(error),
    });
    // 200 mesmo assim: o evento já está gravado como recebido, e reentregar
    // repetiria o mesmo erro. O contador `survey_webhook_unprocessed` (§53) é
    // quem denuncia que alguém precisa olhar.
    return NextResponse.json({ ok: true, deferred: true });
  }
}
