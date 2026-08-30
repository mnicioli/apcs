import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTools } from "@/lib/intelligence/tools";
import { INTENT_REGISTRY } from "@/modules/intelligence/intent.registry";
import { APCS_INTENTS, TOOL_NAMES } from "@/modules/intelligence/intent.types";

/**
 * O REGISTRO DE INTENÇÕES E O BANCO CONTAM A MESMA HISTÓRIA?
 *
 * ⚠️ AS COLUNAS `intent` E `tool` SÃO `text`, E NÃO ENUM — foi uma decisão, e
 * está explicada em `20260914000200_intelligence.sql`: o §11 do escopo pede que
 * acrescentar uma intenção seja acrescentar uma entrada no registro, não uma
 * migration mais um deploy mais um `pnpm db:types`. E um enum guardaria para
 * sempre toda intenção aposentada, porque o Postgres não sabe remover valor de
 * enum (ver 20260902000000).
 *
 * O PREÇO DESSA ESCOLHA É ESTE ARQUIVO. Sem enum, o vocabulário não é imposto
 * pelo tipo — o que o banco impõe é o FORMATO, com um CHECK. Uma intenção
 * chamada `consultarBolsa` (camelCase) passaria por todo o TypeScript e
 * quebraria no INSERT da trilha, em produção, no meio de um webhook — que é
 * onde uma exceção vira reentrega em laço.
 *
 * Este teste lê o CHECK da migration e confere os nomes contra ELE, e não
 * contra uma cópia da expressão escrita aqui.
 */

const MIGRATION = join(process.cwd(), "supabase", "migrations", "20260914000200_intelligence.sql");

const sql = readFileSync(MIGRATION, "utf8");

/** A expressão regular de um CHECK `... ~ '...'`, lida da própria migration. */
function padraoDoCheck(nome: string): RegExp {
  const bloco = new RegExp(`constraint\\s+${nome}[\\s\\S]{0,200}?~\\s*'([^']+)'`, "i");
  const achado = bloco.exec(sql);
  if (!achado?.[1]) {
    throw new Error(
      `Não achei o CHECK ${nome} em 20260914000200_intelligence.sql. ` +
        `Se ele foi renomeado, este teste precisa acompanhar — ele existe justamente ` +
        `para o código e o banco não divergirem.`,
    );
  }
  return new RegExp(achado[1]);
}

describe("o registro de intenções e o banco", () => {
  it("o teste está de fato lendo a migration", () => {
    // Sem isto, uma expressão regular quebrada transformaria a bateria num teste
    // que passa sobre nada — o pior tipo de guarda.
    expect(sql.length).toBeGreaterThan(1000);
    expect(sql).toContain("conversation_context_intent_format");
    expect(APCS_INTENTS.length).toBeGreaterThan(5);
  });

  it("toda intenção passa no CHECK que o banco impõe", () => {
    const padrao = padraoDoCheck("conversation_context_intent_format");
    const reprovadas = APCS_INTENTS.filter((intent) => !padrao.test(intent));

    expect(
      reprovadas,
      `\n\nIntenções que o banco recusaria: ${reprovadas.join(", ")}\n\n` +
        `O CHECK é ${padrao.source}. Uma intenção fora desse formato passa por todo o\n` +
        `TypeScript e quebra no INSERT da trilha — em produção, dentro do webhook, que\n` +
        `é onde uma exceção vira reentrega em laço.\n`,
    ).toEqual([]);
  });

  it("toda intenção passa também no CHECK da trilha", () => {
    // São dois CHECKs em duas tabelas, e nada garante que continuem iguais.
    const padrao = padraoDoCheck("intelligence_interactions_intent_format");
    expect(APCS_INTENTS.filter((intent) => !padrao.test(intent))).toEqual([]);
  });

  it("toda ferramenta passa no CHECK da trilha", () => {
    const padrao = padraoDoCheck("intelligence_interactions_tool_format");
    const reprovadas = TOOL_NAMES.filter((tool) => !padrao.test(tool));

    expect(
      reprovadas,
      `\n\nFerramentas que o banco recusaria: ${reprovadas.join(", ")}\n` +
        `O CHECK é ${padrao.source}.\n`,
    ).toEqual([]);
  });
});

describe("a coerência do registro", () => {
  it("toda intenção tem entrada, e nenhuma sobra", () => {
    expect(Object.keys(INTENT_REGISTRY).sort()).toEqual([...APCS_INTENTS].sort());
  });

  /**
   * ⚠️ FERRAMENTA E ENCAMINHAMENTO SÃO EXCLUDENTES. `router.ts` testa `handoff`
   * PRIMEIRO — uma intenção com os dois preenchidos nunca executaria a
   * ferramenta, e o autor da entrada não teria como saber disso lendo o
   * registro.
   */
  it("nenhuma intenção tem ferramenta E encaminhamento ao mesmo tempo", () => {
    const ambos = APCS_INTENTS.filter(
      (intent) => INTENT_REGISTRY[intent].tool !== null && INTENT_REGISTRY[intent].handoff,
    );

    expect(
      ambos,
      `\n\n${ambos.join(", ")} declara ferramenta E handoff.\n\n` +
        `O roteador confere \`handoff\` primeiro, então a ferramenta nunca rodaria —\n` +
        `silenciosamente. Escolha um dos dois.\n`,
    ).toEqual([]);
  });

  it("toda ferramenta declarada no registro existe de verdade", () => {
    const implementadas = new Set(allTools().map((tool) => tool.name));
    const declaradas = APCS_INTENTS.map((intent) => INTENT_REGISTRY[intent].tool).filter(
      (tool): tool is (typeof TOOL_NAMES)[number] => tool !== null,
    );

    const faltando = declaradas.filter((tool) => !implementadas.has(tool));

    expect(
      faltando,
      `\n\nIntenção aponta para ferramenta que não existe: ${faltando.join(", ")}\n` +
        `Isso seria um erro em tempo de execução, no meio do atendimento.\n`,
    ).toEqual([]);
  });

  it("o registro de ferramentas cobre exatamente TOOL_NAMES", () => {
    expect(
      allTools()
        .map((tool) => tool.name)
        .sort(),
    ).toEqual([...TOOL_NAMES].sort());
  });

  /**
   * ⚠️ SEM FRASE DE CONFIRMAÇÃO, A FAIXA MÉDIA VIRA FALLBACK. É seguro — o
   * roteador nunca executa sem confirmar —, mas é uma escolha, não um descuido:
   * a intenção passa a só funcionar com confiança alta.
   *
   * O teste fixa quais são, para que a próxima ficar sem frase seja uma decisão
   * e não um esquecimento.
   */
  it("as intenções sem frase de confirmação são as esperadas", () => {
    const semFrase = APCS_INTENTS.filter((i) => INTENT_REGISTRY[i].confirmation === null);
    expect(semFrase.sort()).toEqual(
      ["ajuda", "consultar_conhecimento", "desconhecido", "saudacao"].sort(),
    );
  });

  /**
   * ⚠️ A CONFIRMAÇÃO É UMA PERGUNTA DE SIM OU NÃO, e não uma pergunta aberta.
   * A resposta é lida sem modelo (`affirmation.ts`), então "qual normativa você
   * quer?" ali produziria um "não entendi" garantido.
   */
  it("toda frase de confirmação termina em interrogação", () => {
    const frases = APCS_INTENTS.map((i) => INTENT_REGISTRY[i].confirmation).filter(
      (frase): frase is string => frase !== null,
    );

    expect(frases.length).toBeGreaterThan(0);
    for (const frase of frases) {
      expect(frase.trim().endsWith("?"), `"${frase}" não é uma pergunta de sim ou não.`).toBe(true);
    }
  });
});
