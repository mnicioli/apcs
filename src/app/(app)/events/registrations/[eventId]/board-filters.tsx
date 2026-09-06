"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { PARTICIPANT_CONFIRMATION_LABELS } from "@/modules/event/event.landing.labels";
import {
  CONFIRMATION_FILTERS,
  REGISTRATION_SORTS,
  type ConfirmationFilter,
  type RegistrationBoardFilters,
  type RegistrationSort,
} from "@/modules/event/event.landing.types";
import { eventRegistrationsHref } from "@/modules/event/event.registrations.routes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

/**
 * Filtros da grid de participantes (§7, §8, §21).
 *
 * ⚠️ O ESTADO MORA NA URL. A grid é renderizada no servidor: é a URL que precisa
 * mudar para vir gente nova do banco. De quebra, a EXPORTAÇÃO lê exatamente os
 * mesmos parâmetros (§19) — o botão de exportar é um link montado pela mesma
 * função que monta estes endereços.
 *
 * ⚠️ QUALQUER MUDANÇA VOLTA PARA A PÁGINA 1. Sem isso, filtrar "Confirmados"
 * estando na página 4 daria "nenhuma inscrição encontrada" sobre um resultado
 * que tem duas páginas — e a conclusão seria que ninguém confirmou.
 *
 * ⚠️ NÃO HÁ FILTRO DE GRANJA SEPARADO, e o §8 permite ("não criar filtros
 * desnecessários"). A caixa de busca já procura na granja; um segundo campo que
 * faz parte do que o primeiro faz é uma escolha a mais sem nada em troca.
 */
const DEBOUNCE_MS = 300;

const PERIODO_INVERTIDO = "A data inicial não pode ser maior que a data final.";

const CONFIRMATION_LABELS: Record<ConfirmationFilter, string> = {
  all: "Todos",
  ...PARTICIPANT_CONFIRMATION_LABELS,
};

const SORT_LABELS: Record<RegistrationSort, string> = {
  recent: "Mais recentes",
  company: "Granja / Empresa",
  participant: "Participante",
};

export function BoardFilters({
  eventId,
  filters,
}: {
  eventId: string;
  filters: RegistrationBoardFilters;
}) {
  const router = useRouter();

  const [term, setTerm] = useState(filters.query);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);

  const searchId = useId();
  const confirmationId = useId();
  const sortId = useId();
  const fromId = useId();
  const toId = useId();

  const navigate = useCallback(
    (next: Partial<RegistrationBoardFilters>) => {
      router.replace(
        // `page: 1` sempre — ver o aviso do cabeçalho.
        eventRegistrationsHref(eventId, { ...filters, ...next, page: 1 }),
        { scroll: false },
      );
    },
    [eventId, filters, router],
  );

  // Período invertido não vai ao servidor: uma faixa impossível devolveria
  // "nenhuma inscrição encontrada", e a pessoa procuraria o erro nos inscritos
  // em vez de nas datas que digitou.
  const periodoInvalido = from !== "" && to !== "" && from > to;

  useEffect(() => {
    if (term === filters.query) return;
    if (periodoInvalido) return;

    const timer = setTimeout(() => navigate({ query: term, from, to }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, from, to, filters.query, periodoInvalido, navigate]);

  function applyDates(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    if (nextFrom !== "" && nextTo !== "" && nextFrom > nextTo) return;
    navigate({ query: term, from: nextFrom, to: nextTo });
  }

  const isFiltered =
    filters.query.trim() !== "" ||
    filters.confirmation !== "all" ||
    filters.from !== "" ||
    filters.to !== "";

  return (
    <div className="space-y-2">
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

        <div className="w-44 space-y-2">
          <Label htmlFor={confirmationId}>Confirmação</Label>
          <Select
            id={confirmationId}
            value={filters.confirmation}
            onChange={(event) =>
              navigate({ confirmation: event.target.value as ConfirmationFilter })
            }
          >
            {CONFIRMATION_FILTERS.map((option) => (
              <option key={option} value={option}>
                {CONFIRMATION_LABELS[option]}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-44 space-y-2">
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

        {/* §8 — o período é o da INSCRIÇÃO, e não o do evento. A tela toda é de
            um evento só; a pergunta que sobra é "quem se inscreveu naquela
            semana da divulgação?". */}
        <div className="w-44 space-y-2">
          <Label htmlFor={fromId}>Inscrito a partir de</Label>
          <Input
            id={fromId}
            type="date"
            value={from}
            aria-invalid={periodoInvalido}
            aria-describedby={periodoInvalido ? `${fromId}-erro` : undefined}
            onChange={(event) => applyDates(event.target.value, to)}
          />
        </div>

        <div className="w-44 space-y-2">
          <Label htmlFor={toId}>Inscrito até</Label>
          <Input
            id={toId}
            type="date"
            value={to}
            aria-invalid={periodoInvalido}
            aria-describedby={periodoInvalido ? `${fromId}-erro` : undefined}
            onChange={(event) => applyDates(from, event.target.value)}
          />
        </div>

        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => {
              setTerm("");
              setFrom("");
              setTo("");
              navigate({ query: "", confirmation: "all", from: "", to: "" });
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {periodoInvalido && (
        <p id={`${fromId}-erro`} role="alert" className="text-destructive text-sm">
          {PERIODO_INVERTIDO}
        </p>
      )}
    </div>
  );
}
