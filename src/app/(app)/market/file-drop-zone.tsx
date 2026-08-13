"use client";

import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { cn, formatFileSize } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * Uma área de arrastar-e-soltar para UM arquivo.
 *
 * Existe porque a publicação da Bolsa tem duas — imagem e PDF — e o escopo é
 * explícito em não misturar os dois tipos numa área só. Misturar significaria
 * aceitar os dois `accept` juntos e depois adivinhar qual arquivo é qual, o que
 * erra na primeira vez que alguém soltar dois PDFs.
 *
 * ⚠️ A validação daqui é UX. Quem decide se o arquivo é mesmo o que diz ser é o
 * servidor, lendo os bytes — extensão e MIME declarado são texto que veio de
 * fora e mudam com um renomear.
 */
export function FileDropZone({
  label,
  file,
  onFileChange,
  accept,
  hint,
  icon,
  validate,
  disabled,
  preview,
}: {
  label: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** O `accept` do input, já montado pelo módulo. */
  accept: string;
  /** Formatos e limite, em uma linha. */
  hint: string;
  icon: ReactNode;
  /** Devolve o CÓDIGO do problema, ou `null`. A mensagem vem de quem chama. */
  validate: (file: File) => string | null;
  disabled?: boolean;
  /** Miniatura, quando o tipo do arquivo permite mostrar uma. */
  preview?: (objectUrl: string) => ReactNode;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  // `createObjectURL` prende o arquivo na memória até alguém revogar. Sem a
  // limpeza, trocar de arquivo cinco vezes deixaria cinco presos.
  useEffect(() => {
    if (!file || !preview) {
      setObjectUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, preview]);

  function accepted(candidate: File | undefined) {
    if (!candidate) return;

    const problema = validate(candidate);
    if (problema) {
      onFileChange(null);
      setError(problema);
      return;
    }

    setError(null);
    onFileChange(candidate);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    accepted(event.dataTransfer.files[0]);
  }

  function clearSelection() {
    onFileChange(null);
    setError(null);
    // Sem isto, escolher o MESMO arquivo depois de removê-lo não dispara
    // `change` — o input ainda o tem como valor e o navegador nada faz.
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId}>
        {label} <span aria-hidden="true">*</span>
        <span className="sr-only">(obrigatório)</span>
      </Label>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "rounded-lg border-2 border-dashed px-6 py-6 transition-colors",
          isDragging ? "border-primary bg-accent" : "border-border",
        )}
      >
        {file ? (
          <div className="flex flex-wrap items-center gap-4">
            {preview && objectUrl ? preview(objectUrl) : icon}

            <div className="min-w-40 flex-1 space-y-1">
              <p className="truncate text-sm font-medium" title={file.name}>
                {file.name}
              </p>
              <p className="text-muted-foreground text-xs">
                {formatFileSize(file.size)} · {file.type || "tipo não informado"}
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
              >
                Trocar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={clearSelection}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Remover
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center">
            {icon}
            <p className="mt-3 text-sm font-medium">Arraste e solte o arquivo aqui</p>
            <p className="text-muted-foreground text-xs">ou</p>

            {/* O botão é a alternativa ao arrastar — quem navega por teclado não
                tem como fazer drag & drop. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
            >
              Selecionar arquivo
            </Button>
          </div>
        )}

        <input
          ref={inputRef}
          id={fieldId}
          type="file"
          accept={accept}
          className="sr-only"
          disabled={disabled}
          aria-invalid={error !== null}
          aria-describedby={`${fieldId}-ajuda`}
          onChange={(event) => accepted(event.target.files?.[0])}
        />

        <p id={`${fieldId}-ajuda`} className="text-muted-foreground mt-4 text-center text-xs">
          {hint}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
