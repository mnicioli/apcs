"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import type { SurveyParticipant } from "@/modules/survey/survey.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEBOUNCE_MS = 300;

/**
 * A LISTA DE PARTICIPANTES (§47, §50).
 *
 * ⚠️ Só existe quando a enquete NÃO é anônima — e quem decide isso é o banco.
 * `survey_participants_page` recusa a consulta para enquete anônima (SV008), o
 * service devolve `null`, e a página nem renderiza este componente. Não há um
 * `if (isAnonymous)` aqui dentro que alguém possa remover por engano.
 *
 * A paginação e o filtro moram na URL, como no resto do módulo: a busca é feita
 * no SERVIDOR (§50), então trocar de página ou filtrar é navegar.
 */
export function SurveyParticipantsTable({
  participants,
  total,
  page,
  pageSize,
  query,
}: {
  participants: SurveyParticipant[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState(query);
  const [isPending, startTransition] = useTransition();
  const searchId = useId();

  const paginas = Math.max(1, Math.ceil(total / pageSize));

  function navegar(next: { q?: string; page?: number }) {
    const params = new URLSearchParams(searchParams.toString());

    if (next.q !== undefined) {
      if (next.q.trim()) params.set("q", next.q.trim());
      else params.delete("q");
      // Filtrar volta para a primeira página: manter a página 3 de um filtro
      // novo mostraria um pedaço arbitrário do meio.
      params.delete("p");
    }

    if (next.page !== undefined) {
      if (next.page > 1) params.set("p", String(next.page));
      else params.delete("p");
    }

    const search = params.toString();
    startTransition(() => {
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    });
  }

  // Espera a pessoa parar de digitar antes de ir ao servidor.
  useEffect(() => {
    if (term === query) return;
    const timer = setTimeout(() => navegar({ q: term }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `navegar` depende de searchParams, que muda a cada navegação; incluí-la
    // reiniciaria o cronômetro sem parar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, query]);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full max-w-xs space-y-1.5">
            <Label htmlFor={searchId}>Buscar participante</Label>
            <div className="relative">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                id={searchId}
                type="search"
                value={term}
                placeholder="Nome do associado"
                className="pl-9"
                onChange={(event) => setTerm(event.target.value)}
              />
            </div>
          </div>

          <p className="text-muted-foreground text-sm" aria-live="polite">
            {total === 0
              ? "Nenhum participante"
              : `${total} ${total === 1 ? "participante" : "participantes"}`}
          </p>
        </div>

        {participants.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {query
              ? "Nenhum participante encontrado para esta busca."
              : "Esta enquete ainda não possui respostas."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Participantes da enquete, com a alternativa escolhida e o momento da resposta
              </caption>
              <thead className="text-muted-foreground border-border border-b text-left">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Associado
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Resposta
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                    Data e hora
                  </th>
                </tr>
              </thead>
              <tbody className={isPending ? "opacity-60 transition-opacity" : undefined}>
                {participants.map((participant) => (
                  <tr
                    key={`${participant.contactId}-${participant.answeredAt}`}
                    className="border-border border-b align-middle last:border-0"
                  >
                    <td className="max-w-56 truncate px-3 py-2">
                      {participant.contactName ?? "Contato sem nome"}
                    </td>
                    <td className="px-3 py-2">{participant.optionText}</td>
                    <td className="text-muted-foreground px-3 py-2 text-xs whitespace-nowrap">
                      {formatDateTime(participant.answeredAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {paginas > 1 && (
          <nav
            className="flex items-center justify-between gap-3"
            aria-label="Paginação dos participantes"
          >
            <p className="text-muted-foreground text-sm">
              Página {page} de {paginas}
            </p>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1 || isPending}
                aria-label="Página anterior"
                onClick={() => navegar({ page: page - 1 })}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= paginas || isPending}
                aria-label="Próxima página"
                onClick={() => navegar({ page: page + 1 })}
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </nav>
        )}
      </CardContent>
    </Card>
  );
}
