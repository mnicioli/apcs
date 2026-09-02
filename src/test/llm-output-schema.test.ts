import { describe, expect, it } from "vitest";
import { ANALYSIS_JSON_SCHEMA as SCHEMA_INTENCOES } from "@/lib/intelligence/ai/anthropic";

/**
 * OS SCHEMAS DE SAÍDA ESTRUTURADA, CONFERIDOS CONTRA O QUE A API ACEITA.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE
 * ----------------------------------------------------------------------------
 * `intelligence/ai/anthropic.ts` declarava `confidence: { type: "number",
 * minimum: 0, maximum: 1 }`. É JSON Schema válido, passa no type-check, passa no
 * lint, e a API RECUSA com HTTP 400 ("For 'number' type, properties maximum,
 * minimum are not supported").
 *
 * O estrago foi mudo. O 400 caía no `catch` do provedor, virava
 * `{ ok: false, reason: "unavailable" }` e o robô servia o menu do §46 — a
 * mesma resposta de quando não entende a pessoa. Ou seja: a classificação
 * NUNCA funcionou, e por fora parecia só um bot sem jeito. Nenhum teste pegava,
 * porque nenhum teste falava com a API de verdade, e nenhum ainda fala.
 *
 * Este arquivo fecha a brecha sem gastar chamada: em vez de perguntar à API, ele
 * guarda a LISTA do que a API recusa e confere os schemas contra ela.
 *
 * ⚠️ A LISTA SAIU DE MEDIÇÃO, NÃO DE MEMÓRIA. Cada linha foi mandada para a API
 * em 01/09/2026 (modelo `claude-sonnet-5`) e a recusa foi lida na resposta.
 * `string` aceitou `minLength`, `maxLength` e `pattern` nesse mesmo teste — por
 * isso strings não entram na lista. Se a API mudar, o certo é medir de novo e
 * corrigir aqui, não afrouxar o teste.
 */
const RECUSADAS_POR_TIPO: Readonly<Record<string, readonly string[]>> = {
  number: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"],
  integer: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"],
  array: ["minItems", "maxItems"],
};

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Percorre o schema inteiro e devolve o caminho de cada palavra-chave recusada. */
function violacoes(no: unknown, caminho = "raiz"): string[] {
  if (!ehObjeto(no)) return [];
  const achados: string[] = [];

  const tipo = no.type;
  if (typeof tipo === "string") {
    for (const palavra of RECUSADAS_POR_TIPO[tipo] ?? []) {
      if (palavra in no) achados.push(`${caminho}: "${palavra}" em ${tipo}`);
    }
  }

  for (const [chave, valor] of Object.entries(no)) {
    if (Array.isArray(valor)) {
      valor.forEach((item, i) => achados.push(...violacoes(item, `${caminho}.${chave}[${i}]`)));
    } else {
      achados.push(...violacoes(valor, `${caminho}.${chave}`));
    }
  }
  return achados;
}

describe("schemas de saída estruturada", () => {
  /**
   * ⚠️ A AUTOCHECAGEM, e ela não é decoração. Um detector quebrado devolveria
   * lista vazia para tudo e o teste de baixo passaria para sempre,
   * verdes e inúteis. Este prova que ele enxerga — usando a forma EXATA que
   * derrubou a produção.
   */
  it("o detector reconhece a forma que quebrou a classificação", () => {
    const comoEra = {
      type: "object",
      properties: { confidence: { type: "number", minimum: 0, maximum: 1 } },
    };

    expect(violacoes(comoEra)).toEqual([
      'raiz.properties.confidence: "minimum" em number',
      'raiz.properties.confidence: "maximum" em number',
    ]);
  });

  it("o schema da classificação de intenções só usa o que a API aceita", () => {
    expect(violacoes(SCHEMA_INTENCOES)).toEqual([]);
  });

  /**
   * O campo tem de continuar existindo e continuar sendo número. Sem isto,
   * "corrigir" o schema apagando `confidence` passaria no teste de cima — e o
   * roteador perderia a régua que decide entre agir, perguntar e oferecer menu.
   */
  it("a classificação continua devolvendo confidence numérico", () => {
    const propriedades = (SCHEMA_INTENCOES as { properties: Record<string, unknown> }).properties;
    expect(propriedades.confidence).toEqual({ type: "number" });
  });
});
