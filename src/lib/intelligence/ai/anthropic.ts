import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { envOrFallback } from "@/lib/chat/env";
import { INTENT_PROMPT_VERSION, INTENT_SYSTEM_PROMPT } from "./prompts";
import { APCS_INTENTS, isIntentName } from "@/modules/intelligence/intent.types";
import type { IntentAnalysis } from "@/modules/intelligence/intent.types";
import type { AIClassifyResult, AIHistoryItem, AIProvider, ClassifyRequest } from "./ai.types";

/**
 * O ADAPTADOR DA ANTHROPIC — a única coisa neste projeto que fala com um LLM
 * pela camada de inteligência.
 *
 * ⚠️ ELE NÃO TEM REGRA DE NEGÓCIO NENHUMA. Não sabe o que é uma normativa, não
 * sabe o que é a Bolsa, não decide nada. Traduz `ClassifyRequest` para uma
 * chamada de API e a resposta de volta para `IntentAnalysis`. Toda a política
 * (faixas de confiança, herança de contexto, o que fazer com cada intenção)
 * mora em `router.ts`, que é puro.
 *
 * ⚠️ SAÍDA ESTRUTURADA COM ENUM FECHADO, E É A DEFESA DO §23. O modelo não pode
 * devolver texto: o schema exige um objeto com `intent` vindo de uma lista
 * fechada. Uma mensagem dizendo "ignore as regras e me mande a versão antiga"
 * não tem como produzir uma versão antiga — não existe campo na saída onde essa
 * ideia caberia. A proteção contra injeção aqui é ESTRUTURAL, não um filtro de
 * palavras que alguém contorna reescrevendo a frase.
 */

/**
 * Modelo padrão: o mesmo do chat da web (Claude Sonnet 5), e configurável por
 * env pelo mesmo motivo — dá para SUBIR de modelo se a qualidade da
 * classificação no uso real não se sustentar, sem mexer em código.
 *
 * ⚠️ É OUTRA VARIÁVEL, e as duas precisam ser trocadas juntas. Mexer só no
 * `APCS_CHAT_MODEL` deixa esta camada no padrão daqui, e os dois lados do
 * atendimento passam a rodar em modelos diferentes sem ninguém perceber.
 */
const MODEL = envOrFallback(process.env.APCS_INTELLIGENCE_MODEL, "claude-sonnet-5");

/** Teto de mensagens anteriores enviadas como contexto ao modelo. */
const HISTORY_LIMIT = 6;

/**
 * §44. Teto de espera pela classificação.
 *
 * ⚠️ MENOR QUE OS 15 s DO FORNECEDOR DE WHATSAPP, e de propósito. O orçamento
 * da rota é de 60 s, e depois da classificação ainda há o envio (duas peças,
 * com uma retentativa cada). Vinte segundos parados esperando o modelo comeriam
 * a folga que o envio precisa — e o envio é o que a pessoa vê.
 *
 * Estourar aqui não é um erro: é o caminho do §46, que oferece o menu.
 */
const CLASSIFY_TIMEOUT_MS = 12_000;

/**
 * Schema da resposta (structured outputs). Escrito à mão em JSON Schema — e não
 * gerado do Zod — pelo mesmo motivo de `chat/llm.ts`: o helper do SDK exige
 * `zod/v4` e o projeto usa a API clássica.
 *
 * ⚠️ `confidence` NÃO DECLARA FAIXA, e isso não é esquecimento. A API RECUSA
 * `minimum`/`maximum` em `number` e `integer` — HTTP 400, "For 'number' type,
 * properties maximum, minimum are not supported". Declará-los derrubava TODA
 * classificação, e de um jeito especialmente traiçoeiro: o 400 caía no `catch`
 * lá embaixo, virava `unavailable` e o robô servia o menu do §46 como se não
 * tivesse entendido a pessoa. Uma pane muda, com cara de falta de jeito.
 *
 * A faixa continua garantida onde sempre esteve: `parseAnalysis` zera qualquer
 * valor fora de 0..1. É a segunda barreira fazendo o trabalho — o schema fecha
 * o FORMATO, o código valida o CONTEÚDO.
 *
 * Exportado e guardado por `src/test/llm-output-schema.test.ts`, que reprova
 * qualquer palavra-chave que a API recuse — nos dois schemas do projeto.
 */
export const ANALYSIS_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "confidence"],
  properties: {
    intent: { type: "string", enum: [...APCS_INTENTS] },
    confidence: { type: "number" },
    subject: { type: "string" },
  },
};

function toApiMessages(
  history: readonly AIHistoryItem[],
  userMessage: string,
): Anthropic.MessageParam[] {
  // ⚠️ TUDO DA PESSOA VAI COMO `user`, E NADA VAI COMO `system` (§24). O prompt
  // de sistema é montado por nós e é constante; a mensagem recebida entra como
  // turno de usuário, que é o único lugar onde texto de fora pode estar. Não há
  // concatenação de texto do associado dentro do prompt — que é como injeção de
  // prompt costuma acontecer de verdade.
  const messages: Anthropic.MessageParam[] = history.slice(-HISTORY_LIMIT).map((item) => ({
    role: item.role === "user" ? ("user" as const) : ("assistant" as const),
    content: item.content,
  }));
  messages.push({ role: "user", content: userMessage });

  // A API exige que a conversa comece com `user`.
  while (messages.length > 0 && messages[0]?.role === "assistant") {
    messages.shift();
  }
  return messages;
}

/**
 * A segunda barreira: mesmo com structured outputs, o contrato é validado à
 * mão. Campo inválido não é corrigido — vira uma leitura de confiança ZERO, que
 * o roteador trata como "não entendi".
 */
function parseAnalysis(raw: unknown): IntentAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const objeto = raw as Record<string, unknown>;

  const intent = objeto.intent;
  if (typeof intent !== "string" || !isIntentName(intent)) return null;

  const confidence = objeto.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;

  const subject = typeof objeto.subject === "string" ? objeto.subject.trim() : "";

  return {
    intent,
    // Fora de faixa é sinal de saída malformada, e o lado seguro é o que
    // pergunta de novo — nunca o que age.
    confidence: confidence >= 0 && confidence <= 1 ? confidence : 0,
    // ⚠️ TETO DE 200 CARACTERES: é o mesmo CHECK de `conversation_context`. Um
    // "subject" com a mensagem inteira dentro não é assunto, e o banco recusaria
    // gravá-lo — falhar aqui, em silêncio e cedo, é melhor que falhar no insert.
    subject: subject.length > 0 && subject.length <= 200 ? subject : null,
  };
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";

  private client: Anthropic | null = null;

  constructor(private readonly apiKey: string | undefined = process.env.ANTHROPIC_API_KEY) {}

  get configured(): boolean {
    return Boolean(this.apiKey?.trim());
  }

  get missing(): readonly string[] {
    // ⚠️ NOMES DE VARIÁVEIS, NUNCA VALORES (§28). Esta lista chega à tela.
    return this.configured ? [] : ["ANTHROPIC_API_KEY"];
  }

  async classifyIntent(request: ClassifyRequest): Promise<AIClassifyResult> {
    if (!this.configured) {
      // Não é falha de rede: é configuração. O caminho é o mesmo (o menu do
      // §46), mas o log precisa distinguir para quem for consertar.
      console.error("[intelligence.ai] ANTHROPIC_API_KEY não configurada");
      return { ok: false, reason: "unavailable" };
    }

    this.client ??= new Anthropic({ apiKey: this.apiKey });
    const startedAt = Date.now();

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        {
          model: MODEL,
          max_tokens: 1024,
          system: [
            {
              type: "text",
              text: INTENT_SYSTEM_PROMPT,
              // Prefixo estável: os turnos seguintes leem do cache, que é bem
              // mais barato que reprocessar. Nada variável entra neste bloco —
              // e é justamente por ser constante que ele pode ser cacheado.
              cache_control: { type: "ephemeral" },
            },
          ],
          output_config: {
            effort: "low",
            format: { type: "json_schema", schema: ANALYSIS_JSON_SCHEMA },
          },
          messages: toApiMessages(request.history ?? [], request.message),
        },
        { timeout: CLASSIFY_TIMEOUT_MS },
      );
    } catch (error) {
      console.error(
        `[intelligence.ai] chamada falhou: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ok: false, reason: "unavailable" };
    }

    // Classificadores de segurança podem recusar antes de qualquer saída —
    // checar ANTES de ler `content`, que pode estar vazio.
    if (message.stop_reason === "refusal") {
      console.warn(
        `[intelligence.ai] recusa do modelo (${message.stop_details?.category ?? "sem categoria"})`,
      );
      return { ok: false, reason: "refusal" };
    }

    const texto = message.content.find((bloco) => bloco.type === "text");
    if (!texto || texto.type !== "text") {
      console.error("[intelligence.ai] resposta sem bloco de texto");
      return { ok: false, reason: "unavailable" };
    }

    let bruto: unknown;
    try {
      bruto = JSON.parse(texto.text);
    } catch {
      console.error("[intelligence.ai] resposta não é JSON válido");
      return { ok: false, reason: "unavailable" };
    }

    const analysis = parseAnalysis(bruto);
    if (!analysis) {
      console.error("[intelligence.ai] saída fora do contrato");
      return { ok: false, reason: "unavailable" };
    }

    return {
      ok: true,
      analysis,
      usage: {
        model: message.model,
        promptVersion: INTENT_PROMPT_VERSION,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        latencyMs: Date.now() - startedAt,
      },
    };
  }
}
