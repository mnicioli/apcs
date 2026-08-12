"use client";

import { useState, useTransition } from "react";
import { Download, Eye } from "lucide-react";
import { getDocumentVersionUrlAction } from "@/lib/actions/documents";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { versionLabel } from "@/modules/document/document.rules";
import type { VersionUrlMode } from "@/modules/document/document.schema";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/**
 * Ver e baixar o arquivo de uma versão.
 *
 * Os dois caminhos passam pela mesma action, que confere a permissão, resolve o
 * caminho no bucket privado e devolve uma URL assinada de vida curta. O
 * navegador nunca recebe o endereço real do arquivo — o que não é enviado não
 * vaza, e uma URL copiada expira sozinha.
 */
export function VersionAccess({
  versionId,
  version,
  documentName,
  originalFilename,
}: {
  versionId: string;
  version: number;
  documentName: string;
  originalFilename: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [pendingMode, setPendingMode] = useState<VersionUrlMode | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function request(mode: VersionUrlMode) {
    setError(null);
    setPendingMode(mode);

    startTransition(async () => {
      const result = await getDocumentVersionUrlAction({ versionId, mode });
      setPendingMode(null);

      if (!result.ok) {
        setError(ACTION_ERROR_MESSAGES[result.error.code]);
        return;
      }

      if (mode === "view") {
        setViewerUrl(result.data.url);
        return;
      }

      // Âncora sintética em vez de `location.href`: a URL assinada já vem com
      // `Content-Disposition: attachment`, mas navegar até ela descarrega a
      // página atual em alguns navegadores antes de o download começar.
      const anchor = document.createElement("a");
      anchor.href = result.data.url;
      anchor.download = originalFilename;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    });
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => request("view")}
          loading={pendingMode === "view"}
          disabled={isPending}
        >
          {pendingMode !== "view" && <Eye className="h-4 w-4" aria-hidden="true" />}
          Visualizar
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => request("download")}
          loading={pendingMode === "download"}
          disabled={isPending}
        >
          {pendingMode !== "download" && <Download className="h-4 w-4" aria-hidden="true" />}
          Baixar
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-destructive mt-1 text-xs">
          {error}
        </p>
      )}

      <Dialog
        open={viewerUrl !== null}
        onClose={() => setViewerUrl(null)}
        title={`${documentName} — ${versionLabel(version)}`}
        description={originalFilename}
        className="w-[min(95vw,64rem)]"
      >
        {viewerUrl && (
          // O navegador renderiza PDF nativamente; nenhuma biblioteca de viewer
          // entra no pacote por causa disto.
          <iframe
            src={viewerUrl}
            title={`${documentName}, versão ${version}`}
            className="border-border h-[70vh] w-full rounded-md border"
          />
        )}
      </Dialog>
    </>
  );
}
