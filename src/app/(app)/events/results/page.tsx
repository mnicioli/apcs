import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, MessageSquare, UserCheck } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  EVALUATION_EVENT_PAGE_SIZE,
  listEvaluationSummaries,
} from "@/lib/services/event-evaluation";
import { formatCalendarDate } from "@/lib/utils";
import type { EvaluationSummary } from "@/modules/event/event.evaluation.types";
import {
  RESULTS_MODULE_SUBTITLE,
  RESULTS_MODULE_TITLE,
} from "@/modules/event/event.results.labels";
import { formatPercent, responseRatePercent } from "@/modules/event/event.results.rules";
import { eventResultsHref, resultsHref } from "@/modules/event/event.results.routes";
import { formatTimeRange } from "@/modules/event/event.rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { EventSearchBox } from "../event-search-box";

export const metadata: Metadata = { title: "Resultados" };

/**
 * A TELA DE SELEÇÃO DE EVENTO (§3).
 *
 * ============================================================================
 * ⚠️ REUSA `listEvaluationSummaries` INTEIRA, COM DOIS CAMPOS A MAIS.
 * ============================================================================
 * O §3 pede nome, data, local e situação do evento, mais os números de presença
 * e resposta. A consulta de Avaliações já entregava tudo menos `location` e
 * `status` — e os dois são colunas de `public.events`, que já estava no `from`.
 *
 * Foram acrescentados ali em vez de ganhar função própria. Uma
 * `event_results_summaries` devolveria a MESMA lista com os mesmos contadores,
 * e a cópia é o que envelhece: no dia em que o recorte de "eventos que
 * interessam" mudasse, as duas telas passariam a mostrar conjuntos diferentes
 * do mesmo sistema.
 *
 * ⚠️ A TELA DE AVALIAÇÕES NÃO MUDOU. Ela simplesmente não lê os dois campos
 * novos.
 */
export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const role = await getCurrentUserRole();
  // Sem permissão de VISUALIZAÇÃO não se acessa a funcionalidade (§40). Mesmo
  // desvio das outras telas do módulo: `/dashboard`, e não uma tela de erro.
  if (!hasPermission(role, "results.read")) redirect("/dashboard");

  const { q, page } = await searchParams;
  const busca = q ?? "";
  const paginaAtual = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);

  const { rows, total } = await listEvaluationSummaries(busca, paginaAtual);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{RESULTS_MODULE_TITLE}</h1>
        <p className="text-muted-foreground text-sm">{RESULTS_MODULE_SUBTITLE}</p>
      </div>

      <EventSearchBox
        query={busca}
        basePath="/events/results"
        label="Evento"
        placeholder="Buscar por nome do evento"
      />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            {/* §38 — "vazio" e "vazio por causa da busca" são estados
                diferentes. O primeiro diz o que fazer; o segundo oferece o
                caminho de volta. */}
            <p className="text-muted-foreground text-sm">
              {busca.trim()
                ? "Nenhum evento encontrado para esta busca."
                : "Nenhum evento tem participantes ainda. Os resultados aparecem depois que alguém responde a avaliação."}
            </p>
            <Button asChild variant="outline">
              <Link href={busca.trim() ? resultsHref() : "/events/evaluations"}>
                {busca.trim() ? "Limpar busca" : "Ir para Avaliações"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Eventos com participantes, dos mais recentes para os mais antigos
                  </caption>
                  <thead className="text-muted-foreground border-border border-b text-left">
                    <tr>
                      {[
                        "Evento",
                        "Data",
                        "Local",
                        "Presentes",
                        "Enviadas",
                        "Respondidas",
                        "Taxa",
                        "Ações",
                      ].map((label) => (
                        <th
                          key={label}
                          scope="col"
                          className="px-4 py-3 font-medium whitespace-nowrap"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((linha) => (
                      <EventoDaLista key={linha.eventId} summary={linha} />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Pagination
            page={paginaAtual}
            pageSize={EVALUATION_EVENT_PAGE_SIZE}
            total={total}
            href={(alvo) => resultsHref(alvo, busca)}
            label="Paginação dos eventos"
            noun={["evento", "eventos"]}
          />
        </>
      )}
    </div>
  );
}

function EventoDaLista({ summary }: { summary: EvaluationSummary }) {
  const taxa = responseRatePercent(summary.sent, summary.answered);
  const destino = eventResultsHref(summary.eventId);
  const semResposta = summary.answered === 0;

  return (
    <tr className="border-border hover:bg-muted/50 border-b align-middle last:border-0">
      <td className="max-w-64 px-4 py-3">
        <Link href={destino} className="text-primary-strong block truncate hover:underline">
          {summary.eventName}
        </Link>
        {/* §38. O estado "sem resposta" aparece na própria lista, para ninguém
            abrir um painel zerado sem saber por quê. */}
        {semResposta && (
          <span className="text-muted-foreground block text-xs">Sem respostas ainda</span>
        )}
      </td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        {formatCalendarDate(summary.eventDate)}
        <span className="text-muted-foreground block text-xs">
          {formatTimeRange(summary.startTime, summary.endTime)}
        </span>
      </td>

      <td className="text-muted-foreground max-w-48 truncate px-4 py-3">{summary.location}</td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <UserCheck className="text-muted-foreground h-4 w-4" aria-hidden="true" />
          {summary.present}
        </span>
      </td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <MessageSquare className="text-muted-foreground h-4 w-4" aria-hidden="true" />
          {summary.sent}
        </span>
      </td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="text-primary-strong h-4 w-4" aria-hidden="true" />
          {summary.answered}
        </span>
      </td>

      <td className="px-4 py-3 tabular-nums">
        {/* §6. Zero enviadas dá 0%, e o selo apagado diz que não há o que medir
            — em vez de um "0%" que soaria como fracasso de adesão. */}
        <Badge variant={summary.sent === 0 ? "default" : taxa >= 50 ? "done" : "attention"}>
          {formatPercent(taxa)}%
        </Badge>
      </td>

      <td className="px-4 py-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={destino}>Abrir</Link>
        </Button>
      </td>
    </tr>
  );
}
