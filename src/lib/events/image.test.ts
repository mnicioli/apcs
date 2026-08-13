import { describe, expect, it } from "vitest";
import { MAX_IMAGE_SIZE_BYTES } from "@/modules/event/event.schema";
import { detectImageMime, inspectImage } from "./image";

/**
 * Os cabeçalhos são montados à mão, byte a byte, de propósito: o que está sob
 * teste é exatamente a leitura da assinatura do arquivo, e uma biblioteca
 * gerando a imagem esconderia o que interessa.
 */
function comCabecalho(assinatura: number[], corpo = 64): Uint8Array {
  const bytes = new Uint8Array(assinatura.length + corpo);
  bytes.set(assinatura, 0);
  return bytes;
}

const JPEG = comCabecalho([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = comCabecalho([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** "RIFF" + tamanho (4 bytes) + "WEBP" + "VP8 ". */
const WEBP = comCabecalho([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);

/** Mesmo contêiner RIFF do WEBP, mas é um WAV. Só "RIFF" não basta. */
const WAV = comCabecalho([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
]);

const PDF = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n");
const TEXTO = new TextEncoder().encode("isto aqui é só um texto renomeado");

describe("detectImageMime", () => {
  it("reconhece JPEG, PNG e WEBP pelos bytes", () => {
    expect(detectImageMime(JPEG)).toBe("image/jpeg");
    expect(detectImageMime(PNG)).toBe("image/png");
    expect(detectImageMime(WEBP)).toBe("image/webp");
  });

  // WAV e AVI usam o mesmo contêiner RIFF do WEBP. Aceitar qualquer "RIFF"
  // deixaria passar um áudio com nome de cartaz.
  it("não confunde um WAV com um WEBP", () => {
    expect(detectImageMime(WAV)).toBeNull();
  });

  it("não reconhece PDF nem texto", () => {
    expect(detectImageMime(PDF)).toBeNull();
    expect(detectImageMime(TEXTO)).toBeNull();
  });

  it("não estoura com poucos bytes", () => {
    expect(detectImageMime(new Uint8Array([0xff]))).toBeNull();
    expect(detectImageMime(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull();
    expect(detectImageMime(new Uint8Array())).toBeNull();
  });
});

describe("inspectImage", () => {
  it("aceita os quatro formatos permitidos", () => {
    expect(inspectImage(JPEG, "e/1.jpg")).toEqual({ ok: true, mime: "image/jpeg" });
    expect(inspectImage(JPEG, "e/1.jpeg")).toEqual({ ok: true, mime: "image/jpeg" });
    expect(inspectImage(PNG, "e/1.png")).toEqual({ ok: true, mime: "image/png" });
    expect(inspectImage(WEBP, "e/1.webp")).toEqual({ ok: true, mime: "image/webp" });
  });

  // ⚠️ O caso que a validação existe para pegar: o nome diz uma coisa e o
  // conteúdo diz outra. Os bytes mandam.
  it("recusa um arquivo cujos bytes discordam da extensão", () => {
    expect(inspectImage(JPEG, "e/1.png")).toEqual({ ok: false, issue: "fileNotImage" });
    expect(inspectImage(PNG, "e/1.webp")).toEqual({ ok: false, issue: "fileNotImage" });
  });

  it("recusa um texto renomeado para .png", () => {
    expect(inspectImage(TEXTO, "e/1.png")).toEqual({ ok: false, issue: "fileNotImage" });
  });

  it("recusa um PDF renomeado para .jpg", () => {
    expect(inspectImage(PDF, "e/1.jpg")).toEqual({ ok: false, issue: "fileNotImage" });
  });

  it("recusa extensão fora da lista mesmo com bytes de imagem", () => {
    expect(inspectImage(JPEG, "e/1.gif")).toEqual({ ok: false, issue: "fileNotImage" });
    expect(inspectImage(JPEG, "e/1")).toEqual({ ok: false, issue: "fileNotImage" });
  });

  it("recusa arquivo vazio", () => {
    expect(inspectImage(new Uint8Array(), "e/1.jpg")).toEqual({
      ok: false,
      issue: "fileNotImage",
    });
  });

  it("aceita EXATAMENTE 5 MB", () => {
    const noLimite = new Uint8Array(MAX_IMAGE_SIZE_BYTES);
    noLimite.set([0xff, 0xd8, 0xff], 0);
    expect(inspectImage(noLimite, "e/1.jpg")).toEqual({ ok: true, mime: "image/jpeg" });
  });

  it("recusa 5 MB mais um byte", () => {
    const acima = new Uint8Array(MAX_IMAGE_SIZE_BYTES + 1);
    acima.set([0xff, 0xd8, 0xff], 0);
    expect(inspectImage(acima, "e/1.jpg")).toEqual({ ok: false, issue: "fileTooLarge" });
  });
});
