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

  /**
   * PDF ESCANEADO — só imagem, sem uma letra de texto extraível.
   *
   * É o caso mais comum de boletim de preço que chega por e-mail, e ele TEM de
   * passar: a checagem é estrutural, não de conteúdo. Exigir camada de texto
   * recusaria metade dos arquivos reais e empurraria OCR para dentro de um
   * módulo que não é disso.
   */
  it("aceita PDF composto SÓ por imagem, sem camada de texto", async () => {
    const documento = await PDFDocument.create();
    const pagina = documento.addPage([200, 200]);

    // PNG mínimo de 1x1 pixel, montado byte a byte para não trazer fixture
    // binária ao repositório.
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    );

    const imagem = await documento.embedPng(png);
    pagina.drawImage(imagem, { x: 0, y: 0, width: 200, height: 200 });

    expect(await inspectPdf(await documento.save())).toBeNull();
  });

  it("recusa PDF protegido por senha", async () => {
    const cifrado = buildPdf([CATALOG, PAGES, PAGE, ENCRYPT_DICT], " /Encrypt 4 0 R");
    expect(await inspectPdf(cifrado)).toBe("fileEncrypted");
  });

  /**
   * MIME SPOOFING com cabeçalhos REAIS.
   *
   * Renomear muda a extensão e o `Content-Type` que o navegador declara — os
   * dois campos que a tela usa. Não muda os primeiros bytes, e é por isso que
   * a decisão final é tomada sobre eles.
   */
  it("recusa executável, ZIP e DOCX renomeados para .pdf", async () => {
    // MZ — cabeçalho de executável Windows (PE).
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...new Array(64).fill(0)]);
    // PK\x03\x04 — cabeçalho ZIP, que é também o de DOCX/XLSX/PPTX.
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(64).fill(0)]);

    expect(await inspectPdf(exe)).toBe("fileNotPdf");
    expect(await inspectPdf(zip)).toBe("fileNotPdf");
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
