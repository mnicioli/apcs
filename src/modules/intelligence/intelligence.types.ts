import type { IntentAnalysis, IntentName, ToolName } from "./intent.types";

/**
 * Os tipos da camada de roteamento — o contrato entre interpretar, decidir e
 * executar.
 */

/* -------------------------------------------------------------------------- */
/* As mensagens configuráveis                                                 */
/* -------------------------------------------------------------------------- */

/**
 * As frases que o robô diz quando NÃO está entregando conteúdo.
 *
 * ⚠️ CHAVE SIMBÓLICA, e não a chave de `app_settings` direto. O roteador é puro
 * e não conhece banco; ele diz QUAL frase, e quem lê a configuração é o motor.
 * É a mesma separação de `decide.ts`, que devolve `CspContentKey` em vez de
 * texto — e é ela que garante que nenhum caminho produza frase que a APCS não
 * escreveu.
 */
export const CHATBOT_MESSAGES = [
  "welcome",
  "fallback",
  "noResult",
  "error",
  "humanHandoff",
  "unidentified",
  /**
   * §46. O menu numerado que substitui a IA quando ela está fora do ar.
   *
   * ⚠️ NUMERADO PORQUE A RESPOSTA A ELE É LIDA SEM MODELO. Um menu com opções
   * em texto livre exigiria classificar a escolha — usando justamente o que
   * caiu. O número é o único fallback que funciona quando a IA é o problema.
   */
  "menu",
  /** §51. "Obrigado", "era isso". Ver a intenção `encerramento`. */
  "closing",
] as const;
export type ChatbotMessageKey = (typeof CHATBOT_MESSAGES)[number];

/* -------------------------------------------------------------------------- */
/* O contexto da conversa (§28, §29, §30)                                     */
/* -------------------------------------------------------------------------- */

/**
 * O que o robô lembra da conversa.
 *
 * ⚠️ É O QUE FAZ "E A CÂMARA SETORIAL?" FUNCIONAR. Sem `currentIntent`, essa
 * frase é ininteligível — não tem verbo, não diz o que fazer com a Câmara
 * Setorial. Com ele, é a mesma intenção da mensagem anterior aplicada a outro
 * assunto.
 *
 * ⚠️ E É POR ISSO QUE ELE EXPIRA. Um contexto sem prazo faria um "e a outra?"
 * de amanhã herdar o assunto de hoje — e o robô responderia com convicção sobre
 * algo que a pessoa esqueceu que perguntou. Ver `CONTEXT_TTL_MINUTES`.
 */
export interface RouterContext {
  /** A última intenção que de fato executou. */
  currentIntent: IntentName | null;
  /** O último assunto — o nome da normativa, do comunicado, da Bolsa. */
  currentSubject: string | null;
  /** A intenção esperando um "sim" ou "não". */
  pendingIntent: IntentName | null;
  pendingSubject: string | null;
  /**
   * §46. Quando o menu de emergência foi mostrado (ISO), ou `null`.
   *
   * ⚠️ É O QUE IMPEDE TODO NÚMERO DE VIRAR ESCOLHA DE MENU. Sem ele, um "2"
   * escrito por qualquer razão receberia a Normativa do nada — e o pior caso
   * não é o engano, é a pessoa concluir que o robô é aleatório e desistir.
   *
   * Vale enquanto o contexto valer: a validade é a mesma.
   */
  menuShownAt: string | null;
  /** ISO. Depois disto o contexto não conta mais. */
  expiresAt: string | null;
}

export const EMPTY_CONTEXT: RouterContext = {
  currentIntent: null,
  currentSubject: null,
  pendingIntent: null,
  pendingSubject: null,
  menuShownAt: null,
  expiresAt: null,
};

/**
 * ⚠️ TRINTA MINUTOS, e o número tem razão de ser dos dois lados.
 *
 * Curto demais quebra a conversa normal do WhatsApp, onde a pessoa responde
 * quando pode — cinco minutos transformaria "e a Câmara Setorial?" em "não
 * entendi" para quem foi almoçar. Longo demais faz o robô responder a pergunta
 * de ontem.
 *
 * Meia hora é a janela em que a pessoa ainda está na mesma conversa.
 */
export const CONTEXT_TTL_MINUTES = 30;

/* -------------------------------------------------------------------------- */
/* O turno                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * O que chegou neste turno.
 *
 * ⚠️ `affirmation` TEM TIPO PRÓPRIO, e não é um valor de `IntentAnalysis`. Um
 * "sim" só significa alguma coisa se houver pergunta pendente, e essa leitura é
 * DETERMINÍSTICA — feita sem chamar o modelo, como o gate de consentimento já
 * faz em `consent.ts`. Deixar o classificador decidir se "pode" foi um sim
 * abriria a porta para uma solicitação de palestra criada por engano.
 */
export type RouterTurn =
  | { kind: "affirmation"; reply: "yes" | "no" }
  | { kind: "analysis"; analysis: IntentAnalysis }
  /**
   * §46. A pessoa escolheu um número do menu de emergência.
   *
   * ⚠️ TIPO PRÓPRIO, PELA MESMA RAZÃO DE `affirmation`: a leitura é
   * DETERMINÍSTICA. Um menu cuja escolha precisasse do classificador seria
   * inútil justamente na hora em que ele existe para servir — quando o
   * classificador é o que caiu.
   */
  | { kind: "menuChoice"; intent: IntentName }
  /** O classificador falhou, recusou ou devolveu lixo. */
  | { kind: "unavailable" };

/* -------------------------------------------------------------------------- */
/* A decisão                                                                  */
/* -------------------------------------------------------------------------- */

export type RouterDecision =
  /** Executa a ferramenta. */
  | { kind: "tool"; intent: IntentName; tool: ToolName; subject: string | null }
  /** Faixa média de confiança: pergunta antes de fazer (§23, §24). */
  | { kind: "confirm"; intent: IntentName; subject: string | null; question: string }
  /** Uma das frases configuradas. */
  | { kind: "message"; message: ChatbotMessageKey }
  /** Chama uma pessoa (§31). */
  | { kind: "handoff"; intent: IntentName };

export interface RouterOutcome {
  decision: RouterDecision;
  /** O contexto DEPOIS deste turno. Quem grava é o motor. */
  context: RouterContext;
}

/* -------------------------------------------------------------------------- */
/* O resultado de uma ferramenta                                              */
/* -------------------------------------------------------------------------- */

/**
 * §17, §32, §33. DE ONDE SAIU A RESPOSTA.
 *
 * ⚠️ `tool` NÃO RESPONDE ESSA PERGUNTA. Ele diz que foi uma normativa; não diz
 * QUAL. E é o "qual" que serve às duas perguntas que se faz depois: "qual
 * documento o robô mandou para essa pessoa?" (auditoria) e "quais os mais
 * pedidos?" (§76).
 *
 * Vem preenchido só quando há um registro identificável atrás da resposta. Uma
 * frase de boas-vindas não tem origem, e forçar uma seria inventá-la.
 */
export const TOOL_SOURCE_TYPES = ["knowledge", "document", "market_bulletin", "event"] as const;
export type ToolSourceType = (typeof TOOL_SOURCE_TYPES)[number];

export interface ToolSource {
  type: ToolSourceType;
  /** O id no módulo de origem. Ver o CHECK `_source_pair` na migration. */
  id: string;
}

/** Um arquivo que acompanha a resposta. */
export interface ToolAttachment {
  kind: "image" | "document";
  /** URL assinada, de vida curta. Ver `OutboundDocumentMessage`. */
  url: string;
  /** Nome que aparece na conversa, com a extensão. Só para documento. */
  fileName?: string;
}

/**
 * ⚠️ OS TRÊS DESFECHOS SÃO DIFERENTES, e juntar dois deles é o erro que o §22 e
 * o §40 proíbem separadamente:
 *
 *   `ok`     há conteúdo oficial para entregar
 *   `empty`  a consulta funcionou e NÃO há publicação vigente — não é falha, é
 *            a APCS não tendo o que mandar agora
 *   `error`  a consulta falhou de verdade
 *
 * `empty` é trabalho de quem publica; `error` é de quem cuida do sistema. Um
 * texto só para os dois faria a equipe atender sem saber qual dos dois deu.
 */
export type ToolResult =
  | { status: "ok"; body: string; attachments: ToolAttachment[]; source: ToolSource | null }
  | { status: "empty" }
  | { status: "error" }
  /**
   * ⚠️ UM QUARTO DESFECHO, E ELE NÃO É `empty`. A ferramenta funcionou e a
   * resposta depende de saber QUEM está perguntando — e este telefone não está
   * no cadastro de associados.
   *
   * Vale para Eventos, cuja agenda é segmentada por público. Responder "não há
   * eventos" a um associado que a APCS simplesmente não reconheceu seria uma
   * afirmação falsa sobre a agenda; a resposta certa fala do cadastro.
   */
  | { status: "unidentified" };

/**
 * O que a ferramenta sabe sobre quem está falando.
 *
 * ⚠️ `memberId` É OPCIONAL E VAI CONTINUAR SENDO. Quem escreve para a APCS na
 * maioria das vezes não está em cadastro nenhum — é a mesma decisão que
 * `whatsapp_chats.contact_id` já tomou. Ferramenta que EXIGE associado
 * conhecido tem de dizer isso no resultado, não presumir.
 */
export interface ToolContext {
  /** Id do associado, quando o telefone foi reconhecido. */
  memberId: string | null;
  /** Só dígitos, E.164. */
  phone: string | null;
  /** Viaja no log de ponta a ponta (§36). */
  correlationId: string;
}

/** Uma ferramenta do registro (§13). */
export interface ToolDefinition {
  name: ToolName;
  /** O que ela faz, em PT-BR — vai para o log e para a documentação. */
  label: string;
  run(subject: string | null, context: ToolContext): Promise<ToolResult>;
}
