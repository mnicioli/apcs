import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { History } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listDocuments } from "@/lib/services/documents";
import { formatDateTime } from "@/lib/utils";
import {
  chatbotAvailabilityLabel,
  DOCUMENT_STATUS_LABELS,
} from "@/modules/document/document.labels";
import {
  formatCalendarDate,
  formatFileSize,
  versionLabel,
} from "@/modules/document/document.rules";
import {
  DEFAULT_DOCUMENT_STATUS_FILTER,
  isDocumentStatusFilter,
  type DocumentFilters,
  type DocumentSummary,
} from "@/modules/document/document.types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentsFilters } from "./documents-filters";
import { VersionAccess } from "./version-access";

export const metadata: Metadata = { title: "Normativas" };

/**
 * Grid das normativas da APCS.
 *
 * Mostra a SITUAÇÃO ATUAL de cada normativa — uma linha por cadastro, com a
 * versão que vale hoje. As versões antigas ficam no histórico: uma lista com
 * todas as versões de todas as normativas responderia a pergunta errada, que é
 * "qual documento eu cito agora?".
 *
 * A permissão é checada aqui (1ª camada) e a RLS de `documents` filtra no banco
 * (2ª camada) — as duas contam a mesma história.
 */
export default async function NormativesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "documents.read")) redirect("/dashboard");

  const { q, status } = await searchParams;
  const filters: DocumentFilters = {
    query: q ?? "",
    // Status desconhecido cai no padrão em vez de mostrar lista vazia: uma URL
    // colada errada não deve parecer "não há nada aqui".
    status: status && isDocumentStatusFilter(status) ? status : DEFAULT_DOCUMENT_STATUS_FILTER,
  };

  const documents = await listDocuments("normative", filters);
  const isFiltered = filters.query.trim() !== "" || filters.status !== "all";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Normativas</h1>
        <p className="text-muted-foreground text-sm">
          Os documentos oficiais da APCS. A versão ativa é a que o chatbot pode citar.
        </p>
      </div>

      <DocumentsFilters query={filters.query} status={filters.status} />

      {documents.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground text-sm">
              {isFiltered
                ? "Nenhuma normativa encontrada para os filtros selecionados."
                : "Nenhuma normativa cadastrada."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Normativas da APCS e a situação atual de cada uma
                </caption>
                <thead className="text-muted-foreground border-border border-b text-left">
                  <tr>
                    {[
                      "Normativa",
                      "Versão",
                      "Arquivo",
                      "Status",
                      "Upload",
                      "Vigência",
                      "Responsável",
                      "Chatbot",
                      "Ações",
                    ].map((label) => (
                      <th
                        key={label}
                        scope="col"
                        className="px-4 py-3 font-medium whitespace-nowrap"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {documents.map((document) => (
                    <DocumentRow key={document.id} document={document} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DocumentRow({ document }: { document: DocumentSummary }) {
  const version = document.currentVersion;

  return (
    <tr className="border-border hover:bg-muted/50 border-b align-middle last:border-0">
      <td className="px-4 py-3">
        <Link
          href={`/documents/normatives/${document.id}`}
          className="text-primary-strong hover:underline"
        >
          {document.name}
        </Link>
      </td>

      {version ? (
        <>
          <td className="px-4 py-3 whitespace-nowrap tabular-nums">
            {versionLabel(version.version)}
          </td>
          <td className="text-muted-foreground max-w-56 px-4 py-3">
            <span className="block truncate" title={version.originalFilename}>
              {version.originalFilename}
            </span>
            <span className="text-xs">{formatFileSize(version.fileSizeBytes)}</span>
          </td>
          <td className="px-4 py-3">
            <Badge variant={document.status === "active" ? "attention" : "done"}>
              {DOCUMENT_STATUS_LABELS[document.status]}
            </Badge>
          </td>
          <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
            {formatDateTime(version.uploadedAt)}
          </td>
          <td className="px-4 py-3 whitespace-nowrap">
            {formatCalendarDate(version.effectiveDate)}
          </td>
          <td className="text-muted-foreground max-w-40 truncate px-4 py-3">
            {version.uploadedBy?.fullName ?? "—"}
          </td>
          <td className="px-4 py-3">{chatbotAvailabilityLabel(version.availableForChatbot)}</td>
          <td className="px-4 py-3">
            <div className="flex items-center gap-1">
              <VersionAccess
                versionId={version.id}
                version={version.version}
                documentName={document.name}
                originalFilename={version.originalFilename}
              />
              <HistoryLink documentId={document.id} />
            </div>
          </td>
        </>
      ) : (
        /* Normativa cadastrada e ainda sem nenhum arquivo. A linha existe para
           quem pode publicar saber que ela está esperando um documento — e não
           some da grid só por estar incompleta. */
        <>
          <td className="text-muted-foreground px-4 py-3" colSpan={6}>
            Nenhuma versão enviada ainda.
          </td>
          <td className="px-4 py-3">{chatbotAvailabilityLabel(false)}</td>
          <td className="px-4 py-3">
            <HistoryLink documentId={document.id} />
          </td>
        </>
      )}
    </tr>
  );
}

function HistoryLink({ documentId }: { documentId: string }) {
  return (
    <Link
      href={`/documents/normatives/${documentId}`}
      className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs transition-colors"
    >
      <History className="h-4 w-4" aria-hidden="true" />
      Histórico
    </Link>
  );
}
