"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { RESULTS_FILTER_LABELS } from "@/modules/event/event.results.labels";
import { eventResultsHref } from "@/modules/event/event.results.routes";
import {
  RATING_FILTERS,
  RESULTS_FILTERS,
  type ResultsFilter,
  type ResultsFilters,
} from "@/modules/event/event.results.types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * Busca e filtros das abas de Respostas e de Pendentes (§14, §17, §18).
 *
 * ⚠️ O ESTADO MORA NA URL, e o §17 é explícito sobre o porquê: "a busca deve
 * utilizar o backend quando o projeto trabalhar com paginação server-side".
 * Filtrar no navegador exigiria baixar TODAS as respostas do evento — nome,
 * e-mail, telefone e o comentário identificado de centenas de pessoas — para
 * depois esconder a maioria.
 *
 * ⚠️ QUALQUER MUDANÇA VOLTA PARA A PÁGINA 1. Sem isso, filtrar "com comentário"
 * estando na página 3 daria "nenhuma resposta encontrada" sobre um resultado que
 * tem duas páginas — e a conclusão seria que ninguém comentou.
 *
 * ⚠️ E A ABA VIAJA JUNTO. Sem ela no endereço, aplicar um filtro na aba de
 * Pendentes jogaria a pessoa de volta no Painel.
 */
const DEBOUNCE_MS = 300;

export function ResultsFiltersBar({
  eventId,
  filtros,
  temPerguntaGeral,
  somenteBusca = false,
}: {
  eventId: string;
  filtros: ResultsFilters;
  /**
   * §18. Sem pergunta marcada como avaliação geral, os cinco filtros de nota
   * não têm contra o que filtrar — e o §18 proíbe aplicá-los a qualquer
   * pergunta. Escondê-los é melhor que oferecer cinco opções que devolvem zero.
   */
  temPerguntaGeral: boolean;
  /** A aba de Pendentes não tem filtro de nota nem de comentário: ninguém ali respondeu. */
  somenteBusca?: boolean;
}) {
  const router = useRouter();
  const [term, setTerm] = useState(filtros.query);

  const searchId = useId();
  const filterId = useId();

  const navigate = useCallback(
    (next: Partial<ResultsFilters>) => {
      router.replace(
        // `page: 1` sempre — ver o aviso do cabeçalho.
        eventResultsHref(eventId, { ...filtros, ...next, page: 1 }),
        { scroll: false },
      );
    },
    [eventId, filtros, router],
  );

  useEffect(() => {
    if (term === filtros.query) return;

    const timer = setTimeout(() => navigate({ query: term }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, filtros.query, navigate]);

  const opcoes = RESULTS_FILTERS.filter(
    (opcao) => temPerguntaGeral || !(RATING_FILTERS as readonly string[]).includes(opcao),
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1 space-y-2">
        <Label htmlFor={searchId}>Buscar</Label>
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            id={searchId}
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            // §17. Os quatro campos que a consulta do banco procura.
            placeholder="Participante, granja, e-mail ou WhatsApp"
            className="pl-9"
          />
        </div>
      </div>

      {!somenteBusca && (
        <div className="w-60 space-y-2">
          <Label htmlFor={filterId}>Filtro</Label>
          <Select
            id={filterId}
            value={filtros.filter}
            onChange={(event) => navigate({ filter: event.target.value as ResultsFilter })}
          >
            {opcoes.map((opcao) => (
              <option key={opcao} value={opcao}>
                {RESULTS_FILTER_LABELS[opcao]}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}
