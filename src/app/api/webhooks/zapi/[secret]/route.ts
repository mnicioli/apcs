import { NextResponse, after, type NextRequest } from "next/server";
import { messagingProvider } from "@/lib/messaging/registry";
import { ZApiProvider } from "@/lib/messaging/providers/z-api";
import { logWhatsAppEvent, newCorrelationId } from "@/lib/messaging/telemetry";
import { downloadPendingMedia, recordInboundEvents } from "@/lib/services/whatsapp-inbox";
import { processInboundEvents } from "@/lib/services/survey-inbox";
import { processChatbotMessages } from "@/lib/services/intelligence-inbox";
import { processOptOutRequests } from "@/lib/services/notification-optout";
import type { InboundEvent } from "@/lib/messaging/messaging.types";
import type { RecordedMessage } from "@/lib/services/whatsapp-inbox";

/**
 * O WEBHOOK DA Z-API.
 *
 * Uma rota só para os três avisos que a Z-API manda (mensagem recebida, entrega
 * e status). O painel dela aceita a mesma URL nos três — e o adaptador
 * distingue pelo campo `type` do corpo.
 *
 * ----------------------------------------------------------------------------
 * A FILA DE CONSUMIDORES, EM ORDEM
 * ----------------------------------------------------------------------------
 *
 *     livro-razão  grava TUDO, sempre, antes de qualquer decisão
 *         ↓
 *     opt-out      quem pediu para sair não recebe mais nada
 *         ↓
 *     enquetes     um "3" dentro de uma enquete é voto, não pergunta
 *         ↓
 *     robô         o resto — e só depois do 200 (§39)
 *
 * ⚠️ A ORDEM É A REGRA, e cada passo tira eventos do seguinte. Trocar dois de
 * lugar não é refatoração: é mudar o que a APCS responde a uma pessoa.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ POR QUE O SEGREDO ESTÁ NO CAMINHO DA URL
 * ----------------------------------------------------------------------------
 *
 * A Cloud API da Meta assina o corpo (`X-Hub-Signature-256`) e a rota
 * `/api/webhooks/whatsapp` confere o HMAC. A Z-API NÃO ASSINA NADA: não há
 * header secreto, não há campo de verificação, não há nada no que chega que
 * prove a origem (documentação oficial, webhooks/introduction e
 * security/introduction).
 *
 * Sem alguma autenticação, este endpoint seria um formulário público capaz de
 * inserir na caixa de entrada da APCS uma frase que um associado nunca disse —
 * indistinguível da verdadeira, e com o nome dele em cima.
 *
 * Então o segredo é um segmento do caminho, comparado em TEMPO CONSTANTE
 * (`safeCompare`, dentro de `verifyWebhookSecret`). Só quem cadastrou a URL no
 * painel da Z-API o conhece. As consequências práticas, que precisam estar
 * escritas em algum lugar:
 *
 *   • a URL inteira é um segredo — ela não vai para print, chamado ou grupo;
 *   • trocar o segredo é trocar a variável e recadastrar a URL no painel;
 *   • o segredo NUNCA aparece em log (nem no de erro: ver os `logWhatsAppEvent`
 *     abaixo, que registram só "segredo inválido").
 *
 * Isto é mais fraco que um HMAC — um HMAC prova cada corpo, e um segredo na URL
 * prova só quem chamou. É o mais forte que o fornecedor permite, e é por isso
 * que `ZApiProvider.verifySignature` devolve `false` sempre: para que ninguém
 * aponte a rota genérica (que confia na assinatura) para este adaptador.
 *
 * ----------------------------------------------------------------------------
 * §19. ELE RESPONDE 200 QUASE SEMPRE, E ISSO É DE PROPÓSITO
 * ----------------------------------------------------------------------------
 *
 * Qualquer coisa diferente de 200 significa "não recebi, mande de novo", e o
 * fornecedor reentrega por horas. Um payload que não entendemos não melhora
 * sendo reentregue mil vezes: melhora sendo registrado e ignorado.
 *
 * As exceções: 404 (segredo errado — e 404, não 401, para não confirmar que o
 * caminho existe) e 413 (corpo grande demais, que nem chega a ser lido).
 */

// `node:crypto` (comparação em tempo constante) e o cliente service_role exigem
// runtime Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Um evento da Z-API cabe folgado; acima disto é anomalia. */
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: NextRequest, context: { params: Promise<{ secret: string }> }) {
  const correlationId = newCorrelationId();
  const provider = messagingProvider();

  // O adaptador em uso precisa SER a Z-API. Se o sistema estiver configurado
  // para a Cloud API, esta rota não existe — e responder 404 é o certo: ela
  // realmente não tem função nenhuma nesse estado.
  if (!(provider instanceof ZApiProvider)) {
    logWhatsAppEvent("error", "inbox.webhook_rejected", {
      correlationId,
      provider: provider.name,
      reason: "a rota da Z-API foi chamada com outro adaptador ativo",
    });
    return new NextResponse("not found", { status: 404 });
  }

  const { secret } = await context.params;
  if (!provider.verifyWebhookSecret(secret)) {
    logWhatsAppEvent("error", "inbox.webhook_rejected", {
      correlationId,
      provider: provider.name,
      // ⚠️ Nunca o valor recebido, nem o tamanho dele. Dizer "esperava 43
      // caracteres" já é ajuda demais para quem estiver tentando adivinhar.
      reason: "segredo inválido",
    });
    return new NextResponse("not found", { status: 404 });
  }

  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    logWhatsAppEvent("error", "inbox.webhook_rejected", {
      correlationId,
      provider: provider.name,
      reason: "corpo não é JSON",
    });
    return ok({ ignored: true });
  }

  const eventos = provider.parseWebhook(payload);

  logWhatsAppEvent("info", "inbox.webhook_received", {
    correlationId,
    provider: provider.name,
    count: eventos.length,
  });

  if (eventos.length === 0) return ok({ events: 0 });

  // ⚠️ O LIVRO-RAZÃO VEM PRIMEIRO, E ELE NÃO É OPCIONAL.
  //
  // A caixa de entrada grava TUDO antes de qualquer consumidor decidir o que
  // fazer com o evento. Na ordem inversa, uma mensagem consumida pelo fluxo de
  // enquete poderia não aparecer para o atendente — que veria uma conversa com
  // um buraco no meio, sem nada indicando que há um buraco.
  let pendingMedia: Awaited<ReturnType<typeof recordInboundEvents>>["pendingMedia"] = [];
  let gravadas: RecordedMessage[] = [];
  try {
    const gravado = await recordInboundEvents(eventos, provider.name, correlationId);
    pendingMedia = gravado.pendingMedia;
    gravadas = gravado.messages;
  } catch (error) {
    logWhatsAppEvent("error", "inbox.webhook_received", {
      correlationId,
      provider: provider.name,
      outcome: "falhou",
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  // ⚠️ O PEDIDO PARA PARAR DE RECEBER VEM ANTES DE QUALQUER ROTEIRO.
  //
  // Antes daqui, "SAIR" só era interpretado DENTRO de uma conversa de enquete —
  // então quem recebeu a divulgação de um evento e respondeu SAIR continuava
  // recebendo. Um pedido para não ser incomodado não pode depender do canal que
  // motivou o pedido.
  //
  // O que este passo trata é RETIRADO da lista das enquetes: `survey-inbox`
  // também sabe responder a SAIR, e as duas rodando mandariam duas
  // confirmações — a segunda depois de a pessoa ter pedido para não receber
  // mensagens, que é a pior hora possível.
  let optOut = { handled: [] as string[], registered: 0 };
  try {
    optOut = await processOptOutRequests(eventos, provider, correlationId);
  } catch (error) {
    logWhatsAppEvent("error", "inbox.webhook_received", {
      correlationId,
      provider: provider.name,
      outcome: "opt-out falhou",
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const tratados = new Set(optOut.handled);

  // ⚠️ O QUE SAIU DO NOSSO NÚMERO NÃO É RESPOSTA DE NINGUÉM.
  //
  // A Z-API avisa também sobre as mensagens que o próprio número mandou —
  // inclusive as que o bot de enquete acabou de mandar. Entregues ao motor de
  // enquetes, um "1" enviado POR NÓS seria lido como voto de quem o recebeu.
  const paraEnquetes = eventos.filter(
    (e: InboundEvent) =>
      !tratados.has(e.eventId) && (e.kind !== "message" || e.conversation?.fromMe !== true),
  );

  let enquetes = { processed: 0, duplicates: 0, ignored: 0, handled: [] as string[] };
  if (paraEnquetes.length > 0) {
    try {
      enquetes = await processInboundEvents(paraEnquetes, provider, correlationId);
    } catch (error) {
      // 200 mesmo assim: a mensagem JÁ está na caixa de entrada, que é o que
      // não pode se perder. Reentregar repetiria o mesmo erro.
      logWhatsAppEvent("error", "inbox.webhook_received", {
        correlationId,
        provider: provider.name,
        outcome: "enquetes falhou",
        reason: error instanceof Error ? error.message : String(error),
      });

      // ⚠️ A ENQUETE FALHOU: NADA VAI PARA O ROBÔ nesta volta.
      //
      // Sem saber o que ela tratou, a única suposição segura é "tudo". O erro
      // oposto — o robô respondendo "não entendi" a um voto que a enquete tinha
      // acabado de registrar — atravessa uma conversa em andamento, e não se
      // desfaz. Ficar calado, sim: a pessoa reescreve.
      gravadas = [];
    }
  }

  // ⚠️ O ROBÔ É O ÚLTIMO DA FILA, e cada um dos três anteriores tem precedência
  // por uma razão própria: quem pediu para sair não recebe nada, um "3" dentro
  // de uma enquete é voto, e conversa humana em andamento não se atravessa
  // (esta última mora em `whatsapp_bot_should_answer`).
  //
  // ⚠️ E ELE RESPONDE DEPOIS DO 200. A classificação chama um modelo, e a
  // resposta da Bolsa são duas chamadas ao fornecedor (imagem e PDF), cada uma
  // com uma retentativa possível. São segundos, às vezes mais de dez. A Z-API
  // considera "não recebi" o que demora, e reentregaria o payload no meio da
  // nossa própria resposta. É o §39, e o `after` já era usado aqui pelo mesmo
  // motivo com os anexos.
  //
  // O robô vem ANTES do download de anexo nesta ordem de propósito: há uma
  // pessoa esperando a resposta, e não há ninguém esperando a foto aparecer na
  // caixa de entrada.
  const paraRobo = gravadas.filter((m) => !tratados.has(m.eventId));
  const jaTratados = new Set([...tratados, ...enquetes.handled]);

  if (paraRobo.length > 0) {
    after(async () => {
      await processChatbotMessages(paraRobo, jaTratados, provider, correlationId);
    });
  }

  // O anexo baixa DEPOIS da resposta. Ver `downloadPendingMedia`: um áudio de
  // dois minutos pode demorar mais do que a Z-API espera pelo 200, e demora
  // para ela significa "não recebeu" — o que reentregaria justamente as
  // mensagens mais pesadas, em laço.
  if (pendingMedia.length > 0) {
    after(async () => {
      await downloadPendingMedia(pendingMedia, correlationId);
    });
  }

  return ok({
    events: eventos.length,
    surveys: enquetes.processed,
    optOuts: optOut.registered,
    // Quantas ficaram PARA o robô. O que ele fez com elas acontece depois desta
    // resposta e sai no log, com o mesmo `correlationId`.
    chatbot: paraRobo.length,
  });
}

/**
 * A Z-API espera `{"value": true}` com 200 para considerar o evento entregue.
 * Os demais campos são para quem estiver lendo o log da chamada.
 */
function ok(extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ value: true, ...extra });
}
