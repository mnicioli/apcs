"use client";

import { useEffect, useState } from "react";
import { CircleCheck } from "lucide-react";
import type { CalendarView } from "@/modules/lecture/lecture.calendar";
import type { Lecture, LectureFilters } from "@/modules/lecture/lecture.types";
import { LectureScheduleDialog } from "../lecture-schedule-dialog";
import { CalendarDay } from "./calendar-day";
import { CalendarMonth } from "./calendar-month";
import { CalendarWeek } from "./calendar-week";
import { CalendarYear } from "./calendar-year";

/**
 * O QUADRO DO CALENDÁRIO — a parte que precisa de cliente.
 *
 * A página é servidor: ela busca o período e decide permissões. O que desce
 * para cá é só o que exige interação — o arrastar-e-soltar (§26) e o diálogo de
 * confirmação que ele dispara.
 *
 * ⚠️ SOLTAR NÃO REAGENDA. Soltar abre a confirmação, como o §26 exige, e a
 * palestra só muda de lugar depois que o servidor responde (§27). Enquanto isso
 * ela continua desenhada onde estava — é o que o §28 chama de "nunca deixar a
 * UI em estado inconsistente". Nada aqui move um objeto local por conta própria.
 *
 * A visão ANUAL não aceita arrasto: uma célula de 12×31 dias não tem alvo
 * grande o bastante para a operação ser confiável, e errar o dia num calendário
 * de ano inteiro é mais fácil que acertar.
 */
export interface DropTarget {
  date: string;
  /** "HH:MM" nas visões com grade de hora; ausente na mensal. */
  time?: string;
}

export interface DragHandlers {
  draggable: boolean;
  draggingId: string | null;
  onDragStart: (lecture: Lecture) => void;
  onDragEnd: () => void;
  onDrop: (target: DropTarget) => void;
}

export function CalendarBoard({
  view,
  anchor,
  today,
  lectures,
  canWrite,
  filters,
}: {
  view: CalendarView;
  anchor: string;
  today: string;
  lectures: Lecture[];
  canWrite: boolean;
  filters: LectureFilters;
}) {
  const [dragging, setDragging] = useState<Lecture | null>(null);
  const [pending, setPending] = useState<{ lecture: Lecture; target: DropTarget } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 6000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const handlers: DragHandlers = {
    // A visão anual fica de fora do arrasto, e o Atendente também: ele vê a
    // agenda, não a remarca.
    draggable: canWrite && view !== "year",
    draggingId: dragging?.id ?? null,
    onDragStart: setDragging,
    onDragEnd: () => setDragging(null),
    onDrop: (target) => {
      if (!dragging) return;

      // Soltar no mesmo lugar não é uma alteração — abrir a confirmação ali
      // faria a pessoa responder a uma pergunta sobre nada.
      const mesmoDia = dragging.eventDate === target.date;
      const mesmaHora = !target.time || dragging.startTime === target.time;
      if (mesmoDia && mesmaHora) {
        setDragging(null);
        return;
      }

      setPending({ lecture: dragging, target });
      setDragging(null);
    },
  };

  return (
    <div className="space-y-3">
      {feedback && (
        <p
          role="status"
          className="border-border bg-muted/50 flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          {feedback}
        </p>
      )}

      {view === "month" && (
        <CalendarMonth
          anchor={anchor}
          today={today}
          lectures={lectures}
          canWrite={canWrite}
          filters={filters}
          drag={handlers}
        />
      )}

      {view === "week" && (
        <CalendarWeek
          anchor={anchor}
          today={today}
          lectures={lectures}
          canWrite={canWrite}
          drag={handlers}
        />
      )}

      {view === "day" && (
        <CalendarDay
          anchor={anchor}
          today={today}
          lectures={lectures}
          canWrite={canWrite}
          drag={handlers}
        />
      )}

      {view === "year" && (
        <CalendarYear anchor={anchor} today={today} lectures={lectures} filters={filters} />
      )}

      {handlers.draggable && (
        <p className="text-muted-foreground text-xs">
          Arraste uma palestra para outro dia ou horário para reagendá-la — a mudança pede
          confirmação. Pelo teclado, use o botão “Reagendar” na tela da palestra.
        </p>
      )}

      {pending && (
        <LectureScheduleDialog
          lecture={pending.lecture}
          open
          onOpenChange={(next) => {
            if (!next) setPending(null);
          }}
          suggested={{ eventDate: pending.target.date, startTime: pending.target.time }}
          trigger={false}
          // ⚠️ `onDone` NÃO fecha o diálogo, e isso é o oposto do óbvio.
          //
          // Quando o reagendamento encontra conflito, o diálogo PRECISA continuar
          // aberto para mostrar o aviso (§25) — quem decide fechá-lo é ele
          // mesmo, chamando `onOpenChange(false)`. Desmontá-lo aqui, junto com a
          // mensagem de sucesso, apagava o alerta no mesmo instante em que ele
          // aparecia: o reagendamento acontecia e o aviso nunca era visto.
          onDone={setFeedback}
        />
      )}
    </div>
  );
}

/** As palestras de um dia, na ordem em que o calendário as desenha. */
export function lecturesOfDay(lectures: Lecture[], date: string): Lecture[] {
  return lectures.filter((lecture) => lecture.eventDate === date);
}
