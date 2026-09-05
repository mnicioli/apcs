import { describe, expect, it } from "vitest";
import { BUSINESS_HOURS_VARIABLE, isWithinBusinessHours, parseBusinessHours } from "./flow.hours";

/**
 * §34 do Prompt 4 — o expediente.
 *
 * ⚠️ AS DATAS SÃO CONSTRUÍDAS EM UTC E CONVERTIDAS PELO FUSO DA APCS, e é por
 * isso que os horários dos testes parecem "errados" à primeira vista: São Paulo
 * é UTC-3, então 12:00Z é 09:00 na APCS. Escrever `new Date("2026-09-07T09:00")`
 * sem fuso faria o teste depender do relógio da máquina que o roda — passaria
 * aqui e falharia no CI, ou pior, o contrário.
 */

// 2026-09-07 é uma SEGUNDA-feira. Os dias abaixo seguem dela.
const SEGUNDA_9H = new Date("2026-09-07T12:00:00Z");
const SEGUNDA_7H = new Date("2026-09-07T10:00:00Z");
const SEGUNDA_18H = new Date("2026-09-07T21:00:00Z");
const SEXTA_9H = new Date("2026-09-11T12:00:00Z");
const SABADO_9H = new Date("2026-09-12T12:00:00Z");
const DOMINGO_9H = new Date("2026-09-13T12:00:00Z");

describe("parseBusinessHours", () => {
  it("lê o formato do dia a dia", () => {
    expect(parseBusinessHours("seg-sex 08:00-18:00")).toEqual([
      { days: [1, 2, 3, 4, 5], startMinutes: 480, endMinutes: 1080 },
    ]);
  });

  it("lê várias faixas separadas por vírgula", () => {
    expect(parseBusinessHours("seg-qui 08:00-18:00, sex 08:00-12:00")).toEqual([
      { days: [1, 2, 3, 4], startMinutes: 480, endMinutes: 1080 },
      { days: [5], startMinutes: 480, endMinutes: 720 },
    ]);
  });

  it("aceita um dia só", () => {
    expect(parseBusinessHours("sab 09:00-13:00")).toEqual([
      { days: [6], startMinutes: 540, endMinutes: 780 },
    ]);
  });

  /**
   * ⚠️ O INTERVALO DÁ A VOLTA porque plantão de fim de semana é um expediente
   * real. Recusá-lo obrigaria a escrever duas faixas para dizer uma coisa.
   */
  it("dá a volta na semana", () => {
    const [janela] = parseBusinessHours("sex-seg 08:00-18:00");
    expect(janela?.days).toEqual([5, 6, 0, 1]);
  });

  /**
   * ⚠️ ESTE É O TESTE QUE IMPORTA PARA QUEM OPERA. O campo é editado por alguém
   * da APCS numa caixa de texto, e cada linha abaixo é um erro de digitação que
   * já aconteceria no primeiro mês. Descartar a faixa ruim e manter as outras é
   * o que impede um caractere de derrubar o expediente inteiro.
   */
  /**
   * ⚠️ O ZERO À ESQUERDA É OPCIONAL, e é deliberado: o campo é uma caixa de
   * texto preenchida por uma pessoa, e `8:00` não tem segunda leitura. Recusar
   * seria rigor sem benefício. O que se recusa é o ambíguo — ver a faixa
   * invertida logo abaixo.
   */
  it("aceita a hora sem o zero à esquerda", () => {
    expect(parseBusinessHours("seg-sex 8:00-18:00")).toEqual([
      { days: [1, 2, 3, 4, 5], startMinutes: 480, endMinutes: 1080 },
    ]);
  });

  it.each([
    ["dia por extenso", "sabado 09:00-13:00"],
    ["dia inexistente", "sgu-sex 08:00-18:00"],
    ["hora impossível", "seg-sex 25:00-26:00"],
    ["sem o hífen das horas", "seg-sex 08:00 18:00"],
    ["faixa que não avança", "seg-sex 18:00-08:00"],
    ["faixa de duração zero", "seg-sex 08:00-08:00"],
    ["texto solto", "quando der"],
    ["vazio", ""],
  ])("descarta a faixa ilegível: %s", (_nome, spec) => {
    expect(parseBusinessHours(spec)).toEqual([]);
  });

  /**
   * ⚠️ O TESTE QUE IMPORTA PARA QUEM OPERA: um erro na SEGUNDA faixa não pode
   * levar embora a primeira. É a diferença entre perder o expediente de sábado
   * e perder a semana inteira.
   */
  it("descarta só a faixa ruim, e mantém a boa", () => {
    const janelas = parseBusinessHours("seg-sex 08:00-18:00, sabado 09:00-13:00");
    expect(janelas).toHaveLength(1);
    expect(janelas[0]?.days).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("isWithinBusinessHours", () => {
  const EXPEDIENTE = "seg-sex 08:00-18:00";

  it("está dentro no meio da manhã de uma segunda", () => {
    expect(isWithinBusinessHours(EXPEDIENTE, SEGUNDA_9H)).toBe(true);
  });

  it("está fora antes de abrir", () => {
    expect(isWithinBusinessHours(EXPEDIENTE, SEGUNDA_7H)).toBe(false);
  });

  /**
   * ⚠️ O FIM DA FAIXA É EXCLUSIVO: às 18:00 em ponto o expediente ACABOU. A
   * leitura inclusiva faria a última transferência do dia cair numa equipe que
   * já saiu, com a pessoa achando que seria atendida.
   */
  it("está fora exatamente na hora de fechar", () => {
    expect(isWithinBusinessHours(EXPEDIENTE, SEGUNDA_18H)).toBe(false);
  });

  it("está fora no fim de semana", () => {
    expect(isWithinBusinessHours(EXPEDIENTE, SABADO_9H)).toBe(false);
    expect(isWithinBusinessHours(EXPEDIENTE, DOMINGO_9H)).toBe(false);
  });

  it("respeita a faixa mais curta da sexta", () => {
    const spec = "seg-qui 08:00-18:00, sex 08:00-12:00";
    expect(isWithinBusinessHours(spec, SEXTA_9H)).toBe(true);
    // 15:00 na APCS — dentro para segunda a quinta, fora para sexta.
    expect(isWithinBusinessHours(spec, new Date("2026-09-11T18:00:00Z"))).toBe(false);
    expect(isWithinBusinessHours(spec, new Date("2026-09-10T18:00:00Z"))).toBe(true);
  });

  /**
   * ⚠️ A AUSÊNCIA DE CONFIGURAÇÃO SIGNIFICA ATENDER SEMPRE, e este teste guarda
   * a escolha, não o código: dizer "voltamos amanhã" com o time inteiro sentado
   * à mesa manda a pessoa embora sem ninguém ficar sabendo. Ver o comentário em
   * `isWithinBusinessHours`.
   */
  it.each([
    ["vazio", ""],
    ["só espaços", "   "],
    ["ilegível por inteiro", "de segunda a sexta, comercial"],
  ])("atende sempre quando a configuração é %s", (_nome, spec) => {
    expect(isWithinBusinessHours(spec, SABADO_9H)).toBe(true);
    expect(isWithinBusinessHours(spec, SEGUNDA_7H)).toBe(true);
  });
});

describe("a variável", () => {
  // ⚠️ O PREFIXO `sys_` MARCA O QUE É DO MOTOR. Um nome sem ele poderia colidir
  // com uma variável que o desenhador criou numa pergunta.
  it("é do motor, e não do desenho", () => {
    expect(BUSINESS_HOURS_VARIABLE.startsWith("sys_")).toBe(true);
  });
});
