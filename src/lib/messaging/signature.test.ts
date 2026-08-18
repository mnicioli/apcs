import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { safeCompare, verifyHmacSignature } from "./signature";

/**
 * §18 e §80. A ASSINATURA DO WEBHOOK.
 *
 * ⚠️ Este é o arquivo que impede que qualquer pessoa na internet registre
 * respostas em nome de associados. Um webhook sem assinatura conferida é um
 * formulário público de fraude de enquete.
 */

const SEGREDO = "segredo-do-app-da-meta";
const CORPO = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

function assinar(corpo: string, segredo = SEGREDO) {
  return `sha256=${createHmac("sha256", segredo).update(corpo, "utf8").digest("hex")}`;
}

describe("verifyHmacSignature — o que passa", () => {
  it("assinatura correta passa", () => {
    const r = verifyHmacSignature({
      rawBody: CORPO,
      header: assinar(CORPO),
      secret: SEGREDO,
    });
    expect(r.valid).toBe(true);
  });

  it("maiúsculas no hex também passam", () => {
    const r = verifyHmacSignature({
      rawBody: CORPO,
      header: assinar(CORPO).toUpperCase().replace("SHA256=", "sha256="),
      secret: SEGREDO,
    });
    expect(r.valid).toBe(true);
  });
});

describe("verifyHmacSignature — o que é recusado (§80)", () => {
  it("⚠️ SEM SEGREDO CONFIGURADO, RECUSA", () => {
    // A tentação é aceitar "por enquanto, até configurar". Um endpoint que
    // aceita qualquer payload é exatamente o buraco que a assinatura existe
    // para fechar.
    expect(
      verifyHmacSignature({ rawBody: CORPO, header: assinar(CORPO), secret: undefined }),
    ).toMatchObject({ valid: false });
    expect(
      verifyHmacSignature({ rawBody: CORPO, header: assinar(CORPO), secret: "  " }),
    ).toMatchObject({ valid: false });
  });

  it("sem header, recusa", () => {
    expect(verifyHmacSignature({ rawBody: CORPO, header: null, secret: SEGREDO }).valid).toBe(
      false,
    );
  });

  it("segredo errado, recusa", () => {
    const r = verifyHmacSignature({
      rawBody: CORPO,
      header: assinar(CORPO, "outro-segredo"),
      secret: SEGREDO,
    });
    expect(r).toEqual({ valid: false, reason: "assinatura não confere" });
  });

  it("⚠️ CORPO ADULTERADO recusa — é o ponto de existir assinatura", () => {
    const assinatura = assinar(CORPO);
    const adulterado = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "invasor" }],
    });
    expect(
      verifyHmacSignature({ rawBody: adulterado, header: assinatura, secret: SEGREDO }).valid,
    ).toBe(false);
  });

  it("⚠️ um byte a menos no corpo já recusa", () => {
    const assinatura = assinar(CORPO);
    expect(
      verifyHmacSignature({ rawBody: CORPO.slice(0, -1), header: assinatura, secret: SEGREDO })
        .valid,
    ).toBe(false);
  });

  it("prefixo errado recusa", () => {
    const hex = createHmac("sha256", SEGREDO).update(CORPO, "utf8").digest("hex");
    expect(verifyHmacSignature({ rawBody: CORPO, header: hex, secret: SEGREDO }).valid).toBe(false);
    expect(
      verifyHmacSignature({ rawBody: CORPO, header: `sha1=${hex}`, secret: SEGREDO }).valid,
    ).toBe(false);
  });

  it("⚠️ lixo no lugar do hex NÃO LANÇA — devolve inválido", () => {
    // `timingSafeEqual` LANÇA quando os buffers têm tamanhos diferentes. Sem a
    // checagem de formato, isso viraria um 500 — e o tipo de resposta
    // diferente já é, por si, um canal lateral para quem estiver medindo.
    for (const lixo of ["sha256=", "sha256=nao-e-hex", "sha256=abc", `sha256=${"z".repeat(64)}`]) {
      expect(() =>
        verifyHmacSignature({ rawBody: CORPO, header: lixo, secret: SEGREDO }),
      ).not.toThrow();
      expect(verifyHmacSignature({ rawBody: CORPO, header: lixo, secret: SEGREDO }).valid).toBe(
        false,
      );
    }
  });

  it("corpo vazio com assinatura de corpo vazio passa; com outra, não", () => {
    expect(verifyHmacSignature({ rawBody: "", header: assinar(""), secret: SEGREDO }).valid).toBe(
      true,
    );
    expect(
      verifyHmacSignature({ rawBody: "", header: assinar(CORPO), secret: SEGREDO }).valid,
    ).toBe(false);
  });
});

describe("safeCompare", () => {
  it("compara iguais e diferentes", () => {
    expect(safeCompare("abc123", "abc123")).toBe(true);
    expect(safeCompare("abc123", "abc124")).toBe(false);
  });

  it("tamanhos diferentes não lançam", () => {
    expect(() => safeCompare("a", "abcdef")).not.toThrow();
    expect(safeCompare("a", "abcdef")).toBe(false);
  });

  it("nulo e vazio nunca casam — nem entre si", () => {
    // Se `""` casasse com `""`, um segredo não configurado (string vazia)
    // autorizaria quem mandasse um header vazio.
    expect(safeCompare(null, null)).toBe(false);
    expect(safeCompare("", "")).toBe(false);
    expect(safeCompare(undefined, "x")).toBe(false);
  });
});
