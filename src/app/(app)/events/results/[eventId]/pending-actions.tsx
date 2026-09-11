"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { resendEvaluationAction } from "@/lib/actions/event-evaluation";
import type { EvaluationStatus } from "@/modules/event/event.evaluation.types";
import { Button } from "@/components/ui/button";

/**
 * O REENVIO A PARTIR DOS RESULTADOS (§32).
 *
 * ============================================================================
 * ⚠️ REUSA `resendEvaluationAction` DO PROMPT 2, INTEIRA.
 * ============================================================================
 * O §32 é explícito: "Reutilizar o service existente. Não duplicar lógica."
 *
 * O que aquela action já faz, e que este arquivo não repete: confere
 * `evaluations.send`, confere no BANCO que a avaliação pertence a este evento
 * (§45), recusa reenvio de avaliação já respondida (AV004) ou vencida (AV005),
 * devolve a linha para a fila com as tentativas zeradas, mantém o MESMO token —
 * o link que a pessoa talvez já tenha continua valendo — e escreve na trilha.
 *
 * Este componente é um botão. A única regra que ele tem é qual botão mostrar.
 *
 * ⚠️ E A PERMISSÃO É `evaluations.send`, E NÃO `results.export` OU `results.read`.
 * Reenviar é a mesma operação da tela de Avaliações, feita de outro lugar —
 * inventar uma permissão de reenvio "dos resultados" criaria duas portas para a
 * mesma ação, com a chance de uma ficar mais frouxa que a outra.
 */
export function PendingActions({
  eventId,
  participantEvaluationId,
  status,
  canSend,
}: {
  eventId: string;
  participantEvaluationId: string | null;
  status: EvaluationStatus | null;
  canSend: boolean;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  /**
   * ⚠️ SEM LINHA NO BANCO NÃO HÁ O QUE REENVIAR. Quem ainda não tem avaliação
   * criada está esperando a ROTINA passar, não um reenvio — e um botão aqui
   * chamaria uma action com `null`.
   *
   * ⚠️ E EXPIRADA TAMBÉM NÃO. O banco recusa (AV005), porque reenviar um link
   * que já não aceita resposta é mandar um endereço morto. Mostrar o botão para
   * levar um "não" é pior que não mostrar.
   */
  const podeReenviar =
    canSend &&
    participantEvaluationId !== null &&
    (status === "scheduled" || status === "sent" || status === "pending");

  if (!podeReenviar) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  function reenviar() {
    setErro(null);
    startTransition(async () => {
      const resultado = await resendEvaluationAction({
        eventId,
        // O `podeReenviar` acima já garantiu que não é nulo; o TypeScript não
        // enxerga isso de dentro do callback.
        participantEvaluationId: participantEvaluationId as string,
      });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="ghost" size="sm" disabled={pendente} onClick={reenviar}>
        {pendente ? "Reenviando…" : "Reenviar"}
      </Button>
      {erro && (
        <span role="alert" className="text-destructive text-xs">
          {erro}
        </span>
      )}
    </div>
  );
}
