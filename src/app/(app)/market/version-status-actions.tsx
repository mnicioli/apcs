"use client";

import { useState, useTransition } from "react";
import { CircleCheck } from "lucide-react";
import { setVersionStatusAction } from "@/lib/actions/market-bulletins";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { MARKET_ACTIVATE_WARNING } from "@/modules/market/market.labels";
import type { MarketVersionStatus } from "@/modules/market/market.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";

/**
 * O aviso de que alguém mexeu na mesma Bolsa enquanto esta tela estava aberta.
 *
 * O índice único parcial é o que produz esse erro: duas telas tentando deixar
 * publicações diferentes ativas ao mesmo tempo. Mandar "erro inesperado" faria
 * a pessoa tentar de novo às cegas; o texto diz o que fazer.
 */
const CONCORRENCIA =
  "A Bolsa foi atualizada por outra pessoa. Atualize a página para ver o estado mais recente.";

/**
 * Ativar (ou reativar) uma publicação, sempre com confirmação.
 *
 * ⚠️ NÃO EXISTE BOTÃO "INATIVAR", e a ausência é a regra: a Bolsa não pode ficar
 * sem publicação ativa, e como só existe uma ativa por vez, inativar "a ativa"
 * seria exatamente o que a esvaziaria. O banco recusa (MB001) — oferecer o
 * botão seria convidar a pessoa a clicar, ler um erro e não descobrir que o
 * caminho é ATIVAR a outra. A tela do histórico explica isso por escrito.
 *
 * "Ativar" e "Reativar" são a mesma operação; o rótulo é um só, e a confirmação
 * é que diz o que vai acontecer com a publicação que sai.
 */
export function VersionStatusActions({
  bulletinId,
  versionId,
  versionName,
  status,
  activeVersionName,
}: {
  bulletinId: string;
  versionId: string;
  versionName: string;
  status: MarketVersionStatus;
  /** A publicação ativa hoje, ou `null` se ainda não houver nenhuma. */
  activeVersionName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // A publicação ativa não oferece ação nenhuma aqui. Ver o comentário do topo.
  if (status === "active") return null;

  function confirm() {
    setError(null);

    startTransition(async () => {
      const result = await setVersionStatusAction({ bulletinId, versionId, command: "activate" });

      if (!result.ok) {
        setError(
          result.error.code === "uniqueViolation"
            ? CONCORRENCIA
            : ACTION_ERROR_MESSAGES[result.error.code],
        );
        return;
      }

      setOpen(false);
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <CircleCheck className="h-4 w-4" aria-hidden="true" />
        Ativar
      </Button>

      <Dialog
        open={open}
        onClose={() => {
          if (isPending) return;
          setOpen(false);
          setError(null);
        }}
        title="Ativar versão?"
      >
        <div className="space-y-5">
          <p className="text-sm">
            {activeVersionName === null ? (
              <>
                A publicação <strong>{versionName}</strong> passará a ser a oficial da Bolsa.
              </>
            ) : (
              <>
                Esta ação irá ativar a publicação <strong>{versionName}</strong> e inativar
                automaticamente a que está ativa hoje (<strong>{activeVersionName}</strong>).
              </>
            )}
          </p>

          <p className="text-muted-foreground text-sm">{MARKET_ACTIVATE_WARNING}</p>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button onClick={confirm} loading={isPending}>
              Ativar versão
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </>
  );
}
