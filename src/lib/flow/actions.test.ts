import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FLOW_ACTION_HANDLERS,
  type FlowActionHandler,
  type FlowActionOutput,
} from "@/modules/flow/flow.actions.registry";
import { runFlowAction } from "./actions";

/**
 * ⚠️ A ESPERA ENTRE TENTATIVAS VIRA ZERO AQUI, e só ela. `backoffDelayMs` já
 * tem os próprios testes em `resilience.test.ts`; o que interessa neste arquivo
 * é QUANTAS vezes o handler é chamado, não quanto tempo se espera entre elas.
 * Sem o mock, dois destes testes dormiriam até dois segundos de relógio real
 * para provar uma contagem.
 */
vi.mock("@/lib/messaging/resilience", async (original) => {
  // O módulo inteiro preservado, com uma função trocada. Sem o espalhamento,
  // `PROVIDER_TIMEOUT_MS` e o resto sumiriam para quem mais os importar nesta
  // bateria.
  const real = (await original()) as Record<string, unknown>;
  return { ...real, backoffDelayMs: () => 0 };
});

/**
 * A EXECUÇÃO DE UMA AÇÃO DE NEGÓCIO (§15, §16 e §25 do Prompt 3).
 *
 * ⚠️ ESTE ARQUIVO LIGA HANDLERS DE MENTIRA NO REGISTRO DE VERDADE, e é o que o
 * torna um teste e não uma encenação. `FLOW_ACTION_HANDLERS` é o mesmo objeto
 * que a produção consulta; se um dia `flowActionHandler` deixar de lê-lo, estes
 * testes quebram — que é exatamente o aviso que se quer.
 *
 * O que eles guardam é a distinção do §16, que é a mais fácil de perder num
 * refactor: `not_found` NÃO é `failure`, e só `retry` se repete. Colapsar os
 * três faria o associado ouvir "ocorreu um erro" para uma busca que apenas não
 * teve resultado — e faria o CRM insistir três vezes numa consulta que já
 * respondeu.
 */

const CHAVE = "consultar_normativa" as const;

function ligar(handler: FlowActionHandler): void {
  FLOW_ACTION_HANDLERS[CHAVE] = handler;
}

afterEach(() => {
  // ⚠️ O REGISTRO É GLOBAL. Deixar um handler ligado faria o próximo arquivo de
  // teste rodar contra um CRM que consulta normativas — e o defeito apareceria
  // em outro lugar, com outra cara.
  delete FLOW_ACTION_HANDLERS[CHAVE];
  vi.restoreAllMocks();
});

function pedido(maxAttempts = 1) {
  return {
    actionKey: CHAVE as string,
    arguments: { assunto: "ABATE" },
    maxAttempts,
    variables: { assunto: "ABATE" },
    whatsappChatId: "chat-1",
    idempotencyKey: "msg-1",
    runId: "run-1",
    nodeId: "no-1",
  };
}

describe("o handler é de fato executado", () => {
  it("recebe as variáveis, os argumentos e a chave de idempotência", async () => {
    // ⚠️ O TIPO DO MOCK É `FlowActionHandler`, E NÃO A FUNÇÃO SEM ARGUMENTO QUE
    // a implementação de fato é. Sem ele, `mock.calls` é uma tupla VAZIA — e
    // `calls[0][0]` deixa de existir, que é justamente o que este teste
    // precisa inspecionar.
    const handler = vi.fn<FlowActionHandler>(async () => ({
      ok: true,
      variables: { normativa_url: "u" },
    }));
    ligar(handler);

    const resultado = await runFlowAction(pedido());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      variables: { assunto: "ABATE" },
      whatsappChatId: "chat-1",
      idempotencyKey: "msg-1",
    });

    expect(resultado.status).toBe("success");
    expect(resultado.variables).toEqual({ normativa_url: "u" });
    expect(resultado.attempts).toBe(1);
  });
});

describe("os quatro desfechos do §16", () => {
  it("uma busca vazia é not_found, e não failure", async () => {
    ligar(async () => ({ ok: false, reason: "empty" }));

    const resultado = await runFlowAction(pedido());

    // ⚠️ A DISTINÇÃO QUE JUSTIFICA O §16. "Não encontrei normativa sobre esse
    // assunto" é uma resposta útil; "ocorreu um erro" manda a pessoa repetir a
    // única coisa que nunca vai funcionar.
    expect(resultado.status).toBe("not_found");
  });

  it("um erro do handler é failure", async () => {
    ligar(async () => ({ ok: false, reason: "error" }));
    expect((await runFlowAction(pedido())).status).toBe("failure");
  });

  /**
   * ⚠️ UMA EXCEÇÃO NÃO É `retry`. Ela não diz nada sobre ser temporária, e
   * tratá-la como temporária faria o motor insistir três vezes num defeito de
   * programação — atrasando a resposta ao associado para chegar ao mesmo lugar.
   */
  it("uma exceção vira failure numa tentativa só, sem insistir", async () => {
    const handler = vi.fn(async () => {
      throw new Error("coluna inexistente");
    });
    ligar(handler as unknown as FlowActionHandler);

    const resultado = await runFlowAction(pedido(3));

    expect(resultado.status).toBe("failure");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(resultado.error).toContain("coluna inexistente");
  });
});

describe("as tentativas do §25", () => {
  it("só repete quando o handler pede retry", async () => {
    const handler = vi
      .fn<() => Promise<FlowActionOutput>>()
      .mockResolvedValueOnce({ ok: false, reason: "retry" })
      .mockResolvedValueOnce({ ok: true, variables: { cotacao: "8,40" } });
    ligar(handler);

    const resultado = await runFlowAction(pedido(3));

    expect(handler).toHaveBeenCalledTimes(2);
    expect(resultado.status).toBe("success");
    expect(resultado.attempts).toBe(2);
  });

  /**
   * ⚠️ E NÃO REPETE O QUE JÁ RESPONDEU. Uma consulta que devolveu "não achei"
   * daria a mesma resposta três vezes, gastaria três vezes o serviço e
   * atrasaria a pessoa sem mudar nada.
   */
  it("não repete not_found nem failure", async () => {
    for (const reason of ["empty", "error"] as const) {
      const handler = vi.fn(async (): Promise<FlowActionOutput> => ({ ok: false, reason }));
      ligar(handler);

      await runFlowAction(pedido(3));
      expect(handler, reason).toHaveBeenCalledTimes(1);
    }
  });

  /**
   * ⚠️ "NÃO CRIAR RETRY INFINITO" É O §25 COM TODAS AS LETRAS. E a última
   * tentativa que ainda pede `retry` vira `failure`, não `retry`: devolver
   * `retry` ao motor seria devolver um estado que não existe no desenho — o
   * desenhador tem caminhos para "deu certo", "não achei" e "falhou", e não
   * para "ainda estou tentando".
   */
  it("respeita o teto e devolve failure quando ele acaba", async () => {
    const handler = vi.fn(async (): Promise<FlowActionOutput> => ({ ok: false, reason: "retry" }));
    ligar(handler);

    const resultado = await runFlowAction(pedido(2));

    expect(handler).toHaveBeenCalledTimes(2);
    expect(resultado.status).toBe("failure");
    expect(resultado.attempts).toBe(2);
  });
});

describe("a ação que não pode rodar", () => {
  /**
   * §15. A publicação recusa fluxos com ação sem handler — então chegar aqui
   * significa que o handler foi DESLIGADO depois de a versão ir ao ar. O
   * desenho tem um caminho para `failure`; travar não é opção.
   */
  it("sem handler ligado, falha sem lançar", async () => {
    const resultado = await runFlowAction(pedido());

    expect(resultado.status).toBe("failure");
    expect(resultado.attempts).toBe(0);
    expect(resultado.error).toContain(CHAVE);
  });

  /**
   * Um retrato congelado pode citar uma ação que este build não conhece — ela
   * foi removida do registro depois da publicação. Não decidir é a postura
   * certa.
   */
  it("uma chave que este build não conhece falha sem lançar", async () => {
    const resultado = await runFlowAction({ ...pedido(), actionKey: "consultar_o_futuro" });

    expect(resultado.status).toBe("failure");
    expect(resultado.error).toContain("desconhecida");
  });
});
