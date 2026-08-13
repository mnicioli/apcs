import { normalizeForSearch } from "@/lib/utils";
import type {
  EventEffectiveStatus,
  EventFilters,
  EventStatusReason,
  EventSummary,
} from "./event.types";

/**
 * As regras de Eventos — puras, sem I/O, testáveis uma a uma.
 *
 * O que é regra de NEGÓCIO com garantia (não ativar evento passado, autoria não
 * forjável, uma edição por vez) vive no banco, porque é lá que a garantia
 * precisa valer mesmo com duas telas concorrentes. O que está aqui é a LEITURA
 * dessas regras: o que exibir, como ordenar, o que filtrar.
 *
 * ⚠️ `effectiveStatus` é o coração do módulo. Ele espelha, em TypeScript, a
 * mesma comparação que `public.event_today()` faz no Postgres — e as duas
 * pontas precisam concordar, porque uma decide o que a tela mostra e a outra
 * decide o que o banco aceita.
 */

/** O mínimo que basta para decidir se um evento está no ar. */
type StatusInput = Pick<EventSummary, "status" | "eventDate">;

/**
 * O status que VALE agora.
 *
 * A propriedade que faz este desenho funcionar: **a derivação só sabe
 * rebaixar**. Um evento inativado à mão continua inativo por mais que a data
 * seja futura — a passagem do tempo nunca reativa nada. Por isso "expiração não
 * pode ressuscitar evento inativado manualmente" não é uma regra a lembrar,
 * é uma impossibilidade estrutural.
 *
 * `today` é injetado (e não lido do relógio aqui dentro) por dois motivos: o
 * teste não depende da data em que roda, e a página inteira decide o "hoje"
 * uma vez só, em vez de cada linha da grid consultar o relógio.
 */
export function effectiveStatus(event: StatusInput, today: string): EventEffectiveStatus {
  if (event.status === "inactive") return "inactive";
  // Comparação de STRING, não de `Date`. Em ISO (AAAA-MM-DD) a ordem
  // lexicográfica é exatamente a ordem do calendário, e não há fuso no caminho
  // para deslizar um dia.
  return event.eventDate < today ? "expired" : "active";
}

/** Por que o evento não está no ar — a `status_reason` do escopo, derivada. */
export function statusReason(event: StatusInput, today: string): EventStatusReason | null {
  const effective = effectiveStatus(event, today);
  if (effective === "active") return null;
  return effective === "expired" ? "expired" : "manual";
}

/** Um evento expirado não pode ser ativado — a regra que o banco também impõe. */
export function canActivate(event: StatusInput, today: string): boolean {
  return event.status !== "active" && event.eventDate >= today;
}

export function canDeactivate(event: StatusInput): boolean {
  return event.status === "active";
}

/**
 * "14:00:00" → "14:00".
 *
 * Colunas `time` do Postgres chegam com os segundos. Nenhum evento da APCS
 * começa às 14:00:30, e mostrar ":00" três vezes por linha só rouba espaço da
 * grid.
 */
export function formatTime(time: string | null): string {
  if (!time) return "";
  const match = /^(\d{2}):(\d{2})/.exec(time);
  return match ? `${match[1]}:${match[2]}` : "";
}

/** "14:00 às 17:00", ou só "14:00" quando não há hora de término. */
export function formatTimeRange(startTime: string, endTime: string | null): string {
  const start = formatTime(startTime);
  const end = formatTime(endTime);
  if (!start) return "—";
  return end ? `${start} às ${end}` : start;
}

/**
 * Ordem da grid: os PRÓXIMOS primeiro.
 *
 * Passados vão para o fim, e entre eles o mais recente primeiro. Ordenar tudo
 * em ordem crescente pura — a leitura literal de "eventos mais próximos
 * primeiro" — colocaria o evento de 2024 no topo, que é o oposto do que a
 * pessoa quer ver ao abrir a tela.
 *
 * Desempate por hora de início e depois por nome, para a ordem ser estável:
 * sem isso, dois eventos no mesmo dia trocariam de lugar entre renderizações.
 */
export function compareEvents(a: EventSummary, b: EventSummary, today: string): number {
  const aPast = a.eventDate < today;
  const bPast = b.eventDate < today;
  if (aPast !== bPast) return aPast ? 1 : -1;

  if (a.eventDate !== b.eventDate) {
    return aPast ? b.eventDate.localeCompare(a.eventDate) : a.eventDate.localeCompare(b.eventDate);
  }

  if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
  return a.name.localeCompare(b.name, "pt-BR");
}

/**
 * Nome + status + período. Vazio em todos = passa tudo.
 *
 * O filtro de status trabalha sobre o status EFETIVO: quem escolhe "Inativo"
 * quer ver tanto os que alguém inativou quanto os que venceram — para quem olha
 * a tela, os dois são "não está no ar". O escopo pede três opções (Todos, Ativo,
 * Inativo), e "Expirado" cai dentro de Inativo.
 */
export function matchesEventFilters(
  event: EventSummary,
  filters: EventFilters,
  today: string,
): boolean {
  if (filters.status !== "all") {
    const effective = effectiveStatus(event, today);
    const isActive = effective === "active";
    if (filters.status === "active" && !isActive) return false;
    if (filters.status === "inactive" && isActive) return false;
  }

  // Inclusivo nas duas pontas: quem digita 01/08 a 31/08 espera ver o evento do
  // dia 31.
  if (filters.from && event.eventDate < filters.from) return false;
  if (filters.to && event.eventDate > filters.to) return false;

  const query = normalizeForSearch(filters.query);
  if (!query) return true;

  return normalizeForSearch(event.name).includes(query);
}
