import { FLOW_NODE_TYPE_HINTS, FLOW_NODE_TYPE_LABELS } from "./flow.labels";
import { YES_NO_OPTIONS, type ConditionOperator, type QuestionKind } from "./flow.schema";
import type { FlowNode, FlowNodeType, FlowTransition, FlowTransitionCondition } from "./flow.types";

/**
 * As decisões do BUILDER que não dependem de React.
 *
 * ⚠️ ELAS MORAM AQUI, E NÃO DENTRO DO COMPONENTE, POR UM MOTIVO PRÁTICO: são as
 * únicas partes do desenhador que dá para testar sem montar um canvas. "Qual
 * condição uma seta nova recebe" e "qual chave um nó novo ganha" são regras de
 * negócio disfarçadas de detalhe de tela — e as duas, se erradas, produzem um
 * fluxo que atende errado sem nada quebrar.
 */

/* -------------------------------------------------------------------------- */
/* A caixa de ferramentas (§3)                                                */
/* -------------------------------------------------------------------------- */

export interface PaletteItem {
  type: FlowNodeType;
  label: string;
  hint: string;
  /**
   * O símbolo do §4 do Prompt 2. Emoji, e não ícone de biblioteca: ele precisa
   * aparecer IGUAL na caixa de ferramentas, na caixinha do canvas e no
   * simulador — três lugares que renderizam de formas diferentes.
   */
  glyph: string;
}

/**
 * ⚠️ DECLARADO ANTES DE `NODE_PALETTE`, E A ORDEM É OBRIGATÓRIA. A paleta é
 * montada na carga do módulo e LÊ este objeto; um `const` declarado depois
 * ainda está na zona morta temporal nesse instante, e o módulo quebraria ao ser
 * importado — não no uso, na importação.
 */
export const NODE_GLYPHS: Record<FlowNodeType, string> = {
  message: "💬",
  question: "❓",
  condition: "🔀",
  action: "⚙",
  attendant: "👤",
  end: "■",
};

export const NODE_PALETTE: PaletteItem[] = (
  ["message", "question", "condition", "action", "attendant", "end"] as const
).map((type) => ({
  type,
  label: FLOW_NODE_TYPE_LABELS[type],
  hint: FLOW_NODE_TYPE_HINTS[type],
  glyph: NODE_GLYPHS[type],
}));

/* -------------------------------------------------------------------------- */
/* Um nó novo                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A configuração com que cada tipo nasce.
 *
 * ⚠️ NASCER VÁLIDO IMPORTA MAIS DO QUE PARECE. Um nó de pergunta que nascesse
 * sem alternativas seria salvo, apareceria no canvas e só reclamaria na
 * publicação — e a pessoa teria de descobrir sozinha que o problema era aquele
 * nó, entre quarenta. Nascer com duas alternativas em branco faz o painel de
 * propriedades já mostrar o que falta preencher.
 */
export function defaultNodeConfiguration(type: FlowNodeType): Record<string, unknown> {
  switch (type) {
    case "message":
      return { text: "", delaySeconds: 0, enabled: true };
    case "question":
      return {
        text: "",
        kind: "buttons" satisfies QuestionKind,
        variable: "resposta",
        options: [
          { key: "OPCAO_1", label: "" },
          { key: "OPCAO_2", label: "" },
        ],
      };
    case "condition":
      return { variable: "resposta" };
    case "action":
      return { actionKey: "consultar_bolsa", arguments: {} };
    case "attendant":
      return { teamKey: "", priority: "normal" };
    case "end":
      return {};
  }
}

/** Os prefixos de chave por tipo. Curtos porque o sufixo numérico vem junto. */
const KEY_PREFIX: Record<FlowNodeType, string> = {
  message: "MENSAGEM",
  question: "PERGUNTA",
  condition: "CONDICAO",
  action: "ACAO",
  attendant: "TRANSFERIR",
  end: "FIM",
};

/**
 * Uma chave estável, livre, legível — sem pedir nada à pessoa.
 *
 * ⚠️ O BUILDER NÃO PODE PEDIR A CHAVE NA CRIAÇÃO. Ela é uma exigência do §10
 * (regra ≠ rótulo), mas não é uma decisão que quem desenha um fluxo queira
 * tomar ao arrastar uma caixinha — e um campo obrigatório ali faria a primeira
 * experiência do Builder ser preencher um identificador técnico.
 *
 * Então ela é gerada, fica visível no painel de propriedades e pode ser
 * trocada. O formato bate com o CHECK `flow_nodes_key_format`.
 */
export function suggestNodeKey(type: FlowNodeType, existentes: readonly string[]): string {
  const usadas = new Set(existentes);
  const prefixo = KEY_PREFIX[type];

  if (!usadas.has(prefixo)) return prefixo;

  for (let n = 2; n < 1000; n += 1) {
    const candidata = `${prefixo}_${n}`;
    if (!usadas.has(candidata)) return candidata;
  }

  return `${prefixo}_${Date.now().toString().slice(-6)}`;
}

/* -------------------------------------------------------------------------- */
/* As saídas de um nó                                                         */
/* -------------------------------------------------------------------------- */

export interface NodeOutlet {
  /** O `sourceHandle` do React Flow. */
  id: string;
  label: string;
  /** A condição que uma seta saindo daqui recebe. */
  condition: FlowTransitionCondition;
}

/**
 * QUANTAS SETAS SAEM DE UM NÓ, E O QUE CADA UMA SIGNIFICA.
 *
 * ⚠️ ESTA FUNÇÃO É O §9 FEITO INTERFACE, e é a peça mais importante do Builder.
 *
 * Uma pergunta de escolha ganha UM PONTO DE SAÍDA POR ALTERNATIVA, cada um já
 * carregando a CHAVE daquela alternativa. Quando a pessoa arrasta da bolinha
 * "Eventos" até o nó de destino, a condição `{answer, EVENTOS}` é montada aqui —
 * ela nunca digita a chave, nunca escolhe um número, e não existe caminho pelo
 * qual uma seta acabe ligada a uma POSIÇÃO.
 *
 * Reordenar as alternativas no painel move as bolinhas e mantém as setas, porque
 * o que liga as duas coisas é a chave.
 *
 * Os demais tipos têm uma saída só (`out`), e a condição delas — quando houver —
 * é escrita no painel da própria seta. É a diferença entre "a pergunta define os
 * caminhos" e "a condição compara valores".
 */
export function nodeOutlets(node: {
  type: FlowNodeType;
  configuration: Record<string, unknown>;
}): NodeOutlet[] {
  if (node.type === "end") return [];

  if (node.type === "question") {
    const kind = leituraTexto(node.configuration, "kind") ?? "buttons";

    if (kind === "yes_no") {
      return YES_NO_OPTIONS.map((o) => ({
        id: o.key,
        label: o.label,
        condition: { type: "answer", optionKey: o.key },
      }));
    }

    if (kind === "buttons" || kind === "list") {
      return alternativas(node.configuration).map((o) => ({
        id: o.key,
        // A bolinha mostra o RÓTULO (é o que a pessoa reconhece) e a chave fica
        // no título — visível ao passar o mouse, e no painel de propriedades.
        label: o.label.trim() === "" ? o.key : o.label,
        condition: { type: "answer", optionKey: o.key },
      }));
    }

    // Texto livre e número: a resposta É o valor, e o fluxo segue por uma saída
    // só. Ver `open_question_branches` em `validate_flow_version`.
  }

  return [{ id: "out", label: "", condition: { type: "always" } }];
}

/**
 * A condição que uma ligação nova recebe.
 *
 * Devolve `null` quando a saída não existe mais — o que acontece quando alguém
 * apaga uma alternativa e o canvas ainda não recarregou.
 */
export function conditionForConnection(
  node: { type: FlowNodeType; configuration: Record<string, unknown> },
  sourceHandle: string | null,
): FlowTransitionCondition | null {
  const saidas = nodeOutlets(node);
  if (saidas.length === 0) return null;

  if (sourceHandle === null) return saidas[0]?.condition ?? null;
  return saidas.find((s) => s.id === sourceHandle)?.condition ?? null;
}

/** De qual bolinha uma seta existente sai — para o canvas redesenhá-la. */
export function handleForTransition(condition: FlowTransitionCondition): string {
  return condition.type === "answer" ? condition.optionKey : "out";
}

/* -------------------------------------------------------------------------- */
/* O que a seta mostra                                                        */
/* -------------------------------------------------------------------------- */

const OPERADOR_LABELS: Record<ConditionOperator, string> = {
  eq: "é",
  neq: "não é",
  contains: "contém",
  gt: "maior que",
  lt: "menor que",
};

/**
 * O rótulo de uma seta, em português.
 *
 * ⚠️ O RÓTULO ESCRITO À MÃO GANHA DA CONDIÇÃO. Quem escreveu "cliente já
 * associado" na seta quis dizer algo que `tipo é ASSOCIADO` não diz tão bem — e
 * sobrepor isso com a regra crua transformaria um desenho legível numa planilha.
 */
export function transitionLabel(
  transition: Pick<FlowTransition, "condition" | "label">,
  opcoesDoNo: readonly { key: string; label: string }[] = [],
): string {
  if (transition.label && transition.label.trim() !== "") return transition.label;

  switch (transition.condition.type) {
    case "always":
      return "";
    case "answer": {
      // ⚠️ A CHAVE SAI PARA UMA CONSTANTE ANTES DO `find`. Dentro da função de
      // busca o TypeScript perde o estreitamento da união — `condition` volta a
      // ser "qualquer uma das três" e `optionKey` deixa de existir.
      const { optionKey } = transition.condition;
      const opcao = opcoesDoNo.find((o) => o.key === optionKey);
      // O rótulo da alternativa, quando existe; a chave, quando a alternativa
      // foi apagada — que é justamente quando a pessoa precisa ver a chave para
      // entender que aquela seta ficou órfã.
      return opcao?.label?.trim() || optionKey;
    }
    case "variable": {
      const { name, operator, value } = transition.condition;
      return `${name} ${OPERADOR_LABELS[operator] ?? operator} ${value}`;
    }
  }
}

/** As alternativas de um nó de pergunta, defensivamente. */
export function alternativas(
  configuration: Record<string, unknown>,
): { key: string; label: string }[] {
  const bruto = configuration.options;
  if (!Array.isArray(bruto)) return [];

  return bruto.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const { key, label } = item as { key?: unknown; label?: unknown };
    if (typeof key !== "string") return [];
    return [{ key, label: typeof label === "string" ? label : "" }];
  });
}

function leituraTexto(configuration: Record<string, unknown>, campo: string): string | null {
  const valor = configuration[campo];
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

/* -------------------------------------------------------------------------- */
/* As pendências, por nó (§13)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Liga cada pendência ao nó que ela acusa, para o selo aparecer na caixinha.
 *
 * ⚠️ A LIGAÇÃO É PELA CHAVE ENTRE ASPAS, e ela é a única costura possível: o
 * banco devolve `(code, detail)` e mais nada — não há id de nó no retorno de
 * `validate_flow_version`, porque a mesma lista precisa servir a quem lê a
 * mensagem sem ter o desenho na mão.
 *
 * ⚠️ E ELA É UM ÍNDICE, NÃO UMA BUSCA. A versão anterior fazia
 * `nodes.find(n => detail.includes(n.key))` DENTRO do laço de pendências — ou
 * seja, pendências × nós comparações de texto, refeitas a cada quadro do
 * arrastar. Num fluxo de mil nós (§23) isso é dezenas de milhares de `includes`
 * por quadro, e o canvas engasga justamente no fluxo grande que o §23 manda
 * manter navegável.
 *
 * Aqui é um mapa montado uma vez: nós + pendências, e não o produto dos dois.
 */
export function issuesByNodeId(
  issues: readonly { code: string; detail: string }[],
  nodes: readonly Pick<FlowNode, "id" | "key">[],
): Map<string, string> {
  const porChave = new Map(nodes.map((n) => [n.key, n.id]));
  const porNo = new Map<string, string>();

  for (const issue of issues) {
    const chave = /"([A-Z][A-Z0-9_]*)"/.exec(issue.detail)?.[1];
    if (chave === undefined) continue;

    const id = porChave.get(chave);
    // A primeira pendência ganha o selo: a caixinha tem lugar para uma frase, e
    // a lista completa está no painel lateral.
    if (id !== undefined && !porNo.has(id)) porNo.set(id, issue.detail);
  }

  return porNo;
}

/* -------------------------------------------------------------------------- */
/* A busca do canvas (§19)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Procura por nome, chave, texto e alternativa.
 *
 * ⚠️ PROCURA DENTRO DO TEXTO DA MENSAGEM, e é o que faz a busca servir para
 * algo. Num fluxo de cem nós, ninguém lembra em qual caixinha está a frase
 * "horário de atendimento" — mas é essa frase que a pessoa quer achar. Buscar só
 * pelo nome do nó devolveria "Mensagem 14", que ela também não lembra.
 */
export function nodeMatchesSearch(node: FlowNode, termo: string): boolean {
  const busca = termo.trim().toLowerCase();
  if (busca === "") return false;

  const pedacos = [
    node.name,
    node.key,
    leituraTexto(node.configuration, "text") ?? "",
    leituraTexto(node.configuration, "teamKey") ?? "",
    leituraTexto(node.configuration, "actionKey") ?? "",
    ...alternativas(node.configuration).flatMap((o) => [o.key, o.label]),
  ];

  return pedacos.some((p) => p.toLowerCase().includes(busca));
}
