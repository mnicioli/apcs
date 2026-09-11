"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { EVALUATION_PARTICIPANT_FILTER_LABELS } from "@/modules/event/event.evaluation.labels";
import { eventEvaluationHref } from "@/modules/event/event.evaluation.routes";
import {
  EVALUATION_PARTICIPANT_FILTERS,
  type EvaluationParticipantFilter,
  type EvaluationParticipantFilters,
} from "@/modules/event/event.evaluation.types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * Filtros do andamento da avaliação (§21).
 *
 * ⚠️ O ESTADO MORA NA URL. A lista é renderizada no servidor: é a URL que
 * precisa mudar para vir gente nova do banco. Filtrar no navegador exigiria
 * baixar TODOS os presentes do evento — nome e e-mail de centenas de terceiros
 * — para depois esconder a maioria.
 *
 * ⚠️ QUALQUER MUDANÇA VOLTA PARA A PÁGINA 1. Sem isso, filtrar "Respondida"
 * estando na página 3 daria "nenhum participante encontrado" sobre um resultado
 * que tem duas páginas — e a conclusão seria que ninguém respondeu.
 *
 * ⚠️ SÃO DOIS CONTROLES, E NÃO CINCO. Não há filtro de presença (a lista já é
 * só de presentes, §11), não há de confirmação (ela não é critério de nada aqui,
 * §11) e não há de período (a tela é de um evento só). Cada controle a mais é
 * uma escolha a mais numa tela que se abre para responder uma pergunta:
 * "fulano recebeu?"
 */
const DEBOUNCE_MS = 300;

export function EvaluationFiltersBar({
  eventId,
  filters,
}: {
  eventId: string;
  filters: EvaluationParticipantFilters;
}) {
  const router = useRouter();
  const [term, setTerm] = useState(filters.query);

  const searchId = useId();
  const statusId = useId();

  const navigate = useCallback(
    (next: Partial<EvaluationParticipantFilters>) => {
      router.replace(
        // `page: 1` sempre — ver o aviso do cabeçalho.
        eventEvaluationHref(eventId, { ...filters, ...next, page: 1 }),
        { scroll: false },
      );
    },
    [eventId, filters, router],
  );

  useEffect(() => {
    if (term === filters.query) return;

    const timer = setTimeout(() => navigate({ query: term }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, filters.query, navigate]);

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
            placeholder="Granja, participante ou e-mail"
            className="pl-9"
          />
        </div>
      </div>

      <div className="w-52 space-y-2">
        <Label htmlFor={statusId}>Situação</Label>
        <Select
          id={statusId}
          value={filters.status}
          onChange={(event) =>
            navigate({ status: event.target.value as EvaluationParticipantFilter })
          }
        >
          {EVALUATION_PARTICIPANT_FILTERS.map((opcao) => (
            <option key={opcao} value={opcao}>
              {EVALUATION_PARTICIPANT_FILTER_LABELS[opcao]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
