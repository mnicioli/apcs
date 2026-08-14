import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Junta classes Tailwind resolvendo conflitos (a última vence). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// `timeZone` explícito: sem ele, o formato usa o fuso do SERVIDOR (UTC na
// maioria das hospedagens) e o time comercial veria os leads 3 horas adiantados.
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

/** Data e hora no formato brasileiro (ex.: 04/08/2026 14:32). */
export function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeZone: "America/Sao_Paulo",
});

/**
 * Chave do dia no calendário de São Paulo, no formato AAAA-MM-DD.
 *
 * O locale `en-CA` é um truque conhecido: é o único que o Intl formata em ISO,
 * o que dá uma chave ordenável sem montar a string à mão.
 */
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * A data de HOJE no fuso da APCS, em AAAA-MM-DD.
 *
 * É a referência de "hoje" de todo o sistema — em particular, é ela que decide
 * se um evento já expirou. Sem o `timeZone` explícito, a virada do dia seguiria
 * o relógio do SERVIDOR (UTC na Vercel), e das 21h à meia-noite o Brasil
 * enxergaria o dia seguinte: um evento de hoje apareceria como expirado.
 *
 * Espelha `public.event_today()` no Postgres. As duas pontas precisam concordar,
 * porque uma decide o que a tela mostra e a outra decide o que o banco aceita.
 */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return dayKeyFormatter.format(now);
}

/**
 * Data de calendário formatada SEM passar por `Date`.
 *
 * Colunas `date` do Postgres chegam como "2026-08-15", sem hora.
 * `new Date("2026-08-15")` vira meia-noite UTC, que em São Paulo é 21h do dia
 * ANTERIOR — a tela mostraria 14/08 para algo que acontece em 15/08. Um recorte
 * de string não tem fuso, então não tem como errar o dia.
 */
export function formatCalendarDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return "—";

  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/**
 * "14:00:00" → "14:00".
 *
 * Colunas `time` do Postgres chegam com os segundos. Nada que a APCS marca
 * começa às 14:00:30, e mostrar ":00" três vezes por linha só rouba espaço da
 * grid.
 *
 * Mora aqui, e não num módulo, porque Eventos e Palestras fazem exatamente a
 * mesma pergunta sobre o mesmo tipo de coluna — mesmo motivo pelo qual
 * `src/lib/files/image.ts` saiu de dentro de Eventos quando a Bolsa precisou
 * dele. `event.rules.ts` reexporta os dois nomes, então as telas de Eventos
 * seguem importando de onde sempre importaram.
 */
export function formatTime(time: string | null): string {
  if (!time) return "";
  const match = /^(\d{2}):(\d{2})/.exec(time);
  return match ? `${match[1]}:${match[2]}` : "";
}

/** "14:00 às 17:00", ou só "14:00" quando não há hora de término. */
export function formatTimeRange(startTime: string | null, endTime: string | null): string {
  const start = formatTime(startTime);
  const end = formatTime(endTime);
  if (!start) return "—";
  return end ? `${start} às ${end}` : start;
}

/**
 * Normaliza para busca: sem acento e sem caixa.
 *
 * Sem isto, procurar "camara" não acharia "Câmara" — e ninguém digita acento
 * numa caixa de busca. `NFD` separa a letra do acento e a faixa `\p{Diacritic}`
 * remove só os acentos, preservando "ç" → "c" e mantendo o resto intacto.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Tamanho de arquivo legível: "842 KB", "3,4 MB".
 *
 * Uma casa decimal nos megabytes: entre 4,9 MB e 5 MB está a diferença entre
 * passar e ser recusado no upload, e "5 MB" nos dois casos não explicaria a
 * recusa a ninguém.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;

  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;

  return `${(kb / 1024).toFixed(1).replace(".", ",")} MB`;
}

function calendarDaysBetween(from: Date, to: Date): number {
  // A conta é feita sobre a DATA DO CALENDÁRIO em São Paulo, não sobre a
  // diferença de milissegundos. Um lead criado às 23h30 daqui é 02h30 UTC do
  // dia seguinte: subtrair timestamps diria "ontem" quando ainda é "hoje" para
  // quem está olhando a tela.
  const fromDay = new Date(`${dayKeyFormatter.format(from)}T00:00:00Z`).getTime();
  const toDay = new Date(`${dayKeyFormatter.format(to)}T00:00:00Z`).getTime();
  return Math.round((toDay - fromDay) / 86_400_000);
}

/**
 * Quanto tempo faz, em linguagem de quem lê ("ontem", "3 dias").
 *
 * Passada uma semana volta à data absoluta: "12 dias" obriga a pessoa a fazer
 * a conta de cabeça, enquanto "26/07/2026" ela lê direto.
 *
 * `now` é injetável para o teste não depender do relógio.
 */
export function formatRelativeDate(isoDate: string, now: Date = new Date()): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "—";

  const days = calendarDaysBetween(date, now);

  // Data no futuro (relógio do servidor atrasado, por exemplo): trata como hoje
  // em vez de exibir "-1 dias".
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 7) return `${days} dias`;
  return dateFormatter.format(date);
}

/**
 * Mesma ideia, com resolução de relógio: "agora", "há 12 min", "há 3 h".
 *
 * Existe por causa da fila da Central de Atendimento. Ali "hoje" não ajuda
 * ninguém a decidir o que fazer primeiro — a diferença entre alguém que pediu
 * atendimento há dez minutos e alguém que pediu de manhã é o dia inteiro do
 * operador. Passado um dia, a precisão deixa de importar e cai em
 * `formatRelativeDate`.
 */
export function formatRelativeTime(isoDate: string, now: Date = new Date()): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "—";

  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);

  // Negativo = data no futuro (relógio do servidor fora de sincronia). "agora"
  // é a leitura honesta; "há -3 min" seria só um bug exposto na tela.
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;

  return formatRelativeDate(isoDate, now);
}
