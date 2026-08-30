import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_ERROR_MESSAGES, failFromPostgres, mapPostgresError } from "./errors";

/**
 * ⚠️ ESTE ARQUIVO NASCEU DE UM DEFEITO COM NOME E SOBRENOME.
 *
 * Uma divulgação de normativa por WhatsApp falhava com "Ocorreu um erro
 * inesperado. Tente novamente." e **não deixava uma linha no log do servidor**.
 * O caller fazia `return fail(mapPostgresError(error).code)`, e um código que o
 * mapa não conhece vira `unexpected` — a mensagem certa para a tela e a pior
 * possível para investigar. A falha chegava ao usuário e sumia do servidor ao
 * mesmo tempo.
 *
 * O que estes testes protegem é a propriedade que faltava: **traduzir e
 * registrar são a mesma operação**, e o detalhe técnico vai SÓ para o log.
 */
describe("failFromPostgres", () => {
  let logado: unknown[][] = [];

  beforeEach(() => {
    logado = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logado.push(args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registra no servidor o erro que a tela não vai ver", () => {
    const resultado = failFromPostgres(
      "broadcast.start",
      { code: "42883", message: "function public.foo(uuid) does not exist" },
      { source: "normative" },
    );

    expect(resultado.ok).toBe(false);
    expect(logado).toHaveLength(1);

    const linha = JSON.stringify(logado[0]);
    expect(linha).toContain("broadcast.start");
    expect(linha).toContain("42883");
    expect(linha).toContain("does not exist");
    // O contexto de quem chamou entra junto: sem ele, o log diz o que quebrou
    // mas não em cima de quê.
    expect(linha).toContain("normative");
  });

  /**
   * ⚠️ O detalhe do Postgres NUNCA pode ir para a tela: mensagem de erro do
   * banco carrega caminho de arquivo, nome de constraint e às vezes trecho de
   * consulta. A tela recebe o código traduzido; o resto fica no servidor.
   */
  it("não devolve a mensagem do banco no corpo do erro", () => {
    const resultado = failFromPostgres("broadcast.start", {
      code: "XX000",
      message: "internal error at /var/lib/postgresql/data — password=hunter2",
    });

    const corpo = JSON.stringify(resultado);
    expect(corpo).not.toContain("hunter2");
    expect(corpo).not.toContain("postgresql");
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(ACTION_ERROR_MESSAGES[resultado.error.code]).toBe(
        "Ocorreu um erro inesperado. Tente novamente.",
      );
    }
  });

  it("preserva a tradução que o mapa já sabia fazer", () => {
    const resultado = failFromPostgres("broadcast.start", { code: "BC003" });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("broadcastUnknownSegment");
    // E registra mesmo assim: "por que ele disse que meu público é inválido?"
    // é uma pergunta legítima, e a resposta some se ninguém anotar.
    expect(logado).toHaveLength(1);
  });

  it("carrega a constraint adiante, como `mapPostgresError` faz", () => {
    const erro = { code: "23505", constraint: "broadcast_recipients_unique_idx" };

    const resultado = failFromPostgres("broadcast.start", erro);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.error).toEqual(mapPostgresError(erro));
    }
  });

  it("aguenta um erro que não é objeto nenhum", () => {
    const resultado = failFromPostgres("broadcast.start", "explodiu");

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("unexpected");
    expect(logado).toHaveLength(1);
  });
});
