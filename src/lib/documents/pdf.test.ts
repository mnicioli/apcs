import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { inspectPdf } from "./pdf";

/**
 * Monta um PDF de verdade — com tabela xref e offsets corretos — a partir dos
 * objetos. Escrever à mão é o único jeito de produzir a fixture cifrada: o
 * pdf-lib sabe LER PDF com senha, mas não sabe criar um.
 */
function buildPdf(objects: string[], trailerExtra = ""): Uint8Array {
  const header = "%PDF-1.4\n";
  const offsets: number[] = [];
  let body = "";

  for (const [i, obj] of objects.entries()) {
    offsets.push(header.length + body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }

  const xrefStart = header.length + body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;

  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${trailerExtra} >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;

  return new TextEncoder().encode(header + body + xref + trailer);
}

const CATALOG = "<< /Type /Catalog /Pages 2 0 R >>";
const PAGES = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
const PAGE = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>";
const ENCRYPT_DICT =
  "<< /Filter /Standard /V 1 /R 2 " +
  "/O <28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A> " +
  "/U <28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A> /P -1 >>";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("inspectPdf", () => {
  it("aceita um PDF válido gerado por biblioteca", async () => {
    const documento = await PDFDocument.create();
    documento.addPage();

    expect(await inspectPdf(await documento.save())).toBeNull();
  });

  it("aceita PDF montado à mão com xref correto", async () => {
    expect(await inspectPdf(buildPdf([CATALOG, PAGES, PAGE]))).toBeNull();
  });

  it("recusa PDF protegido por senha", async () => {
    const cifrado = buildPdf([CATALOG, PAGES, PAGE, ENCRYPT_DICT], " /Encrypt 4 0 R");
    expect(await inspectPdf(cifrado)).toBe("fileEncrypted");
  });

  it("recusa um arquivo de texto renomeado para .pdf", async () => {
    expect(await inspectPdf(bytes("isto aqui era um .docx ontem"))).toBe("fileNotPdf");
  });

  it("recusa arquivo vazio", async () => {
    expect(await inspectPdf(new Uint8Array(0))).toBe("fileNotPdf");
  });

  /**
   * O caso que quase passou despercebido: o pdf-lib CARREGA um arquivo que só
   * tem o cabeçalho `%PDF-` seguido de lixo. Sem pedir as páginas, ele entraria
   * no acervo como normativa válida. Se alguém remover o `getPageCount()` da
   * validação, é este teste que acende.
   */
  it("recusa arquivo que só tem o cabeçalho e lixo depois", async () => {
    expect(await inspectPdf(bytes("%PDF-1.7\nnada de PDF aqui"))).toBe("fileNotPdf");
    expect(await inspectPdf(bytes("%PDF-1.7"))).toBe("fileNotPdf");
  });

  // Precisa ser montado à mão: `PDFDocument.create()` sem `addPage()` ainda
  // relê como tendo 1 página, então não serve de fixture para este caso.
  it("recusa PDF estruturalmente válido mas sem páginas", async () => {
    const semPagina = buildPdf([CATALOG, "<< /Type /Pages /Kids [] /Count 0 >>"]);
    expect(await inspectPdf(semPagina)).toBe("fileNotPdf");
  });

  it("tolera lixo antes do cabeçalho, como leitores reais fazem", async () => {
    const original = buildPdf([CATALOG, PAGES, PAGE]);
    const comPrefixo = new Uint8Array(8 + original.length);
    comPrefixo.set(bytes("\n\n\n\n\n\n\n\n"), 0);
    comPrefixo.set(original, 8);

    expect(await inspectPdf(comPrefixo)).toBeNull();
  });

  it("não procura o cabeçalho para sempre", async () => {
    const original = buildPdf([CATALOG, PAGES, PAGE]);
    const longe = new Uint8Array(2048 + original.length);
    longe.fill(0x20);
    longe.set(original, 2048);

    expect(await inspectPdf(longe)).toBe("fileNotPdf");
  });
});
