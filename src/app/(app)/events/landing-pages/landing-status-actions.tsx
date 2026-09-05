"use client";

import { useState, useTransition } from "react";
import { CircleSlash, LockKeyhole, Rocket } from "lucide-react";
import { setLandingPageStatusAction } from "@/lib/actions/event-landing";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { LANDING_CONFIRMATION_COPY } from "@/modules/event/event.landing.labels";
import {
  canCloseLanding,
  canDeactivateLanding,
  canPublishLanding,
} from "@/modules/event/event.landing.rules";
import type { LandingPageStatus } from "@/modules/event/event.landing.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";

type Comando = "publish" | "close" | "deactivate";

const TITULOS: Record<Comando, string> = {
  publish: "Publicar página de inscrição",
  close: "Encerrar inscrições",
  deactivate: "Tirar a página do ar",
};

const BOTOES: Record<Comando, string> = {
  publish: "Publicar",
  close: "Encerrar",
  deactivate: "Tirar do ar",
};

/**
 * Publicar, encerrar e tirar do ar — sempre com confirmação (§22, §24, §26).
 *
 * ⚠️ OS BOTÕES SEGUEM AS TRANSIÇÕES, e não a vontade da tela. `canPublish`,
 * `canClose` e `canDeactivate` são as MESMAS funções que descrevem o que
 * `set_event_landing_page_status` aceita. Oferecer um botão que sempre falha é
 * pior do que não oferecer: a pessoa clica, lê um erro e não descobre qual é o
 * caminho.
 *
 * ⚠️ A GARANTIA CONTINUA SENDO O BANCO. Publicar a página de um evento cuja
 * data já passou é recusado lá (EV001) — e essa checagem não é espelhada aqui
 * porque ela depende do "hoje" do servidor. Uma aba deixada aberta durante a
 * virada do dia mostraria o botão; o clique é que traz a mensagem certa.
 */
export function LandingStatusActions({
  landingPageId,
  eventName,
  status,
  size = "sm",
  onDone,
}: {
  landingPageId: string;
  eventName: string;
  status: LandingPageStatus;
  size?: "sm" | "default";
  /** O Builder usa para limpar o estado de "não salvo" depois de publicar. */
  onDone?: () => void;
}) {
  const [comando, setComando] = useState<Comando | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const pagina = { status };
  const podePublicar = canPublishLanding(pagina);
  const podeEncerrar = canCloseLanding(pagina);
  const podeInativar = canDeactivateLanding(pagina);

  function confirmar() {
    if (!comando) return;
    setErro(null);

    startTransition(async () => {
      const resultado = await setLandingPageStatusAction({ landingPageId, command: comando });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      setComando(null);
      onDone?.();
    });
  }

  if (!podePublicar && !podeEncerrar && !podeInativar) return null;

  return (
    <>
      {podePublicar && (
        <Button variant="ghost" size={size} onClick={() => setComando("publish")}>
          <Rocket className="h-4 w-4" aria-hidden="true" />
          {status === "draft" ? "Publicar" : "Republicar"}
        </Button>
      )}

      {podeEncerrar && (
        <Button variant="ghost" size={size} onClick={() => setComando("close")}>
          <LockKeyhole className="h-4 w-4" aria-hidden="true" />
          Encerrar
        </Button>
      )}

      {podeInativar && (
        <Button variant="ghost" size={size} onClick={() => setComando("deactivate")}>
          <CircleSlash className="h-4 w-4" aria-hidden="true" />
          Tirar do ar
        </Button>
      )}

      <Dialog
        open={comando !== null}
        onClose={() => {
          if (!isPending) {
            setComando(null);
            setErro(null);
          }
        }}
        title={comando ? TITULOS[comando] : ""}
        description={eventName}
      >
        <div className="space-y-5">
          <p className="text-sm">{comando ? LANDING_CONFIRMATION_COPY[comando] : ""}</p>

          {erro && (
            <p role="alert" className="text-destructive text-sm">
              {erro}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setComando(null);
                setErro(null);
              }}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button onClick={confirmar} disabled={isPending}>
              {isPending ? "Aguarde…" : comando ? BOTOES[comando] : ""}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </>
  );
}
