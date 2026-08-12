"use client";

import { useId, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { createDocumentAction } from "@/lib/actions/documents";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { DOCUMENT_CATEGORY_COPY } from "@/modules/document/document.labels";
import { documentFormSchema, type DocumentFormData } from "@/modules/document/document.schema";
import type { DocumentCategory } from "@/modules/document/document.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Cadastro de um documento novo na categoria.
 *
 * É o que impede a lista de virar um enum no código: as normativas e os quatro
 * documentos de Comunicação são linhas no banco, e qualquer outro entra por
 * aqui, sem deploy.
 *
 * Segue o padrão de referência (`profile-form.tsx`): React Hook Form + Zod +
 * Server Action + ActionResult.
 */
export function NewDocumentDialog({ category }: { category: DocumentCategory }) {
  const copy = DOCUMENT_CATEGORY_COPY[category];
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // A grid renderiza este botão no cabeçalho E no estado vazio — as duas
  // instâncias coexistem quando não há documento cadastrado.
  const nameId = useId();
  const descriptionId = useId();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DocumentFormData>({ resolver: zodResolver(documentFormSchema) });

  function close() {
    if (isPending) return;
    setOpen(false);
    setError(null);
    reset();
  }

  function onSubmit(values: DocumentFormData) {
    setError(null);

    startTransition(async () => {
      const result = await createDocumentAction(category, values);

      if (!result.ok) {
        // Nome repetido é o erro mais provável aqui, e a mensagem genérica de
        // "registro duplicado" não diria à pessoa o que fazer. O nome é único
        // POR CATEGORIA, então a frase precisa citar a categoria.
        setError(
          result.error.code === "uniqueViolation"
            ? `Já existe um documento com esse nome em ${copy.title}.`
            : ACTION_ERROR_MESSAGES[result.error.code],
        );
        return;
      }

      setOpen(false);
      reset();
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        {copy.newDocumentLabel}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={copy.newDocumentLabel}
        description={copy.newDocumentHint}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor={nameId}>Nome</Label>
            <Input
              id={nameId}
              aria-invalid={!!errors.name}
              placeholder={copy.namePlaceholder}
              {...register("name")}
            />
            {errors.name && (
              <p role="alert" className="text-destructive text-sm">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor={descriptionId}>Descrição (opcional)</Label>
            <Textarea
              id={descriptionId}
              rows={3}
              aria-invalid={!!errors.description}
              placeholder="Do que trata este documento."
              {...register("description")}
            />
            {errors.description && (
              <p role="alert" className="text-destructive text-sm">
                {errors.description.message}
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" loading={isPending}>
              Cadastrar
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
