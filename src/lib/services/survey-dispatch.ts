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
import { logSurveyEvent, newCorrelationId } from "@/lib/messaging/telemetry";
import { surveyWhatsAppMessage } from "@/modules/survey/survey.labels";
import type { MessagingProvider } from "@/lib/messaging/messaging.types";

/**
 * O MESSAGING SERVICE de Enquetes — o meio do §2.
 *
 *     Survey Service  →  [ este arquivo ]  →  WhatsApp Provider
 *
 * Ele sabe o que é uma enquete e o que é uma fila; NÃO sabe o que é a Meta, um
 * header de assinatura ou um código 131026. Isso é do adaptador.
 *
 * ⚠️ POR QUE A FILA É PUXADA POR CICLO, e não um `for` que percorre tudo.
 *
 * Uma campanha de 5 mil pessoas a 5 mensagens por segundo leva 17 minutos.
 * Nenhuma função serverless vive tanto — e nem deveria: o §22 diz explicitamente
 * "não bloquear uma requisição HTTP por milhares de mensagens". Então cada
 * execução tem ORÇAMENTO (tempo e quantidade), manda o que couber e termina. O
 * que sobrou continua `pending`, e o ciclo seguinte pega de onde parou.
 * Interromper no meio é o funcionamento normal, não uma falha.
 */

/** §23. Quantos por lote reivindicado. */
const BATCH_SIZE = 25;

/**
 * Orçamento de uma execução. O teto de tempo é o que impede que a função seja
 * morta pela plataforma NO MEIO de um envio — o que deixaria a linha em
 * 'sending' até o reaper do §87 passar.
 */
const RUN_BUDGET_MS = 45_000;
const RUN_MAX_MESSAGES = 400;

/**
 * §24. Os ajustes de ritmo e retentativa.
 *
 * São parâmetro, e não constante, porque o limite real do WhatsApp DEPENDE DO
 * NÍVEL DA CONTA — que muda sozinho conforme as pessoas bloqueiam ou não a
 * APCS. Uma conta em tier alto pode mandar muito mais rápido, e forçá-la ao
 * ritmo do tier inicial faria uma campanha grande levar horas sem motivo.
 *
 * O padrão é o conservador. Os testes usam isto para rodar sem esperar de
 * verdade — mas não é por causa deles que o parâmetro existe.
 */
export interface DispatchTuning {
  messagesPerSecond?: number;
  maxAttempts?: number;
  /** Espera entre tentativas. Recebe o número da tentativa (1-based). */
  backoff?: (attempt: number) => number;
  batchSize?: number;
  budgetMs?: number;
}

/** §21. Um disjuntor por processo. Ver o comentário em `resilience.ts`. */
const breaker = new CircuitBreaker();

export interface DispatchOutcome {
  surveyId: string;
  dispatchId: string | null;
  claimed: number;
  sent: number;
  errors: number;
  released: number;
  blocked: number;
  /** `true` quando sobrou fila — o ciclo seguinte continua. */
  remaining: boolean;
  skipped: string | null;
  correlationId: string;
}

interface RecipientRow {
  id: string;
  survey_id: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  attempts: number;
}

/**
 * Dispara UMA enquete, dentro do orçamento.
 *
 * Nunca lança: o worker é chamado por cron, e uma exceção viraria um 500 que a
 * plataforma tenta de novo em cima do mesmo estado.
 */
export async function runSurveyDispatch(
  surveyId: string,
  provider: MessagingProvider = messagingProvider(),
  tuning: DispatchTuning = {},
): Promise<DispatchOutcome> {
  const ritmo = throttleDelayMs(tuning.messagesPerSecond ?? DEFAULT_MESSAGES_PER_SECOND);
  const maxTentativas = tuning.maxAttempts ?? MAX_SEND_ATTEMPTS;
  const espera = tuning.backoff ?? backoffDelayMs;
  const tamanhoDoLote = tuning.batchSize ?? BATCH_SIZE;
  const orcamento = tuning.budgetMs ?? RUN_BUDGET_MS;

  const correlationId = newCorrelationId();
  const base: DispatchOutcome = {
    surveyId,
    dispatchId: null,
    claimed: 0,
    sent: 0,
    errors: 0,
    released: 0,
    blocked: 0,
    remaining: false,
    skipped: null,
    correlationId,
  };

  // ⚠️ A RECUSA VEM ANTES DE ABRIR A CORRIDA.
  //
  // Sem esta porta, um disparo com o fornecedor não configurado marcaria a
  // campanha inteira como erro — cada pessoa com a mesma frase — e alguém teria
  // de limpar isso na mão para tentar de novo depois de configurar. Recusando
  // antes, a fila fica intacta.
  if (!provider.configured) {
    logSurveyEvent("error", "dispatch.skipped", {
      surveyId,
      correlationId,
      provider: provider.name,
      reason: `não configurado: ${provider.missing.join(", ")}`,
    });
    return { ...base, skipped: "provider_not_configured" };
  }

  const admin = createAdminClient();
  const inicio = Date.now();

  try {
    // §32/§33. Quem pediu para sair nem entra na corrida.
    const { data: bloqueados } = await admin.rpc("block_opted_out_recipients", {
      p_survey_id: surveyId,
    });
    base.blocked = typeof bloqueados === "number" ? bloqueados : 0;

    const { data: dispatch, error: dispatchError } = await admin.rpc("start_survey_dispatch", {
      p_survey_id: surveyId,
    });

    if (dispatchError || !dispatch) {
      logSurveyEvent("error", "dispatch.skipped", {
        surveyId,
        correlationId,
        reason: dispatchError?.message ?? "corrida não abriu",
      });
      return { ...base, skipped: "dispatch_not_started" };
    }

    const dispatchId = dispatch.id;
    base.dispatchId = dispatchId;

    const mensagem = await buildSurveyMessage(surveyId);
    if (!mensagem) {
      await admin.rpc("finish_survey_dispatch", { p_dispatch_id: dispatchId });
      return { ...base, dispatchId, skipped: "survey_not_sendable" };
    }

    logSurveyEvent("info", "dispatch.started", {
      surveyId,
      dispatchId,
      correlationId,
      provider: provider.name,
      count: dispatch.total_recipients,
    });

    let enviadas = 0;

    for (;;) {
      if (Date.now() - inicio > orcamento || enviadas >= RUN_MAX_MESSAGES) {
        base.remaining = true;
        break;
      }

      const { data: lote, error: loteError } = await admin.rpc("claim_survey_recipients", {
        p_survey_id: surveyId,
        p_dispatch_id: dispatchId,
        p_limit: tamanhoDoLote,
      });

      if (loteError) {
        logSurveyEvent("error", "dispatch.skipped", {
          surveyId,
          dispatchId,
          correlationId,
          reason: loteError.message,
        });
        break;
      }

      const destinatarios = (lote ?? []) as RecipientRow[];
      if (destinatarios.length === 0) break;
      base.claimed += destinatarios.length;

      const naoTentados: string[] = [];

      for (const [indice, destinatario] of destinatarios.entries()) {
        // §21. Fornecedor fora do ar: para a corrida e devolve o resto.
        if (!breaker.allows()) {
          naoTentados.push(...destinatarios.slice(indice).map((d) => d.id));
          base.remaining = true;
          logSurveyEvent("error", "send.breaker_open", {
            surveyId,
            dispatchId,
            correlationId,
            count: naoTentados.length,
          });
          break;
        }

        const resultado = await sendToRecipient({
          admin,
          provider,
          destinatario,
          mensagem,
          correlationId,
          dispatchId,
          maxTentativas,
          espera,
        });

        if (resultado === "sent") {
          base.sent += 1;
          enviadas += 1;
          breaker.recordSuccess();
        } else if (resultado === "error") {
          base.errors += 1;
        } else {
          // 'infra': falhou por causa do fornecedor, e não da pessoa.
          base.errors += 1;
          breaker.recordFailure();
        }

        // §24. O ritmo. Só entre mensagens que realmente saíram — esperar
        // depois de um telefone inválido seria desperdiçar o orçamento.
        if (resultado === "sent" && indice < destinatarios.length - 1) {
          await sleep(ritmo);
        }
      }

      if (naoTentados.length > 0) {
        const { data: soltos } = await admin.rpc("release_survey_recipients", {
          p_ids: naoTentados,
        });
        base.released += typeof soltos === "number" ? soltos : 0;
        break;
      }
    }

    // A fila ainda tem gente? O ciclo seguinte continua.
    const { count } = await admin
      .from("survey_recipients")
      .select("id", { count: "exact", head: true })
      .eq("survey_id", surveyId)
      .eq("status", "pending");

    base.remaining = base.remaining || (count ?? 0) > 0;

    await admin.rpc("finish_survey_dispatch", { p_dispatch_id: dispatchId });

    logSurveyEvent("info", "dispatch.finished", {
      surveyId,
      dispatchId,
      correlationId,
      count: base.sent,
      durationMs: Date.now() - inicio,
      outcome: base.remaining ? "parcial" : "completo",
    });

    return base;
  } catch (error) {
    logSurveyEvent("error", "dispatch.skipped", {
      surveyId,
      correlationId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return { ...base, skipped: "unexpected" };
  }
}

type SendOutcome = "sent" | "error" | "infra";

async function sendToRecipient(params: {
  admin: ReturnType<typeof createAdminClient>;
  provider: MessagingProvider;
  destinatario: RecipientRow;
  mensagem: string;
  correlationId: string;
  dispatchId: string;
  maxTentativas: number;
  espera: (attempt: number) => number;
}): Promise<SendOutcome> {
  const { admin, provider, destinatario, mensagem, correlationId, dispatchId } = params;

  // §29/§30. O telefone é conferido AQUI, antes de gastar uma chamada.
  //
  // ⚠️ Um fixo é o caso real deste banco: `(14) 3622-8140`. Mandado ao
  // fornecedor, ele não dá erro na hora — dá "não entregue" horas depois, sem
  // ninguém olhando. Recusado aqui, vira uma linha de tarefa legível na tela de
  // participantes: "Telefone fixo não recebe WhatsApp. Cadastre um celular."
  const numero = toWhatsAppNumber(destinatario.contact_phone);
  if (!numero.ok) {
    await admin.rpc("mark_survey_recipient", {
      p_recipient_id: destinatario.id,
      p_status: "error",
      p_provider_message_id: null,
      p_error: PHONE_REJECTION_REASONS[numero.reason],
    } as never);

    logSurveyEvent("info", "send.ineligible", {
      surveyId: destinatario.survey_id,
      recipientId: destinatario.id,
      dispatchId,
      correlationId,
      reason: numero.reason,
      phone: maskPhone(destinatario.contact_phone),
    });
    return "error";
  }

  let ultimo = { code: "unknown", message: "Falha no envio.", retryable: true };

  for (let tentativa = 1; tentativa <= params.maxTentativas; tentativa += 1) {
    logSurveyEvent("info", "send.attempt", {
      surveyId: destinatario.survey_id,
      recipientId: destinatario.id,
      dispatchId,
      correlationId,
      attempt: tentativa,
      phone: maskPhone(destinatario.contact_phone),
    });

    const envio = await provider.send({
      to: numero.e164,
      body: mensagem,
      correlationId,
    });

    if (envio.ok) {
      // §88. "Enviado" só com o id que o fornecedor devolveu.
      await admin.rpc("mark_survey_recipient", {
        p_recipient_id: destinatario.id,
        p_status: "sent",
        p_provider_message_id: envio.providerMessageId,
        p_error: null,
      } as never);

      // §7. O contexto nasce DEPOIS do envio confirmado — nunca antes.
      const { error: contextoError } = await admin.rpc("open_survey_context", {
        p_recipient_id: destinatario.id,
        p_channel: "whatsapp",
        p_provider_message_id: envio.providerMessageId,
      } as never);

      if (contextoError) {
        // A mensagem saiu; o contexto não. A pessoa vai responder e cairá em
        // "sem contexto" (§44). Isso precisa gritar no log, porque é a única
        // falha aqui que produz um silêncio do lado de quem respondeu.
        logSurveyEvent("error", "context.opened", {
          surveyId: destinatario.survey_id,
          recipientId: destinatario.id,
          correlationId,
          outcome: "falhou",
          reason: contextoError.message,
        });
      }

      logSurveyEvent("info", "send.ok", {
        surveyId: destinatario.survey_id,
        recipientId: destinatario.id,
        dispatchId,
        correlationId,
        providerMessageId: envio.providerMessageId,
        attempt: tentativa,
      });
      return "sent";
    }

    ultimo = { code: envio.code, message: envio.message, retryable: envio.retryable };

    // §29. Erro definitivo não se repete — insistir queima cota sem chance
    // nenhuma de sucesso.
    if (!envio.retryable) break;

    if (tentativa < params.maxTentativas) {
      await sleep(params.espera(tentativa));
    }
  }

  await admin.rpc("mark_survey_recipient", {
    p_recipient_id: destinatario.id,
    p_status: "error",
    p_provider_message_id: null,
    p_error: `[${ultimo.code}] ${ultimo.message}`,
  } as never);

  logSurveyEvent("error", "send.error", {
    surveyId: destinatario.survey_id,
    recipientId: destinatario.id,
    dispatchId,
    correlationId,
    reason: ultimo.code,
    phone: maskPhone(destinatario.contact_phone),
  });

  // Falha de infraestrutura conta para o disjuntor; recusa do número, não.
  return ultimo.retryable ? "infra" : "error";
}

/**
 * §5/§6. A mensagem, montada da mesma função que a prévia da tela usa.
 *
 * ⚠️ Uma segunda implementação do texto aqui faria a prévia mentir — e a prévia
 * é justamente o que a pessoa olha antes de mandar para milhares de contatos.
 */
async function buildSurveyMessage(surveyId: string): Promise<string | null> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("get_survey_for_chatbot", { p_survey_id: surveyId });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;

  const linhas = data as {
    title: string;
    question: string;
    option_position: number;
    option_text: string;
  }[];

  const primeira = linhas[0];
  if (!primeira) return null;

  /**
   * ⚠️ SEGUNDA CONSULTA, e ela é deliberada. `get_survey_for_chatbot` devolve
   * uma linha POR ALTERNATIVA e não traz descrição nem as datas; estendê-la
   * exigiria migration e `pnpm db:types` para acrescentar três colunas que se
   * repetiriam em cada linha.
   *
   * Aqui estamos no despachante, que já roda com `service_role` e já lê
   * `survey_recipients` direto — ler a própria tabela do domínio não abre porta
   * nenhuma que já não estivesse aberta. Se um dia o chatbot precisar dos mesmos
   * campos, aí sim a função do banco é o lugar certo.
   */
  const { data: enquete } = await admin
    .from("surveys")
    .select("title, description, starts_at, ends_at")
    .eq("id", surveyId)
    .maybeSingle();

  return surveyWhatsAppMessage({
    // A função do banco já traz o título; a segunda consulta é a fonte do resto.
    title: enquete?.title ?? primeira.title,
    description: enquete?.description,
    question: primeira.question,
    options: linhas.map((l) => ({ position: l.option_position, text: l.option_text })),
    startsAt: enquete?.starts_at,
    endsAt: enquete?.ends_at,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Só para teste: zera o disjuntor entre cenários. */
export function __resetDispatchBreaker(): void {
  breaker.reset();
}
