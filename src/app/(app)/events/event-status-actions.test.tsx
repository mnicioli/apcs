import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventStatusActions } from "./event-status-actions";

/**
 * A action é `"use server"` — importá-la de verdade tentaria abrir o Supabase.
 * O que está sob teste aqui é a DECISÃO DA TELA: qual ação é oferecida, e com
 * que texto ela pede confirmação.
 */
const setEventStatusAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/events", () => ({ setEventStatusAction }));

const HOJE = "2026-08-12";
const FUTURO = "2026-09-01";
const PASSADO = "2026-08-01";

function montar(props: Partial<Parameters<typeof EventStatusActions>[0]> = {}) {
  return render(
    <EventStatusActions
      eventId="e1"
      eventName="Workshop APCS"
      status="active"
      eventDate={FUTURO}
      today={HOJE}
      {...props}
    />,
  );
}

describe("EventStatusActions — qual ação aparece", () => {
  it("evento ativo oferece Inativar", () => {
    montar({ status: "active", eventDate: FUTURO });
    expect(screen.getByRole("button", { name: "Inativar" })).toBeInTheDocument();
  });

  it("evento inativado à mão, com data futura, oferece Ativar", () => {
    montar({ status: "inactive", eventDate: FUTURO });
    expect(screen.getByRole("button", { name: "Ativar" })).toBeInTheDocument();
  });

  // ⚠️ O caso mais importante da tela. O botão não pode existir: ele sempre
  // falharia (o Postgres devolve EV001), e a pessoa clicaria, leria um erro e
  // não descobriria que o caminho é corrigir a data.
  it("evento EXPIRADO não oferece Ativar", () => {
    montar({ status: "inactive", eventDate: PASSADO });
    expect(screen.queryByRole("button", { name: "Ativar" })).not.toBeInTheDocument();
  });

  // Um evento que ninguém inativou mas cuja data passou ainda está gravado como
  // ativo — inativá-lo é registrar a decisão explícita.
  it("evento vencido mas ainda gravado como ativo oferece Inativar", () => {
    montar({ status: "active", eventDate: PASSADO });
    expect(screen.getByRole("button", { name: "Inativar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ativar" })).not.toBeInTheDocument();
  });
});

describe("EventStatusActions — confirmação", () => {
  it("inativar pede confirmação com o texto do escopo", async () => {
    const user = userEvent.setup();
    montar({ status: "active", eventDate: FUTURO });

    await user.click(screen.getByRole("button", { name: "Inativar" }));

    expect(
      screen.getByText(
        "Deseja realmente inativar este evento? Eventos inativos não serão disponibilizados para o chatbot e futuras comunicações.",
      ),
    ).toBeInTheDocument();
  });

  it("ativar pede confirmação com o texto do escopo", async () => {
    const user = userEvent.setup();
    montar({ status: "inactive", eventDate: FUTURO });

    await user.click(screen.getByRole("button", { name: "Ativar" }));

    expect(
      screen.getByText(
        "Deseja ativar este evento? Ele poderá ser disponibilizado para consulta e comunicação aos associados conforme sua segmentação.",
      ),
    ).toBeInTheDocument();
  });

  it("cancelar não chama a action", async () => {
    const user = userEvent.setup();
    setEventStatusAction.mockClear();
    montar({ status: "active", eventDate: FUTURO });

    await user.click(screen.getByRole("button", { name: "Inativar" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(setEventStatusAction).not.toHaveBeenCalled();
  });

  it("confirmar chama a action com o comando certo", async () => {
    const user = userEvent.setup();
    setEventStatusAction.mockClear();
    setEventStatusAction.mockResolvedValue({ ok: true, data: { id: "e1", status: "inactive" } });
    montar({ status: "active", eventDate: FUTURO });

    await user.click(screen.getByRole("button", { name: "Inativar" }));
    // O segundo "Inativar" é o do rodapé do diálogo.
    const confirmar = screen.getAllByRole("button", { name: "Inativar" }).at(-1);
    await user.click(confirmar!);

    expect(setEventStatusAction).toHaveBeenCalledWith({ eventId: "e1", command: "deactivate" });
  });

  it("erro da action aparece na tela sem fechar o diálogo", async () => {
    const user = userEvent.setup();
    setEventStatusAction.mockClear();
    setEventStatusAction.mockResolvedValue({ ok: false, error: { code: "eventExpired" } });
    montar({ status: "inactive", eventDate: FUTURO });

    await user.click(screen.getByRole("button", { name: "Ativar" }));
    const confirmar = screen.getAllByRole("button", { name: "Ativar" }).at(-1);
    await user.click(confirmar!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não é possível ativar um evento cuja data já passou.",
    );
  });
});

/**
 * O nome do evento é TEXTO LIVRE e chega até o diálogo de confirmação. Nada no
 * módulo higieniza esse texto — e não deve: a defesa é o React interpolar como
 * texto, nunca como marcação. Estes casos existem para que a proteção falhe
 * ruidosamente se alguém trocar a interpolação por `dangerouslySetInnerHTML`.
 */
describe("nome do evento com carga maliciosa (XSS)", () => {
  const CARGA = '<script>alert(1)</script><img src=x onerror="alert(2)">';

  it("renderiza a carga como texto, sem criar elementos", async () => {
    const user = userEvent.setup();
    const { container } = montar({ eventName: CARGA });

    await user.click(screen.getByRole("button", { name: "Inativar" }));

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(await screen.findByText(CARGA)).toBeInTheDocument();
  });

  it("aspas e acentos no nome não quebram o rótulo acessível", () => {
    montar({ eventName: 'Workshop "Suínos" & Cia' });
    expect(screen.getByRole("button", { name: "Inativar" })).toBeInTheDocument();
  });
});
