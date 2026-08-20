import { fetchWithTimeout } from "../resilience";
import { safeCompare } from "../signature";
import type {
  InboundConversation,
  InboundEvent,
  InboundMedia,
  InboundMediaKind,
  MessagingProvider,
  OutboundTextMessage,
  SendResult,
  SignatureCheck,
} from "../messaging.types";

/**
 * Adaptador da Z-API — o agregador que a APCS contratou.
 *
 * A porta de mensageria (`messaging.types.ts`) foi desenhada exatamente para
 * este momento: o `cloud-api.ts` diz, no próprio cabeçalho, que trocar de
 * fornecedor é "escrever OUTRO arquivo como este". Este é o outro arquivo.
 * Nada acima da porta mudou — nem o worker de enquetes, nem o disjuntor, nem
 * uma linha de tela.
 *
 * ⚠️ ELE NÃO É A CLOUD API DA META, E A DIFERENÇA IMPORTA EM TRÊS PONTOS:
 *
 * 1. NÃO HÁ ASSINATURA NO WEBHOOK. Ver `verifySignature`, abaixo. É a diferença
 *    com maior consequência de segurança, e a razão de este módulo ter uma
 *    rota própria em vez de reaproveitar `/api/webhooks/whatsapp`.
 *
 * 2. NÃO HÁ JANELA DE 24 HORAS NEM TEMPLATE APROVADO. A Z-API opera o WhatsApp
 *    Web de um número comum, então uma resposta de atendimento sai a qualquer
 *    momento. Em compensação, o número pode ser banido pelo próprio WhatsApp se
 *    disparar em volume — o limite de ritmo de `resilience.ts` deixa de ser
 *    educação e passa a ser sobrevivência do número.
 *
 * 3. ELE ENXERGA A CONVERSA INTEIRA. Nome do contato, foto, grupo, quem falou
 *    dentro do grupo, e as mensagens que alguém digitou NO CELULAR. É isso que
 *    permite a caixa de entrada existir — a Cloud API nunca contaria que uma
 *    mensagem saiu por fora do sistema.
 *
 * Documentação: https://developer.z-api.io/api-reference/introduction
 */

const BASE_URL = "https://api.z-api.io";

/** §20. Uma resposta de atendimento não pode ficar pendurada. */
const SEND_TIMEOUT_MS = 15_000;

interface ZApiConfig {
  instanceId: string;
  token: string;
  clientToken: string;
  webhookSecret: string;
}

export function readZApiConfig(env: NodeJS.ProcessEnv = process.env): {
  config: ZApiConfig | null;
  missing: string[];
} {
  const campos = {
    APCS_ZAPI_INSTANCE_ID: env.APCS_ZAPI_INSTANCE_ID?.trim(),
    APCS_ZAPI_TOKEN: env.APCS_ZAPI_TOKEN?.trim(),
    APCS_ZAPI_CLIENT_TOKEN: env.APCS_ZAPI_CLIENT_TOKEN?.trim(),
    APCS_ZAPI_WEBHOOK_SECRET: env.APCS_ZAPI_WEBHOOK_SECRET?.trim(),
  };

  const missing = Object.entries(campos)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) return { config: null, missing };

  return {
    config: {
      instanceId: campos.APCS_ZAPI_INSTANCE_ID!,
      token: campos.APCS_ZAPI_TOKEN!,
      clientToken: campos.APCS_ZAPI_CLIENT_TOKEN!,
      webhookSecret: campos.APCS_ZAPI_WEBHOOK_SECRET!,
    },
    missing: [],
  };
}

/**
 * ⚠️ O SEGREDO DO WEBHOOK É OBRIGATÓRIO PARA O ADAPTADOR EXISTIR, e ele não é
 * usado no envio.
 *
 * Poderia ser opcional: sem ele o envio funciona igual. Mas aí o webhook ficaria
 * de pé sem autenticação nenhuma (ver `verifySignature`), e qualquer pessoa na
 * internet poderia inserir mensagens falsas na caixa de entrada da APCS em nome
 * de um associado. Exigi-lo aqui é o que garante que "configurei a Z-API" e
 * "o webhook está protegido" sejam a mesma frase.
 */
export class ZApiProvider implements MessagingProvider {
  readonly name = "z_api";
  readonly configured: boolean;
  readonly missing: readonly string[];

  private readonly config: ZApiConfig | null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const { config, missing } = readZApiConfig(env);
    this.config = config;
    this.configured = config !== null;
    this.missing = missing;
  }

  private endpoint(acao: string): string {
    const { instanceId, token } = this.config!;
    return `${BASE_URL}/instances/${instanceId}/token/${token}/${acao}`;
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
      this.endpoint("send-text"),
      {
        method: "POST",
        headers: {
          "Client-Token": this.config.clientToken,
          "Content-Type": "application/json",
        },
        // `phone` em DDI+DDD+número, só dígitos — o mesmo formato que
        // `toWhatsAppNumber` já produz. A Z-API não tem `preview_url`: ela
        // sempre gera prévia de link, e não há como desligar.
        body: JSON.stringify({ phone: message.to, message: message.body }),
      },
      SEND_TIMEOUT_MS,
    );

    if (!resultado.ok) {
      // Timeout e falha de rede são SEMPRE retryable — com a consequência
      // desconfortável de sempre: a mensagem pode ter saído mesmo assim.
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
      return {
        ok: false,
        // ⚠️ A Z-API NÃO TEM TAXONOMIA DE CÓDIGO DE ERRO como a Meta (131026,
        // 131047...). Ela devolve `{"error": "uma frase"}`. Sem código, a
        // decisão de insistir tem de sair do STATUS HTTP, que é o único sinal
        // estável: 429 e 5xx são "tente depois"; o resto é "não adianta".
        //
        // Isso inclui o 401/403 de credencial errada — e é o certo: repetir
        // uma chamada com token inválido não conserta o token, só enche a
        // tabela de erro repetido enquanto ninguém arruma o `.env`.
        retryable: response.status === 429 || response.status >= 500,
        code: `zapi_http_${response.status}`,
        message: extrairErro(corpo) ?? `O fornecedor respondeu ${response.status}.`,
      };
    }

    // §88. Sem id não há como marcar "enviada" com honestidade: o webhook de
    // entrega chega citando um id que não teríamos guardado.
    //
    // `messageId` e não `zaapId`: o `zaapId` é o id INTERNO da Z-API, e os
    // webhooks de status citam o id do WhatsApp em `ids`. Guardar o errado faria
    // toda confirmação de entrega cair em "esta mensagem não é nossa".
    const id = extrairMessageId(corpo);
    if (!id) {
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
   * ⚠️ A Z-API NÃO ASSINA OS WEBHOOKS. ISTO SEMPRE RECUSA, E É DE PROPÓSITO.
   *
   * A Meta manda `X-Hub-Signature-256` com o HMAC do corpo; a documentação da
   * Z-API (webhooks/introduction e security/introduction) não descreve
   * assinatura, header secreto nem campo de verificação — não existe nada no
   * que chega que prove a origem.
   *
   * A autenticação real é OUTRA e mora na rota: o segredo é um segmento do
   * CAMINHO da URL (`/api/webhooks/zapi/<segredo>`), conferido por
   * `verifyWebhookSecret` em tempo constante. Só quem cadastrou a URL no painel
   * da Z-API conhece o segredo.
   *
   * Devolver `false` aqui — em vez de `true` "porque não se aplica" — é o que
   * impede o pior desfecho possível: alguém apontar a rota genérica
   * `/api/webhooks/whatsapp` (que confia em `verifySignature`) para este
   * adaptador e criar, sem perceber, um endpoint público que aceita qualquer
   * corpo e escreve no banco.
   */
  verifySignature(_rawBody: string, _headers: Headers): SignatureCheck {
    return {
      valid: false,
      reason:
        "a Z-API não assina webhooks; a autenticação é o segredo no caminho da URL (ver ZApiProvider.verifyWebhookSecret)",
    };
  }

  /**
   * A autenticação do webhook da Z-API. Comparação em tempo constante pelo
   * mesmo motivo do §18: `===` sai no primeiro byte diferente, e o tempo até
   * sair vaza quantos bytes estavam certos.
   */
  verifyWebhookSecret(candidato: string | null | undefined): boolean {
    if (!this.config) return false;
    return safeCompare(candidato, this.config.webhookSecret);
  }

  parseWebhook(payload: unknown): InboundEvent[] {
    return parseZApiWebhook(payload);
  }
}

// ---------------------------------------------------------------------------
// Tradução do payload
// ---------------------------------------------------------------------------

/**
 * ⚠️ TUDO AQUI É `unknown` ATÉ PROVA EM CONTRÁRIO.
 *
 * O corpo vem da internet, e neste fornecedor o segredo da URL prova QUEM
 * mandou, não que o formato é o esperado. Cada campo é conferido antes de ser
 * usado; o que não bate é ignorado em silêncio, porque devolver erro faria a
 * Z-API reentregar o mesmo payload para sempre.
 *
 * ⚠️ A Z-API MANDA UM EVENTO POR REQUISIÇÃO, não um lote como a Meta. A função
 * devolve lista assim mesmo: é o contrato da porta, e uma lista de um elemento
 * não custa nada. O dia em que a Z-API agrupar, nada acima daqui muda.
 */
export function parseZApiWebhook(payload: unknown): InboundEvent[] {
  const root = asRecord(payload);
  if (!root) return [];

  switch (asString(root.type)) {
    case "ReceivedCallback":
      return parseMensagem(root);
    case "MessageStatusCallback":
      return parseStatus(root);
    case "DeliveryCallback":
      return parseEntrega(root);
    // `DisconnectedCallback`, `ConnectedCallback` e o que a Z-API inventar
    // depois: ignorados de propósito. Não são mensagem nem entrega.
    default:
      return [];
  }
}

function parseMensagem(root: Record<string, unknown>): InboundEvent[] {
  const eventId = asString(root.messageId);
  const from = asString(root.phone);
  if (!eventId || !from) return [];

  // Canal (newsletter) não é conversa: ninguém responde a um canal, e listá-lo
  // na caixa de entrada encheria a tela de coisas em que não há o que atender.
  if (root.isNewsletter === true) return [];

  const conversation: InboundConversation = {
    fromMe: root.fromMe === true,
    isGroup: root.isGroup === true,
    chatName: asString(root.chatName),
    senderName: asString(root.senderName),
    photoUrl: asString(root.senderPhoto) ?? asString(root.photo),
    participantPhone: asString(root.participantPhone),
  };

  const conteudo = extrairConteudo(root);
  if (!conteudo) return [];

  return [
    {
      kind: "message",
      eventId,
      from,
      text: conteudo.text,
      // A Z-API entrega o id da mensagem citada na raiz, e só quando existe.
      replyToMessageId: asString(root.referenceMessageId),
      timestamp: momentoParaIso(root.momment),
      conversation,
      media: conteudo.media,
    },
  ];
}

/**
 * O `MessageStatusCallback`: entrega e leitura das mensagens que NÓS mandamos.
 *
 * ⚠️ `ids` É UM ARRAY. A Z-API agrupa quando o WhatsApp confirma várias de uma
 * vez — o que acontece o tempo todo quando o celular do destinatário volta a
 * ter sinal. Ler `ids[0]` perderia todas as outras em silêncio.
 */
function parseStatus(root: Record<string, unknown>): InboundEvent[] {
  const bruto = asString(root.status);
  if (!bruto) return [];

  const traduzido = traduzirStatus(bruto);
  if (!traduzido) return [];

  const timestamp = momentoParaIso(root.momment);

  return asArray(root.ids)
    .map((id) => asString(id))
    .filter((id): id is string => id !== null)
    .map((id) => ({
      kind: "status" as const,
      // ⚠️ A chave de idempotência NÃO é o id da mensagem: a mesma mensagem
      // gera SENT, RECEIVED e READ, todos com o mesmo id. Sem o sufixo, só o
      // primeiro dos três seria processado.
      eventId: `${id}:${traduzido}`,
      providerMessageId: id,
      status: traduzido,
      errorMessage: null,
      timestamp,
    }));
}

/** O `DeliveryCallback`: a confirmação de que a mensagem saiu. */
function parseEntrega(root: Record<string, unknown>): InboundEvent[] {
  const id = asString(root.messageId);
  if (!id) return [];

  return [
    {
      kind: "status",
      eventId: `${id}:sent`,
      providerMessageId: id,
      status: "sent",
      errorMessage: null,
      timestamp: momentoParaIso(root.momment),
    },
  ];
}

function traduzirStatus(bruto: string): "sent" | "delivered" | "read" | "failed" | null {
  switch (bruto.toUpperCase()) {
    case "SENT":
      return "sent";
    // "RECEIVED" da Z-API = chegou no aparelho do destinatário. No vocabulário
    // da porta isso é `delivered` — "received" ali significaria outra coisa.
    case "RECEIVED":
      return "delivered";
    // Áudio ouvido é áudio lido: não há degrau acima de "leu" na escala.
    case "READ":
    case "PLAYED":
      return "read";
    // "READ_BY_ME" é NÓS lendo a mensagem da pessoa, não ela lendo a nossa.
    // Traduzi-lo marcaria a mensagem errada como lida — a que a pessoa mandou.
    case "READ_BY_ME":
      return null;
    default:
      return null;
  }
}

interface Conteudo {
  text: string;
  media: InboundMedia | null;
}

/**
 * O que a pessoa mandou. Cada tipo mora numa chave própria do payload, com
 * nomes de campo diferentes por tipo (`imageUrl`, `audioUrl`, `documentUrl`...)
 * — a Z-API não uniformizou isso, então a tradução é caso a caso.
 */
function extrairConteudo(root: Record<string, unknown>): Conteudo | null {
  const texto = asRecord(root.text);
  if (texto) {
    const message = asString(texto.message);
    // Texto vazio não é mensagem: é ruído de um tipo que não reconhecemos
    // chegando embrulhado como texto.
    return message ? { text: message, media: null } : null;
  }

  const midia =
    extrairMidia(root.image, "image", "imageUrl") ??
    extrairMidia(root.audio, "audio", "audioUrl") ??
    extrairMidia(root.video, "video", "videoUrl") ??
    extrairMidia(root.document, "document", "documentUrl") ??
    extrairMidia(root.sticker, "sticker", "stickerUrl");

  if (midia) return midia;

  // Localização e contato não têm arquivo para baixar, mas têm o que MOSTRAR —
  // e uma linha em branco no meio da conversa faria o atendente achar que
  // perdeu alguma coisa.
  const local = asRecord(root.location);
  if (local) {
    const endereco = asString(local.address);
    const lat = asNumber(local.latitude);
    const lon = asNumber(local.longitude);
    const coordenadas = lat !== null && lon !== null ? `${lat}, ${lon}` : null;
    return { text: endereco ?? coordenadas ?? "Localização", media: null };
  }

  const contato = asRecord(root.contact);
  if (contato) {
    const nome = asString(contato.displayName);
    const telefone = asString(asArray(contato.phones)[0]);
    return {
      text: [nome, telefone].filter(Boolean).join(" — ") || "Contato",
      media: null,
    };
  }

  // Tipo desconhecido: registra que ALGO chegou. Ver `whatsapp_message_kind`.
  return { text: "", media: null };
}

function extrairMidia(bloco: unknown, kind: InboundMediaKind, chaveUrl: string): Conteudo | null {
  const m = asRecord(bloco);
  if (!m) return null;

  const url = asString(m[chaveUrl]);
  if (!url) {
    // ⚠️ Anexo SEM url acontece: a Z-API manda `downloadError` quando não
    // conseguiu baixar do WhatsApp. Sem este caminho a mensagem sumiria da
    // conversa, que é o pior desfecho — o atendente veria a legenda de uma
    // foto que nunca existiu.
    return { text: asString(m.caption) ?? "", media: null };
  }

  return {
    text: asString(m.caption) ?? "",
    media: {
      kind,
      url,
      mimeType: asString(m.mimeType),
      fileName: asString(m.fileName) ?? asString(m.title),
      durationSeconds: asNumber(m.seconds),
    },
  };
}

/**
 * `momment` da Z-API é epoch em MILISSEGUNDOS (1632228638000) — a Meta usa
 * SEGUNDOS. Confundir os dois joga toda a caixa de entrada para o ano 54000 ou
 * para 1970, e nos dois casos a ordem das conversas fica embaralhada.
 */
function momentoParaIso(value: unknown): string | null {
  const n = asNumber(value);
  if (n === null || n <= 0) return null;
  const data = new Date(n);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

function extrairErro(corpo: unknown): string | null {
  const r = asRecord(corpo);
  if (!r) return null;
  return asString(r.error) ?? asString(r.message) ?? null;
}

function extrairMessageId(corpo: unknown): string | null {
  const r = asRecord(corpo);
  if (!r) return null;
  return asString(r.messageId) ?? asString(r.id) ?? asString(r.zaapId);
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

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // A Z-API manda número como string em alguns campos (`unread: "0"`).
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
