import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDown, ArrowUp, BarChart3, Plus } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listAudienceRegions, listSurveys } from "@/lib/services/surveys";
import { formatDateTime } from "@/lib/utils";
import {
  SURVEY_MODULE_SUBTITLE,
  SURVEY_MODULE_TITLE,
  SURVEY_SORT_LABELS,
  SURVEY_STAGE_HINTS,
  SURVEY_STAGE_LABELS,
  SURVEY_STATUS_LABELS,
} from "@/modules/survey/survey.labels";
import {
  isSurveyFiltered,
  newSurveyHref,
  parseSurveyFilters,
  parseSurveyPage,
  parseSurveySort,
  surveyHref,
  surveysHref,
  surveysResultsHref,
  type RawSearchParams,
} from "@/modules/survey/survey.routes";
import { surveyStage } from "@/modules/survey/survey.rules";
import type {
  SurveyFilters,
  SurveySort,
  SurveySortField,
  SurveyWithQuestion,
} from "@/modules/survey/survey.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SurveyAudienceShort } from "./survey-audience-summary";
import { STAGE_BADGE_VARIANT, STATUS_BADGE_VARIANT } from "./survey-badges";
import { SurveyFiltersBar } from "./survey-filters";
import { SurveyPagination } from "./survey-pagination";

export const metadata: Metadata = { title: SURVEY_MODULE_TITLE };

/**
 * A GRID DE ENQUETES (§2).
 *
 * Paginada NO SERVIDOR (§6): filtro, busca, ordenação e página viram SQL — ver
 * `listSurveys`. Filtrar depois de paginar devolveria páginas com buracos.
 *
 * A permissão é checada aqui (1ª camada) e a RLS filtra no banco (2ª camada) —
 * as duas contam a mesma história. O `redirect` protege a ROTA: esconder o item
 * do menu não impede ninguém de digitar o endereço (§56).
 *
 * ⚠️ O §2 sugere onze colunas, e aqui há sete. É o próprio §2 pedindo: "não
 * exibir excesso de informação na grid; priorizar leitura rápida". Respostas e
 * taxa de participação são a matéria da tela de RESULTADOS — na grid elas
 * custariam uma consulta de métricas por linha e ainda competiriam com a
 * informação que faz alguém abrir a enquete.
 */
export default async function SurveysPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "surveys.read")) redirect("/dashboard");

  const params = await searchParams;
  const filters = parseSurveyFilters(params);
  const sort = parseSurveySort(params);
  const { page, pageSize } = parseSurveyPage(params);

  const [result, regions] = await Promise.all([
    listSurveys(
      filters,
      { field: sort.field, direction: sort.ascending ? "asc" : "desc" },
      page,
      pageSize,
    ),
    listAudienceRegions(),
  ]);

  const canWrite = hasPermission(role, "surveys.write");
  const filtrado = isSurveyFiltered(filters);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{SURVEY_MODULE_TITLE}</h1>
          <p className="text-muted-foreground text-sm">{SURVEY_MODULE_SUBTITLE}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Os filtros viajam junto (§59): quem filtrou "ativas de agosto" e
              clica em Resultados continua vendo ativas de agosto. */}
          <Button variant="outline" asChild>
            <Link href={surveysResultsHref({ filters })}>
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              Resultados
            </Link>
          </Button>

          {/* §9: quem não pode criar não vê o botão. A autoridade continua sendo
              a action, que checa `surveys.write` de novo. */}
          {canWrite && (
            <Button asChild>
              <Link href={newSurveyHref()}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Nova enquete
              </Link>
            </Button>
          )}
        </div>
      </div>

      <SurveyFiltersBar filters={filters} regions={regions} />

      {result.items.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            {/* ⚠️ TRÊS vazios diferentes (§60), e confundi-los mente para quem
                está olhando. "Não existe enquete nenhuma", "o filtro não achou
                nada" e "esta PÁGINA não existe mais" pedem saídas diferentes — e
                a terceira é a que mais engana: dizer "nenhuma enquete
                encontrada" para quem tem 36 no banco manda a pessoa procurar um
                problema que não existe. */}
            <p className="text-muted-foreground text-sm">
              {result.total > 0
                ? `Esta página não tem mais resultados. A lista tem ${result.total} ${
                    result.total === 1 ? "enquete" : "enquetes"
                  }.`
                : filtrado
                  ? "Nenhuma enquete encontrada para os filtros selecionados."
                  : "Nenhuma enquete encontrada."}
            </p>

            {result.total > 0 ? (
              <Button variant="outline" asChild>
                {/* Volta para o começo MANTENDO filtros e ordenação: o recorte
                    estava certo, só a página é que passou do fim. */}
                <Link href={surveysHref({ filters, sort })}>Voltar para a primeira página</Link>
              </Button>
            ) : filtrado ? (
              <Button variant="outline" asChild>
                <Link href={surveysHref()}>Limpar filtros</Link>
              </Button>
            ) : (
              canWrite && (
                <Button asChild>
                  <Link href={newSurveyHref()}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Nova enquete
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
              {/* §52: em tela pequena a grid rola na horizontal em vez de
                  espremer sete colunas até ninguém conseguir ler. */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Enquetes da APCS, {result.total} no total, ordenadas por{" "}
                    {SURVEY_SORT_LABELS[sort.field]}
                  </caption>
                  <thead className="text-muted-foreground border-border border-b text-left">
                    <tr>
                      <SortableTh field="title" sort={sort} filters={filters} pageSize={pageSize}>
                        Enquete
                      </SortableTh>
                      <SortableTh field="status" sort={sort} filters={filters} pageSize={pageSize}>
                        Situação
                      </SortableTh>
                      <Th className="hidden lg:table-cell">Público</Th>
                      <SortableTh
                        field="startsAt"
                        sort={sort}
                        filters={filters}
                        pageSize={pageSize}
                        className="hidden md:table-cell"
                      >
                        Início
                      </SortableTh>
                      <SortableTh
                        field="endsAt"
                        sort={sort}
                        filters={filters}
                        pageSize={pageSize}
                        className="hidden md:table-cell"
                      >
                        Encerramento
                      </SortableTh>
                      <SortableTh
                        field="createdAt"
                        sort={sort}
                        filters={filters}
                        pageSize={pageSize}
                        className="hidden xl:table-cell"
                      >
                        Criada em
                      </SortableTh>
                      <Th>Ações</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((survey) => (
                      <SurveyRow key={survey.id} survey={survey} />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <SurveyPagination
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
 * Cabeçalho que ordena (§7).
 *
 * É um LINK, não um botão com JavaScript: a ordenação acontece no SQL, então
 * mudar a ordem é navegar. `aria-sort` diz ao leitor de tela qual coluna está
 * ordenando e em que sentido — sem ele, a seta é informação só para quem
 * enxerga (§61).
 */
function SortableTh({
  field,
  sort,
  filters,
  pageSize,
  className,
  children,
}: {
  field: SurveySortField;
  sort: SurveySort;
  filters: SurveyFilters;
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
        href={surveysHref({ filters, sort: { field, ascending }, page: 1, pageSize })}
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

function SurveyRow({ survey }: { survey: SurveyWithQuestion }) {
  const stage = surveyStage(survey);

  return (
    <tr className="border-border hover:bg-muted/50 border-b align-middle last:border-0">
      <td className="max-w-80 px-4 py-3">
        <Link href={surveyHref(survey.id)} className="hover:underline">
          <span className="block truncate font-medium">{survey.title}</span>
        </Link>
        {/* A PERGUNTA embaixo do título (§2): é ela que diz do que a enquete
            trata, e o título quase sempre a resume. */}
        <span className="text-muted-foreground block truncate text-xs">
          {survey.question?.text ?? "Sem pergunta cadastrada"}
        </span>
      </td>

      <td className="px-4 py-3">
        <Badge variant={STATUS_BADGE_VARIANT[survey.status]}>
          {SURVEY_STATUS_LABELS[survey.status]}
        </Badge>
        {/* ⚠️ A ETAPA derivada só aparece quando DIVERGE da situação: uma
            enquete ativa cuja data de encerramento já passou não aceita mais
            resposta, mas continua rotulada "Ativa" até alguém encerrar. Mostrar
            os dois selos sempre viraria ruído; mostrar só neste caso é o aviso. */}
        {stage === "expired" && (
          <span className="mt-1 block">
            <Badge variant={STAGE_BADGE_VARIANT[stage]} title={SURVEY_STAGE_HINTS[stage]}>
              {SURVEY_STAGE_LABELS[stage]}
            </Badge>
          </span>
        )}
      </td>

      <td className="text-muted-foreground hidden max-w-56 px-4 py-3 lg:table-cell">
        <SurveyAudienceShort criteria={survey.audience} />
      </td>

      <td className="text-muted-foreground hidden px-4 py-3 text-xs whitespace-nowrap md:table-cell">
        {survey.startsAt ? formatDateTime(survey.startsAt) : "—"}
      </td>

      <td className="text-muted-foreground hidden px-4 py-3 text-xs whitespace-nowrap md:table-cell">
        {survey.endsAt ? formatDateTime(survey.endsAt) : "—"}
      </td>

      <td className="text-muted-foreground hidden px-4 py-3 text-xs whitespace-nowrap xl:table-cell">
        {formatDateTime(survey.createdAt)}
      </td>

      <td className="px-4 py-3">
        <Link
          href={surveyHref(survey.id)}
          className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-8 items-center rounded-md px-3 text-xs transition-colors"
        >
          Abrir
        </Link>
      </td>
    </tr>
  );
}
