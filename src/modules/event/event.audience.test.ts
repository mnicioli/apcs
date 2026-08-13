import { describe, expect, it } from "vitest";
import {
  matchesAnySegment,
  NO_ASSOCIATE_REGISTRY,
  unionAudience,
  type EventAudienceSource,
} from "./event.audience";

/**
 * Uma origem de associados EM MEMÓRIA.
 *
 * Existe para provar que a lógica de elegibilidade está certa hoje, sem
 * inventar uma tabela de associados no banco. No dia em que o cadastro existir,
 * a implementação real precisa passar exatamente por estes casos.
 */
function origemFalsa(membros: Record<string, string[]>): EventAudienceSource {
  return {
    id: "fake",
    async segmentsForAssociate(associateId) {
      const slugs = Object.entries(membros)
        .filter(([, ids]) => ids.includes(associateId))
        .map(([slug]) => slug);
      return { available: true, value: slugs };
    },
    async associatesInSegments(segmentSlugs) {
      const listas = segmentSlugs.map((slug) => membros[slug] ?? []);
      return { available: true, value: unionAudience(listas) };
    },
  };
}

const BASE = {
  suinos: ["joao", "carlos"],
  "camara-setorial": ["joao", "maria"],
  bovinos: ["ana"],
};

describe("matchesAnySegment — a regra é OU, nunca E", () => {
  const evento = [{ slug: "suinos" }, { slug: "camara-setorial" }];

  it("pertencer a UM dos segmentos basta", () => {
    expect(matchesAnySegment(evento, ["suinos"])).toBe(true);
    expect(matchesAnySegment(evento, ["camara-setorial"])).toBe(true);
  });

  it("pertencer aos dois também vale", () => {
    expect(matchesAnySegment(evento, ["suinos", "camara-setorial"])).toBe(true);
  });

  it("segmento incompatível não passa", () => {
    expect(matchesAnySegment(evento, ["bovinos"])).toBe(false);
  });

  it("associado sem segmento nenhum não passa", () => {
    expect(matchesAnySegment(evento, [])).toBe(false);
  });

  // ⚠️ O caso que o escopo proíbe interpretar como "todos". Evento sem
  // público-alvo não alcança ninguém — ler ausência como alcance total é
  // exatamente o que geraria comunicação indevida.
  it("evento SEM público-alvo não alcança ninguém, nem quem tem segmentos", () => {
    expect(matchesAnySegment([], ["suinos"])).toBe(false);
    expect(matchesAnySegment([], [])).toBe(false);
  });
});

describe("unionAudience — quem está em dois segmentos conta uma vez", () => {
  it("junta as listas sem repetir", () => {
    expect(
      unionAudience([
        ["joao", "carlos"],
        ["joao", "maria"],
      ]),
    ).toEqual(["joao", "carlos", "maria"]);
  });

  it("lista vazia devolve vazio", () => {
    expect(unionAudience([])).toEqual([]);
    expect(unionAudience([[], []])).toEqual([]);
  });

  it("preserva a ordem da primeira aparição", () => {
    expect(unionAudience([["c"], ["a"], ["c", "b"]])).toEqual(["c", "a", "b"]);
  });
});

describe("NO_ASSOCIATE_REGISTRY", () => {
  // ⚠️ O teste mais importante deste arquivo. `available: false` NÃO pode virar
  // uma lista vazia: "não sei quem são" e "não é ninguém" são respostas
  // diferentes, e confundi-las faria uma campanha enviar para zero pessoas e
  // reportar sucesso.
  it("responde 'não sei', e não 'ninguém'", async () => {
    const porAssociado = await NO_ASSOCIATE_REGISTRY.segmentsForAssociate("joao");
    const porSegmento = await NO_ASSOCIATE_REGISTRY.associatesInSegments(["suinos"]);

    expect(porAssociado).toEqual({ available: false, reason: "no-associate-registry" });
    expect(porSegmento).toEqual({ available: false, reason: "no-associate-registry" });
    expect(porAssociado).not.toHaveProperty("value");
  });
});

describe("resolução de audiência com uma origem real (falsa)", () => {
  const origem = origemFalsa(BASE);

  it("um evento de dois segmentos alcança a união, sem repetir o João", async () => {
    const r = await origem.associatesInSegments(["suinos", "camara-setorial"]);
    expect(r).toEqual({ available: true, value: ["joao", "carlos", "maria"] });
  });

  it("um segmento só alcança só os dele", async () => {
    const r = await origem.associatesInSegments(["bovinos"]);
    expect(r).toEqual({ available: true, value: ["ana"] });
  });

  it("segmento inexistente não quebra e não inventa gente", async () => {
    const r = await origem.associatesInSegments(["nao-existe"]);
    expect(r).toEqual({ available: true, value: [] });
  });

  it("resolve os segmentos de um associado", async () => {
    const joao = await origem.segmentsForAssociate("joao");
    expect(joao).toEqual({ available: true, value: ["suinos", "camara-setorial"] });
  });

  it("associado inexistente devolve nenhum segmento — e não erro", async () => {
    const r = await origem.segmentsForAssociate("ninguem");
    expect(r).toEqual({ available: true, value: [] });
  });
});
