import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LandingPreview, type LandingPreviewState } from "./landing-preview";
import type { LandingFieldKey } from "@/modules/event/event.landing.types";

/**
 * A PRÉVIA (§15, §19, §20, §21, §34).
 *
 * ============================================================================
 * ⚠️ O TESTE MAIS IMPORTANTE DESTE ARQUIVO É O PENÚLTIMO BLOCO: a prévia não
 * cria inscrição.
 * ============================================================================
 * O §34 proíbe, e a garantia é ESTRUTURAL — este componente não importa Server
 * Action nenhuma. Repare que não há `vi.mock` aqui: nada precisa ser dublado,
 * porque não há nada que fale com o servidor. Um `vi.mock` de action nesta
 * bateria seria o sinal de que a garantia se perdeu.
 *
 * ============================================================================
 * ⚠️ AS DUAS TELAS ESTÃO NO DOM AO MESMO TEMPO — E ISSO MUDA COMO SE ASSERTA.
 * ============================================================================
 * A prévia era uma tela de cada vez, com um botão que alternava entre elas.
 * Virou duas colunas simultâneas, e a consequência para esta bateria é direta:
 * `screen.getByText("18/09/2026")` agora acharia a data da CONFIRMAÇÃO mesmo
 * numa asserção que fala do formulário — e passaria dizendo o contrário do que
 * pretende.
 *
 * É por isso que existe `painel()`. Toda asserção que fala de UMA das telas é
 * feita dentro dela; só o que é comum às duas (a largura, os logos) é procurado
 * na tela inteira.
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
    formFields: CAMPOS,
    maxParticipants: "",
    ...overrides,
  };
}

interface Artes {
  imageUrl?: string | null;
  successImageUrl?: string | null;
}

function montar(overrides: Partial<LandingPreviewState> = {}, artes: Artes = {}) {
  return render(
    <LandingPreview
      state={estado(overrides)}
      event={EVENTO}
      imageUrl={artes.imageUrl ?? null}
      successImageUrl={artes.successImageUrl ?? null}
      successDefaults={PADROES}
    />,
  );
}

/** Uma das duas colunas, pelo cabeçalho dela. Ver o aviso do topo. */
function painel(titulo: "Ver formulário" | "Ver confirmação"): HTMLElement {
  const cabecalho = screen.getByRole("heading", { name: titulo });
  const secao = cabecalho.closest("section");
  if (!secao) throw new Error(`painel "${titulo}" não encontrado`);
  return secao;
}

/** O texto do bloco de um participante — é onde a ordem dos campos aparece. */
function blocoDoParticipante(numero: number): string {
  const titulo = screen.getByText(`Participante ${numero}`);
  // O título mora num cabeçalho dentro do bloco; dois níveis acima está o
  // `<div>` que agrupa os campos daquela pessoa.
  return titulo.parentElement?.parentElement?.textContent ?? "";
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
    montar();
    const formulario = painel("Ver formulário");

    expect(
      within(formulario).queryByRole("heading", { name: EVENTO.name }),
    ).not.toBeInTheDocument();
    expect(formulario.textContent).not.toContain("18/09/2026");
    expect(formulario.textContent).not.toContain("08:00 às 13:00");
    expect(within(formulario).queryByText(EVENTO.location)).not.toBeInTheDocument();
  });

  /**
   * ⚠️ MAS O EVENTO CONTINUA IDENTIFICADO. Sair da tela não é sair da página: o
   * nome permanece no `alt` do banner, que é o que uma pessoa com leitor de tela
   * ouve — e o que aparece quando a imagem não carrega. Sem esta linha, a
   * asserção de cima passaria também numa prévia que perdeu o evento de vista.
   */
  it("o nome do evento continua no texto alternativo da imagem", () => {
    // ⚠️ COM IMAGEM DE VERDADE, e não pelo `montar()` sem artes — que passa
    // `null` e faz o `SignedImage` cair no espaço reservado. As duas situações
    // interessam, e a asserção seguinte cobre a outra.
    montar({}, { imageUrl: "https://exemplo.invalid/banner.png" });

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
    const { container } = montar();
    expect(within(container).queryByRole("textbox")).not.toBeInTheDocument();
  });
});

/**
 * ============================================================================
 * ⚠️ A DESCRIÇÃO SAIU, E O BLOCO QUE A TESTAVA VIROU O CONTRÁRIO.
 * ============================================================================
 * Havia aqui dois casos sobre o parágrafo de descrição abaixo da arte. O
 * cliente pediu a página sem texto solto: o campo saiu do Builder, do schema e
 * da leitura pública, e a prévia deixou de desenhá-lo.
 *
 * O que fica no lugar é uma asserção sobre a AUSÊNCIA. A prévia só presta se
 * mostra o que vai ao ar, e um parágrafo que voltasse a aparecer aqui faria o
 * administrador aprovar uma composição que a granja nunca vê.
 */
describe("a página pública não tem mais texto solto (§10)", () => {
  /**
   * ⚠️ A ASSERÇÃO É ESTRUTURAL, e não sobre texto. Procurar "não contém tal
   * frase" só pegaria a descrição de exemplo que este teste escrevesse — e a
   * pergunta é outra: existe ALGUMA coisa entre a arte e o formulário? O corpo
   * da página é um `space-y-*` com exatamente dois filhos, e um parágrafo que
   * voltasse a aparecer viraria um terceiro.
   */
  it("entre a arte e o formulário não há mais nada", () => {
    montar({}, { imageUrl: "https://exemplo.invalid/banner.png" });
    const formulario = painel("Ver formulário");

    const imagem = within(formulario).getByAltText(`Imagem de ${EVENTO.name}`);
    const corpo = imagem.parentElement;

    expect(corpo?.children).toHaveLength(2);
    expect(corpo?.children[0]).toBe(imagem);
    expect(corpo?.children[1]?.textContent).toContain("Granja / Empresa");
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

  /**
   * ⚠️ UM CONTROLE, E ELE VALE PARA AS DUAS COLUNAS. Larguras diferentes nos
   * dois painéis fariam a comparação entre as duas artes mentir sobre qual
   * delas fica melhor — que é a única coisa que esta prévia serve para
   * responder agora que a página é feita de imagens.
   */
  it("trocar para celular estreita AS DUAS prévias", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole("button", { name: "Celular" }));

    expect(screen.getByRole("button", { name: "Celular" })).toHaveAttribute("aria-pressed", "true");
    // A largura fixa é o que faz a composição ser conferível; sem ela, o botão
    // seria decorativo.
    expect(document.querySelectorAll(".w-\\[22rem\\]")).toHaveLength(2);
  });
});

/**
 * ============================================================================
 * ⚠️ A CONFIRMAÇÃO: OU O BANNER, OU O TEXTO PADRÃO — NUNCA OS DOIS.
 * ============================================================================
 * Havia aqui quatro casos sobre os textos que a Landing Page sobrescrevia
 * (título, mensagem, rodapé) e sobre as variáveis dentro deles. Três deles
 * testavam campos que não existem mais.
 *
 * O que sobreviveu é a substituição de variável — que continua acontecendo,
 * agora sobre o texto PADRÃO da plataforma — e o que entrou é a regra nova: com
 * banner, o texto sai da tela. A página pública faz exatamente isso (esconde
 * em `sr-only`), e uma prévia que mostrasse arte E texto faria o administrador
 * aprovar uma composição duplicada que ninguém vê.
 */
describe("a confirmação (§17, §18)", () => {
  it("sem banner, usa o padrão da plataforma e substitui a variável", () => {
    montar();
    const confirmacao = painel("Ver confirmação");

    expect(
      within(confirmacao).getByRole("heading", { name: "INSCRIÇÃO CONFIRMADA!" }),
    ).toBeInTheDocument();
    expect(
      within(confirmacao).getByText(
        `Seu cadastro para o ${EVENTO.name} foi realizado com sucesso.`,
      ),
    ).toBeInTheDocument();
    expect(within(confirmacao).getByText(PADROES.footer)).toBeInTheDocument();
  });

  it("com banner, o texto sai da tela e sobra a arte", () => {
    montar({}, { successImageUrl: "https://exemplo.invalid/confirmacao.png" });
    const confirmacao = painel("Ver confirmação");

    expect(within(confirmacao).getByAltText(`Confirmação de ${EVENTO.name}`)).toBeInTheDocument();
    expect(
      within(confirmacao).queryByRole("heading", { name: "INSCRIÇÃO CONFIRMADA!" }),
    ).not.toBeInTheDocument();
    expect(within(confirmacao).queryByText(PADROES.footer)).not.toBeInTheDocument();
  });

  /**
   * ⚠️ A DATA E O HORÁRIO FICAM NOS DOIS CASOS, e é a correção da homologação
   * (§16) resistindo a um jeito NOVO de perdê-la. Antes o risco era o
   * administrador esquecer de escrever `{{event_date}}`; agora é ele mandar uma
   * arte sem a data, ou com a data de antes de o evento ser remarcado. As duas
   * linhas vêm do EVENTO, não da imagem.
   */
  it("a data e o horário aparecem com banner e sem banner", () => {
    const { unmount } = montar();
    expect(within(painel("Ver confirmação")).getByText("18/09/2026")).toBeInTheDocument();
    unmount();

    montar({}, { successImageUrl: "https://exemplo.invalid/confirmacao.png" });
    const comArte = painel("Ver confirmação");
    expect(within(comArte).getByText("18/09/2026")).toBeInTheDocument();
    expect(within(comArte).getByText("08:00 às 13:00")).toBeInTheDocument();
  });

  /**
   * ⚠️ AS VARIÁVEIS DO §18 CONTINUAM VALENDO — sobre o texto da plataforma,
   * editável em Configurações → Textos. A Landing Page não sobrescreve mais
   * nada, mas a substituição não sumiu junto: quem escreve o texto padrão
   * precisa poder mover o nome do evento de lugar na frase.
   */
  it("substitui as quatro variáveis do §18", () => {
    render(
      <LandingPreview
        state={estado()}
        event={EVENTO}
        imageUrl={null}
        successImageUrl={null}
        successDefaults={{
          ...PADROES,
          message: "{{event_name}} · {{event_date}} · {{event_start_time}}–{{event_end_time}}",
        }}
      />,
    );

    expect(screen.getByText(`${EVENTO.name} · 18/09/2026 · 08:00–13:00`)).toBeInTheDocument();
  });

  /**
   * ⚠️ VARIÁVEL DESCONHECIDA FICA LITERAL, e isso é o §18 ("Não permitir
   * variáveis arbitrárias") com a escolha certa de comportamento. Um marcador
   * que sumisse deixaria a frase truncada e ninguém descobriria por quê; um
   * marcador que aparece cru é visível no segundo em que se digita.
   */
  it("variável que não existe fica visível em vez de sumir", () => {
    render(
      <LandingPreview
        state={estado()}
        event={EVENTO}
        imageUrl={null}
        successImageUrl={null}
        successDefaults={{ ...PADROES, message: "Olá {{nome_do_participante}}" }}
      />,
    );

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
    //
    // ⚠️ `getAllBy`, E NÃO `getBy`: são DOIS painéis, cada um com o cabeçalho e
    // o rodapé institucionais completos — porque é isso que a página pública
    // mostra nas duas telas.
    expect(screen.getAllByAltText(/APCS/)).toHaveLength(2);
    expect(screen.getAllByAltText("CSP")).toHaveLength(2);
    expect(screen.getAllByText("© APCS | CSP 2026 - Todos os direitos reservados")).toHaveLength(2);

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
