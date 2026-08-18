import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download, Lock } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  getSurvey,
  getSurveyMetrics,
  getSurveyResults,
  listSurveyParticipants,
} from "@/lib/services/surveys";
import { formatDateTime } from "@/lib/utils";
import { SURVEY_STATUS_LABELS } from "@/modules/survey/survey.labels";
import {
  isSurveyId,
  surveyExportHref,
  surveyHref,
  type RawSearchParams,
} from "@/modules/survey/survey.routes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_BADGE_VARIANT } from "../../survey-badges";
import { SurveyMetricsCards, formatarPercentual } from "../../survey-metrics-cards";
import { SurveyParticipantsTable } from "../../survey-participants-table";
import { SurveyFunnel, SurveyResultsChart } from "../../survey-results-chart";

const PARTICIPANTS_PAGE_SIZE = 20;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!isSurveyId(id)) return { title: "Resultados" };
  const survey = await getSurvey(id).catch(() => null);
  return { title: survey ? `Resultados — ${survey.title}` : "Resultados" };
}

/**
 * O DASHBOARD DE RESULTADOS DE UMA ENQUETE (§43 a §51).
 *
 * A estrutura é a do §51, de cima para baixo: números, resultado da pergunta,
 * detalhamento. Quem abre esta tela quer uma leitura executiva em cinco
 * segundos, e só depois o detalhe.
 *
 * ⚠️ O ANONIMATO NÃO É DECIDIDO AQUI. `listSurveyParticipants` devolve `null`
 * quando o banco recusa a consulta (SV008), e a seção de participantes some. Não
 * existe neste arquivo um `if (survey.isAnonymous)` que alguém possa apagar por
 * engano — a tranca está no banco, e esta tela só reage a ela.
 */
export default async function SurveyResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "surveys.read")) redirect("/dashboard");

  const { id } = await params;
  if (!isSurveyId(id)) notFound();

  const survey = await getSurvey(id);
  if (!survey) notFound();

  const sp = await searchParams;
  const query = typeof sp.q === "string" ? sp.q.slice(0, 120) : "";
  const paginaBruta = Number(Array.isArray(sp.p) ? sp.p[0] : sp.p);
  const page = Number.isInteger(paginaBruta) && paginaBruta >= 1 ? paginaBruta : 1;

  const [results, metrics, participants] = await Promise.all([
    getSurveyResults(id),
    getSurveyMetrics(id),
    listSurveyParticipants(id, { query, page, pageSize: PARTICIPANTS_PAGE_SIZE }),
  ]);

  const semRespostas = metrics.totalResponses === 0;

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href={surveyHref(survey.id)}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar para a enquete
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{survey.title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_BADGE_VARIANT[survey.status]}>
                {SURVEY_STATUS_LABELS[survey.status]}
              </Badge>
              {survey.isAnonymous && (
                <Badge variant="default" className="gap-1">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  Respostas anônimas
                </Badge>
              )}
              {survey.endsAt && (
                <span className="text-muted-foreground text-sm">
                  Encerramento: {formatDateTime(survey.endsAt)}
                </span>
              )}
            </div>
          </div>

          {/* §49. A exportação respeita o anonimato: o próprio endpoint recusa
              dados individuais de enquete anônima. */}
          {!semRespostas && (
            <Button variant="outline" asChild>
              <a href={surveyExportHref(survey.id)} download>
                <Download className="h-4 w-4" aria-hidden="true" />
                Exportar CSV
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* ---------------- §51: os números primeiro ---------------- */}
      <SurveyMetricsCards metrics={metrics} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---------------- §43/§44: o resultado ---------------- */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Resultado da pergunta</CardTitle>
            <CardDescription>{survey.question?.text ?? "Sem pergunta cadastrada"}</CardDescription>
          </CardHeader>
          <CardContent>
            {semRespostas ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                Esta enquete ainda não possui respostas.
              </p>
            ) : (
              <SurveyResultsChart rows={results} totalResponses={metrics.totalResponses} />
            )}
          </CardContent>
        </Card>

        {/* ---------------- §45/§46: o funil ---------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Participação</CardTitle>
            <CardDescription>Onde o público se perde entre o envio e a resposta.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SurveyFunnel metrics={metrics} />

            <dl className="border-border space-y-2 border-t pt-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Total elegível</dt>
                <dd className="tabular-nums">{metrics.totalAudience.toLocaleString("pt-BR")}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Total enviado</dt>
                <dd className="tabular-nums">{metrics.totalSent.toLocaleString("pt-BR")}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Total entregue</dt>
                <dd className="tabular-nums">{metrics.totalDelivered.toLocaleString("pt-BR")}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Total lido</dt>
                <dd className="tabular-nums">{metrics.totalRead.toLocaleString("pt-BR")}</dd>
              </div>
              <div className="flex justify-between gap-3 font-medium">
                <dt>Total respondeu</dt>
                <dd className="tabular-nums">{metrics.totalResponses.toLocaleString("pt-BR")}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* ---------------- §44: o detalhamento em tabela ---------------- */}
      {!semRespostas && (
        <Card>
          <CardHeader>
            <CardTitle>Detalhamento</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Respostas e percentual por alternativa</caption>
                <thead className="text-muted-foreground border-border border-b text-left">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Alternativa
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Respostas
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Percentual
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row) => (
                    <tr key={row.optionId} className="border-border border-b last:border-0">
                      <td className="px-4 py-2">
                        <span className={row.active ? "" : "text-muted-foreground line-through"}>
                          {row.text}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{row.total}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatarPercentual(row.percentage)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------------- §47/§48: participantes ---------------- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Participantes</h2>
          <p className="text-muted-foreground text-sm">
            {participants === null
              ? "Esta enquete é anônima: quem respondeu o quê não pode ser identificado."
              : "Quem respondeu, o que escolheu e quando."}
          </p>
        </div>

        {participants === null ? (
          <Card>
            <CardContent className="flex items-start gap-3 p-6">
              <Lock className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div className="space-y-1 text-sm">
                <p className="font-medium">Resultados individuais protegidos</p>
                <p className="text-muted-foreground">
                  A enquete foi configurada como anônima. Os resultados por alternativa continuam
                  disponíveis acima — apenas a identificação individual fica indisponível, inclusive
                  na exportação.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <SurveyParticipantsTable
            participants={participants.items}
            total={participants.total}
            page={page}
            pageSize={PARTICIPANTS_PAGE_SIZE}
            query={query}
          />
        )}
      </section>
    </div>
  );
}
