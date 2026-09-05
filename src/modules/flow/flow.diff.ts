import type { FlowGraph } from "./flow.rules";
import type { FlowNode, FlowNodeType, FlowTransition } from "./flow.types";

/**
 * A COMPARAÇÃO ENTRE DUAS VERSÕES — §39 do Prompt 5.
 *
 * ============================================================================
 * ⚠️ ELE COMPARA POR **CHAVE**, E NÃO POR ID. LEIA ISTO ANTES DE MEXER.
 * ============================================================================
 *
 * `create_flow_version()` COPIA o desenho para a versão nova, e a cópia recebe
 * IDs próprios — é o §3 do Prompt 5 ("nunca compartilhar IDs mutáveis entre
 * versões"), e ele existe por uma razão sólida: IDs compartilhados fariam
 * editar o rascunho mexer na versão que está no ar.
 *
 * A consequência é que um diff por ID veria TUDO como diferente. Toda
 * comparação diria "12 nós removidos, 12 nós adicionados", que é literalmente
 * verdade e completamente inútil — a pergunta de quem compara v3 com v4 é "o
 * que mudou", e a resposta certa é "uma condição".
 *
 * A chave estável (`PERGUNTA_ASSUNTO`, `MENU`) é justamente o que sobrevive à
 * cópia. É ela que responde "este nó é o mesmo daquela versão".
 *
 * ⚠️ E POR ISSO RENOMEAR UMA CHAVE APARECE COMO REMOÇÃO + INCLUSÃO. Está
 * correto, e é a leitura honesta: para todo o resto do sistema — as transições
 * que apontam para ela, as condições que a citam — uma chave nova É um nó novo.
 *
 * ============================================================================
 * ⚠️ E O QUE ELE NÃO FAZ: DIZER SE A MUDANÇA É BOA.
 * ============================================================================
 * Ele lista diferenças. Julgar se trocar o time do Financeiro foi acerto ou
 * engano é a APROVAÇÃO (§22), e ela é de uma pessoa.
 */

export type FlowDiffKind = "added" | "removed" | "changed";

export interface FlowDiffEntry {
  kind: FlowDiffKind;
  /** `node` ou `transition`. */
  target: "node" | "transition";
  /** A chave do nó, ou "ORIGEM → DESTINO" para uma transição. */
  key: string;
  /** O tipo do nó, quando é nó. Serve ao ícone da tela. */
  nodeType: FlowNodeType | null;
  /**
   * O que mudou, em PT-BR e por campo. Vazio em inclusão e remoção — ali a
   * mudança é o próprio item.
   */
  details: string[];
}

export interface FlowDiff {
  entries: FlowDiffEntry[];
  added: number;
  removed: number;
  changed: number;
}

/* -------------------------------------------------------------------------- */
/* Nós                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Os campos de configuração que a comparação OLHA, por tipo de nó.
 *
 * ⚠️ LISTA EXPLÍCITA, E NÃO "TODAS AS CHAVES DO JSONB". Duas razões, e a
 * segunda é a que decide:
 *
 *   • a configuração guarda coisas que não são o desenho — a posição no canvas
 *     muda quando alguém arrasta uma caixinha para enxergar melhor, e "mudou a
 *     posição" no diff é ruído puro;
 *   • um campo novo entra no schema e a comparação passa a citá-lo com o nome
 *     técnico (`onExhausted`), sem rótulo em PT-BR. A tela mostraria uma
 *     palavra que ninguém da APCS reconhece.
 *
 * Acrescentar um campo aqui é uma linha, e é uma decisão consciente sobre o que
 * merece aparecer na comparação.
 */
const CAMPOS_POR_TIPO: Record<FlowNodeType, { campo: string; label: string }[]> = {
  message: [
    { campo: "text", label: "texto da mensagem" },
    { campo: "imageUrl", label: "imagem" },
    { campo: "pdfUrl", label: "PDF" },
    { campo: "delaySeconds", label: "atraso" },
    { campo: "enabled", label: "ativa/desligada" },
  ],
  question: [
    { campo: "text", label: "texto da pergunta" },
    { campo: "kind", label: "tipo de resposta" },
    { campo: "variable", label: "variável" },
    { campo: "options", label: "alternativas" },
    { campo: "maxAttempts", label: "número de tentativas" },
    { campo: "invalidText", label: "texto de resposta inválida" },
    { campo: "onExhausted", label: "desfecho ao esgotar" },
    { campo: "fallbackTeamKey", label: "time do desfecho" },
    { campo: "exhaustedText", label: "texto do desfecho" },
    { campo: "interpretIntent", label: "interpretação de texto livre" },
  ],
  condition: [],
  action: [
    { campo: "actionKey", label: "ação" },
    { campo: "maxAttempts", label: "número de tentativas" },
  ],
  attendant: [
    { campo: "teamKey", label: "time" },
    { campo: "message", label: "mensagem de transferência" },
    { campo: "slaMinutes", label: "prazo (SLA)" },
    { campo: "priority", label: "prioridade" },
  ],
  end: [{ campo: "message", label: "mensagem final" }],
};

/**
 * Compara dois valores de configuração.
 *
 * ⚠️ VIA JSON, E NÃO `===`. As alternativas de uma pergunta são um ARRAY de
 * objetos; a igualdade referencial diria que mudaram sempre, porque são objetos
 * diferentes vindos de duas consultas. Comparar a serialização é grosseiro e
 * responde a pergunta certa: "o conteúdo é o mesmo?".
 *
 * ⚠️ AUSENTE E VAZIO SÃO A MESMA COISA AQUI. Um campo opcional que nunca foi
 * preenchido chega como `undefined` numa versão e como `""` na outra, conforme
 * o caminho que gravou. Tratá-los como diferentes encheria o diff de mudanças
 * que ninguém fez.
 */
function mudou(antes: unknown, depois: unknown): boolean {
  const normal = (v: unknown) => (v === undefined || v === null || v === "" ? null : v);
  return JSON.stringify(normal(antes)) !== JSON.stringify(normal(depois));
}

function compararNos(antes: readonly FlowNode[], depois: readonly FlowNode[]): FlowDiffEntry[] {
  const entradas: FlowDiffEntry[] = [];
  const porChaveAntes = new Map(antes.map((n) => [n.key, n]));
  const porChaveDepois = new Map(depois.map((n) => [n.key, n]));

  for (const node of depois) {
    const anterior = porChaveAntes.get(node.key);

    if (!anterior) {
      entradas.push({
        kind: "added",
        target: "node",
        key: node.key,
        nodeType: node.type,
        details: [],
      });
      continue;
    }

    const detalhes: string[] = [];

    // ⚠️ TROCAR O TIPO DE UM NÓ mantendo a chave é raro e grave: as transições
    // que apontavam para ele continuam apontando, e o comportamento muda por
    // baixo. Merece linha própria, antes dos campos.
    if (anterior.type !== node.type) {
      detalhes.push(`tipo: ${anterior.type} → ${node.type}`);
    }

    if (anterior.name !== node.name) {
      detalhes.push(`nome: “${anterior.name}” → “${node.name}”`);
    }

    for (const { campo, label } of CAMPOS_POR_TIPO[node.type] ?? []) {
      if (mudou(anterior.configuration[campo], node.configuration[campo])) {
        detalhes.push(label);
      }
    }

    if (detalhes.length > 0) {
      entradas.push({
        kind: "changed",
        target: "node",
        key: node.key,
        nodeType: node.type,
        details: detalhes,
      });
    }
  }

  for (const node of antes) {
    if (!porChaveDepois.has(node.key)) {
      entradas.push({
        kind: "removed",
        target: "node",
        key: node.key,
        nodeType: node.type,
        details: [],
      });
    }
  }

  return entradas;
}

/* -------------------------------------------------------------------------- */
/* Transições                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A identidade de uma seta, para efeito de comparação.
 *
 * ⚠️ ORIGEM → DESTINO, PELAS CHAVES DOS NÓS. O id da transição muda na cópia
 * (§3), e a prioridade é justamente uma das coisas que podem ter mudado — usá-la
 * na identidade faria "reordenei as setas" aparecer como "apaguei três e criei
 * outras três".
 *
 * ⚠️ E DUAS SETAS ENTRE O MESMO PAR DE NÓS COLIDEM. Acontece: um `answer` para
 * SIM e outro para NÃO podem apontar para o mesmo destino. O desempate é a
 * condição, que entra na chave — sem ela, o diff diria que uma sumiu.
 */
function chaveDaSeta(t: FlowTransition, chavePorId: Map<string, string>): string {
  const origem = chavePorId.get(t.sourceNodeId) ?? "?";
  const destino = chavePorId.get(t.targetNodeId) ?? "?";
  const condicao =
    t.condition.type === "always"
      ? "sempre"
      : t.condition.type === "answer"
        ? `resposta ${t.condition.optionKey}`
        : `${t.condition.name} ${t.condition.operator}`;

  return `${origem} → ${destino} (${condicao})`;
}

function descreverCondicao(t: FlowTransition): string {
  switch (t.condition.type) {
    case "always":
      return "sempre";
    case "answer":
      return `resposta = ${t.condition.optionKey}`;
    case "variable":
      return `${t.condition.name} ${t.condition.operator} ${t.condition.value}`.trim();
  }
}

function compararSetas(antes: FlowGraph, depois: FlowGraph): FlowDiffEntry[] {
  const entradas: FlowDiffEntry[] = [];

  const chaveAntes = new Map(antes.nodes.map((n) => [n.id, n.key]));
  const chaveDepois = new Map(depois.nodes.map((n) => [n.id, n.key]));

  const mapaAntes = new Map(antes.transitions.map((t) => [chaveDaSeta(t, chaveAntes), t]));
  const mapaDepois = new Map(depois.transitions.map((t) => [chaveDaSeta(t, chaveDepois), t]));

  for (const [chave, seta] of mapaDepois) {
    const anterior = mapaAntes.get(chave);

    if (!anterior) {
      entradas.push({
        kind: "added",
        target: "transition",
        key: chave,
        nodeType: null,
        details: [],
      });
      continue;
    }

    const detalhes: string[] = [];
    if (anterior.priority !== seta.priority) {
      detalhes.push(`prioridade: ${anterior.priority} → ${seta.priority}`);
    }
    if (mudou(anterior.label, seta.label)) {
      detalhes.push("rótulo");
    }
    // O VALOR da condição não entra na chave (só o operador), então uma
    // comparação que mudou de "10" para "20" chega aqui como alteração.
    if (descreverCondicao(anterior) !== descreverCondicao(seta)) {
      detalhes.push(`condição: ${descreverCondicao(anterior)} → ${descreverCondicao(seta)}`);
    }

    if (detalhes.length > 0) {
      entradas.push({
        kind: "changed",
        target: "transition",
        key: chave,
        nodeType: null,
        details: detalhes,
      });
    }
  }

  for (const [chave] of mapaAntes) {
    if (!mapaDepois.has(chave)) {
      entradas.push({
        kind: "removed",
        target: "transition",
        key: chave,
        nodeType: null,
        details: [],
      });
    }
  }

  return entradas;
}

/* -------------------------------------------------------------------------- */
/* A porta                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * O que mudou entre duas versões do mesmo fluxo.
 *
 * A ordem da saída é: incluídos, alterados, removidos — e dentro de cada grupo,
 * nós antes de setas. É a ordem em que uma pessoa lê a mudança: primeiro o que
 * é novo, depois o que mexeu, por último o que sumiu.
 */
export function diffFlowGraphs(antes: FlowGraph, depois: FlowGraph): FlowDiff {
  const entries = [...compararNos(antes.nodes, depois.nodes), ...compararSetas(antes, depois)];

  const peso: Record<FlowDiffKind, number> = { added: 0, changed: 1, removed: 2 };
  entries.sort(
    (a, b) =>
      peso[a.kind] - peso[b.kind] ||
      (a.target === b.target ? 0 : a.target === "node" ? -1 : 1) ||
      a.key.localeCompare(b.key),
  );

  return {
    entries,
    added: entries.filter((e) => e.kind === "added").length,
    removed: entries.filter((e) => e.kind === "removed").length,
    changed: entries.filter((e) => e.kind === "changed").length,
  };
}

/**
 * O resumo de uma linha, para o §23 (a confirmação antes de publicar).
 *
 * ⚠️ VAZIO É UMA RESPOSTA LEGÍTIMA E IMPORTANTE. Publicar uma versão idêntica à
 * anterior acontece — alguém criou o rascunho, mudou de ideia e publicou assim
 * mesmo. Dizer "nenhuma alteração" na tela de confirmação evita a publicação
 * que a pessoa achava que estava fazendo.
 */
export function summarizeFlowDiff(diff: FlowDiff): string {
  if (diff.entries.length === 0) return "Nenhuma alteração em relação à versão no ar.";

  const partes: string[] = [];
  if (diff.added > 0) partes.push(`${diff.added} ${diff.added === 1 ? "inclusão" : "inclusões"}`);
  if (diff.changed > 0)
    partes.push(`${diff.changed} ${diff.changed === 1 ? "alteração" : "alterações"}`);
  if (diff.removed > 0)
    partes.push(`${diff.removed} ${diff.removed === 1 ? "remoção" : "remoções"}`);

  return partes.join(", ");
}
