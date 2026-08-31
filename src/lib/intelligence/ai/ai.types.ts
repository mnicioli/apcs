import type { IntentAnalysis } from "@/modules/intelligence/intent.types";

/**
 * §79. A PORTA DA IA — o contrato do meio.
 *
 *     Intelligence  →  AIProvider  →  Anthropic / outro
 *
 * Nada acima desta linha sabe o nome do fornecedor, o formato do payload, o
 * nome do parâmetro de temperatura ou como se pede saída estruturada. É a mesma
 * separação que `MessagingProvider` fez para o WhatsApp — e ali ela já provou
 * o valor: acrescentar a Z-API ao lado da Cloud API foi um arquivo novo e um
 * `case` no registro, sem tocar em worker, webhook ou tela.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ SÓ UMA OPERAÇÃO, E AS OUTRAS DUAS NÃO EXISTEM DE PROPÓSITO
 * ----------------------------------------------------------------------------
 * O §79 sugere `classifyIntent()`, `extractEntities()` e `generateResponse()`.
 * Aqui há uma:
 *
 *   `extractEntities` NÃO É UMA SEGUNDA CHAMADA. O assunto (`subject`) volta
 *   junto da classificação, no mesmo JSON. Separá-lo seria uma segunda ida ao
 *   modelo — o dobro do custo e da latência — para dividir uma leitura que é
 *   uma só: "o que a pessoa quer, e sobre o quê".
 *
 *   `generateResponse` NÃO EXISTE, E É A DECISÃO CENTRAL DESTE MÓDULO. O §92
 *   diz que a IA não é a fonte da verdade. A forma de isso ser uma propriedade
 *   do código, e não uma promessa, é o modelo não ter caminho nenhum para
 *   escrever texto ao associado. Toda frase sai de `app_settings` ou do próprio
 *   conteúdo publicado no CRM.
 *
 *   Acrescentar `generateResponse` a esta interface seria abrir esse caminho —
 *   e a partir daí a garantia passa a depender de ninguém chamá-lo.
 */

/** Uma fala anterior, para o modelo entender uma frase sem verbo. */
export interface AIHistoryItem {
  role: "user" | "bot";
  content: string;
}

export interface ClassifyRequest {
  /** A mensagem do associado. ⚠️ TEXTO NÃO CONFIÁVEL (§24). */
  message: string;
  history?: readonly AIHistoryItem[];
}

/**
 * §80. O que a chamada custou.
 *
 * ⚠️ VIAJA COM O RESULTADO, e não num contador global. Custo agregado responde
 * "gastamos quanto"; custo por turno responde "gastamos quanto NAQUELE turno em
 * que o robô errou" — e é a segunda pergunta que se faz quando alguém reclama.
 */
export interface AIUsage {
  /** O modelo que de fato respondeu (pode diferir do pedido). */
  model: string;
  /** §78. Qual versão do prompt de sistema estava valendo. */
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/**
 * ⚠️ `refusal` E `unavailable` SÃO DIFERENTES, e os dois viram a mesma resposta
 * ao associado — mas não a mesma linha no log.
 *
 * `unavailable` é infraestrutura: rede, cota, fornecedor fora do ar. Alguém
 * precisa olhar o serviço.
 *
 * `refusal` é o classificador de segurança do fornecedor recusando a mensagem.
 * Isso quase sempre significa que alguém escreveu algo hostil ou ofensivo para
 * o número da APCS — e é informação para quem atende, não para quem opera.
 */
export type AIClassifyResult =
  | { ok: true; analysis: IntentAnalysis; usage: AIUsage }
  | { ok: false; reason: "refusal" | "unavailable" };

/**
 * O adaptador de um fornecedor de IA.
 *
 * ⚠️ `configured` existe pelo mesmo motivo que em `MessagingProvider`: "sem
 * chave de API" precisa ser um ESTADO VISÍVEL, e não uma exceção surpresa no
 * meio de um atendimento. Quem chama consulta antes e cai no menu do §46.
 */
export interface AIProvider {
  readonly name: string;
  readonly configured: boolean;
  /** O que falta para configurar. NOMES de variáveis, nunca valores (§28). */
  readonly missing: readonly string[];

  /**
   * Lê a mensagem e devolve `{ intent, confidence, subject }`.
   *
   * ⚠️ NUNCA LANÇA. Qualquer problema vira `ok: false`, e o roteador responde
   * com uma frase que a APCS escreveu. Uma exceção aqui subiria até o webhook,
   * viraria 500, e o fornecedor de WhatsApp reentregaria o payload em laço.
   */
  classifyIntent(request: ClassifyRequest): Promise<AIClassifyResult>;
}
