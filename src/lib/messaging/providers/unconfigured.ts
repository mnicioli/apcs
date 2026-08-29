import type {
  InboundEvent,
  MessagingProvider,
  OutboundImageMessage,
  OutboundTextMessage,
  SendResult,
  SignatureCheck,
} from "../messaging.types";

/**
 * O fornecedor de quando NÃO HÁ FORNECEDOR — o estado atual deste projeto.
 *
 * ⚠️ ELE RECUSA. Não registra, não enfileira para depois, não devolve
 * `ok: true` com um id inventado.
 *
 * A tentação de fazer um "provedor de log" que escreve a mensagem no console e
 * responde sucesso é forte, e é exatamente o que o §95 proíbe: a tela mostraria
 * "10 enviadas, 0 erros" para uma campanha em que ninguém recebeu nada, e o
 * §88 ("não marcar como enviado se o provider não confirmar") estaria
 * violado no primeiro disparo.
 *
 * Recusando, a tela mostra 10 erros com a frase abaixo escrita em cada um —
 * que diz o que fazer.
 */
export class UnconfiguredProvider implements MessagingProvider {
  readonly name = "unconfigured";
  readonly configured = false;

  constructor(readonly missing: readonly string[] = []) {}

  private get frase(): string {
    const faltando =
      this.missing.length > 0 ? ` Falta configurar: ${this.missing.join(", ")}.` : "";
    return `O envio por WhatsApp ainda não está integrado.${faltando}`;
  }

  async send(_message: OutboundTextMessage): Promise<SendResult> {
    return { ok: false, retryable: false, code: "not_configured", message: this.frase };
  }

  async sendImage(_message: OutboundImageMessage): Promise<SendResult> {
    return { ok: false, retryable: false, code: "not_configured", message: this.frase };
  }

  verifySignature(): SignatureCheck {
    // §18. Sem segredo configurado, nenhum payload é confiável — nem para
    // "só testar". Um webhook que aceita qualquer corpo é um jeito de qualquer
    // pessoa registrar respostas em nome de associados.
    return { valid: false, reason: "integração de WhatsApp não configurada" };
  }

  parseWebhook(): InboundEvent[] {
    return [];
  }
}
