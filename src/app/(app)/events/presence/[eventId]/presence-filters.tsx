"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  PARTICIPANT_CONFIRMATION_LABELS,
  PRESENCE_FILTER_LABELS,
} from "@/modules/event/event.landing.labels";
import {
  CONFIRMATION_FILTERS,
  PRESENCE_FILTERS,
  REGISTRATION_SORTS,
  type ConfirmationFilter,
  type PresenceFilter,
  type RegistrationBoardFilters,
  type RegistrationSort,
} from "@/modules/event/event.landing.types";
import { eventPresenceHref } from "@/modules/event/event.registrations.routes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

/**
 * Filtros da Lista de Presença (§14, §15).
 *
 * ⚠️ O ESTADO MORA NA URL. A lista é renderizada no servidor: é a URL que
 * precisa mudar para vir gente nova do banco. Filtrar no navegador exigiria
 * baixar TODOS os participantes do evento — nome, e-mail e telefone de centenas
 * de terceiros — para depois esconder a maioria.
 *
 * ⚠️ QUALQUER MUDANÇA VOLTA PARA A PÁGINA 1. Sem isso, filtrar "Ausentes"
 * estando na página 4 daria "nenhum participante encontrado" sobre um resultado
 * que tem duas páginas — e a conclusão seria que todo mundo já chegou.
 *
 * ⚠️ PRESENÇA VEM PRIMEIRO, E É O FILTRO PRINCIPAL DESTA TELA (§15). A
 * confirmação está ao lado porque o §15 a permite como combinação — e ela é
 * útil de verdade aqui: "quem confirmou e ainda não chegou" é a pergunta da
 * meia hora antes de começar.
 *
 * ⚠️ NÃO HÁ FILTRO DE PERÍODO. Ele existe na grid de Inscrições e responde
 * "quem se inscreveu naquela semana da divulgação" — uma pergunta de quem
 * analisa a captação. Na porta do evento ninguém a faz, e cada controle a mais
 * é uma escolha a mais para quem está com uma fila na frente.
 */
const DEBOUNCE_MS = 300;

const CONFIRMATION_LABELS: Record<ConfirmationFilter, string> = {
  all: "Todos",
  ...PARTICIPANT_CONFIRMATION_LABELS,
};

const SORT_LABELS: Record<RegistrationSort, string> = {
  participant: "Participante (A–Z)",
  company: "Granja / Empresa",
  recent: "Inscrição mais recente",
};

export function PresenceFiltersBar({
  eventId,
  filters,
}: {
  eventId: string;
  filters: RegistrationBoardFilters;
}) {
  const router = useRouter();

  const [term, setTerm] = useState(filters.query);

  const searchId = useId();
  const presenceId = useId();
  const confirmationId = useId();
  const sortId = useId();

  const navigate = useCallback(
    (next: Partial<RegistrationBoardFilters>) => {
      router.replace(
        // `page: 1` sempre — ver o aviso do cabeçalho.
        eventPresenceHref(eventId, { ...filters, ...next, page: 1 }),
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

  const isFiltered =
    filters.query.trim() !== "" || filters.presence !== "all" || filters.confirmation !== "all";

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
            placeholder="Granja, participante, e-mail ou telefone"
            className="pl-9"
          />
        </div>
      </div>

      <div className="w-40 space-y-2">
        <Label htmlFor={presenceId}>Presença</Label>
        <Select
          id={presenceId}
          value={filters.presence}
          onChange={(event) => navigate({ presence: event.target.value as PresenceFilter })}
        >
          {PRESENCE_FILTERS.map((option) => (
            <option key={option} value={option}>
              {PRESENCE_FILTER_LABELS[option]}
            </option>
          ))}
        </Select>
      </div>

      <div className="w-44 space-y-2">
        <Label htmlFor={confirmationId}>Confirmação</Label>
        <Select
          id={confirmationId}
          value={filters.confirmation}
          onChange={(event) => navigate({ confirmation: event.target.value as ConfirmationFilter })}
        >
          {CONFIRMATION_FILTERS.map((option) => (
            <option key={option} value={option}>
              {CONFIRMATION_LABELS[option]}
            </option>
          ))}
        </Select>
      </div>

      <div className="w-52 space-y-2">
        <Label htmlFor={sortId}>Ordenar por</Label>
        <Select
          id={sortId}
          value={filters.sort}
          onChange={(event) => navigate({ sort: event.target.value as RegistrationSort })}
        >
          {REGISTRATION_SORTS.map((option) => (
            <option key={option} value={option}>
              {SORT_LABELS[option]}
            </option>
          ))}
        </Select>
      </div>

      {isFiltered && (
        <Button
          variant="ghost"
          onClick={() => {
            setTerm("");
            navigate({ query: "", presence: "all", confirmation: "all" });
          }}
        >
          Limpar filtros
        </Button>
      )}
    </div>
  );
}
