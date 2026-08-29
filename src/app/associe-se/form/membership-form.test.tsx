import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * O texto de consentimento agora vem do SERVIDOR (é editável em Configurações),
 * então o formulário o recebe por prop. O teste fornece um valor fixo: o que
 * está sob prova aqui é a decisão da tela, não de onde o texto veio.
 */
const CONSENTIMENTO = { version: "2026-08-v1", body: "Autorizo a APCS a tratar meus dados." };

/**
 * O formulário público, em três etapas.
 *
 * A action é `"use server"` — importá-la de verdade tentaria abrir o Supabase. O
 * que está sob teste aqui é a DECISÃO DA TELA:
 *
 *   • cada etapa cobra os SEUS campos, e só eles;
 *   • o consentimento só é cobrado no envio, nunca no "Continuar";
 *   • os campos da etapa 3 mudam conforme o perfil escolhido na etapa 1;
 *   • o que a pessoa digitou sobrevive a um erro de envio.
 *
 * ⚠️ A etapa é lida pelo `progressbar`, e não pelo texto "Etapa 1 de 3" — ele
 * aparece DUAS vezes na tela de propósito: uma visível, no indicador de
 * progresso, e uma `sr-only`, que é o alvo do foco na troca de etapa. Procurar
 * pelo texto encontraria os dois; `aria-valuenow` é o número, sem ambiguidade.
 *
 * ⚠️ `prefers-reduced-motion` é forçado para VERDADE no `matchMedia` de mentira.
 * Não é para "desligar animação no teste": é porque a troca de etapa acontece
 * atrás de um `setTimeout` de 190ms quando há animação, e um teste que depende
 * de temporizador de animação é um teste que pisca. O caminho sem movimento é o
 * mesmo caminho lógico — `goTo` só muda QUANDO troca a etapa, não O QUE faz.
 */

const submitMembershipApplicationAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/membership", () => ({ submitMembershipApplicationAction }));

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span data-testid="imagem">{alt}</span>,
}));

const { MembershipForm } = await import("./membership-form");

beforeEach(() => {
  submitMembershipApplicationAction.mockReset();
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

/** A etapa atual, lida do indicador de progresso. */
function etapaAtual() {
  return Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
}

/** Vai da etapa 1 até a 3 escolhendo um perfil e preenchendo o contato. */
async function ateAEtapa3(user: ReturnType<typeof userEvent.setup>, perfil = "Sou criador") {
  await user.click(screen.getByRole("radio", { name: new RegExp(perfil) }));
  await user.click(screen.getByRole("button", { name: "Continuar" }));

  await user.type(screen.getByLabelText("Nome completo"), "Maria da Silva");
  await user.type(screen.getByLabelText("WhatsApp com DDD"), "54991234567");
  await user.type(screen.getByLabelText("E-mail"), "maria@exemplo.com");
  await user.type(screen.getByLabelText("Cidade"), "Caxias do Sul");
  await user.click(screen.getByRole("button", { name: "Continuar" }));
}

describe("navegação entre etapas", () => {
  it("começa na etapa 1, pedindo o perfil", () => {
    render(<MembershipForm consent={CONSENTIMENTO} />);
    expect(etapaAtual()).toBe(1);
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
  });

  it("não avança sem escolher o perfil", async () => {
    const user = userEvent.setup();
    render(<MembershipForm consent={CONSENTIMENTO} />);

    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(
      await screen.findByText("Selecione o perfil que melhor representa você."),
    ).toBeInTheDocument();
    expect(etapaAtual()).toBe(1);
  });

  it("avança para o contato depois de escolher o perfil", async () => {
    const user = userEvent.setup();
    render(<MembershipForm consent={CONSENTIMENTO} />);

    await user.click(screen.getByRole("radio", { name: /Sou criador/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByLabelText("Nome completo")).toBeInTheDocument();
    expect(etapaAtual()).toBe(2);
  });

  it("a etapa 2 cobra os campos dela e não os da etapa 3", async () => {
    const user = userEvent.setup();
    render(<MembershipForm consent={CONSENTIMENTO} />);

    await user.click(screen.getByRole("radio", { name: /Sou criador/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(await screen.findByRole("button", { name: "Continuar" }));

    expect(await screen.findByText("Informe seu nome completo.")).toBeInTheDocument();
    // O município da produção é da etapa 3: cobrá-lo aqui mandaria a pessoa
    // procurar um campo que ainda não apareceu.
    expect(screen.queryByText("Informe o município da produção.")).not.toBeInTheDocument();
  });

  it("o botão Voltar devolve para a etapa anterior mantendo o preenchido", async () => {
    const user = userEvent.setup();
    render(<MembershipForm consent={CONSENTIMENTO} />);

    await user.click(screen.getByRole("radio", { name: /Sou criador/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.type(await screen.findByLabelText("Nome completo"), "Maria da Silva");
    await user.click(screen.getByRole("button", { name: "Voltar" }));

    expect(await screen.findByRole("radiogroup")).toBeInTheDocument();
    expect(etapaAtual()).toBe(1);
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByLabelText("Nome completo")).toHaveValue("Maria da Silva");
  });
});

describe("campos condicionais por perfil", () => {
  it("criador vê matrizes e propriedade", async () => {
    const user = userEvent.setup();
    render(<MembershipForm consent={CONSENTIMENTO} />);
    await ateAEtapa3(user);

    expect(await screen.findByLabelText(/Número aproximado de matrizes/)).toBeInTheDocument();
    expect(screen.getByLabelText("Município da produção")).toBeInTheDocument();
    expect(screen.queryByLabelText("Razão social")).not.toBeInTheDocument();
  });

  it("empresa vê razão social e CNPJ, e não vê matrizes", async () => {
    const user = userEvent.setup();
    render(<MembershipForm consent={CONSENTIMENTO} />);
    await ateAEtapa3(user, "Represento uma empresa");

    expect(await screen.findByLabelText("Razão social")).toBeInTheDocument();
    expect(screen.getByLabelText("CNPJ")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Número aproximado de matrizes/)).not.toBeInTheDocument();
  });

  it("técnico vê área de atuação e cargo", async () => {
    const user = userEvent.setup();
    render(<MembershipForm consent={CONSENTIMENTO} />);
    await ateAEtapa3(user, "Sou técnico");

    expect(await screen.findByLabelText("Área de atuação")).toBeInTheDocument();
    expect(screen.getByLabelText("Cargo ou função")).toBeInTheDocument();
  });

  /**
   * ⚠️ A PERGUNTA DE INTERESSES FOI RETIRADA a pedido da APCS. O teste é pela
   * ausência de propósito: um formulário público ganha campo com facilidade, e
   * cada campo a mais é gente que desiste no meio. Se a pergunta voltar sem
   * decisão, isto acusa.
   */
  it("não pergunta interesses", async () => {
    const user = userEvent.setup();
    render(<MembershipForm consent={CONSENTIMENTO} />);
    await ateAEtapa3(user);

    expect(screen.queryByText(/temas mais interessam/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bolsa de Suínos/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Qual outro interesse?")).not.toBeInTheDocument();
  });
});

describe("consentimento", () => {
  it("não é cobrado ao avançar entre etapas", async () => {
    const user = userEvent.setup();
    render(<MembershipForm consent={CONSENTIMENTO} />);

    await user.click(screen.getByRole("radio", { name: /Sou criador/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(
      screen.queryByText("É necessário aceitar o tratamento de dados para enviar."),
    ).not.toBeInTheDocument();
  });

  it("é cobrado no envio", async () => {
    const user = userEvent.setup();
    render(<MembershipForm consent={CONSENTIMENTO} />);
    await ateAEtapa3(user);

    await user.type(await screen.findByLabelText("Município da produção"), "Vacaria");
    await user.click(screen.getByRole("button", { name: "Enviar minha solicitação" }));

    expect(
      await screen.findByText("É necessário aceitar o tratamento de dados para enviar."),
    ).toBeInTheDocument();
    expect(submitMembershipApplicationAction).not.toHaveBeenCalled();
  });
});

describe("envio", () => {
  async function preencherTudo(user: ReturnType<typeof userEvent.setup>) {
    await ateAEtapa3(user);
    await user.type(await screen.findByLabelText("Município da produção"), "Vacaria");
    await user.click(screen.getByLabelText(/Autorizo a APCS/));
  }

  it("chama a action e mostra o protocolo", async () => {
    const user = userEvent.setup();
    submitMembershipApplicationAction.mockResolvedValue({
      ok: true,
      data: { protocol: "ASC-000042", duplicate: false },
    });

    render(<MembershipForm consent={CONSENTIMENTO} />);
    await preencherTudo(user);
    await user.click(screen.getByRole("button", { name: "Enviar minha solicitação" }));

    expect(await screen.findByText("Recebemos sua solicitação")).toBeInTheDocument();
    expect(screen.getByText("ASC-000042")).toBeInTheDocument();
  });

  it("envia o telefone e o e-mail que a pessoa digitou", async () => {
    const user = userEvent.setup();
    submitMembershipApplicationAction.mockResolvedValue({
      ok: true,
      data: { protocol: "ASC-000043", duplicate: false },
    });

    render(<MembershipForm consent={CONSENTIMENTO} />);
    await preencherTudo(user);
    await user.click(screen.getByRole("button", { name: "Enviar minha solicitação" }));

    await waitFor(() => expect(submitMembershipApplicationAction).toHaveBeenCalledTimes(1));
    const enviado = submitMembershipApplicationAction.mock.calls[0]?.[0];
    expect(enviado.email).toBe("maria@exemplo.com");
    expect(enviado.whatsapp).toBe("(54) 99123-4567");
    expect(enviado.profileType).toBe("criador");
    expect(enviado.consentAccepted).toBe(true);
  });

  it("o duplo clique só envia uma vez", async () => {
    const user = userEvent.setup();
    let resolver: ((v: unknown) => void) | undefined;
    submitMembershipApplicationAction.mockImplementation(
      () => new Promise((resolve) => (resolver = resolve)),
    );

    render(<MembershipForm consent={CONSENTIMENTO} />);
    await preencherTudo(user);

    const botao = screen.getByRole("button", { name: "Enviar minha solicitação" });
    await user.click(botao);
    await user.click(botao);

    expect(submitMembershipApplicationAction).toHaveBeenCalledTimes(1);
    resolver?.({ ok: true, data: { protocol: "ASC-000044", duplicate: false } });
  });

  it("erro do servidor não apaga o que foi preenchido", async () => {
    const user = userEvent.setup();
    submitMembershipApplicationAction.mockResolvedValue({
      ok: false,
      error: { code: "membershipRateLimited" },
    });

    render(<MembershipForm consent={CONSENTIMENTO} />);
    await preencherTudo(user);
    await user.click(screen.getByRole("button", { name: "Enviar minha solicitação" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Aguarde um pouco/);
    // Ainda na etapa 3, com o município preenchido: é o que impede a pessoa de
    // ter de recomeçar por causa de um erro que não foi dela.
    expect(screen.getByLabelText("Município da produção")).toHaveValue("Vacaria");
  });

  it("uma queda de rede vira uma frase, não uma tela quebrada", async () => {
    const user = userEvent.setup();
    submitMembershipApplicationAction.mockRejectedValue(new Error("network"));

    render(<MembershipForm consent={CONSENTIMENTO} />);
    await preencherTudo(user);
    await user.click(screen.getByRole("button", { name: "Enviar minha solicitação" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Verifique sua conexão/);
  });
});
