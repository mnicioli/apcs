import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EventSegment } from "@/modules/event/event.types";
import { EventSegmentsCell } from "./event-segments-cell";

function publico(id: string, name: string, description: string | null = null): EventSegment {
  return { id, slug: id, name, description };
}

describe("EventSegmentsCell", () => {
  it("sem público, mostra travessão", () => {
    render(<EventSegmentsCell segments={[]} eventName="Workshop" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("com um público, mostra o nome sem contador", () => {
    render(
      <EventSegmentsCell segments={[publico("a", "Todos os associados")]} eventName="Workshop" />,
    );
    const gatilho = screen.getByRole("button");
    expect(within(gatilho).getByText("Todos os associados")).toBeInTheDocument();
    expect(within(gatilho).queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  });

  // A célula não pode crescer com a lista: uma linha que estica empurra a coluna
  // de ações para fora da tela.
  //
  // As consultas são ESCOPADAS ao gatilho de propósito: o `<dialog>` mantém o
  // conteúdo no DOM mesmo fechado (`display:none`), então uma busca no documento
  // inteiro acharia os nomes duas vezes.
  it("com vários, mostra o primeiro e '+N'", () => {
    render(
      <EventSegmentsCell
        segments={[publico("a", "Todos"), publico("b", "Câmara"), publico("c", "Selo")]}
        eventName="Workshop"
      />,
    );
    const gatilho = screen.getByRole("button");
    expect(within(gatilho).getByText("Todos")).toBeInTheDocument();
    expect(within(gatilho).getByText("+2")).toBeInTheDocument();
    expect(within(gatilho).queryByText("Câmara")).not.toBeInTheDocument();
  });

  it("o diálogo começa fechado", () => {
    const { container } = render(
      <EventSegmentsCell
        segments={[publico("a", "Todos"), publico("b", "Câmara")]}
        eventName="Workshop"
      />,
    );
    expect(container.querySelector("dialog")).not.toHaveAttribute("open");
  });

  it("o gatilho é um botão de verdade, com rótulo acessível", () => {
    render(
      <EventSegmentsCell
        segments={[publico("a", "Todos"), publico("b", "Câmara")]}
        eventName="Workshop APCS"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Ver os 2 públicos-alvo de Workshop APCS" }),
    ).toBeInTheDocument();
  });

  it("clicar abre a lista completa, com as descrições", async () => {
    const user = userEvent.setup();
    render(
      <EventSegmentsCell
        segments={[
          publico("a", "Todos", "Toda a base de associados."),
          publico("b", "Câmara Ambiental"),
        ]}
        eventName="Workshop"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Ver os 2 públicos/ }));

    expect(screen.getByText("Câmara Ambiental")).toBeInTheDocument();
    expect(screen.getByText("Toda a base de associados.")).toBeInTheDocument();
  });
});
