"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { cn, formatFileSize } from "@/lib/utils";
import { IMAGE_ACCEPT_ATTRIBUTE, validateImageCandidate } from "@/modules/event/event.schema";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SignedImage } from "@/components/ui/signed-image";

/**
 * O cartaz do evento: arrastar, escolher, ver e trocar.
 *
 * Controlado — quem guarda o arquivo é o formulário, porque é ele que decide
 * quando enviar. Aqui só acontecem a escolha, a validação do que o navegador
 * consegue ver e o preview.
 *
 * ⚠️ A validação daqui é UX. Quem decide se o arquivo é mesmo uma imagem é o
 * servidor, lendo os bytes (`src/lib/events/image.ts`) — extensão e MIME
 * declarado são texto que veio de fora e mudam com um renomear.
 */
export function EventImageField({
  file,
  onFileChange,
  currentImageUrl,
  eventName,
  disabled,
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** Na edição, a imagem que já está gravada. `null` no cadastro. */
  currentImageUrl?: string | null;
  eventName: string;
  disabled?: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  // `createObjectURL` prende o arquivo na memória até alguém revogar. Sem a
  // limpeza, trocar de imagem cinco vezes deixaria cinco arquivos presos.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function accept(candidate: File | undefined) {
    if (!candidate) return;

    const issue = validateImageCandidate(candidate);
    if (issue) {
      onFileChange(null);
      setError(ACTION_ERROR_MESSAGES[issue]);
      return;
    }

    setError(null);
    onFileChange(candidate);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    accept(event.dataTransfer.files[0]);
  }

  function clearSelection() {
    onFileChange(null);
    setError(null);
    // Sem isto, escolher o MESMO arquivo depois de removê-lo não dispara
    // `change` — o input ainda o tem como valor e o navegador nada faz.
    if (inputRef.current) inputRef.current.value = "";
  }

  const shownUrl = previewUrl ?? currentImageUrl ?? null;
  const hasImage = shownUrl !== null;

  return (
    // ⚠️ `h-full` E COLUNA FLEX PORQUE O CARTÃO ESTICA. Na tela de edição este
    // campo mora numa coluna que acompanha a altura dos campos ao lado, e ela é
    // alta. Sem isto, a área tracejada ficava colada no topo com centenas de
    // pixels de branco embaixo — a imagem parecia um detalhe num cartão vazio,
    // que é o oposto de estar em evidência.
    <div className="flex h-full flex-col space-y-2">
      <Label htmlFor={fieldId}>
        Imagem <span aria-hidden="true">*</span>
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
          // `flex-1` faz a área tracejada tomar a altura que sobrar do cartão;
          // `justify-center` centra o conteúdo nela em vez de empurrá-lo para o
          // topo. Numa coluna baixa nada disso aparece — só entra em cena quando
          // há espaço sobrando.
          "flex flex-1 flex-col justify-center rounded-lg border-2 border-dashed px-6 py-6 transition-colors",
          isDragging ? "border-primary bg-accent" : "border-border",
        )}
      >
        {hasImage ? (
          <div className="flex flex-wrap items-center justify-center gap-4">
            {/* ⚠️ A IMAGEM MANDA NA PRÓPRIA ALTURA — sem proporção fixa.
                Ela já foi `h-24 w-40` (miniatura de 96px perdida no topo de uma
                coluna alta) e depois `aspect-video`, que é DEITADA: um cartaz em
                pé aparecia inteiro, mas encolhido no meio da caixa, com sobra em
                cima e embaixo. Nos dois casos a prévia não respondia a única
                pergunta que ela existe para responder — "é este cartaz mesmo?".

                Com `w-full` e altura automática, o cartaz ocupa a largura da
                coluna e cresce na proporção dele. O teto de 30rem existe para um
                cartaz muito alto não empurrar o botão de substituir para fora da
                tela.

                E `w-full` faz os irmãos quebrarem para baixo (o pai é
                `flex-wrap`): nome do arquivo e botões empilham sob a imagem sem
                precisar de media query. */}
            <SignedImage
              url={shownUrl}
              alt={eventName || "Cartaz do evento"}
              sizes="w-full"
              className="h-auto max-h-[30rem] min-h-32 bg-transparent object-contain"
            />

            <div className="min-w-40 flex-1 space-y-1">
              <p className="truncate text-sm font-medium">
                {file ? file.name : "Imagem atual do evento"}
              </p>
              <p className="text-muted-foreground text-xs">
                {file ? formatFileSize(file.size) : "Envie um arquivo novo para substituí-la."}
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
                Substituir imagem
              </Button>
              {file && (
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
              )}
            </div>
          </div>
        ) : (
          <div className="text-center">
            <ImageUp className="text-muted-foreground mx-auto h-8 w-8" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">Arraste a imagem aqui</p>
            <p className="text-muted-foreground text-xs">ou</p>

            {/* O botão é a alternativa ao arrastar — quem navega por teclado
                não tem como fazer drag & drop. */}
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
          accept={IMAGE_ACCEPT_ATTRIBUTE}
          className="sr-only"
          disabled={disabled}
          aria-invalid={error !== null}
          aria-describedby={`${fieldId}-ajuda`}
          onChange={(event) => accept(event.target.files?.[0])}
        />

        <p id={`${fieldId}-ajuda`} className="text-muted-foreground mt-4 text-center text-xs">
          Formatos: JPG, JPEG, PNG e WEBP · Tamanho máximo: 5 MB
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
