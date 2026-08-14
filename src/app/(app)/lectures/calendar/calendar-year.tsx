"use client";

import Link from "next/link";
import {
  WEEKDAY_LABELS,
  dayOfMonth,
  isSameMonth,
  monthMatrix,
  yearMonths,
} from "@/modules/lecture/lecture.calendar";
import { lectureCalendarHref } from "@/modules/lecture/lecture.routes";
import type { Lecture, LectureFilters } from "@/modules/lecture/lecture.types";
import { Card, CardContent } from "@/components/ui/card";

/**
 * VISÃO ANUAL (§10) — os doze meses de uma vez.
 *
 * O que ela responde é "em que época do ano a APCS tem palestra?", e por isso
 * mostra DENSIDADE, não conteúdo: cada dia com palestra fica marcado, e o número
 * aparece só quando há mais de uma. Desenhar nome e horário em 365 células
 * transformaria a tela numa parede ilegível.
 *
 * Clicar num dia leva à visão diária; clicar no nome do mês leva à mensal (§10)
 * — sempre carregando os filtros junto (§48).
 *
 * ⚠️ SEM ARRASTO aqui, e é decisão: uma célula de dia nesta escala tem poucos
 * pixels, e errar o dia num calendário de ano inteiro é mais fácil que acertar.
 * Quem quer remarcar desce para o mês.
 */
export function CalendarYear({
  anchor,
  today,
  lectures,
  filters,
}: {
  anchor: string;
  today: string;
  lectures: Lecture[];
  filters: LectureFilters;
}) {
  // Uma passada só sobre a lista, e o resto é consulta por chave. Contar dentro
  // do laço dos 365 dias seria varrer a lista inteira 365 vezes.
  const porDia = new Map<string, number>();
  for (const lecture of lectures) {
    porDia.set(lecture.eventDate, (porDia.get(lecture.eventDate) ?? 0) + 1);
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {yearMonths(anchor).map((month) => (
        <Card key={month.start}>
          <CardContent className="space-y-2 p-3">
            <Link
              href={lectureCalendarHref({ view: "month", anchor: month.start, filters })}
              className="hover:text-primary-strong block text-sm font-semibold transition-colors"
            >
              {month.label}
            </Link>

            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">
                {month.label} de {anchor.slice(0, 4)}
              </caption>
              <thead>
                <tr className="text-muted-foreground text-[10px]">
                  {WEEKDAY_LABELS.map((label) => (
                    <th key={label} scope="col" className="pb-1 font-normal">
                      {label.slice(0, 1)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthMatrix(month.start).map((week) => (
                  <tr key={week[0]}>
                    {week.map((date) => (
                      <DayDot
                        key={date}
                        date={date}
                        month={month.start}
                        today={today}
                        count={porDia.get(date) ?? 0}
                        filters={filters}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DayDot({
  date,
  month,
  today,
  count,
  filters,
}: {
  date: string;
  month: string;
  today: string;
  count: number;
  filters: LectureFilters;
}) {
  // Dias das pontas dos meses vizinhos ficam em branco: eles já aparecem no
  // quadro do mês a que pertencem, e repeti-los aqui contaria a mesma palestra
  // duas vezes na leitura do ano.
  if (!isSameMonth(date, month)) {
    return <td className="p-0.5" />;
  }

  const hoje = date === today;
  const dia = dayOfMonth(date);

  return (
    <td className="p-0.5 text-center">
      <Link
        href={lectureCalendarHref({ view: "day", anchor: date, filters })}
        aria-label={
          count === 0
            ? `Dia ${dia}, nenhuma palestra`
            : `Dia ${dia}, ${count} ${count === 1 ? "palestra" : "palestras"}`
        }
        className={`focus-visible:ring-ring inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] transition-colors focus-visible:ring-2 focus-visible:outline-none ${
          hoje
            ? "bg-primary text-primary-foreground font-semibold"
            : count > 0
              ? "bg-accent text-primary-strong font-medium"
              : "text-muted-foreground hover:bg-muted"
        }`}
      >
        {/* Com mais de uma palestra o número do dia dá lugar à contagem: é a
            informação que a visão anual existe para dar. */}
        {count > 1 ? `${count}×` : dia}
      </Link>
    </td>
  );
}
