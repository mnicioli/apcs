"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { DOCUMENT_STATUS_FILTER_LABELS } from "@/modules/document/document.labels";
import {
  DOCUMENT_STATUS_FILTERS,
  type DocumentStatusFilter,
} from "@/modules/document/document.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const DEBOUNCE_MS = 300;

/**
 * Filtros da grid de normativas.
 *
 * O estado mora na URL, e não no componente: a lista é renderizada no servidor,
 * então é a URL que precisa mudar para vir gente nova do banco. De quebra, uma
 * busca filtrada pode ser compartilhada por link e sobrevive ao F5.
 */
export function DocumentsFilters({
  query,
  status,
}: {
  query: string;
  status: DocumentStatusFilter;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [term, setTerm] = useState(query);

  const navigate = useCallback(
    (nextTerm: string, nextStatus: DocumentStatusFilter) => {
      const params = new URLSearchParams();
      if (nextTerm.trim()) params.set("q", nextTerm.trim());
      if (nextStatus !== "all") params.set("status", nextStatus);

      const search = params.toString();
      // `replace` e não `push`: cada letra digitada não deve virar uma parada no
      // botão "voltar" do navegador.
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  // Espera a pessoa parar de digitar antes de ir ao servidor. A comparação com
  // `query` evita a ida inútil na primeira renderização — ali os dois já são
  // iguais, porque o valor inicial veio da própria URL.
  useEffect(() => {
    if (term === query) return;

    const timer = setTimeout(() => navigate(term, status), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, query, status, navigate]);

  const isFiltered = query.trim() !== "" || status !== "all";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1 space-y-2">
        <Label htmlFor="document-search">Nome</Label>
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            id="document-search"
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Buscar por nome da normativa"
            className="pl-9"
          />
        </div>
      </div>

      <div className="w-40 space-y-2">
        <Label htmlFor="document-status">Status</Label>
        <Select
          id="document-status"
          value={status}
          onChange={(event) => navigate(term, event.target.value as DocumentStatusFilter)}
        >
          {DOCUMENT_STATUS_FILTERS.map((option) => (
            <option key={option} value={option}>
              {DOCUMENT_STATUS_FILTER_LABELS[option]}
            </option>
          ))}
        </Select>
      </div>

      {isFiltered && (
        <Button
          variant="ghost"
          onClick={() => {
            setTerm("");
            navigate("", "all");
          }}
        >
          Limpar filtros
        </Button>
      )}
    </div>
  );
}
