import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { messagingProvider } from "@/lib/messaging/registry";
import { maskPhone, PHONE_REJECTION_REASONS, toWhatsAppNumber } from "@/lib/messaging/phone";
import {
  backoffDelayMs,
  CircuitBreaker,
  DEFAULT_MESSAGES_PER_SECOND,
  MAX_SEND_ATTEMPTS,
  throttleDelayMs,
} from "@/lib/messaging/resilience";
import { logEventDispatch, newCorrelationId } from "@/lib/messaging/telemetry";
import { eventWhatsAppMessage } from "@/modules/event/event.labels";
import type { MessagingProvider } from "@/lib/messaging/messaging.types";

/**
 * O WORKER DA DIVULGAÇÃO DE EVENTOS.
 *
 *     Action "Divulgar" → start_event_dispatch (fila) → [ este arquivo ] → Z-API
 *
 * Ele sabe o que é um evento e o que é uma fila; NÃO sabe o que é a Z-API, um
 * header `Client-Token` ou um erro 429. Isso é do adaptador, que já existia.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ POR QUE A FILA É PUXADA POR CICLO, E NÃO UM `for` QUE PERCORRE TUDO
 * ----------------------------------------------------------------------------
 * É a mesma razão de Enquetes, e ela não mudou: mil pessoas a 5 mensagens por
 * segundo são três minutos e meio; dez mil são trinta e três. Nenhuma função
 * serverless vive tanto. Então cada execução tem ORÇAMENTO — tempo e
 * quantidade —, manda o que couber e termina. O que sobrou continua `pending`,
 * e a próxima execução pega de onde parou.
 *
 * **Interromper no meio é o funcionamento normal, não uma falha.** A tela diz
 * quantos faltam e oferece "Continuar divulgação".
 *
 * ----------------------------------------------------------------------------
 * ⚠️ O QUE ESTE ARQUIVO NÃO FAZ: ABRIR A CORRIDA
 * ----------------------------------------------------------------------------
 * `start_event_dispatch` roda com a sessão de QUEM CLICOU, porque é lá que a
 * permissão é conferida (`current_app_role()`). Este worker roda com
 * `service_role`, onde não há papel nenhum — chamá-la daqui seria "sem
 * permissão", sempre.
 *
 * A separação é de propósito: quem decide divulgar é uma pessoa identificada e
 * auditada; quem carrega o piano é o servidor.
 */

/** §23. Lote reivindicado por vez. Ver `claim_event_recipients`. */
const BATCH_SIZE = 25;

/**
 * Orçamento de uma execução.
 *
 * O teto de tempo é o que impede a função de ser morta pela plataforma NO MEIO
 * de um envio — o que deixaria linhas presas em 'sending' até
 * `release_stale_event_recipients` passar. 45s cabe folgado no `maxDuration`
 * de 60s da rota.
 */
const RUN_BUDGET_MS = 45_000;
const RUN_MAX_MESSAGES = 400;

export interface EventDispatchTuning {
  messagesPerSecond?: number;
  maxAttempts?: number;
  backoff?: (attempt: number) => number;
  batchSize?: number;
  budgetMs?: number;
}

/**
 * ⚠️ UM DISJUNTOR POR PROCESSO, e ele é o mesmo objeto entre execuções da
 * mesma instância. Criar um novo a cada chamada zeraria o contador de falhas e
 * o disjuntor nunca abriria — que é exatamente o defeito que ele existe para
 * evitar. Ver `resilience.ts`.
 */
const breaker = new CircuitBreaker();

export interface EventDispatchOutcome {
  eventId: string;
  dispatchId: string;
  claimed: number;
  sent: number;
  errors: number;
  /** Quem não recebeu por telefone inválido — não é falha de envio. */
  ineligible: number;
  /** `true` quando sobrou fila: a tela oferece "Continuar divulgação". */
  remaining: boolean;
  remainingCount: number;
  skipped: string | null;
  correlationId: string;
}

interface RecipientRow {
  id: string;
  member_phone: string;
  member_name: string | null;
  attempts: number;
}

interface EventRow {
  id: string;
  name: string;
  location: string;
  event_date: string;
  start_time: string;
  end_time: string | null;
  registration_url: string | null;
}

/**
 * Drena a fila de um evento até o orçamento acabar.
 *
 * Não lança: devolve o resultado. Quem chama é a action (via `after`), e uma
 * exceção ali não teria quem a lesse — a resposta ao navegador já foi.
 */
export async function drainEventQueue(
  eventId: string,
  dispatchId: string,
  tuning: EventDispatchTuning = {},
): Promise<EventDispatchOutcome> {
  const correlationId = newCorrelationId();
  const inicio = Date.now();

  const base: EventDispatchOutcome = {
    eventId,
    dispatchId,
    claimed: 0,
    sent: 0,
    errors: 0,
    ineligible: 0,
    remaining: false,
    remainingCount: 0,
    skipped: null,
    correlationId,
  };

  const provider = messagingProvider();
  if (!provider.configured) {
    logEventDispatch("error", "dispatch.skipped", {
      eventId,
      dispatchId,
      correlationId,
      provider: provider.name,
      reason: `integração não configurada: falta ${provider.missing.join(", ")}`,
    });
    await finish(dispatchId, "failed", "Integração de WhatsApp não configurada.");
    return { ...base, skipped: "not_configured" };
  }

  const admin = createAdminClient();
  const ritmo = throttleDelayMs(tuning.messagesPerSecond ?? DEFAULT_MESSAGES_PER_SECOND);
  const maxTentativas = tuning.maxAttempts ?? MAX_SEND_ATTEMPTS;
  const espera = tuning.backoff ?? backoffDelayMs;
  const tamanhoDoLote = tuning.batchSize ?? BATCH_SIZE;
  const orcamento = tuning.budgetMs ?? RUN_BUDGET_MS;

  const { data: evento, error: eventoError } = await admin
    .from("events")
    .select("id, name, location, event_date, start_time, end_time, registration_url")
    .eq("id", eventId)
    .maybeSingle<EventRow>();

  if (eventoError || !evento) {
    logEventDispatch("error", "dispatch.skipped", {
      eventId,
      dispatchId,
      correlationId,
      reason: eventoError?.message ?? "evento não encontrado",
    });
    await finish(dispatchId, "failed", "Evento não encontrado.");
    return { ...base, skipped: "event_not_found" };
  }

  // A mensagem é montada UMA VEZ, fora do laço: ela é igual para todo mundo, e
  // remontá-la por destinatário seria trabalho por mil.
  const mensagem = eventWhatsAppMessage({
    name: evento.name,
    location: evento.location,
    eventDate: evento.event_date,
    // O Postgres devolve `time` como "HH:MM:SS"; a mensagem mostra "HH:MM".
    startTime: evento.start_time.slice(0, 5),
    endTime: evento.end_time ? evento.end_time.slice(0, 5) : null,
    registrationUrl: evento.registration_url,
  });

  // ⚠️ CURA A FILA ANTES DE COMEÇAR. Uma execução anterior pode ter sido morta
  // pela plataforma no meio de um lote, deixando linhas em 'sending' — elas não
  // são reivindicáveis e a fila nunca terminaria. Chamar aqui é o que faz
  // "clicar em Continuar divulgação" resolver sozinho, sem ninguém precisar
  // descobrir que algo travou.
  const { data: soltos } = await admin.rpc("release_stale_event_recipients", {
    p_event_id: eventId,
  });
  if (typeof soltos === "number" && soltos > 0) {
    logEventDispatch("info", "dispatch.started", {
      eventId,
      dispatchId,
      correlationId,
      outcome: `${soltos} presos em sending devolvidos à fila`,
      count: soltos,
    });
  }

  logEventDispatch("info", "dispatch.started", {
    eventId,
    dispatchId,
    correlationId,
    provider: provider.name,
  });

  let enviadas = 0;

  for (;;) {
    if (Date.now() - inicio > orcamento || enviadas >= RUN_MAX_MESSAGES) {
      base.remaining = true;
      logEventDispatch("info", "dispatch.interrupted", {
        eventId,
        dispatchId,
        correlationId,
        reason: enviadas >= RUN_MAX_MESSAGES ? "teto de mensagens" : "orçamento de tempo",
        count: enviadas,
      });
      break;
    }

    const { data: lote, error: loteError } = await admin.rpc("claim_event_recipients", {
      p_event_id: eventId,
      p_dispatch_id: dispatchId,
      p_limit: tamanhoDoLote,
    });

    if (loteError) {
      logEventDispatch("error", "dispatch.skipped", {
        eventId,
        dispatchId,
        correlationId,
        reason: loteError.message,
      });
      break;
    }

    const destinatarios = (lote ?? []) as RecipientRow[];
    if (destinatarios.length === 0) break;
    base.claimed += destinatarios.length;

    let interrompido = false;

    for (const [indice, destinatario] of destinatarios.entries()) {
      // §21. Fornecedor fora do ar: para a corrida em vez de insistir. O que
      // sobrou do lote fica em 'sending' e volta para a fila pelo
      // `release_stale_event_recipients` — ver o comentário lá.
      if (!breaker.allows()) {
        interrompido = true;
        base.remaining = true;
        logEventDispatch("error", "send.breaker_open", {
          eventId,
          dispatchId,
          correlationId,
          count: destinatarios.length - indice,
        });
        break;
      }

      const resultado = await sendToRecipient({
        admin,
        provider,
        destinatario,
        mensagem,
        eventId,
        dispatchId,
        correlationId,
        maxTentativas,
        espera,
      });

      if (resultado === "sent") {
        base.sent += 1;
        enviadas += 1;
        breaker.recordSuccess();
      } else if (resultado === "ineligible") {
        base.ineligible += 1;
      } else if (resultado === "error") {
        base.errors += 1;
      } else {
        // 'infra': a culpa é do fornecedor, não da pessoa. Só este conta para
        // o disjuntor — um telefone inválido não é sinal de que a Z-API caiu.
        base.errors += 1;
        breaker.recordFailure();
      }

      // O ritmo só entre mensagens que REALMENTE saíram. Esperar depois de um
      // telefone inválido seria queimar orçamento sem ter falado com ninguém.
      if (resultado === "sent" && indice < destinatarios.length - 1) {
        await sleep(ritmo);
      }
    }

    if (interrompido) break;
  }

  const { count } = await admin
    .from("event_recipients")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .in("status", ["pending", "sending"]);

  base.remainingCount = count ?? 0;
  base.remaining = base.remainingCount > 0;

  await finish(dispatchId, base.remaining ? "running" : "completed", null);

  logEventDispatch("info", "dispatch.finished", {
    eventId,
    dispatchId,
    correlationId,
    count: base.sent,
    outcome: base.remaining ? `faltam ${base.remainingCount}` : "fila vazia",
    durationMs: Date.now() - inicio,
  });

  return base;
}

type SendOutcome = "sent" | "error" | "infra" | "ineligible";

async function sendToRecipient({
  admin,
  provider,
  destinatario,
  mensagem,
  eventId,
  dispatchId,
  correlationId,
  maxTentativas,
  espera,
}: {
  admin: ReturnType<typeof createAdminClient>;
  provider: MessagingProvider;
  destinatario: RecipientRow;
  mensagem: string;
  eventId: string;
  dispatchId: string;
  correlationId: string;
  maxTentativas: number;
  espera: (attempt: number) => number;
}): Promise<SendOutcome> {
  const telefone = toWhatsAppNumber(destinatario.member_phone);

  // ⚠️ TELEFONE INVÁLIDO NÃO É TENTATIVA. Ele é liquidado como erro definitivo,
  // sem chamar o fornecedor: repetir três vezes um número que não existe só
  // gasta orçamento e enche a coluna de erro com a mesma frase. `landline`
  // entra aqui — fixo não recebe WhatsApp, e insistir não muda isso.
  if (!telefone.ok) {
    // `as never` como em `mark_survey_recipient`: o gerador de tipos não sabe
    // que estes parâmetros aceitam null (o Postgres não expõe nulidade de
    // argumento), então tipa como `string`. Passar null é o correto no SQL.
    await admin.rpc("settle_event_recipient", {
      p_recipient_id: destinatario.id,
      p_provider_message_id: null,
      p_error: PHONE_REJECTION_REASONS[telefone.reason],
    } as never);
    logEventDispatch("info", "send.ineligible", {
      eventId,
      dispatchId,
      recipientId: destinatario.id,
      correlationId,
      reason: telefone.reason,
      phone: maskPhone(destinatario.member_phone),
    });
    return "ineligible";
  }

  let ultimoErro = "Falha desconhecida ao enviar.";
  let foiInfra = false;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa += 1) {
    // `correlationId` amarra o log do adaptador ao desta corrida: sem ele, o
    // "send failed" da Z-API fica órfão e não dá para saber de qual divulgação
    // ele veio quando duas rodam no mesmo minuto.
    const resultado = await provider.send({
      to: telefone.e164,
      body: mensagem,
      correlationId,
    });

    if (resultado.ok) {
      await admin.rpc("settle_event_recipient", {
        p_recipient_id: destinatario.id,
        p_provider_message_id: resultado.providerMessageId,
        p_error: null,
      } as never);
      logEventDispatch("info", "send.ok", {
        eventId,
        dispatchId,
        recipientId: destinatario.id,
        correlationId,
        providerMessageId: resultado.providerMessageId,
        attempt: tentativa,
        phone: maskPhone(destinatario.member_phone),
      });
      return "sent";
    }

    ultimoErro = `${resultado.code}: ${resultado.message}`;
    foiInfra = resultado.retryable;

    // Erro definitivo (número recusado, credencial errada): insistir não
    // conserta. Sai do laço na primeira.
    if (!resultado.retryable) break;

    if (tentativa < maxTentativas) await sleep(espera(tentativa));
  }

  await admin.rpc("settle_event_recipient", {
    p_recipient_id: destinatario.id,
    p_provider_message_id: null,
    p_error: ultimoErro,
  } as never);

  logEventDispatch("error", "send.error", {
    eventId,
    dispatchId,
    recipientId: destinatario.id,
    correlationId,
    reason: ultimoErro,
    phone: maskPhone(destinatario.member_phone),
  });

  return foiInfra ? "infra" : "error";
}

/**
 * Encerra a corrida.
 *
 * ⚠️ 'running' QUANDO SOBROU FILA, e não 'completed'. Uma corrida marcada como
 * concluída com gente pendente faria a tela dizer "divulgado" para um evento
 * que metade da base não recebeu — e ninguém clicaria em continuar.
 */
async function finish(
  dispatchId: string,
  status: "running" | "completed" | "failed",
  lastError: string | null,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("finish_event_dispatch", {
    p_dispatch_id: dispatchId,
    p_status: status,
    p_last_error: lastError,
  } as never);
  if (error) {
    logEventDispatch("error", "dispatch.finished", {
      dispatchId,
      outcome: "não foi possível encerrar a corrida",
      reason: error.message,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
