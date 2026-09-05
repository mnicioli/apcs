import { evaluateCondition } from "./flow.operators";
import type { CompiledFlowTransition, FlowDefinition, FlowVariables } from "./flow.types";

/**
 * A ESCOLHA DA SAÍDA — o "Transition Resolver" do §45 do Prompt 3.
 *
 * ⚠️ ELE ESTÁ SOZINHO NUM ARQUIVO PORQUE É A ÚNICA DECISÃO DE RUMO DO SISTEMA.
 * Todo executor de nó termina perguntando "e agora, para onde?", e a resposta
 * precisa ser a MESMA pergunta feita do mesmo jeito em todos eles. Espalhada,
 * ela viraria seis leituras parecidas da lista de transições — e a sétima,
 * escrita por outra pessoa em outro mês, ordenaria diferente.
 *
 * É aqui, e só aqui, que se decide qual seta do desenho é seguida.
 */

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
 *
 * ⚠️ E É ISTO QUE IMPLEMENTA O `IF / ELSE IF / ELSE` DO §13, sem que a palavra
 * "else" exista em lugar nenhum. Três setas saindo do mesmo nó de condição,
 * com prioridades 0, 1 e 2:
 *
 *     0   idade < 18            → Menor
 *     1   idade < 60            → Adulto
 *     2   sempre                → Sênior
 *
 * A segunda só é avaliada porque a primeira não casou — que é exatamente o que
 * `else if` significa. A última, com condição `always`, é o `else`. Desenhar
 * isso é arrastar três setas; não é escrever uma estrutura aninhada que só o
 * programador enxergaria.
 */
export function resolveTransition(
  definition: FlowDefinition,
  sourceNodeId: string,
  variables: FlowVariables,
  respostaEscolhida: string | null,
): CompiledFlowTransition | null {
  const saidas = definition.transitions
    .filter((t) => t.sourceNodeId === sourceNodeId)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  for (const transicao of saidas) {
    if (transitionMatches(transicao, variables, respostaEscolhida)) return transicao;
  }

  return null;
}

/**
 * Esta seta serve, dado o contexto?
 *
 * `respostaEscolhida` é a CHAVE da alternativa que a pessoa acabou de escolher,
 * e vale para uma única avaliação: a do nó de pergunta de onde ela saiu. Depois
 * disso é `null`, e uma condição `answer` encontrada mais adiante no caminho
 * simplesmente não casa — o que é o certo, porque ela pergunta sobre uma
 * escolha que não está mais sendo feita.
 */
export function transitionMatches(
  transicao: CompiledFlowTransition,
  variables: FlowVariables,
  respostaEscolhida: string | null,
): boolean {
  switch (transicao.condition.type) {
    case "always":
      return true;

    case "answer":
      // §9 do Prompt 2. Compara CHAVE com CHAVE. Nunca um índice, nunca o rótulo.
      return respostaEscolhida !== null && transicao.condition.optionKey === respostaEscolhida;

    case "variable":
      return evaluateCondition(
        variables[transicao.condition.name],
        transicao.condition.operator,
        transicao.condition.value,
      );
  }
}

/** Quantas saídas o nó tem. O validador usa; o motor, para explicar a falha. */
export function outgoingTransitions(
  definition: FlowDefinition,
  sourceNodeId: string,
): CompiledFlowTransition[] {
  return definition.transitions.filter((t) => t.sourceNodeId === sourceNodeId);
}
