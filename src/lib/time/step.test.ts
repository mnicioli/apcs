import { describe, expect, it } from "vitest";
import { isInstantOnTimeStep, isOnTimeStep, TIME_STEP_MINUTES, TIME_STEP_SECONDS } from "./step";

/**
 * A GRADE DE 5 MINUTOS, que hoje vale para Eventos, Palestras e Enquetes.
 *
 * ⚠️ O QUE ESTES TESTES PROTEGEM não é o `step` do campo — esse é conveniência,
 * e os formulários são `noValidate`, então ele só muda a LISTA que o seletor
 * oferece. O que vale é esta função, chamada pelos schemas Zod que rodam no
 * cliente E na Server Action.
 */

describe("as duas constantes", () => {
  it("dizem a mesma coisa em unidades diferentes", () => {
    // O `<input type="time">` mede `step` em SEGUNDOS; o resto do mundo pensa
    // em minutos. Divergir faria o seletor oferecer um horário que o schema
    // recusa — e a pessoa não teria como saber o que fez de errado.
    expect(TIME_STEP_SECONDS).toBe(TIME_STEP_MINUTES * 60);
  });
});

describe("isOnTimeStep", () => {
  it("aceita os minutos da grade", () => {
    for (let m = 0; m < 60; m += TIME_STEP_MINUTES) {
      const hhmm = `14:${String(m).padStart(2, "0")}`;
      expect(isOnTimeStep(hhmm)).toBe(true);
    }
  });

  it("recusa o que está entre os passos", () => {
    expect(isOnTimeStep("14:01")).toBe(false);
    expect(isOnTimeStep("14:07")).toBe(false);
    expect(isOnTimeStep("14:59")).toBe(false);
  });

  it("olha o minuto, não a hora", () => {
    expect(isOnTimeStep("07:00")).toBe(true);
    expect(isOnTimeStep("23:55")).toBe(true);
  });
});

describe("isInstantOnTimeStep", () => {
  it("aceita um instante na grade", () => {
    expect(isInstantOnTimeStep("2026-09-01T09:00:00.000Z")).toBe(true);
    expect(isInstantOnTimeStep("2026-09-10T23:55:00.000Z")).toBe(true);
  });

  it("recusa o fim do dia por um minuto", () => {
    // ⚠️ 23:59 É O CASO REAL, e ele custou um teste de Enquetes: "fechar a urna
    // às 23:59" é o jeito idiomático de dizer "no fim do dia". A grade recusa,
    // e 23:55 passou a ser o substituto. Se um dia isto incomodar, é aqui que
    // a conversa começa.
    expect(isInstantOnTimeStep("2026-09-10T23:59:00.000Z")).toBe(false);
  });

  /**
   * ⚠️ O TESTE QUE JUSTIFICA LER OS MINUTOS EM UTC EM VEZ DE FATIAR A STRING.
   *
   * `"...T10:05:00-03:00"` e `"...T13:05:00Z"` são o MESMO instante, e só um
   * dos dois tem o minuto onde um `slice(14, 16)` iria procurar. Fatiar
   * funcionaria no fuso de São Paulo e quebraria em qualquer outro — o tipo de
   * defeito que só aparece quando alguém viaja.
   */
  it("sobrevive ao deslocamento de fuso", () => {
    expect(isInstantOnTimeStep("2026-09-01T10:05:00-03:00")).toBe(true);
    expect(isInstantOnTimeStep("2026-09-01T10:07:00-03:00")).toBe(false);
    // Fuso de meia hora: Índia. Desloca por 30 minutos, que é múltiplo de 5 —
    // a grade sobrevive.
    expect(isInstantOnTimeStep("2026-09-01T10:05:00+05:30")).toBe(true);
    // E de 45 minutos: Nepal. Também múltiplo de 5.
    expect(isInstantOnTimeStep("2026-09-01T10:05:00+05:45")).toBe(true);
  });

  it("não opina sobre um instante que nem é um instante", () => {
    // Formato inválido é problema de OUTRO refine. Recusar aqui daria duas
    // mensagens de erro para o mesmo campo, e a segunda ("escolha um horário de
    // 5 em 5") não diria nada útil sobre "banana".
    expect(isInstantOnTimeStep("banana")).toBe(true);
  });
});
