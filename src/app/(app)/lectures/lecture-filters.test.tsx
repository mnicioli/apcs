import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { DirectoryEntry } from "@/lib/services/profile";
import { EMPTY_LECTURE_FILTERS } from "@/modules/lecture/lecture.types";
import { LectureFiltersBar } from "./lecture-filters";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/lectures/calendar",
}));

const TIME: DirectoryEntry[] = [
  { id: "p1", fullName: "Ana Prado", email: "ana@apcs.com.br", role: "admin" },
];

const CATALOGO = [
  { id: "c1", name: "Dr. Marcelo Ribeiro" },
  { id: "c2", name: "Dra. Helena Costa" },
];

function montar(speakers = CATALOGO) {
  return render(
    <LectureFiltersBar
      filters={EMPTY_LECTURE_FILTERS}
      directory={TIME}
      speakers={speakers}
      showPriority={false}
      showPeriod={false}
    />,
  );
}

describe("filtro de palestrante", () => {
  /**
   * ⚠️ O PEDIDO ERA ESTE, e o defeito que ele evita é sutil: escolher "Dr.
   * Marcelo" ao marcar uma palestra e depois não achá-lo no filtro faz a pessoa
   * concluir que o filtro está quebrado — quando o que faltava era a opção.
   * Como a maioria das palestras da APCS é apresentada por quem não tem login, o
   * filtro só com o time interno não respondia sobre quase ninguém.
   */
  it("oferece os palestrantes do catálogo além do time interno", () => {
    montar();

    const seletor = screen.getByLabelText("Palestrante");
    const opcoes = within(seletor)
      .getAllByRole("option")
      .map((o) => o.textContent);

    expect(opcoes).toEqual(["Todos", "Dr. Marcelo Ribeiro", "Dra. Helena Costa", "Ana Prado"]);
  });

  it("separa as duas origens em grupos, com o catálogo primeiro", () => {
    const { container } = montar();

    const grupos = [...container.querySelectorAll("optgroup")].map((g) => g.label);
    expect(grupos).toEqual(["Palestrantes", "Time interno"]);
  });

  it("sem catálogo, a lista continua sendo a de antes — sem grupo de um item só", () => {
    const { container } = montar([]);

    expect(container.querySelectorAll("optgroup")).toHaveLength(0);
    expect(within(screen.getByLabelText("Palestrante")).getAllByRole("option")).toHaveLength(2);
  });
});

describe("a dica da busca", () => {
  /**
   * ⚠️ A frase ERA um parágrafo fixo embaixo do campo. Como a linha de filtros
   * alinha pela base, aquele parágrafo empurrava a coluna da busca para cima e
   * desalinhava a linha inteira — o "layout quebrado" relatado. Ela continua
   * existindo, só que sob demanda.
   */
  it("não ocupa espaço até alguém pedir", () => {
    montar();

    expect(screen.queryByText(/ignora acentos/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mais informações" })).toBeInTheDocument();
  });
});

describe("placeholders", () => {
  it("a cidade sugere a cidade da APCS", () => {
    montar();
    expect(screen.getByLabelText("Cidade")).toHaveAttribute(
      "placeholder",
      "Espírito Santo do Pinhal",
    );
  });
});
