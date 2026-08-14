import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  calendarLabel,
  calendarRange,
  endOfMonth,
  endOfWeek,
  hourSlots,
  isCalendarDate,
  isSameMonth,
  isWeekend,
  monthMatrix,
  normalizeAnchor,
  shiftAnchor,
  shiftedEndTime,
  slotOf,
  startOfMonth,
  startOfWeek,
  weekDays,
  yearMonths,
} from "./lecture.calendar";

/**
 * ⚠️ O QUE ESTES TESTES REALMENTE PROTEGEM é o fuso.
 *
 * `new Date("2026-08-15")` é meia-noite UTC, que em São Paulo é 21h do dia
 * ANTERIOR. Num calendário isso não erra um rótulo — põe a palestra na célula
 * errada. Toda a aritmética é feita em UTC e devolvida como string, e os casos
 * abaixo travam esse comportamento: se alguém trocar por `Date` local, a virada
 * de mês e o primeiro dia da semana quebram aqui antes de quebrar na tela.
 */

describe("aritmética de datas", () => {
  it("soma dias atravessando meses e anos", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // bissexto
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01"); // não bissexto
  });

  it("soma meses ancorando no dia 1 — 31/01 + 1 mês NÃO pula fevereiro", () => {
    // É a armadilha clássica: 31/01 + 1 mês vira 31/02, que o `Date` normaliza
    // para 03/03 — e o botão "próximo mês" pularia fevereiro inteiro.
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-10", -1)).toBe("2025-12-01");
  });

  it("acha o começo e o fim do mês", () => {
    expect(startOfMonth("2026-08-15")).toBe("2026-08-01");
    expect(endOfMonth("2026-08-15")).toBe("2026-08-31");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2024-02-10")).toBe("2024-02-29");
  });

  it("a semana começa na SEGUNDA", () => {
    // 15/08/2026 é um sábado.
    expect(startOfWeek("2026-08-15")).toBe("2026-08-10");
    expect(endOfWeek("2026-08-15")).toBe("2026-08-16");
    // Domingo pertence à semana que começou na segunda anterior — o erro fácil
    // seria jogá-lo para a semana seguinte.
    expect(startOfWeek("2026-08-16")).toBe("2026-08-10");
    expect(startOfWeek("2026-08-17")).toBe("2026-08-17");
  });

  it("reconhece fim de semana", () => {
    expect(isWeekend("2026-08-15")).toBe(true); // sábado
    expect(isWeekend("2026-08-16")).toBe(true); // domingo
    expect(isWeekend("2026-08-17")).toBe(false); // segunda
  });

  it("valida data de calendário de verdade", () => {
    expect(isCalendarDate("2026-08-15")).toBe(true);
    expect(isCalendarDate("2026-02-31")).toBe(false);
    expect(isCalendarDate("15/08/2026")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

describe("período buscado por visão (§56)", () => {
  it("a visão mensal pede um pouco MAIS que o mês", () => {
    // A grade mostra as pontas dos meses vizinhos. Sem elas, aqueles dias
    // apareceriam sempre vazios — parecendo que não há palestra quando há.
    expect(calendarRange("month", "2026-08-01")).toEqual({
      start: "2026-07-27",
      end: "2026-09-06",
    });
  });

  it("a semanal pede exatamente a semana", () => {
    expect(calendarRange("week", "2026-08-10")).toEqual({
      start: "2026-08-10",
      end: "2026-08-16",
    });
  });

  it("a diária pede um dia só", () => {
    expect(calendarRange("day", "2026-08-15")).toEqual({
      start: "2026-08-15",
      end: "2026-08-15",
    });
  });

  it("a anual pede o ano fechado", () => {
    expect(calendarRange("year", "2026-01-01")).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
    });
  });
});

describe("navegação (§6, §7)", () => {
  it("anda na unidade da visão", () => {
    expect(shiftAnchor("month", "2026-08-01", 1)).toBe("2026-09-01");
    expect(shiftAnchor("month", "2026-08-01", -1)).toBe("2026-07-01");
    expect(shiftAnchor("week", "2026-08-10", 1)).toBe("2026-08-17");
    expect(shiftAnchor("day", "2026-08-15", 1)).toBe("2026-08-16");
    expect(shiftAnchor("year", "2026-01-01", 1)).toBe("2027-01-01");
  });

  it("normaliza a âncora para a visão", () => {
    // Sem isto, "próximo mês" dependeria do dia que estava selecionado.
    expect(normalizeAnchor("month", "2026-08-15")).toBe("2026-08-01");
    expect(normalizeAnchor("week", "2026-08-15")).toBe("2026-08-10");
    expect(normalizeAnchor("day", "2026-08-15")).toBe("2026-08-15");
    expect(normalizeAnchor("year", "2026-08-15")).toBe("2026-01-01");
  });

  it("trocar de visão mantém o período que a pessoa estava olhando", () => {
    // Quem olha a semana de 10 a 16 de agosto e clica em "Mensal" quer agosto,
    // não o mês atual.
    expect(normalizeAnchor("month", "2026-08-10")).toBe("2026-08-01");
    expect(normalizeAnchor("week", "2026-08-01")).toBe("2026-07-27");
  });
});

describe("grade do mês (§3)", () => {
  it("monta semanas de 7 dias, de segunda a domingo", () => {
    const weeks = monthMatrix("2026-08-01");

    for (const week of weeks) expect(week).toHaveLength(7);
    expect(weeks[0]?.[0]).toBe("2026-07-27"); // segunda anterior
    expect(weeks.at(-1)?.at(-1)).toBe("2026-09-06"); // domingo seguinte
  });

  it("o número de linhas acompanha o mês, sem linha vazia sobrando", () => {
    // Fevereiro de 2027 começa numa segunda e tem 28 dias: cabe em 4 linhas.
    expect(monthMatrix("2027-02-01")).toHaveLength(4);
    // Agosto de 2026 precisa de 6.
    expect(monthMatrix("2026-08-01")).toHaveLength(6);
  });

  it("cobre todos os dias do mês, sem repetir nenhum", () => {
    const dias = monthMatrix("2026-08-01").flat();
    expect(new Set(dias).size).toBe(dias.length);
    expect(dias).toContain("2026-08-01");
    expect(dias).toContain("2026-08-31");
  });

  it("distingue o que é do mês do que é sobra", () => {
    expect(isSameMonth("2026-08-31", "2026-08-01")).toBe(true);
    expect(isSameMonth("2026-09-01", "2026-08-01")).toBe(false);
  });
});

describe("semana e ano", () => {
  it("a semana tem 7 dias em ordem", () => {
    expect(weekDays("2026-08-15")).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]);
  });

  it("o ano tem 12 meses, cada um começando no dia 1", () => {
    const meses = yearMonths("2026-06-15");
    expect(meses).toHaveLength(12);
    expect(meses[0]).toEqual({ start: "2026-01-01", label: "Janeiro" });
    expect(meses[11]).toEqual({ start: "2026-12-01", label: "Dezembro" });
  });
});

describe("rótulos", () => {
  it("nomeia o período em português, sem depender do locale do runtime", () => {
    expect(calendarLabel("month", "2026-08-01")).toBe("Agosto de 2026");
    expect(calendarLabel("day", "2026-08-15")).toBe("Sábado, 15 de Agosto de 2026");
    expect(calendarLabel("year", "2026-01-01")).toBe("2026");
  });

  it("a semana dentro do mesmo mês não repete o nome do mês", () => {
    expect(calendarLabel("week", "2026-08-10")).toBe("10 a 16 de Agosto de 2026");
  });

  it("a semana que atravessa a virada nomeia os dois meses", () => {
    expect(calendarLabel("week", "2026-08-31")).toBe("31 de Agosto a 6 de Setembro de 2026");
  });
});

describe("faixas de horário (§8, §9)", () => {
  it("vai das 7h às 21h", () => {
    const slots = hourSlots();
    expect(slots[0]).toBe("07:00");
    expect(slots.at(-1)).toBe("21:00");
    expect(slots).toHaveLength(15);
  });

  it("encaixa a palestra na faixa da hora", () => {
    expect(slotOf("09:30")).toBe("09:00");
    expect(slotOf("14:00")).toBe("14:00");
  });

  it("palestra fora da janela NÃO some — encosta no limite", () => {
    // Perder uma palestra das 6h por causa de uma decisão de layout seria bem
    // pior que uma linha imprecisa.
    expect(slotOf("06:00")).toBe("07:00");
    expect(slotOf("23:30")).toBe("21:00");
  });

  it("sem horário não vira hora nenhuma", () => {
    expect(slotOf(null)).toBeNull();
  });
});

describe("§26 a duração acompanha o arrasto", () => {
  it("mantém o intervalo ao mover o início", () => {
    expect(shiftedEndTime("09:00", "10:00", "15:00")).toBe("16:00");
    expect(shiftedEndTime("14:00", "17:30", "09:00")).toBe("12:30");
  });

  it("sem término, continua sem término", () => {
    expect(shiftedEndTime("09:00", null, "15:00")).toBeNull();
  });

  it("sem início original, o término é preservado como está", () => {
    expect(shiftedEndTime(null, "10:00", "15:00")).toBe("10:00");
  });

  it("limpa o término em vez de atravessar a meia-noite", () => {
    // Inventar "23:59" seria escrever um dado que ninguém pediu; em branco é
    // honesto, e a pessoa preenche.
    expect(shiftedEndTime("09:00", "12:00", "22:00")).toBeNull();
  });
});
