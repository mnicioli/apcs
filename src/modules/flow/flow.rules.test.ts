import { describe, expect, it } from "vitest";
import {
  canAdvanceVersion,
  canDeleteFlow,
  canPublishVersion,
  handoffSummary,
  isRollback,
  isVersionEditable,
  pendingFlowActions,
  validateFlowGraph,
} from "./flow.rules";
import { FLOW_VERSION_STATUSES } from "./flow.types";
import type { Flow, FlowNode, FlowRun, FlowTransition, FlowVersion } from "./flow.types";

/**
 * As regras puras dos fluxos.
 *
 * ⚠️ ESTE ARQUIVO É UM ESPELHO, E OS TESTES SABEM DISSO. As regras de
 * `validateFlowGraph` também existem em `validate_flow_version()`, no banco, que
 * é a barreira de verdade. `src/test/sql-flow-validation.test.ts` confere que as
 * duas listas de códigos continuam sendo a mesma — aqui se confere que cada
 * regra faz o que diz.
 */

function no(parcial: Partial<FlowNode> & Pick<FlowNode, "id" | "type">): FlowNode {
  return {
    flowVersionId: "v1",
    key: parcial.id.toUpperCase(),
    name: parcial.id,
    configuration: {},
    position: { x: 0, y: 0 },
    metadata: {},
    isStart: false,
    ...parcial,
  };
}

function seta(id: string, de: string, para: string): FlowTransition {
  return {
    id,
    flowVersionId: "v1",
    sourceNodeId: de,
    targetNodeId: para,
    condition: { type: "always" },
    label: null,
    priority: 0,
  };
}

/** O menor fluxo que passa em tudo: começa, pergunta nada, encerra. */
const VALIDO = {
  nodes: [no({ id: "n1", type: "message", isStart: true }), no({ id: "n2", type: "end" })],
  transitions: [seta("t1", "n1", "n2")],
};

/* -------------------------------------------------------------------------- */

describe("o ciclo de vida da versão (§4)", () => {
  it("segue o caminho do escopo: rascunho → teste → aprovação → aprovada", () => {
    expect(canAdvanceVersion("draft", "testing")).toBe(true);
    expect(canAdvanceVersion("testing", "pending_approval")).toBe(true);
    expect(canAdvanceVersion("pending_approval", "approved")).toBe(true);
  });

  /**
   * ⚠️ VOLTAR PARA RASCUNHO NÃO É FROUXIDÃO. O teste é onde se descobre que o
   * desenho está errado; sem o caminho de volta, corrigir uma vírgula exigiria
   * criar mais uma versão — e o histórico se encheria de v4, v5, v6 que nunca
   * atenderam ninguém.
   */
  it("deixa voltar para rascunho de qualquer etapa anterior à publicação", () => {
    expect(canAdvanceVersion("testing", "draft")).toBe(true);
    expect(canAdvanceVersion("pending_approval", "draft")).toBe(true);
    expect(canAdvanceVersion("approved", "draft")).toBe(true);
  });

  it("recusa pular etapas", () => {
    expect(canAdvanceVersion("draft", "approved")).toBe(false);
    expect(canAdvanceVersion("draft", "pending_approval")).toBe(false);
    expect(canAdvanceVersion("testing", "approved")).toBe(false);
  });

  /**
   * ⚠️ PUBLICAR NÃO É UM AVANÇO DE SITUAÇÃO. É uma operação com validação,
   * compilação do retrato congelado e troca da versão ativa — e ela mora em
   * `publish_flow_version`. Se um dia alguém acrescentar `approved → published`
   * a esta tabela, a publicação passaria a poder acontecer sem validar nada.
   */
  it("nunca permite alcançar publicada ou substituída por avanço", () => {
    for (const de of FLOW_VERSION_STATUSES) {
      expect(canAdvanceVersion(de, "published")).toBe(false);
      expect(canAdvanceVersion(de, "superseded")).toBe(false);
    }
  });

  it("uma versão publicada ou substituída não avança para lugar nenhum", () => {
    for (const para of FLOW_VERSION_STATUSES) {
      expect(canAdvanceVersion("published", para)).toBe(false);
      expect(canAdvanceVersion("superseded", para)).toBe(false);
    }
  });

  it("só rascunho é editável — é a regra 1 do módulo (§22)", () => {
    expect(isVersionEditable("draft")).toBe(true);
    for (const status of FLOW_VERSION_STATUSES.filter((s) => s !== "draft")) {
      expect(isVersionEditable(status)).toBe(false);
    }
  });

  it("publica a aprovada e a substituída — e só a segunda é rollback (§23)", () => {
    expect(canPublishVersion("approved")).toBe(true);
    expect(canPublishVersion("superseded")).toBe(true);
    expect(canPublishVersion("draft")).toBe(false);
    expect(canPublishVersion("published")).toBe(false);

    expect(isRollback("superseded")).toBe(true);
    expect(isRollback("approved")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe("a exclusão de fluxo (§22)", () => {
  const fluxo = (activeVersionId: string | null): Flow => ({
    id: "f1",
    name: "Triagem",
    description: null,
    channel: "whatsapp",
    status: activeVersionId ? "active" : "inactive",
    isEntry: true,
    activeVersionId,
    activeVersionNumber: activeVersionId ? 1 : null,
    versionCount: 1,
    createdBy: null,
    createdAt: "2026-09-01T12:00:00Z",
    updatedBy: null,
    updatedAt: "2026-09-01T12:00:00Z",
  });

  const versao = (status: FlowVersion["status"]): FlowVersion => ({
    id: "v1",
    flowId: "f1",
    version: 1,
    status,
    notes: null,
    definition: null,
    publishedAt: null,
    publishedBy: null,
    createdBy: null,
    createdAt: "2026-09-01T12:00:00Z",
    updatedBy: null,
    updatedAt: "2026-09-01T12:00:00Z",
  });

  it("deixa apagar um fluxo que só tem rascunho", () => {
    expect(canDeleteFlow(fluxo(null), [versao("draft")])).toBe(true);
  });

  it("recusa apagar quem tem versão no ar", () => {
    expect(canDeleteFlow(fluxo("v1"), [versao("published")])).toBe(false);
  });

  /**
   * ⚠️ O CASO SUTIL: o fluxo foi DESLIGADO, então `activeVersionId` é nulo —
   * mas ele já esteve no ar, e a versão substituída é o registro de que houve
   * um atendimento desenhado daquele jeito. Apagar isso é apagar histórico.
   */
  it("recusa apagar quem já esteve no ar, mesmo depois de desligado", () => {
    expect(canDeleteFlow(fluxo(null), [versao("superseded")])).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe("a validação do desenho (§19)", () => {
  it("aprova o menor fluxo completo", () => {
    expect(validateFlowGraph(VALIDO, [])).toEqual([]);
  });

  it("cobra o nó inicial", () => {
    const semInicio = {
      ...VALIDO,
      nodes: VALIDO.nodes.map((n) => ({ ...n, isStart: false })),
    };
    const codigos = validateFlowGraph(semInicio, []).map((p) => p.code);
    expect(codigos).toContain("missing_start");
  });

  /**
   * ⚠️ SEM NÓ FINAL, TODA CONVERSA FICA EM ABERTO PARA SEMPRE — e ninguém
   * percebe, porque uma conversa parada é indistinguível de uma conversa
   * demorada.
   */
  it("cobra o nó de encerramento (§21)", () => {
    const semFim = {
      nodes: [no({ id: "n1", type: "message", isStart: true })],
      transitions: [],
    };
    const codigos = validateFlowGraph(semFim, []).map((p) => p.code);
    expect(codigos).toContain("missing_end");
  });

  it("acusa o beco sem saída e diz qual nó é", () => {
    const beco = {
      nodes: [
        no({ id: "n1", type: "message", key: "BOAS_VINDAS", isStart: true }),
        no({ id: "n2", type: "end" }),
      ],
      transitions: [],
    };
    const problema = validateFlowGraph(beco, []).find((p) => p.code === "dead_end");
    expect(problema?.detail).toContain("BOAS_VINDAS");
  });

  it("não trata encerramento nem transferência como beco sem saída", () => {
    const comAtendente = {
      nodes: [
        no({ id: "n1", type: "message", isStart: true }),
        no({
          id: "n2",
          type: "attendant",
          key: "PARA_O_TIME",
          configuration: { teamKey: "TIME_SAC" },
        }),
        no({ id: "n3", type: "end" }),
      ],
      transitions: [seta("t1", "n1", "n2"), seta("t2", "n1", "n3")],
    };
    const codigos = validateFlowGraph(comAtendente, ["TIME_SAC"]).map((p) => p.code);
    expect(codigos).not.toContain("dead_end");
  });

  /**
   * O nó órfão não quebra nada em execução — e é por isso que passa
   * despercebido até alguém perguntar por que aquela pergunta nunca aparece.
   */
  it("acusa o nó que ninguém alcança", () => {
    const orfao = {
      nodes: [...VALIDO.nodes, no({ id: "n9", type: "end", key: "ESQUECIDO" })],
      transitions: VALIDO.transitions,
    };
    const problema = validateFlowGraph(orfao, []).find((p) => p.code === "unreachable");
    expect(problema?.detail).toContain("ESQUECIDO");
  });

  it("cobra ao menos duas alternativas numa pergunta", () => {
    const pergunta = {
      nodes: [
        no({
          id: "n1",
          type: "question",
          key: "PERGUNTA",
          isStart: true,
          configuration: { text: "?", options: [{ key: "UM", label: "Um" }] },
        }),
        no({ id: "n2", type: "end" }),
      ],
      transitions: [seta("t1", "n1", "n2")],
    };
    const codigos = validateFlowGraph(pergunta, []).map((p) => p.code);
    expect(codigos).toContain("question_without_options");
  });

  /**
   * ⚠️ ESTE É O CASO QUE MOSTRA POR QUE A VALIDAÇÃO RODA TAMBÉM NO ROLLBACK. O
   * desenho não mudou; o TIME foi desativado depois. Publicar de volta uma v2
   * que aponta para um time inativo é mandar conversas para uma fila que
   * ninguém abre.
   */
  it("acusa transferência para um time que não está ativo (§11)", () => {
    const paraTime = {
      nodes: [
        no({ id: "n1", type: "message", isStart: true }),
        no({
          id: "n2",
          type: "attendant",
          key: "PARA_MARKETING",
          configuration: { teamKey: "TIME_MARKETING" },
        }),
        no({ id: "n3", type: "end" }),
      ],
      transitions: [seta("t1", "n1", "n2"), seta("t2", "n1", "n3")],
    };

    expect(validateFlowGraph(paraTime, ["TIME_MARKETING"])).toEqual([]);

    const codigos = validateFlowGraph(paraTime, ["TIME_SAC"]).map((p) => p.code);
    expect(codigos).toContain("attendant_without_team");
  });

  it("acusa transferência sem time nenhum configurado", () => {
    const semTime = {
      nodes: [
        no({ id: "n1", type: "message", isStart: true }),
        no({ id: "n2", type: "attendant", key: "PARA_NINGUEM" }),
        no({ id: "n3", type: "end" }),
      ],
      transitions: [seta("t1", "n1", "n2"), seta("t2", "n1", "n3")],
    };
    const codigos = validateFlowGraph(semTime, ["TIME_SAC"]).map((p) => p.code);
    expect(codigos).toContain("attendant_without_team");
  });
});

/* -------------------------------------------------------------------------- */

describe("as ações sem handler ligado", () => {
  /**
   * ⚠️ A ÚNICA REGRA CUJA BARREIRA NÃO ESTÁ NO BANCO. Saber se `consultar_bolsa`
   * tem handler é uma propriedade do build que está no ar — o Postgres não tem
   * como conhecê-la. Nesta fundação NENHUM handler está ligado (§28), então
   * qualquer nó de ação é pendência: é exatamente o que este teste fixa.
   */
  it("aponta a ação usada no desenho que ainda não pode rodar", () => {
    const comAcao = {
      nodes: [
        no({
          id: "n1",
          type: "action",
          isStart: true,
          configuration: { actionKey: "consultar_bolsa" },
        }),
      ],
      transitions: [],
    };
    expect(pendingFlowActions(comAcao)).toEqual(["consultar_bolsa"]);
  });

  it("não repete a mesma ação usada em dois nós", () => {
    const duasVezes = {
      nodes: [
        no({ id: "n1", type: "action", configuration: { actionKey: "consultar_bolsa" } }),
        no({ id: "n2", type: "action", configuration: { actionKey: "consultar_bolsa" } }),
      ],
      transitions: [],
    };
    expect(pendingFlowActions(duasVezes)).toEqual(["consultar_bolsa"]);
  });

  it("ignora nós que não são de ação e chaves desconhecidas", () => {
    const misto = {
      nodes: [
        ...VALIDO.nodes,
        no({ id: "n9", type: "action", configuration: { actionKey: "coisa_que_nao_existe" } }),
      ],
      transitions: VALIDO.transitions,
    };
    expect(pendingFlowActions(misto)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe("o resumo para quem vai atender (§16)", () => {
  const execucao: FlowRun = {
    id: "r1",
    flowId: "f1",
    flowName: "Triagem",
    flowVersionId: "v1",
    flowVersionNumber: 1,
    whatsappChatId: "c1",
    currentNodeId: null,
    status: "handed_off",
    conversationStatus: "in_service",
    variables: { nome: "João da Silva", assunto: "IMPRENSA", sub_assunto: "MARKETING" },
    intent: "falar_com_atendente",
    intentConfidence: 0.94,
    assignedTeamId: "t1",
    assignedTeamKey: "TIME_MARKETING",
    assignedUserId: null,
    startedAt: "2026-09-01T12:00:00Z",
    updatedAt: "2026-09-01T12:05:00Z",
    completedAt: null,
  };

  it("mostra a intenção, o que foi coletado e para onde foi", () => {
    const linhas = handoffSummary(execucao);

    expect(linhas[0]).toEqual({ label: "Intenção identificada", value: "falar_com_atendente" });
    expect(linhas).toContainEqual({ label: "nome", value: "João da Silva" });
    expect(linhas).toContainEqual({ label: "sub_assunto", value: "MARKETING" });
    expect(linhas.at(-1)).toEqual({ label: "Direcionado para", value: "TIME_MARKETING" });
  });

  /**
   * A ordem é a de INSERÇÃO — a ordem em que a pessoa respondeu. Ordenar por
   * alfabeto faria "assunto" vir antes de "nome", e a leitura deixaria de
   * acompanhar a conversa.
   */
  it("mantém as variáveis na ordem em que foram coletadas", () => {
    const linhas = handoffSummary(execucao).map((l) => l.label);
    expect(linhas).toEqual([
      "Intenção identificada",
      "nome",
      "assunto",
      "sub_assunto",
      "Direcionado para",
    ]);
  });

  it("omite variável vazia — uma linha em branco não informa nada", () => {
    const comVazio = { ...execucao, variables: { nome: "João", cidade: "   " } };
    expect(handoffSummary(comVazio).map((l) => l.label)).not.toContain("cidade");
  });

  it("funciona numa execução que ainda não foi transferida", () => {
    const emTriagem: FlowRun = {
      ...execucao,
      intent: null,
      assignedTeamKey: null,
      variables: {},
    };
    expect(handoffSummary(emTriagem)).toEqual([]);
  });
});
