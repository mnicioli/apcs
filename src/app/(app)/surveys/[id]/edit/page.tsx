import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  getContactNames,
  getSurvey,
  getSurveyMetrics,
  listAudienceRegions,
  listAudienceSegments,
} from "@/lib/services/surveys";
import { isSurveyId } from "@/modules/survey/survey.routes";
import { SurveyForm } from "../../survey-form";

export const metadata: Metadata = { title: "Editar enquete" };

/**
 * §36/§37/§38. Editar.
 *
 * O que pode mudar depende da situação e de haver respostas — quem decide é o
 * banco; aqui o formulário recebe os dois sinais para travar os campos certos e
 * a pessoa não perder o trabalho de digitar algo que seria recusado.
 */
export default async function EditSurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "surveys.write")) redirect("/surveys");

  const { id } = await params;
  // Antes de qualquer consulta: um id malformado é "não existe", não uma falha
  // do sistema.
  if (!isSurveyId(id)) notFound();

  const survey = await getSurvey(id);
  if (!survey) notFound();

  const contatos = survey.audience
    .filter((c) => c.dimension === "contact" && c.contactId)
    .map((c) => c.contactId as string);

  const [segments, regions, contactNames, metrics] = await Promise.all([
    listAudienceSegments(),
    listAudienceRegions(),
    getContactNames(contatos),
    getSurveyMetrics(id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Editar enquete</h1>
        <p className="text-muted-foreground text-sm">{survey.title}</p>
      </div>

      <SurveyForm
        survey={survey}
        segments={segments}
        regions={regions}
        contactNames={contactNames}
        hasResponses={metrics.totalResponses > 0}
      />
    </div>
  );
}
