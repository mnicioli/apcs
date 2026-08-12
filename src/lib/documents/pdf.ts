import { PDFDocument } from "pdf-lib";

/**
 * A validação que decide se um arquivo entra no acervo.
 *
 * Sem `server-only` de propósito: a função é pura (recebe bytes, devolve um
 * código) e não lê ambiente nem toca em segredo. Quem faz a barreira de
 * servidor é quem baixa o arquivo do bucket — `src/lib/actions/documents.ts`.
 * Marcar aqui só impediria o teste de rodar. Mesmo raciocínio de
 * `src/lib/chat/env.ts`.
 *
 * POR QUE ISTO EXISTE: a extensão `.pdf` e o `Content-Type` do navegador são
 * informados por quem envia — renomear um `.docx` para `.pdf` engana os dois.
 * A única prova de que o arquivo é um PDF é abri-lo.
 */

/** O mesmo vocabulário de `document.schema.ts`, mais o que só o servidor vê. */
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
