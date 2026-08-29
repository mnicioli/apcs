"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Send } from "lucide-react";
import { dispatchEventAction } from "@/lib/actions/events";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";

/**
 * DIVULGAR — o botão que faz o WhatsApp sair.
 *
 * ⚠️ A CONFIRMAÇÃO DIZ O NÚMERO, e isso não é enfeite de UX. Mensagem de
 * WhatsApp não tem desfazer: a diferença entre aprovar "12 pessoas" e "1.200"
 * é a diferença entre um erro corrigível e um incidente com o número da APCS.
 * Um público-alvo marcado errado aparece aqui, ANTES, e não depois.
 *
 * ⚠️ O BOTÃO NÃO APARECE PARA EVENTO INATIVO OU VENCIDO. A garantia de verdade
 * é `start_event_dispatch`, que recusa no Postgres (EV004/EV005). Mas oferecer
 * um botão que sempre falha é pior que não oferecer — mesma decisão que
 * `EventStatusActions` tomou para "Ativar".
 */
export function EventDispatchButton({
  eventId,
  eventName,
  segmentNames,
  audience,
  remaining,
  size = "sm",
}: {
  eventId: string;
  eventName: string;
  /** Os públicos-alvo do evento, por nome. É o que a pessoa confere. */
  segmentNames: string[];
  audience: { total: number; blocked: number; available: boolean };
  /** Quantos ainda estão na fila de uma divulgação anterior. */
  remaining: number;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ queued: number; blocked: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  const continuando = remaining > 0;

  function confirm() {
    setError(null);

    startTransition(async () => {
      const result = await dispatchEventAction({ eventId });

      if (!result.ok) {
        setError(ACTION_ERROR_MESSAGES[result.error.code]);
        return;
      }

      setDone({ queued: result.data.queued, blocked: result.data.blocked });
      // O envio roda DEPOIS da resposta (ver a action). Atualizar a rota é o
      // que traz os números da corrida quando a pessoa fechar a caixa.
      router.refresh();
    });
  }

  function close() {
    if (isPending) return;
    setOpen(false);
    setError(null);
    setDone(null);
  }

  return (
    <>
      <Button
        variant={continuando ? "default" : "outline"}
        size={size}
        onClick={() => setOpen(true)}
      >
        <Megaphone className="h-4 w-4" aria-hidden="true" />
        {continuando ? "Continuar divulgação" : "Divulgar"}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={continuando ? "Continuar divulgação" : "Divulgar evento"}
        description={eventName}
      >
        <div className="space-y-5">
          {done ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">Divulgação iniciada.</p>
              <p className="text-muted-foreground">
                {done.queued === 0
                  ? "Ninguém novo entrou na fila — o envio continua de onde parou."
                  : done.queued === 1
                    ? "1 pessoa entrou na fila."
                    : `${done.queued} pessoas entraram na fila.`}
                {done.blocked > 0 && ` ${done.blocked} não receberão por terem pedido para sair.`}
              </p>
              {/* ⚠️ Dizer que o envio CONTINUA, e não que terminou. Ele roda
                  depois da resposta, e prometer "enviado" agora seria mentira
                  no instante em que é dita. */}
              <p className="text-muted-foreground">
                As mensagens estão saindo em segundo plano. Atualize a página em alguns instantes
                para ver o andamento.
              </p>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              {continuando ? (
                <p>
                  Ainda faltam <strong>{remaining}</strong> {remaining === 1 ? "pessoa" : "pessoas"}{" "}
                  na fila desta divulgação. Deseja continuar de onde parou?
                </p>
              ) : audience.available ? (
                <p>
                  Isto vai enviar uma mensagem de WhatsApp para{" "}
                  <strong>
                    {audience.total} {audience.total === 1 ? "associado" : "associados"}
                  </strong>
                  {segmentNames.length > 0 && ` de ${segmentNames.join(", ")}`}.
                </p>
              ) : (
                <p>
                  Não foi possível calcular a audiência agora. Você ainda pode divulgar — o sistema
                  monta a lista no momento do envio.
                </p>
              )}

              {audience.available && audience.blocked > 0 && (
                <p className="text-muted-foreground">
                  {audience.blocked}{" "}
                  {audience.blocked === 1
                    ? "pessoa não receberá por ter pedido"
                    : "pessoas não receberão por terem pedido"}{" "}
                  para não receber notificações.
                </p>
              )}

              {audience.available && audience.total === 0 && !continuando && (
                <p role="alert" className="text-destructive">
                  Nenhum associado dos públicos-alvo deste evento tem WhatsApp cadastrado. Nada será
                  enviado.
                </p>
              )}

              <p className="text-muted-foreground">
                Mensagem de WhatsApp não tem desfazer. Confira a data, o local e o público-alvo
                antes de confirmar.
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={isPending}>
              {done ? "Fechar" : "Cancelar"}
            </Button>
            {!done && (
              // `loading` já desabilita: dois cliques abririam duas corridas.
              <Button onClick={confirm} loading={isPending}>
                <Send className="h-4 w-4" aria-hidden="true" />
                {continuando ? "Continuar" : "Divulgar agora"}
              </Button>
            )}
          </DialogFooter>
        </div>
      </Dialog>
    </>
  );
}
