import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getKnowledgeEntry, listKnowledgeCategories } from "@/lib/services/knowledge";
import { formatDateTime } from "@/lib/utils";
import { KNOWLEDGE_BLOCKER_LABELS } from "@/modules/intelligence/knowledge.labels";
import { knowledgeBlocker } from "@/modules/intelligence/knowledge.rules";
import { KnowledgeForm } from "../../knowledge-form";

export const metadata: Metadata = { title: "Editar item — Base de Conhecimento" };

/**
 * Edição de um item de conhecimento.
 *
 * ⚠️ O AVISO DO TOPO É O MOTIVO DE ESTA TELA NÃO SER SÓ UM FORMULÁRIO. Quem abre
 * um item para editar quase sempre está investigando "por que o robô não
 * responde isso?" — e a resposta costuma ser uma das quatro condições do §43,
 * não o texto. Dizer qual delas está barrando, aqui em cima, evita a reescrita
 * de um conteúdo que já estava certo.
 */
export default async function EditKnowledgeEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "knowledge.write")) redirect("/knowledge");

  const { id } = await params;
  const [entry, categories] = await Promise.all([getKnowledgeEntry(id), listKnowledgeCategories()]);

  // 404, e não uma tela vazia: um id inexistente (ou barrado pela RLS) não deve
  // parecer um item sem conteúdo.
  if (!entry) notFound();

  const bloqueio = knowledgeBlocker(entry);

  return (
    <div className="space-y-6">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">{entry.title}</h1>
        <p className="text-muted-foreground text-sm">
          Criado por {entry.createdBy?.fullName ?? "—"}. Última alteração em{" "}
          {formatDateTime(entry.updatedAt)}
          {entry.updatedBy?.fullName ? `, por ${entry.updatedBy.fullName}` : ""}.
        </p>
      </div>

      {bloqueio && (
        <div
          role="status"
          className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-4 py-3 text-sm"
        >
          <strong className="text-foreground">O chatbot não usa este item agora.</strong>{" "}
          {KNOWLEDGE_BLOCKER_LABELS[bloqueio]}
        </div>
      )}

      <KnowledgeForm categories={categories} entry={entry} />
    </div>
  );
}
