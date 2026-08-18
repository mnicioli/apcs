import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getSurveyMetricsBatch, listAudienceRegions, listSurveys } from "@/lib/services/surveys";
import { formatDateTime } from "@/lib/utils";
import { SURVEY_SORT_LABELS, SURVEY_STATUS_LABELS } from "@/modules/survey/survey.labels";
import {
  isSurveyFiltered,
  parseSurveyFilters,
  parseSurveyPage,
  parseSurveySort,
  surveyResultsHref,
  surveysHref,
  surveysResultsHref,
  type RawSearchParams,
} from "@/modules/survey/survey.routes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { STATUS_BADGE_VARIANT } from "../survey-badges";
import { SurveyFiltersBar } from "../survey-filters";
import { formatarPercentual } from "../survey-metrics-cards";
import { SurveyPagination } from "../survey-pagination";

export const metadata: Metadata = { title: "Resultados das enquetes" };

/**
 * A TELA GERAL DE RESULTADOS (§59).
 *
 * É a leitura de quem quer comparar campanhas, não investigar uma: uma linha por
 * enquete, com respostas e taxa de participação lado a lado. Para o detalhe de
 * uma delas, abre-se a enquete.
 *
 * ⚠️ AS MÉTRICAS VÊM EM LOTE (§64). Uma consulta para as 20 linhas da página, e
 * não 20 consultas — é para isso que `survey_metrics_batch` existe.
 *
 * ⚠️ Compartilha a barra de filtros e a serialização com a grid: quem filtrou
 * "ativas de agosto" e veio para cá continua vendo ativas de agosto.
 */
export default async function SurveysResultsPage({
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

  const metrics = await getSurveyMetricsBatch(result.items.map((s) => s.id));
  const filtrado = isSurveyFiltered(filters);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href={surveysHref({ filters })}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Enquetes
          </Link>
        </Button>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Resultados</h1>
          <p className="text-muted-foreground text-sm">
            Quantas pessoas responderam cada enquete, e quanto isso representa do público alcançado.
          </p>
        </div>
      </div>

      <SurveyFiltersBar filters={filters} regions={regions} />

      {result.items.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-muted-foreground text-sm">
              {filtrado
                ? "Nenhuma enquete encontrada para os filtros selecionados."
                : "Nenhuma enquete encontrada."}
            </p>
            {filtrado && (
              <Button variant="outline" asChild>
                <Link href={surveysResultsHref()}>Limpar filtros</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Resultados das enquetes, {result.total} no total, ordenadas por{" "}
                    {SURVEY_SORT_LABELS[sort.field]}
                  </caption>
                  <thead className="text-muted-foreground border-border border-b text-left">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Enquete
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Situação
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Público
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Respostas
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Participação
                      </th>
                      <th
                        scope="col"
                        className="hidden px-4 py-3 font-medium whitespace-nowrap lg:table-cell"
                      >
                        Encerramento
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((survey) => {
                      const m = metrics.get(survey.id);
                      return (
                        <tr
                          key={survey.id}
                          className="border-border hover:bg-muted/50 border-b align-middle last:border-0"
                        >
                          <td className="max-w-80 px-4 py-3">
                            <Link href={surveyResultsHref(survey.id)} className="hover:underline">
                              <span className="block truncate font-medium">{survey.title}</span>
                            </Link>
                            <span className="text-muted-foreground block truncate text-xs">
                              {survey.question?.text ?? "Sem pergunta cadastrada"}
                            </span>
                          </td>

                          <td className="px-4 py-3">
                            <Badge variant={STATUS_BADGE_VARIANT[survey.status]}>
                              {SURVEY_STATUS_LABELS[survey.status]}
                            </Badge>
                            {survey.isAnonymous && (
                              <span className="mt-1 block">
                                <Badge variant="default" className="gap-1 text-[0.65rem]">
                                  <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                                  anônima
                                </Badge>
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3 text-right tabular-nums">
                            {(m?.totalAudience ?? 0).toLocaleString("pt-BR")}
                          </td>
                          <td className="px-4 py-3 text-right font-medium tabular-nums">
                            {(m?.totalResponses ?? 0).toLocaleString("pt-BR")}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatarPercentual(m?.participationRate ?? 0)}%
                          </td>

                          <td className="text-muted-foreground hidden px-4 py-3 text-xs whitespace-nowrap lg:table-cell">
                            {survey.endsAt ? formatDateTime(survey.endsAt) : "—"}
                          </td>

                          <td className="px-4 py-3">
                            <Link
                              href={surveyResultsHref(survey.id)}
                              className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-8 items-center rounded-md px-3 text-xs transition-colors"
                            >
                              Ver resultado
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
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
            base="results"
          />
        </>
      )}
    </div>
  );
}
