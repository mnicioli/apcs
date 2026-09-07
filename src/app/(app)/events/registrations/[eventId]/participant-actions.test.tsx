import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParticipantActions } from "./participant-actions";
import { MAX_PHONE_DIGITS, onlyDigits } from "@/lib/format/phone";
import type { RegistrationBoardRow } from "@/modules/event/event.landing.types";

/**
 * VER E EDITAR (§13, §14, §15, §16, §17).
 *
 * ⚠️ O QUE ESTES TESTES PROVAM É QUE A TELA NÃO DECIDE NADA DE NEGÓCIO. Ela
 * recusa para dar mensagem no campo certo; quem garante é o banco — a
 * duplicidade de e-mail (§14) só pode ser respondida lá, e chega aqui como
 * código de erro.
 */

const updateParticipantAction = vi.hoisted(() => vi.fn());
const updateCompanyAction = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/event-landing", () => ({ updateParticipantAction, updateCompanyAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const EVENTO = "11111111-1111-4111-8111-111111111111";

function linha(over: Partial<RegistrationBoardRow> = {}): RegistrationBoardRow {
  return {
    participantId: "44444444-4444-4444-8444-444444444444",
    registrationId: "33333333-3333-4333-8333-333333333333",
    companyName: "Granja ABC",
    fullName: "João da Silva",
    email: "joao@email.com",
    phone: "11999998888",
    whatsapp: null,
    confirmation: "confirmed",
    registeredAt: "2026-09-06T13:30:00Z",
    registrationStatus: "active",
    origin: "landing_page",
    ...over,
  };
}

function montar(over: Partial<RegistrationBoardRow> = {}, canWrite = true) {
  return render(<ParticipantActions eventId={EVENTO} row={linha(over)} canWrite={canWrite} />);
}

async function abrirEdicao(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /editar/i }));
}

beforeEach(() => {
  updateParticipantAction.mockReset();
  updateCompanyAction.mockReset();
  updateParticipantAction.mockResolvedValue({ ok: true, data: { id: "p1" } });
  updateCompanyAction.mockResolvedValue({ ok: true, data: { id: "r1" } });
  refresh.mockReset();
});

describe("§16 — não existe exclusão", () => {
  /**
   * ==========================================================================
   * ⚠️ O TESTE MAIS SIMPLES DESTE ARQUIVO, E O QUE MAIS IMPORTA.
   * ==========================================================================
   * "Não criar exclusão física. Não criar botão Excluir participante nem
   * Excluir inscrição." Um botão desses acrescentado por engano — copiado de
   * outra tela do CRM, por exemplo — passa despercebido numa revisão visual e
   * apaga dado que a plataforma inteira foi desenhada para preservar.
   */
  it("não há botão de excluir em lugar nenhum", async () => {
    const user = userEvent.setup();
    montar();

    expect(screen.queryByRole("button", { name: /excluir|remover|apagar/i })).toBeNull();

    await abrirEdicao(user);
    expect(screen.queryByRole("button", { name: /excluir|remover|apagar/i })).toBeNull();
  });
});

describe("§17 — a visualização", () => {
  it("mostra a granja, a pessoa e os contatos", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole("button", { name: /ver/i }));

    expect(screen.getAllByText("Granja ABC").length).toBeGreaterThan(0);
    expect(screen.getAllByText("João da Silva").length).toBeGreaterThan(0);
    expect(screen.getAllByText("joao@email.com").length).toBeGreaterThan(0);
  });

  /** De onde veio a inscrição — a página pública ou o cadastro manual. */
  it("mostra a origem da inscrição", async () => {
    const user = userEvent.setup();
    montar({ origin: "backoffice" });

    await user.click(screen.getByRole("button", { name: /ver/i }));
    expect(screen.getByText("Cadastro manual")).toBeTruthy();
  });
});

describe("§24 — quem não pode escrever não vê o botão de editar", () => {
  it("sem registrations.write, só resta ver", () => {
    montar({}, false);

    expect(screen.getByRole("button", { name: /ver/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /editar/i })).toBeNull();
  });
});

describe("§13 — a edição", () => {
  it("abre com os valores atuais", async () => {
    const user = userEvent.setup();
    montar();
    await abrirEdicao(user);

    expect((screen.getByLabelText(/granja \/ empresa/i) as HTMLInputElement).value).toBe(
      "Granja ABC",
    );
    expect((screen.getByLabelText(/nome do participante/i) as HTMLInputElement).value).toBe(
      "João da Silva",
    );
    // O telefone chega do banco em dígitos e aparece mascarado na tela.
    expect((screen.getByLabelText(/telefone/i) as HTMLInputElement).value).toBe("(11) 99999-8888");
  });

  it("salva nome, e-mail, telefones e confirmação", async () => {
    const user = userEvent.setup();
    montar();
    await abrirEdicao(user);

    const nome = screen.getByLabelText(/nome do participante/i);
    await user.clear(nome);
    await user.type(nome, "João Pedro da Silva");

    await user.click(screen.getByRole("button", { name: /^salvar$/i }));

    expect(updateParticipantAction).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: EVENTO,
        fullName: "João Pedro da Silva",
        email: "joao@email.com",
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  /**
   * ==========================================================================
   * ⚠️ A GRANJA SÓ É ENVIADA SE MUDOU.
   * ==========================================================================
   * Ela é da INSCRIÇÃO, e a escrita dela é auditada. Mandá-la a cada salvamento
   * gravaria uma linha de trilha "companyName: Granja ABC → Granja ABC" toda vez
   * que alguém corrigisse um telefone — e a trilha, que existe para responder
   * "o que mudou aqui?", viraria ruído.
   */
  it("não regrava a granja quando ela não mudou", async () => {
    const user = userEvent.setup();
    montar();
    await abrirEdicao(user);
    await user.click(screen.getByRole("button", { name: /^salvar$/i }));

    expect(updateCompanyAction).not.toHaveBeenCalled();
    expect(updateParticipantAction).toHaveBeenCalled();
  });

  it("regrava a granja quando ela muda", async () => {
    const user = userEvent.setup();
    montar();
    await abrirEdicao(user);

    const granja = screen.getByLabelText(/granja \/ empresa/i);
    await user.clear(granja);
    await user.type(granja, "Granja XYZ");
    await user.click(screen.getByRole("button", { name: /^salvar$/i }));

    expect(updateCompanyAction).toHaveBeenCalledWith({
      eventId: EVENTO,
      registrationId: "33333333-3333-4333-8333-333333333333",
      companyName: "Granja XYZ",
    });
  });

  /**
   * ⚠️ O AVISO É PARTE DA FUNCIONALIDADE. Sem ele, alguém corrige o nome da
   * granja achando que mexe só na linha do João — e muda o de todo mundo
   * daquela inscrição.
   */
  it("avisa que a granja vale para todos da inscrição", async () => {
    const user = userEvent.setup();
    montar();
    await abrirEdicao(user);

    expect(screen.getByText(/vale para todos os participantes desta inscrição/i)).toBeTruthy();
  });
});

describe("§15 — telefone OU WhatsApp", () => {
  it("recusa salvar com os dois vazios, e não chama o banco", async () => {
    const user = userEvent.setup();
    montar();
    await abrirEdicao(user);

    await user.clear(screen.getByLabelText(/telefone/i));
    await user.click(screen.getByRole("button", { name: /^salvar$/i }));

    expect(updateParticipantAction).not.toHaveBeenCalled();
    expect(screen.getByText(/informe telefone ou whatsapp\./i)).toBeTruthy();
  });

  it("aceita quando só o WhatsApp está preenchido", async () => {
    const user = userEvent.setup();
    montar();
    await abrirEdicao(user);

    await user.clear(screen.getByLabelText(/telefone/i));
    await user.type(screen.getByLabelText(/whatsapp/i), "11988887777");
    await user.click(screen.getByRole("button", { name: /^salvar$/i }));

    expect(updateParticipantAction).toHaveBeenCalled();
  });
});

describe("§14 — duplicidade de e-mail", () => {
  /**
   * ⚠️ A REGRA É DO BANCO, e a tela só a traduz. `update_event_participant`
   * confere desconsiderando o próprio participante e devolve RG003; aqui isso
   * vira uma frase em português, dentro do diálogo, com os dados preservados
   * para a pessoa corrigir.
   */
  it("o e-mail já inscrito vira mensagem, e o diálogo continua aberto", async () => {
    const user = userEvent.setup();
    updateParticipantAction.mockResolvedValue({
      ok: false,
      error: { code: "participantAlreadyRegistered" },
    });

    montar();
    await abrirEdicao(user);

    const email = screen.getByLabelText(/e-mail/i);
    await user.clear(email);
    await user.type(email, "maria@email.com");
    await user.click(screen.getByRole("button", { name: /^salvar$/i }));

    expect(screen.getByRole("alert").textContent).toMatch(/já está inscrito/i);
    // O que foi digitado continua ali: recomeçar seria o castigo errado.
    expect((screen.getByLabelText(/e-mail/i) as HTMLInputElement).value).toBe("maria@email.com");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("e-mail malformado morre na tela, sem tocar no banco", async () => {
    const user = userEvent.setup();
    montar();
    await abrirEdicao(user);

    const email = screen.getByLabelText(/e-mail/i);
    await user.clear(email);
    await user.type(email, "joao@email");
    await user.click(screen.getByRole("button", { name: /^salvar$/i }));

    expect(updateParticipantAction).not.toHaveBeenCalled();
    expect(screen.getByText(/e-mail inválido/i)).toBeTruthy();
  });
});

describe("§23 — duplo clique no salvar", () => {
  it("dois cliques rápidos gravam uma vez só", async () => {
    const user = userEvent.setup();
    let liberar: (v: unknown) => void = () => {};
    updateParticipantAction.mockImplementation(() => new Promise((resolve) => (liberar = resolve)));

    montar();
    await abrirEdicao(user);

    const salvar = screen.getByRole("button", { name: /^salvar$/i });
    await user.click(salvar);
    await user.click(salvar);

    expect(updateParticipantAction).toHaveBeenCalledTimes(1);
    liberar({ ok: true, data: { id: "p1" } });
  });
});

/**
 * ============================================================================
 * ⚠️ A MÁSCARA DESTE MODAL NÃO TINHA UM TESTE, E FOI COBRADA COMO SE NÃO
 *    EXISTISSE.
 * ============================================================================
 * Ela existe desde o Prompt 4 — `formatPhoneInput` no `onChange` dos dois
 * campos. O que faltava era o TETO: acima de onze dígitos a função saía da
 * frente (para não estragar número estrangeiro) e devolvia o que recebesse, e
 * o campo aceitava quarenta algarismos sem uma palavra.
 *
 * Visto de fora, os dois defeitos parecem o mesmo: você digita muito, a máscara
 * some, e nada te impede. Daí a pergunta ter chegado como "o modal não está com
 * máscara". Estes casos separam as duas coisas e passam a cobrar as duas.
 */
describe("a máscara e o teto dos telefones", () => {
  it("mascara enquanto se digita, nos dois campos", async () => {
    const user = userEvent.setup();
    montar({ phone: null, whatsapp: null });
    await abrirEdicao(user);

    const telefone = screen.getByLabelText(/telefone/i) as HTMLInputElement;
    const whatsapp = screen.getByLabelText(/whatsapp/i) as HTMLInputElement;

    await user.type(telefone, "1133334444");
    await user.type(whatsapp, "45999990000");

    expect(telefone.value).toBe("(11) 3333-4444");
    expect(whatsapp.value).toBe("(45) 99999-0000");
  });

  /**
   * ⚠️ O CORTE É EM DÍGITOS, e não um `maxLength` no campo: a máscara brasileira
   * completa tem exatamente 15 CARACTERES, e um `maxLength={15}` bloquearia o
   * 12º dígito — que é onde um número estrangeiro começa. Ver o cabeçalho de
   * `formatPhoneInput`.
   */
  it("nenhum dos dois passa de 15 dígitos", async () => {
    const user = userEvent.setup();
    montar({ phone: null, whatsapp: null });
    await abrirEdicao(user);

    const telefone = screen.getByLabelText(/telefone/i) as HTMLInputElement;
    const whatsapp = screen.getByLabelText(/whatsapp/i) as HTMLInputElement;

    await user.type(telefone, "1".repeat(40));
    await user.type(whatsapp, "9".repeat(40));

    expect(onlyDigits(telefone.value)).toHaveLength(MAX_PHONE_DIGITS);
    expect(onlyDigits(whatsapp.value)).toHaveLength(MAX_PHONE_DIGITS);
  });

  /**
   * ⚠️ E O ESTRANGEIRO CONTINUA CABENDO. Doze dígitos é um telefone português
   * com o código do país — é a metade do §17 que o teto poderia ter matado.
   */
  it("um número internacional de 12 dígitos passa inteiro", async () => {
    const user = userEvent.setup();
    montar({ phone: null, whatsapp: null });
    await abrirEdicao(user);

    const telefone = screen.getByLabelText(/telefone/i) as HTMLInputElement;
    await user.type(telefone, "351912345678");

    expect(telefone.value).toBe("351912345678");
  });

  /** O que vai ao banco são DÍGITOS: a máscara é da tela, e o schema a desfaz. */
  it("o que se envia não leva a máscara junto", async () => {
    const user = userEvent.setup();
    montar({ phone: null, whatsapp: null });
    await abrirEdicao(user);

    await user.type(screen.getByLabelText(/telefone/i), "1133334444");
    await user.click(screen.getByRole("button", { name: /salvar/i }));

    const enviado = updateParticipantAction.mock.calls[0]?.[0] as { phone: string };
    expect(enviado.phone).toBe("1133334444");
  });
});
