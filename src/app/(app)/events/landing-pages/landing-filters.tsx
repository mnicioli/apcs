"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { LANDING_PAGE_STATUS_LABELS } from "@/modules/event/event.landing.labels";
import {
  LANDING_STATUS_FILTERS,
  type LandingPageFilters,
  type LandingStatusFilter,
} from "@/modules/event/event.landing.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * Filtros da grid de Landing Pages (§4).
 *
 * ⚠️ CÓPIA DELIBERADA DA FORMA DE `EventsFilters`, e não do código. As duas
 * telas têm a mesma estrutura (busca com atraso, situação, período, limpar) e
 * campos diferentes — o de lá filtra por nome do evento; o daqui procura também
 * no endereço público. Um componente genérico com quatro props de configuração
 * seria mais código para ler e menos liberdade para as duas divergirem.
 *
 * O estado mora na URL, e não no componente: a lista é renderizada no servidor,
 * então é a URL que precisa mudar para vir gente nova do banco. De quebra, uma
 * busca filtrada pode ser compartilhada por link e sobrevive ao F5.
 */
const DEBOUNCE_MS = 300;

const PERIODO_INVERTIDO = "A data inicial não pode ser maior que a data final.";

/** Rótulo de cada opção do seletor. "Todas" porque o substantivo é feminino. */
const STATUS_FILTER_LABELS: Record<LandingStatusFilter, string> = {
  all: "Todas",
  ...LANDING_PAGE_STATUS_LABELS,
};

export function LandingFilters({ filters }: { filters: LandingPageFilters }) {
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
    (next: LandingPageFilters) => {
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
  // "nenhuma página encontrada", e a pessoa procuraria o erro nas páginas em
  // vez de nas datas que digitou.
  const periodoInvalido = from !== "" && to !== "" && from > to;

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
          <Label htmlFor={searchId}>Evento ou endereço</Label>
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
              placeholder="Buscar por nome do evento ou endereço"
              className="pl-9"
            />
          </div>
        </div>

        <div className="w-40 space-y-2">
          <Label htmlFor={statusId}>Situação</Label>
          <Select
            id={statusId}
            value={filters.status}
            onChange={(event) =>
              navigate({
                query: term,
                status: event.target.value as LandingStatusFilter,
                from,
                to,
              })
            }
          >
            {LANDING_STATUS_FILTERS.map((option) => (
              <option key={option} value={option}>
                {STATUS_FILTER_LABELS[option]}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-44 space-y-2">
          <Label htmlFor={fromId}>Evento a partir de</Label>
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
          <Label htmlFor={toId}>Evento até</Label>
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
