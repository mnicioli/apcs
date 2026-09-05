import { nodeExecutor } from "./flow.executors";
import {
  interpolate,
  isNumericText,
  isOpenQuestion,
  matchOption,
  nodeText,
  questionInterpretsIntent,
  questionOptions,
  questionRetryPolicy,
  textField,
} from "./flow.node-config";
import { resolveTransition } from "./flow.transitions";
import type {
  CompiledFlowNode,
  FlowDefinition,
  FlowEffect,
  FlowEngineFailure,
  FlowEngineInput,
  FlowEngineResult,
  FlowEngineState,
  FlowVariables,
} from "./flow.types";

/**
 * O MOTOR — e ele é de propósito burro e determinístico.
 *
 * Recebe o retrato congelado da versão + o estado da execução + o que acabou de
 * acontecer, e devolve O QUE FAZER. Não tem I/O, não chama LLM, não toca no
 * banco: dá para testar cada regra isoladamente.
 *
 * ⚠️ ESTA É A REGRA ARQUITETURAL OBRIGATÓRIA DO §2 DO PROMPT 3, E ELA É UMA
 * AUSÊNCIA.
 *
 * A IA não aparece neste arquivo. Ela entrega intenção e confiança — que ficam
 * em `flow_runs.intent` / `intent_confidence` e podem alimentar uma CONDIÇÃO
 * como qualquer outra variável. Quem escolhe o próximo nó é a tabela de
 * transições, avaliada aqui. Não existe caminho pelo qual um texto gerado
 * decida o rumo de um atendimento, porque `FlowEffect` não tem campo de texto
 * livre que o motor invente: todo texto que sai daqui foi ESCRITO por alguém na
 * configuração de um nó.
 *
 * ⚠️ O QUE ESTE ARQUIVO DEIXOU DE FAZER NO PROMPT 3. Ele não sabe mais executar
 * um tipo de nó: quem sabe é `flow.executors.ts`. Ele não sabe mais comparar
 * valores: quem sabe é `flow.operators.ts`. Ele não sabe mais ler o jsonb de uma
 * configuração: quem sabe é `flow.node-config.ts`. O que sobrou aqui é a única
 * coisa que é genuinamente do motor — a TRAVESSIA, e as três portas por onde se
 * entra nela.
 */

/* -------------------------------------------------------------------------- */
/* A superfície pública                                                       */
/* -------------------------------------------------------------------------- */

// Os tipos moram em `flow.types.ts` para os executores poderem falar deles sem
// importar o motor (ver o aviso lá). Reexportados aqui porque a assinatura
// pública do motor é feita deles — e porque o simulador já os importava daqui.
export type {
  FlowEffect,
  FlowEffectTrigger,
  FlowEngineFailure,
  FlowEngineInput,
  FlowEngineResult,
  FlowEngineState,
  FlowQuestionOption,
  FlowActionStatus,
} from "./flow.types";

// `interpolate` e `matchOption` mudaram de arquivo no Prompt 3. Os nomes antigos
// continuam valendo: eles estão em testes e no simulador, e renomear os dois
// não paga o diff.
export { interpolate as interpolar, matchOption as casarAlternativa } from "./flow.node-config";

/**
 * O teto de saltos numa única passada.
 *
 * ⚠️ ELE EXISTE PORQUE CICLOS SÃO LEGÍTIMOS. "Voltar ao menu" é um ciclo, e
 * proibi-lo tornaria metade dos fluxos reais indesenháveis — por isso o banco só
 * recusa a auto-transição (`flow_transitions_not_self`), que é o único ciclo
 * que nunca é intencional.
 *
 * O preço é que um desenho pode circular: MENU → CONDIÇÃO → MENU sem passar por
 * um QUESTION, que é onde o motor naturalmente pararia. Sem teto, isso é um laço
 * infinito dentro de um webhook — ou seja, um processo travado e uma pessoa sem
 * resposta.
 *
 * Vinte é folgado para qualquer triagem plausível e curto o bastante para o
 * defeito aparecer como um erro, e não como uma lentidão.
 */
const LIMITE_DE_SALTOS = 20;

/**
 * §10 do Prompt 5. Quantos nós UMA CONVERSA pode atravessar, somando os turnos.
 *
 * ⚠️ ELE RESOLVE O LAÇO QUE `LIMITE_DE_SALTOS` NÃO ENXERGA, e a diferença é a
 * razão de existirem dois números. Ver o comentário longo em
 * `FlowEngineState.nodeExecutions`: o teto de saltos pega o laço FECHADO, que
 * trava um turno; este pega o laço LENTO — duas perguntas que se apontam, uma
 * mensagem por turno, cada turno perfeitamente válido, para sempre.
 *
 * ⚠️ DUZENTOS, E O NÚMERO TEM OS DOIS LADOS PENSADOS. Uma triagem real gasta
 * entre cinco e quinze nós; um atendimento longo, com o associado voltando
 * várias vezes ao menu, talvez cinquenta. Duzentos é folgado o bastante para
 * nunca alcançar quem está sendo atendido de verdade, e curto o bastante para
 * o laço aparecer no mesmo dia em vez de virar uma conversa de mil mensagens.
 *
 * O CHECK no banco (`flow_runs_node_executions_range`) é 2000, dez vezes isto,
 * de propósito: quem recusa é esta constante, com um motivo legível; o banco é
 * só a rede embaixo, e ajustar o número aqui não pode virar erro de constraint.
 */
const LIMITE_DE_NOS_POR_CONVERSA = 200;

/* -------------------------------------------------------------------------- */
/* A entrada                                                                  */
/* -------------------------------------------------------------------------- */

export function advanceFlow(
  definition: FlowDefinition,
  state: FlowEngineState,
  input: FlowEngineInput,
): FlowEngineResult {
  switch (input.kind) {
    case "start":
      return comecar(definition, state);
    case "reply":
      return responder(definition, state, input.text);
    case "actionResult":
      return retomarDepoisDaAcao(definition, state, input);
  }
}

/** O estado de uma execução que ainda não começou. */
export function initialFlowState(): FlowEngineState {
  return {
    currentNodeId: null,
    variables: {},
    status: "running",
    conversationStatus: "new",
    assignedTeamKey: null,
    attemptCount: 0,
    // §10. A conversa nasce sem nenhum nó atravessado. Ver `LIMITE_DE_NOS_POR_CONVERSA`.
    nodeExecutions: 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Os três caminhos de entrada                                                */
/* -------------------------------------------------------------------------- */

function comecar(definition: FlowDefinition, state: FlowEngineState): FlowEngineResult {
  const inicio = definition.startNodeId;
  if (inicio === null) {
    return falhar(state, null, "no_start_node");
  }

  return percorrer(definition, { ...state, conversationStatus: "triage" }, inicio, []);
}

function responder(
  definition: FlowDefinition,
  state: FlowEngineState,
  texto: string,
): FlowEngineResult {
  if (state.status !== "waiting_reply" || state.currentNodeId === null) {
    // Uma mensagem que chega quando o motor não está esperando resposta não é
    // erro da pessoa — é o webhook entregando algo fora de hora, ou a conversa
    // tendo sido transferida no meio. Quem trata é a camada de cima; aqui só se
    // diz o que houve.
    return falhar(state, state.currentNodeId, "not_waiting_reply");
  }

  const node = acharNode(definition, state.currentNodeId);
  if (!node) return falhar(state, state.currentNodeId, "node_not_found");

  const variavelDoNo = textField(node, "variable");

  /* ---------------------------------------------------------------------- */
  /* Pergunta ABERTA — texto livre e número (Prompt 2, §8)                    */
  /* ---------------------------------------------------------------------- */
  // ⚠️ AQUI NÃO HÁ CHAVE A CASAR: o que a pessoa escreveu É a resposta. O nó
  // grava a variável e segue pela única saída — a bifurcação, se houver, é de
  // um nó de CONDIÇÃO adiante, que sabe comparar.
  if (isOpenQuestion(node)) {
    const resposta = texto.trim();

    // §10 do Prompt 3: a validação do tipo acontece AQUI, no servidor, e não na
    // tela que fez a pergunta. Um "abc" onde se pediu um número não avança e
    // não vira variável — gravar lixo faria a condição seguinte comparar contra
    // nada, e o fluxo escolheria um caminho por acidente.
    if (resposta === "" || (questionKindIsNumber(node) && !isNumericText(resposta))) {
      return tentarDeNovo(definition, state, node);
    }

    const comAberta: FlowVariables = variavelDoNo
      ? { ...state.variables, [variavelDoNo]: resposta }
      : state.variables;

    return percorrerDaPergunta(definition, state, node, comAberta, null);
  }

  /* ---------------------------------------------------------------------- */
  /* Pergunta de ESCOLHA                                                      */
  /* ---------------------------------------------------------------------- */
  const escolhida = matchOption(texto, questionOptions(node));

  if (!escolhida) {
    /**
     * §16 do Prompt 4 — MENU E TEXTO LIVRE NA MESMA PERGUNTA.
     *
     * ⚠️ A ORDEM É A REGRA: a alternativa foi tentada PRIMEIRO, e por igualdade
     * exata. Quem digita "2" já saiu daqui pela linha de cima, sem modelo
     * nenhum no caminho — é o que mantém o menu funcionando com a IA fora do
     * ar, e é o que o §16 quer dizer com "simultaneamente".
     *
     * ⚠️ E O MOTOR CONTINUA SEM SABER QUE A IA EXISTE. Nada aqui chama modelo:
     * quando a pergunta está marcada com `interpretIntent`, quem já leu a frase
     * foi a camada de cima (`lib/flow/intent.ts`), e o que ela deixou foram as
     * variáveis `sys_intent*`. Este trecho só faz uma coisa: dar às transições
     * de VARIÁVEL a chance de casar antes de a pergunta ser repetida.
     *
     * A escolha do caminho segue sendo de `resolveTransition`, sobre setas que
     * uma pessoa desenhou. É o §13 — a IA interpreta, o desenho decide.
     *
     * ⚠️ E NÃO CASANDO NADA, REPETE — igualzinho a antes. Uma pergunta com
     * `interpretIntent` ligado e nenhuma seta de condição se comporta como
     * sempre se comportou, o que é a propriedade que torna esta mudança segura
     * para os fluxos que já existem.
     */
    if (questionInterpretsIntent(node)) {
      const porVariavel = resolveTransition(definition, node.id, state.variables, null);

      if (porVariavel) {
        return percorrer(
          definition,
          // ⚠️ A RESPOSTA NÃO VIRA A VARIÁVEL DO NÓ. Ela não é uma escolha: é
          // uma frase que o modelo interpretou, e gravá-la em `variable` faria
          // uma condição adiante comparar "quero saber o valor do suíno" com a
          // chave `BOLSA_SUINOS` e não casar. O que a pessoa escreveu já está
          // em `sys_intent_subject`, que é onde ele é utilizável.
          { ...state, status: "running", attemptCount: 0 },
          porVariavel.targetNodeId,
          [],
        );
      }
    }

    // ⚠️ NÃO AVANÇA E NÃO INVENTA FRASE. O motor não sabe o que a pessoa quis
    // dizer, e adivinhar aqui seria decidir o atendimento por um palpite.
    return tentarDeNovo(definition, state, node);
  }

  // §9 do Prompt 2. A resposta vira variável ANTES de a transição ser avaliada —
  // assim uma condição pode olhar o que acabou de ser respondido.
  const variables: FlowVariables = variavelDoNo
    ? { ...state.variables, [variavelDoNo]: escolhida.key }
    : state.variables;

  return percorrerDaPergunta(definition, state, node, variables, escolhida.key);
}

/**
 * Sai de um nó de pergunta com a resposta já gravada.
 *
 * ⚠️ `attemptCount: 0` PORQUE A PESSOA ACERTOU. Ela pode ter errado duas vezes
 * antes; o que chega à pergunta seguinte é um contador limpo. Ver o campo em
 * `FlowEngineState`.
 */
function percorrerDaPergunta(
  definition: FlowDefinition,
  state: FlowEngineState,
  node: CompiledFlowNode,
  variables: FlowVariables,
  answerKey: string | null,
): FlowEngineResult {
  const saida = resolveTransition(definition, node.id, variables, answerKey);
  if (!saida) {
    return falhar({ ...state, variables }, node.id, "no_matching_transition");
  }

  // ⚠️ A CHAVE DA RESPOSTA NÃO ATRAVESSA. Ela vale para UMA avaliação — a da
  // saída do próprio nó de pergunta, feita na linha acima — e depois disso é
  // `null`. Levá-la adiante faria uma condição `answer` encontrada mais à
  // frente no caminho casar com uma escolha que não está mais sendo feita: um
  // nó de condição logo depois do menu passaria a decidir pela resposta
  // ANTERIOR, e o desenho não diria isso em lugar nenhum.
  return percorrer(
    definition,
    { ...state, variables, status: "running", attemptCount: 0 },
    saida.targetNodeId,
    [],
  );
}

/**
 * A RESPOSTA NÃO SERVIU — §10, §11 e §26 do Prompt 3.
 *
 * ⚠️ ESTE É O ÚNICO PONTO DO MOTOR QUE PODE PRENDER ALGUÉM NUM LAÇO, e é por
 * isso que ele conta. Antes do Prompt 3 a resposta inválida repetia a pergunta
 * indefinidamente: quem não entendesse o menu ficava recebendo a mesma
 * pergunta para sempre, e nenhuma pessoa da APCS ficaria sabendo. O contador e
 * o desfecho existem para que "não consegui responder" acabe em alguém — ou
 * acabe, e não em silêncio.
 */
function tentarDeNovo(
  definition: FlowDefinition,
  state: FlowEngineState,
  node: CompiledFlowNode,
): FlowEngineResult {
  const politica = questionRetryPolicy(node);
  const tentativa = state.attemptCount + 1;

  if (tentativa < politica.maxAttempts) {
    return {
      state: { ...state, attemptCount: tentativa },
      effects: [
        {
          kind: "repeatQuestion",
          nodeId: node.id,
          // A frase de "não entendi", quando o nó tem uma. Sem ela, repete a
          // pergunta como está escrita — que é o que o motor sempre fez.
          text: politica.invalidText
            ? interpolate(politica.invalidText, state.variables)
            : nodeText(node, state.variables),
          options: questionOptions(node),
          attempt: tentativa,
          maxAttempts: politica.maxAttempts,
        },
      ],
      // §10. UM NÓ FOI TRABALHADO, ainda que a conversa não tenha avançado — e
      // contar é o certo: uma conversa que gira em retentativa turno após turno
      // é exatamente o "não vai a lugar nenhum" que a trava existe para achar.
      // O `maxAttempts` já impede o laço curto; este contador enxerga o padrão
      // maior, de alguém que erra, é transferido, volta e erra de novo.
      nodesWalked: 1,
    };
  }

  /* --- as tentativas acabaram --- */

  const mensagem = politica.exhaustedText
    ? interpolate(politica.exhaustedText, state.variables)
    : null;

  if (politica.onExhausted === "transfer") {
    if (!politica.fallbackTeamKey) {
      // A publicação recusa isto; um retrato congelado ANTES de o campo existir
      // não foi recusado por ninguém. Falhar alto é melhor do que transferir
      // para lugar nenhum e deixar a conversa parada sem fila.
      return falhar({ ...state, attemptCount: tentativa }, node.id, "fallback_without_team");
    }

    return {
      state: {
        ...state,
        attemptCount: tentativa,
        status: "handed_off",
        conversationStatus: "in_service",
        assignedTeamKey: politica.fallbackTeamKey,
      },
      effects: [
        {
          kind: "assignTeam",
          nodeId: node.id,
          teamKey: politica.fallbackTeamKey,
          message: mensagem,
          slaMinutes: null,
          priority: "normal",
          // ⚠️ É ISTO QUE SEPARA, NA TRILHA, A TRANSFERÊNCIA DESENHADA DA
          // TRANSFERÊNCIA POR DESISTÊNCIA. Ver `FlowEffectTrigger`.
          trigger: "fallback",
        },
      ],
      nodesWalked: 1,
    };
  }

  return {
    state: {
      ...state,
      attemptCount: tentativa,
      status: "completed",
      conversationStatus: "resolved",
    },
    effects: [{ kind: "complete", nodeId: node.id, message: mensagem, trigger: "fallback" }],
    nodesWalked: 1,
  };
}

/**
 * A ação terminou — §16 do Prompt 3.
 *
 * ⚠️ O RESULTADO ENTRA COMO VARIÁVEL, INCLUSIVE O FRACASSO, e são DUAS: o
 * `_ok` de sempre e o `_status` novo. A diferença entre elas é a diferença
 * entre "deu certo?" e "o que aconteceu?", e o §16 precisa da segunda:
 *
 *     CONSULTAR_NORMATIVA → NOT_FOUND → fallback
 *     CONSULTAR_NORMATIVA → FAILURE   → "estamos com um problema"
 *
 * Com um booleano só, os dois caminhos seriam o mesmo, e o associado ouviria
 * "ocorreu um erro" quando a verdade era "não achei normativa sobre isso" — que
 * é uma resposta útil, e não uma falha.
 */
function retomarDepoisDaAcao(
  definition: FlowDefinition,
  state: FlowEngineState,
  input: { status: string; variables: FlowVariables },
): FlowEngineResult {
  if (state.currentNodeId === null) return falhar(state, null, "node_not_found");

  const node = acharNode(definition, state.currentNodeId);
  if (!node) return falhar(state, state.currentNodeId, "node_not_found");

  const chave = textField(node, "actionKey") ?? "acao";
  const deuCerto = input.status === "success";

  const variables: FlowVariables = {
    ...state.variables,
    ...input.variables,
    [`${chave}_ok`]: deuCerto ? "true" : "false",
    [`${chave}_status`]: input.status,
  };

  const saida = resolveTransition(definition, node.id, variables, null);
  if (!saida) return falhar({ ...state, variables }, node.id, "no_matching_transition");

  return percorrer(definition, { ...state, variables, status: "running" }, saida.targetNodeId, []);
}

/* -------------------------------------------------------------------------- */
/* A travessia                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Anda de nó em nó até PARAR. Parar é o normal: um fluxo que não para é um fluxo
 * que não conversa.
 *
 * Os quatro motivos de parada — perguntar, executar uma ação, transferir e
 * encerrar — são exatamente os quatro efeitos que exigem alguém de fora fazer
 * algo antes de continuar.
 *
 * ⚠️ ESTE LAÇO NÃO SABE O QUE É UMA MENSAGEM OU UMA PERGUNTA, e é o ponto do
 * §6. Ele pergunta ao registro quem executa aquele tipo, recebe um dos três
 * desfechos e reage a eles. Um tipo de nó novo não o toca.
 */
function percorrer(
  definition: FlowDefinition,
  estadoInicial: FlowEngineState,
  primeiroNo: string,
  efeitosAcumulados: FlowEffect[],
): FlowEngineResult {
  let effects = [...efeitosAcumulados];
  let state = estadoInicial;
  let noAtual: string | null = primeiroNo;
  let andados = 0;

  for (let salto = 0; salto < LIMITE_DE_SALTOS; salto += 1) {
    if (noAtual === null) break;

    /**
     * §10 do Prompt 5. A TRAVA DA CONVERSA, e ela vem ANTES de executar o nó.
     *
     * ⚠️ ANTES, E NÃO DEPOIS: parar depois faria a conversa executar o nó de
     * número 201 — que, num laço, é justamente mais uma mensagem repetida para
     * alguém que já recebeu duzentas.
     *
     * ⚠️ E ELA PARA COM `loop_detected`, SEM INVENTAR FRASE. O §10 pede
     * "fallback seguro", e o seguro aqui é o mesmo silêncio que o motor já
     * pratica em toda falha: a execução vira `failed`, o robô se cala e a
     * conversa fica acesa na caixa de entrada — onde uma PESSOA a vê. A
     * alternativa seria o motor escolher um texto de despedida, e ele não tem
     * de onde tirar um que a APCS tenha escrito.
     */
    if (state.nodeExecutions + andados >= LIMITE_DE_NOS_POR_CONVERSA) {
      return {
        state: { ...state, status: "failed", nodeExecutions: state.nodeExecutions + andados },
        effects: [...effects, erro(noAtual, "loop_detected")],
        nodesWalked: andados,
      };
    }

    const node = acharNode(definition, noAtual);
    if (!node) {
      return {
        state: { ...state, currentNodeId: noAtual, status: "failed" },
        effects: [...effects, erro(noAtual, "node_not_found")],
        nodesWalked: andados,
      };
    }

    andados += 1;
    state = { ...state, currentNodeId: node.id };

    // `answerKey: null` — dentro da travessia nenhuma escolha está "em curso".
    // Ver o aviso em `percorrerDaPergunta`.
    const resultado = nodeExecutor(node.type).execute({
      definition,
      node,
      state,
      answerKey: null,
    });
    effects = [...effects, ...resultado.effects];

    switch (resultado.kind) {
      case "continue":
        state = resultado.state;
        noAtual = resultado.nextNodeId;
        break;

      case "halt":
        return { state: resultado.state, effects, nodesWalked: andados };

      case "fail":
        return {
          state: { ...resultado.state, status: "failed" },
          effects,
          nodesWalked: andados,
        };
    }
  }

  // Estourou o teto: o desenho circula sem nunca parar. Ver `LIMITE_DE_SALTOS`.
  return {
    state: { ...state, status: "failed" },
    effects: [...effects, erro(noAtual, "hop_limit")],
    nodesWalked: andados,
  };
}

/* -------------------------------------------------------------------------- */
/* Miudezas                                                                   */
/* -------------------------------------------------------------------------- */

function acharNode(definition: FlowDefinition, id: string): CompiledFlowNode | null {
  return definition.nodes.find((n) => n.id === id) ?? null;
}

/** O tipo de pergunta é `number`? Só ele exige que a resposta seja numérica. */
function questionKindIsNumber(node: CompiledFlowNode): boolean {
  return textField(node, "kind") === "number";
}

function erro(nodeId: string | null, reason: FlowEngineFailure): FlowEffect {
  return { kind: "fail", nodeId, reason };
}

function falhar(
  state: FlowEngineState,
  nodeId: string | null,
  reason: FlowEngineFailure,
): FlowEngineResult {
  /**
   * ⚠️ `nodesWalked: 0` PORQUE FALHAR NÃO É ANDAR.
   *
   * As falhas que passam por aqui acontecem ANTES da travessia (a conversa não
   * estava esperando resposta, o nó não existe no retrato) ou no lugar dela.
   * Contar um nó aqui inflaria o contador de laço com turnos que não moveram a
   * conversa — e a trava do §10 acabaria disparando por erro repetido, que é
   * outro problema, com outro nome e outra correção.
   */
  return {
    state: { ...state, status: "failed" },
    effects: [erro(nodeId, reason)],
    nodesWalked: 0,
  };
}
