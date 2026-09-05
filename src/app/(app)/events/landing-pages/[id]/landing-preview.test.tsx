import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LandingPreview, type LandingPreviewState } from "./landing-preview";
import type { LandingFieldKey } from "@/modules/event/event.landing.types";

/**
 * A PRÉVIA (§15, §19, §20, §21, §34).
 *
 * ============================================================================
 * ⚠️ O TESTE MAIS IMPORTANTE DESTE ARQUIVO É O ÚLTIMO BLOCO: a prévia não cria
 * inscrição.
 * ============================================================================
 * O §34 proíbe, e a garantia é ESTRUTURAL — este componente não importa Server
 * Action nenhuma. Repare que não há `vi.mock` aqui: nada precisa ser dublado,
 * porque não há nada que fale com o servidor. Um `vi.mock` de action nesta
 * bateria seria o sinal de que a garantia se perdeu.
 */

const EVENTO = {
  name: "Encontro Técnico e Comercial",
  eventDate: "2026-09-18",
  startTime: "08:00",
  endTime: "13:00",
  location: "Toledo — PR",
};

const PADROES = {
  title: "INSCRIÇÃO CONFIRMADA!",
  message: "Seu cadastro para o {{event_name}} foi realizado com sucesso.",
  footer: "Esperamos você! Nos vemos no evento.",
};

const CAMPOS: LandingFieldKey[] = [
  "GRANJA_EMPRESA",
  "EMAIL",
  "NOME_PARTICIPANTE",
  "TELEFONE",
  "WHATSAPP",
];

function estado(overrides: Partial<LandingPreviewState> = {}): LandingPreviewState {
  return {
    description: "",
    formFields: CAMPOS,
    successTitle: "",
    successMessage: "",
    successFooter: "",
    maxParticipants: "",
    ...overrides,
  };
}

/** O texto do bloco de um participante — é onde a ordem dos campos aparece. */
function blocoDoParticipante(numero: number): string {
  const titulo = screen.getByText(`Participante ${numero}`);
  // O título mora num cabeçalho dentro do bloco; dois níveis acima está o
  // `<div>` que agrupa os campos daquela pessoa.
  return titulo.parentElement?.parentElement?.textContent ?? "";
}

function montar(overrides: Partial<LandingPreviewState> = {}) {
  return render(
    <LandingPreview
      state={estado(overrides)}
      event={EVENTO}
      imageUrl={null}
      successDefaults={PADROES}
    />,
  );
}

describe("os dados do evento (§7, §11)", () => {
  it("mostra nome, data, horário e local vindos do evento", () => {
    const { container } = montar();

    expect(screen.getByRole("heading", { name: EVENTO.name })).toBeInTheDocument();
    // A data e o horário dividem o mesmo parágrafo, separados por um ponto —
    // por isso a asserção é sobre o texto da prévia inteira, e não sobre um nó.
    expect(container.textContent).toContain("18/09/2026");
    expect(container.textContent).toContain("08:00 às 13:00");
    expect(screen.getByText(EVENTO.location)).toBeInTheDocument();
  });

  /**
   * §9: "A alteração do título da Landing Page não deve alterar o nome oficial
   * do evento." A forma escolhida de garantir isso é não haver campo de título
   * — o cabeçalho da prévia é o nome do evento, e ponto.
   */
  it("o título é o nome do evento, sem override", () => {
    montar({ description: "Um texto qualquer" });
    expect(screen.getByRole("heading", { name: EVENTO.name })).toBeInTheDocument();
  });
});

describe("a descrição (§10, §19)", () => {
  it("aparece quando preenchida", () => {
    montar({ description: "Dois dias de conteúdo técnico." });
    expect(screen.getByText("Dois dias de conteúdo técnico.")).toBeInTheDocument();
  });

  it("some quando vazia, em vez de deixar um espaço em branco", () => {
    const { container } = render(
      <LandingPreview
        state={estado({ description: "   " })}
        event={EVENTO}
        imageUrl={null}
        successDefaults={PADROES}
      />,
    );
    expect(container.textContent).not.toContain("undefined");
  });
});

describe("a ordem dos campos (§13, §19)", () => {
  it("segue a lista recebida", () => {
    montar();
    // ⚠️ O TEXTO NO DOM É "E-mail", NÃO "E-MAIL". As maiúsculas da prévia vêm
    // de `text-transform` no CSS, e CSS não muda o conteúdo do nó. Uma asserção
    // escrita com a forma maiúscula pareceria testar a tela e não testaria nada.
    const texto = blocoDoParticipante(1);
    expect(texto.indexOf("E-mail")).toBeLessThan(texto.indexOf("Nome do Participante"));
    expect(texto.indexOf("Nome do Participante")).toBeLessThan(texto.indexOf("Telefone"));
  });

  it("reordenar a lista reordena a prévia — sem salvar nada", () => {
    montar({
      formFields: ["GRANJA_EMPRESA", "WHATSAPP", "EMAIL", "NOME_PARTICIPANTE", "TELEFONE"],
    });

    const texto = blocoDoParticipante(1);
    expect(texto.indexOf("WhatsApp")).toBeLessThan(texto.indexOf("E-mail"));
  });

  /**
   * ⚠️ A GRANJA APARECE UMA VEZ SÓ, FORA DO BLOCO DO PARTICIPANTE (§15).
   *
   * É o modelo de dados aparecendo na tela: a inscrição é da granja, e as
   * pessoas pertencem a ela. Uma prévia que repetisse "Granja / Empresa" em
   * cada participante ensinaria o contrário — e faria alguém desenhar o
   * Prompt 3 errado.
   */
  it("granja/empresa aparece uma vez, fora do bloco do participante", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole("button", { name: /adicionar participante/i }));

    // Dois participantes na tela...
    expect(screen.getByText("Participante 1")).toBeInTheDocument();
    expect(screen.getByText("Participante 2")).toBeInTheDocument();
    // ...e uma única granja.
    expect(screen.getAllByText("Granja / Empresa")).toHaveLength(1);
    // Mas dois e-mails, um por pessoa.
    expect(screen.getAllByText("E-mail")).toHaveLength(2);
  });
});

describe("múltiplos participantes (§15)", () => {
  it("adicionar acrescenta um bloco; remover tira", async () => {
    const user = userEvent.setup();
    montar();

    expect(screen.queryByText("Participante 2")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /adicionar participante/i }));
    expect(screen.getByText("Participante 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^remover$/i }));
    expect(screen.queryByText("Participante 2")).not.toBeInTheDocument();
  });

  it("o primeiro participante não tem botão de remover", () => {
    montar();
    expect(screen.queryByRole("button", { name: /^remover$/i })).not.toBeInTheDocument();
  });
});

describe("desktop e celular (§20)", () => {
  it("os dois botões existem e o computador começa selecionado", () => {
    montar();
    expect(screen.getByRole("button", { name: "Computador" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Celular" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("trocar para celular estreita a prévia", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole("button", { name: "Celular" }));

    expect(screen.getByRole("button", { name: "Celular" })).toHaveAttribute("aria-pressed", "true");
    // A largura fixa é o que faz a composição ser conferível; sem ela, o botão
    // seria decorativo.
    expect(document.querySelector(".w-\\[22rem\\]")).not.toBeNull();
  });
});

describe("a mensagem de confirmação (§17, §18)", () => {
  it("usa o padrão da plataforma e substitui a variável", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole("button", { name: /ver confirmação/i }));

    expect(screen.getByRole("heading", { name: "INSCRIÇÃO CONFIRMADA!" })).toBeInTheDocument();
    expect(
      screen.getByText(`Seu cadastro para o ${EVENTO.name} foi realizado com sucesso.`),
    ).toBeInTheDocument();
  });

  it("o texto da página sobrescreve o padrão, pedaço a pedaço", async () => {
    const user = userEvent.setup();
    montar({ successTitle: "TUDO CERTO!" });

    await user.click(screen.getByRole("button", { name: /ver confirmação/i }));

    expect(screen.getByRole("heading", { name: "TUDO CERTO!" })).toBeInTheDocument();
    // O que não foi sobrescrito continua vindo do padrão.
    expect(screen.getByText(PADROES.footer)).toBeInTheDocument();
  });

  it("substitui as quatro variáveis do §18", async () => {
    const user = userEvent.setup();
    montar({
      successMessage: "{{event_name}} · {{event_date}} · {{event_start_time}}–{{event_end_time}}",
    });

    await user.click(screen.getByRole("button", { name: /ver confirmação/i }));

    expect(screen.getByText(`${EVENTO.name} · 18/09/2026 · 08:00–13:00`)).toBeInTheDocument();
  });

  /**
   * ⚠️ VARIÁVEL DESCONHECIDA FICA LITERAL, e isso é o §18 ("Não permitir
   * variáveis arbitrárias") com a escolha certa de comportamento. Um marcador
   * que sumisse deixaria a frase truncada e ninguém descobriria por quê; um
   * marcador que aparece cru é visível no segundo em que se digita.
   */
  it("variável que não existe fica visível em vez de sumir", async () => {
    const user = userEvent.setup();
    montar({ successMessage: "Olá {{nome_do_participante}}" });

    await user.click(screen.getByRole("button", { name: /ver confirmação/i }));

    expect(screen.getByText("Olá {{nome_do_participante}}")).toBeInTheDocument();
  });
});

describe("identidade institucional (§21)", () => {
  it("APCS e CSPI aparecem, e não há como removê-los", () => {
    const { container } = montar();

    // O logo da APCS, pelo texto alternativo.
    expect(screen.getByAltText(/APCS/)).toBeInTheDocument();
    expect(screen.getByText("CSPI")).toBeInTheDocument();
    expect(screen.getByText("APCS · CSPI")).toBeInTheDocument();

    // ⚠️ NENHUM CONTROLE PARA MEXER NISSO. A identidade não é um dado — não há
    // campo, não há coluna, não há botão. É o §19 do Prompt 1 sendo cobrado
    // pela tela do Prompt 2.
    expect(within(container).queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("capacidade (§16)", () => {
  it("anuncia o limite quando há um", () => {
    montar({ maxParticipants: "100" });
    expect(screen.getByText(/vagas limitadas: 100 participantes/i)).toBeInTheDocument();
  });

  it("não diz nada quando é ilimitado", () => {
    montar({ maxParticipants: "" });
    expect(screen.queryByText(/vagas limitadas/i)).not.toBeInTheDocument();
  });
});

/**
 * ============================================================================
 * ⚠️ O §34 — A PRÉVIA NÃO CRIA INSCRIÇÃO.
 * ============================================================================
 */
describe("a prévia não escreve nada", () => {
  it("o botão de confirmar inscrição não é um botão", () => {
    montar();

    // O texto está lá, para a composição ficar completa...
    expect(screen.getByText("Confirmar inscrição")).toBeInTheDocument();
    // ...e não é clicável. Um `<button>` aqui convidaria alguém a ligar um
    // `onClick` nele um dia.
    expect(screen.queryByRole("button", { name: /confirmar inscrição/i })).not.toBeInTheDocument();
  });

  /**
   * ⚠️ OS CAMPOS SÃO DESENHADOS, NÃO SÃO `<input>`. Um campo de verdade entra
   * na ordem de tabulação e é anunciado por leitor de tela como preenchível —
   * e não é. Quem chega na prévia pelo teclado passaria por dez caixas mortas.
   */
  it("não há campo preenchível na prévia", () => {
    montar();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("avisa, por escrito, que nada é registrado", () => {
    montar();
    expect(screen.getByText(/não registra nada/i)).toBeInTheDocument();
  });
});
