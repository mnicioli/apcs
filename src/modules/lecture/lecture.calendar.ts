/**
 * A ARITMÉTICA DO CALENDÁRIO — pura, sem I/O, sem fuso.
 *
 * ⚠️ TODA conta acontece em UTC, e o resultado sai como string AAAA-MM-DD.
 *
 * O motivo é o mesmo que já obrigou `formatCalendarDate` a fatiar string em vez
 * de usar `Date`: `new Date("2026-08-15")` é meia-noite UTC, que em São Paulo é
 * 21h do dia ANTERIOR. Num calendário, esse deslize não erra um rótulo — ele põe
 * a palestra na célula errada. Construir com `Date.UTC` e ler com `getUTC*`
 * elimina o fuso do caminho inteiro, e o resultado é o mesmo em qualquer
 * máquina.
 *
 * A semana começa na SEGUNDA, como o escopo desenha (SEG TER QUA QUI SEX SÁB
 * DOM) e como o Brasil lê um calendário de trabalho.
 */

/**
 * As visões, NA ORDEM EM QUE APARECEM NO SELETOR — do período mais curto para o
 * mais longo.
 *
 * ⚠️ A ordem é conteúdo, não estética. A lista antiga começava pela mensal (a
 * padrão) e as outras vinham atrás sem critério: Mensal, Semanal, Diária, Anual.
 * Lida da esquerda para a direita, ela ia do meio para o começo e depois pulava
 * para o fim — e quem quer "abrir mais" ou "fechar mais" o zoom não tinha para
 * onde olhar. Do dia ao ano, cada passo é um degrau na mesma direção.
 *
 * ⚠️ ORDEM DE EXIBIÇÃO ≠ PADRÃO. A visão que abre continua sendo a MENSAL, e é
 * `DEFAULT_CALENDAR_VIEW` quem diz isso — nunca a primeira posição do array.
 * Foi por isso que este comentário existe: a próxima pessoa que reordenar a
 * lista não pode mudar o que a tela abre sem perceber.
 */
export const CALENDAR_VIEWS = ["day", "week", "month", "year"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** O escopo pede que a visão padrão seja a mensal. */
export const DEFAULT_CALENDAR_VIEW: CalendarView = "month";

export function isCalendarView(value: string): value is CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(value);
}

/** Um período fechado, inclusivo nas duas pontas — o que a API do calendário recebe. */
export interface CalendarRange {
  start: string;
  end: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `true` para uma data de calendário válida de verdade (2026-02-31 não é). */
export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = toDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

/**
 * Soma meses ANCORANDO NO DIA 1.
 *
 * Somar mês sobre o dia 31 é uma armadilha clássica: 31/01 + 1 mês vira 31/02,
 * que o `Date` normaliza para 03/03 — e o botão "próximo mês" pularia
 * fevereiro. Como toda navegação por mês parte do primeiro dia, ancorar aqui
 * resolve o problema na origem em vez de remendar depois.
 */
export function addMonths(iso: string, months: number): string {
  const date = toDate(iso);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  return toIso(target);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  return addDays(addMonths(startOfMonth(iso), 1), -1);
}

/** O índice do dia da semana com SEGUNDA = 0 (o `getUTCDay` usa domingo = 0). */
function weekdayIndex(iso: string): number {
  return (toDate(iso).getUTCDay() + 6) % 7;
}

export function startOfWeek(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

export function endOfWeek(iso: string): string {
  return addDays(startOfWeek(iso), 6);
}

export function startOfYear(iso: string): string {
  return `${iso.slice(0, 4)}-01-01`;
}

export function endOfYear(iso: string): string {
  return `${iso.slice(0, 4)}-12-31`;
}

/**
 * O período que a visão precisa buscar (§56).
 *
 * É esta função que impede o calendário de carregar o histórico inteiro para
 * desenhar um mês: cada visão pede exatamente o intervalo que exibe.
 */
export function calendarRange(view: CalendarView, anchor: string): CalendarRange {
  switch (view) {
    case "month":
      // ⚠️ O mês pede MAIS que o próprio mês: a grade mensal mostra as pontas
      // dos meses vizinhos, e sem elas aqueles dias apareceriam sempre vazios —
      // parecendo que não há palestra quando há.
      return { start: startOfWeek(startOfMonth(anchor)), end: endOfWeek(endOfMonth(anchor)) };
    case "week":
      return { start: startOfWeek(anchor), end: endOfWeek(anchor) };
    case "day":
      return { start: anchor, end: anchor };
    case "year":
      return { start: startOfYear(anchor), end: endOfYear(anchor) };
  }
}

/** Anterior (`-1`) e próximo (`1`), na unidade da visão. */
export function shiftAnchor(view: CalendarView, anchor: string, step: -1 | 1): string {
  switch (view) {
    case "month":
      return addMonths(startOfMonth(anchor), step);
    case "week":
      return addDays(startOfWeek(anchor), step * 7);
    case "day":
      return addDays(anchor, step);
    case "year":
      return addMonths(startOfYear(anchor), step * 12);
  }
}

/**
 * A âncora normalizada da visão.
 *
 * Guardar "15/08" como âncora do mês faria "próximo mês" e "mês anterior"
 * dependerem do dia clicado. Normalizar aqui deixa a navegação previsível: a
 * mesma visão, a partir de qualquer dia dela, avança para o mesmo lugar.
 */
export function normalizeAnchor(view: CalendarView, anchor: string): string {
  switch (view) {
    case "month":
      return startOfMonth(anchor);
    case "week":
      return startOfWeek(anchor);
    case "day":
      return anchor;
    case "year":
      return startOfYear(anchor);
  }
}

/**
 * A GRADE DO MÊS: semanas de 7 dias, de segunda a domingo.
 *
 * Inclui as pontas dos meses vizinhos para as linhas ficarem completas — é
 * assim que todo calendário é lido. `isSameMonth` distingue o que é do mês e o
 * que é sobra, para a tela apagar visualmente as sobras.
 *
 * O número de linhas varia entre 4 e 6 conforme o mês: fevereiro de um ano não
 * bissexto começando numa segunda cabe em 4; um mês de 31 dias começando num
 * domingo precisa de 6. Gerar sempre 6 acrescentaria uma linha vazia na maioria
 * dos meses.
 */
export function monthMatrix(anchor: string): string[][] {
  const first = startOfWeek(startOfMonth(anchor));
  const last = endOfWeek(endOfMonth(anchor));

  const weeks: string[][] = [];
  let cursor = first;

  while (cursor <= last) {
    const week: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }

  return weeks;
}

/** Os 7 dias da semana da âncora, de segunda a domingo. */
export function weekDays(anchor: string): string[] {
  const first = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

/** Os 12 meses do ano da âncora, cada um com a própria grade. */
export function yearMonths(anchor: string): { start: string; label: string }[] {
  const first = startOfYear(anchor);
  return Array.from({ length: 12 }, (_, index) => {
    const start = addMonths(first, index);
    return { start, label: MONTH_LABELS[index] ?? "" };
  });
}

export function isSameMonth(iso: string, anchor: string): boolean {
  return iso.slice(0, 7) === anchor.slice(0, 7);
}

export function isWeekend(iso: string): boolean {
  return weekdayIndex(iso) >= 5;
}

// ----------------------------------------------------------------------------
// Rótulos
// ----------------------------------------------------------------------------

/**
 * Os meses vêm de uma LISTA EXPLÍCITA, e não de `Intl`.
 *
 * `Intl.DateTimeFormat` daria o mesmo resultado com uma dependência a mais: o
 * locale disponível no runtime. O Node da Vercel traz ICU completo, mas isso é
 * configuração de hospedagem, não garantia — e um calendário que mostra "August"
 * em produção é o tipo de defeito que só aparece depois do deploy. É a mesma
 * razão pela qual o nome da publicação da Bolsa não usa `to_char(..., 'Mon')`.
 */
export const MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

export const MONTH_SHORT_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

/** Cabeçalho da grade. A semana começa na SEGUNDA, como o escopo desenha. */
export const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"] as const;

export const WEEKDAY_FULL_LABELS = [
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Domingo",
] as const;

export function monthLabel(iso: string): string {
  return MONTH_LABELS[Number(iso.slice(5, 7)) - 1] ?? "";
}

export function weekdayLabel(iso: string): string {
  return WEEKDAY_FULL_LABELS[weekdayIndex(iso)] ?? "";
}

export function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

/** O título do período: o que a pessoa lê para saber onde está. */
export function calendarLabel(view: CalendarView, anchor: string): string {
  const ano = anchor.slice(0, 4);

  switch (view) {
    case "month":
      return `${monthLabel(anchor)} de ${ano}`;
    case "week": {
      const first = startOfWeek(anchor);
      const last = endOfWeek(anchor);
      // Semana que atravessa a virada do mês precisa nomear os dois; dentro do
      // mesmo mês, repetir o nome só ocuparia espaço.
      if (isSameMonth(first, last)) {
        return `${dayOfMonth(first)} a ${dayOfMonth(last)} de ${monthLabel(first)} de ${last.slice(0, 4)}`;
      }
      return `${dayOfMonth(first)} de ${monthLabel(first)} a ${dayOfMonth(last)} de ${monthLabel(last)} de ${last.slice(0, 4)}`;
    }
    case "day":
      return `${weekdayLabel(anchor)}, ${dayOfMonth(anchor)} de ${monthLabel(anchor)} de ${ano}`;
    case "year":
      return ano;
  }
}

/** O rótulo do botão de navegação, por visão — para o `aria-label` dizer o que faz. */
export const CALENDAR_VIEW_LABELS: Record<CalendarView, string> = {
  month: "Mensal",
  week: "Semanal",
  day: "Diária",
  year: "Anual",
};

export const CALENDAR_PREVIOUS_LABELS: Record<CalendarView, string> = {
  month: "Mês anterior",
  week: "Semana anterior",
  day: "Dia anterior",
  year: "Ano anterior",
};

export const CALENDAR_NEXT_LABELS: Record<CalendarView, string> = {
  month: "Próximo mês",
  week: "Próxima semana",
  day: "Próximo dia",
  year: "Próximo ano",
};

/** "Hoje" muda de nome conforme a unidade — "hoje" num calendário anual é o ano. */
export const CALENDAR_TODAY_LABELS: Record<CalendarView, string> = {
  month: "Hoje",
  week: "Hoje",
  day: "Hoje",
  year: "Ano atual",
};

// ----------------------------------------------------------------------------
// Faixas de horário (visões semanal e diária)
// ----------------------------------------------------------------------------

/**
 * A grade de horas das visões semanal e diária.
 *
 * Começa às 7h e termina às 21h porque é a janela em que uma palestra da APCS
 * acontece. Palestras fora dela não somem: `slotOf` encaixa qualquer horário na
 * faixa mais próxima dentro dos limites — perder uma palestra das 6h da manhã
 * por causa de uma decisão de layout seria bem pior que uma linha a mais.
 */
export const FIRST_HOUR = 7;
export const LAST_HOUR = 21;

export function hourSlots(): string[] {
  return Array.from(
    { length: LAST_HOUR - FIRST_HOUR + 1 },
    (_, index) => `${String(FIRST_HOUR + index).padStart(2, "0")}:00`,
  );
}

/**
 * A faixa em que a palestra aparece. `null` quando ela ainda não tem horário —
 * essas vão para uma linha própria, "Sem horário definido", e não são inventadas
 * em nenhuma hora.
 */
export function slotOf(startTime: string | null): string | null {
  if (!startTime) return null;

  const hour = Number(startTime.slice(0, 2));
  if (!Number.isFinite(hour)) return null;

  const clamped = Math.min(Math.max(hour, FIRST_HOUR), LAST_HOUR);
  return `${String(clamped).padStart(2, "0")}:00`;
}

function toMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function fromMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * O novo horário de TÉRMINO quando o arrasto move o início — preservando a
 * duração.
 *
 * ⚠️ Sem isto, arrastar uma palestra de 09:00–10:00 para as 15:00 deixaria o
 * término em 10:00, ou seja, ANTES do início: o diálogo abriria já inválido e a
 * pessoa teria que corrigir à mão um campo em que não encostou. Mover uma
 * palestra de uma hora continua sendo uma palestra de uma hora.
 *
 * Devolve `null` — isto é, término em branco — nos dois casos em que preservar a
 * duração não faz sentido: quando não havia término, e quando a duração original
 * jogaria o fim para depois da meia-noite. Deixar em branco é honesto; inventar
 * "23:59" seria escrever um dado que ninguém pediu.
 */
export function shiftedEndTime(
  startTime: string | null,
  endTime: string | null,
  newStartTime: string,
): string | null {
  if (!endTime) return null;
  if (!startTime) return endTime;

  const duration = toMinutes(endTime) - toMinutes(startTime);
  if (duration <= 0) return null;

  const next = toMinutes(newStartTime) + duration;
  if (next > 24 * 60 - 1) return null;

  return fromMinutes(next);
}
