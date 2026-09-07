import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LandingFieldList } from "./landing-field-list";
import type { LandingFieldKey } from "@/modules/event/event.landing.types";
import { LANDING_FIELD_HINTS } from "@/modules/event/event.landing.labels";

/**
 * A REORDENAÇÃO DOS CAMPOS (§13, §14, §31).
 *
 * ⚠️ OS TESTES ATACAM O SELETOR DE POSIÇÃO, NÃO O ARRASTAR — e isso é sobre o
 * §31, não sobre preguiça. "Não fazer o Drag & Drop depender exclusivamente do
 * mouse": se o seletor faz tudo o que o arrastar faz, quem navega por teclado
 * consegue trabalhar. Testá-lo é testar a garantia de acessibilidade; o
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

/**
 * ============================================================================
 * ⚠️ AS SETAS SAÍRAM E O `<select>` DE POSIÇÃO ENTROU — O §31 CONTINUA DE PÉ.
 * ============================================================================
 * O pedido foi remover as duas setas de cada linha. Elas eram a ÚNICA forma de
 * reordenar sem mouse, então tirá-las e não pôr nada no lugar quebraria o §31
 * ("Não fazer o Drag & Drop depender exclusivamente do mouse") sem que nenhum
 * teste percebesse — os casos deste bloco simplesmente sumiriam.
 *
 * Eles não sumiram: mudaram de controle. A pergunta continua sendo a mesma —
 * dá para reordenar pelo teclado, e cada controle diz de que campo ele é? — e a
 * resposta agora é um `<select>` nativo, que traz teclado e leitor de tela de
 * graça.
 */
describe("reordenar sem mouse (§31)", () => {
  it("escolher uma posição maior empurra o campo para baixo", async () => {
    const user = userEvent.setup();
    const { onChange } = montar();

    // E-mail está na posição 2; mandá-lo para a 3ª.
    await user.selectOptions(screen.getByLabelText("Posição de E-mail"), "3");

    expect(onChange).toHaveBeenCalledWith([
      "GRANJA_EMPRESA",
      "NOME_PARTICIPANTE",
      "EMAIL",
      "TELEFONE",
      "WHATSAPP",
    ]);
  });

  it("escolher uma posição menor puxa o campo para cima", async () => {
    const user = userEvent.setup();
    const { onChange } = montar();

    await user.selectOptions(screen.getByLabelText("Posição de WhatsApp"), "4");

    expect(onChange).toHaveBeenCalledWith([
      "GRANJA_EMPRESA",
      "EMAIL",
      "NOME_PARTICIPANTE",
      "WHATSAPP",
      "TELEFONE",
    ]);
  });

  /**
   * ⚠️ MOVER, E NÃO TROCAR — e é aqui que a diferença aparece. Com uma TROCA,
   * mandar o último campo para o topo jogaria o primeiro para o fim: dois itens
   * mudam de lugar quando a pessoa pediu um. Com as setas isso nunca dava para
   * ver, porque o passo era sempre de uma posição.
   */
  it("saltar várias posições empurra todo mundo um degrau, sem trocar as pontas", async () => {
    const user = userEvent.setup();
    const { onChange } = montar();

    await user.selectOptions(screen.getByLabelText("Posição de WhatsApp"), "1");

    expect(onChange).toHaveBeenCalledWith([
      "WHATSAPP",
      "GRANJA_EMPRESA",
      "EMAIL",
      "NOME_PARTICIPANTE",
      "TELEFONE",
    ]);
  });

  it("cada campo oferece todas as posições, e a atual vem selecionada", () => {
    montar();

    const email = screen.getByLabelText<HTMLSelectElement>("Posição de E-mail");
    expect(email.value).toBe("2");
    expect([...email.options].map((o) => o.textContent)).toEqual(["1", "2", "3", "4", "5"]);
  });

  /**
   * ⚠️ CADA CONTROLE DIZ DE QUE CAMPO ELE É. Cinco `<select>` chamados
   * "Posição" não servem a quem não vê a tela: um leitor de tela anuncia cinco
   * controles idênticos, e a pessoa não sabe qual é o do e-mail. Era o mesmo
   * cuidado que as setas tinham, e ele não podia se perder na troca.
   */
  it("todos os seletores têm rótulo que nomeia o campo", () => {
    montar();
    for (const rotulo of [
      "Granja / Empresa",
      "E-mail",
      "Nome do Participante",
      "Telefone",
      "WhatsApp",
    ]) {
      expect(screen.getByLabelText(`Posição de ${rotulo}`)).toBeInTheDocument();
    }
  });
});

describe("somente leitura", () => {
  it("desabilitado, nenhum seletor de posição funciona", () => {
    montar(PADRAO, true);
    const seletores = screen.getAllByRole("combobox");
    expect(seletores).toHaveLength(5);
    for (const seletor of seletores) {
      expect(seletor).toBeDisabled();
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

/**
 * ============================================================================
 * ⚠️ AS EXPLICAÇÕES SAÍRAM DA LINHA — E ISSO NASCEU DE UM DEFEITO DE LAYOUT.
 * ============================================================================
 * Cada campo trazia a explicação como um parágrafo embaixo do rótulo. Quando o
 * Builder passou a ter duas colunas, esta lista foi para metade da largura e as
 * frases começaram a empurrar o selo e o seletor de posição para fora da linha.
 *
 * A dica virou `InfoTip`, que flutua sobre a linha quando alguém pergunta. É a
 * mesma conclusão a que a barra de filtros chegou antes — e é literalmente o
 * componente que nasceu daquele problema.
 */
describe("as explicações são dicas, não texto permanente", () => {
  it("o texto não ocupa espaço na linha até alguém pedir", () => {
    montar();

    for (const dica of Object.values(LANDING_FIELD_HINTS)) {
      expect(screen.queryByText(dica)).not.toBeInTheDocument();
    }
  });

  it("cada campo tem um botão de dica que o NOMEIA", () => {
    montar();

    for (const rotulo of [
      "Granja / Empresa",
      "E-mail",
      "Nome do Participante",
      "Telefone",
      "WhatsApp",
    ]) {
      expect(screen.getByRole("button", { name: `Sobre ${rotulo}` })).toBeInTheDocument();
    }
  });

  it("clicar no ícone abre a explicação daquele campo", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole("button", { name: "Sobre E-mail" }));

    const dica = screen.getByRole("tooltip");
    expect(dica.textContent).toBe(LANDING_FIELD_HINTS.EMAIL);
    // E só a dele: uma lista com cinco dicas abertas de uma vez seria o mesmo
    // problema de espaço que a mudança veio consertar.
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
  });

  /**
   * ⚠️ O SELO CONTINUA DIZENDO A OBRIGATORIEDADE, e é por isso que ela saiu do
   * texto da dica. Ele se lê de relance, sem clicar em nada; repetir "Obrigatório"
   * dentro da dica era a mesma coisa dita duas vezes, a segunda em letra menor.
   */
  it("a obrigatoriedade continua no selo, e não dentro da dica", () => {
    montar();

    expect(screen.getAllByText("Obrigatório")).toHaveLength(3);
    for (const dica of Object.values(LANDING_FIELD_HINTS)) {
      expect(dica).not.toContain("Obrigatório");
      expect(dica).not.toContain("Opcional");
    }
  });

  /** Quem só lê também precisa da explicação: entender não é escrever. */
  it("a dica continua disponível em modo somente leitura", () => {
    montar(PADRAO, true);
    expect(screen.getByRole("button", { name: "Sobre Telefone" })).toBeEnabled();
  });
});
