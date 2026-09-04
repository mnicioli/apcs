import { normalizeForSearch } from "@/lib/utils";
import type {
  CompiledFlowNode,
  CompiledFlowTransition,
  FlowConversationStatus,
  FlowDefinition,
  FlowRunStatus,
  FlowVariables,
} from "./flow.types";

/**
 * O MOTOR — e ele é de propósito burro e determinístico.
 *
 * Recebe o retrato congelado da versão + o estado da execução + o que acabou de
 * acontecer, e devolve O QUE FAZER. Não tem I/O, não chama LLM, não toca no
 * banco: dá para testar cada regra isoladamente.
 *
 * ⚠️ ESTA É A REGRA ARQUITETURAL OBRIGATÓRIA DO §25, E ELA É UMA AUSÊNCIA.
 *
 * A IA não aparece neste arquivo. Ela entrega intenção e confiança — que ficam
 * em `flow_runs.intent` / `intent_confidence` e podem alimentar uma CONDIÇÃO
 * como qualquer outra variável. Quem escolhe o próximo nó é a tabela de
 * transições, avaliada aqui. Não existe caminho pelo qual um texto gerado
 * decida o rumo de um atendimento, porque `FlowEffect` não tem campo de texto
 * livre que o motor invente: todo texto que sai daqui foi ESCRITO por alguém na
 * configuração de um nó.
 *
 * É o mesmo desenho de `src/modules/intelligence/router.ts`, e pelo mesmo
 * motivo: a única forma de "a IA interpreta e o CRM responde" ser verdade, e não
 * intenção, é a decisão sair de um lugar onde texto gerado não entra.
 */

/* -------------------------------------------------------------------------- */
/* O estado e o que entra                                                     */
/* -------------------------------------------------------------------------- */

export interface FlowEngineState {
  currentNodeId: string | null;
  variables: FlowVariables;
  status: FlowRunStatus;
  conversationStatus: FlowConversationStatus;
  /** A chave do TIME, nunca a de uma pessoa (§11). */
  assignedTeamKey: string | null;
}

export type FlowEngineInput =
  /** A conversa começou. Entra pelo nó inicial. */
  | { kind: "start" }
  /** A pessoa respondeu. Só faz sentido parado num nó QUESTION. */
  | { kind: "reply"; text: string }
  /**
   * O handler de uma ação terminou. É o retorno do `runAction` que o motor
   * emitiu e parou esperando — ver `FlowEffect`.
   */
  | { kind: "actionResult"; ok: boolean; variables: FlowVariables };

/* -------------------------------------------------------------------------- */
/* O que o motor manda fazer                                                  */
/* -------------------------------------------------------------------------- */

export interface FlowQuestionOption {
  key: string;
  label: string;
}

/**
 * ⚠️ EFEITOS, E NÃO EXECUÇÃO. O motor NÃO envia mensagem, NÃO grava no banco e
 * NÃO chama serviço nenhum: ele descreve o que precisa acontecer e devolve.
 *
 * É o que torna o Prompt 2 (simulador) e o Prompt 4 (WhatsApp de verdade)
 * possíveis sobre o MESMO motor — um imprime os efeitos na tela, o outro os
 * executa. Se o envio morasse aqui, o simulador teria de reimplementar a
 * travessia, e as duas versões divergiriam na primeira manutenção.
 */
export type FlowEffect =
  | {
      kind: "sendMessage";
      nodeId: string;
      text: string;
      /** Pausa antes de enviar, em segundos (Prompt 2, §7). */
      delaySeconds: number;
      imageUrl: string | null;
      pdfUrl: string | null;
    }
  | { kind: "askQuestion"; nodeId: string; text: string; options: FlowQuestionOption[] }
  | { kind: "runAction"; nodeId: string; actionKey: string; arguments: Record<string, string> }
  | {
      kind: "assignTeam";
      nodeId: string;
      teamKey: string;
      message: string | null;
      slaMinutes: number | null;
      priority: string;
    }
  | { kind: "complete"; nodeId: string; message: string | null }
  /**
   * A pessoa respondeu algo que não casa com alternativa nenhuma. O motor NÃO
   * inventa uma frase: devolve o efeito e o texto da própria pergunta, para que
   * quem entrega repita o que já estava escrito.
   */
  | { kind: "repeatQuestion"; nodeId: string; text: string; options: FlowQuestionOption[] }
  /** O desenho está quebrado em execução. Ver `FlowEngineFailure`. */
  | { kind: "fail"; nodeId: string | null; reason: FlowEngineFailure };

export type FlowEngineFailure =
  | "no_start_node"
  | "node_not_found"
  | "no_matching_transition"
  | "not_waiting_reply"
  | "hop_limit";

export interface FlowEngineResult {
  state: FlowEngineState;
  effects: FlowEffect[];
}

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

  const variavelDoNo = campoTexto(node, "variable");

  /* ---------------------------------------------------------------------- */
  /* Pergunta ABERTA — texto livre e número (Prompt 2, §8)                    */
  /* ---------------------------------------------------------------------- */
  // ⚠️ AQUI NÃO HÁ CHAVE A CASAR: o que a pessoa escreveu É a resposta. O nó
  // grava a variável e segue pela única saída — a bifurcação, se houver, é de
  // um nó de CONDIÇÃO adiante, que sabe comparar.
  if (perguntaAberta(node)) {
    const resposta = texto.trim();

    if (resposta === "" || (tipoDaPergunta(node) === "number" && !ehNumero(resposta))) {
      // Um "abc" onde se pediu um número não avança e não vira variável. Repetir
      // a pergunta escrita é a única resposta honesta — gravar lixo faria a
      // condição seguinte comparar contra nada.
      return {
        state,
        effects: [
          {
            kind: "repeatQuestion",
            nodeId: node.id,
            text: textoDoNo(node, state.variables),
            options: [],
          },
        ],
      };
    }

    const comAberta: FlowVariables = variavelDoNo
      ? { ...state.variables, [variavelDoNo]: resposta }
      : state.variables;

    const saidaAberta = escolherTransicao(definition, node.id, comAberta, null);
    if (!saidaAberta) {
      return falhar({ ...state, variables: comAberta }, node.id, "no_matching_transition");
    }

    return percorrer(
      definition,
      { ...state, variables: comAberta, status: "running" },
      saidaAberta.targetNodeId,
      [],
    );
  }

  const options = alternativas(node);
  const escolhida = casarAlternativa(texto, options);

  if (!escolhida) {
    // ⚠️ NÃO AVANÇA E NÃO INVENTA FRASE. Repetir a pergunta que já está escrita
    // é a única resposta honesta: o motor não sabe o que a pessoa quis dizer, e
    // adivinhar aqui seria decidir o atendimento por um palpite.
    return {
      state,
      effects: [
        {
          kind: "repeatQuestion",
          nodeId: node.id,
          text: textoDoNo(node, state.variables),
          options,
        },
      ],
    };
  }

  // §15. A resposta vira variável ANTES de a transição ser avaliada — assim uma
  // condição pode olhar o que acabou de ser respondido.
  const variables: FlowVariables = variavelDoNo
    ? { ...state.variables, [variavelDoNo]: escolhida.key }
    : state.variables;

  const saida = escolherTransicao(definition, node.id, variables, escolhida.key);
  if (!saida) return falhar({ ...state, variables }, node.id, "no_matching_transition");

  return percorrer(definition, { ...state, variables, status: "running" }, saida.targetNodeId, []);
}

function retomarDepoisDaAcao(
  definition: FlowDefinition,
  state: FlowEngineState,
  input: { ok: boolean; variables: FlowVariables },
): FlowEngineResult {
  if (state.currentNodeId === null) return falhar(state, null, "node_not_found");

  const node = acharNode(definition, state.currentNodeId);
  if (!node) return falhar(state, state.currentNodeId, "node_not_found");

  // ⚠️ O RESULTADO DA AÇÃO ENTRA COMO VARIÁVEL, INCLUSIVE O FRACASSO. Gravar
  // `<acao>_ok = "false"` é o que permite ao desenho ter um caminho para quando
  // a consulta não achou nada — sem isso, a única saída seria um erro genérico,
  // e a pessoa receberia "ocorreu um erro" no lugar de "não encontrei a
  // normativa sobre esse assunto".
  const variables: FlowVariables = {
    ...state.variables,
    ...input.variables,
    [`${campoTexto(node, "actionKey") ?? "acao"}_ok`]: input.ok ? "true" : "false",
  };

  const saida = escolherTransicao(definition, node.id, variables, null);
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
 */
function percorrer(
  definition: FlowDefinition,
  estadoInicial: FlowEngineState,
  primeiroNo: string,
  efeitosAcumulados: FlowEffect[],
): FlowEngineResult {
  const effects = [...efeitosAcumulados];
  let state = estadoInicial;
  let noAtual: string | null = primeiroNo;

  for (let salto = 0; salto < LIMITE_DE_SALTOS; salto += 1) {
    if (noAtual === null) break;

    const node = acharNode(definition, noAtual);
    if (!node) {
      return {
        state: { ...state, currentNodeId: noAtual },
        effects: [...effects, erro(noAtual, "node_not_found")],
      };
    }

    state = { ...state, currentNodeId: node.id };

    switch (node.type) {
      case "message": {
        // ⚠️ O NÓ DESLIGADO É ATRAVESSADO, NÃO IGNORADO. Ele não emite mensagem
        // e o fluxo segue pela saída dele — que é o que permite calar um aviso
        // temporário sem desmontar o desenho em volta. Ver `enabled` em
        // `flow.schema.ts`.
        if (habilitado(node)) {
          effects.push({
            kind: "sendMessage",
            nodeId: node.id,
            text: textoDoNo(node, state.variables),
            delaySeconds: numero(node, "delaySeconds") ?? 0,
            imageUrl: campoTexto(node, "imageUrl"),
            pdfUrl: campoTexto(node, "pdfUrl"),
          });
        }
        const saida = escolherTransicao(definition, node.id, state.variables, null);
        if (!saida) {
          return { state, effects: [...effects, erro(node.id, "no_matching_transition")] };
        }
        noAtual = saida.targetNodeId;
        break;
      }

      case "question": {
        effects.push({
          kind: "askQuestion",
          nodeId: node.id,
          text: textoDoNo(node, state.variables),
          options: alternativas(node),
        });
        return {
          state: { ...state, status: "waiting_reply", conversationStatus: "waiting_reply" },
          effects,
        };
      }

      case "condition": {
        // ⚠️ O NÓ DE CONDIÇÃO NÃO AVALIA NADA SOZINHO. Quem carrega a comparação
        // é a TRANSIÇÃO (`{type:"variable", name, operator, value}`) — o nó só marca o
        // ponto do desenho em que a bifurcação acontece. Assim acrescentar um
        // terceiro caminho é acrescentar uma seta, não editar o nó.
        const saida = escolherTransicao(definition, node.id, state.variables, null);
        if (!saida) {
          return { state, effects: [...effects, erro(node.id, "no_matching_transition")] };
        }
        noAtual = saida.targetNodeId;
        break;
      }

      case "action": {
        effects.push({
          kind: "runAction",
          nodeId: node.id,
          actionKey: campoTexto(node, "actionKey") ?? "",
          arguments: argumentos(node, state.variables),
        });
        // Para e espera o handler. A retomada é `advanceFlow(..., {kind:
        // "actionResult"})`.
        return { state: { ...state, status: "running" }, effects };
      }

      case "attendant": {
        const teamKey = campoTexto(node, "teamKey") ?? "";
        effects.push({
          kind: "assignTeam",
          nodeId: node.id,
          teamKey,
          message: campoTexto(node, "message"),
          // O compromisso de prazo e a posição na fila (Prompt 2, §12). Quem
          // cobra os dois é a tela de atendimento — o motor só os carrega.
          slaMinutes: numero(node, "slaMinutes"),
          priority: campoTexto(node, "priority") ?? "normal",
        });
        return {
          state: {
            ...state,
            status: "handed_off",
            // §13. As duas dimensões andam juntas AQUI e só aqui: o motor sai de
            // cena e uma pessoa entra. Em qualquer outro ponto elas são
            // independentes.
            conversationStatus: "in_service",
            assignedTeamKey: teamKey,
          },
          effects,
        };
      }

      case "end": {
        effects.push({ kind: "complete", nodeId: node.id, message: campoTexto(node, "message") });
        return {
          state: { ...state, status: "completed", conversationStatus: "resolved" },
          effects,
        };
      }
    }
  }

  // Estourou o teto: o desenho circula sem nunca parar. Ver `LIMITE_DE_SALTOS`.
  return {
    state: { ...state, status: "failed" },
    effects: [...effects, erro(noAtual, "hop_limit")],
  };
}

/* -------------------------------------------------------------------------- */
/* A escolha da saída                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A primeira transição cuja condição casa, na ordem de prioridade.
 *
 * ⚠️ A ORDEM É PARTE DO CONTRATO, e ela vem do jsonb congelado — que
 * `compile_flow_definition()` gravou ordenado por `(source, priority, id)`. Sem
 * uma ordem estável, duas condições que casassem produziriam caminhos
 * diferentes em execuções idênticas, e o defeito seria irreproduzível.
 *
 * O desempate final pelo `id` existe para o caso de duas transições com a mesma
 * prioridade: continua arbitrário, mas deixa de ser aleatório.
 */
function escolherTransicao(
  definition: FlowDefinition,
  sourceNodeId: string,
  variables: FlowVariables,
  respostaEscolhida: string | null,
): CompiledFlowTransition | null {
  const saidas = definition.transitions
    .filter((t) => t.sourceNodeId === sourceNodeId)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  for (const transicao of saidas) {
    if (condicaoCasa(transicao, variables, respostaEscolhida)) return transicao;
  }

  return null;
}

function condicaoCasa(
  transicao: CompiledFlowTransition,
  variables: FlowVariables,
  respostaEscolhida: string | null,
): boolean {
  switch (transicao.condition.type) {
    case "always":
      return true;
    case "answer":
      // §9. Compara CHAVE com CHAVE. Nunca um índice, nunca o rótulo.
      return respostaEscolhida !== null && transicao.condition.optionKey === respostaEscolhida;
    case "variable":
      return comparar(
        variables[transicao.condition.name],
        transicao.condition.operator,
        transicao.condition.value,
      );
  }
}

/**
 * Os cinco operadores de condição (Prompt 2, §10).
 *
 * ⚠️ `gt`/`lt` SÓ COMPARAM NÚMERO, E RECUSAM O RESTO. Deixar `>` cair na
 * comparação de texto daria sempre uma resposta — a ordem alfabética —, e ela
 * estaria errada de um jeito plausível: em texto, "10" é MENOR que "9". Um
 * fluxo que mandasse pedidos acima de 9 unidades para outro time atenderia
 * errado sem nunca falhar.
 *
 * Diante de um valor não numérico a condição simplesmente não casa, e o desenho
 * segue para a saída padrão — que é o comportamento previsível.
 *
 * ⚠️ VARIÁVEL AUSENTE NUNCA CASA, nem em `neq`. É tentador dizer que "não
 * definido é diferente de X" — mas isso faria uma pergunta que a pessoa ainda
 * não respondeu escolher um caminho, o que é adivinhação com cara de regra.
 */
function comparar(atual: string | undefined, operador: string, esperado: string): boolean {
  if (atual === undefined) return false;

  switch (operador) {
    case "eq":
      return atual === esperado;
    case "neq":
      return atual !== esperado;
    case "contains":
      return normalizeForSearch(atual).includes(normalizeForSearch(esperado));
    case "gt":
    case "lt": {
      const a = Number(atual.replace(",", "."));
      const b = Number(esperado.replace(",", "."));
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return operador === "gt" ? a > b : a < b;
    }
    default:
      // Um operador que este build não conhece não escolhe caminho nenhum. É a
      // mesma postura do retrato congelado: um documento antigo pode citar algo
      // que o código de hoje não entende, e a resposta certa é não decidir.
      return false;
  }
}

/* -------------------------------------------------------------------------- */
/* A leitura da resposta                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Traduz o que a pessoa escreveu para a CHAVE de uma alternativa.
 *
 * ⚠️ O NÚMERO É ACEITO, E ISSO NÃO CONTRARIA O §9. Uma lista numerada é como uma
 * mensagem de WhatsApp apresenta opções — a pessoa responde "2" porque foi isso
 * que ela leu. O que o §9 proíbe é o número virar REGRA: aqui ele é traduzido
 * para `EVENTOS` na primeira linha em que é lido, e nada além desta função sabe
 * que existiu um número. Reordenar as alternativas na tela muda o número e não
 * muda a chave — que é a garantia que o §9 pede.
 *
 * A ordem das tentativas vai do mais específico ao mais tolerante: a chave
 * exata, o rótulo, e por fim a posição.
 */
export function casarAlternativa(
  texto: string,
  options: readonly FlowQuestionOption[],
): FlowQuestionOption | null {
  const limpo = texto.trim();
  if (limpo === "" || options.length === 0) return null;

  const porChave = options.find((o) => o.key === limpo.toUpperCase());
  if (porChave) return porChave;

  const normalizado = normalizeForSearch(limpo);
  const porRotulo = options.find((o) => normalizeForSearch(o.label) === normalizado);
  if (porRotulo) return porRotulo;

  // Só um número inteiro puro conta. "2 eventos" não é uma escolha de posição —
  // é uma frase, e tratá-la como "2" mandaria a pessoa para um caminho que ela
  // não pediu.
  if (/^\d{1,2}$/.test(limpo)) {
    const posicao = Number.parseInt(limpo, 10);
    if (posicao >= 1 && posicao <= options.length) return options[posicao - 1] ?? null;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Leituras defensivas do jsonb congelado                                     */
/* -------------------------------------------------------------------------- */

function acharNode(definition: FlowDefinition, id: string): CompiledFlowNode | null {
  return definition.nodes.find((n) => n.id === id) ?? null;
}

function campoTexto(node: CompiledFlowNode, campo: string): string | null {
  const valor = node.configuration[campo];
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

function numero(node: CompiledFlowNode, campo: string): number | null {
  const valor = node.configuration[campo];
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

/** Ausente conta como LIGADO: um retrato antigo não tinha este campo. */
function habilitado(node: CompiledFlowNode): boolean {
  return node.configuration.enabled !== false;
}

/**
 * O texto do nó com as variáveis substituídas (Prompt 2, §7).
 *
 * ⚠️ ISTO NÃO É UM MOTOR DE TEMPLATE, E NÃO DEVE VIRAR UM. Ele troca
 * `{{nome}}` pelo que a conversa coletou, e nada mais — sem condicional, sem
 * laço, sem chamada. O texto que sai daqui foi ESCRITO por alguém na
 * configuração do nó; o que muda é só o buraco preenchido.
 *
 * ⚠️ UMA VARIÁVEL QUE NÃO EXISTE VIRA STRING VAZIA, e não fica como
 * `{{nome}}` na tela da pessoa. Mostrar a chave crua num WhatsApp é o tipo de
 * vazamento que faz a associação parecer quebrada — "Olá !" é feio, "Olá
 * {{nome}}!" é constrangedor.
 */
export function interpolar(texto: string, variables: FlowVariables): string {
  return texto.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi, (_, nome: string) => {
    return variables[nome] ?? "";
  });
}

/** O texto do nó, ou o nome dele. Nunca uma frase inventada aqui. */
function textoDoNo(node: CompiledFlowNode, variables: FlowVariables): string {
  return interpolar(campoTexto(node, "text") ?? node.name, variables);
}

/** O tipo da pergunta (Prompt 2, §8). Ausente = botões, como o schema. */
function tipoDaPergunta(node: CompiledFlowNode): string {
  return campoTexto(node, "kind") ?? "buttons";
}

/** Texto livre e número não têm alternativa a casar — a resposta É o valor. */
function perguntaAberta(node: CompiledFlowNode): boolean {
  const tipo = tipoDaPergunta(node);
  return tipo === "free_text" || tipo === "number";
}

function ehNumero(texto: string): boolean {
  return Number.isFinite(Number(texto.replace(",", ".")));
}

function alternativas(node: CompiledFlowNode): FlowQuestionOption[] {
  // SIM/NÃO não guarda alternativa no desenho: as duas são fixas, com chave
  // estável, para que todo fluxo do sistema use as MESMAS — e uma condição
  // escrita como `SIM` continue valendo em qualquer lugar.
  if (tipoDaPergunta(node) === "yes_no") {
    return [
      { key: "SIM", label: "Sim" },
      { key: "NAO", label: "Não" },
    ];
  }

  const bruto = node.configuration.options;
  if (!Array.isArray(bruto)) return [];

  return bruto.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const { key, label } = item as { key?: unknown; label?: unknown };
    if (typeof key !== "string" || typeof label !== "string") return [];
    return [{ key, label }];
  });
}

/** Os parâmetros da ação, resolvidos a partir das variáveis do contexto. */
function argumentos(node: CompiledFlowNode, variables: FlowVariables): Record<string, string> {
  const mapa = node.configuration.arguments;
  if (typeof mapa !== "object" || mapa === null || Array.isArray(mapa)) return {};

  const resolvidos: Record<string, string> = {};
  for (const [parametro, variavel] of Object.entries(mapa as Record<string, unknown>)) {
    if (typeof variavel !== "string") continue;
    const valor = variables[variavel];
    if (valor !== undefined) resolvidos[parametro] = valor;
  }
  return resolvidos;
}

function erro(nodeId: string | null, reason: FlowEngineFailure): FlowEffect {
  return { kind: "fail", nodeId, reason };
}

function falhar(
  state: FlowEngineState,
  nodeId: string | null,
  reason: FlowEngineFailure,
): FlowEngineResult {
  return { state: { ...state, status: "failed" }, effects: [erro(nodeId, reason)] };
}

/** O estado de uma execução que ainda não começou. */
export function initialFlowState(): FlowEngineState {
  return {
    currentNodeId: null,
    variables: {},
    status: "running",
    conversationStatus: "new",
    assignedTeamKey: null,
  };
}
