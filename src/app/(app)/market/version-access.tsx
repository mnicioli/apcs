"use client";

import { useState, useTransition } from "react";
import { Download, FileText, Image as ImageIcon } from "lucide-react";
import { getBulletinFileUrlAction } from "@/lib/actions/market-bulletins";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/** Cada botão desta barra é uma requisição distinta ao servidor. */
type Acao = "image" | "pdf" | "download";

/**
 * Ver a imagem, ver o PDF e baixar o boletim de uma publicação.
 *
 * Os três caminhos passam pela mesma action, que confere a permissão, resolve o
 * caminho no bucket privado e devolve uma URL assinada de vida curta. O
 * navegador nunca recebe o endereço real do arquivo — o que não é enviado não
 * vaza, e uma URL copiada expira sozinha.
 *
 * É `market.read`: quem atende precisa consultar e baixar o boletim vigente sem
 * poder publicar nada.
 */
export function VersionAccess({
  versionId,
  versionName,
  bulletinName,
}: {
  versionId: string;
  versionName: string;
  bulletinName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [pendente, setPendente] = useState<Acao | null>(null);
  const [imagemUrl, setImagemUrl] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function request(acao: Acao) {
    setError(null);
    setPendente(acao);

    startTransition(async () => {
      const result = await getBulletinFileUrlAction({
        versionId,
        kind: acao === "image" ? "image" : "pdf",
        mode: acao === "download" ? "download" : "view",
      });
      setPendente(null);

      if (!result.ok) {
        setError(ACTION_ERROR_MESSAGES[result.error.code]);
        return;
      }

      if (acao === "image") return setImagemUrl(result.data.url);
      if (acao === "pdf") return setPdfUrl(result.data.url);

      // Âncora sintética em vez de `location.href`: a URL assinada já vem com
      // `Content-Disposition: attachment`, mas navegar até ela descarrega a
      // página atual em alguns navegadores antes de o download começar.
      //
      // O atributo `download` NÃO é usado de propósito: os navegadores o ignoram
      // em URL de outra origem, e é o `Content-Disposition` do Storage que manda
      // — nele o servidor já pôs o nome amigável (`Bolsa_de_Suínos_12Ago26.pdf`).
      // Definir aqui só criaria uma segunda fonte da verdade para o mesmo nome.
      const anchor = document.createElement("a");
      anchor.href = result.data.url;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    });
  }

  const titulo = `${bulletinName} — ${versionName}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => request("image")}
          loading={pendente === "image"}
          disabled={isPending}
        >
          {pendente !== "image" && <ImageIcon className="h-4 w-4" aria-hidden="true" />}
          Imagem
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => request("pdf")}
          loading={pendente === "pdf"}
          disabled={isPending}
        >
          {pendente !== "pdf" && <FileText className="h-4 w-4" aria-hidden="true" />}
          Ver PDF
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => request("download")}
          loading={pendente === "download"}
          disabled={isPending}
        >
          {pendente !== "download" && <Download className="h-4 w-4" aria-hidden="true" />}
          Baixar
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-destructive mt-1 text-xs">
          {error}
        </p>
      )}

      <Dialog
        open={imagemUrl !== null}
        onClose={() => setImagemUrl(null)}
        title={titulo}
        description="Imagem do boletim"
        className="w-[min(95vw,56rem)]"
      >
        {imagemUrl && (
          // `object-contain` e altura limitada: a proporção da imagem é
          // preservada seja qual for o tamanho do arquivo enviado.
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada e efêmera; ver signed-image.tsx
          <img
            src={imagemUrl}
            alt={`Imagem do boletim ${versionName} da ${bulletinName}`}
            className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md object-contain"
          />
        )}
      </Dialog>

      <Dialog
        open={pdfUrl !== null}
        onClose={() => setPdfUrl(null)}
        title={titulo}
        description="Boletim em PDF"
        className="w-[min(95vw,64rem)]"
      >
        {pdfUrl && (
          // O navegador renderiza PDF nativamente; nenhuma biblioteca de viewer
          // entra no pacote por causa disto.
          <iframe
            src={pdfUrl}
            title={`Boletim ${versionName} da ${bulletinName}`}
            className="border-border h-[70vh] w-full rounded-md border"
          />
        )}
      </Dialog>
    </>
  );
}
