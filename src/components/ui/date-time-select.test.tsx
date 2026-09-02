import { describe, expect, it } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { DateTimeSelect } from "./date-time-select";

/**
 * ⚠️ ESTE ARQUIVO NASCEU DE UM DEFEITO QUE CHEGOU EM PRODUÇÃO.
 *
 * A primeira versão do componente derivava as duas caixas do `value`: sem data,
 * o valor emitido era "" — e como a hora exibida vinha desse valor, escolher a
 * HORA ANTES DA DATA fazia o seletor voltar para "--" no mesmo instante. A
 * escolha era descartada na frente da pessoa, sem erro nem pista.
 *
 * O type-check passava, o lint passava, o build passava. Só usando aparece.
 *
 * O que se fixa aqui é a REGRA: a tela lembra o que foi escolhido, mesmo
 * enquanto o valor ainda não está completo. Quem consome continua recebendo ""
 * até as duas metades existirem — meio instante não é instante.
 */

function Palco({ inicial = "" }: { inicial?: string }) {
  const [valor, setValor] = useState(inicial);
  return (
    <>
      <DateTimeSelect id="campo" label="Envio" value={valor} onChange={setValor} />
      <output data-testid="valor">{valor}</output>
    </>
  );
}

const data = () => screen.getByLabelText("Envio — data");
const hora = () => screen.getByLabelText("Envio — hora");
const minuto = () => screen.getByLabelText("Envio — minuto");
const valor = () => screen.getByTestId("valor").textContent;

describe("DateTimeSelect", () => {
  it("⚠️ a hora escolhida ANTES da data não é descartada", () => {
    render(<Palco />);

    fireEvent.change(hora(), { target: { value: "15" } });

    // A caixa continua mostrando o que a pessoa escolheu...
    expect(hora()).toHaveValue("15");
    // ...e o minuto ganhou o padrão visível "00", como o TimeSelect faz.
    expect(minuto()).toHaveValue("00");
    // ...mas nada saiu ainda: sem data, não há instante.
    expect(valor()).toBe("");
  });

  it("completar a data depois fecha o valor", () => {
    render(<Palco />);

    fireEvent.change(hora(), { target: { value: "15" } });
    fireEvent.change(minuto(), { target: { value: "05" } });
    fireEvent.change(data(), { target: { value: "2026-09-02" } });

    expect(valor()).toBe("2026-09-02T15:05");
  });

  it("na ordem natural (data e depois hora) também funciona", () => {
    render(<Palco />);

    fireEvent.change(data(), { target: { value: "2026-09-02" } });
    expect(valor()).toBe(""); // só a data ainda não é instante

    fireEvent.change(hora(), { target: { value: "08" } });
    fireEvent.change(minuto(), { target: { value: "40" } });

    expect(valor()).toBe("2026-09-02T08:40");
  });

  it("um valor vindo de fora aparece nas duas caixas", () => {
    // É o caso de editar uma enquete já salva: sem isto, o formulário abriria
    // com os campos vazios sobre dados que existem.
    render(<Palco inicial="2026-09-02T12:15" />);

    expect(data()).toHaveValue("2026-09-02");
    expect(hora()).toHaveValue("12");
    expect(minuto()).toHaveValue("15");
  });

  it("os minutos oferecidos são só os da grade de 5", () => {
    render(<Palco />);

    const opcoes = [...minuto().querySelectorAll("option")]
      .map((o) => o.getAttribute("value"))
      .filter((v) => v !== "");

    expect(opcoes).toEqual([
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

  it("limpar a data devolve o valor para vazio", () => {
    render(<Palco inicial="2026-09-02T12:15" />);

    fireEvent.change(data(), { target: { value: "" } });

    expect(valor()).toBe("");
    // A hora fica onde estava: a pessoa está trocando a data, não desistindo.
    expect(hora()).toHaveValue("12");
  });
});
