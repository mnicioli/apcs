import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listAudienceRegions } from "@/lib/services/surveys";
import { SurveyForm } from "../survey-form";

export const metadata: Metadata = { title: "Nova enquete" };

/**
 * §9. Criar enquete — só ADMINISTRADOR e GESTOR.
 *
 * O `redirect` protege a ROTA, e não só o botão: esconder "Nova enquete" do
 * menu não impede ninguém de digitar `/surveys/new`. A action checa de novo
 * (§56: não esconder apenas no frontend).
 */
export default async function NewSurveyPage() {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "surveys.write")) redirect("/surveys");

  const regions = await listAudienceRegions();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nova enquete</h1>
        <p className="text-muted-foreground text-sm">
          A enquete nasce como rascunho. Nada é enviado até você agendar.
        </p>
      </div>

      <SurveyForm regions={regions} contactNames={new Map()} />
    </div>
  );
}
