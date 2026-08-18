"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { retryFailedRecipientsAction } from "@/lib/actions/surveys";
import { formatDateTime } from "@/lib/utils";
import type { SurveyDispatchRun } from "@/modules/survey/survey.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * §35. AS CORRIDAS DE DISPARO.
 *
 * A pergunta que esta seção responde não é "quem recebeu?" (isso é a tabela de
 * participantes) — é "o disparo rodou? terminou? quantas falharam?". São coisas
 * diferentes, e misturá-las numa tela só faz a pessoa procurar o número da
 * campanha dentro de uma lista de gente.
 *
 * ⚠️ ELA SÓ APARECE QUANDO HÁ CORRIDA. Uma seção vazia dizendo "0 disparos"
 * numa enquete que ainda nem foi ativada sugere que algo deveria ter acontecido
 * e não aconteceu.
 */

const SITUACAO: Record<
  SurveyDispatchRun["status"],
  { rotulo: string; variante: "default" | "attention" | "done" | "alert" }
> = {
  pending: { rotulo: "Aguardando", variante: "default" },
  running: { rotulo: "Em andamento", variante: "attention" },
  completed: { rotulo: "Concluído", variante: "done" },
  failed: { rotulo: "Falhou", variante: "alert" },
};

export function SurveyDispatchPanel({
  surveyId,
  runs,
  failedCount,
  canWrite,
}: {
  surveyId: string;
  runs: SurveyDispatchRun[];
  failedCount: number;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);

  if (runs.length === 0) return null;

  function reenviar() {
    setAviso(null);
    startTransition(async () => {
      const resultado = await retryFailedRecipientsAction(surveyId);
      if (!resultado.ok) {
        setAviso(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }
      setAviso(
        resultado.data.requeued === 0
          ? "Nenhum destinatário voltou para a fila. Os que falharam já atingiram o limite de tentativas ou pediram para não receber mensagens."
          : `${resultado.data.requeued} ${resultado.data.requeued === 1 ? "destinatário voltou" : "destinatários voltaram"} para a fila. O envio acontece no próximo ciclo.`,
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Disparos</CardTitle>
        <CardDescription>
          Cada linha é uma execução do envio. O estado de cada pessoa fica na aba de participantes.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Execuções de disparo desta enquete</caption>
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Início
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Situação
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Na fila
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Enviadas
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Falhas
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const situacao = SITUACAO[run.status];
                return (
                  <tr key={run.id} className="border-b last:border-0">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">
                      {formatDateTime(run.startedAt)}
                      {run.finishedAt === null && (
                        <span className="text-muted-foreground block text-xs">sem conclusão</span>
                      )}
                    </th>
                    <td className="py-2 pr-4">
                      <Badge variant={situacao.variante}>{situacao.rotulo}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{run.totalRecipients}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{run.totalSent}</td>
                    <td className="py-2 text-right tabular-nums">{run.totalErrors}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* §19/§27. O caminho de volta quando a causa da falha já foi resolvida. */}
        {canWrite && failedCount > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <p className="text-muted-foreground text-sm">
              {failedCount === 1
                ? "1 destinatário está com falha de envio."
                : `${failedCount} destinatários estão com falha de envio.`}
            </p>
            <Button variant="outline" size="sm" onClick={reenviar} disabled={pendente}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
              {pendente ? "Recolocando na fila…" : "Tentar enviar de novo"}
            </Button>
          </div>
        )}

        {aviso && (
          <p role="status" className="text-muted-foreground text-sm">
            {aviso}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
