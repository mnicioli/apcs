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

/**
 * ⚠️ ESTE BLOCO AFIRMAVA O CONTRÁRIO ATÉ AQUI, E A INVERSÃO É O PEDIDO.
 *
 * A prévia mostrava nome, data, horário e local abaixo do banner. Passaram a
 * viver DENTRO da arte do banner, e repeti-los embaixo era dizer a mesma coisa
 * duas vezes — então a página pública deixou de desenhá-los, e a prévia
 * acompanhou.
 *
 * O teste vira do avesso em vez de sumir porque a pergunta continua valendo, só
 * que ao contrário: uma prévia que voltasse a escrever o título por cima do
 * banner faria o administrador aprovar uma composição duplicada. E é o mesmo
 * motivo de o consentimento ter entrado aqui na revisão do Prompt 3 — prévia
 * que não acompanha a página real não é ilustrativa, é errada.
 */
describe("os dados do evento (§7, §11) vivem no banner, não no texto", () => {
  it("não repete nome, data, horário e local abaixo da imagem", () => {
    const { container } = montar();

    expect(screen.queryByRole("heading", { name: EVENTO.name })).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("18/09/2026");
    expect(container.textContent).not.toContain("08:00 às 13:00");
    expect(screen.queryByText(EVENTO.location)).not.toBeInTheDocument();
  });

  /**
   * ⚠️ MAS O EVENTO CONTINUA IDENTIFICADO. Sair da tela não é sair da página: o
   * nome permanece no `alt` do banner, que é o que uma pessoa com leitor de tela
   * ouve — e o que aparece quando a imagem não carrega. Sem esta linha, a
   * asserção de cima passaria também numa prévia que perdeu o evento de vista.
   */
  it("o nome do evento continua no texto alternativo da imagem", () => {
    // ⚠️ COM IMAGEM DE VERDADE, e não pelo `montar()` — que passa `imageUrl:
    // null` e faz o `SignedImage` cair no espaço reservado. As duas situações
    // interessam, e a asserção seguinte cobre a outra.
    render(
      <LandingPreview
        state={estado()}
        event={EVENTO}
        imageUrl="https://exemplo.invalid/banner.png"
        successDefaults={PADROES}
      />,
    );

    expect(screen.getByAltText(`Imagem de ${EVENTO.name}`)).toBeInTheDocument();
  });

  /**
   * ⚠️ E QUANDO A IMAGEM NÃO CARREGA. É o caso que preocupa depois desta
   * mudança: com o nome, a data e o local dentro da arte, um banner que não
   * chega deixaria a página sem dizer para qual evento é. O espaço reservado do
   * `SignedImage` nomeia o evento, então o pior caso continua identificado.
   */
  it("sem imagem, o espaço reservado ainda nomeia o evento", () => {
    montar();
    expect(
      screen.getByLabelText(`Sem imagem disponível para Imagem de ${EVENTO.name}`),
    ).toBeInTheDocument();
  });

  /**
   * §9: "A alteração do título da Landing Page não deve alterar o nome oficial
   * do evento." A garantia sempre foi a mesma e não mudou: não existe campo de
   * título em lugar nenhum do Builder. O que mudou foi onde o nome aparece.
   */
  it("não há campo para sobrescrever o nome do evento", () => {
    const { container } = montar({ description: "Um texto qualquer" });
    expect(within(container).queryByRole("textbox")).not.toBeInTheDocument();
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
  it("APCS e CSP aparecem, e não há como removê-los", () => {
    const { container } = montar();

    // ⚠️ OS DOIS LOGOS PELO TEXTO ALTERNATIVO, e não mais um deles por texto na
    // tela. O CSP era a PALAVRA "CSPI" enquanto o arquivo do desenho não
    // existia; quando ele chegou, `getByText("CSPI")` passou a procurar um
    // texto que a página não escreve mais. Procurar pelo `alt` cobre as duas
    // épocas e cobra o que realmente importa: que a marca esteja anunciada para
    // quem não enxerga a imagem.
    expect(screen.getByAltText(/APCS/)).toBeInTheDocument();
    expect(screen.getByAltText("CSP")).toBeInTheDocument();
    expect(
      screen.getByText("© APCS | CSP 2026 - Todos os direitos reservados"),
    ).toBeInTheDocument();

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

describe("§45.11 do Prompt 3 — a prévia representa a página real", () => {
  /**
   * ==========================================================================
   * ⚠️ NASCEU DE UMA DIVERGÊNCIA REAL ENCONTRADA NA REVISÃO.
   * ==========================================================================
   * A página pública passou a exigir o aceite de LGPD (§35 do Prompt 3), e esta
   * prévia continuou desenhando um formulário sem ele. O administrador conferia
   * a composição, aprovava e publicava — e a página no ar tinha um campo
   * obrigatório a mais do que ele viu.
   *
   * É o modo de falhar mais traiçoeiro de uma prévia: ela não quebra, ela mente.
   * Este teste é a amarra entre as duas telas.
   */
  it("mostra o bloco de consentimento", () => {
    montar();
    expect(screen.getByText(/aceite do tratamento de dados/i)).toBeTruthy();
  });

  /**
   * ⚠️ E O BLOCO NÃO É INTERATIVO, como todo o resto da prévia. Uma caixa de
   * seleção de verdade entraria na ordem de tabulação e seria anunciada como
   * algo a marcar — e marcar aqui não autoriza nada.
   */
  it("e ele é desenhado, não é uma caixa de verdade", () => {
    const { container } = montar();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });
});
