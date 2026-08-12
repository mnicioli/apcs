import { describe, expect, it } from "vitest";
import { categoryFromSlug, DOCUMENT_CATEGORY_SLUGS, documentsHref } from "./document.routes";
import { DOCUMENT_CATEGORY_COPY } from "./document.labels";
import { DOCUMENT_CATEGORIES } from "./document.types";

describe("DOCUMENT_CATEGORY_SLUGS", () => {
  // O slug faz parte do endereço público. Se alguém mudar "normatives" aqui,
  // todo link salvo para uma normativa passa a dar 404 — e nada mais no
  // projeto acusaria isso.
  it("mantém os endereços já publicados", () => {
    expect(DOCUMENT_CATEGORY_SLUGS.normative).toBe("normatives");
    expect(DOCUMENT_CATEGORY_SLUGS.communication).toBe("communication");
  });

  it("não repete slug entre categorias", () => {
    const slugs = Object.values(DOCUMENT_CATEGORY_SLUGS);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  // Acrescentar uma categoria sem slug faria a rota dela nunca resolver.
  it("cobre todas as categorias", () => {
    for (const category of DOCUMENT_CATEGORIES) {
      expect(DOCUMENT_CATEGORY_SLUGS[category]).toBeTruthy();
    }
  });
});

describe("categoryFromSlug", () => {
  it("resolve os dois sentidos sem perder nada", () => {
    for (const category of DOCUMENT_CATEGORIES) {
      expect(categoryFromSlug(DOCUMENT_CATEGORY_SLUGS[category])).toBe(category);
    }
  });

  // Devolver null é o que faz a página responder 404. Cair numa categoria
  // padrão mostraria uma grid vazia, e a pessoa leria "nenhum documento" achando
  // que o dado sumiu.
  it("devolve null para segmento desconhecido", () => {
    expect(categoryFromSlug("procedimentos")).toBeNull();
    expect(categoryFromSlug("")).toBeNull();
    expect(categoryFromSlug("NORMATIVES")).toBeNull();
  });

  // O nome da categoria não é o slug: 'normative' (enum) vira 'normatives' (URL).
  it("não aceita o nome da categoria no lugar do slug", () => {
    expect(categoryFromSlug("normative")).toBeNull();
  });
});

describe("documentsHref", () => {
  it("monta a URL da grid", () => {
    expect(documentsHref("normative")).toBe("/documents/normatives");
    expect(documentsHref("communication")).toBe("/documents/communication");
  });

  it("monta a URL do histórico", () => {
    expect(documentsHref("communication", "abc-123")).toBe("/documents/communication/abc-123");
  });
});

describe("DOCUMENT_CATEGORY_COPY", () => {
  // Um texto faltando não quebraria o build (o Record cobre isso), mas um texto
  // COPIADO da outra categoria passaria despercebido — e a tela de Comunicação
  // diria "normativa".
  it("cada categoria tem texto próprio", () => {
    const titulos = DOCUMENT_CATEGORIES.map((c) => DOCUMENT_CATEGORY_COPY[c].title);
    const subtitulos = DOCUMENT_CATEGORIES.map((c) => DOCUMENT_CATEGORY_COPY[c].subtitle);

    expect(new Set(titulos).size).toBe(DOCUMENT_CATEGORIES.length);
    expect(new Set(subtitulos).size).toBe(DOCUMENT_CATEGORIES.length);
  });

  it("a tela de Comunicação não fala em normativa", () => {
    const textos = Object.values(DOCUMENT_CATEGORY_COPY.communication).join(" ").toLowerCase();
    expect(textos).not.toContain("normativa");
  });
});
