import {
  IMAGE_EXTENSION_MIME,
  MAX_IMAGE_SIZE_BYTES,
  imageExtensionOf,
  type AcceptedImageMime,
} from "@/modules/event/event.schema";

/**
 * O que o arquivo REALMENTE é — apurado nos bytes, não no que o cliente disse.
 *
 * Extensão e MIME declarado são texto que veio de fora: renomear `virus.exe`
 * para `cartaz.png` muda os dois. O cabeçalho do arquivo, não.
 *
 * Sem dependência nova de propósito: uma biblioteca de imagem (sharp, jimp)
 * traria binário nativo e alguns megabytes para responder uma pergunta que
 * cabe em doze bytes.
 */

export type ImageIssue = "fileNotImage" | "fileTooLarge";

export type ImageInspection =
  | { ok: true; mime: AcceptedImageMime }
  | { ok: false; issue: ImageIssue };

/**
 * As assinaturas dos três formatos aceitos.
 *
 * JPEG  FF D8 FF                    (SOI + o primeiro marcador)
 * PNG   89 50 4E 47 0D 0A 1A 0A     (a assinatura de 8 bytes da spec)
 * WEBP  "RIFF" ???? "WEBP"          (contêiner RIFF; o tipo vem no byte 8)
 */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** O MIME que os bytes declaram, ou `null` se não for um dos três aceitos. */
export function detectImageMime(bytes: Uint8Array): AcceptedImageMime | null {
  if (startsWith(bytes, JPEG_SIGNATURE)) return "image/jpeg";
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";

  // O RIFF tem o tamanho nos bytes 4–7 e o tipo do contêiner nos 8–11. Só
  // "RIFF" não basta: WAV e AVI usam o mesmo contêiner.
  if (asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") return "image/webp";

  return null;
}

/**
 * Examina os bytes que chegaram ao servidor.
 *
 * A REGRA: os bytes mandam, e a extensão tem de concordar com eles. Um `.png`
 * que na verdade é JPEG é recusado. Poderia ser aceito gravando o MIME real,
 * mas então o caminho no bucket terminaria em `.png` para um JPEG — e uma regra
 * só, sem exceção, é mais fácil de confiar do que duas com uma ressalva.
 *
 * LIMITE HONESTO: isto prova o CABEÇALHO, não o arquivo inteiro. Um PNG com
 * assinatura válida e corpo truncado passa por aqui e falha no navegador de
 * quem for abrir. Decodificar de verdade exigiria a dependência que este módulo
 * evita; as outras barreiras (tamanho, bucket, CHECK) continuam de pé.
 */
export function inspectImage(bytes: Uint8Array, filename: string): ImageInspection {
  if (bytes.length === 0) return { ok: false, issue: "fileNotImage" };
  if (bytes.length > MAX_IMAGE_SIZE_BYTES) return { ok: false, issue: "fileTooLarge" };

  const extension = imageExtensionOf(filename);
  const expected = extension ? IMAGE_EXTENSION_MIME[extension] : undefined;
  if (!expected) return { ok: false, issue: "fileNotImage" };

  const detected = detectImageMime(bytes);
  if (!detected || detected !== expected) return { ok: false, issue: "fileNotImage" };

  return { ok: true, mime: detected };
}
