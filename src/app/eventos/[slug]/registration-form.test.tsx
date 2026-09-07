import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegistrationForm } from "./registration-form";
import { MAX_PHONE_DIGITS, onlyDigits } from "@/lib/format/phone";
import type { PublicRegistrationFormData } from "@/modules/event/event.landing.types";

/**
 * O FORMULÁRIO PÚBLICO DE INSCRIÇÃO (§9 a §31, §41, §42).
 *
 * ⚠️ A ACTION É MOCKADA porque ela é `"use server"` — importá-la de verdade
 * abriria o Supabase. O que estes testes provam é o que a TELA faz: quais
 * campos existem, o que ela recusa antes de enviar, o que ela envia, e em qual
 * dos seis estados ela para.
 *
 * ⚠️ E ELES PROVAM UMA COISA QUE NÃO É ÓBVIA: a tela não decide nada de
 * negócio. Ela recusa para dar mensagem, e o que vale é o retorno da action —
 * tanto que os casos de "vagas esgotadas" e "encerrada" abaixo chegam pelo
 * ERRO DO SERVIDOR, e não por uma conta feita aqui.
 */

const submitEventRegistrationAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/event-registration-public", () => ({ submitEventRegistrationAction }));

function pagina(overrides: Partial<PublicRegistrationFormData> = {}): PublicRegistrationFormData {
  return {
    slug: "encontro-tecnico",
    formFields: ["GRANJA_EMPRESA", "EMAIL", "NOME_PARTICIPANTE", "TELEFONE", "WHATSAPP"],
    successImageUrl: null,
    event: {
      name: "Encontro Técnico",
      eventDate: "2026-09-18",
      startTime: "08:00:00",
      endTime: "13:00:00",
      location: "Toledo — PR",
    },
    successDefaults: {
      title: "INSCRIÇÃO CONFIRMADA!",
      message: "Seu cadastro para o {{event_name}} foi realizado com sucesso.",
      footer: "Esperamos você! Nos vemos no evento.",
    },
    consent: { version: "2026-08-v1", body: "Autorizo a APCS a tratar meus dados." },
    ...overrides,
  };
}

function montar(overrides: Partial<PublicRegistrationFormData> = {}) {
  return render(<RegistrationForm page={pagina(overrides)} initialState="ready" />);
}

/** Preenche uma inscrição válida de um participante. */
async function preencher(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/granja \/ empresa/i), "Granja ABC");
  await user.type(screen.getByLabelText(/^e-mail/i), "joao@email.com");
  await user.type(screen.getByLabelText(/nome do participante/i), "João da Silva");
  await user.type(screen.getByLabelText(/telefone/i), "11999998888");
  await user.click(screen.getByRole("checkbox"));
}

beforeEach(() => {
  submitEventRegistrationAction.mockReset();
  submitEventRegistrationAction.mockResolvedValue({
    ok: true,
    data: { participantCount: 1, duplicate: false },
  });
});

describe("§9 e §10 — a forma do formulário", () => {
  /**
   * ⚠️ A GRANJA APARECE UMA VEZ, E O RESTO SE REPETE. É o modelo de dados na
   * tela: a inscrição é da granja, e as pessoas pertencem a ela. Um formulário
   * que repetisse "Granja / Empresa" por participante ensinaria o contrário.
   */
  it("granja uma vez, campos de pessoa por participante", async () => {
    const user = userEvent.setup();
    montar();

    expect(screen.getAllByLabelText(/granja \/ empresa/i)).toHaveLength(1);
    expect(screen.getAllByLabelText(/^e-mail/i)).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /adicionar participante/i }));

    expect(screen.getAllByLabelText(/granja \/ empresa/i)).toHaveLength(1);
    expect(screen.getAllByLabelText(/^e-mail/i)).toHaveLength(2);
  });

  /**
   * ⚠️ A ORDEM É A DO BUILDER (§12 do Prompt 2 chegando aqui). Nada nesta tela
   * decide onde cada campo fica — o que a pessoa arrastou no backoffice é o que
   * a granja vê.
   */
  it("respeita a ordem e a ausência de campos configuradas", () => {
    montar({ formFields: ["GRANJA_EMPRESA", "NOME_PARTICIPANTE", "EMAIL", "WHATSAPP"] });

    // Telefone saiu da configuração: não existe na tela.
    expect(screen.queryByLabelText(/telefone/i)).toBeNull();

    const bloco = screen.getByRole("group", { name: /participante 1/i });
    const rotulos = within(bloco)
      .getAllByText(/nome do participante|e-mail|whatsapp/i)
      .map((no) => no.textContent?.toLowerCase() ?? "");
    // "Nome do Participante" antes de "E-mail" — o inverso do padrão do §7,
    // que é justamente o ponto: quem manda é a configuração.
    expect(rotulos[0]).toContain("nome do participante");
  });
});

describe("§11 e §14 — adicionar e remover participantes", () => {
  it("adiciona vários", async () => {
    const user = userEvent.setup();
    montar();

    const botao = screen.getByRole("button", { name: /adicionar participante/i });
    await user.click(botao);
    await user.click(botao);

    expect(screen.getByRole("group", { name: /participante 3/i })).toBeTruthy();
  });

  /** §14 — o primeiro não some enquanto for o único. */
  it("não oferece remover quando há um só", () => {
    montar();
    expect(screen.queryByRole("button", { name: /remover participante/i })).toBeNull();
  });

  /**
   * ⚠️ O CASO QUE O §14 DESCREVE: "caso o usuário remova o participante 2, os
   * demais devem continuar funcionando corretamente". Este teste digita nomes
   * distintos ANTES de remover — sem isso, um bug de `key` por índice passaria
   * despercebido, porque três campos vazios são indistinguíveis depois de
   * qualquer reordenação.
   */
  it("remover o do meio preserva o conteúdo dos outros", async () => {
    const user = userEvent.setup();
    montar();

    const adicionar = screen.getByRole("button", { name: /adicionar participante/i });
    await user.click(adicionar);
    await user.click(adicionar);

    const nomes = screen.getAllByLabelText(/nome do participante/i);
    await user.type(nomes[0]!, "Primeiro");
    await user.type(nomes[1]!, "Segundo");
    await user.type(nomes[2]!, "Terceiro");

    await user.click(screen.getByRole("button", { name: /remover participante 2/i }));

    const restantes = screen.getAllByLabelText(/nome do participante/i) as HTMLInputElement[];
    expect(restantes).toHaveLength(2);
    expect(restantes[0]!.value).toBe("Primeiro");
    expect(restantes[1]!.value).toBe("Terceiro");
  });

  /**
   * §31 — o rótulo NOMEIA quem sai. "Remover" repetido em cinco blocos faz um
   * leitor de tela anunciar cinco botões idênticos.
   */
  it("cada botão de remover diz de quem é", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: /adicionar participante/i }));

    expect(screen.getByRole("button", { name: "Remover participante 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remover participante 2" })).toBeTruthy();
  });
});

describe("§15 e §19 — o que a tela recusa antes de enviar", () => {
  it("sem granja, sem nome ou sem e-mail não envia", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(submitEventRegistrationAction).not.toHaveBeenCalled();
    expect(screen.getByText(/informe a granja ou empresa/i)).toBeTruthy();
  });

  it("participante sem telefone e sem WhatsApp não envia", async () => {
    const user = userEvent.setup();
    montar();

    await user.type(screen.getByLabelText(/granja \/ empresa/i), "Granja ABC");
    await user.type(screen.getByLabelText(/^e-mail/i), "joao@email.com");
    await user.type(screen.getByLabelText(/nome do participante/i), "João da Silva");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(submitEventRegistrationAction).not.toHaveBeenCalled();
    expect(screen.getByText(/informe telefone ou whatsapp\./i)).toBeTruthy();
  });

  /** §35 — sem o aceite, não sai. */
  it("sem aceitar o consentimento não envia", async () => {
    const user = userEvent.setup();
    montar();

    await user.type(screen.getByLabelText(/granja \/ empresa/i), "Granja ABC");
    await user.type(screen.getByLabelText(/^e-mail/i), "joao@email.com");
    await user.type(screen.getByLabelText(/nome do participante/i), "João da Silva");
    await user.type(screen.getByLabelText(/telefone/i), "11999998888");
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(submitEventRegistrationAction).not.toHaveBeenCalled();
    expect(screen.getByText(/aceitar o tratamento dos dados/i)).toBeTruthy();
  });
});

describe("§16 e §17 — e-mail e telefone", () => {
  /**
   * ==========================================================================
   * ⚠️ §16 — "não alterar o valor original exibido sem necessidade".
   * ==========================================================================
   * A comparação de duplicidade é insensível a caixa, e quem cuida disso é o
   * `toLowerCase()` do schema e o `lower()` do Postgres. Baixar a caixa no
   * `onChange` mudaria O QUE A PESSOA ESTÁ VENDO por uma necessidade que é do
   * banco — e num campo de e-mail isso é desconcertante enquanto se digita.
   */
  it("o e-mail digitado continua na tela como foi digitado", async () => {
    const user = userEvent.setup();
    montar();

    const campo = screen.getByLabelText(/^e-mail/i) as HTMLInputElement;
    await user.type(campo, "Joao@Email.com");

    expect(campo.value).toBe("Joao@Email.com");
  });

  /** ...mas o que VAI para o servidor é normalizado. */
  it("o e-mail enviado vai em minúsculas", async () => {
    const user = userEvent.setup();
    montar();

    await user.type(screen.getByLabelText(/granja \/ empresa/i), "Granja ABC");
    await user.type(screen.getByLabelText(/^e-mail/i), "Joao@Email.com");
    await user.type(screen.getByLabelText(/nome do participante/i), "João da Silva");
    await user.type(screen.getByLabelText(/telefone/i), "11999998888");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    const enviado = submitEventRegistrationAction.mock.calls[0]?.[0];
    expect(enviado.participants[0].email).toBe("joao@email.com");
  });

  it("o telefone é mascarado enquanto se digita", async () => {
    const user = userEvent.setup();
    montar();

    const campo = screen.getByLabelText(/telefone/i) as HTMLInputElement;
    await user.type(campo, "11999998888");

    expect(campo.value).toBe("(11) 99999-8888");
  });

  it("o WhatsApp é mascarado do mesmo jeito", async () => {
    const user = userEvent.setup();
    montar();

    const campo = screen.getByLabelText(/whatsapp/i) as HTMLInputElement;
    await user.type(campo, "45999990000");

    expect(campo.value).toBe("(45) 99999-0000");
  });

  /**
   * ==========================================================================
   * ⚠️ O CAMPO PARA DE ACEITAR ANTES DE O SERVIDOR RECLAMAR.
   * ==========================================================================
   * A máscara já existia; o teto não. Digitar quarenta algarismos era possível,
   * e o erro só chegava no ENVIO — depois de a granja ter preenchido a inscrição
   * inteira. É a mesma escolha do campo de capacidade do Builder: deixar digitar
   * para recusar depois é pior do que não deixar digitar.
   *
   * O corte é em DÍGITOS, e não um `maxLength` no `<input>`: a máscara
   * brasileira completa tem exatamente 15 caracteres, e um `maxLength={15}`
   * bloquearia o 12º dígito — que é onde um número estrangeiro começa. Ver o
   * cabeçalho de `formatPhoneInput`.
   */
  it("nem telefone nem WhatsApp aceitam mais de 15 dígitos", async () => {
    const user = userEvent.setup();
    montar();

    const telefone = screen.getByLabelText(/telefone/i) as HTMLInputElement;
    const whatsapp = screen.getByLabelText(/whatsapp/i) as HTMLInputElement;

    await user.type(telefone, "1".repeat(40));
    await user.type(whatsapp, "9".repeat(40));

    expect(onlyDigits(telefone.value)).toHaveLength(MAX_PHONE_DIGITS);
    expect(onlyDigits(whatsapp.value)).toHaveLength(MAX_PHONE_DIGITS);
  });

  /**
   * ⚠️ E O NÚMERO ESTRANGEIRO CONTINUA CABENDO. É a metade do §17 que o teto
   * poderia ter matado: doze dígitos é um telefone português com o código do
   * país, e ele precisa atravessar a fronteira dos onze onde a máscara some.
   */
  it("mas um número internacional de 12 dígitos passa inteiro", async () => {
    const user = userEvent.setup();
    montar();

    const campo = screen.getByLabelText(/telefone/i) as HTMLInputElement;
    await user.type(campo, "351912345678");

    expect(campo.value).toBe("351912345678");
  });
});

describe("§21 — o que sai da tela", () => {
  /**
   * ⚠️ O SLUG, E NÃO O `landingPageId`. O navegador não recebe o id da página —
   * ele manda o endereço que está na barra, e o servidor deriva o resto. Um
   * `landingPageId` aparecendo aqui seria o sinal de que a proteção foi
   * desfeita.
   */
  it("manda o slug e a versão do consentimento, e nenhum identificador", async () => {
    const user = userEvent.setup();
    montar();
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    const enviado = submitEventRegistrationAction.mock.calls[0]?.[0];
    expect(enviado.slug).toBe("encontro-tecnico");
    expect(enviado.consentVersion).toBe("2026-08-v1");
    expect(enviado).not.toHaveProperty("landingPageId");
    expect(enviado).not.toHaveProperty("eventId");
  });
});

describe("§23 e §26 — envio duplo", () => {
  /**
   * ==========================================================================
   * ⚠️ DOIS CLIQUES RÁPIDOS, UM ENVIO SÓ.
   * ==========================================================================
   * `setState` é assíncrono: os dois cliques passam pelo `if` antes do primeiro
   * `render`, e um guarda baseado em estado não pega nenhum dos dois. O `ref` é
   * o que muda na hora. Este teste segura a promessa da action aberta para
   * reproduzir exatamente a janela em que isso acontece.
   */
  it("o segundo clique não cria uma segunda inscrição", async () => {
    const user = userEvent.setup();
    let liberar: (v: unknown) => void = () => {};
    submitEventRegistrationAction.mockImplementation(
      () => new Promise((resolve) => (liberar = resolve)),
    );

    montar();
    await preencher(user);

    const botao = screen.getByRole("button", { name: /confirmar inscrição/i });
    await user.click(botao);
    await user.click(botao);

    expect(submitEventRegistrationAction).toHaveBeenCalledTimes(1);

    liberar({ ok: true, data: { participantCount: 1, duplicate: false } });
  });

  it("o botão avisa que está enviando", async () => {
    const user = userEvent.setup();
    submitEventRegistrationAction.mockImplementation(() => new Promise(() => {}));

    montar();
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(screen.getByRole("button", { name: /enviando/i })).toBeTruthy();
  });
});

describe("§24, §25 e §26 — a confirmação", () => {
  /**
   * ⚠️ ELA SUBSTITUI O FORMULÁRIO, e não aparece ao lado dele. É o §26 escrito
   * como estrutura: não há botão para clicar de novo porque não há mais
   * formulário na página.
   */
  it("o formulário some depois do sucesso", async () => {
    const user = userEvent.setup();
    montar();
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(screen.queryByRole("button", { name: /confirmar inscrição/i })).toBeNull();
    expect(screen.queryByLabelText(/granja \/ empresa/i)).toBeNull();
  });

  /**
   * §25 — a mensagem é a CONFIGURADA, com as variáveis resolvidas. `{{event_name}}`
   * cru na tela seria o sintoma de a substituição ter sido perdida.
   */
  it("mostra a mensagem do Builder com as variáveis substituídas", async () => {
    const user = userEvent.setup();
    montar();
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(screen.getByText(/inscrição confirmada/i)).toBeTruthy();
    expect(screen.getByText(/seu cadastro para o encontro técnico/i)).toBeTruthy();
    expect(screen.queryByText(/\{\{event_name\}\}/)).toBeNull();
  });

  /**
   * ==========================================================================
   * ⚠️ COM BANNER, O TEXTO SAI DA TELA — MAS NÃO DA PÁGINA.
   * ==========================================================================
   * Aqui havia um caso sobre o texto PRÓPRIO da página vencer o padrão. Os três
   * campos que faziam isso não existem mais: a confirmação virou uma arte.
   *
   * O que entrou no lugar é a regra que substituiu aquela, e ela tem duas
   * metades que precisam ser testadas juntas — a arte aparece, E o texto
   * continua no HTML para quem não a vê. Testar só a primeira deixaria passar
   * uma confirmação muda para quem usa leitor de tela.
   */
  it("com banner, mostra a arte e esconde o texto da tela", async () => {
    const user = userEvent.setup();
    montar({ successImageUrl: "https://exemplo.invalid/confirmacao.png" });
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(screen.getByAltText(/confirmação de inscrição no encontro técnico/i)).toBeTruthy();

    // O título continua no documento — e fora da vista, dentro de um `sr-only`.
    const titulo = screen.getByRole("heading", { name: /inscrição confirmada/i });
    expect(titulo.closest(".sr-only")).not.toBeNull();
  });

  /**
   * ==========================================================================
   * ⚠️ ESTE CASO AFIRMAVA O CONTRÁRIO, E A INVERSÃO É UMA DECISÃO DO CLIENTE.
   * ==========================================================================
   * A data e o horário ficavam VISÍVEIS abaixo da arte — era a correção de
   * homologação do §16, que existia porque a data só aparecia quando alguém
   * lembrava de escrever `{{event_date}}` na mensagem.
   *
   * O pedido seguinte foi "apresentar ao usuário final APENAS o banner de
   * confirmação". A informação passa a depender da arte, e uma arte enviada
   * antes de o evento ser remarcado vai continuar anunciando a data velha sem
   * que nada perceba. O teste inverte em vez de sumir porque é isso que
   * registra a escolha: se a data voltar a aparecer, foi alguém desfazendo o
   * pedido sem saber.
   */
  it("com banner, NADA além da arte é desenhado", async () => {
    const user = userEvent.setup();
    montar({ successImageUrl: "https://exemplo.invalid/confirmacao.png" });
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    for (const texto of ["18/09/2026", "08:00 às 13:00", "Esperamos você! Nos vemos no evento."]) {
      expect(screen.getByText(texto).closest(".sr-only")).not.toBeNull();
    }
  });

  /**
   * ⚠️ MAS TUDO CONTINUA NO HTML. Sumir da TELA é composição; sumir da PÁGINA
   * deixaria quem usa leitor de tela sem confirmação nenhuma — de uma imagem
   * ele recebe só o `alt`, e o `alt` de um banner não comporta a frase inteira.
   */
  it("e tudo continua legível para quem não vê a imagem", async () => {
    const user = userEvent.setup();
    montar({ successImageUrl: "https://exemplo.invalid/confirmacao.png" });
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(screen.getByText("18/09/2026")).toBeTruthy();
    expect(screen.getByText("08:00 às 13:00")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /inscrição confirmada/i })).toBeTruthy();
  });

  /** Sem banner, o texto é a confirmação — e nada dele fica escondido. */
  it("sem banner, a data e o horário aparecem na tela", async () => {
    const user = userEvent.setup();
    montar();
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(screen.getByText("18/09/2026").closest(".sr-only")).toBeNull();
    expect(screen.getByText("08:00 às 13:00").closest(".sr-only")).toBeNull();
  });

  /**
   * ⚠️ `duplicate` NÃO VIRA MENSAGEM. Quem clicou duas vezes fez UMA inscrição
   * e vê UMA confirmação; contar o detalhe técnico criaria dúvida sobre um
   * envio que deu certo.
   */
  it("uma inscrição deduplicada mostra a mesma confirmação", async () => {
    const user = userEvent.setup();
    submitEventRegistrationAction.mockResolvedValue({
      ok: true,
      data: { participantCount: 1, duplicate: true },
    });

    montar();
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(screen.getByText(/inscrição confirmada/i)).toBeTruthy();
    expect(screen.queryByText(/duplicad/i)).toBeNull();
  });
});

describe("§27, §28 e §41 — os estados que fecham o formulário", () => {
  /** O servidor já sabia: a página carregou encerrada. */
  it.each([
    ["closed", /inscrições encerradas/i],
    ["soldOut", /vagas esgotadas/i],
  ] as const)("estado inicial %s mostra o aviso e nenhum campo", (estado, texto) => {
    render(<RegistrationForm page={pagina()} initialState={estado} />);

    expect(screen.getByText(texto)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /confirmar inscrição/i })).toBeNull();
  });

  /**
   * ==========================================================================
   * ⚠️ O CASO DA CORRIDA DO §22, VISTO DA TELA.
   * ==========================================================================
   * Entre o instante em que esta página carregou e o instante do envio, outra
   * granja levou as últimas vagas. O banco recusa com RG002, e a tela TROCA DE
   * ESTADO — não basta mostrar o erro e devolver o formulário, porque isso
   * convidaria a pessoa a tentar de novo um envio que vai ser recusado de novo.
   */
  it("lotar durante o preenchimento troca a tela por vagas esgotadas", async () => {
    const user = userEvent.setup();
    submitEventRegistrationAction.mockResolvedValue({
      ok: false,
      error: { code: "registrationsFull" },
    });

    montar();
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(screen.getByText(/vagas esgotadas/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /confirmar inscrição/i })).toBeNull();
  });

  it("o prazo vencer durante o preenchimento troca a tela por encerradas", async () => {
    const user = userEvent.setup();
    submitEventRegistrationAction.mockResolvedValue({
      ok: false,
      error: { code: "registrationsClosed" },
    });

    montar();
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(screen.getByText(/inscrições encerradas/i)).toBeTruthy();
  });
});

describe("§30 — os erros que não fecham o formulário", () => {
  /**
   * ⚠️ AQUI O FORMULÁRIO CONTINUA, com os dados preenchidos. É a diferença entre
   * "não dá mais" e "corrija e tente de novo" — e é o que impede alguém de
   * redigitar cinco participantes por causa de um e-mail repetido.
   */
  it("e-mail já inscrito mantém o formulário e o que foi digitado", async () => {
    const user = userEvent.setup();
    submitEventRegistrationAction.mockResolvedValue({
      ok: false,
      error: { code: "participantAlreadyRegistered" },
    });

    montar();
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(screen.getByRole("alert").textContent).toMatch(/já está inscrito/i);
    expect((screen.getByLabelText(/granja \/ empresa/i) as HTMLInputElement).value).toBe(
      "Granja ABC",
    );
  });

  it("limite de envios mostra a mensagem amigável", async () => {
    const user = userEvent.setup();
    submitEventRegistrationAction.mockResolvedValue({
      ok: false,
      error: { code: "registrationRateLimited" },
    });

    montar();
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(screen.getByRole("alert").textContent).toMatch(/aguarde um pouco/i);
  });

  /**
   * ⚠️ NENHUM ERRO EXPÕE O SISTEMA (§30). Este teste procura na tela inteira as
   * pegadas de um erro técnico vazado — código do Postgres, nome de função,
   * "supabase". Ele falha no dia em que alguém decidir mostrar
   * `error.message` "para ajudar a depurar".
   */
  it("um erro inesperado não vaza nada de técnico", async () => {
    const user = userEvent.setup();
    submitEventRegistrationAction.mockResolvedValue({
      ok: false,
      error: { code: "unexpected" },
    });

    montar();
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    const tela = document.body.textContent ?? "";
    for (const tecnico of [
      "RG0",
      "LP0",
      "supabase",
      "postgres",
      "create_event_registration",
      "23505",
    ]) {
      expect(tela.toLowerCase()).not.toContain(tecnico.toLowerCase());
    }
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  /** Rede caiu: a promessa rejeita, e os dados continuam ali. */
  it("falha de rede não apaga o que foi preenchido", async () => {
    const user = userEvent.setup();
    submitEventRegistrationAction.mockRejectedValue(new Error("network"));

    montar();
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(screen.getByRole("alert").textContent).toMatch(/verifique sua conexão/i);
    expect((screen.getByLabelText(/^e-mail/i) as HTMLInputElement).value).toBe("joao@email.com");
  });
});

/**
 * ============================================================================
 * ⚠️ A CONFIRMAÇÃO SUBSTITUI A PÁGINA, E NÃO SÓ O FORMULÁRIO.
 * ============================================================================
 * Defeito visto em produção: depois de se inscrever, a pessoa continuava vendo
 * o cartaz do evento e "Inscrições até 18/09/2026" ACIMA da confirmação — dois
 * banners empilhados e um prazo que já não dizia nada a ela.
 *
 * A causa era estrutural, e é por isso que nenhum teste tinha pegado: a arte
 * morava na PÁGINA (Server Component), que não sabe que alguém se inscreveu; a
 * troca acontecia só dentro deste componente. Cada metade estava certa
 * sozinha.
 *
 * A arte passou a descer como nó pronto na prop `arte`, e estes casos são o que
 * amarra as duas metades. Sem eles, a página pode voltar a desenhar a arte por
 * fora e ninguém percebe até alguém se inscrever de novo.
 */
describe("o que some quando a inscrição é confirmada", () => {
  const ARTE = <p>CARTAZ E PRAZO DO EVENTO</p>;

  function montarComArte(overrides: Partial<PublicRegistrationFormData> = {}) {
    return render(<RegistrationForm page={pagina(overrides)} initialState="ready" arte={ARTE} />);
  }

  it("a arte aparece enquanto há formulário", () => {
    montarComArte();
    expect(screen.getByText("CARTAZ E PRAZO DO EVENTO")).toBeInTheDocument();
  });

  it("e desaparece na confirmação", async () => {
    const user = userEvent.setup();
    montarComArte({ successImageUrl: "https://exemplo.invalid/confirmacao.png" });
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(screen.queryByText("CARTAZ E PRAZO DO EVENTO")).not.toBeInTheDocument();
    expect(screen.getByAltText(/confirmação de inscrição no encontro técnico/i)).toBeTruthy();
  });

  it("some também quando a confirmação é só texto", async () => {
    const user = userEvent.setup();
    montarComArte();
    await preencher(user);
    await user.click(screen.getByRole("button", { name: /confirmar inscrição/i }));

    expect(screen.queryByText("CARTAZ E PRAZO DO EVENTO")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /inscrição confirmada/i })).toBeTruthy();
  });

  /**
   * ⚠️ ENCERRADA E ESGOTADA MANTÊM A ARTE, e não é inconsistência: quem chega
   * numa página encerrada continua querendo saber que evento é aquele. Quem
   * acabou de se inscrever já sabe.
   */
  it.each([
    ["closed", /inscrições encerradas/i],
    ["soldOut", /vagas esgotadas/i],
  ] as const)("mas continua na tela quando o estado inicial é %s", (estado, texto) => {
    render(<RegistrationForm page={pagina()} initialState={estado} arte={ARTE} />);

    expect(screen.getByText("CARTAZ E PRAZO DO EVENTO")).toBeInTheDocument();
    expect(screen.getByText(texto)).toBeTruthy();
  });
});
