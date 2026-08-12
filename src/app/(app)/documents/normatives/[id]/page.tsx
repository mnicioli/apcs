import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getDocument } from "@/lib/services/documents";
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
import type { DocumentVersion } from "@/modules/document/document.types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VersionAccess } from "../version-access";

export const metadata: Metadata = { title: "Histórico da normativa" };

/**
 * Histórico de versões de uma normativa.
 *
 * É página e não modal porque segue o padrão do projeto (`/leads/[id]`,
 * `/attendances/[id]`): dá para mandar o link para alguém, sobrevive ao F5 e não
 * precisa buscar dados no cliente.
 *
 * Nenhuma versão pode ser EDITADA aqui — nem o arquivo, nem o número, nem a data.
 * Documento errado se corrige com um upload novo, que vira a próxima versão. O
 * banco impõe isso: `document_versions` não concede UPDATE nessas colunas.
 */
export default async function NormativeHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "documents.read")) redirect("/dashboard");

  const { id } = await params;
  const document = await getDocument(id);
  if (!document) notFound();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/documents/normatives"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para as normativas
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight">{document.name}</h1>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={document.status === "active" ? "attention" : "done"}>
            {DOCUMENT_STATUS_LABELS[document.status]}
          </Badge>
          <span className="text-muted-foreground text-sm">
            {document.versionCount === 0
              ? "Nenhuma versão enviada"
              : `${document.versionCount} ${document.versionCount === 1 ? "versão" : "versões"}`}
          </span>
        </div>

        {document.description && (
          <p className="text-muted-foreground text-sm">{document.description}</p>
        )}
      </div>

      {document.status === "inactive" && document.versionCount > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm">
              Esta normativa não tem versão ativa. O chatbot não vai citar nenhum documento dela —
              vai encaminhar o atendimento para uma pessoa.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico de versões</CardTitle>
          <CardDescription>
            Da mais recente para a mais antiga. Nenhuma versão é apagada: o histórico é o registro
            do que já valeu.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {document.versions.length === 0 ? (
            <p className="text-muted-foreground px-6 pb-6 text-sm">
              Nenhum arquivo foi enviado para esta normativa ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Versões de {document.name}, da mais recente para a mais antiga
                </caption>
                <thead className="text-muted-foreground border-border border-y text-left">
                  <tr>
                    {[
                      "Versão",
                      "Arquivo",
                      "Upload",
                      "Vigência",
                      "Status",
                      "Chatbot",
                      "Responsável",
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
                  {document.versions.map((version) => (
                    <VersionRow key={version.id} version={version} documentName={document.name} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VersionRow({ version, documentName }: { version: DocumentVersion; documentName: string }) {
  return (
    <tr className="border-border hover:bg-muted/50 border-b align-middle last:border-0">
      <td className="px-4 py-3 font-medium whitespace-nowrap tabular-nums">
        {versionLabel(version.version)}
      </td>
      <td className="text-muted-foreground max-w-56 px-4 py-3">
        <span className="block truncate" title={version.originalFilename}>
          {version.originalFilename}
        </span>
        <span className="text-xs">{formatFileSize(version.fileSizeBytes)}</span>
      </td>
      <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
        {formatDateTime(version.uploadedAt)}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">{formatCalendarDate(version.effectiveDate)}</td>
      <td className="px-4 py-3">
        <Badge variant={version.status === "active" ? "attention" : "done"}>
          {DOCUMENT_STATUS_LABELS[version.status]}
        </Badge>
      </td>
      <td className="px-4 py-3">{chatbotAvailabilityLabel(version.availableForChatbot)}</td>
      <td className="text-muted-foreground max-w-40 truncate px-4 py-3">
        {version.uploadedBy?.fullName ?? "—"}
      </td>
      <td className="px-4 py-3">
        <VersionAccess
          versionId={version.id}
          version={version.version}
          documentName={documentName}
          originalFilename={version.originalFilename}
        />
      </td>
    </tr>
  );
}
