"use client";

import { useState, useTransition } from "react";
import { CircleCheck, CircleSlash } from "lucide-react";
import { setVersionStatusAction } from "@/lib/actions/documents";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { versionLabel } from "@/modules/document/document.rules";
import type { VersionCommand } from "@/modules/document/document.schema";
import type { DocumentVersionStatus } from "@/modules/document/document.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";

/**
 * Ativar/reativar e inativar uma versão, sempre com confirmação.
 *
 * A confirmação nomeia as DUAS versões envolvidas — a que entra e a que sai —
 * porque a consequência real não é "esta versão fica ativa", é "o arquivo que o
 * chatbot usa passa a ser outro". Quem clica precisa reconhecer a versão que
 * está saindo do ar para saber se é isso mesmo que quer (item 23 do escopo).
 */
export function VersionStatusActions({
  versionId,
  version,
  status,
  activeVersion,
}: {
  versionId: string;
  version: number;
  status: DocumentVersionStatus;
  /** A versão ativa hoje no documento, ou `null` se nenhuma estiver. */
  activeVersion: number | null;
}) {
  const [command, setCommand] = useState<VersionCommand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    if (!command) return;
    setError(null);

    startTransition(async () => {
      const result = await setVersionStatusAction({ versionId, command });

      if (!result.ok) {
        setError(ACTION_ERROR_MESSAGES[result.error.code]);
        return;
      }

      setCommand(null);
    });
  }

  const isActive = status === "active";
  // Reativar uma versão antiga e ativar a primeira de todas são a mesma
  // operação para o sistema, mas não para quem lê o botão.
  const activateLabel = activeVersion === null ? "Ativar" : "Reativar";

  return (
    <>
      {isActive ? (
        <Button variant="ghost" size="sm" onClick={() => setCommand("deactivate")}>
          <CircleSlash className="h-4 w-4" aria-hidden="true" />
          Inativar
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setCommand("activate")}>
          <CircleCheck className="h-4 w-4" aria-hidden="true" />
          {activateLabel}
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
        title={command === "deactivate" ? "Inativar versão" : `${activateLabel} versão`}
      >
        <div className="space-y-5">
          <p className="text-sm">
            {command === "deactivate" ? (
              <>
                A versão <strong>{versionLabel(version)}</strong> sairá do ar. O documento ficará
                sem versão ativa, e o chatbot passará a encaminhar essas perguntas para uma pessoa
                em vez de usar um arquivo antigo.
              </>
            ) : activeVersion === null ? (
              <>
                A versão <strong>{versionLabel(version)}</strong> passará a ser a oficial e ficará
                disponível para o chatbot.
              </>
            ) : (
              <>
                Esta ação irá ativar a versão <strong>{versionLabel(version)}</strong> e inativar
                automaticamente a versão atualmente ativa (
                <strong>{versionLabel(activeVersion)}</strong>).
              </>
            )}
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
            <Button
              variant={command === "deactivate" ? "destructive" : "default"}
              onClick={confirm}
              loading={isPending}
            >
              {command === "deactivate" ? "Confirmar inativação" : "Confirmar ativação"}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </>
  );
}
