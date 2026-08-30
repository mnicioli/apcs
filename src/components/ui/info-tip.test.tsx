import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InfoTip } from "./info-tip";

const TEXTO = "A busca ignora acentos e vale sobre todas as palestras, não só as desta página.";

/**
 * A DICA QUE NÃO OCUPA ESPAÇO — e que ainda assim EXISTE para quem não vê a
 * tela.
 *
 * ⚠️ O teste do `aria-describedby` é o que separa este componente de um `<div>`
 * com `onMouseOver`. Sem a ligação, a informação some para leitor de tela — e o
 * conserto de layout teria custado a acessibilidade da frase que ele moveu.
 */
describe("InfoTip", () => {
  it("começa fechada: a frase não ocupa espaço na tela", () => {
    render(<InfoTip text={TEXTO} />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("abre no clique e liga a dica ao gatilho", async () => {
    const user = userEvent.setup();
    render(<InfoTip text={TEXTO} />);

    const botao = screen.getByRole("button", { name: "Mais informações" });
    await user.click(botao);

    const dica = screen.getByRole("tooltip");
    expect(dica).toHaveTextContent(TEXTO);
    // A ligação é o que faz o leitor de tela anunciar a dica junto do campo.
    expect(botao).toHaveAttribute("aria-describedby", dica.getAttribute("id"));
  });

  it("abre no foco — o caminho de quem navega por Tab", async () => {
    const user = userEvent.setup();
    render(<InfoTip text={TEXTO} />);

    await user.tab();

    expect(screen.getByRole("button", { name: "Mais informações" })).toHaveFocus();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("Esc fecha — uma dica presa na tela vira o estorvo que ela devia evitar", async () => {
    const user = userEvent.setup();
    render(<InfoTip text={TEXTO} />);

    await user.click(screen.getByRole("button", { name: "Mais informações" }));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("é um botão de verdade, e não um ícone decorativo sem nome", () => {
    render(<InfoTip text={TEXTO} label="O que a busca alcança" />);
    expect(screen.getByRole("button", { name: "O que a busca alcança" })).toBeInTheDocument();
  });
});
