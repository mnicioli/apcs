import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDown, ArrowUp, CalendarDays, Plus } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listLectureCities, listLectures, listLectureSpeakers } from "@/lib/services/lectures";
import { searchDirectory } from "@/lib/services/profile";
import { formatCalendarDate, formatTimeRange, todayInSaoPaulo } from "@/lib/utils";
import {
  LECTURE_FORMAT_LABELS,
  LECTURE_MODULE_SUBTITLE,
  LECTURE_MODULE_TITLE,
  LECTURE_ORIGIN_SHORT_LABELS,
  LECTURE_PRIORITY_LABELS,
  LECTURE_SORT_LABELS,
  LECTURE_STAGE_HINTS,
  LECTURE_STAGE_LABELS,
  LECTURE_STATUS_LABELS,
  LECTURE_TYPE_LABELS,
} from "@/modules/lecture/lecture.labels";
import {
  isLectureFiltered,
  lectureCalendarHref,
  lectureHref,
  lecturesHref,
  newLectureHref,
  parseLectureFilters,
  parseLecturePage,
  parseLectureSort,
  type RawSearchParams,
} from "@/modules/lecture/lecture.routes";
import {
  actorLabel,
  lectureStage,
  speakerLabel,
  typeDescription,
} from "@/modules/lecture/lecture.rules";
import type {
  Lecture,
  LectureFilters,
  LectureSort,
  LectureSortField,
} from "@/modules/lecture/lecture.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LectureFiltersBar } from "./lecture-filters";
import { LecturePagination } from "./lecture-pagination";
import {
  ORIGIN_BADGE_VARIANT,
  PRIORITY_BADGE_VARIANT,
  STAGE_BADGE_VARIANT,
  STATUS_BADGE_VARIANT,
} from "./lecture-badges";

export const metadata: Metadata = { title: LECTURE_MODULE_TITLE };

/**
 * A GRID DE PALESTRAS.
 *
 * ⚠️ Diferente das grids de Eventos e da Bolsa, esta é PAGINADA NO SERVIDOR
 * (§18). O motivo é o volume: o chatbot gera solicitações continuamente, e uma
 * lista que cresce sozinha não pode ser carregada inteira para filtrar no
 * navegador. Filtro, busca, ordenação e página viram SQL — ver
 * `listLectures`.
 *
 * A permissão é checada aqui (1ª camada) e a RLS de `lectures` filtra no banco
 * (2ª camada) — as duas contam a mesma história. O `redirect` protege a ROTA:
 * esconder o item do menu não impede ninguém de digitar o endereço.
 */
export default async function LecturesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "lectures.read")) redirect("/dashboard");

  const params = await searchParams;
  const filters = parseLectureFilters(params);
  const sort = parseLectureSort(params);
  const { page, pageSize } = parseLecturePage(params);

  // "Hoje" é apurado UMA vez e desce para tudo que depende dele. Duas leituras
  // do relógio na mesma renderização podem cair em dias diferentes na virada da
  // meia-noite, e aí a grid discordaria dela mesma.
  const today = todayInSaoPaulo();

  const [result, directory, speakers, cities] = await Promise.all([
    listLectures(filters, sort, page, pageSize),
    searchDirectory(),
    listLectureSpeakers(),
    listLectureCities(),
  ]);

  const canWrite = hasPermission(role, "lectures.write");
  const filtrado = isLectureFiltered(filters);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{LECTURE_MODULE_TITLE}</h1>
          <p className="text-muted-foreground text-sm">{LECTURE_MODULE_SUBTITLE}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Os filtros viajam junto (§48): quem filtrou "Toledo, confirmadas"
              e clica em Calendário continua vendo Toledo e confirmadas. */}
          <Button variant="outline" asChild>
            <Link href={lectureCalendarHref({ filters })}>
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              Calendário
            </Link>
          </Button>

          {/* §20: quem não pode criar não vê o botão. A autoridade continua
              sendo a action, que checa `lectures.write` de novo. */}
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

      <LectureFiltersBar
        filters={filters}
        directory={directory}
        speakers={speakers}
        cities={cities}
      />

      {result.items.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            {/* ⚠️ TRÊS vazios diferentes, e confundi-los mente para quem está
                olhando. "Não existe palestra nenhuma", "o filtro não achou nada"
                e "esta PÁGINA não existe mais" pedem saídas diferentes — e a
                terceira é a que mais engana: dizer "nenhuma palestra encontrada"
                para quem tem 36 no banco manda a pessoa procurar um problema que
                não existe.

                A página vazia acontece de verdade: quem guardou nos favoritos a
                página 3 de um filtro que hoje devolve dez linhas, e quem está na
                página 3 quando uma mudança de situação encolhe a lista. */}
            <p className="text-muted-foreground text-sm">
              {result.total > 0
                ? `Esta página não tem mais resultados. A lista tem ${result.total} ${
                    result.total === 1 ? "palestra" : "palestras"
                  }.`
                : filtrado
                  ? "Nenhuma palestra encontrada para os filtros selecionados."
                  : "Nenhuma palestra encontrada."}
            </p>

            {result.total > 0 ? (
              <Button variant="outline" asChild>
                {/* Volta para o começo MANTENDO filtros e ordenação: o recorte
                    estava certo, só a página é que passou do fim. */}
                <Link href={lecturesHref({ filters, sort })}>Voltar para a primeira página</Link>
              </Button>
            ) : filtrado ? (
              <Button variant="outline" asChild>
                <Link href={lecturesHref()}>Limpar filtros</Link>
              </Button>
            ) : (
              canWrite && (
                <Button asChild>
                  <Link href={newLectureHref()}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Nova palestra
                  </Link>
                </Button>
              )
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              {/* §49: em tela pequena a grid rola na horizontal em vez de
                  espremer onze colunas até ninguém conseguir ler. */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Palestras da APCS, {result.total} no total, ordenadas por{" "}
                    {LECTURE_SORT_LABELS[sort.field]}
                  </caption>
                  <thead className="text-muted-foreground border-border border-b text-left">
                    <tr>
                      <Th>Protocolo</Th>
                      <Th>Palestra</Th>
                      <SortableTh
                        field="eventDate"
                        sort={sort}
                        filters={filters}
                        pageSize={pageSize}
                      >
                        Data
                      </SortableTh>
                      <SortableTh field="city" sort={sort} filters={filters} pageSize={pageSize}>
                        Cidade
                      </SortableTh>
                      <Th className="hidden lg:table-cell">Tipo</Th>
                      <Th className="hidden xl:table-cell">Formato</Th>
                      <SortableTh field="status" sort={sort} filters={filters} pageSize={pageSize}>
                        Situação
                      </SortableTh>
                      <Th className="hidden lg:table-cell">Responsável</Th>
                      <Th className="hidden xl:table-cell">Palestrante</Th>
                      <Th>Origem</Th>
                      <SortableTh
                        field="priority"
                        sort={sort}
                        filters={filters}
                        pageSize={pageSize}
                        className="hidden lg:table-cell"
                      >
                        Prioridade
                      </SortableTh>
                      <SortableTh
                        field="requestedAt"
                        sort={sort}
                        filters={filters}
                        pageSize={pageSize}
                        className="hidden xl:table-cell"
                      >
                        Solicitada em
                      </SortableTh>
                      <Th>Ações</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((lecture) => (
                      <LectureRow key={lecture.id} lecture={lecture} today={today} />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <LecturePagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            filters={filters}
            sort={sort}
          />
        </>
      )}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 font-medium whitespace-nowrap${className ? ` ${className}` : ""}`}
    >
      {children}
    </th>
  );
}

/**
 * Cabeçalho que ordena (§17).
 *
 * É um LINK, não um botão com JavaScript: a ordenação acontece no SQL, então
 * mudar a ordem é navegar. `aria-sort` diz ao leitor de tela qual coluna está
 * ordenando e em que sentido — sem ele, a seta é informação só para quem
 * enxerga.
 *
 * Clicar na coluna já ordenada INVERTE o sentido; clicar em outra começa
 * descendente, que é o que quase sempre se quer ao trocar de critério ("as datas
 * mais recentes primeiro").
 */
function SortableTh({
  field,
  sort,
  filters,
  pageSize,
  className,
  children,
}: {
  field: LectureSortField;
  sort: LectureSort;
  filters: LectureFilters;
  pageSize: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ativo = sort.field === field;
  const ascending = ativo ? !sort.ascending : false;

  return (
    <th
      scope="col"
      aria-sort={ativo ? (sort.ascending ? "ascending" : "descending") : "none"}
      className={`px-4 py-3 font-medium whitespace-nowrap${className ? ` ${className}` : ""}`}
    >
      <Link
        // Trocar a ordem volta para a PÁGINA 1: manter a página 3 de uma ordem
        // que já não existe mostraria um pedaço arbitrário do meio da lista.
        href={lecturesHref({ filters, sort: { field, ascending }, page: 1, pageSize })}
        className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
      >
        {children}
        {ativo &&
          (sort.ascending ? (
            <ArrowUp className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden="true" />
          ))}
      </Link>
      {ativo && (
        <span className="sr-only">
          {sort.ascending ? "ordenado de forma crescente" : "ordenado de forma decrescente"}
        </span>
      )}
    </th>
  );
}

function LectureRow({ lecture, today }: { lecture: Lecture; today: string }) {
  const stage = lectureStage(lecture, today);

  return (
    <tr className="border-border hover:bg-muted/50 border-b align-middle last:border-0">
      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
        <Link href={lectureHref(lecture.id)} className="text-primary-strong hover:underline">
          {lecture.protocol}
        </Link>
      </td>

      <td className="max-w-64 px-4 py-3">
        <Link href={lectureHref(lecture.id)} className="hover:underline">
          <span className="block truncate font-medium">{lecture.name}</span>
        </Link>
        <span className="text-muted-foreground block truncate text-xs">{lecture.theme}</span>
      </td>

      <td className="px-4 py-3 whitespace-nowrap">
        {formatCalendarDate(lecture.eventDate)}
        <span className="text-muted-foreground block text-xs">
          {lecture.startTime ? formatTimeRange(lecture.startTime, lecture.endTime) : "Sem horário"}
        </span>
      </td>

      <td className="px-4 py-3 whitespace-nowrap">{lecture.city}</td>

      <td className="hidden max-w-40 truncate px-4 py-3 lg:table-cell">
        {typeDescription(lecture, LECTURE_TYPE_LABELS)}
      </td>

      <td className="text-muted-foreground hidden px-4 py-3 whitespace-nowrap xl:table-cell">
        {lecture.format ? LECTURE_FORMAT_LABELS[lecture.format] : "—"}
      </td>

      <td className="px-4 py-3">
        <Badge variant={STATUS_BADGE_VARIANT[lecture.status]}>
          {LECTURE_STATUS_LABELS[lecture.status]}
        </Badge>
        {/* ⚠️ A ETAPA derivada só aparece quando ela DIVERGE do status: uma
            palestra confirmada cuja data já passou provavelmente aconteceu e
            ninguém fechou o registro. Mostrar os dois selos sempre viraria
            ruído; mostrar só neste caso é o aviso. */}
        {stage === "awaiting_outcome" && (
          <span className="mt-1 block">
            <Badge variant={STAGE_BADGE_VARIANT[stage]} title={LECTURE_STAGE_HINTS[stage]}>
              {LECTURE_STAGE_LABELS[stage]}
            </Badge>
          </span>
        )}
      </td>

      <td className="text-muted-foreground hidden max-w-40 truncate px-4 py-3 lg:table-cell">
        {actorLabel(lecture.responsible) ?? "—"}
      </td>

      <td className="text-muted-foreground hidden max-w-40 truncate px-4 py-3 xl:table-cell">
        {speakerLabel(lecture) ?? "—"}
      </td>

      <td className="px-4 py-3">
        {/* §39: a solicitação que veio de fora tem alguém esperando resposta —
            é isso que o selo separa. */}
        <Badge variant={ORIGIN_BADGE_VARIANT[lecture.origin]}>
          {LECTURE_ORIGIN_SHORT_LABELS[lecture.origin]}
        </Badge>
      </td>

      <td className="hidden px-4 py-3 lg:table-cell">
        <Badge variant={PRIORITY_BADGE_VARIANT[lecture.priority]}>
          {LECTURE_PRIORITY_LABELS[lecture.priority]}
        </Badge>
      </td>

      <td className="text-muted-foreground hidden px-4 py-3 text-xs whitespace-nowrap xl:table-cell">
        {formatCalendarDate(lecture.requestedAt.slice(0, 10))}
      </td>

      <td className="px-4 py-3">
        <Link
          href={lectureHref(lecture.id)}
          className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-8 items-center rounded-md px-3 text-xs transition-colors"
        >
          Abrir
        </Link>
      </td>
    </tr>
  );
}
