import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimeSelect } from "./time-select";

/**
 * O SELETOR DE HORÁRIO.
 *
 * ⚠️ O QUE ESTE ARQUIVO PROTEGE é a razão de o componente existir: o campo
 * nativo `<input type="time">` estava aqui com `step={300}` e o Chrome listava
 * os sessenta minutos assim mesmo. A tela oferecia 14:56 e o Zod recusava.
 *
 * O primeiro teste é o que impede alguém voltar ao campo nativo "para
 * simplificar" — ele falha na hora em que a lista deixa de ser a grade de cinco
 * em cinco.
 */

function minutos(): string[] {
  const seletor = screen.getByLabelText("Hora de início — minuto");
  return within(seletor)
    .getAllByRole("option")
    .map((o) => (o as HTMLOptionElement).value)
    .filter((v) => v !== "");
}

describe("TimeSelect", () => {
  it("oferece APENAS os minutos de 5 em 5", () => {
    render(<TimeSelect id="t" label="Hora de início" required value="" onChange={() => {}} />);

    expect(minutos()).toEqual([
      "00",
      "05",
      "10",
      "15",
      "20",
      "25",
      "30",
      "35",
      "40",
      "45",
      "50",
      "55",
    ]);
  });

  it("oferece as vinte e quatro horas", () => {
    render(<TimeSelect id="t" label="Hora de início" required value="" onChange={() => {}} />);

    const horas = within(screen.getByLabelText("Hora de início — hora"))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== "");

    expect(horas).toHaveLength(24);
    expect(horas[0]).toBe("00");
    expect(horas[23]).toBe("23");
  });

  it("mostra o horário que recebeu, separado nos dois campos", () => {
    render(<TimeSelect id="t" label="Hora de início" required value="14:30" onChange={() => {}} />);

    expect(screen.getByLabelText("Hora de início — hora")).toHaveValue("14");
    expect(screen.getByLabelText("Hora de início — minuto")).toHaveValue("30");
  });

  it("escolher a hora já produz um horário fechado", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TimeSelect id="t" label="Hora de início" required value="" onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText("Hora de início — hora"), "09");

    expect(onChange).toHaveBeenCalledWith("09:00");
  });

  it("trocar o minuto mantém a hora escolhida", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TimeSelect id="t" label="Hora de início" required value="09:00" onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText("Hora de início — minuto"), "45");

    expect(onChange).toHaveBeenCalledWith("09:45");
  });

  /**
   * ⚠️ MEIO HORÁRIO NÃO É HORÁRIO. Devolver "14:" ou inventar "00:30" a partir
   * de um minuto escolhido sem hora seria o sistema decidindo um horário que
   * ninguém escolheu — e é assim que uma palestra é anunciada à meia-noite.
   */
  it("minuto sem hora não vira horário", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TimeSelect id="t" label="Hora de término" value="" onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText("Hora de término — minuto"), "30");

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("o campo opcional pode ser esvaziado de volta", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TimeSelect id="t" label="Hora de término" value="17:00" onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText("Hora de término — hora"), "");

    expect(onChange).toHaveBeenCalledWith("");
  });

  /**
   * O obrigatório não oferece "--" depois de preenchido: uma vez que há
   * horário, esvaziá-lo só cria um estado que o formulário vai recusar.
   */
  it("o obrigatório perde a opção em branco depois de preenchido", () => {
    const { rerender } = render(
      <TimeSelect id="t" label="Hora de início" required value="" onChange={() => {}} />,
    );
    expect(
      within(screen.getByLabelText("Hora de início — hora")).getByRole("option", { name: "--" }),
    ).toBeInTheDocument();

    rerender(
      <TimeSelect id="t" label="Hora de início" required value="08:00" onChange={() => {}} />,
    );
    expect(
      within(screen.getByLabelText("Hora de início — hora")).queryByRole("option", { name: "--" }),
    ).not.toBeInTheDocument();
  });
});
