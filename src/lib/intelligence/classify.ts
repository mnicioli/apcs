import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { envOrFallback } from "@/lib/chat/env";
import { intentCatalogue } from "@/modules/intelligence/intent.registry";
import {
  APCS_INTENTS,
  isIntentName,
  type IntentAnalysis,
} from "@/modules/intelligence/intent.types";

/**
 * A CAMADA DE INTERPRETAÇÃO — e o contrato dela é minúsculo de propósito.
 *
 * O modelo tem UM trabalho: ler a mensagem e devolver `{ intent, confidence,
 * subject }`. Ele NUNCA escreve texto para o associado; quem escolhe a resposta
 * é o roteador (determinístico) a partir do que o CRM publicou.
 *
 * ⚠️ É EXATAMENTE O DESENHO DE `src/lib/chat/llm.ts`, e não por gosto de
 * simetria: é a única forma de o §2 do escopo ("a IA interpreta, o CRM
 * responde") ser uma propriedade do código e não uma intenção. Qualquer falha
 * aqui — erro de API, recusa do modelo, JSON inválido — degrada para uma
 * mensagem que a APCS escreveu, nunca para texto solto.
 *
 * ⚠️ E ELE NÃO CONHECE O CATÁLOGO. O modelo não sabe quais normativas existem,
 * quais boletins estão ativos, nem que "ISP" é um comunicado. Ele devolve o
 * termo que a pessoa usou; quem resolve o termo é a FERRAMENTA, que consulta o
 * CRM. Mandar o catálogo no prompt seria dar ao modelo a chance de citar um
 * documento que não está publicado — que é o §47 inteiro.
 */

/**
 * Modelo padrão: o mesmo do chat da web, e configurável por env pelo mesmo
 * motivo — dá para trocar por um mais barato depois de medir a qualidade da
 * classificação no uso real, sem mexer em código.
 */
const MODEL = envOrFallback(process.env.APCS_INTELLIGENCE_MODEL, "claude-opus-5");

/** Teto de mensagens anteriores enviadas como contexto ao modelo. */
const HISTORY_LIMIT = 6;

export interface ClassifyMeta {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export type ClassifyResult =
  | { ok: true; analysis: IntentAnalysis; meta: ClassifyMeta }
  | { ok: false; reason: "refusal" | "unavailable" };

/** Uma fala anterior, para o modelo entender uma frase sem verbo. */
export interface ClassifyHistoryItem {
  role: "user" | "bot";
  content: string;
}

/**
 * Schema da resposta (structured outputs). Escrito à mão em JSON Schema — e não
 * gerado do Zod — pelo mesmo motivo de `chat/llm.ts`: o helper do SDK exige
 * `zod/v4` e o projeto usa a API clássica.
 */
const ANALYSIS_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "confidence"],
  properties: {
    intent: { type: "string", enum: [...APCS_INTENTS] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    subject: { type: "string" },
  },
};

/**
 * ⚠️ O PROMPT DESCREVE AS INTENÇÕES A PARTIR DO REGISTRO, e não de uma lista
 * escrita à mão aqui. Uma intenção acrescentada em `intent.registry.ts` passa a
 * ser reconhecível sem ninguém lembrar de editar este arquivo — que é
 * literalmente o §11 do escopo.
 */
function buildSystemPrompt(): string {
  const catalogo = intentCatalogue()
    .map(({ intent, label }) => `- "${intent}": ${label}`)
    .join("\n");

  return `Você é o componente de INTERPRETAÇÃO do atendimento da APCS (Associação Paulista de Criadores de Suínos), que atende produtores, associados, técnicos e fornecedores.

SEU PAPEL
Você NÃO conversa com a pessoa e NÃO escreve nenhuma mensagem para ela. Outro componente, determinístico, escolhe a resposta a partir do que a APCS publicou no sistema. Você apenas lê a última mensagem e devolve um JSON.

INTENÇÕES (escolha exatamente uma)
${catalogo}

O QUE CADA UMA SIGNIFICA
- "saudacao": cumprimentou, se apresentou, abriu conversa ("oi", "bom dia").
- "consultar_bolsa": quer preço, cotação ou o boletim da Bolsa de Suínos.
- "consultar_normativa": quer uma normativa/regulamento da APCS (Câmara Ambiental, Câmara Setorial, Selo Suíno Paulista).
- "consultar_comunicacao": quer material de comunicação — ISP, revista, calendário anual, custo de produção.
- "consultar_evento": quer saber o que a APCS tem marcado.
- "solicitar_palestra": quer PEDIR uma palestra da APCS em algum lugar.
- "participar_enquete": quer responder, ou está respondendo, uma enquete.
- "falar_com_atendente": pediu para falar com uma pessoa.
- "consultar_conhecimento": pergunta institucional — horário, endereço, telefone, como funciona um processo, o que a associação faz.
- "ajuda": perguntou o que você sabe fazer.
- "desconhecido": não deu para entender, ou é assunto fora da APCS.

CONFIANÇA (0 a 1) — É O CAMPO MAIS IMPORTANTE
Ela decide se o sistema AGE, PERGUNTA ANTES ou pede para reformular. Seja honesto, e prefira errar para baixo.
- 0.9 ou mais: a mensagem diz claramente o que a pessoa quer ("me manda a bolsa de hoje").
- 0.5 a 0.75: dá para supor, e a frase admite outra leitura. Exemplo: "quero saber o valor" — pode ser a Bolsa, pode ser a anuidade. Use esta faixa.
- abaixo de 0.45: você está adivinhando.

Nunca use confiança alta só porque escolheu uma intenção. Escolher é obrigatório; ter certeza não é.

SUBJECT
O termo que a PESSOA usou para dizer de que está falando — o nome da normativa, a categoria do comunicado, a cidade da palestra. Copie como ela escreveu.
- NÃO traduza, NÃO corrija, NÃO complete.
- Se ela não citou nada específico, omita o campo.
- Você NÃO conhece o catálogo da APCS. Não invente nome de documento e não tente adivinhar qual é o "certo": quem resolve isso é o sistema, consultando o que está publicado.

FRASES SEM VERBO
Se a mensagem for uma continuação ("e a Câmara Setorial?", "e a outra?"), use "desconhecido" com o subject preenchido. O sistema sabe recuperar a intenção anterior — e sabe que precisa confirmar antes de agir. Não chute a intenção nesse caso.`;
}

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
export function setClassifyClientForTests(client: Anthropic | null): void {
  cachedClient = client;
}

function toApiMessages(
  history: readonly ClassifyHistoryItem[],
  userMessage: string,
): Anthropic.MessageParam[] {
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

/**
 * Classifica uma mensagem. NUNCA lança: qualquer problema vira `ok: false` e o
 * roteador responde com uma frase que a APCS escreveu.
 */
export async function classifyMessage(params: {
  message: string;
  history?: readonly ClassifyHistoryItem[];
}): Promise<ClassifyResult> {
  const startedAt = Date.now();

  let message: Anthropic.Message;
  try {
    message = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: buildSystemPrompt(),
          // Prefixo estável: os turnos seguintes leem do cache, que é bem mais
          // barato que reprocessar. Nada variável entra neste bloco.
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: ANALYSIS_JSON_SCHEMA },
      },
      messages: toApiMessages(params.history ?? [], params.message),
    });
  } catch (error) {
    console.error(
      `[intelligence.classify] chamada falhou: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, reason: "unavailable" };
  }

  // Classificadores de segurança podem recusar antes de qualquer saída — checar
  // ANTES de ler `content`, que pode estar vazio.
  if (message.stop_reason === "refusal") {
    console.warn(
      `[intelligence.classify] recusa do modelo (${message.stop_details?.category ?? "sem categoria"})`,
    );
    return { ok: false, reason: "refusal" };
  }

  const texto = message.content.find((bloco) => bloco.type === "text");
  if (!texto || texto.type !== "text") {
    console.error("[intelligence.classify] resposta sem bloco de texto");
    return { ok: false, reason: "unavailable" };
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(texto.text);
  } catch {
    console.error("[intelligence.classify] resposta não é JSON válido");
    return { ok: false, reason: "unavailable" };
  }

  const analysis = parseAnalysis(bruto);
  if (!analysis) {
    console.error("[intelligence.classify] saída fora do contrato");
    return { ok: false, reason: "unavailable" };
  }

  return {
    ok: true,
    analysis,
    meta: {
      model: message.model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      latencyMs: Date.now() - startedAt,
    },
  };
}
