import { describe, expect, it } from "vitest";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { MARKET_DEACTIVATE_BLOCKED } from "./market.labels";
import {
  bulletinFormSchema,
  createVersionSchema,
  effectiveDateSchema,
  fileUrlSchema,
  MAX_IMAGE_SIZE_BYTES,
  MAX_PDF_SIZE_BYTES,
  updateBulletinSchema,
  uploadTicketSchema,
  validateImageCandidate,
  validatePdfCandidate,
  versionCommandSchema,
} from "./market.schema";

const UUID = "11111111-1111-1111-1111-111111111111";
const OUTRO_UUID = "22222222-2222-2222-2222-222222222222";

describe("bulletinFormSchema — o cadastro da Bolsa", () => {
  it("aceita o mínimo: só o nome", () => {
    const r = bulletinFormSchema.safeParse({ name: "Bolsa de Suínos" });
    expect(r.success).toBe(true);
  });

  it("nome é obrigatório", () => {
    expect(bulletinFormSchema.safeParse({ name: "" }).success).toBe(false);
    expect(bulletinFormSchema.safeParse({ name: "A" }).success).toBe(false);
  });

  /**
   * O CHECK `market_bulletins_name_trimmed` recusa nome com espaço nas pontas.
   * O schema apara ANTES, então o que chega ao banco já está limpo — e um nome
   * só de espaços cai no mínimo de 2 caracteres.
   */
  it("apara espaços e recusa nome que só tem espaço", () => {
    const r = bulletinFormSchema.safeParse({ name: "  Bolsa de Suínos  " });
    expect(r.success && r.data.name).toBe("Bolsa de Suínos");

    expect(bulletinFormSchema.safeParse({ name: "     " }).success).toBe(false);
  });

  it("recusa nome acima do limite da coluna", () => {
    expect(bulletinFormSchema.safeParse({ name: "a".repeat(161) }).success).toBe(false);
    expect(bulletinFormSchema.safeParse({ name: "a".repeat(160) }).success).toBe(true);
  });

  it("descrição é opcional e limitada", () => {
    expect(bulletinFormSchema.safeParse({ name: "Bolsa", description: "" }).success).toBe(true);
    expect(
      bulletinFormSchema.safeParse({ name: "Bolsa", description: "a".repeat(2001) }).success,
    ).toBe(false);
  });

  /**
   * A decisão de MVP, explícita no contrato: uma Bolsa nasce visível para o
   * chatbot. Se isso mudar, este teste é o lugar onde a mudança aparece.
   */
  it("chatbotEnabled nasce LIGADO quando não informado", () => {
    const r = bulletinFormSchema.safeParse({ name: "Bolsa de Suínos" });
    expect(r.success && r.data.chatbotEnabled).toBe(true);
  });

  it("chatbotEnabled pode ser desligado no cadastro", () => {
    const r = bulletinFormSchema.safeParse({ name: "Bolsa", chatbotEnabled: false });
    expect(r.success && r.data.chatbotEnabled).toBe(false);
  });
});

describe("effectiveDateSchema — passado, hoje e futuro são todos válidos", () => {
  it("aceita data no passado", () => {
    expect(effectiveDateSchema.safeParse("2020-01-15").success).toBe(true);
  });

  it("aceita data no futuro", () => {
    expect(effectiveDateSchema.safeParse("2030-12-31").success).toBe(true);
  });

  /** A regex sozinha aprova "2026-02-31"; o `refine` é o que separa uma data
   * possível de uma que só parece uma data. */
  it("recusa data que não existe no calendário", () => {
    expect(effectiveDateSchema.safeParse("2026-02-31").success).toBe(false);
    expect(effectiveDateSchema.safeParse("2026-13-01").success).toBe(false);
  });

  it("recusa formato que não é AAAA-MM-DD", () => {
    expect(effectiveDateSchema.safeParse("12/08/2026").success).toBe(false);
    expect(effectiveDateSchema.safeParse("").success).toBe(false);
  });
});

describe("createVersionSchema — o par imagem+PDF é indivisível", () => {
  const completo = {
    bulletinId: UUID,
    versionId: OUTRO_UUID,
    effectiveDate: "2026-08-12",
    imagePath: `${UUID}/${OUTRO_UUID}/image/a.jpg`,
    imageFilename: "bolsa.jpg",
    pdfPath: `${UUID}/${OUTRO_UUID}/pdf/a.pdf`,
    pdfFilename: "bolsa.pdf",
  };

  it("aceita a publicação completa", () => {
    expect(createVersionSchema.safeParse(completo).success).toBe(true);
  });

  it("recusa publicação SEM a imagem", () => {
    const { imagePath: _p, imageFilename: _f, ...semImagem } = completo;
    expect(createVersionSchema.safeParse(semImagem).success).toBe(false);
  });

  it("recusa publicação SEM o PDF", () => {
    const { pdfPath: _p, pdfFilename: _f, ...semPdf } = completo;
    expect(createVersionSchema.safeParse(semPdf).success).toBe(false);
  });

  it("recusa id que não é uuid", () => {
    expect(createVersionSchema.safeParse({ ...completo, bulletinId: "abc" }).success).toBe(false);
  });
});

describe("validateImageCandidate — o que o navegador já dá para conferir", () => {
  function arquivo(overrides: Partial<{ name: string; size: number; type: string }> = {}) {
    return { name: "bolsa.jpg", size: 1024, type: "image/jpeg", ...overrides };
  }

  it("aceita os quatro formatos permitidos", () => {
    for (const nome of ["b.jpg", "b.jpeg", "b.png", "b.webp"]) {
      expect(validateImageCandidate(arquivo({ name: nome, type: "" }))).toBeNull();
    }
  });

  it("recusa GIF, BMP, TIFF e SVG", () => {
    for (const nome of ["b.gif", "b.bmp", "b.tiff", "b.svg"]) {
      expect(validateImageCandidate(arquivo({ name: nome, type: "" }))).toBe("fileNotImage");
    }
  });

  it("5 MB exatos passam; 5 MB + 1 byte não", () => {
    expect(validateImageCandidate(arquivo({ size: MAX_IMAGE_SIZE_BYTES }))).toBeNull();
    expect(validateImageCandidate(arquivo({ size: MAX_IMAGE_SIZE_BYTES + 1 }))).toBe(
      "fileTooLarge",
    );
  });

  it("o limite é 5 MB em bytes", () => {
    expect(MAX_IMAGE_SIZE_BYTES).toBe(5_242_880);
  });
});

describe("validatePdfCandidate", () => {
  function arquivo(overrides: Partial<{ name: string; size: number; type: string }> = {}) {
    return { name: "bolsa.pdf", size: 1024, type: "application/pdf", ...overrides };
  }

  it("aceita PDF", () => {
    expect(validatePdfCandidate(arquivo())).toBeNull();
  });

  it("recusa os formatos de escritório", () => {
    for (const nome of [
      "a.doc",
      "a.docx",
      "a.xls",
      "a.xlsx",
      "a.ppt",
      "a.pptx",
      "a.txt",
      "a.zip",
    ]) {
      expect(validatePdfCandidate(arquivo({ name: nome, type: "" }))).toBe("fileNotPdf");
    }
  });

  it("5 MB exatos passam; 5 MB + 1 byte não", () => {
    expect(validatePdfCandidate(arquivo({ size: MAX_PDF_SIZE_BYTES }))).toBeNull();
    expect(validatePdfCandidate(arquivo({ size: MAX_PDF_SIZE_BYTES + 1 }))).toBe("fileTooLarge");
  });

  it("o limite é 5 MB em bytes", () => {
    expect(MAX_PDF_SIZE_BYTES).toBe(5_242_880);
  });
});

describe("comandos e leitura de arquivo", () => {
  it("ativar e inativar carregam a Bolsa junto, para o servidor poder recusar a troca de dono", () => {
    const r = versionCommandSchema.safeParse({
      bulletinId: UUID,
      versionId: OUTRO_UUID,
      command: "activate",
    });
    expect(r.success).toBe(true);
  });

  it("recusa comando que não existe", () => {
    const r = versionCommandSchema.safeParse({
      bulletinId: UUID,
      versionId: OUTRO_UUID,
      command: "delete",
    });
    expect(r.success).toBe(false);
  });

  it("a URL assinada precisa saber QUAL arquivo e em que modo", () => {
    expect(
      fileUrlSchema.safeParse({ versionId: UUID, kind: "pdf", mode: "download" }).success,
    ).toBe(true);
    expect(fileUrlSchema.safeParse({ versionId: UUID, kind: "image", mode: "view" }).success).toBe(
      true,
    );
    expect(fileUrlSchema.safeParse({ versionId: UUID, kind: "docx", mode: "view" }).success).toBe(
      false,
    );
  });

  it("o ticket de upload exige a Bolsa, a publicação e o tipo do arquivo", () => {
    const r = uploadTicketSchema.safeParse({
      bulletinId: UUID,
      versionId: OUTRO_UUID,
      kind: "image",
      filename: "bolsa.jpg",
      sizeBytes: 1024,
    });
    expect(r.success).toBe(true);
  });

  it("a edição do cadastro exige o id da Bolsa", () => {
    expect(updateBulletinSchema.safeParse({ name: "Bolsa" }).success).toBe(false);
    expect(updateBulletinSchema.safeParse({ bulletinId: UUID, name: "Bolsa" }).success).toBe(true);
  });
});

/**
 * Duas mensagens diferentes para a mesma regra é como o usuário descobre que o
 * formulário e o servidor discordam. O texto do rótulo e o texto do erro da
 * action precisam ser o MESMO.
 */
describe("mensagens", () => {
  it("o aviso da tela e o erro do servidor dizem a mesma coisa sobre inativar", () => {
    expect(ACTION_ERROR_MESSAGES.bulletinNeedsActiveVersion).toBe(MARKET_DEACTIVATE_BLOCKED);
  });
});
