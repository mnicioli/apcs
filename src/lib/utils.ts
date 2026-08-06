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
