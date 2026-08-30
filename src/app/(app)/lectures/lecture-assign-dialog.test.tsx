import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DirectoryEntry } from "@/lib/services/profile";
import type { Lecture } from "@/modules/lecture/lecture.types";
import { LectureAssignDialog } from "./lecture-assign-dialog";

const assignLectureSpeakerAction = vi.hoisted(() => vi.fn());
const assignLectureResponsibleAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/lectures", () => ({
  assignLectureSpeakerAction,
  assignLectureResponsibleAction,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ID = "22222222-2222-4222-8222-222222222222";
const PERFIL = "11111111-1111-4111-8111-111111111111";

const TIME: DirectoryEntry[] = [
  { id: PERFIL, fullName: "Ana Prado", email: "ana@apcs.com.br", role: "admin" },
];

const CATALOGO = [{ id: "c1", name: "Dr. Marcelo Ribeiro" }];

type Palestra = Pick<Lecture, "id" | "name" | "responsible" | "speaker" | "speakerCatalog">;

const BASE: Palestra = {
  id: ID,
  name: "Manejo sanitário",
  responsible: null,
  speaker: null,
  speakerCatalog: null,
};

async function abrir(user: ReturnType<typeof userEvent.setup>, lecture: Palestra = BASE) {
  render(
    <LectureAssignDialog
      lecture={lecture}
      field="speaker"
      directory={TIME}
      speakers={CATALOGO}
      onDone={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: /palestrante/i }));
}

beforeEach(() => {
  assignLectureSpeakerAction.mockReset();
  assignLectureSpeakerAction.mockResolvedValue({ ok: true, data: { id: ID } });
  assignLectureResponsibleAction.mockReset();
  assignLectureResponsibleAction.mockResolvedValue({ ok: true, data: { id: ID } });
});

describe("trocar o palestrante", () => {
  /**
   * ⚠️ O DEFEITO QUE ESTE TESTE IMPEDE, e que seria silencioso: um palestrante
   * de fora mora em `speakerCatalog`, não em `speaker`. Se o diálogo olhasse só
   * `speaker`, ele abriria com "Ninguém" marcado numa palestra que TEM
   * palestrante — e confirmar sem tocar em nada apagaria o que estava lá.
   */
  it("abre com o palestrante de fora já marcado", async () => {
    const user = userEvent.setup();
    await abrir(user, { ...BASE, speakerCatalog: { id: "c1", name: "Dr. Marcelo Ribeiro" } });

    expect(screen.getByRole("radio", { name: /Dr\. Marcelo Ribeiro/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Ninguém/ })).not.toBeChecked();
  });

  it("o botão diz TROCAR quando já existe um palestrante de fora", () => {
    render(
      <LectureAssignDialog
        lecture={{ ...BASE, speakerCatalog: { id: "c1", name: "Dr. Marcelo Ribeiro" } }}
        field="speaker"
        directory={TIME}
        speakers={CATALOGO}
        onDone={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Trocar palestrante" })).toBeInTheDocument();
  });

  it("um nome novo chega à action como nome, sem perfil", async () => {
    const user = userEvent.setup();
    await abrir(user);

    await user.click(screen.getByRole("radio", { name: /Outro/ }));
    await user.type(screen.getByLabelText("Nome do palestrante"), "Dra. Helena Costa");
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(assignLectureSpeakerAction).toHaveBeenCalledWith({
      lectureId: ID,
      profileId: "",
      speakerName: "Dra. Helena Costa",
    });
  });

  it("escolher alguém do time manda o perfil e nenhum nome", async () => {
    const user = userEvent.setup();
    await abrir(user);

    await user.click(screen.getByRole("radio", { name: /Ana Prado/ }));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(assignLectureSpeakerAction).toHaveBeenCalledWith({
      lectureId: ID,
      profileId: PERFIL,
      speakerName: "",
    });
  });

  it("OUTRO em branco não vai ao servidor", async () => {
    const user = userEvent.setup();
    await abrir(user);

    await user.click(screen.getByRole("radio", { name: /Outro/ }));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Informe o nome do palestrante.");
    expect(assignLectureSpeakerAction).not.toHaveBeenCalled();
  });

  it('"Ninguém" continua sendo o jeito de DESATRIBUIR', async () => {
    const user = userEvent.setup();
    await abrir(user, { ...BASE, speakerCatalog: { id: "c1", name: "Dr. Marcelo Ribeiro" } });

    await user.click(screen.getByRole("radio", { name: /Ninguém/ }));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(assignLectureSpeakerAction).toHaveBeenCalledWith({
      lectureId: ID,
      profileId: "",
      speakerName: "",
    });
  });
});

describe("o mesmo diálogo para responsável", () => {
  /**
   * ⚠️ Responsável é quem responde pela palestra DENTRO da APCS: precisa de
   * conta. Oferecer "Outro" aqui criaria um responsável que ninguém pode
   * cobrar — e a action nem tem para onde mandar o nome.
   */
  it("não oferece catálogo nem OUTRO", async () => {
    const user = userEvent.setup();
    render(
      <LectureAssignDialog
        lecture={BASE}
        field="responsible"
        directory={TIME}
        speakers={CATALOGO}
        onDone={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Definir responsável" }));

    expect(screen.queryByRole("radio", { name: /Outro/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Dr\. Marcelo/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Ana Prado/ })).toBeInTheDocument();
  });
});
