import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  CHAT_CONTACT_CHANNELS,
  CHAT_CONTACT_PROFILES,
  CHAT_CONTACT_TIMES,
  CHAT_INTENTS,
  CSP_INTERESTS,
  CSP_VOLUME_RANGES,
  type ChatMessage,
  type ChatTurnAnalysis,
  type CspCollected,
} from "@/modules/chat/chat.types";
import { parseTurnAnalysis } from "@/modules/chat/chat.schema";
import { envOrFallback } from "@/lib/chat/env";
import { HISTORY_LIMIT } from "@/lib/chat/rate-limit";
import { CSP_CONTENT } from "@/modules/chat/flows/csp.content";

/**
 * Camada de IA do chat.
 *
 * O modelo tem UM trabalho: ler o que a pessoa escreveu e devolver
 * (a) os dados de triagem que ela informou e (b) a intenção do turno.
 * Ele NUNCA escreve texto para o usuário — quem escolhe a mensagem é o motor,
 * a partir do catálogo aprovado. Ver `src/modules/chat/flows/csp.content.ts`.
 *
 * Consequência prática: qualquer falha aqui (erro de API, recusa do modelo,
 * JSON inválido) degrada para uma mensagem aprovada, nunca para texto solto.
 */

/**
 * Modelo padrão: o mais capaz da Anthropic, para extração confiável em PT-BR
 * informal. Configurável por env para o time poder trocar por um mais barato
 * depois de medir a qualidade da extração no uso real — sem mexer em código.
 */
const MODEL = envOrFallback(process.env.APCS_CHAT_MODEL, "claude-opus-5");

export interface LlmMeta {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  latencyMs: number;
}

export type LlmTurnResult =
  | { ok: true; analysis: ChatTurnAnalysis; meta: LlmMeta }
  | { ok: false; reason: "refusal" | "unavailable" };

/**
 * Schema da resposta (structured outputs). Escrito à mão em JSON Schema — e
 * não gerado do Zod — porque o helper do SDK exige `zod/v4` e o projeto usa a
 * API clássica do Zod. O `chatTurnAnalysisSchema` valida a saída depois, então
 * temos as duas barreiras.
 */
const ANALYSIS_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "slots"],
  properties: {
    intent: { type: "string", enum: [...CHAT_INTENTS] },
    slots: {
      type: "object",
      additionalProperties: false,
      properties: {
        fullName: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        contactProfile: { type: "string", enum: [...CHAT_CONTACT_PROFILES] },
        interest: { type: "string", enum: [...CSP_INTERESTS] },
        volumeRange: { type: "string", enum: [...CSP_VOLUME_RANGES] },
        preferredChannel: { type: "string", enum: [...CHAT_CONTACT_CHANNELS] },
        phone: { type: "string" },
        email: { type: "string" },
        preferredTime: { type: "string", enum: [...CHAT_CONTACT_TIMES] },
      },
      required: [],
    },
  },
};

/**
 * Prefixo estável do prompt: regras + conteúdo aprovado. Fica em `cache_control`
 * para os turnos seguintes lerem do cache (bem mais barato que reprocessar).
 * Qualquer variável (estado da triagem) vai no bloco seguinte, nunca aqui.
 */
const STATIC_SYSTEM_PROMPT = `Você é o componente de INTERPRETAÇÃO do atendimento da APCS (Associação Paulista de Criadores de Suínos). O fluxo em questão é o CSP — programa de compras coletivas.

SEU PAPEL
Você NÃO conversa com o usuário e NÃO escreve nenhuma mensagem para ele. Outro componente, determinístico, escolhe o texto que será enviado a partir de um catálogo aprovado. Você apenas lê a última mensagem da pessoa e devolve um JSON com:
1. os dados de triagem que ela informou explicitamente;
2. a intenção do turno.

REGRA DE OURO DA EXTRAÇÃO
Só extraia o que a pessoa disse de forma explícita. Nunca deduza, complete ou invente. Se ela não informou um campo, omita esse campo. É melhor deixar em branco e o bot perguntar de novo do que registrar um dado errado.

INTENÇÕES (escolha exatamente uma)
- "answering": respondeu a uma pergunta da triagem ou forneceu dados seus.
- "asking_about_csp": quer saber o que é o CSP, como funciona, como participar.
- "out_of_scope": pediu informação que NÃO está no conteúdo aprovado abaixo (preços, cotações, prazos específicos, assuntos de outros programas, qualquer coisa fora do CSP).
- "wants_human": pediu para falar com uma pessoa/atendente da APCS.
- "consent_accept": autorizou o uso dos dados dele.
- "consent_decline": recusou o uso dos dados.
- "unclear": não deu para entender a mensagem.

Se a pessoa responder a triagem E pedir algo fora do escopo na mesma mensagem, extraia os dados e use "out_of_scope".

CAMPOS DA TRIAGEM
- fullName: nome da pessoa, como ela escreveu.
- city: nome da cidade.
- state: sigla da UF com 2 letras (ex.: "SP"). Se ela disser o nome do estado por extenso, converta para a sigla.
- contactProfile: "producer" (produtor), "member" (associado), "supplier" (fornecedor).
- interest: "input" (insumo), "feed" (ração), "logistics" (logística), "information" (só quer informação).
- volumeRange: porte da granja — "up_to_50" (até 50 matrizes), "from_50_to_200", "from_200_to_1000", "above_1000", "not_applicable" (não tem granja). Converta números soltos para a faixa correspondente: "tenho 300 matrizes" → "from_200_to_1000".
- preferredChannel: "whatsapp", "phone" (telefone/ligação), "email".
- phone: telefone com DDD, só os dígitos.
- email: e-mail.
- preferredTime: "morning" (manhã), "afternoon" (tarde), "evening" (fim do dia/noite), "any" (qualquer horário).

CONTEÚDO APROVADO (é o limite do que a APCS pode responder neste canal)
${CSP_CONTENT.cspIntro}

Qualquer pedido que não seja respondido por esse conteúdo — ou que não seja parte da triagem — é "out_of_scope".`;

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY não configurada no .env.local.");
    }
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

/** Só para os testes trocarem o cliente por um dublê. */
export function setLlmClientForTests(client: Anthropic | null): void {
  cachedClient = client;
}

function buildStateBlock(collected: CspCollected, consentGiven: boolean): string {
  const filled = Object.entries(collected)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `- ${key}: ${String(value)}`);

  return [
    `ESTADO DA CONVERSA`,
    `Consentimento LGPD: ${consentGiven ? "já concedido" : "AINDA NÃO concedido"}`,
    filled.length > 0 ? `Já registrado:\n${filled.join("\n")}` : `Nada registrado ainda.`,
    consentGiven
      ? ""
      : `Enquanto o consentimento não for concedido, a pergunta pendente é justamente a autorização — classifique "consent_accept"/"consent_decline" quando a resposta for sobre isso.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function toApiMessages(history: ChatMessage[], userMessage: string): Anthropic.MessageParam[] {
  const recent = history.slice(-HISTORY_LIMIT);
  const messages: Anthropic.MessageParam[] = recent.map((m) => ({
    role: m.role === "user" ? ("user" as const) : ("assistant" as const),
    content: m.content,
  }));
  messages.push({ role: "user", content: userMessage });

  // A API exige que a conversa comece com `user`.
  while (messages.length > 0 && messages[0]?.role === "assistant") {
    messages.shift();
  }
  return messages;
}

function extractJsonText(message: Anthropic.Message): string | null {
  for (const block of message.content) {
    if (block.type === "text") return block.text;
  }
  return null;
}

/**
 * Analisa um turno. Nunca lança: qualquer problema vira `ok: false` e o motor
 * responde com uma mensagem aprovada.
 */
export async function analyzeTurn(params: {
  history: ChatMessage[];
  userMessage: string;
  collected: CspCollected;
  consentGiven: boolean;
}): Promise<LlmTurnResult> {
  const startedAt = Date.now();

  let message: Anthropic.Message;
  try {
    message = await getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: STATIC_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: buildStateBlock(params.collected, params.consentGiven),
        },
      ],
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: ANALYSIS_JSON_SCHEMA },
      },
      messages: toApiMessages(params.history, params.userMessage),
    });
  } catch (error) {
    console.error(
      `[chat.llm] chamada falhou: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, reason: "unavailable" };
  }

  // Classificadores de segurança podem recusar antes de qualquer saída — checar
  // ANTES de ler `content`, que pode estar vazio.
  if (message.stop_reason === "refusal") {
    console.warn(
      `[chat.llm] recusa do modelo (${message.stop_details?.category ?? "sem categoria"})`,
    );
    return { ok: false, reason: "refusal" };
  }

  const text = extractJsonText(message);
  if (!text) {
    console.error("[chat.llm] resposta sem bloco de texto");
    return { ok: false, reason: "unavailable" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    console.error("[chat.llm] resposta não é JSON válido");
    return { ok: false, reason: "unavailable" };
  }

  // Segunda barreira: mesmo com structured outputs, validamos campo a campo.
  // Campos inválidos (UF inexistente, telefone curto) são descartados — o bot
  // simplesmente pergunta de novo.
  const analysis = parseTurnAnalysis(raw);
  if (!analysis) {
    console.error("[chat.llm] saída fora do contrato");
    return { ok: false, reason: "unavailable" };
  }

  return {
    ok: true,
    analysis,
    meta: {
      model: message.model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
    },
  };
}
