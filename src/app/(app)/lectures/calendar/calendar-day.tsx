"use client";

import { hourSlots, slotOf } from "@/modules/lecture/lecture.calendar";
import type { Lecture } from "@/modules/lecture/lecture.types";
import { Card, CardContent } from "@/components/ui/card";
import { Slot } from "./calendar-week";
import { lecturesOfDay, type DragHandlers } from "./calendar-board";

/**
 * VISÃO DIÁRIA (§9) — a agenda de um dia só.
 *
 * É a visão semanal com uma coluna, e reaproveita a mesma célula (`Slot`): a
 * mecânica de soltar, criar e listar é idêntica, e duplicá-la só criaria duas
 * versões da mesma coisa para uma delas envelhecer.
 *
 * A linha "Sem horário" vem primeiro pelo mesmo motivo da semanal: uma palestra
 * marcada para hoje sem hora definida precisa aparecer, e não há hora em que
 * encaixá-la sem inventar um dado.
 */
export function CalendarDay({
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
  const doDia = lecturesOfDay(lectures, anchor);
  const semHorario = doDia.filter((lecture) => !lecture.startTime);

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full border-collapse">
          <caption className="sr-only">
            Agenda do dia {anchor}
            {anchor === today ? " (hoje)" : ""}
          </caption>
          <tbody>
            <tr className="border-border border-b">
              <th
                scope="row"
                className="text-muted-foreground w-24 px-3 py-2 text-left text-xs font-medium"
              >
                Sem horário
              </th>
              <Slot date={anchor} lectures={semHorario} canWrite={canWrite} drag={drag} />
            </tr>

            {hourSlots().map((hora) => (
              <tr key={hora} className="border-border border-b last:border-0">
                <th
                  scope="row"
                  className="text-muted-foreground w-24 px-3 py-2 text-left align-top font-mono text-xs font-normal"
                >
                  {hora}
                </th>
                <Slot
                  date={anchor}
                  time={hora}
                  lectures={doDia.filter((lecture) => slotOf(lecture.startTime) === hora)}
                  canWrite={canWrite}
                  drag={drag}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
