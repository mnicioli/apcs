"use client";

import Link from "next/link";
import {
  WEEKDAY_LABELS,
  dayOfMonth,
  hourSlots,
  slotOf,
  weekDays,
} from "@/modules/lecture/lecture.calendar";
import { newLectureHref } from "@/modules/lecture/lecture.routes";
import { compareByTime } from "@/modules/lecture/lecture.rules";
import type { Lecture } from "@/modules/lecture/lecture.types";
import { Card, CardContent } from "@/components/ui/card";
import { LectureChip } from "./lecture-chip";
import { lecturesOfDay, type DragHandlers } from "./calendar-board";

/**
 * VISÃO SEMANAL (§8) — sete dias, distribuídos por horário.
 *
 * ⚠️ A LINHA "SEM HORÁRIO" existe porque uma palestra pode não ter hora ainda: o
 * §13 deixa o horário opcional enquanto a solicitação está em análise. Encaixá-la
 * numa hora inventada seria mentir sobre um dado que ninguém preencheu; deixá-la
 * de fora esconderia da agenda uma palestra que está marcada para aquele dia.
 *
 * A grade vai das 7h às 21h. Uma palestra fora dessa janela não some — `slotOf`
 * a encosta na faixa mais próxima, porque perder uma palestra das 6h por causa
 * de uma decisão de layout seria bem pior que uma linha imprecisa.
 */
export function CalendarWeek({
  anchor,
  today,
  lectures,
  canWrite,
  drag,
}: {
  anchor: string;
  today: string;
  lectures: Lecture[];
  canWrite: boolean;
  drag: DragHandlers;
}) {
  const dias = weekDays(anchor);
  const horas = hourSlots();

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-4xl border-collapse">
            <caption className="sr-only">Calendário semanal das palestras, das 7h às 21h.</caption>
            <thead>
              <tr className="text-muted-foreground border-border border-b text-xs">
                <th scope="col" className="w-16 px-2 py-2 font-medium">
                  <span className="sr-only">Horário</span>
                </th>
                {dias.map((date, index) => (
                  <th key={date} scope="col" className="px-2 py-2 font-medium">
                    <span className={date === today ? "text-primary-strong" : ""}>
                      {WEEKDAY_LABELS[index]} {dayOfMonth(date)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-border border-b">
                <th
                  scope="row"
                  className="text-muted-foreground w-16 px-2 py-2 text-left text-[11px] font-medium"
                >
                  Sem horário
                </th>
                {dias.map((date) => (
                  <Slot
                    key={date}
                    date={date}
                    lectures={lecturesOfDay(lectures, date).filter((l) => !l.startTime)}
                    canWrite={canWrite}
                    drag={drag}
                  />
                ))}
              </tr>

              {horas.map((hora) => (
                <tr key={hora} className="border-border border-b last:border-0">
                  <th
                    scope="row"
                    className="text-muted-foreground w-16 px-2 py-2 text-left align-top font-mono text-[11px] font-normal"
                  >
                    {hora}
                  </th>
                  {dias.map((date) => (
                    <Slot
                      key={`${date}-${hora}`}
                      date={date}
                      time={hora}
                      lectures={lecturesOfDay(lectures, date).filter(
                        (l) => slotOf(l.startTime) === hora,
                      )}
                      canWrite={canWrite}
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

/**
 * Uma célula de (dia × hora) — alvo de soltura e, quando vazia, atalho de
 * criação com data e horário já preenchidos (§29).
 */
export function Slot({
  date,
  time,
  lectures,
  canWrite,
  drag,
}: {
  date: string;
  time?: string;
  lectures: Lecture[];
  canWrite: boolean;
  drag: DragHandlers;
}) {
  const ordenadas = [...lectures].sort(compareByTime);

  return (
    <td
      onDragOver={(event) => {
        if (drag.draggable && drag.draggingId) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        drag.onDrop({ date, time });
      }}
      className="border-border h-14 border-r p-1 align-top last:border-r-0"
    >
      <div className="space-y-1">
        {ordenadas.map((lecture) => (
          <LectureChip
            key={lecture.id}
            lecture={lecture}
            draggable={drag.draggable}
            dragging={drag.draggingId === lecture.id}
            onDragStart={drag.onDragStart}
            onDragEnd={drag.onDragEnd}
          />
        ))}

        {canWrite && ordenadas.length === 0 && (
          <Link
            href={newLectureHref({ date, startTime: time })}
            aria-label={
              time
                ? `Nova palestra em ${dayOfMonth(date)} às ${time}`
                : `Nova palestra em ${dayOfMonth(date)}`
            }
            className="text-muted-foreground/0 hover:text-muted-foreground hover:bg-muted block rounded text-center text-xs transition-colors"
          >
            +
          </Link>
        )}
      </div>
    </td>
  );
}
