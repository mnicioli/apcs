"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { eventListHref } from "@/modules/event/event.registrations.routes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A BUSCA DAS TRÊS TELAS DE SELEÇÃO DE EVENTO — Inscrições, Lista de Presença e
 * Avaliações.
 *
 * ============================================================================
 * ⚠️ ESTE ARQUIVO EXISTE PORQUE O TERCEIRO APARECEU.
 * ============================================================================
 * `presence-event-search.tsx` trazia esta nota, escrita quando havia duas
 * cópias:
 *
 *   "É GÊMEO DE `EventSearch` (Inscrições), E NÃO O MESMO COMPONENTE. A única
 *    diferença é a rota que ele monta (...) um componente compartilhado
 *    precisaria receber a função de endereço como propriedade, o que troca
 *    vinte linhas duplicadas por uma indireção que esconde para onde a tela
 *    navega. **Se um terceiro aparecer, aí vale extrair.**"
 *
 * Avaliações é o terceiro. A conta virou: três cópias do mesmo `debounce`, do
 * mesmo `replace` sem `push` e do mesmo voltar-para-a-página-1 são três lugares
 * para a próxima correção não chegar — e a terceira, a menos usada, seria a que
 * ficaria para trás.
 *
 * ⚠️ E A EXTRAÇÃO COBROU UM PREÇO QUE EU NÃO TINHA PREVISTO. A primeira versão
 * recebia a função de endereço como propriedade — e isso QUEBROU as quatro
 * telas em produção, porque função não atravessa a fronteira RSC. Ver o
 * comentário de `basePath` abaixo.
 *
 * O que atravessa agora é o começo do endereço, e quem monta o resto é
 * `eventListHref` — a mesma função que `presenceHref` e companhia usam. Lendo a
 * PÁGINA ainda dá para ver para onde ela navega: o caminho está escrito lá.
 */
const DEBOUNCE_MS = 300;

export interface EventSearchBoxProps {
  query: string;
  /**
   * O começo do endereço — `/events/presence`, `/events/results`, ...
   *
   * ============================================================================
   * ⚠️ UMA STRING, E NÃO A FUNÇÃO QUE MONTA O ENDEREÇO. ISSO JÁ FOI UM DEFEITO
   * EM PRODUÇÃO.
   * ============================================================================
   * A primeira versão recebia `href: (query: string) => string`, e as páginas
   * passavam `href={(t) => presenceHref(1, t)}`. Elas são SERVER COMPONENTS e
   * este é um CLIENT COMPONENT — e função não atravessa a fronteira RSC, porque
   * não é serializável. O Next recusa em runtime.
   *
   * ⚠️ E NADA AVISOU ANTES: `next build` compila, o `tsc` não modela a fronteira
   * (para ele é só uma função) e nenhum teste renderiza aquelas páginas. As
   * quatro telas de seleção de evento quebraram ao mesmo tempo, já no ar.
   *
   * ⚠️ POR QUE O `Pagination` PODE E ESTE NÃO. `Pagination` é Server Component:
   * a função que ele recebe é chamada no servidor, e nada cruza fronteira
   * nenhuma. A diferença não é a forma da propriedade — é o lado em que o
   * componente roda.
   *
   * Regra prática: **toda propriedade de um componente `"use client"` tem de
   * sobreviver a um `JSON.stringify`.**
   */
  basePath: string;
  label: string;
  placeholder: string;
}

export function EventSearchBox({ query, basePath, label, placeholder }: EventSearchBoxProps) {
  const router = useRouter();
  const [term, setTerm] = useState(query);
  const id = useId();

  useEffect(() => {
    if (term === query) return;

    // O atraso é o que impede uma navegação por tecla digitada. `replace` e não
    // `push`: cada letra não deve virar uma parada no botão "voltar".
    //
    // ⚠️ SEMPRE A PÁGINA 1. Procurar estando na página 3 daria "nenhum evento
    // encontrado" sobre um resultado que tem duas páginas — e a pessoa
    // concluiria que o evento não existe.
    const timer = setTimeout(() => {
      router.replace(eventListHref(basePath, 1, term), { scroll: false });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, query, router, basePath]);

  return (
    <div className="max-w-md space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          id={id}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={placeholder}
          className="pl-9"
        />
      </div>
    </div>
  );
}
