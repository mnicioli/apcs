"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { EVENT_STATUS_FILTER_LABELS } from "@/modules/event/event.labels";
import {
  EVENT_STATUS_FILTERS,
  type EventFilters,
  type EventStatusFilter,
} from "@/modules/event/event.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const DEBOUNCE_MS = 300;

const PERIODO_INVERTIDO = "A data inicial não pode ser maior que a data final.";

/**
 * Filtros da grid de eventos.
 *
 * O estado mora na URL, e não no componente: a lista é renderizada no servidor,
 * então é a URL que precisa mudar para vir gente nova do banco. De quebra, uma
 * busca filtrada pode ser compartilhada por link e sobrevive ao F5.
 */
export function EventsFilters({ filters }: { filters: EventFilters }) {
  const router = useRouter();
  const pathname = usePathname();

  const [term, setTerm] = useState(filters.query);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);

  const searchId = useId();
  const statusId = useId();
  const fromId = useId();
  const toId = useId();

  const navigate = useCallback(
    (next: EventFilters) => {
      const params = new URLSearchParams();
      if (next.query.trim()) params.set("q", next.query.trim());
      if (next.status !== "all") params.set("status", next.status);
      if (next.from) params.set("from", next.from);
      if (next.to) params.set("to", next.to);

      const search = params.toString();
      // `replace` e não `push`: cada letra digitada não deve virar uma parada no
      // botão "voltar" do navegador.
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  // Período invertido não vai ao servidor: uma faixa impossível devolveria
  // "nenhum evento encontrado", e a pessoa procuraria o erro nos eventos em vez
  // de nas datas que digitou.
  const periodoInvalido = from !== "" && to !== "" && from > to;

  // Espera a pessoa parar de digitar antes de ir ao servidor. A comparação com
  // o valor que veio da URL evita a ida inútil na primeira renderização.
  useEffect(() => {
    if (term === filters.query) return;
    if (periodoInvalido) return;

    const timer = setTimeout(
      () => navigate({ query: term, status: filters.status, from, to }),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [term, from, to, filters.query, filters.status, periodoInvalido, navigate]);

  function applyDates(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    if (nextFrom !== "" && nextTo !== "" && nextFrom > nextTo) return;
    navigate({ query: term, status: filters.status, from: nextFrom, to: nextTo });
  }

  const isFiltered =
    filters.query.trim() !== "" ||
    filters.status !== "all" ||
    filters.from !== "" ||
    filters.to !== "";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-2">
          <Label htmlFor={searchId}>Nome</Label>
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
              placeholder="Buscar por nome"
              className="pl-9"
            />
          </div>
        </div>

        <div className="w-40 space-y-2">
          <Label htmlFor={statusId}>Status</Label>
          <Select
            id={statusId}
            value={filters.status}
            onChange={(event) =>
              navigate({
                query: term,
                status: event.target.value as EventStatusFilter,
                from,
                to,
              })
            }
          >
            {EVENT_STATUS_FILTERS.map((option) => (
              <option key={option} value={option}>
                {EVENT_STATUS_FILTER_LABELS[option]}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-44 space-y-2">
          <Label htmlFor={fromId}>Data inicial</Label>
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
          <Label htmlFor={toId}>Data final</Label>
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
              navigate({ query: "", status: "all", from: "", to: "" });
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
