import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { maskPhone, sameWhatsAppNumber } from "@/lib/messaging/phone";
import { logSurveyEvent } from "@/lib/messaging/telemetry";
import { readSurveyReply, repeatOptionsMessage } from "@/modules/survey/survey.inbound";
import {
  SURVEY_HUMAN_HANDOFF,
  SURVEY_OPT_OUT_CONFIRMED,
  SURVEY_RESPONSE_INVALID,
  SURVEY_RESPONSE_RECORDED,
  surveyAmbiguousContext,
} from "@/modules/survey/survey.labels";
import { responseMessage } from "@/modules/survey/survey.rules";
import { getSurveyForChatbot, registerSurveyResponse } from "./survey-chatbot";
import type { InboundEvent, MessagingProvider } from "@/lib/messaging/messaging.types";
import type { SurveyResponseOutcome } from "@/modules/survey/survey.types";

/**
 * O QUE ACONTECE QUANDO O ASSOCIADO RESPONDE (§7 a §16, §36 a §45).
 *
 * O webhook é fino de propósito: valida a origem e entrega os eventos aqui.
 * Toda a conversa mora neste arquivo, que não sabe o que é um header HTTP.
 *
 * ⚠️ NADA AQUI LANÇA PARA FORA. Uma exceção viraria um 500, o fornecedor
 * reentregaria o mesmo payload, e o resultado seria um laço de reentrega sobre
 * um erro que não vai se resolver sozinho. Cada evento é processado de forma
 * independente: o que falhar fica sem desfecho em `survey_inbound_events`, e o
 * contador `survey_webhook_unprocessed` (§53) o denuncia.
 */

/** §11. Tolerância a respostas inválidas antes de soltar a conversa. */
const MAX_INVALID_ATTEMPTS = 3;

export interface InboxOutcome {
  processed: number;
  duplicates: number;
  ignored: number;
  /**
   * Os eventos que a ENQUETE tratou — os que ela respondeu ou consumiu.
   *
   * ⚠️ É O MESMO CAMPO QUE `OptOutOutcome.handled`, e existe pelo mesmo motivo:
   * o webhook precisa saber o que SOBROU para o consumidor seguinte.
   *
   * Este arquivo já dizia, em dois comentários, que os eventos sem contexto de
   * enquete são para o chatbot ("§43. (…) O fluxo normal do chatbot cuida",
   * "§44. (…) Vira fluxo normal"). Faltava só o webhook conseguir SABER quais
   * são — a contagem não diz. Agora diz.
   *
   * ⚠️ PRECEDÊNCIA: o que está aqui não chega ao robô. Uma pessoa no meio de
   * uma enquete que escreve "3" está votando, e não perguntando o preço da
   * Bolsa — o robô respondendo por cima transformaria o voto numa consulta.
   */
  handled: string[];
}

interface ContextRow {
  state_id: string;
  survey_id: string;
  question_id: string;
  recipient_id: string | null;
  survey_title: string;
  asked_at: string;
  matched_by: string;
}

export async function processInboundEvents(
  events: readonly InboundEvent[],
  provider: MessagingProvider,
  correlationId: string,
): Promise<InboxOutcome> {
  const resultado: InboxOutcome = { processed: 0, duplicates: 0, ignored: 0, handled: [] };

  for (const evento of events) {
    try {
      const novo = await registrarEvento(provider.name, evento, correlationId);
      if (!novo) {
        // §16/§64. Reentrega. É o caminho NORMAL, não uma anomalia: o
        // fornecedor reentrega sempre que não recebe 200 a tempo.
        resultado.duplicates += 1;
        // ⚠️ REENTREGA CONTA COMO TRATADA. Este módulo já viu este evento numa
        // volta anterior, e o robô não deve reabri-lo agora. A idempotência
        // dele tem outra fonte (o livro-razão), e as duas concordam — mas se um
        // dia divergirem, o certo é o silêncio: uma resposta a mais é pior que
        // uma a menos.
        resultado.handled.push(evento.eventId);
        logSurveyEvent("info", "webhook.duplicate", {
          correlationId,
          provider: provider.name,
          reason: evento.kind,
        });
        continue;
      }

      const tratado =
        evento.kind === "status"
          ? await tratarStatus(evento, provider, correlationId)
          : await tratarMensagem(evento, provider, correlationId);

      if (tratado) {
        resultado.processed += 1;
        resultado.handled.push(evento.eventId);
      } else {
        // Não tratado é o caminho para o robô: "sem contexto de enquete" é
        // exatamente o que os §43 e §44 chamam de fluxo normal do chatbot.
        resultado.ignored += 1;
      }
    } catch (error) {
      logSurveyEvent("error", "webhook.received", {
        correlationId,
        provider: provider.name,
        outcome: "falhou",
        reason: error instanceof Error ? error.message : String(error),
      });
      resultado.ignored += 1;
    }
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// §26. Entregue, lido, falhou
// ---------------------------------------------------------------------------

async function tratarStatus(
  evento: Extract<InboundEvent, { kind: "status" }>,
  provider: MessagingProvider,
  correlationId: string,
): Promise<boolean> {
  const admin = createAdminClient();

  // 'failed' vira ERRO com o motivo do fornecedor; os demais sobem a escala.
  const status = evento.status === "failed" ? "error" : evento.status;

  const { data, error } = await admin.rpc("mark_survey_recipient_by_message", {
    p_provider_message_id: evento.providerMessageId,
    p_status: status,
    p_error: evento.errorMessage,
  } as never);

  const encontrado = !error && data !== null;

  await concluirEvento(provider.name, evento.eventId, encontrado ? evento.status : "not_ours");

  logSurveyEvent("info", "webhook.status", {
    correlationId,
    provider: provider.name,
    providerMessageId: evento.providerMessageId,
    outcome: encontrado ? evento.status : "mensagem não é de enquete",
  });

  return encontrado;
}

// ---------------------------------------------------------------------------
// §7 a §15, §36 a §45. A resposta
// ---------------------------------------------------------------------------

async function tratarMensagem(
  evento: Extract<InboundEvent, { kind: "message" }>,
  provider: MessagingProvider,
  correlationId: string,
): Promise<boolean> {
  const contato = await acharContato(evento.from);

  // §43. Número desconhecido: não é contato nosso. O fluxo normal do chatbot
  // cuida — a enquete não tem o que dizer.
  if (!contato) {
    await concluirEvento(provider.name, evento.eventId, "unknown_contact");
    logSurveyEvent("info", "response.no_context", {
      correlationId,
      reason: "contato desconhecido",
      phone: maskPhone(evento.from),
    });
    return false;
  }

  const contextos = await resolverContexto(contato.id, evento.replyToMessageId);

  // §44. "1" sem enquete em contexto NÃO é voto. Vira fluxo normal.
  if (contextos.length === 0) {
    await concluirEvento(provider.name, evento.eventId, "no_context", null, contato.id);
    logSurveyEvent("info", "response.no_context", {
      correlationId,
      contactId: contato.id,
    });
    return false;
  }

  const citado = contextos[0]?.matched_by === "quoted";

  // ⚠️ §40. ATENDIMENTO HUMANO ATIVO tem precedência sobre a enquete.
  //
  // A exceção é a mensagem CITADA: aí a intenção é inequívoca — a pessoa clicou
  // em "responder" NA mensagem da enquete. Sem a exceção, quem está resolvendo
  // outro assunto com o time perderia o voto; sem a regra, o bot da enquete
  // atravessaria uma conversa humana em andamento por causa de um "3" que era
  // resposta ao atendente.
  if (!citado && (await temAtendimentoHumano(contato.id))) {
    await concluirEvento(provider.name, evento.eventId, "human_attendance", null, contato.id);
    logSurveyEvent("info", "response.no_context", {
      correlationId,
      contactId: contato.id,
      reason: "atendimento humano ativo",
    });
    return false;
  }

  // §9. Duas ou mais em aberto e nenhuma citação: PERGUNTA, não adivinha.
  if (contextos.length > 1) {
    await responder(
      provider,
      evento.from,
      surveyAmbiguousContext(contextos.map((c) => c.survey_title)),
      correlationId,
    );
    await concluirEvento(provider.name, evento.eventId, "ambiguous_context", null, contato.id);
    logSurveyEvent("info", "response.ambiguous", {
      correlationId,
      contactId: contato.id,
      count: contextos.length,
    });
    return true;
  }

  const contexto = contextos[0]!;
  return processarContexto({ contexto, contato, evento, provider, correlationId });
}

async function processarContexto(params: {
  contexto: ContextRow;
  contato: { id: string };
  evento: Extract<InboundEvent, { kind: "message" }>;
  provider: MessagingProvider;
  correlationId: string;
}): Promise<boolean> {
  const { contexto, contato, evento, provider, correlationId } = params;
  const admin = createAdminClient();

  const enquete = await getSurveyForChatbot(contexto.survey_id);

  // §41/§42. Encerrada ou cancelada: diz isso e fecha o contexto. Sem as
  // alternativas não haveria como interpretar "3" de qualquer forma.
  if (enquete.status !== "found") {
    const desfecho = await desfechoDoPortao(contexto.survey_id);
    await responder(provider, evento.from, responseMessage(desfecho), correlationId);
    await admin.rpc("close_survey_context", {
      p_state_id: contexto.state_id,
      p_status: "expired",
      p_reason: desfecho,
    } as never);
    await concluirEvento(provider.name, evento.eventId, desfecho, contexto.survey_id, contato.id);
    return true;
  }

  const leitura = readSurveyReply(evento.text, enquete.survey.options);

  switch (leitura.kind) {
    // §32. "SAIR" e afins.
    case "opt_out": {
      await admin.rpc("register_survey_opt_out", {
        p_contact_id: contato.id,
        p_channel: "whatsapp",
        p_source: "chatbot",
        p_note: null,
      } as never);
      await responder(provider, evento.from, SURVEY_OPT_OUT_CONFIRMED, correlationId);
      await concluirEvento(
        provider.name,
        evento.eventId,
        "opt_out",
        contexto.survey_id,
        contato.id,
      );
      logSurveyEvent("info", "optout.registered", { correlationId, contactId: contato.id });
      return true;
    }

    // §39/§40. Pediu gente: a enquete solta a conversa.
    case "wants_human": {
      await admin.rpc("close_survey_context", {
        p_state_id: contexto.state_id,
        p_status: "released",
        p_reason: "wants_human",
      } as never);
      await responder(provider, evento.from, SURVEY_HUMAN_HANDOFF, correlationId);
      await concluirEvento(
        provider.name,
        evento.eventId,
        "wants_human",
        contexto.survey_id,
        contato.id,
      );
      return true;
    }

    case "option": {
      const escolhida = enquete.survey.options.find((o) => o.position === leitura.position);
      if (!escolhida) return false;

      const registro = await registerSurveyResponse({
        surveyId: contexto.survey_id,
        optionId: escolhida.id,
        contactId: contato.id,
        // §16/§73. A idempotência de ponta a ponta: o mesmo id de mensagem
        // reentregue não vira segunda resposta NEM "você já participou".
        sourceMessageId: evento.eventId,
      });

      if (registro.status === "failed") {
        // Sem desfecho: o evento fica pendente e o contador do §53 aponta.
        logSurveyEvent("error", "response.registered", {
          correlationId,
          surveyId: contexto.survey_id,
          contactId: contato.id,
          outcome: "falhou",
        });
        return false;
      }

      // §37. No WhatsApp não há retorno visual de "entrou na urna".
      const texto =
        registro.outcome === "registered"
          ? `${registro.message}\n${SURVEY_RESPONSE_RECORDED}`
          : registro.message;

      await responder(provider, evento.from, texto, correlationId);

      // §38. Respondeu: o contexto sai de cena. O histórico fica na tabela.
      if (registro.outcome === "registered" || registro.outcome === "already_answered") {
        await admin.rpc("close_survey_context", {
          p_state_id: contexto.state_id,
          p_status: "answered",
          p_reason: registro.outcome,
        } as never);
      }

      await concluirEvento(
        provider.name,
        evento.eventId,
        registro.outcome,
        contexto.survey_id,
        contato.id,
      );

      logSurveyEvent(
        "info",
        registro.outcome === "already_answered" ? "response.duplicate" : "response.registered",
        {
          correlationId,
          surveyId: contexto.survey_id,
          contactId: contato.id,
          recipientId: contexto.recipient_id ?? undefined,
          outcome: registro.outcome,
        },
      );
      return true;
    }

    // §11 e §13. Errou a resposta — as duas pedem a escolha de novo, com a
    // lista junto (a mensagem original pode ter subido muito no histórico).
    case "invalid":
    case "ambiguous_text": {
      const { data: tentativas } = await admin.rpc("count_survey_context_miss", {
        p_state_id: contexto.state_id,
        p_max: MAX_INVALID_ATTEMPTS,
      } as never);

      const estourou = typeof tentativas === "number" && tentativas >= MAX_INVALID_ATTEMPTS;

      const intro =
        leitura.kind === "ambiguous_text"
          ? "Sua resposta pode corresponder a mais de uma opção. Escolha pelo número:"
          : SURVEY_RESPONSE_INVALID;

      await responder(
        provider,
        evento.from,
        estourou ? SURVEY_HUMAN_HANDOFF : repeatOptionsMessage(intro, enquete.survey.options),
        correlationId,
      );

      await concluirEvento(
        provider.name,
        evento.eventId,
        "invalid_option",
        contexto.survey_id,
        contato.id,
      );

      logSurveyEvent("info", "response.invalid", {
        correlationId,
        surveyId: contexto.survey_id,
        contactId: contato.id,
        attempt: typeof tentativas === "number" ? tentativas : undefined,
        outcome: estourou ? "conversa liberada" : "pediu de novo",
      });
      return true;
    }

    // §39. Não era sobre a enquete. O bot da enquete NÃO responde e NÃO conta
    // como erro — quem manda "bom dia" não está errando uma pergunta.
    case "unrelated":
      await concluirEvento(
        provider.name,
        evento.eventId,
        "unrelated",
        contexto.survey_id,
        contato.id,
      );
      return false;
  }
}

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------

/**
 * §45. O contato pelo número — mas a resposta NUNCA é "do telefone": ela é do
 * contato, e o contexto é que diz de qual enquete.
 *
 * O SQL estreita pelos 8 últimos dígitos; a confirmação do número inteiro é
 * aqui, com a única implementação da regra (ver `phone.ts`).
 */
async function acharContato(numero: string): Promise<{ id: string; phone: string | null } | null> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("find_contact_by_whatsapp", { p_number: numero });
  if (error || !data) return null;

  const candidatos = data as { id: string; phone: string | null }[];
  return candidatos.find((c) => sameWhatsAppNumber(c.phone, numero)) ?? null;
}

async function resolverContexto(
  contactId: string,
  replyToMessageId: string | null,
): Promise<ContextRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("resolve_survey_context", {
    p_contact_id: contactId,
    p_channel: "whatsapp",
    p_reply_to_message_id: replyToMessageId,
  } as never);

  if (error || !data) return [];
  return data as ContextRow[];
}

/**
 * §40. Há gente do time nesta conversa agora?
 *
 * ⚠️ SÓ ENXERGA QUEM VIROU LEAD. `chat_conversations.contact_id` só é
 * preenchido quando a triagem do chat fecha, então um associado que nunca
 * passou por lá não tem conversa ligada a ele — e para esse a checagem sempre
 * diz "não há atendimento". É limitação do cadastro atual, não desta regra; ver
 * o GAP 1 em docs/ENQUETES.md.
 */
async function temAtendimentoHumano(contactId: string): Promise<boolean> {
  const admin = createAdminClient();

  const { count, error } = await admin
    .from("chat_conversations")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contactId)
    .not("assigned_to", "is", null)
    .is("resolved_at", null);

  if (error) {
    // Falhou a checagem: o seguro é NÃO interromper. Um voto perdido se
    // recupera pedindo de novo; uma conversa humana atravessada por um robô,
    // não.
    console.error(`[survey-inbox] checagem de atendimento falhou: ${error.message}`);
    return true;
  }

  return (count ?? 0) > 0;
}

async function desfechoDoPortao(surveyId: string): Promise<SurveyResponseOutcome> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("survey_response_gate", { p_survey_id: surveyId });
  if (error || !data) return "not_found";
  return data as SurveyResponseOutcome;
}

async function registrarEvento(
  provider: string,
  evento: InboundEvent,
  correlationId: string,
): Promise<boolean> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("record_survey_inbound_event", {
    p_provider: provider,
    p_event_id: evento.eventId,
    p_event_type: evento.kind,
    p_contact_id: null,
    p_survey_id: null,
    p_correlation_id: correlationId,
  } as never);

  // Erro ao registrar: trata como NOVO e segue. Perder uma resposta por causa
  // da tabela de idempotência seria pior que processá-la duas vezes — e a
  // duplicidade ainda esbarra no índice único de `survey_responses` (§14, §15).
  if (error) {
    console.error(`[survey-inbox] idempotência falhou: ${error.message}`);
    return true;
  }

  return data === true;
}

async function concluirEvento(
  provider: string,
  eventId: string,
  outcome: string,
  surveyId: string | null = null,
  contactId: string | null = null,
): Promise<void> {
  const admin = createAdminClient();
  await admin.rpc("complete_survey_inbound_event", {
    p_provider: provider,
    p_event_id: eventId,
    p_outcome: outcome,
    p_survey_id: surveyId,
    p_contact_id: contactId,
  } as never);
}

/**
 * A fala do bot.
 *
 * ⚠️ Falha de envio NÃO desfaz o que já foi registrado: a resposta na urna vale
 * mesmo que a confirmação não chegue. O contrário — apagar o voto porque o
 * "obrigado" não saiu — perderia o dado por causa do enfeite.
 */
async function responder(
  provider: MessagingProvider,
  to: string,
  body: string,
  correlationId: string,
): Promise<void> {
  const envio = await provider.send({ to, body, correlationId });
  if (!envio.ok) {
    logSurveyEvent("error", "send.error", {
      correlationId,
      reason: envio.code,
      phone: maskPhone(to),
      outcome: "resposta do bot não saiu",
    });
  }
}
