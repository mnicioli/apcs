import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  getSurvey,
  getSurveyMetrics,
  listSurveyAudit,
  listSurveyDispatches,
  listSurveyRecipients,
} from "@/lib/services/surveys";
import { formatDateTime } from "@/lib/utils";
import {
  SURVEY_ANSWER_TYPE_LABELS,
  SURVEY_RECIPIENT_STATUS_LABELS,
  SURVEY_STAGE_HINTS,
  SURVEY_STAGE_LABELS,
  SURVEY_STATUS_HINTS,
  SURVEY_STATUS_LABELS,
} from "@/modules/survey/survey.labels";
import { isSurveyId } from "@/modules/survey/survey.routes";
import { surveyStage } from "@/modules/survey/survey.rules";
import type { SurveyWithQuestion } from "@/modules/survey/survey.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SurveyActions } from "../survey-actions";
import { SurveyAudienceSummary } from "../survey-audience-summary";
import { SurveyDispatchPanel } from "../survey-dispatch-panel";
import {
  RECIPIENT_BADGE_VARIANT,
  STAGE_BADGE_VARIANT,
  STATUS_BADGE_VARIANT,
} from "../survey-badges";
import { SurveyHistory } from "../survey-history";
import { SurveyMetricsCards } from "../survey-metrics-cards";
import { SurveyPreview } from "../survey-preview";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!isSurveyId(id)) return { title: "Enquete" };

  const survey = await getSurvey(id).catch(() => null);
  return { title: survey?.title ?? "Enquete" };
}

/**
 * A TELA DE VISUALIZAÇÃO (§41, §42).
 *
 * Mostra tudo que o §41 lista, mais as métricas do §42 e o histórico do §58.
 *
 * ⚠️ O que ela NÃO mostra é quem respondeu o quê — isso é a tela de Resultados,
 * e lá o banco decide se pode. Aqui não há sequer a consulta.
 */
export default async function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "surveys.read")) redirect("/dashboard");

  const { id } = await params;
  if (!isSurveyId(id)) notFound();

  const survey = await getSurvey(id);
  if (!survey) notFound();

  const canWrite = hasPermission(role, "surveys.write");

  const [metrics, recipients, audit, dispatches] = await Promise.all([
    getSurveyMetrics(id),
    listSurveyRecipients(id),
    // A trilha volta vazia para quem não tem permissão — a RLS decide, e o
    // componente some sozinho.
    listSurveyAudit(id).catch(() => []),
    listSurveyDispatches(id).catch(() => []),
  ]);

  const stage = surveyStage(survey);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/surveys">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Enquetes
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{survey.title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_BADGE_VARIANT[survey.status]}>
                {SURVEY_STATUS_LABELS[survey.status]}
              </Badge>
              {stage === "expired" && (
                <Badge variant={STAGE_BADGE_VARIANT[stage]}>{SURVEY_STAGE_LABELS[stage]}</Badge>
              )}
              <span className="text-muted-foreground text-sm">
                {stage === "expired"
                  ? SURVEY_STAGE_HINTS.expired
                  : SURVEY_STATUS_HINTS[survey.status]}
              </span>
            </div>
          </div>

          <SurveyActions
            survey={survey}
            canWrite={canWrite}
            hasResponses={metrics.totalResponses > 0}
          />
        </div>
      </div>

      <SurveyMetricsCards metrics={metrics} />

      {/* §35 do PROMPT 3/3. As corridas de disparo — some sozinha quando não há. */}
      <SurveyDispatchPanel
        surveyId={survey.id}
        runs={dispatches}
        failedCount={metrics.totalErrors}
        canWrite={canWrite}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* ---------------- A enquete ---------------- */}
          <Card>
            <CardHeader>
              <CardTitle>A enquete</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {survey.description && <Campo termo="Descrição" valor={survey.description} />}

              <Campo termo="Pergunta" valor={survey.question?.text ?? "Sem pergunta cadastrada"} />

              <Campo
                termo="Tipo de resposta"
                valor={
                  survey.question ? SURVEY_ANSWER_TYPE_LABELS[survey.question.answerType] : "—"
                }
              />

              <div className="space-y-2">
                <p className="text-muted-foreground text-xs">Alternativas</p>
                <ol className="space-y-1">
                  {(survey.question?.options ?? []).map((option) => (
                    <li key={option.id} className="flex items-baseline gap-2 text-sm">
                      <span className="text-muted-foreground tabular-nums">{option.position}.</span>
                      <span className={option.active ? "" : "text-muted-foreground line-through"}>
                        {option.text}
                      </span>
                      {/* §61: uma alternativa aposentada continua no histórico. O
                          risco é dela parecer ativa; o selo diz que não é. */}
                      {!option.active && (
                        <Badge variant="done" className="text-[0.65rem]">
                          inativa
                        </Badge>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            </CardContent>
          </Card>

          {/* ---------------- Destinatários ---------------- */}
          {recipients.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Destinatários</CardTitle>
                <CardDescription>
                  A fotografia do público tirada no agendamento. Alterações nos cadastros não mudam
                  mais esta lista.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      Destinatários da enquete e o estado de cada envio
                    </caption>
                    <thead className="bg-background text-muted-foreground border-border sticky top-0 border-b text-left">
                      <tr>
                        <th scope="col" className="px-4 py-3 font-medium">
                          Contato
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          Situação
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          Tentativas
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipients.map((recipient) => (
                        <tr
                          key={recipient.id}
                          className="border-border border-b align-middle last:border-0"
                        >
                          <td className="max-w-56 truncate px-4 py-2">
                            {recipient.contactName ?? "Contato sem nome"}
                          </td>
                          <td className="px-4 py-2">
                            <Badge variant={RECIPIENT_BADGE_VARIANT[recipient.status]}>
                              {SURVEY_RECIPIENT_STATUS_LABELS[recipient.status]}
                            </Badge>
                            {recipient.lastError && (
                              <span className="text-muted-foreground mt-0.5 block text-xs">
                                {recipient.lastError}
                              </span>
                            )}
                          </td>
                          <td className="text-muted-foreground px-4 py-2 text-xs tabular-nums">
                            {recipient.attempts}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <SurveyHistory entries={audit} />
        </div>

        {/* ---------------- Coluna lateral ---------------- */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuração</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">Público</p>
                <p className="text-sm">
                  <SurveyAudienceSummary criteria={survey.audience} />
                </p>
              </div>

              <Campo
                termo="Envio"
                valor={survey.scheduledAt ? formatDateTime(survey.scheduledAt) : "Não agendado"}
              />
              <Campo
                termo="Início"
                valor={survey.startsAt ? formatDateTime(survey.startsAt) : "—"}
              />
              <Campo
                termo="Encerramento"
                valor={survey.endsAt ? formatDateTime(survey.endsAt) : "—"}
              />
              <Campo
                termo="Respostas anônimas"
                valor={survey.isAnonymous ? "Sim" : "Não"}
                dica={
                  survey.isAnonymous
                    ? "Os resultados não identificam quem respondeu o quê."
                    : undefined
                }
              />
              <Campo termo="Criada em" valor={formatDateTime(survey.createdAt)} />
              {survey.createdBy && (
                <Campo
                  termo="Criada por"
                  valor={survey.createdBy.fullName ?? survey.createdBy.email ?? "—"}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Prévia da mensagem</CardTitle>
            </CardHeader>
            <CardContent>
              <SurveyPreview
                question={survey.question?.text ?? ""}
                options={(survey.question?.options ?? [])
                  .filter((o) => o.active)
                  .map((o) => o.text)}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Campo({ termo, valor, dica }: { termo: string; valor: string; dica?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{termo}</p>
      <p className="text-sm whitespace-pre-line">{valor}</p>
      {dica && <p className="text-muted-foreground text-xs">{dica}</p>}
    </div>
  );
}

/** Reexportado para o teste conseguir montar um objeto de enquete completo. */
export type { SurveyWithQuestion };
