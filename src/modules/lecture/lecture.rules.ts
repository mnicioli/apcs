import type {
  Lecture,
  LectureActor,
  LectureStage,
  LectureStatus,
  LectureTransition,
} from "./lecture.types";
import { SCHEDULED_LECTURE_STATUSES, TERMINAL_LECTURE_STATUSES } from "./lecture.types";

/**
 * As regras de Palestras — puras, sem I/O, testáveis uma a uma.
 *
 * O que é regra de NEGÓCIO com garantia (o grafo de status, os campos
 * imutáveis, os motivos obrigatórios, uma edição por vez) vive no banco, porque
 * é lá que a garantia precisa valer mesmo com duas telas concorrentes. O que
 * está aqui é a LEITURA dessas regras: o que exibir, o que habilitar, o que
 * avisar.
 *
 * ⚠️ NENHUMA função aqui decide sozinha se uma transição é permitida. Elas
 * recebem o GRAFO como parâmetro — o mesmo que o banco impõe, lido de
 * `lecture_status_transitions`. Uma cópia local seria a segunda fonte da
 * verdade que o módulo inteiro foi desenhado para não ter.
 */

// ----------------------------------------------------------------------------
// Grafo de status
// ----------------------------------------------------------------------------

/** Os status que podem vir a seguir, na ordem do fluxo. */
export function nextStatuses(
  graph: readonly LectureTransition[],
  from: LectureStatus,
): LectureStatus[] {
  return graph.filter((edge) => edge.from === from).map((edge) => edge.to);
}

/** Os status com que uma palestra pode nascer (`from` nulo no grafo). */
export function entryStatuses(graph: readonly LectureTransition[]): LectureStatus[] {
  return graph.filter((edge) => edge.from === null).map((edge) => edge.to);
}

export function canTransition(
  graph: readonly LectureTransition[],
  from: LectureStatus,
  to: LectureStatus,
): boolean {
  return graph.some((edge) => edge.from === from && edge.to === to);
}

export function isTerminal(status: LectureStatus): boolean {
  return TERMINAL_LECTURE_STATUSES.includes(status);
}

/** Ocupa horário na agenda — os mesmos status que o banco considera no conflito. */
export function occupiesAgenda(status: LectureStatus): boolean {
  return SCHEDULED_LECTURE_STATUSES.includes(status);
}

// ----------------------------------------------------------------------------
// Leitura derivada (§53, §56)
// ----------------------------------------------------------------------------

type StageInput = Pick<Lecture, "status" | "eventDate">;

/**
 * Em que ponto a palestra está, olhando também para o calendário.
 *
 * A propriedade que faz este desenho funcionar: **a derivação nunca escreve**.
 * Uma palestra confirmada cuja data passou continua CONFIRMADA no banco; só a
 * leitura muda, para `awaiting_outcome`. É o §53 ("avaliar automaticamente")
 * sem violar o §56 ("não marcar como realizada só porque a data passou").
 *
 * `today` é injetado (e não lido do relógio aqui dentro) por dois motivos: o
 * teste não depende da data em que roda, e a página inteira decide o "hoje" uma
 * vez só, em vez de cada linha da grid consultar o relógio.
 */
export function lectureStage(lecture: StageInput, today: string): LectureStage {
  if (isTerminal(lecture.status)) return "closed";
  if (!occupiesAgenda(lecture.status)) return "pending";

  // Comparação de STRING, não de `Date`. Em ISO (AAAA-MM-DD) a ordem
  // lexicográfica é exatamente a ordem do calendário, e não há fuso no caminho
  // para deslizar um dia.
  return lecture.eventDate < today ? "awaiting_outcome" : "scheduled";
}

/** A palestra aconteceu (ou deveria ter acontecido) e ninguém fechou o registro. */
export function isAwaitingOutcome(lecture: StageInput, today: string): boolean {
  return lectureStage(lecture, today) === "awaiting_outcome";
}

/** Ainda em jogo: não foi realizada, rejeitada nem cancelada. */
export function isOpen(lecture: Pick<Lecture, "status">): boolean {
  return !isTerminal(lecture.status);
}

// ----------------------------------------------------------------------------
// Conflito de horário (§33)
// ----------------------------------------------------------------------------

/** O que basta para saber se duas palestras disputam o mesmo espaço de tempo. */
export interface TimeSlot {
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
}

/**
 * Duas palestras se sobrepõem?
 *
 * ⚠️ ESPELHA O `OVERLAPS` DO POSTGRES, caso a caso — e os casos foram
 * conferidos contra o banco antes de esta função existir:
 *
 *   10:00–11:00 × 10:30–11:30   conflita
 *   10:00–11:00 × 11:00–12:00   NÃO conflita  (encostar não é sobrepor:
 *                                              palestras em sequência são
 *                                              normais)
 *   10:00–11:00 × 10:00–11:00   conflita
 *   10:00       × 09:00–11:00   conflita      (sem hora de término, a palestra
 *                                              ocupa o instante do início)
 *   10:00       × 10:00         conflita
 *   11:00       × 10:00–11:00   NÃO conflita  (o instante final é aberto)
 *
 * Sem horário de início não há o que comparar: a data ainda é só desejada.
 *
 * Existe em TypeScript para o calendário avisar ENQUANTO a pessoa arrasta, sem
 * ida ao servidor. A autoridade continua sendo `find_lecture_conflicts` — é ela
 * que enxerga as palestras que não estão na tela.
 */
export function overlaps(a: TimeSlot, b: TimeSlot): boolean {
  if (a.eventDate !== b.eventDate) return false;
  if (!a.startTime || !b.startTime) return false;

  const aEnd = a.endTime ?? a.startTime;
  const bEnd = b.endTime ?? b.startTime;

  // Intervalos degenerados (sem término) só conflitam se caírem no mesmo
  // instante ou dentro do outro. O `<` de um lado e o `<` do outro dão
  // exatamente isso — e é por isso que os dois pontos iguais precisam do caso
  // explícito abaixo.
  if (a.startTime === aEnd && b.startTime === bEnd) return a.startTime === b.startTime;

  return a.startTime < bEnd && b.startTime < aEnd;
}

/** As palestras da lista que disputam o horário do slot, exceto ela mesma. */
export function findConflicts<T extends TimeSlot & { id: string; status: LectureStatus }>(
  slot: TimeSlot,
  lectures: readonly T[],
  excludeId?: string,
): T[] {
  return lectures.filter(
    (lecture) =>
      lecture.id !== excludeId && occupiesAgenda(lecture.status) && overlaps(slot, lecture),
  );
}

// ----------------------------------------------------------------------------
// Apresentação
// ----------------------------------------------------------------------------

/**
 * O rótulo do tipo, já resolvendo OUTROS.
 *
 * Mostrar "Outros" sozinho joga fora justamente o dado que o §8 obriga a
 * coletar: qual é o outro.
 */
export function typeDescription(
  lecture: Pick<Lecture, "type" | "typeOther">,
  labels: Record<string, string>,
): string {
  const base = labels[lecture.type] ?? lecture.type;
  return lecture.type === "other" && lecture.typeOther ? `${base}: ${lecture.typeOther}` : base;
}

/**
 * COMO CHAMAR UMA PESSOA NA TELA.
 *
 * ⚠️ Existe por causa de um defeito real, achado no navegador: uma palestra COM
 * palestrante definido aparecia como "Não definido", porque aquele perfil ainda
 * não tinha o nome preenchido. Quem acabou de atribuir olhava a tela e concluía
 * que a operação tinha falhado — o pior tipo de erro, o que mente com cara de
 * verdade.
 *
 * A ordem é nome → e-mail → aviso explícito. O terceiro caso (perfil sem nome e
 * sem e-mail) não deveria existir, mas se existir a tela diz o que está havendo
 * em vez de fingir que não há ninguém ali.
 *
 * `null` — e só `null` — significa NINGUÉM ATRIBUÍDO. Quem chama decide como
 * dizer isso ("—" na grid, "Não definido" no detalhe).
 */
export function actorLabel(actor: LectureActor | null | undefined): string | null {
  if (!actor) return null;
  return actor.fullName?.trim() || actor.email?.trim() || "Usuário sem nome cadastrado";
}

/**
 * COMO CHAMAR O PALESTRANTE NA TELA, venha ele do time ou de fora.
 *
 * ⚠️ É o ÚNICO lugar da interface que precisa saber que palestrante são dois
 * campos (`speaker`, do diretório interno; `speakerCatalog`, do catálogo de
 * nomes). Espalhar esse `??` pelas telas garantiria que uma delas ficasse para
 * trás e mostrasse "Não definido" numa palestra que tem palestrante — o mesmo
 * defeito que `actorLabel` existe para não repetir.
 *
 * `null` significa NINGUÉM DEFINIDO, como em `actorLabel`.
 */
export function speakerLabel(lecture: Pick<Lecture, "speaker" | "speakerCatalog">): string | null {
  return actorLabel(lecture.speaker) ?? lecture.speakerCatalog?.name.trim() ?? null;
}

/**
 * O motivo pelo qual a palestra foi encerrada, qualquer que tenha sido a porta
 * de saída. Nulo quando ela ainda está em jogo.
 */
export function closingReason(
  lecture: Pick<Lecture, "status" | "rejectionReason" | "cancellationReason">,
): string | null {
  if (lecture.status === "rejected") return lecture.rejectionReason;
  if (lecture.status === "cancelled") return lecture.cancellationReason;
  return null;
}

/**
 * Ordem do CALENDÁRIO dentro de um dia: por hora, depois por nome.
 *
 * Palestras sem horário vão para o fim do dia — não porque aconteçam à noite,
 * mas porque ainda não têm hora marcada, e misturá-las com as marcadas faria a
 * coluna do dia parecer desordenada.
 */
export function compareByTime(a: Lecture, b: Lecture): number {
  if (!a.startTime && !b.startTime) return a.name.localeCompare(b.name, "pt-BR");
  if (!a.startTime) return 1;
  if (!b.startTime) return -1;
  if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
  return a.name.localeCompare(b.name, "pt-BR");
}

/** Agrupa por dia (AAAA-MM-DD) para o calendário montar as células. */
export function groupByDate(lectures: readonly Lecture[]): Map<string, Lecture[]> {
  const days = new Map<string, Lecture[]>();

  for (const lecture of lectures) {
    const day = days.get(lecture.eventDate);
    if (day) day.push(lecture);
    else days.set(lecture.eventDate, [lecture]);
  }

  for (const day of days.values()) day.sort(compareByTime);
  return days;
}
