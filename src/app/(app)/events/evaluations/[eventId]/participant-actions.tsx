"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import {
  cancelEvaluationAction,
  reopenEvaluationAction,
  resendEvaluationAction,
} from "@/lib/actions/event-evaluation";
import type { EvaluationStatus } from "@/modules/event/event.evaluation.types";
import { Button } from "@/components/ui/button";

/**
 * AS AÇÕES DE UMA LINHA DO ANDAMENTO (§17, §19).
 *
 * ============================================================================
 * ⚠️ QUAL BOTÃO APARECE DEPENDE DA SITUAÇÃO, E A REGRA É A MESMA DO BANCO.
 * ============================================================================
 *   ainda não gerada  →  nada (a rotina ainda vai passar por aqui)
 *   na fila / enviada →  Reenviar · Cancelar
 *   respondida        →  Reabrir            (§19, e só com `evaluations.write`)
 *   expirada          →  nada (o link já não aceita resposta; reenviar seria
 *                        mandar um endereço morto)
 *   cancelada         →  Reenviar
 *
 * ⚠️ ESCONDER O BOTÃO NÃO É A REGRA — é a cortesia. Quem recusa é a função do
 * Postgres: reenviar uma respondida devolve AV004, reabrir uma não respondida
 * devolve AV003, e as duas conferem a permissão por dentro. Esta lista existe
 * para ninguém clicar num botão que vai dizer "não".
 */
export function ParticipantEvaluationActions({
  eventId,
  participantEvaluationId,
  status,
  fullName,
  canSend,
  canWrite,
}: {
  eventId: string;
  participantEvaluationId: string | null;
  status: EvaluationStatus | null;
  fullName: string;
  canSend: boolean;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  // Sem linha no banco não há o que reenviar nem cancelar: a rotina ainda vai
  // criar a avaliação desta pessoa.
  if (participantEvaluationId === null || status === null) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  function executar(acao: typeof resendEvaluationAction, confirmacao?: string): void {
    if (confirmacao && !window.confirm(confirmacao)) return;

    setErro(null);
    startTransition(async () => {
      const resultado = await acao({
        eventId,
        // O `if` acima já garantiu que não é nulo; o TypeScript não enxerga
        // isso de dentro do callback.
        participantEvaluationId: participantEvaluationId as string,
      });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }
      router.refresh();
    });
  }

  const podeReenviar =
    canSend && (status === "scheduled" || status === "sent" || status === "cancelled");
  const podeCancelar = canSend && (status === "scheduled" || status === "sent");
  const podeReabrir = canWrite && status === "answered";

  return (
    <div className="flex flex-wrap items-center gap-1">
      {podeReenviar && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pendente}
          onClick={() => executar(resendEvaluationAction)}
        >
          Reenviar
        </Button>
      )}

      {podeCancelar && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pendente}
          onClick={() =>
            executar(
              cancelEvaluationAction,
              `Cancelar a avaliação de ${fullName}? Ela sai da fila e a pessoa não recebe o convite.`,
            )
          }
        >
          Cancelar
        </Button>
      )}

      {podeReabrir && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pendente}
          onClick={() =>
            executar(
              reopenEvaluationAction,
              // ⚠️ O AVISO DIZ O QUE ACONTECE COM A RESPOSTA ANTERIOR, porque é a
              // primeira pergunta de quem vai clicar. Ela NÃO é apagada (§19):
              // o banco abre uma rodada nova e grava ao lado.
              `Reabrir a avaliação de ${fullName}? A resposta atual é preservada no histórico e a pessoa poderá responder de novo pelo mesmo link.`,
            )
          }
        >
          Reabrir
        </Button>
      )}

      {!podeReenviar && !podeCancelar && !podeReabrir && (
        <span className="text-muted-foreground text-xs">—</span>
      )}

      {erro && (
        <span role="alert" className="text-destructive block text-xs">
          {erro}
        </span>
      )}
    </div>
  );
}
