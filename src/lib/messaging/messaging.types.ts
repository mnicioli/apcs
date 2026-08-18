/**
 * A PORTA DE MENSAGERIA (§2).
 *
 *     Survey Service  →  Messaging Service  →  WhatsApp Provider
 *
 * Este arquivo é o contrato do meio. Nada acima dele sabe o nome do fornecedor,
 * o formato do payload ou o header de assinatura; nada abaixo dele sabe o que é
 * uma enquete.
 *
 * ⚠️ O QUE ESTE CONTRATO PROÍBE, e é o ponto:
 *
 * Não existe `send()` que devolva "provavelmente deu certo". `SendResult` é
 * `ok: true` COM o id do fornecedor, ou `ok: false` com o motivo e se vale
 * tentar de novo. É o §88 no tipo: sem id do fornecedor, ninguém consegue
 * escrever "enviado" — porque não há o que passar para
 * `mark_survey_recipient`.
 */

/** Uma mensagem de texto saindo. É tudo que o MVP precisa mandar. */
export interface OutboundTextMessage {
  /** E.164 sem o `+`, como as APIs de WhatsApp esperam: `5519991234567`. */
  to: string;
  body: string;
  /** §51. Viaja no log de ponta a ponta. */
  correlationId: string;
}

/**
 * ⚠️ `retryable` NÃO É OPINIÃO DO CHAMADOR — é o adaptador traduzindo o que o
 * fornecedor disse.
 *
 * A diferença decide o destino da pessoa: um 429 ou um 503 é a rede tendo um
 * dia ruim e a mensagem volta para a fila; "este número não tem WhatsApp" é
 * definitivo, e insistir queima a cota de envio da conta para sempre sem
 * chance nenhuma de sucesso (§29).
 */
export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; retryable: boolean; code: string; message: string };

/** Um evento vindo do fornecedor, já traduzido para o vocabulário da APCS. */
export type InboundEvent =
  | {
      kind: "message";
      /** Chave de idempotência (§16). É o id da mensagem no fornecedor. */
      eventId: string;
      from: string;
      text: string;
      /** §6/§7. O id da mensagem CITADA, quando a pessoa usou "responder". */
      replyToMessageId: string | null;
      timestamp: string | null;
    }
  | {
      kind: "status";
      eventId: string;
      /** O id que ELE nos devolveu no envio — a chave para achar o destinatário. */
      providerMessageId: string;
      status: "sent" | "delivered" | "read" | "failed";
      errorMessage: string | null;
      timestamp: string | null;
    };

export interface SignatureCheck {
  valid: boolean;
  /** Para o log. Nunca vai para a resposta HTTP. */
  reason: string;
}

/**
 * O adaptador de um fornecedor.
 *
 * ⚠️ `configured` existe para que "não configurado" seja um ESTADO VISÍVEL, e
 * não uma exceção surpresa no meio de uma campanha. O worker consulta antes de
 * abrir a corrida e recusa com uma frase que diz o que falta — em vez de marcar
 * dez pessoas como erro e deixar a explicação num log.
 */
export interface MessagingProvider {
  readonly name: string;
  readonly configured: boolean;
  /** O que falta para configurar. Vazio quando `configured` é `true`. */
  readonly missing: readonly string[];

  send(message: OutboundTextMessage): Promise<SendResult>;

  /** §18. A assinatura do webhook. Sem assinatura configurada → inválido. */
  verifySignature(rawBody: string, headers: Headers): SignatureCheck;

  /** §17. Traduz o payload do fornecedor. Payload estranho → lista vazia. */
  parseWebhook(payload: unknown): InboundEvent[];
}
