import { PDFDocument } from "pdf-lib";

/**
 * O que a plataforma sabe sobre PDF — limite de tamanho, formato aceito e como
 * provar que um arquivo é mesmo um PDF utilizável.
 *
 * Vive em `src/lib/files/` e não dentro de um módulo porque Documentos e Bolsa
 * fazem a MESMA pergunta sobre o mesmo formato. Duas cópias divergiriam no dia
 * em que uma delas mudasse o limite, e aí o mesmo arquivo seria aceito numa
 * tela e recusado na outra.
 *
 * Sem `server-only` de propósito: as funções são puras (recebem bytes ou
 * metadados, devolvem um código) e não leem ambiente nem tocam em segredo. Quem
 * faz a barreira de servidor é quem baixa o arquivo do bucket. Marcar aqui só
 * impediria o teste de rodar. Mesmo raciocínio de `src/lib/chat/env.ts`.
 *
 * POR QUE `inspectPdf` EXISTE: a extensão `.pdf` e o `Content-Type` do
 * navegador são informados por quem envia — renomear um `.docx` para `.pdf`
 * engana os dois. A única prova de que o arquivo é um PDF é abri-lo.
 */

/**
 * 5 MB exatos. O escopo é explícito: um arquivo com exatamente 5 MB deve ser
 * ACEITO, então a comparação é `<=`, nunca `<`.
 */
export const MAX_PDF_SIZE_BYTES = 5 * 1024 * 1024;

export const PDF_MIME_TYPE = "application/pdf";
export const PDF_EXTENSION = ".pdf";

/**
 * O que há de errado com o PDF escolhido, olhando só o que o navegador informa
 * — ou `null` se estiver tudo bem.
 *
 * DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT e ZIP caem aqui pela extensão; o que
 * passar por ter sido renomeado é pego em `inspectPdf`, sobre os bytes.
 */
export type PdfUploadIssue = "fileNotPdf" | "fileTooLarge";

export function validatePdfCandidate(file: {
  name: string;
  size: number;
  type: string;
}): PdfUploadIssue | null {
  const hasPdfExtension = file.name.toLowerCase().endsWith(PDF_EXTENSION);
  // `type` vem vazio em alguns navegadores/sistemas; nesse caso a extensão é o
  // que sobra. Reprovar por MIME ausente barraria upload legítimo, e a
  // verificação que vale mesmo acontece no servidor.
  const hasPdfMime = file.type === "" || file.type === PDF_MIME_TYPE;
  if (!hasPdfExtension || !hasPdfMime) return "fileNotPdf";

  // Arquivo vazio é "não é PDF", não "é grande demais": nenhum PDF tem zero
  // bytes, e dizer o contrário mandaria a pessoa procurar um problema de
  // tamanho que não existe.
  if (file.size <= 0) return "fileNotPdf";
  if (file.size > MAX_PDF_SIZE_BYTES) return "fileTooLarge";

  return null;
}

/** O vocabulário do candidato, mais o que só o servidor descobre. */
export type PdfIssue = "fileNotPdf" | "fileEncrypted";

const PDF_HEADER = "%PDF-";

/**
 * A norma manda o `%PDF-` no byte zero, mas leitores reais toleram até 1024
 * bytes de lixo antes dele — e arquivo exportado por sistema antigo às vezes
 * tem. Procurar na janela inicial evita recusar documento legítimo.
 */
const HEADER_SEARCH_WINDOW = 1024;

/** Índice da primeira ocorrência de `needle` (ASCII) em `haystack`. */
function indexOfAscii(haystack: Uint8Array, needle: string, limit = haystack.length): number {
  const target = new Uint8Array(needle.length);
  for (let i = 0; i < needle.length; i += 1) target[i] = needle.charCodeAt(i);

  const last = Math.min(limit, haystack.length) - target.length;
  outer: for (let i = 0; i <= last; i += 1) {
    for (let j = 0; j < target.length; j += 1) {
      if (haystack[i + j] !== target[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * PDF protegido por senha.
 *
 * A detecção é feita nos BYTES, e não pelo tipo do erro do pdf-lib: a
 * biblioteca exporta uma classe `EncryptedPDFError`, mas o que `load()` lança de
 * fato é um `Error` comum — `instanceof` devolve `false` (verificado na versão
 * 1.17.1). Depender disso seria construir a regra em cima de um detalhe que já
 * está quebrado.
 *
 * `/Encrypt` só aparece no dicionário do trailer de documentos cifrados, e esse
 * dicionário nunca é comprimido — vale também para PDFs 1.5+ com xref stream.
 * Um falso positivo exigiria um PDF com fluxo de conteúdo descomprimido contendo
 * a string literal; nesse caso raro o arquivo é RECUSADO, que é o lado seguro
 * de errar: quem envia regrava o PDF e segue.
 */
function looksEncrypted(bytes: Uint8Array): boolean {
  return indexOfAscii(bytes, "/Encrypt") !== -1;
}

/**
 * Abre o arquivo e diz o que há de errado — ou `null` se estiver tudo certo.
 *
 * Aceita PDF de texto e PDF escaneado (item 15 do escopo): a checagem é
 * estrutural, não de conteúdo. Extração de texto e OCR são problema do pipeline
 * do chatbot, não deste módulo.
 */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfIssue | null> {
  if (bytes.length === 0) return "fileNotPdf";
  if (indexOfAscii(bytes, PDF_HEADER, HEADER_SEARCH_WINDOW) === -1) return "fileNotPdf";
  if (looksEncrypted(bytes)) return "fileEncrypted";

  try {
    const document = await PDFDocument.load(bytes);

    // `getPageCount()` dentro do try NÃO é detalhe: o pdf-lib é tolerante e
    // aceita carregar um arquivo que só tem o cabeçalho `%PDF-` seguido de
    // lixo. É ao pedir as páginas que ele estoura. Sem esta linha, um arquivo
    // com cinco bytes válidos e o resto sujo entraria no acervo como normativa.
    if (document.getPageCount() === 0) return "fileNotPdf";
  } catch (error) {
    // Rede de segurança para o caso de o pdf-lib detectar cifragem que o exame
    // de bytes não pegou. A mensagem é o único sinal disponível — por isso ela
    // é o plano B, e nunca o plano A.
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    return message.includes("encrypted") ? "fileEncrypted" : "fileNotPdf";
  }

  return null;
}
