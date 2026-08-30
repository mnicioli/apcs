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

const CIDADES = ["Espírito Santo do Pinhal", "Mogi Guaçu"];

function montar(speakers = CATALOGO, cities = CIDADES, filters = EMPTY_LECTURE_FILTERS) {
  return render(
    <LectureFiltersBar
      filters={filters}
      directory={TIME}
      speakers={speakers}
      cities={cities}
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

/**
 * O FILTRO DE CIDADE — era um campo de texto, virou lista.
 *
 * ⚠️ O DEFEITO QUE A TROCA CONSERTA ERRAVA CALADO. Digitar "espirito santo do
 * pinhal" não encontrava as palestras gravadas como "Espírito Santo do Pinhal",
 * e a tela respondia "nenhuma palestra encontrada" com a mesma cara de quando
 * realmente não há nenhuma — mandando procurar defeito nas palestras em vez de
 * no acento.
 */
describe("filtro de cidade", () => {
  it("oferece as cidades cadastradas, e 'todas' como padrão", () => {
    montar();

    const opcoes = within(screen.getByLabelText("Cidade"))
      .getAllByRole("option")
      .map((o) => o.textContent);

    expect(opcoes).toEqual(["Todas as cidades", "Espírito Santo do Pinhal", "Mogi Guaçu"]);
  });

  /**
   * ⚠️ Uma cidade DESATIVADA — ou um link antigo — deixa a URL filtrada por algo
   * que não está mais na lista. Sem esta opção extra o seletor mostraria "Todas
   * as cidades" enquanto a grid continuasse filtrada: a tela mentindo sobre o
   * próprio estado.
   */
  it("mostra a cidade que está na URL mesmo fora do catálogo", () => {
    montar(CATALOGO, CIDADES, { ...EMPTY_LECTURE_FILTERS, city: "Andradas" });

    const seletor = screen.getByLabelText("Cidade");
    expect(seletor).toHaveValue("Andradas");
    expect(within(seletor).getByRole("option", { name: "Andradas" })).toBeInTheDocument();
  });

  it("sem catálogo, sobra só 'todas' — e a tela continua utilizável", () => {
    montar(CATALOGO, []);

    const opcoes = within(screen.getByLabelText("Cidade"))
      .getAllByRole("option")
      .map((o) => o.textContent);

    expect(opcoes).toEqual(["Todas as cidades"]);
  });
});
