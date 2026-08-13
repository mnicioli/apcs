/**
 * O que a plataforma sabe sobre IMAGEM — formatos aceitos, limite de tamanho e
 * como descobrir o que um arquivo realmente é.
 *
 * Vive em `src/lib/files/` e não dentro de um módulo porque Eventos e Bolsa
 * fazem a MESMA pergunta sobre os mesmos formatos. Duas cópias divergiriam no
 * dia em que uma delas passasse a aceitar AVIF, e aí um cartaz aprovado numa
 * tela seria recusado na outra.
 *
 * Sem `server-only`: as funções são puras (recebem bytes ou metadados e
 * devolvem um código) e não leem ambiente nem tocam em segredo. Quem faz a
 * barreira de servidor é quem baixa o arquivo do bucket. Marcar aqui só
 * impediria o teste de rodar — mesmo raciocínio de `src/lib/chat/env.ts`.
 */

/**
 * 5 MB exatos. O escopo dos dois módulos é explícito: um arquivo com exatamente
 * 5 MB deve ser ACEITO, então a comparação é `<=`, nunca `<`.
 *
 * Este mesmo número aparece em outros três lugares por módulo — o
 * `file_size_limit` do bucket, o CHECK da tabela e a conferência dos bytes que
 * chegaram. Quatro barreiras independentes: se uma for contornada, as outras
 * seguem de pé.
 */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Extensão → MIME que os BYTES precisam confirmar.
 *
 * O mapa é a regra inteira de tipos de imagem da plataforma, num lugar só.
 * `.jpg` e `.jpeg` apontam para o mesmo MIME porque são o mesmo formato com
 * dois nomes.
 *
 * GIF, BMP, TIFF e SVG ficam de fora. O SVG merece a menção: é XML, aceita
 * `<script>` dentro, e servido de um bucket vira execução no navegador de quem
 * abrir. Não é um formato de imagem a menos no catálogo — é uma porta fechada.
 */
export const IMAGE_EXTENSION_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const ACCEPTED_IMAGE_EXTENSIONS = Object.keys(IMAGE_EXTENSION_MIME);
export const ACCEPTED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedImageMime = (typeof ACCEPTED_IMAGE_MIMES)[number];

/** O `accept` do input de arquivo: "image/jpeg,image/png,image/webp,.jpg,..." */
export const IMAGE_ACCEPT_ATTRIBUTE = [...ACCEPTED_IMAGE_MIMES, ...ACCEPTED_IMAGE_EXTENSIONS].join(
  ",",
);

/** A extensão em minúsculas, com o ponto — ou `null` se o nome não tiver uma. */
export function imageExtensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return null;
  return filename.slice(dot).toLowerCase();
}

/**
 * O que há de errado com a imagem escolhida — ou `null` se estiver tudo bem.
 *
 * Devolve o CÓDIGO do problema, não a mensagem: assim o campo de upload e a
 * action chegam à mesma conclusão a partir da mesma função, e o texto vem de um
 * lugar só (`ACTION_ERROR_MESSAGES`). Duas validações com dois textos diferentes
 * para o mesmo arquivo é como o usuário descobre que o sistema se contradiz.
 *
 * Aqui só dá para checar o que o navegador informa. Se o arquivo é MESMO uma
 * imagem, só o servidor descobre — ver `inspectImage`.
 */
export type ImageUploadIssue = "fileNotImage" | "fileTooLarge";

export function validateImageCandidate(file: {
  name: string;
  size: number;
  type: string;
}): ImageUploadIssue | null {
  const extension = imageExtensionOf(file.name);
  if (!extension || !(extension in IMAGE_EXTENSION_MIME)) return "fileNotImage";

  // `type` vem vazio em alguns navegadores/sistemas; nesse caso a extensão é o
  // que sobra. Reprovar por MIME ausente barraria upload legítimo, e a
  // verificação que vale mesmo acontece no servidor, sobre os bytes.
  const declared = file.type;
  if (declared !== "" && !(ACCEPTED_IMAGE_MIMES as readonly string[]).includes(declared)) {
    return "fileNotImage";
  }

  // Arquivo vazio é "não é imagem", não "é grande demais": nenhuma imagem tem
  // zero bytes, e dizer o contrário mandaria a pessoa procurar um problema de
  // tamanho que não existe.
  if (file.size <= 0) return "fileNotImage";
  if (file.size > MAX_IMAGE_SIZE_BYTES) return "fileTooLarge";

  return null;
}

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
export type ImageIssue = ImageUploadIssue;

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
