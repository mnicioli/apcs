"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { LECTURE_MODULE_TITLE } from "@/modules/lecture/lecture.labels";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * O que aparece quando a leitura das palestras falha (§52).
 *
 * `error.tsx` é o mecanismo do App Router: ele captura o erro lançado pelo
 * service (que, por contrato, LANÇA em vez de devolver `ActionResult`) e mantém
 * o resto do app de pé — sidebar, topbar e navegação continuam funcionando.
 *
 * A mensagem do erro NÃO vai para a tela: ela pode conter nome de tabela ou de
 * constraint. Vai para o console do servidor, onde alguém age sobre ela.
 */
export default function LecturesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(`[lectures] falha ao carregar a tela: ${error.message}`);
  }, [error]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{LECTURE_MODULE_TITLE}</h1>

      <Card>
        <CardContent className="space-y-4 p-6">
          <p role="alert" className="text-sm">
            Não foi possível carregar as palestras. Tente novamente.
          </p>
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
