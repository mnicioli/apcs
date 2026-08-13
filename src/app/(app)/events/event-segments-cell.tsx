"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import type { EventSegment } from "@/modules/event/event.types";
import { Dialog } from "@/components/ui/dialog";

/**
 * O público-alvo numa célula de grid.
 *
 * Mostra o primeiro nome e "+N" para o resto. A alternativa — listar todos —
 * faria uma linha crescer sozinha e empurrar a coluna de ações para fora da
 * tela, que é justamente o que o escopo pede para evitar.
 *
 * Clicar abre a lista completa. Um botão de verdade, e não uma `<div>` com
 * `onClick`: assim ele entra na ordem de tabulação e responde ao Enter sem
 * nenhum código a mais.
 */
export function EventSegmentsCell({
  segments,
  eventName,
}: {
  segments: EventSegment[];
  eventName: string;
}) {
  const [open, setOpen] = useState(false);

  if (segments.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  const [first, ...rest] = segments;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Ver os ${segments.length} públicos-alvo de ${eventName}`}
        className="hover:bg-muted focus-visible:ring-ring inline-flex max-w-48 items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <Users className="text-muted-foreground h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{first?.name}</span>
        {rest.length > 0 && (
          <span className="text-muted-foreground shrink-0 text-xs">+{rest.length}</span>
        )}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Público-alvo"
        description={eventName}
      >
        <ul className="space-y-3">
          {segments.map((segment) => (
            <li key={segment.id}>
              <p className="text-sm font-medium">{segment.name}</p>
              {segment.description && (
                <p className="text-muted-foreground text-sm">{segment.description}</p>
              )}
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
