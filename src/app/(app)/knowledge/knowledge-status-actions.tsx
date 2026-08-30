"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { setKnowledgeStatusAction } from "@/lib/actions/knowledge";
import type { KnowledgeStatus } from "@/modules/intelligence/knowledge.types";
import { Button } from "@/components/ui/button";

/**
 * Ativar / inativar direto na linha da grid.
 *
 * ⚠️ NÃO PERGUNTA "TEM CERTEZA?", e é deliberado: as duas ações são reversíveis
 * com um clique no mesmo botão, e um diálogo de confirmação para algo assim
 * treina a pessoa a confirmar sem ler — o que estraga os diálogos que existem
 * para coisas irreversíveis.
 */
export function KnowledgeStatusActions({ id, status }: { id: string; status: KnowledgeStatus }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  const ativo = status === "active";

  function alternar() {
    setErro(null);

    startTransition(async () => {
      const resultado = await setKnowledgeStatusAction({
        id,
        command: ativo ? "deactivate" : "activate",
      });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" loading={pendente} onClick={alternar}>
        {ativo ? "Inativar" : "Ativar"}
      </Button>
      {erro && (
        <p role="alert" className="text-destructive max-w-xs text-xs">
          {erro}
        </p>
      )}
    </div>
  );
}
