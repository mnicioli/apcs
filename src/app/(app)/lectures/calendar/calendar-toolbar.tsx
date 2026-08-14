import Link from "next/link";
import { ChevronLeft, ChevronRight, List, Plus } from "lucide-react";
import {
  CALENDAR_NEXT_LABELS,
  CALENDAR_PREVIOUS_LABELS,
  CALENDAR_TODAY_LABELS,
  CALENDAR_VIEWS,
  CALENDAR_VIEW_LABELS,
  calendarLabel,
  normalizeAnchor,
  shiftAnchor,
  type CalendarView,
} from "@/modules/lecture/lecture.calendar";
import {
  lectureCalendarHref,
  lecturesHref,
  newLectureHref,
} from "@/modules/lecture/lecture.routes";
import type { LectureFilters } from "@/modules/lecture/lecture.types";
import { Button } from "@/components/ui/button";

/**
 * A BARRA DO CALENDÁRIO (§6, §7).
 *
 * Tudo aqui são LINKS, não botões com JavaScript: o calendário é renderizado no
 * servidor e cada período busca só o seu intervalo (§56), então navegar é
 * navegar. De quebra, o botão "voltar" do navegador funciona, dá para abrir um
 * mês em nova aba e o endereço pode ser mandado para alguém.
 *
 * ⚠️ TODO link carrega os FILTROS junto (§48). Trocar de mês, de visão ou ir
 * para "hoje" não pode desfazer o recorte que a pessoa montou — é o tipo de
 * detalhe que faz alguém desistir de usar os filtros.
 *
 * A troca de visão MANTÉM a âncora, normalizada para a nova unidade: quem está
 * olhando a semana de 10 a 16 de agosto e clica em "Mensal" quer agosto, não o
 * mês atual.
 */
export function CalendarToolbar({
  view,
  anchor,
  today,
  filters,
  canWrite,
}: {
  view: CalendarView;
  anchor: string;
  today: string;
  filters: LectureFilters;
  canWrite: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" asChild>
            <Link
              href={lectureCalendarHref({
                view,
                anchor: shiftAnchor(view, anchor, -1),
                filters,
              })}
              aria-label={CALENDAR_PREVIOUS_LABELS[view]}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>

          <Button variant="outline" size="icon" asChild>
            <Link
              href={lectureCalendarHref({
                view,
                anchor: shiftAnchor(view, anchor, 1),
                filters,
              })}
              aria-label={CALENDAR_NEXT_LABELS[view]}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        <Button variant="outline" asChild>
          <Link href={lectureCalendarHref({ view, anchor: normalizeAnchor(view, today), filters })}>
            {CALENDAR_TODAY_LABELS[view]}
          </Link>
        </Button>

        {/* `aria-live` porque o título é a única coisa que diz onde a navegação
            parou — sem isso, quem usa leitor de tela clica em "próximo mês" e
            não ouve nada.

            ⚠️ SEM `capitalize`: a classe do Tailwind põe maiúscula em TODA
            palavra e transformava "Agosto de 2026" em "Agosto De 2026".
            `calendarLabel` já devolve o texto na caixa certa. */}
        <h2 className="text-lg font-semibold tracking-tight" aria-live="polite">
          {calendarLabel(view, anchor)}
        </h2>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="border-border inline-flex rounded-md border p-0.5"
          role="group"
          aria-label="Modo de visualização"
        >
          {CALENDAR_VIEWS.map((option) => {
            const ativo = option === view;
            return (
              <Link
                key={option}
                href={lectureCalendarHref({
                  view: option,
                  anchor: normalizeAnchor(option, anchor),
                  filters,
                })}
                aria-current={ativo ? "true" : undefined}
                className={`rounded px-3 py-1 text-sm transition-colors ${
                  ativo ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
                }`}
              >
                {CALENDAR_VIEW_LABELS[option]}
              </Link>
            );
          })}
        </div>

        <Button variant="outline" asChild>
          <Link href={lecturesHref({ filters })}>
            <List className="h-4 w-4" aria-hidden="true" />
            Lista
          </Link>
        </Button>

        {canWrite && (
          <Button asChild>
            <Link href={newLectureHref()}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nova palestra
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
