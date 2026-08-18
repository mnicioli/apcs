import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SurveyOptionEditor } from "./survey-option-editor";

/**
 * O EDITOR DE ALTERNATIVAS (§15, §16, §17).
 *
 * ⚠️ Os testes usam um WRAPPER COM ESTADO DE VERDADE, e não um `onChange`
 * espião. A diferença importa: um espião provaria que a função foi chamada, e o
 * defeito que este componente já teve era outro — dois cliques seguidos
 * calculavam o próximo estado a partir do array ANTIGO, e a primeira alteração
 * sumia. Só um estado real, com o React reprocessando entre um clique e outro,
 * pega isso.
 */
function Wrapper({ inicial, locked = false }: { inicial: string[]; locked?: boolean }) {
  const [options, setOptions] = useState(inicial);
  return (
    <>
      <SurveyOptionEditor options={options} onChange={setOptions} locked={locked} />
      {/* A ordem atual, para o teste ler sem depender do DOM do editor. */}
      <output data-testid="ordem">{options.join("|")}</output>
    </>
  );
}

const CINCO = ["Aumentar muito", "Aumentar", "Manter", "Reduzir", "Reduzir muito"];

function ordem() {
  return screen.getByTestId("ordem").textContent;
}

describe("edição das alternativas (§15)", () => {
  it("digitar altera só a alternativa tocada", async () => {
    const user = userEvent.setup();
    render(<Wrapper inicial={["Sim", "Não"]} />);

    await user.clear(screen.getByLabelText("Alternativa 1"));
    await user.type(screen.getByLabelText("Alternativa 1"), "Com certeza");

    expect(ordem()).toBe("Com certeza|Não");
  });

  it("acrescenta uma alternativa em branco no fim", async () => {
    const user = userEvent.setup();
    render(<Wrapper inicial={["Sim", "Não"]} />);

    await user.click(screen.getByRole("button", { name: /adicionar alternativa/i }));

    expect(ordem()).toBe("Sim|Não|");
  });

  it("remove a alternativa escolhida", async () => {
    const user = userEvent.setup();
    render(<Wrapper inicial={CINCO} />);

    await user.click(screen.getByRole("button", { name: /remover "Manter"/i }));

    expect(ordem()).toBe("Aumentar muito|Aumentar|Reduzir|Reduzir muito");
  });

  it("§16 não deixa cair abaixo de duas alternativas", async () => {
    render(<Wrapper inicial={["Sim", "Não"]} />);

    // Os botões de remover ficam desabilitados — uma "escolha única" com uma
    // opção só é um aviso, não uma enquete.
    expect(screen.getByRole("button", { name: /remover "Sim"/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /remover "Não"/i })).toBeDisabled();
  });
});

describe("reordenação (§17)", () => {
  it("mover para cima troca com o vizinho de cima", async () => {
    const user = userEvent.setup();
    render(<Wrapper inicial={CINCO} />);

    // O exemplo do §17: 1,2,3,4,5 vira 1,3,2,4,5.
    await user.click(screen.getByRole("button", { name: /mover "Manter" para cima/i }));

    expect(ordem()).toBe("Aumentar muito|Manter|Aumentar|Reduzir|Reduzir muito");
  });

  it("mover para baixo troca com o vizinho de baixo", async () => {
    const user = userEvent.setup();
    render(<Wrapper inicial={CINCO} />);

    await user.click(screen.getByRole("button", { name: /mover "Aumentar muito" para baixo/i }));

    expect(ordem()).toBe("Aumentar|Aumentar muito|Manter|Reduzir|Reduzir muito");
  });

  it("as pontas não têm para onde ir", () => {
    render(<Wrapper inicial={CINCO} />);

    expect(
      screen.getByRole("button", { name: /mover "Aumentar muito" para cima/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /mover "Reduzir muito" para baixo/i }),
    ).toBeDisabled();
  });

  it("⚠️ DOIS MOVIMENTOS SEGUIDOS não perdem o primeiro", async () => {
    const user = userEvent.setup();
    render(<Wrapper inicial={CINCO} />);

    // O defeito que existiu: o segundo clique calculava a partir do array
    // antigo, e o primeiro movimento era desfeito em silêncio.
    await user.click(screen.getByRole("button", { name: /mover "Manter" para cima/i }));
    await user.click(screen.getByRole("button", { name: /mover "Manter" para cima/i }));

    expect(ordem()).toBe("Manter|Aumentar muito|Aumentar|Reduzir|Reduzir muito");
  });

  it("os rótulos dos botões nomeiam a alternativa (§61)", () => {
    render(<Wrapper inicial={CINCO} />);

    // "Mover para cima" repetido cinco vezes não diz nada a quem usa leitor de
    // tela; "Mover 'Manter' para cima" diz.
    expect(screen.getByRole("button", { name: 'Mover "Manter" para cima' })).toBeInTheDocument();
  });
});

describe("alternativas repetidas", () => {
  it("avisa e marca OS DOIS campos", async () => {
    const user = userEvent.setup();
    render(<Wrapper inicial={["Sim", "Não"]} />);

    await user.clear(screen.getByLabelText("Alternativa 2"));
    await user.type(screen.getByLabelText("Alternativa 2"), "sim");

    expect(screen.getByRole("alert")).toHaveTextContent(/repetidas/i);
    // Apontar só a segunda sugeriria que a primeira está certa — a pessoa
    // precisa decidir qual das duas fica.
    expect(screen.getByLabelText("Alternativa 1")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Alternativa 2")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("estrutura travada (§38)", () => {
  it("com respostas, nada pode ser mexido", () => {
    render(<Wrapper inicial={CINCO} locked />);

    expect(screen.getByLabelText("Alternativa 1")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /adicionar alternativa/i })).toBeNull();
    expect(screen.getByRole("button", { name: /remover "Manter"/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /mover "Manter" para cima/i })).toBeDisabled();
  });

  it("explica POR QUE está travado", () => {
    render(<Wrapper inicial={CINCO} locked />);
    expect(screen.getByText(/já recebeu respostas/i)).toBeInTheDocument();
  });
});
