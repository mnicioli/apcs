/**
 * O REGISTRO DE AÇÕES DE NEGÓCIO — a tabela que o motor consulta, e nada além
 * dela.
 *
 * ⚠️ ELE EXISTE PARA QUE ESTA ESCADA NUNCA SEJA ESCRITA (§26):
 *
 *     if (action === "BOLSA") { … }
 *     if (action === "EVENTO") { … }
 *     if (action === "NORMA") { … }
 *
 * Espalhada por motor, validador, tela e testes, ela garante que ligar o oitavo
 * módulo signifique achar sete lugares — e esquecer um deles em silêncio. Com o
 * registro, acrescentar uma ação são duas linhas: o valor em `FLOW_ACTION_KEYS`
 * e a entrada aqui. O `Record<FlowActionKey, …>` completo é quem cobra: quando a
 * lista cresce, o TypeScript aponta ESTA linha, e não um caminho que só
 * quebraria em produção quando alguém desenhasse aquele nó.
 *
 * É o mesmo desenho de `src/modules/intelligence/intent.registry.ts`, e de
 * propósito: as duas listas descrevem o mesmo vocabulário de domínio visto de
 * ângulos diferentes — a intenção é o que a PESSOA quer, a ação é o que o CRM
 * FAZ a respeito.
 *
 * ⚠️ AS CHAVES ESTÃO EM PORTUGUÊS, contra a regra geral do CLAUDE.md, e é
 * deliberado: elas são o MESMO vocabulário de `APCS_INTENTS`. Ter
 * `consultar_bolsa` na intenção e `queryMarketBulletin` na ação obrigaria todo
 * mundo a manter um dicionário na cabeça para ler um fluxo.
 */

/**
 * ⚠️ NENHUM HANDLER ESTÁ LIGADO NESTA FUNDAÇÃO, e isso é o Prompt 1 fazendo o
 * que prometeu (§28: "não implementar todas as Actions de negócio"). O que
 * existe aqui é o CONTRATO — o que cada ação recebe, o que ela grava no contexto
 * e como o motor a encontra.
 *
 * A porta para os Prompts 3+ é `FLOW_ACTION_HANDLERS`, no fim do arquivo.
 */
export const FLOW_ACTION_KEYS = [
  "consultar_bolsa",
  "consultar_normativa",
  "consultar_comunicacao",
  "consultar_evento",
  "consultar_conhecimento",
  "solicitar_palestra",
  "participar_enquete",
  "registrar_lead",
  // As três do §11 do Prompt 2. Acrescentá-las foram DUAS LINHAS cada — o valor
  // aqui e a entrada no registro. Nem o motor, nem o validador, nem a tela do
  // Builder foram tocados, que é a prova de que o registro está fazendo o
  // trabalho dele.
  "criar_ticket",
  "enviar_pdf",
  "enviar_imagem",
] as const;

export type FlowActionKey = (typeof FLOW_ACTION_KEYS)[number];

export function isFlowActionKey(value: string): value is FlowActionKey {
  return (FLOW_ACTION_KEYS as readonly string[]).includes(value);
}

/** De onde a ação tira o que precisa saber. */
export interface FlowActionParameter {
  /** O nome da variável do contexto (§15) que alimenta o parâmetro. */
  name: string;
  label: string;
  required: boolean;
}

export interface FlowActionDefinition {
  /** PT-BR, para o seletor do desenhador. */
  label: string;
  /** O que ela faz, em uma frase — aparece como ajuda no formulário. */
  description: string;
  /** O módulo dono do dado. Serve à tela e a quem for ligar o handler. */
  module: "market" | "documents" | "events" | "lectures" | "surveys" | "knowledge" | "leads";
  /**
   * ⚠️ SÓ LÊ, OU TAMBÉM ESCREVE? É a pergunta mais importante da lista.
   *
   * Uma ação de leitura pode ser repetida sem consequência — se o webhook
   * reentregar a mensagem, consultar a Bolsa duas vezes não faz mal a ninguém.
   * Uma de escrita cria registro: solicitar palestra duas vezes gera dois
   * protocolos, e alguém liga duas vezes para a mesma pessoa.
   *
   * Quem protege isso é o índice único de `flow_run_steps` (§27), e é este
   * campo que diz quando ele é indispensável em vez de apenas útil.
   */
  writes: boolean;
  parameters: FlowActionParameter[];
  /**
   * As variáveis que a ação DEVOLVE para o contexto (§15). É o que permite ao
   * nó seguinte usar o resultado — e ao atendente humano ver o que o robô
   * apurou antes de transferir (§16).
   */
  produces: string[];
}

export const FLOW_ACTION_REGISTRY: Record<FlowActionKey, FlowActionDefinition> = {
  consultar_bolsa: {
    label: "Consultar a Bolsa de Suínos",
    description: "Busca o boletim de preços vigente e devolve o link do arquivo.",
    module: "market",
    writes: false,
    parameters: [],
    produces: ["bolsa_titulo", "bolsa_url"],
  },

  consultar_normativa: {
    label: "Consultar normativa",
    description: "Busca a versão vigente de uma normativa pelo assunto informado.",
    module: "documents",
    writes: false,
    parameters: [{ name: "assunto", label: "Assunto procurado", required: true }],
    produces: ["normativa_titulo", "normativa_url"],
  },

  consultar_comunicacao: {
    label: "Consultar comunicado",
    description: "Busca o material de comunicação vigente sobre o assunto informado.",
    module: "documents",
    writes: false,
    parameters: [{ name: "assunto", label: "Assunto procurado", required: true }],
    produces: ["comunicado_titulo", "comunicado_url"],
  },

  consultar_evento: {
    label: "Consultar a agenda de eventos",
    description:
      "Lista os eventos do público a que a pessoa pertence. Depende de o número estar no cadastro.",
    module: "events",
    writes: false,
    parameters: [],
    produces: ["evento_titulo", "evento_data", "evento_inscricao_url"],
  },

  consultar_conhecimento: {
    label: "Consultar a Base de Conhecimento",
    description: "Procura uma resposta escrita para a pergunta da pessoa.",
    module: "knowledge",
    writes: false,
    parameters: [{ name: "pergunta", label: "Texto da pergunta", required: true }],
    produces: ["conhecimento_titulo", "conhecimento_resposta"],
  },

  solicitar_palestra: {
    label: "Registrar solicitação de palestra",
    description: "Abre um protocolo de palestra com os dados coletados na triagem.",
    module: "lectures",
    // ⚠️ ESCREVE. Sem a trava de idempotência, uma reentrega do webhook geraria
    // dois protocolos para a mesma pessoa — e alguém do time ligaria duas vezes.
    writes: true,
    parameters: [
      { name: "nome", label: "Nome de quem solicita", required: true },
      { name: "cidade", label: "Cidade", required: false },
      { name: "tema", label: "Tema desejado", required: false },
    ],
    produces: ["palestra_protocolo"],
  },

  participar_enquete: {
    label: "Registrar resposta de enquete",
    description: "Grava a alternativa escolhida na enquete aberta para aquele contato.",
    module: "surveys",
    writes: true,
    parameters: [{ name: "alternativa", label: "Alternativa escolhida", required: true }],
    produces: ["enquete_desfecho"],
  },

  registrar_lead: {
    label: "Registrar contato",
    description: "Grava nome e telefone de quem ainda não está no cadastro.",
    module: "leads",
    writes: true,
    parameters: [
      { name: "nome", label: "Nome", required: true },
      { name: "assunto", label: "Assunto", required: false },
    ],
    produces: ["lead_id"],
  },

  criar_ticket: {
    label: "Abrir chamado de atendimento",
    description: "Registra a solicitação como um atendimento a ser tratado por um time.",
    module: "leads",
    // ⚠️ ESCREVE, e é a que mais dói repetir: dois chamados idênticos viram duas
    // pessoas trabalhando a mesma coisa, e a segunda descobre isso no fim.
    writes: true,
    parameters: [
      { name: "assunto", label: "Assunto", required: true },
      { name: "descricao", label: "Descrição", required: false },
    ],
    produces: ["ticket_protocolo"],
  },

  enviar_pdf: {
    label: "Enviar um PDF",
    description: "Manda um documento já publicado pela APCS.",
    module: "documents",
    // ⚠️ NÃO ESCREVE NO CRM, mas SAI DA CASA. Reenviar o mesmo PDF não corrompe
    // dado nenhum; só faz a pessoa receber duas vezes — irritante, não grave.
    // A distinção `writes` continua honesta: ela é sobre o que fica gravado.
    writes: false,
    parameters: [{ name: "documento_url", label: "Endereço do arquivo", required: true }],
    produces: ["envio_ok"],
  },

  enviar_imagem: {
    label: "Enviar uma imagem",
    description: "Manda um cartaz, banner ou material visual já publicado.",
    module: "documents",
    writes: false,
    parameters: [{ name: "imagem_url", label: "Endereço da imagem", required: true }],
    produces: ["envio_ok"],
  },
};

export function flowActionDefinition(key: FlowActionKey): FlowActionDefinition {
  return FLOW_ACTION_REGISTRY[key];
}

/* -------------------------------------------------------------------------- */
/* A costura para os Prompts 3+                                               */
/* -------------------------------------------------------------------------- */

/**
 * O que um handler recebe e o que ele devolve.
 *
 * ⚠️ ELE NÃO RECEBE A EXECUÇÃO INTEIRA, e a limitação é o ponto. Um handler que
 * enxergasse `FlowRun` poderia mudar o nó atual, o status, o time — ou seja,
 * poderia DECIDIR O CAMINHO. Quem decide o caminho é o motor (§25); a ação
 * consulta o CRM e devolve variáveis.
 */
export interface FlowActionInput {
  /** As variáveis já coletadas (§15). Somente leitura. */
  variables: Readonly<Record<string, string>>;
  /** A conversa, para as portas que dependem de reconhecer o número. */
  whatsappChatId: string | null;
  /**
   * ⚠️ A CHAVE DE IDEMPOTÊNCIA DO PASSO (§27). Um handler de escrita DEVE
   * repassá-la ao serviço de domínio — é ela que faz a segunda entrega da mesma
   * mensagem não virar um segundo protocolo. `lectures.idempotency_key` já
   * existe exatamente para isso.
   */
  idempotencyKey: string;
}

export type FlowActionOutput =
  | { ok: true; variables: Record<string, string> }
  | { ok: false; reason: "empty" | "error" };

export type FlowActionHandler = (input: FlowActionInput) => Promise<FlowActionOutput>;

/**
 * ⚠️ VAZIO DE PROPÓSITO — ver o aviso no topo do arquivo.
 *
 * Ligar a Bolsa (Prompt 3) é acrescentar UMA entrada aqui, apontando para o
 * serviço que já existe (`src/lib/services/market-chatbot.ts`). Nem o motor, nem
 * o validador, nem a tela precisam saber que isso aconteceu.
 *
 * `Partial` e não `Record` completo: uma ação declarada sem handler é um estado
 * legítimo e temporário. Quem recusa publicar um fluxo que dependa dela é
 * `flow.rules.ts`, com uma frase que diz qual ação falta.
 */
export const FLOW_ACTION_HANDLERS: Partial<Record<FlowActionKey, FlowActionHandler>> = {};

export function flowActionHandler(key: FlowActionKey): FlowActionHandler | null {
  return FLOW_ACTION_HANDLERS[key] ?? null;
}

/** Uma ação está pronta para rodar? É o que separa "desenhável" de "publicável". */
export function isFlowActionReady(key: FlowActionKey): boolean {
  return flowActionHandler(key) !== null;
}
