"use client";

import { useId, useState, useTransition } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { searchKnowledgeAction } from "@/lib/actions/knowledge";
import {
  KNOWLEDGE_SEARCH_EMPTY,
  KNOWLEDGE_SEARCH_HELP,
  KNOWLEDGE_SEARCH_PLACEHOLDER,
  KNOWLEDGE_SEARCH_TITLE,
} from "@/modules/intelligence/knowledge.labels";
import type { KnowledgeSearchHit } from "@/modules/intelligence/knowledge.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * "O QUE O CHATBOT ENCONTRARIA COM ESTA MENSAGEM?"
 *
 * ⚠️ CHAMA A MESMA FUNÇÃO DO BANCO QUE O ROBÔ VAI CHAMAR (`search_knowledge`).
 * Uma busca reimplementada aqui responderia sobre um sistema PARECIDO com o que
 * está no ar — e a diferença apareceria como "testei e funcionava", que é o
 * pior resultado possível para uma tela de teste.
 *
 * ⚠️ E É POR ISSO QUE O PAINEL EXISTE. O erro que ele pega é sempre o mesmo:
 * palavras-chave escritas do jeito que a APCS fala ("boletim", "cotação")
 * quando o associado escreve de outro ("preço", "quanto tá"). Sem esta tela, a
 * descoberta é o robô respondendo "não encontrei" a uma pessoa de verdade.
 */
export function KnowledgeSearchPanel() {
  const campoId = useId();

  const [mensagem, setMensagem] = useState("");
  const [resultados, setResultados] = useState<KnowledgeSearchHit[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function testar() {
    setErro(null);

    startTransition(async () => {
      const resultado = await searchKnowledgeAction({ query: mensagem });

      if (!resultado.ok) {
        setResultados(null);
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      setResultados(resultado.data);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
          {KNOWLEDGE_SEARCH_TITLE}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">{KNOWLEDGE_SEARCH_HELP}</p>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-2">
            <Label htmlFor={campoId}>Mensagem do associado</Label>
            <Input
              id={campoId}
              value={mensagem}
              maxLength={1000}
              placeholder={KNOWLEDGE_SEARCH_PLACEHOLDER}
              onChange={(evento) => setMensagem(evento.target.value)}
              onKeyDown={(evento) => {
                if (evento.key === "Enter" && mensagem.trim().length >= 2) testar();
              }}
            />
          </div>
          <Button loading={pendente} disabled={mensagem.trim().length < 2} onClick={testar}>
            Testar
          </Button>
        </div>

        {erro && (
          <p role="alert" className="text-destructive text-sm">
            {erro}
          </p>
        )}

        {resultados !== null && !erro && (
          <div role="status" className="space-y-3">
            {resultados.length === 0 ? (
              <p className="text-muted-foreground text-sm">{KNOWLEDGE_SEARCH_EMPTY}</p>
            ) : (
              <>
                <p className="text-muted-foreground text-sm">
                  {resultados.length === 1
                    ? "O chatbot responderia com este item:"
                    : `O chatbot encontraria ${resultados.length} itens — responderia com o primeiro:`}
                </p>
                <ol className="space-y-3">
                  {resultados.map((hit) => (
                    <li key={hit.id} className="border-border rounded-lg border p-4">
                      <p className="text-muted-foreground text-xs">{hit.category}</p>
                      <p className="font-medium">{hit.title}</p>
                      <p className="text-muted-foreground mt-2 text-sm whitespace-pre-wrap">
                        {hit.content}
                      </p>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
