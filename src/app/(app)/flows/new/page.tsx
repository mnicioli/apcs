import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { FLOWS_PAGE_TITLE } from "@/modules/flow/flow.labels";
import { NewFlowForm } from "./flow-form";

export const metadata: Metadata = { title: `Novo fluxo · ${FLOWS_PAGE_TITLE}` };

export default async function NewFlowPage() {
  const role = await getCurrentUserRole();
  // Escrita, e não leitura: quem só consulta não deve nem alcançar o formulário.
  // A RLS recusaria a gravação de qualquer forma — isto evita a viagem.
  if (!hasPermission(role, "flows.write")) redirect("/flows");

  return (
    <div className="space-y-6">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Novo fluxo</h1>
        <p className="text-muted-foreground text-sm">
          O fluxo nasce como rascunho e não atende ninguém até você publicar e ligar.
        </p>
      </div>

      <NewFlowForm />
    </div>
  );
}
