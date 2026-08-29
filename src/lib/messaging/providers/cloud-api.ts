import { fetchWithTimeout } from "../resilience";
import { verifyHmacSignature, WHATSAPP_SIGNATURE_HEADER } from "../signature";
import type {
  InboundEvent,
  MessagingProvider,
  OutboundImageMessage,
  OutboundTextMessage,
  SendResult,
  SignatureCheck,
} from "../messaging.types";

/**
 * Adaptador da WhatsApp Cloud API (Meta).
 *
 * ⚠️ ESTE CÓDIGO NUNCA FOI EXECUTADO CONTRA A API REAL. Não há conta, número
 * nem token neste projeto — ver §95 e docs/ENQUETES.md. Ele foi escrito a
 * partir da documentação pública do endpoint `/{phone-number-id}/messages` e
 * do formato de webhook `whatsapp_business_account`, e está coberto por testes
 * com respostas gravadas. Ligá-lo à conta real é o passo de homologação que
 * DEPENDE DA APCS: número aprovado, template aprovado e as quatro variáveis de
 * ambiente abaixo.
 *
 * Escolhi a Cloud API, e não um agregador (Z-API, Twilio, 360dialog), porque:
 * não há integração existente para reutilizar (procurada: o projeto só tem o
 * chat web próprio); é a fonte oficial, sem intermediário cobrando por
 * mensagem; e o contrato dela é o mais estável dos quatro. Se a APCS já tiver
 * contrato com um agregador, trocar é escrever OUTRO arquivo como este — nada
 * acima da porta muda.
 */

const GRAPH_VERSION = "v21.0";

interface CloudApiConfig {
  token: string;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string;
}

export function readCloudApiConfig(env = process.env): {
  config: CloudApiConfig | null;
  missing: string[];
} {
  const campos = {
    APCS_WHATSAPP_TOKEN: env.APCS_WHATSAPP_TOKEN?.trim(),
    APCS_WHATSAPP_PHONE_NUMBER_ID: env.APCS_WHATSAPP_PHONE_NUMBER_ID?.trim(),
    APCS_WHATSAPP_APP_SECRET: env.APCS_WHATSAPP_APP_SECRET?.trim(),
    APCS_WHATSAPP_VERIFY_TOKEN: env.APCS_WHATSAPP_VERIFY_TOKEN?.trim(),
  };

  const missing = Object.entries(campos)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) return { config: null, missing };

  return {
    config: {
      token: campos.APCS_WHATSAPP_TOKEN!,
      phoneNumberId: campos.APCS_WHATSAPP_PHONE_NUMBER_ID!,
      appSecret: campos.APCS_WHATSAPP_APP_SECRET!,
      verifyToken: campos.APCS_WHATSAPP_VERIFY_TOKEN!,
    },
    missing: [],
  };
}

/**
 * Os códigos que o retry NÃO deve insistir (§29).
 *
 * 131026 = "recipient not a WhatsApp user"; 131047 = fora da janela de 24 h sem
 * template aprovado; 131051 = tipo de mensagem não suportado; 100 = parâmetro
 * inválido. Nenhum deles muda de resposta na segunda tentativa — insistir só
 * queima cota e enche a tabela de erro repetido.
 */
const CODIGOS_DEFINITIVOS = new Set([100, 131026, 131047, 131051, 132000, 132001]);

export class CloudApiProvider implements MessagingProvider {
  readonly name = "whatsapp_cloud_api";
  readonly configured: boolean;
  readonly missing: readonly string[];

  private readonly config: CloudApiConfig | null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const { config, missing } = readCloudApiConfig(env);
    this.config = config;
    this.configured = config !== null;
    this.missing = missing;
  }

  async send(message: OutboundTextMessage): Promise<SendResult> {
    if (!this.config) {
      return {
        ok: false,
        retryable: false,
        code: "not_configured",
        message: `Integração de WhatsApp não configurada: falta ${this.missing.join(", ")}.`,
      };
    }

    const resultado = await fetchWithTimeout(
      `https://graph.facebook.com/${GRAPH_VERSION}/${this.config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: message.to,
          type: "text",
          // A prévia de link transformaria uma URL no corpo num cartão que
          // rouba o espaço das alternativas na tela do celular.
          text: { preview_url: false, body: message.body },
        }),
      },
    );

    if (!resultado.ok) {
      // Timeout e falha de rede são SEMPRE retryable — e note a consequência
      // desconfortável: a mensagem pode ter saído mesmo assim. É por isso que a
      // reentrega é aceitável e a duplicata de RESPOSTA não é: o §14 e o §15
      // protegem a urna, que é o que não pode duplicar.
      return {
        ok: false,
        retryable: true,
        code: resultado.timedOut ? "timeout" : "network",
        message: resultado.error,
      };
    }

    const { response } = resultado;
    const corpo: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const erro = extrairErro(corpo);
      return {
        ok: false,
        // 429 e 5xx são o fornecedor pedindo para tentar depois. 4xx com código
        // definitivo é ele dizendo que não adianta.
        retryable:
          response.status === 429 ||
          response.status >= 500 ||
          (erro.code !== null && !CODIGOS_DEFINITIVOS.has(erro.code)),
        code: erro.code !== null ? `wa_${erro.code}` : `http_${response.status}`,
        message: erro.message ?? `O fornecedor respondeu ${response.status}.`,
      };
    }

    const id = extrairMessageId(corpo);
    if (!id) {
      // §88. Sem id não há como marcar "enviado" com honestidade: o webhook de
      // entrega chega citando um id que não teríamos guardado.
      return {
        ok: false,
        retryable: true,
        code: "no_message_id",
        message: "O fornecedor aceitou a mensagem mas não devolveu o id dela.",
      };
    }

    return { ok: true, providerMessageId: id };
  }

  /**
   * Imagem com legenda pelo `type: "image"` da Cloud API.
   *
   * ⚠️ ESTE CAMINHO NÃO ESTÁ EM USO HOJE — a APCS usa a Z-API (ver
   * `registry.ts`), e nada aqui foi exercitado contra a Meta de verdade. Está
   * escrito assim mesmo porque a porta exige, e escrever "não suportado" seria
   * uma decisão pior: no dia da troca de fornecedor, a divulgação de eventos
   * silenciosamente pararia de mandar o cartaz, e ninguém ligaria uma coisa à
   * outra. O código está correto conforme a documentação; quem trocar de
   * fornecedor precisa TESTAR, e é isto que este aviso pede.
   *
   * ⚠️ A Meta impõe um limite de 1024 caracteres na legenda e recusa a mensagem
   * inteira quando ele estoura — não corta. O corte abaixo é o que impede uma
   * legenda comprida de virar "nenhuma mensagem".
   */
  async sendImage(message: OutboundImageMessage): Promise<SendResult> {
    if (!this.config) {
      return {
        ok: false,
        retryable: false,
        code: "not_configured",
        message: `Integração de WhatsApp não configurada: falta ${this.missing.join(", ")}.`,
      };
    }

    const resultado = await fetchWithTimeout(
      `https://graph.facebook.com/${GRAPH_VERSION}/${this.config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: message.to,
          type: "image",
          image: { link: message.imageUrl, caption: message.caption.slice(0, 1024) },
        }),
      },
    );

    if (!resultado.ok) {
      return {
        ok: false,
        retryable: true,
        code: resultado.timedOut ? "timeout" : "network",
        message: resultado.error,
      };
    }

    const { response } = resultado;
    const corpo: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const erro = extrairErro(corpo);
      return {
        ok: false,
        retryable:
          response.status === 429 ||
          response.status >= 500 ||
          (erro.code !== null && !CODIGOS_DEFINITIVOS.has(erro.code)),
        code: erro.code !== null ? `wa_${erro.code}` : `http_${response.status}`,
        message: erro.message ?? `O fornecedor respondeu ${response.status}.`,
      };
    }

    const id = extrairMessageId(corpo);
    if (!id) {
      return {
        ok: false,
        retryable: true,
        code: "no_message_id",
        message: "O fornecedor aceitou a imagem mas não devolveu o id dela.",
      };
    }

    return { ok: true, providerMessageId: id };
  }

  verifySignature(rawBody: string, headers: Headers): SignatureCheck {
    return verifyHmacSignature({
      rawBody,
      header: headers.get(WHATSAPP_SIGNATURE_HEADER),
      secret: this.config?.appSecret,
    });
  }

  /** §17. O handshake `GET` que a Meta faz ao cadastrar a URL do webhook. */
  verifyChallenge(mode: string | null, token: string | null): boolean {
    return (
      mode === "subscribe" &&
      typeof token === "string" &&
      token.length > 0 &&
      token === this.config?.verifyToken
    );
  }

  parseWebhook(payload: unknown): InboundEvent[] {
    return parseCloudApiWebhook(payload);
  }
}

// ---------------------------------------------------------------------------
// Tradução do payload
// ---------------------------------------------------------------------------

/**
 * ⚠️ TUDO AQUI É `unknown` ATÉ PROVA EM CONTRÁRIO.
 *
 * O corpo vem da internet. A assinatura prova que veio da Meta, não que tem o
 * formato esperado — e uma versão nova da API muda o formato sem avisar. Cada
 * campo é conferido antes de ser usado; o que não bate é ignorado em silêncio,
 * porque devolver erro faria a Meta reentregar o mesmo payload para sempre.
 */
export function parseCloudApiWebhook(payload: unknown): InboundEvent[] {
  const eventos: InboundEvent[] = [];
  const root = asRecord(payload);
  if (!root || root.object !== "whatsapp_business_account") return eventos;

  for (const entry of asArray(root.entry)) {
    const e = asRecord(entry);
    if (!e) continue;

    for (const change of asArray(e.changes)) {
      const c = asRecord(change);
      const value = asRecord(c?.value);
      if (!value) continue;

      for (const message of asArray(value.messages)) {
        const m = asRecord(message);
        const id = asString(m?.id);
        const from = asString(m?.from);
        if (!id || !from) continue;

        // Só texto no MVP (§10). Áudio, imagem e figurinha viram "não é
        // resposta" — e o fluxo normal do chatbot cuida deles.
        const texto = asString(asRecord(m?.text)?.body);
        if (texto === null) continue;

        eventos.push({
          kind: "message",
          eventId: id,
          from,
          text: texto,
          replyToMessageId: asString(asRecord(m?.context)?.id),
          timestamp: asString(m?.timestamp),
        });
      }

      for (const status of asArray(value.statuses)) {
        const s = asRecord(status);
        const id = asString(s?.id);
        const bruto = asString(s?.status);
        if (!id || !bruto) continue;

        const traduzido = traduzirStatus(bruto);
        if (!traduzido) continue;

        eventos.push({
          kind: "status",
          // ⚠️ A chave de idempotência de um status NÃO é o id da mensagem: a
          // mesma mensagem gera sent, delivered e read, todos com o mesmo `id`.
          // Sem o sufixo, só o primeiro dos três seria processado.
          eventId: `${id}:${bruto}`,
          providerMessageId: id,
          status: traduzido,
          errorMessage: primeiroErro(s?.errors),
          timestamp: asString(s?.timestamp),
        });
      }
    }
  }

  return eventos;
}

function traduzirStatus(bruto: string): "sent" | "delivered" | "read" | "failed" | null {
  switch (bruto) {
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "read":
      return "read";
    case "failed":
      return "failed";
    // 'deleted' e o que a Meta inventar depois: ignorados de propósito.
    default:
      return null;
  }
}

function extrairErro(corpo: unknown): { code: number | null; message: string | null } {
  const erro = asRecord(asRecord(corpo)?.error);
  if (!erro) return { code: null, message: null };
  const code = typeof erro.code === "number" ? erro.code : null;
  return { code, message: asString(erro.message) };
}

function extrairMessageId(corpo: unknown): string | null {
  const messages = asArray(asRecord(corpo)?.messages);
  return asString(asRecord(messages[0])?.id);
}

function primeiroErro(errors: unknown): string | null {
  const primeiro = asRecord(asArray(errors)[0]);
  if (!primeiro) return null;
  const titulo = asString(primeiro.title);
  const detalhe = asString(primeiro.message ?? primeiro.details);
  return [titulo, detalhe].filter(Boolean).join(" — ") || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
