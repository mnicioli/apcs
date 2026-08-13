"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  MARKET_CHATBOT_FILTER_LABELS,
  MARKET_STATUS_FILTER_LABELS,
} from "@/modules/market/market.labels";
import {
  MARKET_CHATBOT_FILTERS,
  MARKET_STATUS_FILTERS,
  type MarketChatbotFilter,
  type MarketFilters,
  type MarketStatusFilter,
} from "@/modules/market/market.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const DEBOUNCE_MS = 300;

const PERIODO_INVERTIDO = "A data inicial não pode ser maior que a data final.";

/**
 * Filtros da grid da Bolsa.
 *
 * O estado mora na URL, e não no componente: a lista é renderizada no servidor,
 * então é a URL que precisa mudar para vir gente nova do banco. De quebra, uma
 * busca filtrada pode ser compartilhada por link e sobrevive ao F5.
 */
export function MarketFiltersBar({ filters }: { filters: MarketFilters }) {
  const router = useRouter();
  const pathname = usePathname();

  const [term, setTerm] = useState(filters.query);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);

  const searchId = useId();
  const statusId = useId();
  const chatbotId = useId();
  const fromId = useId();
  const toId = useId();

  const navigate = useCallback(
    (next: MarketFilters) => {
      const params = new URLSearchParams();
      if (next.query.trim()) params.set("q", next.query.trim());
      if (next.status !== "all") params.set("status", next.status);
      if (next.chatbot !== "all") params.set("chatbot", next.chatbot);
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
  // "nenhuma Bolsa encontrada", e a pessoa procuraria o erro nas bolsas em vez
  // de nas datas que digitou.
  const periodoInvalido = from !== "" && to !== "" && from > to;

  // Espera a pessoa parar de digitar antes de ir ao servidor. A comparação com
  // o valor que veio da URL evita a ida inútil na primeira renderização.
  useEffect(() => {
    if (term === filters.query) return;
    if (periodoInvalido) return;

    const timer = setTimeout(
      () =>
        navigate({
          query: term,
          status: filters.status,
          chatbot: filters.chatbot,
          from,
          to,
        }),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [term, from, to, filters.query, filters.status, filters.chatbot, periodoInvalido, navigate]);

  function applyDates(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    if (nextFrom !== "" && nextTo !== "" && nextFrom > nextTo) return;
    navigate({
      query: term,
      status: filters.status,
      chatbot: filters.chatbot,
      from: nextFrom,
      to: nextTo,
    });
  }

  const isFiltered =
    filters.query.trim() !== "" ||
    filters.status !== "all" ||
    filters.chatbot !== "all" ||
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
              placeholder="Buscar por nome da Bolsa"
              className="pl-9"
            />
          </div>
        </div>

        <div className="w-44 space-y-2">
          <Label htmlFor={statusId}>Publicação</Label>
          <Select
            id={statusId}
            value={filters.status}
            onChange={(event) =>
              navigate({
                query: term,
                status: event.target.value as MarketStatusFilter,
                chatbot: filters.chatbot,
                from,
                to,
              })
            }
          >
            {MARKET_STATUS_FILTERS.map((option) => (
              <option key={option} value={option}>
                {MARKET_STATUS_FILTER_LABELS[option]}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-44 space-y-2">
          <Label htmlFor={chatbotId}>Chatbot</Label>
          <Select
            id={chatbotId}
            value={filters.chatbot}
            onChange={(event) =>
              navigate({
                query: term,
                status: filters.status,
                chatbot: event.target.value as MarketChatbotFilter,
                from,
                to,
              })
            }
          >
            {MARKET_CHATBOT_FILTERS.map((option) => (
              <option key={option} value={option}>
                {MARKET_CHATBOT_FILTER_LABELS[option]}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-44 space-y-2">
          <Label htmlFor={fromId}>Vigência de</Label>
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
          <Label htmlFor={toId}>Vigência até</Label>
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
              navigate({ query: "", status: "all", chatbot: "all", from: "", to: "" });
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
