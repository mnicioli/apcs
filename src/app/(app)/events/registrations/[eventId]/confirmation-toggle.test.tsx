import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmationToggle } from "./confirmation-toggle";

/**
 * O TOGGLE DE CONFIRMAÇÃO (§10, §11, §22, §23, §26).
 *
 * ⚠️ A ACTION É MOCKADA porque ela é `"use server"`. O que estes testes provam é
 * o comportamento da TELA: o que ela envia, o que ela mostra enquanto envia, e o
 * que ela faz quando o servidor recusa.
 */

const setParticipantConfirmationAction = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/event-landing", () => ({ setParticipantConfirmationAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const EVENTO = "11111111-1111-4111-8111-111111111111";
const PARTICIPANTE = "44444444-4444-4444-8444-444444444444";

function montar(confirmation: "confirmed" | "not_confirmed" = "not_confirmed") {
  return render(
    <ConfirmationToggle
      eventId={EVENTO}
      participantId={PARTICIPANTE}
      participantName="João da Silva"
      confirmation={confirmation}
    />,
  );
}

beforeEach(() => {
  setParticipantConfirmationAction.mockReset();
  setParticipantConfirmationAction.mockResolvedValue({ ok: true, data: { id: PARTICIPANTE } });
  refresh.mockReset();
});

describe("§10 — OFF ↔ ON", () => {
  it("OFF vira ON e persiste", async () => {
    const user = userEvent.setup();
    montar("not_confirmed");

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);

    expect(setParticipantConfirmationAction).toHaveBeenCalledWith({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      confirmation: "confirmed",
    });
    // §27 — a tela precisa refletir o que foi gravado.
    expect(refresh).toHaveBeenCalled();
  });

  it("ON vira OFF e persiste", async () => {
    const user = userEvent.setup();
    montar("confirmed");

    await user.click(screen.getByRole("switch"));

    expect(setParticipantConfirmationAction).toHaveBeenCalledWith({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      confirmation: "not_confirmed",
    });
  });

  /**
   * ⚠️ §26 — O EVENTO VIAJA JUNTO. Sem ele a função do banco não tem como
   * conferir a cadeia, e um id de participante de outro evento passaria. Este
   * caso falha se alguém "simplificar" as props.
   */
  it("manda sempre o evento da rota", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("switch"));

    expect(setParticipantConfirmationAction.mock.calls[0]?.[0].eventId).toBe(EVENTO);
  });
});

describe("§23 — duplo clique e retry", () => {
  /**
   * ==========================================================================
   * ⚠️ DOIS CLIQUES RÁPIDOS, UM ENVIO SÓ.
   * ==========================================================================
   * `setState` é assíncrono: os dois cliques passariam pelo `if` antes do
   * primeiro `render`, e um guarda baseado em estado não pegaria nenhum dos
   * dois. O `ref` muda na hora. Este teste segura a promessa aberta para
   * reproduzir exatamente essa janela.
   *
   * A terceira rede está no BANCO (compare-and-set), e é a única que sobrevive
   * a um F5 no meio do envio — ver `sql-event-landing.test.ts`.
   */
  it("o segundo clique não dispara uma segunda gravação", async () => {
    const user = userEvent.setup();
    let liberar: (v: unknown) => void = () => {};
    setParticipantConfirmationAction.mockImplementation(
      () => new Promise((resolve) => (liberar = resolve)),
    );

    montar();
    const toggle = screen.getByRole("switch");
    await user.click(toggle);
    await user.click(toggle);

    expect(setParticipantConfirmationAction).toHaveBeenCalledTimes(1);
    liberar({ ok: true, data: { id: PARTICIPANTE } });
  });

  it("fica desabilitado enquanto grava", async () => {
    const user = userEvent.setup();
    setParticipantConfirmationAction.mockImplementation(() => new Promise(() => {}));

    montar();
    await user.click(screen.getByRole("switch"));

    expect(screen.getByRole("switch")).toBeDisabled();
  });
});

describe("§27 — quando o servidor recusa", () => {
  /**
   * ==========================================================================
   * ⚠️ O ESTADO OTIMISTA É DESFEITO. Mostrar "Confirmado" sobre uma gravação que
   * não aconteceu é pior que a espera: a pessoa segue para o próximo nome
   * achando que confirmou, e o participante fica de fora do evento.
   * ==========================================================================
   */
  it("o toggle volta ao valor anterior e explica", async () => {
    const user = userEvent.setup();
    setParticipantConfirmationAction.mockResolvedValue({
      ok: false,
      error: { code: "forbidden" },
    });

    montar("not_confirmed");
    await user.click(screen.getByRole("switch"));

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("alert").textContent).toMatch(/permissão/i);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("queda de rede não deixa a tela mentindo", async () => {
    const user = userEvent.setup();
    setParticipantConfirmationAction.mockRejectedValue(new Error("network"));

    montar("confirmed");
    await user.click(screen.getByRole("switch"));

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("alert").textContent).toMatch(/conexão/i);
  });

  /**
   * ⚠️ NENHUM ERRO EXPÕE O SISTEMA (§25). Um participante de outro evento
   * responde "não encontrado" — e não "existe, mas é de outro evento", que
   * confirmaria a existência do registro.
   */
  it("participante de outro evento não revela nada", async () => {
    const user = userEvent.setup();
    setParticipantConfirmationAction.mockResolvedValue({
      ok: false,
      error: { code: "notFound" },
    });

    montar();
    await user.click(screen.getByRole("switch"));

    const tela = document.body.textContent ?? "";
    expect(tela).toMatch(/não encontrado/i);
    for (const tecnico of ["P0002", "event_id", "participant", EVENTO]) {
      expect(tela).not.toContain(tecnico);
    }
  });
});

describe("§28 e acessibilidade", () => {
  /**
   * ⚠️ O RÓTULO NOMEIA A PESSOA. A tabela tem um destes por linha — trinta
   * botões chamados "Confirmado" são trinta botões indistinguíveis para quem
   * navega por leitor de tela, e confirmar a pessoa errada é o erro mais caro
   * que esta tela permite.
   */
  it("cada toggle diz de quem é", () => {
    montar();
    expect(screen.getByRole("switch", { name: /João da Silva/ })).toBeTruthy();
  });

  /** `role="switch"` faz o leitor anunciar "ativado/desativado", e não só "botão". */
  it("é anunciado como interruptor", () => {
    montar("confirmed");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
});
