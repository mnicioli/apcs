"use client";

import { useState, useTransition } from "react";
import { CircleCheck, CircleSlash } from "lucide-react";
import { setEventStatusAction } from "@/lib/actions/events";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { EVENT_CONFIRMATION_COPY } from "@/modules/event/event.labels";
import { canActivate, canDeactivate } from "@/modules/event/event.rules";
import type { EventCommand } from "@/modules/event/event.schema";
import type { EventStatus } from "@/modules/event/event.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";

/**
 * Ativar e inativar, sempre com confirmação.
 *
 * ⚠️ O botão "Ativar" NÃO aparece para evento cuja data já passou. Isso é UX: a
 * garantia de verdade é `set_event_status` no Postgres, que devolve EV001. Mas
 * oferecer um botão que sempre falha é pior do que não oferecer — a pessoa
 * clicaria, leria um erro e não saberia que o caminho é corrigir a data.
 */
export function EventStatusActions({
  eventId,
  eventName,
  status,
  eventDate,
  today,
  size = "sm",
}: {
  eventId: string;
  eventName: string;
  status: EventStatus;
  eventDate: string;
  /** O "hoje" da APCS, decidido no servidor — o relógio do navegador pode estar em outro fuso. */
  today: string;
  size?: "sm" | "default";
}) {
  const [command, setCommand] = useState<EventCommand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const evento = { status, eventDate };
  const podeAtivar = canActivate(evento, today);
  const podeInativar = canDeactivate(evento);

  function confirm() {
    if (!command) return;
    setError(null);

    startTransition(async () => {
      const result = await setEventStatusAction({ eventId, command });

      if (!result.ok) {
        setError(ACTION_ERROR_MESSAGES[result.error.code]);
        return;
      }

      setCommand(null);
    });
  }

  if (!podeAtivar && !podeInativar) return null;

  return (
    <>
      {podeInativar ? (
        <Button variant="ghost" size={size} onClick={() => setCommand("deactivate")}>
          <CircleSlash className="h-4 w-4" aria-hidden="true" />
          Inativar
        </Button>
      ) : (
        <Button variant="ghost" size={size} onClick={() => setCommand("activate")}>
          <CircleCheck className="h-4 w-4" aria-hidden="true" />
          Ativar
        </Button>
      )}

      <Dialog
        open={command !== null}
        onClose={() => {
          if (!isPending) {
            setCommand(null);
            setError(null);
          }
        }}
        title={command === "deactivate" ? "Inativar evento" : "Ativar evento"}
        description={eventName}
      >
        <div className="space-y-5">
          <p className="text-sm">
            {command === "deactivate"
              ? EVENT_CONFIRMATION_COPY.deactivate
              : EVENT_CONFIRMATION_COPY.activate}
          </p>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCommand(null);
                setError(null);
              }}
              disabled={isPending}
            >
              Cancelar
            </Button>
            {/* `loading` já desabilita o botão — dois cliques mandariam dois
                comandos e gerariam duas linhas na auditoria. */}
            <Button
              variant={command === "deactivate" ? "destructive" : "default"}
              onClick={confirm}
              loading={isPending}
            >
              {command === "deactivate" ? "Inativar" : "Ativar"}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </>
  );
}
