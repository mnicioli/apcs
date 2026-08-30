import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listKnowledgeCategories } from "@/lib/services/knowledge";
import { KnowledgeForm } from "../knowledge-form";

export const metadata: Metadata = { title: "Novo item — Base de Conhecimento" };

/**
 * Cadastro de um item de conhecimento.
 *
 * A permissão é checada aqui (1ª camada) e a policy de insert de
 * `knowledge_entries` decide no banco (2ª camada) — as duas contam a mesma
 * história.
 */
export default async function NewKnowledgeEntryPage() {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "knowledge.write")) redirect("/knowledge");

  const categories = await listKnowledgeCategories();

  return (
    <div className="space-y-6">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Novo item de conhecimento</h1>
        <p className="text-muted-foreground text-sm">
          Uma pergunta que a APCS responde sempre da mesma forma. O texto da resposta sai daqui para
          o associado exatamente como estiver escrito.
        </p>
      </div>

      <KnowledgeForm categories={categories} />
    </div>
  );
}
