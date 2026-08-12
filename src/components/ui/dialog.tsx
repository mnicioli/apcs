"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Diálogo modal sobre o `<dialog>` nativo.
 *
 * Nativo de propósito, pelo mesmo motivo de `ui/select.tsx`: `showModal()`
 * entrega de graça o que uma implementação própria erraria — foco preso dentro
 * do modal, resto da página inerte para leitor de tela, Escape fechando e a
 * camada de topo acima de qualquer `z-index`. Zero dependência nova.
 *
 * É controlado: quem abre e fecha é o estado de quem usa. Mas o Escape fecha o
 * `<dialog>` por fora do React — daí o listener de `close`, sem o qual o pai
 * continuaria achando que a tela está aberta.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    const syncClosed = () => onClose();
    dialog.addEventListener("close", syncClosed);
    return () => dialog.removeEventListener("close", syncClosed);
  }, [onClose]);

  // `showModal()` torna o resto da página inerte, mas não impede a rolagem do
  // fundo. Sem isto, rolar dentro de um PDF longo arrasta a página atrás dele.
  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  /**
   * Clique no fundo escuro fecha. O alvo do clique no `::backdrop` é o próprio
   * `<dialog>`; qualquer clique no conteúdo tem outro alvo, então a checagem de
   * identidade é o que separa os dois casos.
   */
  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === ref.current) onClose();
  }

  return (
    <dialog
      ref={ref}
      onClick={handleBackdropClick}
      aria-labelledby="dialog-title"
      className={cn(
        "bg-card text-foreground m-auto w-[min(92vw,32rem)] rounded-lg p-0 shadow-lg",
        "backdrop:bg-foreground/40",
        className,
      )}
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="border-border flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="space-y-1">
            <h2 id="dialog-title" className="text-base font-semibold tracking-tight">
              {title}
            </h2>
            {description && <div className="text-muted-foreground text-sm">{description}</div>}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring shrink-0 cursor-pointer rounded-md p-1 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </dialog>
  );
}

/** Rodapé padrão: ações à direita, cancelar antes de confirmar. */
export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-wrap justify-end gap-2">{children}</div>;
}
