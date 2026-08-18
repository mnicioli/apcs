"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Info, Search } from "lucide-react";
import { CONTACT_PROFILE_LABELS } from "@/modules/chat/chat.labels";
import {
  SURVEY_AUDIENCE_DIMENSION_LABELS,
  SURVEY_STATUS_LABELS,
} from "@/modules/survey/survey.labels";
import { surveyFiltersToParams } from "@/modules/survey/survey.routes";
import { SURVEY_STATUSES, type SurveyFilters } from "@/modules/survey/survey.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const DEBOUNCE_MS = 300;

const PERIODO_INVERTIDO = "A data inicial não pode ser maior que a data final.";

/**
 * A barra de filtros — a MESMA na grid e na tela de Resultados (§4, §5, §59).
 *
 * Um componente só, e não dois parecidos, porque o §59 quer o mesmo recorte nas
 * duas telas. Com duas implementações, o dia em que alguém acrescentasse um
 * filtro numa delas quebraria a promessa sem quebrar nada visível.
 *
 * O estado mora na URL: as listas são renderizadas no servidor, então é a URL
 * que precisa mudar para vir gente nova do banco.
 *
 * ⚠️ O §4 lista OITO filtros e aqui existem CINCO. Os três que faltam —
 * Segmento, Categoria e Carteira — dependem do cadastro de associados, que este
 * sistema não tem (GAP 1, docs/ENQUETES.md). Nenhuma enquete pode ter esses
 * critérios, porque o banco os recusa na escrita; um filtro para eles só saberia
 * devolver zero resultados, e mandaria a pessoa procurar defeito nas enquetes em
 * vez de no cadastro que falta. Em vez do controle morto, a nota explicativa.
 */
export function SurveyFiltersBar({
  filters,
  regions,
}: {
  filters: SurveyFilters;
  /** As UFs que existem de fato no público — nada de uma lista fixa de 27. */
  regions: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [term, setTerm] = useState(filters.query ?? "");
  const [from, setFrom] = useState(toInputValue(filters.from));
  const [to, setTo] = useState(toInputValue(filters.to));

  const searchId = useId();
  const statusId = useId();
  const regionId = useId();
  const profileId = useId();
  const fromId = useId();
  const toId = useId();
  const gapId = useId();

  const navigate = useCallback(
    (next: SurveyFilters) => {
      const params = surveyFiltersToParams(next);
      const search = params.toString();
      // `replace` e não `push`: cada letra digitada não deve virar uma parada no
      // botão "voltar" do navegador.
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  // Período invertido não vai ao servidor: uma faixa impossível devolveria
  // "nenhuma enquete encontrada", e a pessoa procuraria o erro nas enquetes em
  // vez de nas datas que digitou.
  const periodoInvalido = from !== "" && to !== "" && from > to;

  // Espera a pessoa parar de digitar antes de ir ao servidor (§5). A comparação
  // com o valor que veio da URL evita a ida inútil na primeira renderização.
  useEffect(() => {
    if (term === (filters.query ?? "")) return;
    if (periodoInvalido) return;

    const timer = setTimeout(() => navigate({ ...filters, query: term || undefined }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, filters, periodoInvalido, navigate]);

  function applyDates(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    if (nextFrom !== "" && nextTo !== "" && nextFrom > nextTo) return;
    navigate({
      ...filters,
      query: term || undefined,
      from: fromInputValue(nextFrom),
      to: fromInputValue(nextTo, true),
    });
  }

  const filtrado =
    Boolean(filters.query?.trim()) ||
    Boolean(filters.status) ||
    Boolean(filters.from) ||
    Boolean(filters.to) ||
    Boolean(filters.region) ||
    Boolean(filters.profile);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-1 xl:col-span-2">
          <Label htmlFor={searchId}>Buscar enquete</Label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              id={searchId}
              type="search"
              value={term}
              placeholder="Título ou pergunta"
              className="pl-9"
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={statusId}>Situação</Label>
          <Select
            id={statusId}
            value={filters.status ?? ""}
            onChange={(event) =>
              navigate({
                ...filters,
                query: term || undefined,
                status: (SURVEY_STATUSES as readonly string[]).includes(event.target.value)
                  ? (event.target.value as SurveyFilters["status"])
                  : undefined,
              })
            }
          >
            <option value="">Todas</option>
            {SURVEY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {SURVEY_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={regionId}>{SURVEY_AUDIENCE_DIMENSION_LABELS.region}</Label>
          <Select
            id={regionId}
            value={filters.region ?? ""}
            onChange={(event) =>
              navigate({
                ...filters,
                query: term || undefined,
                region: event.target.value || undefined,
              })
            }
          >
            <option value="">Todas</option>
            {regions.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={profileId}>{SURVEY_AUDIENCE_DIMENSION_LABELS.profile}</Label>
          <Select
            id={profileId}
            value={filters.profile ?? ""}
            onChange={(event) =>
              navigate({
                ...filters,
                query: term || undefined,
                profile: event.target.value || undefined,
              })
            }
          >
            <option value="">Todos</option>
            {Object.entries(CONTACT_PROFILE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:col-span-1">
          <div className="space-y-1.5">
            <Label htmlFor={fromId}>Criada de</Label>
            <Input
              id={fromId}
              type="date"
              value={from}
              aria-invalid={periodoInvalido}
              aria-describedby={periodoInvalido ? `${fromId}-erro` : undefined}
              onChange={(event) => applyDates(event.target.value, to)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={toId}>até</Label>
            <Input
              id={toId}
              type="date"
              value={to}
              aria-invalid={periodoInvalido}
              onChange={(event) => applyDates(from, event.target.value)}
            />
          </div>
        </div>
      </div>

      {periodoInvalido && (
        <p id={`${fromId}-erro`} role="alert" className="text-destructive text-sm">
          {PERIODO_INVERTIDO}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id={gapId} className="text-muted-foreground flex items-start gap-1.5 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Segmento, Categoria e Carteira dependem do cadastro de associados, que ainda não existe
            no sistema — por isso não aparecem aqui.
          </span>
        </p>

        {filtrado && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTerm("");
              setFrom("");
              setTo("");
              navigate({});
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * O filtro guarda um INSTANTE (a coluna é `timestamptz`), mas o campo é um
 * `<input type="date">`, que fala AAAA-MM-DD. Estas duas funções são a ponte.
 *
 * O `to` vira o FIM do dia escolhido: quem filtra "até 20/08" quer o dia 20
 * inteiro, e um corte à meia-noite esconderia tudo que aconteceu naquele dia.
 */
function toInputValue(instant: string | undefined): string {
  return instant ? instant.slice(0, 10) : "";
}

function fromInputValue(date: string, endOfDay = false): string | undefined {
  if (!date) return undefined;
  return endOfDay ? `${date}T23:59:59.999Z` : `${date}T00:00:00.000Z`;
}
