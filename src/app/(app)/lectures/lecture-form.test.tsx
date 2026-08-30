import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DirectoryEntry } from "@/lib/services/profile";
import { LectureForm } from "./lecture-form";

const createLectureAction = vi.hoisted(() => vi.fn());
const updateLectureAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/lectures", () => ({ createLectureAction, updateLectureAction }));

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, back: vi.fn() }) }));

const TIME: DirectoryEntry[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    fullName: "Ana Prado",
    email: "ana@apcs.com.br",
    role: "admin",
  },
];

const CATALOGO = [{ id: "c1", name: "Dr. Marcelo Ribeiro" }];

function montar() {
  return render(<LectureForm directory={TIME} speakers={CATALOGO} />);
}

/**
 * Preenche só o obrigatório, para o envio chegar à validação do palestrante.
 *
 * ⚠️ Busca pelo atributo `name` e não pelo rótulo: o formulário tem DOIS campos
 * chamados "Nome" — o da palestra e o de quem solicitou —, e um seletor por
 * texto pegaria os dois.
 */
async function preencherMinimo(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  const campo = (nome: string) => {
    const alvo = container.querySelector<HTMLInputElement>(`[name="${nome}"]`);
    if (!alvo) throw new Error(`campo ${nome} não encontrado`);
    return alvo;
  };

  await user.type(campo("name"), "Manejo sanitário");
  await user.type(campo("theme"), "Prevenção em granjas");
  await user.type(campo("city"), "Espírito Santo do Pinhal");
  await user.type(campo("eventDate"), "2026-09-10");
}

beforeEach(() => {
  createLectureAction.mockReset();
  createLectureAction.mockResolvedValue({ ok: true, data: { id: "l1", conflicts: [] } });
  push.mockReset();
});

describe("seletor de palestrante (§20)", () => {
  it("lista o catálogo, o time e a saída para um nome novo", () => {
    montar();

    const seletor = screen.getByLabelText("Palestrante");
    const opcoes = within(seletor)
      .getAllByRole("option")
      .map((o) => o.textContent);

    expect(opcoes).toEqual([
      "Não definido",
      "Dr. Marcelo Ribeiro",
      "Ana Prado",
      "Outro (digitar o nome)…",
    ]);
  });

  it("o campo de nome só aparece quando a escolha é OUTRO", async () => {
    const user = userEvent.setup();
    montar();

    expect(screen.queryByLabelText(/Nome do palestrante/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Palestrante"), "novo");
    expect(screen.getByLabelText(/Nome do palestrante/)).toBeInTheDocument();
  });

  /**
   * ⚠️ O caso que faria a palestra nascer SEM palestrante: escolher "Outro" e
   * deixar o campo em branco. Sem esta checagem, o formulário enviaria feliz e
   * a pessoa só descobriria na tela de detalhe — quando o registro já existe,
   * com protocolo e tudo.
   */
  it("OUTRO com o nome em branco não vai ao servidor", async () => {
    const user = userEvent.setup();
    const { container } = montar();

    await preencherMinimo(user, container);
    await user.selectOptions(screen.getByLabelText("Palestrante"), "novo");
    await user.click(screen.getByRole("button", { name: "Cadastrar palestra" }));

    expect(await screen.findByText("Informe o nome do palestrante.")).toBeInTheDocument();
    expect(createLectureAction).not.toHaveBeenCalled();
  });

  it("um nome novo viaja como nome, e não como id de perfil", async () => {
    const user = userEvent.setup();
    const { container } = montar();

    await preencherMinimo(user, container);
    await user.selectOptions(screen.getByLabelText("Palestrante"), "novo");
    await user.type(screen.getByLabelText(/Nome do palestrante/), "Dra. Helena Costa");
    await user.click(screen.getByRole("button", { name: "Cadastrar palestra" }));

    expect(createLectureAction).toHaveBeenCalledWith(
      expect.objectContaining({ speakerId: "", speakerName: "Dra. Helena Costa" }),
    );
  });

  /**
   * ⚠️ Escolher alguém que JÁ ESTÁ no catálogo manda o NOME, não o id da linha.
   * Parece desperdício e é o contrário: o banco resolve nome → linha pela chave
   * normalizada, então existe UM caminho para gravar palestrante externo em vez
   * de dois que precisariam concordar para sempre.
   */
  it("um nome do catálogo também viaja como nome", async () => {
    const user = userEvent.setup();
    const { container } = montar();

    await preencherMinimo(user, container);
    await user.selectOptions(screen.getByLabelText("Palestrante"), "c:Dr. Marcelo Ribeiro");
    await user.click(screen.getByRole("button", { name: "Cadastrar palestra" }));

    expect(createLectureAction).toHaveBeenCalledWith(
      expect.objectContaining({ speakerId: "", speakerName: "Dr. Marcelo Ribeiro" }),
    );
  });

  it("alguém do time viaja como id de perfil, com o nome vazio", async () => {
    const user = userEvent.setup();
    const { container } = montar();

    await preencherMinimo(user, container);
    await user.selectOptions(
      screen.getByLabelText("Palestrante"),
      "p:11111111-1111-4111-8111-111111111111",
    );
    await user.click(screen.getByRole("button", { name: "Cadastrar palestra" }));

    expect(createLectureAction).toHaveBeenCalledWith(
      expect.objectContaining({
        speakerId: "11111111-1111-4111-8111-111111111111",
        speakerName: "",
      }),
    );
  });
});

describe("horário na grade de 5 minutos", () => {
  /**
   * O `<input type="time">` com `step` continuava listando os sessenta minutos:
   * `step` é validação do navegador, não desenho da lista. A tela oferecia 14:56
   * e o Zod recusava logo depois.
   */
  it("o minuto só oferece a grade de cinco em cinco", () => {
    montar();

    const minutos = within(screen.getByLabelText("Hora de início — minuto"))
      .getAllByRole("option")
      .map((o) => o.textContent)
      .filter((t) => t !== "--");

    expect(minutos).toEqual([
      "00",
      "05",
      "10",
      "15",
      "20",
      "25",
      "30",
      "35",
      "40",
      "45",
      "50",
      "55",
    ]);
  });

  it("a dica 'De 5 em 5 minutos' saiu — a lista já é a regra", () => {
    montar();
    expect(screen.queryByText(/5 em 5 minutos/)).not.toBeInTheDocument();
  });
});

describe("placeholder da cidade", () => {
  it("sugere a cidade da APCS", () => {
    const { container } = montar();
    expect(container.querySelector('[name="city"]')).toHaveAttribute(
      "placeholder",
      "Espírito Santo do Pinhal",
    );
  });
});
