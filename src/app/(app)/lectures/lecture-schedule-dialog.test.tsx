import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LectureConflict } from "@/modules/lecture/lecture.types";
import { LectureScheduleDialog } from "./lecture-schedule-dialog";

const rescheduleLectureAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/lectures", () => ({ rescheduleLectureAction }));

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const PALESTRA = {
  id: "l1",
  name: "Mercado de Suínos",
  eventDate: "2026-11-10",
  startTime: "09:00",
  endTime: "10:00",
  status: "planned" as const,
};

const CONFLITO: LectureConflict = {
  id: "l2",
  protocol: "SOL-000007",
  name: "Custo de Produção",
  eventDate: "2026-11-20",
  startTime: "15:00",
  endTime: "17:00",
  city: "Cascavel",
  responsibleName: "Gestor Teste",
  speakerName: null,
};

const onDone = vi.fn();
const onOpenChange = vi.fn();

function montar(suggested?: { eventDate: string; startTime?: string | null }) {
  return render(
    <LectureScheduleDialog
      lecture={PALESTRA}
      open
      onOpenChange={onOpenChange}
      suggested={suggested}
      trigger={false}
      onDone={onDone}
    />,
  );
}

beforeEach(() => {
  rescheduleLectureAction.mockReset();
  rescheduleLectureAction.mockResolvedValue({ ok: true, data: { id: "l1", conflicts: [] } });
  refresh.mockReset();
  onDone.mockReset();
  onOpenChange.mockReset();
});

describe("§26 a confirmação do arrastar-e-soltar", () => {
  it("abre com a data que o arrasto sugeriu, e não com a atual", () => {
    montar({ eventDate: "2026-11-20", startTime: "15:00" });

    expect(screen.getByLabelText(/^Data/)).toHaveValue("2026-11-20");
    // O horário virou DOIS seletores (ver ui/time-select.tsx): a sugestão do
    // arrasto tem de chegar nos dois, ou a tela mostraria meio horário.
    expect(screen.getByLabelText("Hora de início — hora")).toHaveValue("15");
    expect(screen.getByLabelText("Hora de início — minuto")).toHaveValue("00");
  });

  /**
   * ⚠️ Sem isto, arrastar uma palestra de 09:00–10:00 para as 15:00 abriria o
   * diálogo com término 10:00 — antes do início — e o botão Confirmar já
   * nasceria bloqueado, sobre um campo em que ninguém encostou.
   */
  it("a duração acompanha o arrasto", () => {
    montar({ eventDate: "2026-11-20", startTime: "15:00" });

    expect(screen.getByLabelText("Hora de término — hora")).toHaveValue("16");
    expect(screen.getByLabelText("Hora de término — minuto")).toHaveValue("00");
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeEnabled();
  });

  it("mostra como a palestra está hoje, para a mudança ser comparável", () => {
    montar({ eventDate: "2026-11-20" });
    expect(screen.getByText(/10\/11\/2026/)).toBeInTheDocument();
  });

  it("pede confirmação em vez de reagendar direto", () => {
    montar({ eventDate: "2026-11-20" });

    expect(screen.getByText(/Deseja alterar a data\/horário desta palestra\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeInTheDocument();
    // ⚠️ Nada foi enviado ainda: soltar abre a pergunta, não executa.
    expect(rescheduleLectureAction).not.toHaveBeenCalled();
  });
});

describe("§27 o reagendamento", () => {
  it("chama a action específica e anuncia o sucesso", async () => {
    montar({ eventDate: "2026-11-20", startTime: "15:00" });
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(rescheduleLectureAction).toHaveBeenCalledWith({
      lectureId: "l1",
      eventDate: "2026-11-20",
      startTime: "15:00",
      // A palestra durava uma hora e continua durando: 15:00 → 16:00.
      endTime: "16:00",
    });
    expect(onDone).toHaveBeenCalledWith("Palestra reagendada com sucesso.");
    expect(refresh).toHaveBeenCalled();
  });

  /**
   * §28 — o caso que o escopo faz questão de nomear.
   *
   * Se o servidor recusar, a palestra continua onde estava: nada foi movido
   * antes da resposta, então não há o que desfazer. A tela só mostra por quê.
   */
  it("recusa do servidor NÃO move nada e mostra mensagem amigável", async () => {
    rescheduleLectureAction.mockResolvedValue({
      ok: false,
      error: { code: "lectureStatusBlocksAction" },
    });

    montar({ eventDate: "2026-11-20" });
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/não permite esta operação/i);
    expect(onDone).not.toHaveBeenCalled();
    // O diálogo continua aberto — a pessoa vê o motivo sem perder o contexto.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("horário invertido nem chega ao servidor", async () => {
    montar({ eventDate: "2026-11-20" });

    // 08:00 contra um início de 09:00. Com os seletores não dá para "digitar"
    // um horário: escolhe-se a hora, e o minuto já vem 00.
    await userEvent.selectOptions(screen.getByLabelText("Hora de término — hora"), "08");

    expect(screen.getByRole("alert")).toHaveTextContent(/posterior ao de início/i);
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
  });
});

describe("§25 o conflito de horário", () => {
  /**
   * ⚠️ O conflito volta JUNTO COM O SUCESSO, e a tela precisa contar essa
   * história: a palestra FOI reagendada. Tratar o aviso como erro faria a pessoa
   * achar que precisa desfazer algo que talvez esteja certo — pode haver mais de
   * um palestrante disponível, que é exatamente por que o §33 proíbe bloquear.
   */
  it("aparece como AVISO depois do reagendamento bem-sucedido", async () => {
    rescheduleLectureAction.mockResolvedValue({
      ok: true,
      data: { id: "l1", conflicts: [CONFLITO] },
    });

    montar({ eventDate: "2026-11-20", startTime: "15:00" });
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText(/Há outra palestra marcada neste mesmo horário/),
    ).toBeInTheDocument();
    // O sucesso foi anunciado assim mesmo.
    expect(onDone).toHaveBeenCalledWith("Palestra reagendada com sucesso.");
    // E não é um erro.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("identifica a palestra concorrente com o que o §25 pede", async () => {
    rescheduleLectureAction.mockResolvedValue({
      ok: true,
      data: { id: "l1", conflicts: [CONFLITO] },
    });

    montar({ eventDate: "2026-11-20", startTime: "15:00" });
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("Custo de Produção")).toBeInTheDocument();
    expect(screen.getByText("SOL-000007")).toBeInTheDocument();
    expect(screen.getByText(/20\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/15:00 às 17:00/)).toBeInTheDocument();
    expect(screen.getByText(/Cascavel/)).toBeInTheDocument();
    expect(screen.getByText(/Responsável: Gestor Teste/)).toBeInTheDocument();
  });

  /**
   * O rodapé deixa de oferecer "Confirmar": o reagendamento JÁ aconteceu, e o
   * que sobrou é reconhecer o aviso. O rótulo é "Entendi" e não "Fechar" porque
   * o `<dialog>` do design system já tem um X com esse nome acessível — dois
   * controles chamados "Fechar" são ambíguos para quem navega por leitor de tela.
   */
  it("com conflito na tela, o botão de confirmar sai — a operação já aconteceu", async () => {
    rescheduleLectureAction.mockResolvedValue({
      ok: true,
      data: { id: "l1", conflicts: [CONFLITO] },
    });

    montar({ eventDate: "2026-11-20", startTime: "15:00" });
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("button", { name: "Entendi" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
  });
});
