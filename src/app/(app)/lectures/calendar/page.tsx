import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  listLectureCities,
  listLecturesInRange,
  listLectureSpeakers,
} from "@/lib/services/lectures";
import { searchDirectory } from "@/lib/services/profile";
import { todayInSaoPaulo } from "@/lib/utils";
import { calendarRange } from "@/modules/lecture/lecture.calendar";
import {
  isLectureFiltered,
  lectureCalendarHref,
  parseCalendarState,
  parseLectureFilters,
  type RawSearchParams,
} from "@/modules/lecture/lecture.routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LectureFiltersBar } from "../lecture-filters";
import { CalendarBoard } from "./calendar-board";
import { CalendarToolbar } from "./calendar-toolbar";

export const metadata: Metadata = { title: "Calendário de palestras" };

/**
 * O CALENDÁRIO DE PALESTRAS (§2).
 *
 * ⚠️ CADA VISÃO BUSCA SÓ O SEU PERÍODO (§56). `calendarRange` traduz visão +
 * âncora em duas datas, e `listLecturesInRange` consulta exatamente esse
 * intervalo. Nada aqui carrega o histórico para desenhar um mês.
 *
 * A visão mensal pede um pouco MAIS que o mês: a grade mostra as pontas dos
 * meses vizinhos, e sem elas aqueles dias apareceriam sempre vazios — parecendo
 * que não há palestra quando há.
 *
 * A visão, a data e os filtros moram na URL. Isso faz três coisas de uma vez:
 * o servidor pode renderizar (não há estado escondido no cliente), o endereço
 * pode ser compartilhado, e alternar entre calendário e lista preserva o recorte
 * (§48).
 */
export default async function LectureCalendarPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "lectures.read")) redirect("/dashboard");

  const params = await searchParams;

  // "Hoje" é decidido no SERVIDOR, no fuso da APCS. O relógio do navegador pode
  // estar em outro fuso, e o calendário abriria num mês diferente do que a grid
  // considera atual.
  const today = todayInSaoPaulo();
  const { view, anchor } = parseCalendarState(params, today);
  const filters = parseLectureFilters(params);
  const range = calendarRange(view, anchor);

  const [lectures, directory, speakers, cities] = await Promise.all([
    listLecturesInRange(range.start, range.end, filters),
    searchDirectory(),
    listLectureSpeakers(),
    listLectureCities(),
  ]);

  const canWrite = hasPermission(role, "lectures.write");
  const filtrado = isLectureFiltered(filters);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Calendário</h1>
        <p className="text-muted-foreground text-sm">
          As palestras da APCS no período. Solicitações sem data marcada aparecem na{" "}
          <Link href="/lectures" className="text-primary-strong hover:underline">
            lista
          </Link>
          .
        </p>
      </div>

      <CalendarToolbar
        view={view}
        anchor={anchor}
        today={today}
        filters={filters}
        canWrite={canWrite}
      />

      {/* O calendário não filtra por prioridade (o §11 não a lista) nem por
          período: quem escolhe o período aqui é a navegação. */}
      <LectureFiltersBar
        filters={filters}
        directory={directory}
        speakers={speakers}
        cities={cities}
        preserve={{ view, date: anchor }}
        showPriority={false}
        showPeriod={false}
      />

      {/* ⚠️ O AVISO DE VAZIO NÃO SUBSTITUI A GRADE (§51). Um mês sem palestra
          continua sendo um mês: quem chegou aqui para marcar alguma coisa
          precisa do calendário na frente, com o "+" de cada dia. Trocar a grade
          por um cartão de texto obrigaria a pessoa a navegar para outro lugar
          para fazer o que veio fazer. */}
      {lectures.length === 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
            <p className="text-muted-foreground text-sm">
              {filtrado
                ? "Nenhuma palestra encontrada para os filtros selecionados."
                : "Não existem palestras para o período selecionado."}
            </p>
            {filtrado && (
              <Button variant="outline" asChild>
                <Link href={lectureCalendarHref({ view, anchor })}>Limpar filtros</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <CalendarBoard
        view={view}
        anchor={anchor}
        today={today}
        lectures={lectures}
        canWrite={canWrite}
        filters={filters}
      />
    </div>
  );
}
