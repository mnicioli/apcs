import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LandingStatusActions } from "./landing-status-actions";
import type { LandingPageStatus } from "@/modules/event/event.landing.types";

/**
 * AS AÇÕES DE SITUAÇÃO (§22, §24, §26).
 *
 * A action é `"use server"` — importá-la de verdade tentaria abrir o Supabase.
 * O que está sob teste aqui é a DECISÃO DA TELA: qual ação é oferecida em cada
 * situação, e o que o sistema pede antes de executá-la.
 *
 * ⚠️ ESTES TESTES SÃO A LEITURA DAS TRANSIÇÕES, NÃO A GARANTIA DELAS. Quem
 * recusa uma transição impossível é `set_event_landing_page_status` no Postgres
 * (LP002). O que se prova aqui é que a tela não OFERECE o que o banco vai
 * recusar — porque um botão que sempre falha é pior do que a ausência dele.
 */

const setLandingPageStatusAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/event-landing", () => ({ setLandingPageStatusAction }));

function montar(status: LandingPageStatus, onDone?: () => void) {
  return render(
    <LandingStatusActions
      landingPageId="l1"
      eventName="Encontro Técnico"
      status={status}
      onDone={onDone}
    />,
  );
}

beforeEach(() => {
  setLandingPageStatusAction.mockReset();
  setLandingPageStatusAction.mockResolvedValue({
    ok: true,
    data: { id: "l1", status: "published" },
  });
});

describe("quais ações aparecem em cada situação (§26)", () => {
  it("rascunho: publicar e tirar do ar; nunca encerrar", () => {
    montar("draft");
    expect(screen.getByRole("button", { name: "Publicar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tirar do ar" })).toBeInTheDocument();
    // ⚠️ Encerrar um rascunho seria encerrar inscrições que nunca abriram.
    expect(screen.queryByRole("button", { name: "Encerrar" })).not.toBeInTheDocument();
  });

  it("publicada: encerrar e tirar do ar; nunca publicar de novo", () => {
    montar("published");
    expect(screen.getByRole("button", { name: "Encerrar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tirar do ar" })).toBeInTheDocument();
    // Republicar o que já está no ar não é nada — e aceitar em silêncio
    // esconderia um botão apertado no lugar errado.
    expect(screen.queryByRole("button", { name: /publicar/i })).not.toBeInTheDocument();
  });

  it("encerrada: republicar e tirar do ar", () => {
    montar("closed");
    expect(screen.getByRole("button", { name: "Republicar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tirar do ar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Encerrar" })).not.toBeInTheDocument();
  });

  it("inativa: só republicar", () => {
    montar("inactive");
    expect(screen.getByRole("button", { name: "Republicar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tirar do ar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Encerrar" })).not.toBeInTheDocument();
  });
});

describe("confirmação antes de agir (§24)", () => {
  /**
   * ⚠️ NADA ACONTECE NO PRIMEIRO CLIQUE. Publicar põe a página na internet;
   * tirar do ar derruba um link que já pode ter sido enviado a centenas de
   * pessoas. As duas merecem uma pergunta.
   */
  it("clicar em Publicar abre o diálogo e não chama a action", async () => {
    const user = userEvent.setup();
    montar("draft");

    await user.click(screen.getByRole("button", { name: "Publicar" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/fica no ar no endereço público/i)).toBeInTheDocument();
    expect(setLandingPageStatusAction).not.toHaveBeenCalled();
  });

  it("confirmar chama a action com o comando certo", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    montar("draft", onDone);

    await user.click(screen.getByRole("button", { name: "Publicar" }));
    const dialogo = screen.getByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: "Publicar" }));

    expect(setLandingPageStatusAction).toHaveBeenCalledWith({
      landingPageId: "l1",
      command: "publish",
    });
    expect(onDone).toHaveBeenCalled();
  });

  it("cancelar não chama a action", async () => {
    const user = userEvent.setup();
    montar("published");

    await user.click(screen.getByRole("button", { name: "Encerrar" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(setLandingPageStatusAction).not.toHaveBeenCalled();
  });

  it("o diálogo diz de qual evento se trata", async () => {
    const user = userEvent.setup();
    montar("published");

    await user.click(screen.getByRole("button", { name: "Tirar do ar" }));

    // Sem o nome, quem tem três páginas abertas em abas não sabe qual vai sair
    // do ar.
    expect(screen.getByText("Encontro Técnico")).toBeInTheDocument();
  });
});

describe("erro do servidor (§29)", () => {
  /**
   * ⚠️ A MENSAGEM É A TRADUZIDA, e o diálogo NÃO FECHA. Fechar em cima de um
   * erro faria a pessoa concluir que deu certo — e ela só descobriria o
   * contrário quando alguém reclamasse que o link não abre.
   */
  it("mostra a mensagem traduzida e mantém o diálogo aberto", async () => {
    const user = userEvent.setup();
    setLandingPageStatusAction.mockResolvedValue({
      ok: false,
      error: { code: "eventExpired" },
    });
    montar("draft");

    await user.click(screen.getByRole("button", { name: "Publicar" }));
    const dialogo = screen.getByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: "Publicar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não é possível ativar um evento cuja data já passou.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("não vaza detalhe interno para a tela", async () => {
    const user = userEvent.setup();
    setLandingPageStatusAction.mockResolvedValue({
      ok: false,
      error: { code: "landingTransitionNotAllowed", constraint: "event_landing_pages_pkey" },
    });
    montar("published");

    await user.click(screen.getByRole("button", { name: "Encerrar" }));
    const dialogo = screen.getByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: "Encerrar" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Esta página não pode passar para essa situação.");
    // Nome de constraint, tabela e stack trace nunca chegam ao usuário.
    expect(alerta.textContent).not.toContain("event_landing_pages_pkey");
  });
});
