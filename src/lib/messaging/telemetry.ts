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

/**
 * O ROBÔ — §47.
 *
 * Escopo próprio (`intelligence`), e não reúso de `whatsapp.inbox`, pelo mesmo
 * motivo que separou os outros quatro: quem investiga "por que o bot respondeu
 * isso?" filtra por escopo e quer só as decisões. Misturado à caixa de entrada,
 * o tráfego de atendimento — que é contínuo e muito maior — afogaria a linha
 * procurada exatamente no dia em que ela importa.
 *
 * ⚠️ AS MESMAS PROIBIÇÕES, e uma a mais que é específica daqui: além de não
 * registrar o texto da pessoa nem o telefone inteiro, NÃO registra o `subject`
 * que o modelo extraiu. Ele é um pedaço literal do que a pessoa escreveu — "a
 * normativa do meu vizinho João" vira `subject`, e iria inteiro para um log
 * retido por meses num serviço terceiro. Ele fica em
 * `intelligence_interactions`, que tem RLS e a política de retenção do banco.
 */
export type IntelligenceEvent =
  | "bot.skipped"
  | "bot.turn"
  | "bot.turn_failed"
  | "bot.send_ok"
  | "bot.send_failed"
  | "bot.handoff";

export interface IntelligenceLogFields {
  /** §46. O mesmo id do evento do webhook que originou este turno. */
  correlationId?: string;
  provider?: string;
  /** §46. `whatsapp_chats.id`. */
  chatId?: string;
  /** §46. A mensagem RECEBIDA. */
  messageId?: string;
  /** §46. A primeira mensagem ENVIADA em resposta. */
  replyMessageId?: string;
  providerMessageId?: string;
  /** Só o NOME da intenção — vocabulário fechado, nunca texto da pessoa. */
  intent?: string;
  tool?: string;
  /** O desfecho da ferramenta, no vocabulário de `intelligence_outcome`. */
  outcome?: string;
  /** 0 a 1, com três casas. É número, não conteúdo. */
  confidence?: number;
  /** Quantos arquivos acompanharam a resposta. */
  attachments?: number;
  /** Quantas mensagens o evento trazia. */
  count?: number;
  attempt?: number;
  /** §47. Tempo de execução do turno inteiro. */
  durationMs?: number;
  /** Motivo técnico. Já vem sem dado pessoal. */
  reason?: string;
  /** Telefone JÁ MASCARADO. Ver `maskPhone`. */
  phone?: string;
}

export function logIntelligenceEvent(
  level: "info" | "error",
  event: IntelligenceEvent,
  fields: IntelligenceLogFields = {},
): void {
  const linha = JSON.stringify({
    ts: new Date().toISOString(),
    scope: "intelligence",
    event,
    ...fields,
  });

  if (level === "error") console.error(linha);
  else console.info(linha);
}

/* -------------------------------------------------------------------------- */
/* Fluxos de Atendimento — o motor de execução (§36 do Prompt 3)              */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ O §36 PEDE UMA LISTA DE CAMPOS, E ELA É QUASE TODA DE IDENTIFICADOR — o
 * que é exatamente a política deste arquivo, e não uma coincidência feliz.
 *
 * `conversationId`, `flowId`, `flowVersionId`, `nodeId`, `executionId`, `event`,
 * `status`, `duration`: com eles, quem tem acesso ao banco reconstrói o
 * atendimento inteiro; quem só tem acesso ao log não descobre nada sobre uma
 * pessoa. O que a pessoa ESCREVEU e o que o robô RESPONDEU continuam fora — eles
 * vivem em `whatsapp_messages`, com a retenção de lá.
 *
 * ⚠️ E A CHAVE DA ALTERNATIVA ESCOLHIDA ENTRA (`optionKey`), porque ela é
 * vocabulário fechado do desenho — `EVENTOS`, `BOLSA` — e não texto de
 * ninguém. É o que permite responder "quantas pessoas escolhem Filiação e
 * desistem" sem ler uma conversa.
 */
export type FlowEngineLogEvent =
  | "flow.run_started"
  | "flow.step_skipped"
  | "flow.node"
  | "flow.answer"
  | "flow.action"
  | "flow.handoff"
  | "flow.completed"
  | "flow.failed"
  | "flow.timeout"
  | "flow.conflict"
  | "flow.paused"
  /**
   * §44 do Prompt 4. QUANDO A IA FOI USADA — e os três desfechos são distintos
   * de propósito, porque pedem coisas diferentes de quem lê:
   *
   *   `intent_resolved`  o modelo respondeu. A linha traz confiança e faixa,
   *                      que é o material do §47 ("confiança média", "taxa de
   *                      intenção identificada").
   *   `intent_failed`    o modelo falhou ou recusou. Alguém precisa olhar o
   *                      serviço — ou a conversa, se for recusa de segurança.
   *   `intent_skipped`   nem chegou a ser chamado (sem chave configurada). Não
   *                      é falha: é a APCS não ter ligado a IA. Contá-lo junto
   *                      com `failed` faria um projeto sem chave parecer um
   *                      fornecedor fora do ar.
   */
  | "flow.intent_resolved"
  | "flow.intent_failed"
  | "flow.intent_skipped";

export interface FlowEngineLogFields {
  correlationId?: string;
  /** `flow_runs.id` — o "executionId" do §36. */
  runId?: string;
  /** `whatsapp_chats.id` — o "conversationId" do §36. */
  chatId?: string;
  flowId?: string;
  flowVersionId?: string;
  nodeId?: string;
  /** `message`, `question`, `condition`… — o tipo, nunca o conteúdo. */
  nodeType?: string;
  /** `flow_run_steps.id`. */
  stepId?: number;
  /** A chave de idempotência do passo (§23). */
  idempotencyKey?: string;
  /** Vocabulário fechado do desenho. Nunca o que a pessoa digitou. */
  optionKey?: string;
  actionKey?: string;
  /** `success` | `failure` | `not_found` | `retry`. */
  actionStatus?: string;
  teamKey?: string;
  status?: string;
  /** Em que tentativa a resposta está (§11) ou a ação (§25). */
  attempt?: number;
  maxAttempts?: number;
  durationMs?: number;
  /** Motivo técnico, do vocabulário de `FlowEngineFailure`. Sem dado pessoal. */
  reason?: string;
  count?: number;

  /* ------------------------------------------------------------------------ */
  /* §44 do Prompt 4 — a IA                                                    */
  /* ------------------------------------------------------------------------ */
  //
  // ⚠️ A MENSAGEM DA PESSOA NÃO ESTÁ AQUI, e a ausência é a decisão.
  //
  // O §44 lista "mensagem" entre os campos a registrar — e a mesma seção manda
  // respeitar a LGPD e evitar dado desnecessário. A mensagem crua JÁ ESTÁ em
  // `whatsapp_messages`, que tem RLS, dono e prazo; repeti-la no log de
  // aplicação a moveria para um lugar sem nada disso e habitualmente exportado
  // para fora. O `correlationId` costura os dois registros, que é o que uma
  // investigação de verdade precisa.
  //
  // O que entra é vocabulário fechado e número. Nada aqui identifica ninguém.

  /** `consultar_bolsa`, `desconhecido`, `sys_ia_indisponivel`… */
  intent?: string;
  /** 0 a 1, como o modelo devolveu. Material do §47. */
  confidence?: number;
  /** `high` | `medium` | `low`, já com os limites configurados aplicados. */
  band?: string;
  /** O fornecedor de IA ou de mensageria, conforme o evento. */
  provider?: string;
  /** O modelo que de fato respondeu. */
  model?: string;
  /** §78 do módulo de inteligência: qual prompt de sistema estava valendo. */
  promptVersion?: string;
  latencyMs?: number;

  /**
   * ⚠️ SEMPRE MASCARADO — passe por `maskPhone`, nunca o número cru.
   *
   * Ele existe porque um log de atendimento sem NENHUM identificador de pessoa
   * é inútil no dia em que alguém diz "o robô me respondeu errado": o
   * `correlationId` costura os eventos entre si, mas ninguém liga para a APCS
   * citando um uuid. O telefone mascarado é o suficiente para achar a conversa
   * e insuficiente para ser um cadastro paralelo.
   */
  phone?: string;
}

export function logFlowEngineEvent(
  level: "info" | "error",
  event: FlowEngineLogEvent,
  fields: FlowEngineLogFields = {},
): void {
  const linha = JSON.stringify({
    ts: new Date().toISOString(),
    scope: "flow-engine",
    event,
    ...fields,
  });

  if (level === "error") console.error(linha);
  else console.info(linha);
}
