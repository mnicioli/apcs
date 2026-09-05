import { describe, expect, it } from "vitest";
import { diffFlowGraphs, summarizeFlowDiff } from "./flow.diff";
import type { FlowGraph } from "./flow.rules";
import type { FlowNode, FlowTransition } from "./flow.types";

/**
 * §39 do Prompt 5 — a comparação entre duas versões.
 *
 * ============================================================================
 * ⚠️ O TESTE MAIS IMPORTANTE DESTE ARQUIVO É O PRIMEIRO.
 * ============================================================================
 *
 * `create_flow_version()` copia o desenho com IDs NOVOS (§3). Um diff por id
 * veria tudo como diferente e diria "12 removidos, 12 adicionados" em toda
 * comparação — literalmente verdade, e inútil.
 *
 * A comparação é por CHAVE ESTÁVEL, que é o que sobrevive à cópia. Se alguém
 * "otimizar" para comparar por id, é o primeiro teste que cai.
 */

let contador = 0;

function no(parcial: Partial<FlowNode> & Pick<FlowNode, "key" | "type">): FlowNode {
  contador += 1;
  return {
    // ⚠️ ID SEMPRE DIFERENTE, de propósito: é assim que as duas versões chegam
    // na vida real, e é o que este arquivo precisa provar que não atrapalha.
    id: `id-${contador}`,
    flowVersionId: "v",
    name: parcial.key,
    configuration: {},
    position: { x: 0, y: 0 },
    metadata: {},
    isStart: false,
    ...parcial,
  };
}

function seta(
  parcial: Partial<FlowTransition> & Pick<FlowTransition, "sourceNodeId" | "targetNodeId">,
): FlowTransition {
  contador += 1;
  return {
    id: `t-${contador}`,
    flowVersionId: "v",
    condition: { type: "always" },
    label: null,
    priority: 0,
    ...parcial,
  };
}

/** Um desenho mínimo: MENU → FIM. */
function desenho(
  ajustes: {
    textoDoMenu?: string;
    timeDoFim?: string;
    prioridade?: number;
    extra?: boolean;
  } = {},
): FlowGraph {
  const menu = no({
    key: "MENU",
    type: "question",
    isStart: true,
    configuration: {
      text: ajustes.textoDoMenu ?? "Como podemos ajudar?",
      kind: "buttons",
      variable: "assunto",
      options: [{ key: "BOLSA", label: "Bolsa" }],
    },
  });

  const fim = no({
    key: "TRANSFERIR",
    type: "attendant",
    configuration: { teamKey: ajustes.timeDoFim ?? "TIME_SAC" },
  });

  const nodes = [menu, fim];
  if (ajustes.extra) {
    nodes.push(no({ key: "AVISO", type: "message", configuration: { text: "Um instante." } }));
  }

  return {
    nodes,
    transitions: [
      seta({
        sourceNodeId: menu.id,
        targetNodeId: fim.id,
        priority: ajustes.prioridade ?? 0,
        condition: { type: "answer", optionKey: "BOLSA" },
      }),
    ],
  };
}

/* -------------------------------------------------------------------------- */

describe("a identidade é a chave, e não o id", () => {
  /**
   * ⚠️ ESTE É O TESTE QUE JUSTIFICA O DESENHO INTEIRO DO MÓDULO. Dois desenhos
   * idênticos com ids completamente diferentes — que é o que uma cópia de
   * versão produz — precisam comparar como "nada mudou".
   */
  it("dois desenhos iguais com ids diferentes não acusam mudança", () => {
    const a = desenho();
    const b = desenho();

    // Prova de que os ids são mesmo diferentes: sem isto o teste passaria por
    // acidente se a fábrica reaproveitasse ids.
    expect(a.nodes[0]?.id).not.toBe(b.nodes[0]?.id);

    const diff = diffFlowGraphs(a, b);
    expect(diff.entries).toEqual([]);
    expect(summarizeFlowDiff(diff)).toBe("Nenhuma alteração em relação à versão no ar.");
  });
});

describe("nós", () => {
  it("acusa inclusão", () => {
    const diff = diffFlowGraphs(desenho(), desenho({ extra: true }));

    const incluido = diff.entries.find((e) => e.kind === "added" && e.target === "node");
    expect(incluido?.key).toBe("AVISO");
    expect(diff.added).toBe(1);
  });

  it("acusa remoção", () => {
    const diff = diffFlowGraphs(desenho({ extra: true }), desenho());

    const removido = diff.entries.find((e) => e.kind === "removed" && e.target === "node");
    expect(removido?.key).toBe("AVISO");
    expect(diff.removed).toBe(1);
  });

  /** ⚠️ O DETALHE É EM PT-BR. `text` no diff seria inútil para quem homologa. */
  it("acusa mudança de texto com rótulo legível", () => {
    const diff = diffFlowGraphs(desenho(), desenho({ textoDoMenu: "Em que posso ajudar?" }));

    const alterado = diff.entries.find((e) => e.kind === "changed");
    expect(alterado?.key).toBe("MENU");
    expect(alterado?.details).toContain("texto da pergunta");
  });

  /**
   * ⚠️ TROCAR O TIME É A MUDANÇA MAIS CARA QUE UM DIFF PRECISA MOSTRAR — é
   * literalmente o exemplo do §22 ("a triagem de Financeiro está direcionando
   * para o time incorreto"). Ela não pode passar despercebida.
   */
  it("acusa mudança de time na transferência", () => {
    const diff = diffFlowGraphs(desenho(), desenho({ timeDoFim: "TIME_FINANCEIRO" }));

    const alterado = diff.entries.find((e) => e.key === "TRANSFERIR");
    expect(alterado?.kind).toBe("changed");
    expect(alterado?.details).toContain("time");
  });

  /**
   * ⚠️ ARRASTAR UMA CAIXINHA NÃO É UMA ALTERAÇÃO. A posição no canvas muda
   * quando alguém quer enxergar melhor, e mostrá-la no diff encheria a
   * confirmação de publicação com ruído — a ponto de ninguém mais ler a lista.
   */
  it("ignora a posição no canvas", () => {
    const a = desenho();
    const b = desenho();
    const primeiro = b.nodes[0];
    if (primeiro) primeiro.position = { x: 900, y: 900 };

    expect(diffFlowGraphs(a, b).entries).toEqual([]);
  });

  /**
   * ⚠️ RENOMEAR A CHAVE APARECE COMO REMOÇÃO + INCLUSÃO, e está certo: para as
   * transições que apontavam para ela e para as condições que a citavam, uma
   * chave nova É um nó novo.
   */
  it("trata renomear a chave como troca de nó", () => {
    const a = desenho();
    const b = desenho();
    const primeiro = b.nodes[0];
    if (primeiro) primeiro.key = "MENU_PRINCIPAL";

    const diff = diffFlowGraphs(a, b);
    expect(diff.added).toBeGreaterThan(0);
    expect(diff.removed).toBeGreaterThan(0);
  });
});

describe("transições", () => {
  it("acusa mudança de prioridade", () => {
    const diff = diffFlowGraphs(desenho(), desenho({ prioridade: 3 }));

    const alterada = diff.entries.find((e) => e.target === "transition");
    expect(alterada?.kind).toBe("changed");
    expect(alterada?.details.join(" ")).toContain("prioridade");
  });

  it("descreve a seta pelas chaves dos nós, e não pelos ids", () => {
    const diff = diffFlowGraphs(desenho(), desenho({ prioridade: 3 }));
    const alterada = diff.entries.find((e) => e.target === "transition");

    expect(alterada?.key).toContain("MENU");
    expect(alterada?.key).toContain("TRANSFERIR");
    expect(alterada?.key).not.toContain("id-");
  });
});

describe("o resumo de uma linha", () => {
  it("conta as três classes", () => {
    const diff = diffFlowGraphs(desenho(), desenho({ extra: true, textoDoMenu: "Outro" }));
    const resumo = summarizeFlowDiff(diff);

    expect(resumo).toContain("inclus");
    expect(resumo).toContain("altera");
  });

  /**
   * ⚠️ "NENHUMA ALTERAÇÃO" É UMA RESPOSTA IMPORTANTE, e não um caso vazio.
   * Publicar uma versão idêntica acontece — alguém criou o rascunho, mudou de
   * ideia e publicou assim mesmo. Dizê-lo na confirmação evita a publicação que
   * a pessoa achava que estava fazendo.
   */
  it("diz quando nada mudou", () => {
    expect(summarizeFlowDiff(diffFlowGraphs(desenho(), desenho()))).toBe(
      "Nenhuma alteração em relação à versão no ar.",
    );
  });

  it("usa singular com um item só", () => {
    const diff = diffFlowGraphs(desenho(), desenho({ extra: true }));
    expect(summarizeFlowDiff(diff)).toContain("1 inclusão");
  });
});

describe("a ordem da saída", () => {
  /**
   * Incluídos, alterados, removidos — é a ordem em que uma pessoa lê a mudança:
   * primeiro o que é novo, depois o que mexeu, por último o que sumiu.
   */
  it("agrupa por tipo de mudança", () => {
    const antes = desenho({ extra: true });
    const depois = desenho({ textoDoMenu: "Outro texto" });

    const tipos = diffFlowGraphs(antes, depois).entries.map((e) => e.kind);
    const posicao = { added: 0, changed: 1, removed: 2 } as const;

    for (let i = 1; i < tipos.length; i += 1) {
      const anterior = tipos[i - 1];
      const atual = tipos[i];
      if (!anterior || !atual) continue;
      expect(posicao[anterior]).toBeLessThanOrEqual(posicao[atual]);
    }
  });
});
