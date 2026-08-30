import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { EMPTY_LECTURE_FILTERS } from "@/modules/lecture/lecture.types";
import { CalendarToolbar } from "./calendar-toolbar";

/**
 * A BARRA DO CALENDÁRIO — o que ela oferece e em que ordem.
 *
 * ⚠️ A ordem das visões é conteúdo, não estética: do período mais curto para o
 * mais longo, cada passo é um degrau na mesma direção. A lista antiga começava
 * pela mensal e depois voltava para semanal e diária, o que fazia quem quer
 * "abrir mais" ou "fechar mais" o zoom não ter para onde olhar.
 *
 * E a armadilha que este teste guarda: a visão que ABRE (mensal) não é mais a
 * primeira da lista. Quem trocar `DEFAULT_CALENDAR_VIEW` por `CALENDAR_VIEWS[0]`
 * num futuro "isso dá na mesma" faz o calendário abrir na visão diária.
 */
function montar(view: "day" | "week" | "month" | "year" = "month") {
  return render(
    <CalendarToolbar
      view={view}
      anchor="2026-08-01"
      today="2026-08-29"
      filters={EMPTY_LECTURE_FILTERS}
      canWrite
    />,
  );
}

function visoes(): string[] {
  const grupo = screen.getByRole("group", { name: "Modo de visualização" });
  return within(grupo)
    .getAllByRole("link")
    .map((link) => link.textContent ?? "");
}

describe("seletor de visão do calendário", () => {
  it("lista da menor para a maior unidade de tempo", () => {
    montar();
    expect(visoes()).toEqual(["Diária", "Semanal", "Mensal", "Anual"]);
  });

  it("marca como atual a visão em que a página está — a mensal, por padrão", () => {
    montar("month");

    const grupo = screen.getByRole("group", { name: "Modo de visualização" });
    const atual = within(grupo).getByRole("link", { name: "Mensal" });

    expect(atual).toHaveAttribute("aria-current", "true");
    // As outras três NÃO se anunciam como atuais — senão o leitor de tela diria
    // que a pessoa está em quatro lugares ao mesmo tempo.
    for (const nome of ["Diária", "Semanal", "Anual"]) {
      expect(within(grupo).getByRole("link", { name: nome })).not.toHaveAttribute("aria-current");
    }
  });

  it("a ordem da lista não muda com a visão selecionada", () => {
    // A lista é um mapa fixo, não um "a atual primeiro": um seletor que se
    // reordena sozinho move o alvo debaixo do cursor de quem clica duas vezes.
    montar("year");
    expect(visoes()).toEqual(["Diária", "Semanal", "Mensal", "Anual"]);
  });
});
