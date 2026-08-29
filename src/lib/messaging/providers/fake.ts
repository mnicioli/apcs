import { verifyHmacSignature } from "../signature";
import { parseCloudApiWebhook } from "./cloud-api";
import type {
  InboundEvent,
  MessagingProvider,
  OutboundDocumentMessage,
  OutboundImageMessage,
  OutboundTextMessage,
  SendResult,
  SignatureCheck,
} from "../messaging.types";

/**
 * §60. O fornecedor FALSO — para teste automatizado e homologação.
 *
 * ⚠️ NÃO É SELECIONÁVEL EM PRODUÇÃO. Ver `registry.ts`: com
 * `NODE_ENV === "production"` o registro ignora o pedido e devolve o provedor
 * não configurado, que recusa alto. A razão é direta — um fornecedor que
 * responde "enviei!" sem enviar nada é a maneira mais eficiente de fazer uma
 * campanha inteira parecer bem-sucedida sem que uma única pessoa tenha
 * recebido.
 *
 * Ele guarda o que "mandou" em memória para que o teste possa afirmar sobre o
 * conteúdo, e sabe falhar sob comando (§61, §74, §75): `failFor` para erro
 * definitivo por número, `failTimes` para falha temporária que cura sozinha.
 */
export class FakeProvider implements MessagingProvider {
  readonly name = "fake";
  readonly configured = true;
  readonly missing: readonly string[] = [];

  readonly sent: OutboundTextMessage[] = [];
  readonly sentImages: OutboundImageMessage[] = [];
  readonly sentDocuments: OutboundDocumentMessage[] = [];

  /** Números que sempre falham, com o motivo. Erro DEFINITIVO. */
  private readonly failFor = new Map<string, string>();
  /** Números que falham N vezes e depois funcionam. Falha TEMPORÁRIA. */
  private readonly failTimes = new Map<string, number>();
  /** Falha temporária global — simula o fornecedor fora do ar (§61). */
  private downFor = 0;

  private sequence = 0;

  /**
   * ⚠️ UM PREFIXO ALEATÓRIO POR INSTÂNCIA, e ele resolve um defeito real.
   *
   * Sem ele, todo processo que criava um FakeProvider gerava `fake.wamid.1`,
   * `fake.wamid.2`... — e uma bateria que escreve no banco de verdade colidia
   * com os ids da RODADA ANTERIOR. A idempotência do §16 então recusava os
   * eventos, corretamente, e o teste falhava por um motivo que não tinha nada a
   * ver com o que ele media. Um dublê não pode produzir chaves repetidas.
   */
  private readonly runId = Math.random().toString(36).slice(2, 10);

  constructor(private readonly appSecret = "segredo-de-teste") {}

  rejectPermanently(to: string, motivo = "recipient not a WhatsApp user") {
    this.failFor.set(to, motivo);
    return this;
  }

  failTemporarily(to: string, vezes: number) {
    this.failTimes.set(to, vezes);
    return this;
  }

  goDown(chamadas: number) {
    this.downFor = chamadas;
    return this;
  }

  /**
   * ⚠️ `sequence` NÃO volta a zero. Reiniciá-la faria a instância repetir ids
   * que ela já entregou nesta mesma rodada — e o segundo uso esbarraria na
   * idempotência, que está certa. Só o que é de cenário é limpo.
   */
  reset() {
    this.sent.length = 0;
    this.sentImages.length = 0;
    this.sentDocuments.length = 0;
    this.failFor.clear();
    this.failTimes.clear();
    this.downFor = 0;
  }

  async send(message: OutboundTextMessage): Promise<SendResult> {
    if (this.downFor > 0) {
      this.downFor -= 1;
      return {
        ok: false,
        retryable: true,
        code: "http_503",
        message: "O fornecedor respondeu 503.",
      };
    }

    const definitivo = this.failFor.get(message.to);
    if (definitivo) {
      return { ok: false, retryable: false, code: "wa_131026", message: definitivo };
    }

    const restantes = this.failTimes.get(message.to) ?? 0;
    if (restantes > 0) {
      this.failTimes.set(message.to, restantes - 1);
      return { ok: false, retryable: true, code: "timeout", message: "Sem resposta a tempo." };
    }

    this.sequence += 1;
    // ⚠️ O registro vem DEPOIS de todas as recusas: um teste que conta
    // `sent.length` estaria contando tentativas, não envios, e passaria mesmo
    // com o worker mandando duas vezes para a mesma pessoa.
    this.sent.push(message);
    return { ok: true, providerMessageId: `fake.${this.runId}.${this.sequence}` };
  }

  /**
   * A imagem passa pelas MESMAS recusas do texto, e isso é o que torna o dublê
   * útil: um teste que derruba o fornecedor com `goDown` precisa ver a
   * divulgação com imagem falhar igual — senão ele estaria provando um caminho
   * que produção não tem.
   *
   * O registro vai para `sentImages`, separado de `sent`: um teste que conta
   * `sent.length` está contando MENSAGENS DE TEXTO, e misturar as duas faria
   * a bateria de Enquetes passar a contar coisas de Eventos.
   */
  async sendImage(message: OutboundImageMessage): Promise<SendResult> {
    if (this.downFor > 0) {
      this.downFor -= 1;
      return {
        ok: false,
        retryable: true,
        code: "http_503",
        message: "O fornecedor respondeu 503.",
      };
    }

    const definitivo = this.failFor.get(message.to);
    if (definitivo) {
      return { ok: false, retryable: false, code: "wa_131026", message: definitivo };
    }

    const restantes = this.failTimes.get(message.to) ?? 0;
    if (restantes > 0) {
      this.failTimes.set(message.to, restantes - 1);
      return { ok: false, retryable: true, code: "timeout", message: "Sem resposta a tempo." };
    }

    this.sequence += 1;
    this.sentImages.push(message);
    return { ok: true, providerMessageId: `fake.${this.runId}.${this.sequence}` };
  }

  /**
   * Espelha `sendImage`: as MESMAS falhas programadas valem para o anexo. Um
   * duplo que só soubesse falhar em texto deixaria o caminho do documento sem
   * teste de erro — que é justamente onde a divulgação de Bolsa e Normativas
   * vive.
   *
   * O registro vai para `sentDocuments`, separado dos outros dois: um teste que
   * conta mensagens não pode somar um PDF com uma legenda a um texto puro.
   */
  async sendDocument(message: OutboundDocumentMessage): Promise<SendResult> {
    if (this.downFor > 0) {
      this.downFor -= 1;
      return {
        ok: false,
        retryable: true,
        code: "http_503",
        message: "O fornecedor respondeu 503.",
      };
    }

    const definitivo = this.failFor.get(message.to);
    if (definitivo) {
      return { ok: false, retryable: false, code: "wa_131026", message: definitivo };
    }

    const restantes = this.failTimes.get(message.to) ?? 0;
    if (restantes > 0) {
      this.failTimes.set(message.to, restantes - 1);
      return { ok: false, retryable: true, code: "timeout", message: "Sem resposta a tempo." };
    }

    this.sequence += 1;
    this.sentDocuments.push(message);
    return { ok: true, providerMessageId: `fake.${this.runId}.${this.sequence}` };
  }

  verifySignature(rawBody: string, headers: Headers): SignatureCheck {
    // Assina de verdade: um provedor falso que aceitasse qualquer assinatura
    // faria o teste do §80 ("webhook inválido") passar sem provar nada.
    return verifyHmacSignature({
      rawBody,
      header: headers.get("x-hub-signature-256"),
      secret: this.appSecret,
    });
  }

  /** O mesmo formato da Cloud API — é o formato que o teste vai simular. */
  parseWebhook(payload: unknown): InboundEvent[] {
    return parseCloudApiWebhook(payload);
  }
}
