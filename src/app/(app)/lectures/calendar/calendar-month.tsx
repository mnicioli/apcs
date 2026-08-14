"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import {
  WEEKDAY_LABELS,
  dayOfMonth,
  isSameMonth,
  isWeekend,
  monthMatrix,
} from "@/modules/lecture/lecture.calendar";
import { lectureCalendarHref, newLectureHref } from "@/modules/lecture/lecture.routes";
import { compareByTime } from "@/modules/lecture/lecture.rules";
import type { Lecture, LectureFilters } from "@/modules/lecture/lecture.types";
import { Card, CardContent } from "@/components/ui/card";
import { LectureChip } from "./lecture-chip";
import { lecturesOfDay, type DragHandlers } from "./calendar-board";

/**
 * VISÃO MENSAL (§3) — a visão padrão.
 *
 * A grade vai de segunda a domingo e inclui as pontas dos meses vizinhos, como
 * todo calendário; os dias de fora aparecem apagados. O número de linhas varia
 * com o mês (`monthMatrix` gera 4, 5 ou 6) em vez de fixar 6 e deixar uma linha
 * vazia na maioria dos meses.
 *
 * Cada célula é um ALVO DE SOLTURA (§26). Sem horário no alvo: na visão mensal
 * quem solta escolhe o DIA, e o horário atual é mantido — o diálogo de
 * confirmação mostra os dois para quem quiser ajustar.
 */
export function CalendarMonth({
  anchor,
  today,
  lectures,
  canWrite,
  filters,
  drag,
}: {
  anchor: string;
  today: string;
  lectures: Lecture[];
  canWrite: boolean;
  filters: LectureFilters;
  drag: DragHandlers;
}) {
  const weeks = monthMatrix(anchor);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-3xl table-fixed border-collapse">
            <caption className="sr-only">
              Calendário mensal das palestras. Cada célula é um dia do mês.
            </caption>
            <thead>
              <tr className="text-muted-foreground border-border border-b text-xs">
                {WEEKDAY_LABELS.map((label) => (
                  <th key={label} scope="col" className="px-2 py-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0]} className="border-border border-b last:border-0">
                  {week.map((date) => (
                    <DayCell
                      key={date}
                      date={date}
                      anchor={anchor}
                      today={today}
                      lectures={lecturesOfDay(lectures, date).sort(compareByTime)}
                      canWrite={canWrite}
                      filters={filters}
                      drag={drag}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function DayCell({
  date,
  anchor,
  today,
  lectures,
  canWrite,
  filters,
  drag,
}: {
  date: string;
  anchor: string;
  today: string;
  lectures: Lecture[];
  canWrite: boolean;
  filters: LectureFilters;
  drag: DragHandlers;
}) {
  const doMes = isSameMonth(date, anchor);
  const hoje = date === today;

  return (
    <td
      // ⚠️ `preventDefault` no `dragover` é o que ATIVA a soltura. Sem ele o
      // navegador recusa o drop e o arrasto simplesmente não acontece — é o erro
      // clássico de drag-and-drop em HTML.
      onDragOver={(event) => {
        if (drag.draggable && drag.draggingId) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        drag.onDrop({ date });
      }}
      className={`border-border h-28 border-r p-1 align-top last:border-r-0 ${
        doMes ? "" : "bg-muted/30"
      } ${isWeekend(date) && doMes ? "bg-muted/20" : ""}`}
    >
      <div className="flex h-full flex-col gap-1">
        <div className="flex items-center justify-between">
          <Link
            href={lectureCalendarHref({ view: "day", anchor: date, filters })}
            className={`hover:bg-muted inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs transition-colors ${
              hoje ? "bg-primary text-primary-foreground font-semibold" : ""
            } ${doMes ? "" : "text-muted-foreground"}`}
            aria-label={`Ver o dia ${dayOfMonth(date)}`}
          >
            {dayOfMonth(date)}
          </Link>

          {/* §29: criar clicando num espaço do calendário. É um botão explícito,
              e não a célula inteira clicável — a célula também recebe cliques
              nas palestras, e um alvo que faz duas coisas erra uma delas. */}
          {canWrite && (
            <Link
              href={newLectureHref({ date })}
              aria-label={`Nova palestra em ${dayOfMonth(date)}`}
              className="text-muted-foreground hover:text-foreground hover:bg-muted rounded p-0.5 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 [td:hover_&]:opacity-100"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {lectures.map((lecture) => (
            <LectureChip
              key={lecture.id}
              lecture={lecture}
              draggable={drag.draggable}
              dragging={drag.draggingId === lecture.id}
              onDragStart={drag.onDragStart}
              onDragEnd={drag.onDragEnd}
            />
          ))}
        </div>
      </div>
    </td>
  );
}
