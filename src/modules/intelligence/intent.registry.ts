import {
  APCS_INTENTS,
  type IntentDefinition,
  type IntentName,
  type ToolName,
} from "./intent.types";

/**
 * O REGISTRO DE INTENÇÕES — a tabela que o roteador consulta, e nada além dela.
 *
 * ⚠️ ACRESCENTAR UMA INTENÇÃO SÃO DUAS LINHAS: o valor em `APCS_INTENTS` e a
 * entrada aqui. `router.ts` não tem um `switch` por intenção e não precisa ser
 * tocado — é a exigência do §11 do escopo, e é o que impede o roteador de virar
 * uma escada de `if` que ninguém mais lê.
 *
 * O `Record<IntentName, …>` completo é quem cobra: quando `APCS_INTENTS`
 * cresce, o TypeScript aponta esta linha, e não um caminho que só falharia em
 * produção quando alguém dissesse a frase certa.
 */
export const INTENT_REGISTRY: Record<IntentName, IntentDefinition> = {
  saudacao: {
    label: "Saudação",
    tool: null,
    handoff: false,
    sensitive: false,
    // Responder "oi" com "você quis dizer oi?" é o tipo de coisa que faz a
    // pessoa desistir do canal.
    confirmation: null,
  },

  consultar_bolsa: {
    label: "Consultar a Bolsa",
    tool: "getActiveBolsa",
    handoff: false,
    sensitive: false,
    // ⚠️ É O EXEMPLO DO §24, PALAVRA POR PALAVRA. "Quero saber o valor" não pode
    // virar Bolsa sozinho: pode ser a anuidade, pode ser o preço de um evento.
    confirmation: "Você deseja consultar o valor da Bolsa de Suínos?",
  },

  consultar_normativa: {
    label: "Consultar normativa",
    tool: "getActiveNormativa",
    handoff: false,
    sensitive: false,
    confirmation: "Você quer receber uma normativa da APCS?",
  },

  consultar_comunicacao: {
    label: "Consultar comunicado",
    tool: "getActiveComunicacao",
    handoff: false,
    sensitive: false,
    confirmation: "Você quer receber um material de comunicação da APCS?",
  },

  consultar_evento: {
    label: "Consultar eventos",
    tool: "getActiveEvents",
    handoff: false,
    sensitive: false,
    confirmation: "Você quer saber quais eventos a APCS tem marcados?",
  },

  /**
   * ⚠️ ENCAMINHA, E NÃO CRIA A SOLICITAÇÃO — por ora.
   *
   * `lecture-chatbot.ts::createLectureRequest` está pronto e é estreito de
   * propósito (não tem parâmetro de status, prioridade ou responsável: o robô
   * só CRIA). O que falta não é a porta: é o roteiro que coleta nome, cidade e
   * contato ao longo de vários turnos.
   *
   * Roteiro é `csp.flow.ts`, com slots e retomada — não cabe num roteador de um
   * turno. Até ele existir, a resposta honesta é chamar alguém da APCS, que
   * consegue abrir a solicitação com a pessoa na linha.
   */
  solicitar_palestra: {
    label: "Solicitar palestra",
    tool: null,
    handoff: true,
    // Sensível mesmo encaminhando: colocar a conversa na fila de uma pessoa por
    // engano custa o tempo de quem atende.
    sensitive: true,
    confirmation: "Você quer solicitar uma palestra da APCS?",
  },

  /**
   * ⚠️ NA PRÁTICA ESTA INTENÇÃO QUASE NUNCA CHEGA AQUI, e é assim que tem de
   * ser: quando há enquete em andamento, quem trata a mensagem é
   * `survey-inbox.ts`, ANTES do roteador. Aquele é um autômato com pergunta
   * corrente, tolerância a resposta inválida e opt-out próprio.
   *
   * O que sobra para cá é quem diz "quero responder a enquete" sem ter recebido
   * uma — e para essa pessoa não há o que executar. Encaminhar é o certo.
   */
  participar_enquete: {
    label: "Responder enquete",
    tool: null,
    handoff: true,
    sensitive: true,
    confirmation: "Você quer falar com a equipe sobre uma enquete da APCS?",
  },

  falar_com_atendente: {
    label: "Falar com atendente",
    tool: null,
    handoff: true,
    // ⚠️ SENSÍVEL: coloca a conversa na fila de uma pessoa. Encaminhar por
    // engano custa o tempo de quem atende — e, do outro lado, faz o associado
    // esperar por alguém que não sabia que tinha sido chamado.
    sensitive: true,
    confirmation: "Você quer falar com alguém da equipe da APCS?",
  },

  consultar_conhecimento: {
    label: "Consultar a base de conhecimento",
    tool: "getKnowledge",
    handoff: false,
    sensitive: false,
    // Sem confirmação: a busca já é barata e já responde "não encontrei"
    // sozinha. Perguntar "você quer que eu procure?" antes de procurar é um
    // turno a mais para chegar na mesma resposta.
    confirmation: null,
  },

  ajuda: {
    label: "Pedir ajuda",
    tool: null,
    handoff: false,
    sensitive: false,
    confirmation: null,
  },

  desconhecido: {
    label: "Não identificado",
    tool: null,
    handoff: false,
    sensitive: false,
    confirmation: null,
  },
};

/** A definição de uma intenção. Sempre existe: o `Record` é completo. */
export function intentDefinition(intent: IntentName): IntentDefinition {
  return INTENT_REGISTRY[intent];
}

/**
 * A intenção que esta ferramenta atende.
 *
 * O caminho de volta existe para a trilha: um registro de execução guarda a
 * ferramenta, e quem lê o log quer saber de que pedido ela veio.
 */
export function intentForTool(tool: ToolName): IntentName | null {
  return APCS_INTENTS.find((intent) => INTENT_REGISTRY[intent].tool === tool) ?? null;
}

/** As intenções que o modelo pode devolver, com o rótulo — para o prompt. */
export function intentCatalogue(): { intent: IntentName; label: string }[] {
  return APCS_INTENTS.map((intent) => ({ intent, label: INTENT_REGISTRY[intent].label }));
}
