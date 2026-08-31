import { describe, expect, it } from "vitest";
import { MENU_OPTIONS, readMenuChoice } from "./menu";
import { SETTING_KEYS } from "@/modules/admin/admin.labels";
import { SETTING_FALLBACKS } from "@/lib/services/admin";

/**
 * §46. O MENU DE EMERGÊNCIA — e o que ele NÃO pode ler como escolha.
 *
 * ⚠️ ESTA BATERIA É SOBRE OS FALSOS POSITIVOS. Um menu que lê certo o "1" de
 * quem escolheu é fácil; o que dá defeito é o "2" de quem estava falando de
 * outra coisa e recebe uma normativa do nada. E o pior desse engano não é o
 * documento errado — é a pessoa concluir que o robô é aleatório e parar de
 * escrever.
 */

const AGORA = new Date("2026-09-16T12:00:00.000Z");
const RECENTE = new Date("2026-09-16T11:55:00.000Z").toISOString();

describe("lê a escolha quando há menu de pé", () => {
  it("cada número leva à intenção da lista", () => {
    for (const { choice, intent } of MENU_OPTIONS) {
      expect(readMenuChoice(choice, RECENTE, AGORA)).toBe(intent);
    }
  });

  it("tolera espaço e pontuação final", () => {
    // "1." e "2)" são o que as pessoas digitam de verdade.
    expect(readMenuChoice(" 1 ", RECENTE, AGORA)).toBe("consultar_bolsa");
    expect(readMenuChoice("2.", RECENTE, AGORA)).toBe("consultar_normativa");
    expect(readMenuChoice("3)", RECENTE, AGORA)).toBe("consultar_comunicacao");
  });
});

describe("NÃO lê a escolha", () => {
  /**
   * ⚠️ O TESTE MAIS IMPORTANTE DAQUI. Sem `menuShownAt`, todo número da conversa
   * viraria escolha — e a maioria dos números que uma pessoa escreve para uma
   * associação de suinocultores são quantidades, datas e pesos.
   */
  it("sem menu mostrado, um número é só um número", () => {
    expect(readMenuChoice("1", null, AGORA)).toBeNull();
  });

  it("com o menu vencido, um número volta a ser só um número", () => {
    const velho = new Date("2026-09-16T11:00:00.000Z").toISOString();
    expect(readMenuChoice("1", velho, AGORA)).toBeNull();
  });

  /**
   * ⚠️ SÓ O NÚMERO SOZINHO CONTA. Aceitar qualquer mensagem que CONTENHA um
   * dígito transformaria "chegou dia 2" e "mando 5 caminhões" em consultas.
   */
  it("número no meio de uma frase não é escolha", () => {
    for (const frase of [
      "2 caixas",
      "chegou dia 2",
      "vou mandar 5 caminhões",
      "meu lote é o 1",
      "1 de janeiro",
    ]) {
      expect(readMenuChoice(frase, RECENTE, AGORA), frase).toBeNull();
    }
  });

  it("número fora da lista não é escolha", () => {
    expect(readMenuChoice("9", RECENTE, AGORA)).toBeNull();
    expect(readMenuChoice("0", RECENTE, AGORA)).toBeNull();
  });

  it("carimbo ilegível não vira escolha", () => {
    expect(readMenuChoice("1", "isto não é uma data", AGORA)).toBeNull();
  });
});

/**
 * ⚠️ A FRAQUEZA CONHECIDA DO DESENHO, E ESTE TESTE É O QUE A SEGURA.
 *
 * O mapa número → intenção está em código (`MENU_OPTIONS`); o TEXTO do menu
 * está em `app_settings`, para a APCS poder reescrevê-lo (§50). Nada no banco
 * garante que os dois concordem — e se discordarem, o "2" leva ao lugar errado
 * sem erro nenhum em lugar nenhum.
 *
 * Este teste confere pelo menos o padrão do código, que é a frase-semente da
 * migration. Ele não alcança uma edição feita na tela: essa parte é o aviso no
 * texto de ajuda, e está registrada como pendência em docs/INTELIGENCIA.md.
 */
describe("o texto do menu e o mapa das opções", () => {
  const texto = SETTING_FALLBACKS[SETTING_KEYS.chatbotMenu];

  it("a frase padrão lista exatamente os números do mapa", () => {
    const numerosNaFrase = [...texto.matchAll(/^(\d+)\s*-/gm)].map((m) => m[1]);

    expect(
      numerosNaFrase,
      "\n\nO texto padrão do menu e `MENU_OPTIONS` divergiram.\n" +
        "O número que a pessoa digitar levaria a outra coisa, sem erro nenhum.\n",
    ).toEqual(MENU_OPTIONS.map((o) => o.choice));
  });

  it("a frase padrão termina pedindo o número", () => {
    // Sem essa instrução a pessoa responde "quero a bolsa" — que é justamente o
    // que o classificador fora do ar não consegue ler.
    expect(texto.toLowerCase()).toContain("número");
  });
});
