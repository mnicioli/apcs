"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * A tela de falha das Enquetes (§54).
 *
 * ⚠️ O que a pessoa vê é uma frase; o detalhe técnico vai para o console do
 * servidor. Mostrar a mensagem crua do Postgres numa tela de CRM não ajuda quem
 * está tentando trabalhar e revela nome de tabela e de constraint.
 *
 * `reset()` existe porque boa parte das falhas aqui é de rede: tentar de novo
 * resolve, e obrigar um F5 (que perde os filtros da URL... não perde, mas parece
 * que perde) é pior que um botão.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(`[surveys] falha na tela: ${error.message}`);
  }, [error]);

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Não foi possível carregar as enquetes</h1>
          <p className="text-muted-foreground text-sm">
            Tente novamente. Se continuar assim, avise o time de tecnologia.
          </p>
        </div>
        <Button onClick={reset}>Tentar novamente</Button>
      </CardContent>
    </Card>
  );
}
