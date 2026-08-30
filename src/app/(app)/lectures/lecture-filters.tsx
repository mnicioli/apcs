"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { DirectoryEntry } from "@/lib/services/profile";
import {
  LECTURE_FORMAT_LABELS,
  LECTURE_ORIGIN_SHORT_LABELS,
  LECTURE_PRIORITY_LABELS,
  LECTURE_STATUS_LABELS,
  LECTURE_TYPE_LABELS,
} from "@/modules/lecture/lecture.labels";
import { lectureFiltersToParams } from "@/modules/lecture/lecture.routes";
import {
  LECTURE_FORMATS,
  LECTURE_ORIGINS,
  LECTURE_PRIORITIES,
  LECTURE_STATUSES,
  LECTURE_TYPES,
  type LectureFilters,
  type LectureSpeaker,
  type LectureStatus,
} from "@/modules/lecture/lecture.types";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const DEBOUNCE_MS = 300;

const PERIODO_INVERTIDO = "A data inicial não pode ser maior que a data final.";

/**
 * A barra de filtros — a MESMA na grid e no calendário (§11, §19, §48).
 *
 * Um componente só, e não dois parecidos, porque o §48 exige que os filtros
 * sobrevivam à troca de tela. Com duas implementações, o dia em que alguém
 * acrescentasse um filtro numa delas quebraria a promessa sem quebrar nada
 * visível — o pior tipo de defeito.
 *
 * O estado mora na URL: as listas são renderizadas no servidor, então é a URL
 * que precisa mudar para vir gente nova do banco. `preserve` carrega os
 * parâmetros que não são filtro (a visão e a data do calendário), para mexer num
 * filtro não jogar a pessoa de volta para o mês atual.
 */
export function LectureFiltersBar({
  filters,
  directory,
  speakers = [],
  cities = [],
  preserve = {},
  showPriority = true,
  showPeriod = true,
}: {
  filters: LectureFilters;
  /** O time interno, para os seletores de responsável e palestrante. */
  directory: DirectoryEntry[];
  /**
   * Os palestrantes DE FORA já cadastrados (§20).
   *
   * ⚠️ Sem eles, o filtro de palestrante só oferecia gente com login — e como a
   * maioria das palestras da APCS é apresentada por quem não tem conta, "filtrar
   * por palestrante" era uma pergunta que a tela não sabia responder sobre quase
   * ninguém.
   */
  speakers?: LectureSpeaker[];
  /**
   * As cidades que já têm palestra.
   *
   * ⚠️ Substituiu um campo de TEXTO LIVRE, e a troca conserta um filtro que
   * errava calado: digitar "espirito santo do pinhal" não encontrava as
   * palestras gravadas como "Espírito Santo do Pinhal", e a tela respondia
   * "nenhuma palestra" com a mesma cara de quando realmente não há nenhuma.
   * Escolher de uma lista não tem como errar a grafia.
   */
  cities?: string[];
  /** Parâmetros que não são filtro e precisam sobreviver (`view`, `date`). */
  preserve?: Record<string, string>;
  /** O calendário não filtra por prioridade — o escopo não a lista no §11. */
  showPriority?: boolean;
  /** O calendário já tem período: quem escolhe é a navegação, não um campo. */
  showPeriod?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [term, setTerm] = useState(filters.query);
  const [city, setCity] = useState(filters.city);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);

  const searchId = useId();
  const statusId = useId();
  const originId = useId();
  const typeId = useId();
  const formatId = useId();
  const priorityId = useId();
  const cityId = useId();
  const responsibleId = useId();
  const speakerId = useId();
  const fromId = useId();
  const toId = useId();

  // ⚠️ `preserve` é um literal criado a cada renderização da página, então
  // depender do OBJETO faria `navigate` mudar de identidade a todo render — e o
  // efeito do debounce, que depende dela, reiniciaria o cronômetro sem parar.
  // Serializar dá uma dependência estável com o mesmo significado.
  const preserveKey = new URLSearchParams(preserve).toString();

  const navigate = useCallback(
    (next: LectureFilters) => {
      const params = lectureFiltersToParams(next);
      for (const [key, value] of new URLSearchParams(preserveKey)) {
        if (value) params.set(key, value);
      }

      const search = params.toString();
      // `replace` e não `push`: cada letra digitada não deve virar uma parada no
      // botão "voltar" do navegador.
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [pathname, router, preserveKey],
  );

  // Período invertido não vai ao servidor: uma faixa impossível devolveria
  // "nenhuma palestra encontrada", e a pessoa procuraria o erro nas palestras em
  // vez de nas datas que digitou.
  const periodoInvalido = from !== "" && to !== "" && from > to;

  // Espera a pessoa parar de digitar antes de ir ao servidor. A comparação com o
  // valor que veio da URL evita a ida inútil na primeira renderização.
  useEffect(() => {
    if (term === filters.query && city === filters.city) return;
    if (periodoInvalido) return;

    const timer = setTimeout(
      () => navigate({ ...filters, query: term, city, from, to }),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [term, city, from, to, filters, periodoInvalido, navigate]);

  function applyDates(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    if (nextFrom !== "" && nextTo !== "" && nextFrom > nextTo) return;
    navigate({ ...filters, query: term, city, from: nextFrom, to: nextTo });
  }

  /** Um select de valor único: opção vazia = sem filtro. */
  function pick<T extends string>(
    campo: keyof LectureFilters,
    valor: string,
    opcoes: readonly T[],
  ) {
    const escolhido = (opcoes as readonly string[]).includes(valor) ? (valor as T) : null;
    navigate({ ...filters, query: term, city, from, to, [campo]: escolhido });
  }

  const filtrado =
    filters.query.trim() !== "" ||
    filters.status.length > 0 ||
    filters.origin !== null ||
    filters.type !== null ||
    filters.format !== null ||
    filters.priority !== null ||
    filters.city.trim() !== "" ||
    filters.responsibleId !== null ||
    filters.speakerId !== null ||
    filters.from !== "" ||
    filters.to !== "";

  return (
    <div className="space-y-3">
      {/* ⚠️ GRADE, E NÃO `flex flex-wrap`. Com onze campos de larguras fixas, o
          `flex-wrap` quebrava as linhas onde desse — sobrava um buraco no fim de
          uma, um campo solitário na outra, e os rótulos não se alinhavam entre
          as linhas. A grade dá colunas de verdade: os campos alinham na
          vertical, e a linha só muda quando a tela muda. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={searchId} className="flex items-center gap-1.5">
            Buscar
            {/* §71: o protocolo acha a palestra esteja ela em que página
                estiver, porque a busca é do servidor e não da página carregada.
                A frase era um parágrafo fixo embaixo do campo — e, como a linha
                alinhava pela base, ela desalinhava a linha inteira. */}
            <InfoTip text="A busca ignora acentos e vale sobre todas as palestras, não só as desta página." />
          </Label>
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
              placeholder="Nome, protocolo, tema, cidade ou solicitante"
              className="pl-9"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={statusId}>Situação</Label>
          <Select
            id={statusId}
            value={filters.status[0] ?? ""}
            onChange={(event) => {
              const valor = event.target.value;
              const status = (LECTURE_STATUSES as readonly string[]).includes(valor)
                ? [valor as LectureStatus]
                : [];
              navigate({ ...filters, query: term, city, from, to, status });
            }}
          >
            <option value="">Todas</option>
            {LECTURE_STATUSES.map((option) => (
              <option key={option} value={option}>
                {LECTURE_STATUS_LABELS[option]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={originId}>Origem</Label>
          <Select
            id={originId}
            value={filters.origin ?? ""}
            onChange={(event) => pick("origin", event.target.value, LECTURE_ORIGINS)}
          >
            <option value="">Todas</option>
            {LECTURE_ORIGINS.map((option) => (
              <option key={option} value={option}>
                {LECTURE_ORIGIN_SHORT_LABELS[option]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={typeId}>Tipo</Label>
          <Select
            id={typeId}
            value={filters.type ?? ""}
            onChange={(event) => pick("type", event.target.value, LECTURE_TYPES)}
          >
            <option value="">Todos</option>
            {LECTURE_TYPES.map((option) => (
              <option key={option} value={option}>
                {LECTURE_TYPE_LABELS[option]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={formatId}>Formato</Label>
          <Select
            id={formatId}
            value={filters.format ?? ""}
            onChange={(event) => pick("format", event.target.value, LECTURE_FORMATS)}
          >
            <option value="">Todos</option>
            {LECTURE_FORMATS.map((option) => (
              <option key={option} value={option}>
                {LECTURE_FORMAT_LABELS[option]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={cityId}>Cidade</Label>
          {/* ⚠️ NAVEGA NA HORA, sem o debounce que o campo de texto precisava.
              Escolher numa lista é um gesto único e deliberado — esperar 300 ms
              depois dele só faria a tela parecer travada. O debounce continua
              valendo para a busca, onde cada tecla é um evento. */}
          <Select
            id={cityId}
            value={city}
            onChange={(event) => {
              const escolhida = event.target.value;
              setCity(escolhida);
              navigate({ ...filters, query: term, city: escolhida, from, to });
            }}
          >
            <option value="">Todas as cidades</option>
            {cities.map((cidade) => (
              <option key={cidade} value={cidade}>
                {cidade}
              </option>
            ))}
            {/* A cidade que está na URL mas saiu do catálogo (desativada, ou um
                link antigo). Sem esta opção o seletor mostraria "Todas" enquanto
                a lista ainda estivesse filtrada — a tela mentindo sobre o próprio
                estado. */}
            {city !== "" && !cities.includes(city) && <option value={city}>{city}</option>}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={responsibleId}>Responsável</Label>
          <Select
            id={responsibleId}
            value={filters.responsibleId ?? ""}
            onChange={(event) =>
              navigate({
                ...filters,
                query: term,
                city,
                from,
                to,
                responsibleId: event.target.value || null,
              })
            }
          >
            <option value="">Todos</option>
            {directory.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName ?? person.email}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={speakerId}>Palestrante</Label>
          <Select
            id={speakerId}
            value={filters.speakerId ?? ""}
            onChange={(event) =>
              navigate({
                ...filters,
                query: term,
                city,
                from,
                to,
                speakerId: event.target.value || null,
              })
            }
          >
            <option value="">Todos</option>
            {/* ⚠️ A MESMA LISTA do cadastro e do diálogo de atribuição, e nesta
                ordem. Se o filtro oferecesse só o time, escolher "Dr. Marcelo"
                numa palestra e depois procurá-lo aqui não daria em nada — a
                pessoa concluiria que o filtro está quebrado, quando o que
                faltava era a opção.

                Os dois grupos existem porque um id de perfil e um id de catálogo
                não são a mesma coisa; para quem filtra, são só nomes. */}
            {speakers.length > 0 ? (
              <>
                <optgroup label="Palestrantes">
                  {speakers.map((speaker) => (
                    <option key={speaker.id} value={speaker.id}>
                      {speaker.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Time interno">
                  {directory.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName ?? person.email}
                    </option>
                  ))}
                </optgroup>
              </>
            ) : (
              directory.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName ?? person.email}
                </option>
              ))
            )}
          </Select>
        </div>

        {showPriority && (
          <div className="space-y-2">
            <Label htmlFor={priorityId}>Prioridade</Label>
            <Select
              id={priorityId}
              value={filters.priority ?? ""}
              onChange={(event) => pick("priority", event.target.value, LECTURE_PRIORITIES)}
            >
              <option value="">Todas</option>
              {LECTURE_PRIORITIES.map((option) => (
                <option key={option} value={option}>
                  {LECTURE_PRIORITY_LABELS[option]}
                </option>
              ))}
            </Select>
          </div>
        )}

        {showPeriod && (
          <>
            <div className="space-y-2">
              {/* §70: o rótulo diz QUAL data está sendo filtrada. "De/até"
                  sozinho deixaria a pessoa sem saber se é a data da palestra ou
                  a do pedido. */}
              <Label htmlFor={fromId}>Data da palestra de</Label>
              <Input
                id={fromId}
                type="date"
                value={from}
                aria-invalid={periodoInvalido}
                aria-describedby={periodoInvalido ? `${fromId}-erro` : undefined}
                onChange={(event) => applyDates(event.target.value, to)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={toId}>até</Label>
              <Input
                id={toId}
                type="date"
                value={to}
                aria-invalid={periodoInvalido}
                aria-describedby={periodoInvalido ? `${fromId}-erro` : undefined}
                onChange={(event) => applyDates(from, event.target.value)}
              />
            </div>
          </>
        )}
      </div>

      {/* FORA DA GRADE. Dentro dela, o botão ocupava uma célula e ganhava um
          rótulo invisível em cima para alinhar com os campos — ou ficava
          flutuando no meio da linha, dependendo de quantos filtros a tela
          mostrava. Ele não é um filtro; é o que desfaz todos. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {periodoInvalido ? (
          <p id={`${fromId}-erro`} role="alert" className="text-destructive text-sm">
            {PERIODO_INVERTIDO}
          </p>
        ) : (
          <span />
        )}

        {filtrado && (
          <Button
            variant="ghost"
            onClick={() => {
              setTerm("");
              setCity("");
              setFrom("");
              setTo("");
              navigate({
                query: "",
                status: [],
                origin: null,
                type: null,
                format: null,
                priority: null,
                city: "",
                responsibleId: null,
                speakerId: null,
                from: "",
                to: "",
              });
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>
    </div>
  );
}
