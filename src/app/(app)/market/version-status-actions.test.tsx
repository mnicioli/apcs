import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VersionStatusActions } from "./version-status-actions";

/**
 * A action é `"use server"` — importá-la de verdade tentaria abrir o Supabase.
 * O que está sob teste aqui é a DECISÃO DA TELA: qual ação é oferecida, com que
 * texto ela pede confirmação, e o que aparece quando o servidor recusa.
 */
const setVersionStatusAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/market-bulletins", () => ({ setVersionStatusAction }));

function montar(props: Partial<Parameters<typeof VersionStatusActions>[0]> = {}) {
  return render(
    <VersionStatusActions
      bulletinId="b1"
      versionId="v1"
      versionName="Bolsa_01Ago26"
      status="inactive"
      activeVersionName="Bolsa_12Ago26"
      {...props}
    />,
  );
}

beforeEach(() => {
  setVersionStatusAction.mockReset();
  setVersionStatusAction.mockResolvedValue({ ok: true, data: {} });
});

describe("qual ação a tela oferece", () => {
  it("publicação inativa oferece Ativar", () => {
    montar({ status: "inactive" });
    expect(screen.getByRole("button", { name: "Ativar" })).toBeInTheDocument();
  });

  /**
   * ⚠️ O caso mais importante desta tela, e o motivo de ela existir assim.
   *
   * A Bolsa não pode ficar sem publicação ativa, e como só existe uma ativa por
   * vez, inativar "a ativa" seria exatamente o que a esvaziaria — o banco
   * recusa (MB001). Um botão "Inativar" aqui SEMPRE falharia: a pessoa
   * clicaria, leria um erro e não descobriria que o caminho é ativar a outra.
   */
  it("publicação ATIVA não oferece Inativar — nem nenhum outro botão", () => {
    const { container } = montar({ status: "active" });

    expect(screen.queryByRole("button", { name: "Inativar" })).not.toBeInTheDocument();
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  /** Reativar uma antiga e ativar a primeira são a mesma operação — um rótulo só. */
  it("usa 'Ativar' também quando ainda não existe publicação ativa", () => {
    montar({ status: "inactive", activeVersionName: null });
    expect(screen.getByRole("button", { name: "Ativar" })).toBeInTheDocument();
  });
});

describe("a confirmação", () => {
  it("nomeia as DUAS publicações: a que entra e a que sai", async () => {
    const user = userEvent.setup();
    montar({ versionName: "Bolsa_01Ago26", activeVersionName: "Bolsa_12Ago26" });

    await user.click(screen.getByRole("button", { name: "Ativar" }));

    expect(await screen.findByText(/Bolsa_01Ago26/)).toBeInTheDocument();
    expect(screen.getByText(/Bolsa_12Ago26/)).toBeInTheDocument();
  });

  it("avisa que só uma publicação pode ficar ativa", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole("button", { name: "Ativar" }));

    expect(
      await screen.findByText(/Apenas uma publicação da Bolsa pode permanecer ativa/),
    ).toBeInTheDocument();
  });

  it("na primeira publicação não promete inativar ninguém", async () => {
    const user = userEvent.setup();
    montar({ activeVersionName: null });

    await user.click(screen.getByRole("button", { name: "Ativar" }));

    expect(await screen.findByText(/passará a ser a oficial/)).toBeInTheDocument();
    expect(screen.queryByText(/inativar automaticamente/)).not.toBeInTheDocument();
  });

  it("confirmar chama a action com o comando de ativação", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole("button", { name: "Ativar" }));
    await user.click(await screen.findByRole("button", { name: "Ativar versão" }));

    expect(setVersionStatusAction).toHaveBeenCalledWith({
      bulletinId: "b1",
      versionId: "v1",
      command: "activate",
    });
  });
});

describe("quando o servidor recusa", () => {
  it("traduz o erro de negócio em vez de mostrar o código", async () => {
    setVersionStatusAction.mockResolvedValue({
      ok: false,
      error: { code: "versionNotInBulletin" },
    });

    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole("button", { name: "Ativar" }));
    await user.click(await screen.findByRole("button", { name: "Ativar versão" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Esta publicação não pertence a esta Bolsa.",
    );
  });

  /**
   * O índice único parcial é o que produz este erro: duas telas tentando deixar
   * publicações diferentes ativas ao mesmo tempo. "Erro inesperado" faria a
   * pessoa tentar de novo às cegas.
   */
  it("colisão com outra pessoa vira um pedido para atualizar a página", async () => {
    setVersionStatusAction.mockResolvedValue({ ok: false, error: { code: "uniqueViolation" } });

    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole("button", { name: "Ativar" }));
    await user.click(await screen.findByRole("button", { name: "Ativar versão" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /atualizada por outra pessoa.*Atualize a página/i,
    );
  });
});
