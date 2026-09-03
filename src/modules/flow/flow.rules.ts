import { isFlowActionKey, isFlowActionReady, type FlowActionKey } from "./flow.actions.registry";
import type {
  Flow,
  FlowNode,
  FlowRun,
  FlowTransition,
  FlowValidationIssue,
  FlowVersion,
  FlowVersionStatus,
} from "./flow.types";

/**
 * Regras puras dos Fluxos de Atendimento. Sem banco, sem React — só decisão.
 *
 * ⚠️ ONDE ESTE ARQUIVO É AUTORIDADE E ONDE NÃO É:
 *
 * Ele NÃO decide se uma versão pode ser publicada. Quem decide é
 * `validate_flow_version()`, no banco, porque é lá que a regra vale para todo
 * caminho — a tela, uma chamada direta ao PostgREST, um psql. O que existe aqui
 * é a LEITURA da mesma regra, para o botão "Publicar" poder ficar desabilitado
 * COM O MOTIVO À VISTA em vez de mandar a pessoa descobrir no erro.
 *
 * As duas precisam contar a mesma história, e `flow.rules.test.ts` confere caso
 * a caso. Se divergirem, quem está certo é o banco.
 *
 * ⚠️ COM UMA EXCEÇÃO DECLARADA, e ela é `action_not_ready`. Saber se a ação
 * `consultar_bolsa` tem handler ligado é uma propriedade do CÓDIGO QUE ESTÁ NO
 * AR, não do banco — o Postgres não tem como conhecê-la. Esta é a única regra
 * cuja barreira mora do lado do TypeScript (na action de publicar), e está
 * escrita aqui em vez de escondida lá justamente para não parecer um descuido.
 */

/* -------------------------------------------------------------------------- */
/* O ciclo de vida (§4)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * As transições permitidas — a MESMA tabela de `advance_flow_version`.
 *
 * ⚠️ ELA PERMITE VOLTAR PARA RASCUNHO, e isso não é frouxidão. O teste é
 * justamente onde se descobre que o desenho está errado; sem o caminho de
 * volta, corrigir uma vírgula exigiria criar mais uma versão — e o histórico se
 * encheria de v4, v5, v6 que nunca atenderam ninguém.
 *
 * `published` e `superseded` não aparecem aqui de propósito: publicar não é um
 * avanço de situação, é uma operação com validação, compilação e troca da
 * versão ativa. Ela mora em `publish_flow_version`.
 */
const AVANCOS: Record<FlowVersionStatus, readonly FlowVersionStatus[]> = {
  draft: ["testing"],
  testing: ["draft", "pending_approval"],
  pending_approval: ["draft", "approved"],
  approved: ["draft"],
  published: [],
  superseded: [],
};

export function canAdvanceVersion(from: FlowVersionStatus, to: FlowVersionStatus): boolean {
  return AVANCOS[from].includes(to);
}

/**
 * A REGRA 1 DO MÓDULO: só se edita rascunho (§22).
 *
 * Quem a impõe é o gatilho `flow_graph_draft_only` no banco. Esta função existe
 * para a tela não OFERECER o que vai ser recusado — um botão de editar que
 * devolve erro é pior do que um botão ausente.
 */
export function isVersionEditable(status: FlowVersionStatus): boolean {
  return status === "draft";
}

/** Aprovada é o único ponto de partida normal para publicar; substituída é o §23. */
export function canPublishVersion(status: FlowVersionStatus): boolean {
  return status === "approved" || status === "superseded";
}

/**
 * §23. Publicar uma versão SUBSTITUÍDA é um rollback — e a tela precisa dizer
 * isso, porque o botão é o mesmo e a consequência não é.
 */
export function isRollback(status: FlowVersionStatus): boolean {
  return status === "superseded";
}

/**
 * §22. Um fluxo que já publicou ou já atendeu é histórico.
 *
 * Espelha `delete_flow`. O banco recusaria de qualquer forma (as execuções
 * apontam com `on delete restrict`), mas com uma mensagem sobre chave
 * estrangeira em vez de uma frase.
 */
export function canDeleteFlow(flow: Flow, versions: readonly FlowVersion[]): boolean {
  if (flow.activeVersionId !== null) return false;
  return !versions.some((v) => v.status === "published" || v.status === "superseded");
}

/* -------------------------------------------------------------------------- */
/* A validação do §19 — o espelho                                             */
/* -------------------------------------------------------------------------- */

export interface FlowGraph {
  nodes: readonly FlowNode[];
  transitions: readonly FlowTransition[];
}

/**
 * Os problemas que impedem a publicação, na ordem em que se conserta.
 *
 * ⚠️ DEVOLVE A LISTA, E NÃO UM BOOLEANO. Diante de um desenho de quarenta nós,
 * "fluxo inválido" manda caçar. Cada linha daqui já diz qual nó olhar.
 *
 * `activeTeamKeys` vem de fora porque times mudam sem que o fluxo mude (§11) —
 * é justamente por isso que um fluxo que era válido em agosto pode deixar de
 * ser em setembro, sem ninguém ter tocado nele.
 */
export function validateFlowGraph(
  graph: FlowGraph,
  activeTeamKeys: readonly string[],
): FlowValidationIssue[] {
  const problemas: FlowValidationIssue[] = [];
  const { nodes, transitions } = graph;

  if (!nodes.some((n) => n.isStart)) {
    problemas.push({ code: "missing_start", detail: "O fluxo precisa de um nó inicial." });
  }

  if (!nodes.some((n) => n.type === "end")) {
    problemas.push({
      code: "missing_end",
      detail: "O fluxo precisa de ao menos um nó de encerramento.",
    });
  }

  const comSaida = new Set(transitions.map((t) => t.sourceNodeId));
  const comEntrada = new Set(transitions.map((t) => t.targetNodeId));

  for (const node of nodes) {
    // O beco sem saída: o motor chega e não tem o que fazer. `end` encerra e
    // `attendant` entrega a conversa a uma pessoa — os dois são finais legítimos.
    if (node.type !== "end" && node.type !== "attendant" && !comSaida.has(node.id)) {
      problemas.push({
        code: "dead_end",
        detail: `O nó "${node.key}" não tem saída e não encerra o atendimento.`,
      });
    }

    // O nó órfão. Não quebra nada em execução — e é por isso que passa
    // despercebido até alguém perguntar por que aquela pergunta nunca aparece.
    if (!node.isStart && !comEntrada.has(node.id)) {
      problemas.push({
        code: "unreachable",
        detail: `O nó "${node.key}" não é alcançado por nenhuma transição.`,
      });
    }

    if (node.type === "question" && contarAlternativas(node) < 2) {
      problemas.push({
        code: "question_without_options",
        detail: `A pergunta "${node.key}" não tem alternativas configuradas.`,
      });
    }

    if (node.type === "attendant") {
      const teamKey = leitura(node, "teamKey");
      if (teamKey === null || !activeTeamKeys.includes(teamKey)) {
        problemas.push({
          code: "attendant_without_team",
          detail: `O nó "${node.key}" não aponta para um time ativo.`,
        });
      }
    }
  }

  return problemas;
}

/**
 * As ações desenhadas que ainda não têm handler ligado.
 *
 * ⚠️ SEPARADA DE `validateFlowGraph` DE PROPÓSITO — ver o aviso do topo. Esta é
 * a única regra que o banco não consegue conferir, porque a resposta depende de
 * qual build do Next está no ar. Devolve as CHAVES, e não frases, para quem
 * chamar poder montar a mensagem com o rótulo do registro.
 */
export function pendingFlowActions(graph: FlowGraph): FlowActionKey[] {
  const pendentes = new Set<FlowActionKey>();

  for (const node of graph.nodes) {
    if (node.type !== "action") continue;
    const chave = leitura(node, "actionKey");
    if (chave === null || !isFlowActionKey(chave)) continue;
    if (!isFlowActionReady(chave)) pendentes.add(chave);
  }

  return [...pendentes];
}

/* -------------------------------------------------------------------------- */
/* O resumo para quem vai atender (§16)                                       */
/* -------------------------------------------------------------------------- */

export interface HandoffSummaryLine {
  label: string;
  value: string;
}

/**
 * O que a pessoa do time lê ao receber a conversa.
 *
 * ⚠️ NADA AQUI É GERADO POR IA, e o §16 diz que não precisa ser. O que este
 * resumo mostra são as VARIÁVEIS que a triagem coletou (§15) — ou seja, o que a
 * própria pessoa respondeu. Um parágrafo redigido por um modelo a partir dos
 * mesmos dados acrescentaria uma chance de estar errado sobre o que já está
 * escrito, o que é o pior negócio possível numa tela de atendimento.
 *
 * O dia em que houver geração, ela entra COMO UM CAMPO A MAIS, embaixo destes —
 * nunca no lugar deles.
 */
export function handoffSummary(run: FlowRun): HandoffSummaryLine[] {
  const linhas: HandoffSummaryLine[] = [];

  if (run.intent) {
    linhas.push({ label: "Intenção identificada", value: run.intent });
  }

  // A ordem das variáveis é a de inserção, que é a ordem em que a pessoa
  // respondeu — a leitura acompanha a conversa em vez de ordenar por alfabeto.
  for (const [nome, valor] of Object.entries(run.variables)) {
    if (valor.trim() === "") continue;
    linhas.push({ label: nome, value: valor });
  }

  if (run.assignedTeamKey) {
    linhas.push({ label: "Direcionado para", value: run.assignedTeamKey });
  }

  return linhas;
}

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Lê um campo de texto da configuração de um nó.
 *
 * A configuração é `Record<string, unknown>` porque a coluna é jsonb livre (a
 * forma é imposta por Zod na escrita). Aqui, na LEITURA, tudo precisa ser
 * defensivo: um retrato congelado em agosto pode ter sido escrito por uma
 * versão do sistema que não conhecia este campo.
 */
function leitura(node: { configuration: Record<string, unknown> }, campo: string): string | null {
  const valor = node.configuration[campo];
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

function contarAlternativas(node: { configuration: Record<string, unknown> }): number {
  const options = node.configuration.options;
  return Array.isArray(options) ? options.length : 0;
}
