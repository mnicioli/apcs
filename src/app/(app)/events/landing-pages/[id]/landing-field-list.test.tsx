import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LandingFieldList } from "./landing-field-list";
import type { LandingFieldKey } from "@/modules/event/event.landing.types";

/**
 * A REORDENAÇÃO DOS CAMPOS (§13, §14, §31).
 *
 * ⚠️ OS TESTES ATACAM AS SETAS, NÃO O ARRASTAR — e isso é sobre o §31, não
 * sobre preguiça. "Não fazer o Drag & Drop depender exclusivamente do mouse":
 * se as setas fazem tudo o que o arrastar faz, quem navega por teclado
 * consegue trabalhar. Testar as setas é testar a garantia de acessibilidade; o
 * arrastar é o atalho por cima dela.
 *
 * (`happy-dom` não simula uma sessão de drag & drop nativa de forma fiel — os
 * eventos existem, mas o `dataTransfer` e a sequência de arrasto do navegador
 * não. Um teste que os simulasse à mão estaria testando o meu mock.)
 */

const PADRAO: LandingFieldKey[] = [
  "GRANJA_EMPRESA",
  "EMAIL",
  "NOME_PARTICIPANTE",
  "TELEFONE",
  "WHATSAPP",
];

function montar(fields: LandingFieldKey[] = PADRAO, disabled = false) {
  const onChange = vi.fn();
  render(<LandingFieldList fields={fields} onChange={onChange} disabled={disabled} />);
  return { onChange };
}

describe("ordem inicial (§12)", () => {
  it("mostra os cinco campos na ordem exigida pelo escopo", () => {
    montar();
    const itens = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");

    expect(itens[0]).toContain("Granja / Empresa");
    expect(itens[1]).toContain("E-mail");
    expect(itens[2]).toContain("Nome do Participante");
    expect(itens[3]).toContain("Telefone");
    expect(itens[4]).toContain("WhatsApp");
  });
});

describe("obrigatoriedade é APRESENTADA, não editável (§14)", () => {
  it("os três obrigatórios trazem o selo, e não há caixa para desmarcar", () => {
    montar();

    // Três selos "Obrigatório" — granja, e-mail e nome.
    expect(screen.getAllByText("Obrigatório")).toHaveLength(3);
    // E os dois de contato dizem a regra deles.
    expect(screen.getAllByText("Telefone ou WhatsApp")).toHaveLength(2);

    // ⚠️ NENHUM CONTROLE DE OBRIGATORIEDADE. O §14 proíbe o administrador de
    // desconfigurar essas regras nesta versão — e a forma de garantir isso é
    // não existir o controle.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  /** §13: reordenar não pode remover. Não há botão de lixeira nesta lista. */
  it("não há como remover um campo", () => {
    montar();
    expect(screen.queryByRole("button", { name: /remover/i })).not.toBeInTheDocument();
  });
});

describe("reordenar pelo teclado (§31)", () => {
  it("mover para baixo troca com o vizinho de baixo", async () => {
    const user = userEvent.setup();
    const { onChange } = montar();

    await user.click(screen.getByRole("button", { name: "Mover E-mail para baixo" }));

    expect(onChange).toHaveBeenCalledWith([
      "GRANJA_EMPRESA",
      "NOME_PARTICIPANTE",
      "EMAIL",
      "TELEFONE",
      "WHATSAPP",
    ]);
  });

  it("mover para cima troca com o vizinho de cima", async () => {
    const user = userEvent.setup();
    const { onChange } = montar();

    await user.click(screen.getByRole("button", { name: "Mover WhatsApp para cima" }));

    expect(onChange).toHaveBeenCalledWith([
      "GRANJA_EMPRESA",
      "EMAIL",
      "NOME_PARTICIPANTE",
      "WHATSAPP",
      "TELEFONE",
    ]);
  });

  it("o primeiro não sobe e o último não desce", () => {
    montar();
    expect(screen.getByRole("button", { name: "Mover Granja / Empresa para cima" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mover WhatsApp para baixo" })).toBeDisabled();
  });

  /**
   * ⚠️ CADA BOTÃO DIZ O QUE FAZ E COM QUÊ. "Mover para cima" repetido cinco
   * vezes não serve a quem não vê a tela: um leitor de tela anuncia cinco
   * botões idênticos, e a pessoa não sabe qual é o do e-mail.
   */
  it("todos os botões de mover têm rótulo que nomeia o campo", () => {
    montar();
    for (const rotulo of [
      "Granja / Empresa",
      "E-mail",
      "Nome do Participante",
      "Telefone",
      "WhatsApp",
    ]) {
      expect(screen.getByRole("button", { name: `Mover ${rotulo} para cima` })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `Mover ${rotulo} para baixo` }),
      ).toBeInTheDocument();
    }
  });
});

describe("somente leitura", () => {
  it("desabilitado, nenhuma seta funciona", () => {
    montar(PADRAO, true);
    for (const botao of screen.getAllByRole("button")) {
      expect(botao).toBeDisabled();
    }
  });

  it("desabilitado, os itens não são arrastáveis", () => {
    montar(PADRAO, true);
    for (const item of screen.getAllByRole("listitem")) {
      expect(item).not.toHaveAttribute("draggable", "true");
    }
  });

  it("habilitado, os itens são arrastáveis", () => {
    montar();
    for (const item of screen.getAllByRole("listitem")) {
      expect(item).toHaveAttribute("draggable", "true");
    }
  });
});
