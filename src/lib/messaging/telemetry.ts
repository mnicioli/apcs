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
