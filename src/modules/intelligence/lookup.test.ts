import { describe, expect, it } from "vitest";
import { escapeLikePattern, prepareNameLookup } from "./lookup";

/**
 * §24, §61. O TERMO QUE VEIO DE FORA.
 *
 * ⚠️ ESTE ARQUIVO GUARDA UM FURO QUE EXISTIU. As portas de chatbot procuravam
 * documento e boletim com `.ilike("name", subject.trim())`, e `subject` é o
 * termo que o modelo copia da mensagem — texto de quem está do outro lado do
 * WhatsApp, literalmente.
 *
 * No ILIKE, `%` casa com qualquer coisa. "Me manda a normativa %" faria a busca
 * por nome casar com QUALQUER documento — e, havendo um só publicado, ele seria
 * entregue como se tivesse sido pedido pelo nome.
 */

describe("escapa os curingas do ILIKE", () => {
  it("`%` deixa de casar com tudo", () => {
    expect(escapeLikePattern("%")).toBe("\\%");
  });

  it("`_` deixa de casar com um caractere qualquer", () => {
    expect(escapeLikePattern("_")).toBe("\\_");
  });

  /**
   * ⚠️ A BARRA VEM PRIMEIRO. Escapando `%` antes de `\`, as barras que nós
   * mesmos acabamos de inserir seriam escapadas de novo — e o padrão passaria a
   * procurar por uma barra literal que ninguém escreveu.
   */
  it("a barra invertida é escapada antes dos curingas", () => {
    expect(escapeLikePattern("\\%")).toBe("\\\\\\%");
  });

  it("texto comum passa intacto", () => {
    expect(escapeLikePattern("Câmara Ambiental")).toBe("Câmara Ambiental");
  });
});

describe("prepara o termo da busca por nome", () => {
  /**
   * ⚠️ ESCAPAR, E NÃO REMOVER. Existe documento com `%` no nome ("Redução de 50%
   * na taxa"). Remover o caractere impediria de achá-lo pelo nome certo;
   * escapar faz o `%` valer como `%`, que é o que a pessoa quis dizer — no caso
   * legítimo e no malicioso.
   */
  it("um nome legítimo com `%` continua buscável", () => {
    expect(prepareNameLookup("Redução de 50% na taxa")).toBe("Redução de 50\\% na taxa");
  });

  it("só curinga não é nome de nada", () => {
    for (const termo of ["%", "%%", "_", "  %  ", "%_%"]) {
      expect(prepareNameLookup(termo), termo).toBeNull();
    }
  });

  it("vazio e ausente não viram busca", () => {
    expect(prepareNameLookup("")).toBeNull();
    expect(prepareNameLookup("   ")).toBeNull();
    expect(prepareNameLookup(null)).toBeNull();
    expect(prepareNameLookup(undefined)).toBeNull();
  });

  /**
   * Nenhum documento da APCS tem nome de 200 caracteres. Um `subject` desse
   * tamanho é a mensagem inteira tendo escapado do classificador.
   */
  it("termo absurdamente longo não vira consulta", () => {
    expect(prepareNameLookup("a".repeat(500))).toBeNull();
  });

  it("nome normal atravessa sem mudança", () => {
    expect(prepareNameLookup("  Câmara Ambiental  ")).toBe("Câmara Ambiental");
  });
});
