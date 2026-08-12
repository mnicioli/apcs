"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
import { FileUp, Upload } from "lucide-react";
import { createDocumentVersionAction, requestDocumentUploadAction } from "@/lib/actions/documents";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { cn } from "@/lib/utils";
import { formatFileSize, versionLabel } from "@/modules/document/document.rules";
import {
  ACCEPTED_EXTENSION,
  ACCEPTED_MIME_TYPE,
  effectiveDateSchema,
  validateUploadCandidate,
} from "@/modules/document/document.schema";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Envio de uma nova versão, em dois passos.
 *
 * O segundo passo existe por causa do efeito colateral: publicar substitui o
 * documento que o chatbot cita. Quem clica precisa ver isso escrito antes de
 * confirmar, não descobrir depois (item 21 do escopo).
 *
 * O ARQUIVO NÃO PASSA PELO SERVIDOR NEXT. A Vercel corta o corpo de requisições
 * serverless em 4,5 MB e o limite aqui é 5 MB, então o navegador envia direto
 * ao Supabase Storage com um endereço assinado de uso único. O servidor só
 * autoriza antes e valida depois.
 */
export function UploadVersionDialog({
  documentId,
  documentName,
  currentVersion,
  trigger = "button",
}: {
  documentId: string;
  documentName: string;
  /** Número da versão ativa hoje, para o aviso de substituição. */
  currentVersion: number | null;
  trigger?: "button" | "menu";
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [file, setFile] = useState<File | null>(null);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("pick");
    setFile(null);
    setEffectiveDate("");
    setError(null);
    setIsDragging(false);
  }

  function close() {
    if (isPending) return;
    setOpen(false);
    reset();
  }

  function acceptFile(candidate: File | undefined) {
    if (!candidate) return;

    const issue = validateUploadCandidate(candidate);
    if (issue) {
      setFile(null);
      setError(ACTION_ERROR_MESSAGES[issue]);
      return;
    }

    setError(null);
    setFile(candidate);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    acceptFile(event.dataTransfer.files[0]);
  }

  function goToConfirm() {
    if (!file) {
      setError("Selecione o arquivo PDF da normativa.");
      return;
    }
    if (!effectiveDateSchema.safeParse(effectiveDate).success) {
      setError("Informe uma data de vigência válida.");
      return;
    }

    setError(null);
    setStep("confirm");
  }

  function submit() {
    if (!file) return;
    setError(null);

    startTransition(async () => {
      const ticket = await requestDocumentUploadAction({
        documentId,
        filename: file.name,
        sizeBytes: file.size,
      });

      if (!ticket.ok) {
        setError(ACTION_ERROR_MESSAGES[ticket.error.code]);
        setStep("pick");
        return;
      }

      // Import dinâmico de propósito: este é o ÚNICO ponto do app que usa o
      // supabase-js no navegador, e estaticamente ele acrescentaria ~90 kB à
      // página inteira — inclusive para quem só entra para consultar uma
      // normativa. Assim o pacote só desce de fato quando alguém envia um
      // arquivo. (Usar o cliente oficial, e não um `fetch` cru para a URL
      // assinada, mantém o upload em cima da API suportada.)
      const { createClient } = await import("@/lib/supabase/client");

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(ticket.data.bucket)
        .uploadToSignedUrl(ticket.data.path, ticket.data.token, file);

      if (uploadError) {
        console.error(`[documents] envio ao storage falhou: ${uploadError.message}`);
        setError("Não foi possível enviar o arquivo. Tente novamente.");
        setStep("pick");
        return;
      }

      // O servidor agora baixa o que subiu e examina de verdade: se for um
      // .docx renomeado ou um PDF com senha, ele recusa e apaga o arquivo.
      const created = await createDocumentVersionAction({
        documentId,
        storagePath: ticket.data.path,
        originalFilename: file.name,
        effectiveDate,
      });

      if (!created.ok) {
        setError(ACTION_ERROR_MESSAGES[created.error.code]);
        setStep("pick");
        return;
      }

      setOpen(false);
      reset();
    });
  }

  return (
    <>
      <Button
        variant={trigger === "button" ? "default" : "ghost"}
        size={trigger === "button" ? "default" : "sm"}
        onClick={() => setOpen(true)}
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        Nova versão
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="Nova versão"
        description={documentName}
        className="w-[min(92vw,36rem)]"
      >
        {step === "pick" ? (
          <div className="space-y-5">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={cn(
                "rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
                isDragging ? "border-primary bg-accent" : "border-border",
              )}
            >
              <FileUp className="text-muted-foreground mx-auto h-8 w-8" aria-hidden="true" />

              <p className="mt-3 text-sm font-medium">{file ? file.name : "Arraste o PDF aqui"}</p>
              <p className="text-muted-foreground text-xs">
                {file ? formatFileSize(file.size) : "ou"}
              </p>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => inputRef.current?.click()}
              >
                {file ? "Trocar arquivo" : "Selecionar arquivo"}
              </Button>

              <input
                ref={inputRef}
                type="file"
                accept={`${ACCEPTED_MIME_TYPE},${ACCEPTED_EXTENSION}`}
                className="sr-only"
                onChange={(event) => acceptFile(event.target.files?.[0])}
              />

              <p className="text-muted-foreground mt-4 text-xs">
                Formato permitido: PDF · Tamanho máximo: 5 MB
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="effective-date">Data de vigência</Label>
              <Input
                id="effective-date"
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Quando o documento passa a valer. É diferente da data de envio, que o sistema
                registra sozinho.
              </p>
            </div>

            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button onClick={goToConfirm}>Continuar</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-sm">
              Você está enviando uma nova versão de <strong>{documentName}</strong>.{" "}
              {currentVersion === null ? (
                <>Ela será a primeira versão e já entrará no ar.</>
              ) : (
                <>
                  A versão <strong>{versionLabel(currentVersion)}</strong>, ativa hoje, será
                  automaticamente inativada, e a nova passará a ser a que o chatbot cita.
                </>
              )}
            </p>

            <dl className="bg-muted space-y-1 rounded-md p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Arquivo</dt>
                <dd className="truncate">{file?.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Tamanho</dt>
                <dd>{file ? formatFileSize(file.size) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Vigência</dt>
                <dd>{effectiveDate.split("-").reverse().join("/")}</dd>
              </div>
            </dl>

            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}

            {isPending && (
              <p role="status" className="text-muted-foreground text-sm">
                Enviando arquivo...
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("pick")} disabled={isPending}>
                Voltar
              </Button>
              {/* `loading` já desabilita o botão — dois envios do mesmo arquivo
                  gerariam duas versões idênticas e um número queimado. */}
              <Button onClick={submit} loading={isPending}>
                Confirmar envio
              </Button>
            </DialogFooter>
          </div>
        )}
      </Dialog>
    </>
  );
}
