import { describe, expect, it } from "vitest";
import {
  documentFormSchema,
  effectiveDateSchema,
  MAX_FILE_SIZE_BYTES,
  validateUploadCandidate,
  versionCommandSchema,
} from "./document.schema";

function arquivo(patch: Partial<{ name: string; size: number; type: string }> = {}) {
  return {
    name: "normativa.pdf",
    size: 1024,
    type: "application/pdf",
    ...patch,
  };
}

describe("validateUploadCandidate — tamanho", () => {
  // O item 13 é explícito: 5 MB EXATOS devem ser aceitos. Um `<` no lugar do
  // `<=` passaria despercebido em qualquer teste que usasse números redondos.
  it("aceita exatamente 5 MB", () => {
    expect(validateUploadCandidate(arquivo({ size: MAX_FILE_SIZE_BYTES }))).toBeNull();
  });

  it("recusa 1 byte acima de 5 MB", () => {
    expect(validateUploadCandidate(arquivo({ size: MAX_FILE_SIZE_BYTES + 1 }))).toBe(
      "fileTooLarge",
    );
  });

  it("o limite é em bytes reais, não em milhões", () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(5_242_880);
  });
});

describe("validateUploadCandidate — formato", () => {
  it("recusa arquivo que não é PDF", () => {
    expect(validateUploadCandidate(arquivo({ name: "planilha.xlsx", type: "" }))).toBe(
      "fileNotPdf",
    );
    expect(validateUploadCandidate(arquivo({ name: "foto.png", type: "image/png" }))).toBe(
      "fileNotPdf",
    );
  });

  // O `.docx` renomeado: extensão e MIME mentem juntos. Aqui ele passa — e é
  // por isso que a validação de verdade acontece no servidor, abrindo o arquivo.
  it("deixa passar o .docx renomeado (só o servidor descobre isso)", () => {
    expect(validateUploadCandidate(arquivo({ name: "disfarce.pdf" }))).toBeNull();
  });

  it("aceita MIME vazio, que alguns sistemas não informam", () => {
    expect(validateUploadCandidate(arquivo({ type: "" }))).toBeNull();
  });

  it("aceita extensão em maiúsculas", () => {
    expect(validateUploadCandidate(arquivo({ name: "NORMATIVA.PDF" }))).toBeNull();
  });

  // Zero byte não é "grande demais" — dizer isso mandaria a pessoa procurar um
  // problema de tamanho que não existe.
  it("trata arquivo vazio como não-PDF, e não como grande demais", () => {
    expect(validateUploadCandidate(arquivo({ size: 0 }))).toBe("fileNotPdf");
  });
});

describe("effectiveDateSchema", () => {
  it("aceita data no formato do input nativo", () => {
    expect(effectiveDateSchema.safeParse("2026-08-15").success).toBe(true);
  });

  // A regex sozinha aprovaria isto: 31 de fevereiro tem a forma de uma data.
  it("recusa data que só parece uma data", () => {
    expect(effectiveDateSchema.safeParse("2026-02-31").success).toBe(false);
    expect(effectiveDateSchema.safeParse("2026-13-01").success).toBe(false);
  });

  it("recusa o formato brasileiro, que o Postgres não aceita em coluna date", () => {
    expect(effectiveDateSchema.safeParse("15/08/2026").success).toBe(false);
  });

  // Vigência passada e futura são as duas válidas: quem manda é o status ATIVO,
  // não o calendário.
  it("aceita vigência no passado e no futuro", () => {
    expect(effectiveDateSchema.safeParse("2020-01-01").success).toBe(true);
    expect(effectiveDateSchema.safeParse("2099-12-31").success).toBe(true);
  });
});

describe("documentFormSchema", () => {
  it("exige um nome com o que se possa buscar", () => {
    expect(documentFormSchema.safeParse({ name: "C" }).success).toBe(false);
    expect(documentFormSchema.safeParse({ name: "  " }).success).toBe(false);
  });

  it("aceita o cadastro mínimo", () => {
    const parsed = documentFormSchema.safeParse({ name: "  Câmara Ambiental  " });
    expect(parsed.success && parsed.data.name).toBe("Câmara Ambiental");
  });

  it("respeita o limite de 160 do CHECK da tabela", () => {
    expect(documentFormSchema.safeParse({ name: "a".repeat(161) }).success).toBe(false);
    expect(documentFormSchema.safeParse({ name: "a".repeat(160) }).success).toBe(true);
  });
});

describe("versionCommandSchema", () => {
  it("só aceita os dois comandos previstos", () => {
    const id = "3f7c1d2e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";
    expect(versionCommandSchema.safeParse({ versionId: id, command: "activate" }).success).toBe(
      true,
    );
    // O cliente manda um COMANDO. Um payload com estado pronto não tem como
    // ser aceito — é assim que ele fica impedido de escrever a data de ativação.
    expect(
      versionCommandSchema.safeParse({ versionId: id, command: "status:active" }).success,
    ).toBe(false);
  });

  it("recusa id que não é uuid", () => {
    expect(versionCommandSchema.safeParse({ versionId: "1", command: "activate" }).success).toBe(
      false,
    );
  });
});
