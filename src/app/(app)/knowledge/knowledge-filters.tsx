"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { KNOWLEDGE_STATUS_FILTER_LABELS } from "@/modules/intelligence/knowledge.labels";
import {
  KNOWLEDGE_STATUS_FILTERS,
  type KnowledgeCategory,
  type KnowledgeStatusFilter,
} from "@/modules/intelligence/knowledge.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const DEBOUNCE_MS = 300;

/**
 * Filtros da grid.
 *
 * O estado mora na URL, e não no componente: a lista é renderizada no servidor,
 * então é a URL que precisa mudar para vir gente nova do banco. De quebra, uma
 * busca filtrada pode ser compartilhada por link e sobrevive ao F5.
 */
export function KnowledgeFiltersBar({
  query,
  status,
  categoryId,
  categories,
}: {
  query: string;
  status: KnowledgeStatusFilter;
  categoryId: string;
  categories: readonly KnowledgeCategory[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [term, setTerm] = useState(query);

  const navigate = useCallback(
    (nextTerm: string, nextStatus: KnowledgeStatusFilter, nextCategory: string) => {
      const params = new URLSearchParams();
      if (nextTerm.trim()) params.set("q", nextTerm.trim());
      if (nextStatus !== "all") params.set("status", nextStatus);
      if (nextCategory) params.set("categoria", nextCategory);

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

    const timer = setTimeout(() => navigate(term, status, categoryId), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, query, status, categoryId, navigate]);

  /**
   * ⚠️ A CATEGORIA DA URL APARECE MESMO SE ESTIVER DESATIVADA. Sem esta opção
   * extra, um link antigo (ou uma categoria que alguém acabou de tirar de
   * circulação) deixaria o seletor mostrando "Todas" enquanto a grid continua
   * filtrada — a tela mentindo sobre o próprio estado.
   */
  const catalogo = categories.filter((c) => c.active || c.id === categoryId);
  const isFiltered = query.trim() !== "" || status !== "all" || categoryId !== "";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1 space-y-2">
        <Label htmlFor="knowledge-search">Buscar</Label>
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            id="knowledge-search"
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Título, resposta ou palavra-chave"
            className="pl-9"
          />
        </div>
      </div>

      <div className="w-52 space-y-2">
        <Label htmlFor="knowledge-category">Categoria</Label>
        <Select
          id="knowledge-category"
          value={categoryId}
          onChange={(event) => navigate(term, status, event.target.value)}
        >
          <option value="">Todas as categorias</option>
          {catalogo.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="w-40 space-y-2">
        <Label htmlFor="knowledge-status">Status</Label>
        <Select
          id="knowledge-status"
          value={status}
          onChange={(event) =>
            navigate(term, event.target.value as KnowledgeStatusFilter, categoryId)
          }
        >
          {KNOWLEDGE_STATUS_FILTERS.map((option) => (
            <option key={option} value={option}>
              {KNOWLEDGE_STATUS_FILTER_LABELS[option]}
            </option>
          ))}
        </Select>
      </div>

      {isFiltered && (
        <Button
          variant="ghost"
          onClick={() => {
            setTerm("");
            navigate("", "all", "");
          }}
        >
          Limpar filtros
        </Button>
      )}
    </div>
  );
}
