/**
 * AS INTENÇÕES QUE A APCS ATENDE — e o contrato do que o modelo pode devolver.
 *
 * ⚠️ ISTO NÃO SUBSTITUI `CHAT_INTENTS` (`src/modules/chat/chat.types.ts`), e as
 * duas listas não são a mesma coisa. Aquelas são as sete intenções DO FLUXO CSP
 * — "respondeu a triagem", "aceitou o consentimento" —, que só fazem sentido
 * dentro daquele roteiro. Estas são as intenções DO DOMÍNIO: o que um associado
 * quer da associação. Unificar as duas listas faria o classificador do CSP
 * passar a poder devolver "consultar bolsa" no meio de uma triagem.
 */

export const APCS_INTENTS = [
  "saudacao",
  "consultar_bolsa",
  "consultar_normativa",
  "consultar_comunicacao",
  "consultar_evento",
  "solicitar_palestra",
  "participar_enquete",
  "falar_com_atendente",
  "consultar_conhecimento",
  "ajuda",
  "desconhecido",
] as const;

export type IntentName = (typeof APCS_INTENTS)[number];

export function isIntentName(value: string): value is IntentName {
  return (APCS_INTENTS as readonly string[]).includes(value);
}

/**
 * As ferramentas. Cada uma consulta um serviço de domínio — NUNCA o banco
 * direto, e nunca um SQL montado pelo modelo (§14 do escopo).
 *
 * ⚠️ TODAS AS CINCO SÓ LEEM, E A LINHA É DELIBERADA.
 *
 * Solicitar palestra e responder enquete existem como PORTAS prontas
 * (`lecture-chatbot.ts::createLectureRequest`,
 * `survey-chatbot.ts::registerSurveyResponse`) e não estão aqui, porque as duas
 * precisam de algo que um roteador não faz: COLETAR CAMPOS AO LONGO DE VÁRIOS
 * TURNOS. Uma solicitação de palestra pede nome, cidade e contato; uma resposta
 * de enquete pertence a uma pergunta específica já enviada.
 *
 * Isso é um ROTEIRO, e o projeto já tem um motor de roteiro — `csp.flow.ts`,
 * com slots, ordem e retomada. Ligar as duas é escrever o roteiro delas, não
 * espremê-las numa ferramenta de um turno só. Enquanto isso, as duas intenções
 * chamam uma pessoa (`handoff`), que é a resposta honesta: alguém da APCS
 * consegue abrir a solicitação.
 */
export const TOOL_NAMES = [
  "getActiveBolsa",
  "getActiveNormativa",
  "getActiveComunicacao",
  "getActiveEvents",
  "getKnowledge",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/* -------------------------------------------------------------------------- */
/* Confiança (§23)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ TRÊS FAIXAS, E A DO MEIO É A QUE EVITA O ERRO CARO.
 *
 *   ≥ ALTA      executa direto
 *   ≥ MEDIA     confirma antes ("Você quer a Bolsa de Suínos?")
 *   abaixo      pede para reformular
 *
 * A faixa do meio existe por causa do §24: "quero saber o valor" não pode
 * virar Bolsa automaticamente. Sem ela, o roteador só teria "acertei" e
 * "desisti" — e mandar um boletim de preços para quem perguntou do valor da
 * anuidade é pior do que perguntar.
 */
export const CONFIDENCE_HIGH = 0.75;
export const CONFIDENCE_MEDIUM = 0.45;

/**
 * ⚠️ AÇÃO SENSÍVEL PRECISA DE MAIS, e o §23 é explícito: "nunca executar uma
 * ação sensível com baixa confiança".
 *
 * Sensível aqui significa que a execução DEIXA RASTRO fora do robô — cria uma
 * solicitação que alguém vai ter de despachar, ou chama uma pessoa. Consultar
 * um boletim errado custa uma mensagem; abrir uma solicitação de palestra
 * errada custa o tempo de quem for atendê-la, e ela não se desfaz sozinha.
 */
export const CONFIDENCE_HIGH_SENSITIVE = 0.85;

/** Em qual faixa esta leitura caiu. */
export type ConfidenceBand = "high" | "medium" | "low";

export function confidenceBand(confidence: number, sensitive: boolean): ConfidenceBand {
  const teto = sensitive ? CONFIDENCE_HIGH_SENSITIVE : CONFIDENCE_HIGH;

  // ⚠️ `NaN` E VALOR FORA DE FAIXA CAEM EM `low`. O número vem de um modelo, e
  // "não sei ler esta confiança" tem de falhar para o lado que pergunta de
  // novo — nunca para o que executa.
  if (!Number.isFinite(confidence)) return "low";
  if (confidence >= teto) return "high";
  if (confidence >= CONFIDENCE_MEDIUM) return "medium";
  return "low";
}

/* -------------------------------------------------------------------------- */
/* O que o modelo extrai da mensagem                                          */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ UM CAMPO SÓ, E DE PROPÓSITO. `subject` é "de que a pessoa está falando":
 * o nome da normativa, a categoria do comunicado, o nome da Bolsa.
 *
 * A tentação é um objeto com um campo por domínio (`normativeName`,
 * `bulletinName`, `communicationCategory`...). Foi recusada: cada campo novo é
 * mais uma coisa que o modelo pode preencher no lugar errado, e quem resolve o
 * nome é a FERRAMENTA, que conhece o catálogo dela. O modelo não precisa saber
 * que "Câmara Ambiental" é uma normativa e "ISP" é um comunicado — ele precisa
 * dizer a intenção e repetir o termo que a pessoa usou.
 */
export interface IntentAnalysis {
  intent: IntentName;
  /** 0 a 1. Ver `confidenceBand`. */
  confidence: number;
  /** O termo que a pessoa usou, como ela escreveu. `null` quando não há. */
  subject: string | null;
}

/* -------------------------------------------------------------------------- */
/* O registro (§11)                                                           */
/* -------------------------------------------------------------------------- */

/**
 * O que fazer com cada intenção.
 *
 * ⚠️ ACRESCENTAR UMA INTENÇÃO É ACRESCENTAR UMA ENTRADA — não é mexer no
 * roteador. É a exigência do §11, e o `Record` completo faz o TypeScript
 * apontar o que falta quando `APCS_INTENTS` cresce.
 */
export interface IntentDefinition {
  /** Rótulo PT-BR, para a trilha e os logs. */
  label: string;
  /**
   * A ferramenta que atende esta intenção. `null` quando a resposta é uma
   * mensagem configurada (saudação, ajuda) ou um encaminhamento.
   */
  tool: ToolName | null;
  /**
   * Sem ferramenta, chama uma pessoa (§31).
   *
   * ⚠️ CAMPO DO REGISTRO, E NÃO UM `if` NO ROTEADOR. Enquanto era
   * `intent === "falar_com_atendente"` escrito dentro do `router.ts`, ligar uma
   * segunda intenção ao atendimento humano exigia mexer no roteador — que é
   * exatamente o que o §11 pede para não acontecer. Hoje são duas
   * (`falar_com_atendente` e `solicitar_palestra`), e a terceira é uma linha
   * aqui.
   */
  handoff: boolean;
  /** A execução deixa rastro fora do robô? Ver `CONFIDENCE_HIGH_SENSITIVE`. */
  sensitive: boolean;
  /**
   * A pergunta de confirmação da faixa média. `null` quando a intenção nunca
   * chega a ser confirmada — saudação e ajuda são baratas demais para valer
   * uma pergunta.
   */
  confirmation: string | null;
}
