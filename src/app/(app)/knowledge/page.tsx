import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listKnowledgeCategories, listKnowledgeEntries } from "@/lib/services/knowledge";
import { formatDateTime } from "@/lib/utils";
import {
  KNOWLEDGE_AVAILABLE_BADGE,
  KNOWLEDGE_BLOCKER_BADGES,
  KNOWLEDGE_BLOCKER_LABELS,
  KNOWLEDGE_EMPTY,
  KNOWLEDGE_EMPTY_FILTERED,
  KNOWLEDGE_PAGE_DESCRIPTION,
  KNOWLEDGE_PAGE_TITLE,
  knowledgeCoverage,
} from "@/modules/intelligence/knowledge.labels";
import {
  apcsToday,
  countAvailableToChatbot,
  knowledgeBlocker,
} from "@/modules/intelligence/knowledge.rules";
import {
  DEFAULT_KNOWLEDGE_STATUS_FILTER,
  isKnowledgeStatusFilter,
  type KnowledgeFilters,
} from "@/modules/intelligence/knowledge.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KnowledgeFiltersBar } from "./knowledge-filters";
import { KnowledgeSearchPanel } from "./knowledge-search-panel";
import { KnowledgeStatusActions } from "./knowledge-status-actions";

export const metadata: Metadata = { title: KNOWLEDGE_PAGE_TITLE };

/**
 * A GRID DA BASE DE CONHECIMENTO.
 *
 * ⚠️ A COLUNA MAIS IMPORTANTE É "NO CHATBOT", e ela não é o campo
 * `available_for_chatbot`. É o resultado das quatro condições do §43 — ativo,
 * liberado, já começou, ainda não venceu. Um item pode estar com a caixa
 * marcada e mesmo assim mudo, porque a vigência passou; mostrar a caixa em vez
 * do resultado faria a tela concordar com quem diz "está marcado e não
 * funciona".
 *
 * Quando o item não está valendo, o selo diz QUAL das quatro condições falhou.
 *
 * A permissão é checada aqui (1ª camada) e a RLS de `knowledge_entries` filtra
 * no banco (2ª camada) — as duas contam a mesma história.
 */
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; categoria?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "knowledge.read")) redirect("/dashboard");

  const { q, status, categoria } = await searchParams;
  const filters: KnowledgeFilters = {
    query: q ?? "",
    // Status desconhecido cai no padrão em vez de mostrar lista vazia: uma URL
    // colada errada não deve parecer "não há nada aqui".
    status: status && isKnowledgeStatusFilter(status) ? status : DEFAULT_KNOWLEDGE_STATUS_FILTER,
    categoryId: categoria ?? "",
  };

  const [entries, categories] = await Promise.all([
    listKnowledgeEntries(filters),
    listKnowledgeCategories(),
  ]);

  const canWrite = hasPermission(role, "knowledge.write");
  const hoje = apcsToday();
  const isFiltered =
    filters.query.trim() !== "" || filters.status !== "all" || filters.categoryId !== "";

  // ⚠️ A COBERTURA CONTA A LISTA FILTRADA, e o texto acompanha: dizer "3 de 40"
  // enquanto a tela mostra 5 linhas seria um número que não corresponde a nada
  // do que está à vista.
  const disponiveis = countAvailableToChatbot(entries, hoje);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">{KNOWLEDGE_PAGE_TITLE}</h1>
          <p className="text-muted-foreground text-sm">{KNOWLEDGE_PAGE_DESCRIPTION}</p>
        </div>
        {canWrite && (
          <Button asChild>
            <Link href="/knowledge/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Novo item
            </Link>
          </Button>
        )}
      </div>

      <KnowledgeFiltersBar
        query={filters.query}
        status={filters.status}
        categoryId={filters.categoryId}
        categories={categories}
      />

      <p className="text-muted-foreground text-sm" role="status">
        {knowledgeCoverage(disponiveis, entries.length)}
      </p>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-muted-foreground text-sm">
              {isFiltered ? KNOWLEDGE_EMPTY_FILTERED : KNOWLEDGE_EMPTY}
            </p>
            {canWrite && !isFiltered && (
              <Button asChild>
                <Link href="/knowledge/new">Cadastrar o primeiro item</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Itens da Base de Conhecimento e a situação de cada um no chatbot
                </caption>
                <thead className="text-muted-foreground border-border border-b text-left">
                  <tr>
                    {["Título", "Categoria", "No chatbot", "Palavras-chave", "Atualizado", ""].map(
                      (coluna) => (
                        <th key={coluna} scope="col" className="px-4 py-3 font-medium">
                          {coluna || <span className="sr-only">Ações</span>}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const bloqueio = knowledgeBlocker(entry, hoje);

                    return (
                      <tr key={entry.id} className="border-border border-b last:border-0">
                        <th scope="row" className="px-4 py-3 text-left font-medium">
                          {canWrite ? (
                            <Link
                              href={`/knowledge/${entry.id}/edit`}
                              className="underline-offset-4 hover:underline"
                            >
                              {entry.title}
                            </Link>
                          ) : (
                            entry.title
                          )}
                        </th>

                        <td className="text-muted-foreground px-4 py-3">{entry.categoryName}</td>

                        <td className="px-4 py-3">
                          {bloqueio ? (
                            <Badge
                              variant={bloqueio === "expired" ? "alert" : "default"}
                              title={KNOWLEDGE_BLOCKER_LABELS[bloqueio]}
                            >
                              {KNOWLEDGE_BLOCKER_BADGES[bloqueio]}
                            </Badge>
                          ) : (
                            <Badge variant="attention">{KNOWLEDGE_AVAILABLE_BADGE}</Badge>
                          )}
                        </td>

                        <td className="text-muted-foreground max-w-xs truncate px-4 py-3">
                          {entry.keywords.length > 0 ? entry.keywords.join(", ") : "—"}
                        </td>

                        <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                          {formatDateTime(entry.updatedAt)}
                        </td>

                        <td className="px-4 py-3 text-right">
                          {canWrite && (
                            <KnowledgeStatusActions id={entry.id} status={entry.status} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <KnowledgeSearchPanel />
    </div>
  );
}
