"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * O que aparece quando a leitura da Bolsa falha.
 *
 * `error.tsx` é o mecanismo do App Router: ele captura o erro lançado pelo
 * service (que, por contrato, LANÇA em vez de devolver `ActionResult`) e mantém
 * o resto do app de pé — sidebar, topbar e navegação continuam funcionando.
 *
 * `reset()` refaz a renderização do segmento sem recarregar a página inteira,
 * que é exatamente o "tentar novamente" que a pessoa espera.
 *
 * A mensagem do erro NÃO vai para a tela: ela pode conter nome de tabela ou de
 * constraint. Vai para o console do servidor, onde alguém age sobre ela.
 */
export default function MarketError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(`[market] falha ao carregar a tela: ${error.message}`);
  }, [error]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Bolsa</h1>

      <Card>
        <CardContent className="space-y-4 p-6">
          <p role="alert" className="text-sm">
            Não foi possível carregar as informações. Tente novamente.
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
