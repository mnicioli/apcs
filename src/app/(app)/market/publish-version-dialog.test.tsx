import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MAX_IMAGE_SIZE_BYTES, MAX_PDF_SIZE_BYTES } from "@/modules/market/market.schema";
import { PublishVersionDialog } from "./publish-version-dialog";

/**
 * As actions são `"use server"` — importá-las de verdade tentaria abrir o
 * Supabase. O que está sob teste aqui é a DECISÃO DA TELA: o que ela aceita, o
 * que ela recusa antes de sair do navegador, e o que mostra na confirmação.
 */
vi.mock("@/lib/actions/market-bulletins", () => ({
  requestBulletinUploadAction: vi.fn(),
  createBulletinVersionAction: vi.fn(),
}));

const HOJE = "2026-08-12";

/**
 * Um arquivo com o tamanho declarado, sem alocar os bytes.
 *
 * Alocar 5 MB de verdade só para conferir uma comparação de `>` gastaria
 * memória para provar nada — o que a tela lê é `file.size`.
 */
function arquivo(name: string, type: string, size: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function montar(props: Partial<Parameters<typeof PublishVersionDialog>[0]> = {}) {
  return render(
    <PublishVersionDialog
      bulletinId="b1"
      bulletinName="Bolsa de Suínos"
      currentVersionName="Bolsa_01Ago26"
      today={HOJE}
      {...props}
    />,
  );
}

/** Abre o diálogo e devolve o `user` já configurado. */
async function abrir(props: Partial<Parameters<typeof PublishVersionDialog>[0]> = {}) {
  const user = userEvent.setup();
  montar(props);
  await user.click(screen.getByRole("button", { name: /Nova versão/ }));
  return user;
}

function campoImagem(): HTMLInputElement {
  return screen.getByLabelText(/^Imagem/) as HTMLInputElement;
}

function campoPdf(): HTMLInputElement {
  return screen.getByLabelText(/^PDF/) as HTMLInputElement;
}

/**
 * Entrega um arquivo à área SEM passar pelo filtro do `accept`.
 *
 * `user.upload` respeita o `accept` do input e descarta o arquivo antes de a
 * tela vê-lo — o que testaria o navegador, não o nosso código. Arrastar e
 * soltar ignora o `accept` em navegador de verdade, então este é o caminho pelo
 * qual um `.docx` realmente chega até aqui. É a validação dele que interessa.
 */
function soltar(input: HTMLInputElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

describe("as duas áreas de envio", () => {
  it("imagem e PDF têm áreas SEPARADAS", async () => {
    await abrir();

    expect(campoImagem()).toBeInTheDocument();
    expect(campoPdf()).toBeInTheDocument();
  });

  it("cada área aceita só o seu tipo", async () => {
    await abrir();

    expect(campoImagem().accept).toContain("image/jpeg");
    expect(campoImagem().accept).not.toContain("application/pdf");
    expect(campoPdf().accept).toContain("application/pdf");
  });

  /** O escopo é explícito: a versão é gerada pelo sistema, nunca digitada. */
  it("não existe campo editável de versão", async () => {
    await abrir();

    // Por PAPEL, e não por rótulo: o próprio `<dialog>` é "rotulado" pelo
    // título "Nova versão", e uma busca por texto casaria com ele.
    expect(screen.queryByRole("textbox", { name: /vers[aã]o/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /vers[aã]o/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /vers[aã]o/i })).not.toBeInTheDocument();
  });
});

describe("o que a tela recusa antes de sair do navegador", () => {
  it("sem imagem, cobra a imagem", async () => {
    const user = await abrir();
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A imagem é obrigatória.");
  });

  it("com imagem e sem PDF, cobra o PDF", async () => {
    const user = await abrir();
    await user.upload(campoImagem(), arquivo("bolsa.jpg", "image/jpeg", 1024));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("O PDF é obrigatório.");
  });

  it("com os dois arquivos e sem data, cobra a vigência", async () => {
    const user = await abrir();
    await user.upload(campoImagem(), arquivo("bolsa.jpg", "image/jpeg", 1024));
    await user.upload(campoPdf(), arquivo("bolsa.pdf", "application/pdf", 2048));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Informe a data de vigência.");
  });

  it("recusa .docx na área do PDF", async () => {
    await abrir();
    soltar(campoPdf(), arquivo("boletim.docx", "", 2048));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Apenas arquivos PDF são permitidos.",
    );
  });

  it("recusa os formatos de imagem que o escopo veta", async () => {
    await abrir();

    for (const nome of ["bolsa.gif", "bolsa.bmp", "bolsa.tiff", "bolsa.svg"]) {
      soltar(campoImagem(), arquivo(nome, "", 1024));
      expect(await screen.findByRole("alert")).toHaveTextContent(/imagem JPG, PNG ou WEBP/);
    }
  });

  it("aceita os quatro formatos de imagem permitidos", async () => {
    const user = await abrir();

    for (const [nome, tipo] of [
      ["b.jpg", "image/jpeg"],
      ["b.jpeg", "image/jpeg"],
      ["b.png", "image/png"],
      ["b.webp", "image/webp"],
    ] as const) {
      await user.upload(campoImagem(), arquivo(nome, tipo, 1024));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    }
  });
});

describe("o limite de 5 MB", () => {
  it("imagem de 5 MB exatos passa; 5 MB + 1 byte não", async () => {
    const user = await abrir();

    await user.upload(campoImagem(), arquivo("b.jpg", "image/jpeg", MAX_IMAGE_SIZE_BYTES));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.upload(campoImagem(), arquivo("b.jpg", "image/jpeg", MAX_IMAGE_SIZE_BYTES + 1));
    expect(await screen.findByRole("alert")).toHaveTextContent(/máximo de 5 MB/);
  });

  it("PDF de 5 MB exatos passa; 5 MB + 1 byte não", async () => {
    const user = await abrir();

    await user.upload(campoPdf(), arquivo("b.pdf", "application/pdf", MAX_PDF_SIZE_BYTES));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.upload(campoPdf(), arquivo("b.pdf", "application/pdf", MAX_PDF_SIZE_BYTES + 1));
    expect(await screen.findByRole("alert")).toHaveTextContent(/máximo de 5 MB/);
  });
});

describe("a confirmação", () => {
  async function chegarNaConfirmacao(
    props: Partial<Parameters<typeof PublishVersionDialog>[0]> = {},
    vigencia = HOJE,
  ) {
    const user = await abrir(props);
    await user.upload(campoImagem(), arquivo("bolsa.jpg", "image/jpeg", 1024));
    await user.upload(campoPdf(), arquivo("bolsa.pdf", "application/pdf", 2048));
    await user.type(screen.getByLabelText("Data de vigência"), vigencia);
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    return user;
  }

  it("mostra a identificação que o SISTEMA vai gerar", async () => {
    await chegarNaConfirmacao();
    expect(await screen.findByText("Bolsa_12Ago26")).toBeInTheDocument();
  });

  it("avisa qual publicação sai do ar", async () => {
    await chegarNaConfirmacao({ currentVersionName: "Bolsa_01Ago26" });
    expect(await screen.findByText(/Bolsa_01Ago26/)).toBeInTheDocument();
    expect(screen.getByText(/automaticamente inativada/)).toBeInTheDocument();
  });

  it("na primeira publicação não promete inativar ninguém", async () => {
    await chegarNaConfirmacao({ currentVersionName: null });
    expect(await screen.findByText(/será a primeira/)).toBeInTheDocument();
  });

  /**
   * ATIVA ≠ VIGENTE. Sem este aviso, quem publica hoje com vigência para o dia
   * 15 espera o chatbot responder agora — e ele não responde.
   */
  it("vigência futura avisa que o chatbot só cita depois", async () => {
    await chegarNaConfirmacao({}, "2026-08-20");
    expect(await screen.findByText(/só passa a citá-la em 20\/08\/2026/)).toBeInTheDocument();
  });
});
