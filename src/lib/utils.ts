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
