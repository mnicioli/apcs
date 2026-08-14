import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LectureStatus, LectureTransition } from "@/modules/lecture/lecture.types";
import { LectureStatusDialog } from "./lecture-status-dialog";

/**
 * A action é `"use server"` — importá-la de verdade tentaria abrir o Supabase. O
 * que está sob teste aqui é a DECISÃO DA TELA: quais transições ela oferece,
 * quando exige motivo e o que aparece quando o servidor recusa.
 */
const setLectureStatusAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/lectures", () => ({ setLectureStatusAction }));

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/** O grafo real, o mesmo que a migration insere. */
const GRAFO: LectureTransition[] = [
  { from: null, to: "requested" },
  { from: null, to: "planned" },
  { from: null, to: "confirmed" },
  { from: null, to: "held" },
  { from: "requested", to: "under_review" },
  { from: "under_review", to: "approved" },
  { from: "under_review", to: "rejected" },
  { from: "approved", to: "planned" },
  { from: "planned", to: "confirmed" },
  { from: "confirmed", to: "held" },
  { from: "requested", to: "cancelled" },
  { from: "under_review", to: "cancelled" },
  { from: "approved", to: "cancelled" },
  { from: "planned", to: "cancelled" },
  { from: "confirmed", to: "cancelled" },
];

const onDone = vi.fn();

function montar(status: LectureStatus, transitions: LectureTransition[] = GRAFO) {
  return render(
    <LectureStatusDialog
      lecture={{ id: "l1", name: "Mercado de Suínos", status }}
      transitions={transitions}
      onDone={onDone}
    />,
  );
}

beforeEach(() => {
  setLectureStatusAction.mockReset();
  setLectureStatusAction.mockResolvedValue({ ok: true, data: { id: "l1", status: "approved" } });
  refresh.mockReset();
  onDone.mockReset();
});

describe("§31 quais transições a tela oferece", () => {
  /**
   * ⚠️ O CASO QUE JUSTIFICA A TELA INTEIRA.
   *
   * O escopo é explícito: não usar um select com os oito status. As opções vêm
   * do GRAFO lido do banco, então "Realizada" não aparece numa solicitação nova
   * — e não porque alguém lembrou de escondê-la: ela não está no grafo.
   */
  it("uma solicitação nova NÃO oferece Realizada nem Aprovada", async () => {
    montar("requested");
    await userEvent.click(screen.getByRole("button", { name: "Alterar situação" }));

    expect(screen.getByRole("radio", { name: /Em análise/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Cancelada/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Realizada/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Aprovada/ })).not.toBeInTheDocument();
  });

  it("em análise oferece aprovar, rejeitar e cancelar", async () => {
    montar("under_review");
    await userEvent.click(screen.getByRole("button", { name: "Alterar situação" }));

    expect(screen.getByRole("radio", { name: /Aprovada/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Rejeitada/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Cancelada/ })).toBeInTheDocument();
  });

  it("situação terminal não oferece botão nenhum", () => {
    // Realizada, rejeitada e cancelada não têm saída no grafo. Oferecer
    // "Alterar situação" ali abriria um diálogo vazio.
    for (const status of ["held", "rejected", "cancelled"] as const) {
      const { unmount } = montar(status);
      expect(screen.queryByRole("button", { name: "Alterar situação" })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("o grafo é DADO: mudá-lo muda a tela, sem tocar no componente", async () => {
    // Se uma migration liberar a volta `confirmed → planned`, a opção aparece
    // sozinha — que é a razão de o grafo não estar duplicado em TypeScript.
    montar("confirmed", [...GRAFO, { from: "confirmed", to: "planned" }]);
    await userEvent.click(screen.getByRole("button", { name: "Alterar situação" }));

    expect(screen.getByRole("radio", { name: /Planejada/ })).toBeInTheDocument();
  });
});

describe("§32 motivo obrigatório", () => {
  it("§33 rejeitar exige motivo e o botão fica bloqueado sem ele", async () => {
    montar("under_review");
    await userEvent.click(screen.getByRole("button", { name: "Alterar situação" }));
    await userEvent.click(screen.getByRole("radio", { name: /Rejeitada/ }));

    expect(screen.getByLabelText(/Motivo da rejeição/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Motivo da rejeição/), "tema fora do escopo");
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeEnabled();
  });

  it("§34 cancelar exige motivo do cancelamento", async () => {
    montar("planned");
    await userEvent.click(screen.getByRole("button", { name: "Alterar situação" }));
    await userEvent.click(screen.getByRole("radio", { name: /Cancelada/ }));

    expect(screen.getByLabelText(/Motivo do cancelamento/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
  });

  it("nas demais transições o campo vira observação OPCIONAL", async () => {
    montar("under_review");
    await userEvent.click(screen.getByRole("button", { name: "Alterar situação" }));
    await userEvent.click(screen.getByRole("radio", { name: /Aprovada/ }));

    expect(screen.getByLabelText("Observação")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeEnabled();
  });
});

describe("§35 o que acontece ao confirmar", () => {
  it("manda a transição pedida e anuncia o sucesso", async () => {
    montar("under_review");
    await userEvent.click(screen.getByRole("button", { name: "Alterar situação" }));
    await userEvent.click(screen.getByRole("radio", { name: /Aprovada/ }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(setLectureStatusAction).toHaveBeenCalledWith({
      lectureId: "l1",
      status: "approved",
      reason: undefined,
    });
    expect(onDone).toHaveBeenCalledWith("Solicitação aprovada com sucesso.");
    // §69: a tela aberta agora se atualiza, sem exigir F5.
    expect(refresh).toHaveBeenCalled();
  });

  it("§33 a mensagem da rejeição é a do escopo", async () => {
    montar("under_review");
    await userEvent.click(screen.getByRole("button", { name: "Alterar situação" }));
    await userEvent.click(screen.getByRole("radio", { name: /Rejeitada/ }));
    await userEvent.type(screen.getByLabelText(/Motivo da rejeição/), "sem agenda");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(onDone).toHaveBeenCalledWith("Solicitação rejeitada com sucesso.");
  });

  /**
   * §52: mensagem técnica nunca chega à tela. O que aparece é o texto do
   * catálogo de erros, e o diálogo continua aberto com o que a pessoa digitou.
   */
  it("recusa do servidor vira mensagem amigável, sem perder o texto digitado", async () => {
    setLectureStatusAction.mockResolvedValue({
      ok: false,
      error: { code: "lectureTransitionNotAllowed" },
    });

    montar("under_review");
    await userEvent.click(screen.getByRole("button", { name: "Alterar situação" }));
    await userEvent.click(screen.getByRole("radio", { name: /Rejeitada/ }));
    await userEvent.type(screen.getByLabelText(/Motivo da rejeição/), "sem agenda");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/não é permitida/i);
    expect(screen.getByLabelText(/Motivo da rejeição/)).toHaveValue("sem agenda");
    expect(onDone).not.toHaveBeenCalled();
  });
});
