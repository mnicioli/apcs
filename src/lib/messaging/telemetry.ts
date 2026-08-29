import { randomUUID } from "node:crypto";

/**
 * §49, §50, §51. Log estruturado do ciclo de mensageria.
 *
 * ⚠️ POR QUE UMA LINHA DE JSON, e não `console.log` com template string.
 *
 * O §51 pede rastrear uma mensagem por CRM → fila → WhatsApp → webhook →
 * resposta. Com texto livre isso é `grep` e esperança. Com uma linha de JSON
 * por evento, carregando sempre as mesmas chaves, a Vercel (e qualquer coletor
 * depois dela) filtra por `correlationId` e devolve o caminho inteiro.
 *
 * ⚠️ O QUE NUNCA ENTRA AQUI (§50, §54, §55):
 *
 *   • o texto que a pessoa escreveu
 *   • o texto da mensagem enviada
 *   • o telefone completo (só os quatro últimos dígitos, via `maskPhone`)
 *   • o nome do contato
 *
 * O que entra são IDENTIFICADORES: com `surveyId` + `recipientId` quem tem
 * acesso ao banco descobre tudo, e quem só tem acesso ao log não descobre nada
 * sobre uma pessoa específica. Log é o lugar menos controlado do sistema — ele
 * vai para um serviço terceiro, fica retido por meses e é lido por gente que
 * não tem papel no CRM.
 */

export type SurveyMessagingEvent =
  | "dispatch.started"
  | "dispatch.finished"
  | "dispatch.skipped"
  | "send.attempt"
  | "send.ok"
  | "send.error"
  | "send.ineligible"
  | "send.breaker_open"
  | "webhook.received"
  | "webhook.rejected"
  | "webhook.duplicate"
  | "webhook.status"
  | "webhook.message"
  | "response.registered"
  | "response.duplicate"
  | "response.invalid"
  | "response.no_context"
  | "response.ambiguous"
  | "context.opened"
  | "context.closed"
  | "optout.registered"
  | "scheduler.tick";

export interface SurveyLogFields {
  correlationId?: string;
  surveyId?: string;
  recipientId?: string;
  dispatchId?: string;
  contactId?: string;
  providerMessageId?: string;
  provider?: string;
  outcome?: string;
  /** Motivo técnico. Já vem sem dado pessoal de quem o produz. */
  reason?: string;
  attempt?: number;
  count?: number;
  durationMs?: number;
  /** Telefone JÁ MASCARADO. Ver `maskPhone`. */
  phone?: string;
}

/** §51. Um id por corrida/requisição, que viaja em todos os eventos dela. */
export function newCorrelationId(): string {
  return randomUUID();
}

/**
 * `error` para o que exige alguém olhando; `info` para o fluxo normal.
 *
 * Vai para `console` porque é o que a Vercel coleta neste projeto — não há
 * agente de observabilidade instalado (§53 fala em "quando houver
 * infraestrutura de monitoramento", e não há). A forma já está pronta para
 * quando houver: trocar o destino é trocar estas duas linhas.
 */
export function logSurveyEvent(
  level: "info" | "error",
  event: SurveyMessagingEvent,
  fields: SurveyLogFields = {},
): void {
  const linha = JSON.stringify({
    ts: new Date().toISOString(),
    scope: "survey.messaging",
    event,
    ...fields,
  });

  if (level === "error") console.error(linha);
  else console.info(linha);
}

/**
 * O mesmo log, para a caixa de entrada do WhatsApp.
 *
 * ⚠️ ESCOPO PRÓPRIO (`whatsapp.inbox`), E NÃO UMA REUTILIZAÇÃO DE
 * `logSurveyEvent`. O escopo é o que permite filtrar "tudo do disparo de
 * enquete" sem varrer junto o tráfego de atendimento, que é muito maior e
 * contínuo. Misturados, o volume da caixa afogaria o log da campanha
 * exatamente no dia em que alguém precisasse investigar a campanha.
 *
 * As MESMAS proibições do log acima valem aqui, e mais até: esta é a superfície
 * por onde passa TODO texto que associados escrevem para a APCS. Nunca o texto,
 * nunca o telefone inteiro, nunca o nome.
 */
/**
 * A DIVULGAÇÃO DE EVENTOS.
 *
 * Escopo próprio, e não reúso de `survey.messaging`, pela mesma razão que a
 * caixa de entrada tem o dela: quem procura "por que a divulgação de terça
 * parou?" filtra por `scope` e quer só isso. Misturar os dois faria a busca
 * devolver o disparo de enquete do mesmo minuto, e a leitura do log de um
 * incidente é feita com pressa.
 */
export type EventDispatchEvent =
  | "dispatch.started"
  | "dispatch.finished"
  | "dispatch.interrupted"
  | "dispatch.skipped"
  | "send.ok"
  | "send.error"
  | "send.ineligible"
  | "send.breaker_open";

export interface EventDispatchLogFields {
  correlationId?: string;
  eventId?: string;
  dispatchId?: string;
  recipientId?: string;
  providerMessageId?: string;
  provider?: string;
  outcome?: string;
  reason?: string;
  attempt?: number;
  count?: number;
  durationMs?: number;
  /** Telefone JÁ MASCARADO. Ver `maskPhone`. */
  phone?: string;
}

export function logEventDispatch(
  level: "info" | "error",
  event: EventDispatchEvent,
  fields: EventDispatchLogFields = {},
): void {
  const linha = JSON.stringify({
    ts: new Date().toISOString(),
    scope: "event.dispatch",
    event,
    ...fields,
  });

  if (level === "error") console.error(linha);
  else console.info(linha);
}

/**
 * A DIVULGAÇÃO GENÉRICA — Normativas, Comunicação, Bolsa e Palestras.
 *
 * Escopo próprio pelo mesmo motivo de `event.dispatch`: quem investiga "por que
 * o boletim de sexta não saiu?" filtra por escopo e não quer a divulgação de
 * evento do mesmo minuto no meio.
 *
 * ⚠️ `source` ENTRA NO LOG, e `title` NÃO. Saber que foi uma normativa ajuda a
 * achar a corrida; o nome dela não acrescenta nada e é conteúdo. As mesmas
 * proibições de sempre: nunca o telefone inteiro, nunca o nome de quem recebe.
 */
export type BroadcastEvent =
  | "broadcast.started"
  | "broadcast.finished"
  | "broadcast.interrupted"
  | "broadcast.skipped"
  | "send.ok"
  | "send.error"
  | "send.ineligible"
  | "send.breaker_open";

export interface BroadcastLogFields {
  correlationId?: string;
  broadcastId?: string;
  source?: string;
  recipientId?: string;
  providerMessageId?: string;
  provider?: string;
  outcome?: string;
  reason?: string;
  attempt?: number;
  count?: number;
  durationMs?: number;
  /** Telefone JÁ MASCARADO. Ver `maskPhone`. */
  phone?: string;
}

export function logBroadcast(
  level: "info" | "error",
  event: BroadcastEvent,
  fields: BroadcastLogFields = {},
): void {
  const linha = JSON.stringify({
    ts: new Date().toISOString(),
    scope: "broadcast",
    event,
    ...fields,
  });

  if (level === "error") console.error(linha);
  else console.info(linha);
}

export type WhatsAppInboxEvent =
  | "inbox.webhook_received"
  | "inbox.webhook_rejected"
  | "inbox.message_recorded"
  | "inbox.message_duplicate"
  | "inbox.message_ignored"
  | "inbox.status_applied"
  | "inbox.media_stored"
  | "inbox.media_failed"
  | "inbox.reply_sent"
  | "inbox.reply_failed";

export interface WhatsAppLogFields {
  correlationId?: string;
  provider?: string;
  chatId?: string;
  messageId?: string;
  providerMessageId?: string;
  outcome?: string;
  /** Motivo técnico. Já vem sem dado pessoal de quem o produz. */
  reason?: string;
  count?: number;
  bytes?: number;
  durationMs?: number;
  /** Telefone JÁ MASCARADO. Ver `maskPhone`. */
  phone?: string;
}

export function logWhatsAppEvent(
  level: "info" | "error",
  event: WhatsAppInboxEvent,
  fields: WhatsAppLogFields = {},
): void {
  const linha = JSON.stringify({
    ts: new Date().toISOString(),
    scope: "whatsapp.inbox",
    event,
    ...fields,
  });

  if (level === "error") console.error(linha);
  else console.info(linha);
}
