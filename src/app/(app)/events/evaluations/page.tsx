import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Send, UserCheck } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  EVALUATION_EVENT_PAGE_SIZE,
  listEvaluationSummaries,
} from "@/lib/services/event-evaluation";
import { formatCalendarDate, formatDateTime } from "@/lib/utils";
import {
  EVALUATION_MODULE_SUBTITLE,
  EVALUATION_MODULE_TITLE,
  EVALUATION_STAGE_LABELS,
  EVALUATION_STAGE_VARIANTS,
} from "@/modules/event/event.evaluation.labels";
import { evaluationStage, responseRate } from "@/modules/event/event.evaluation.rules";
import { evaluationsHref, eventEvaluationHref } from "@/modules/event/event.evaluation.routes";
import type { EvaluationSummary } from "@/modules/event/event.evaluation.types";
import { formatTimeRange } from "@/modules/event/event.rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { EventSearchBox } from "../event-search-box";

export const metadata: Metadata = { title: "Avaliações" };

/**
 * A TELA DE SELEÇÃO DE EVENTO (§21).
 *
 * ============================================================================
 * ⚠️ CONSULTA PRÓPRIA, E NÃO O REÚSO DE `listEventRegistrationSummaries`.
 * ============================================================================
 * A tela de seleção da Lista de Presença reusa aquela consulta inteira, e o
 * comentário de lá explica por quê: o §8 do Prompt 1 pedia exatamente as
 * colunas que ela já traz.
 *
 * Aqui o §21 pede outra coisa — avaliação configurada, avaliação habilitada,
 * presentes, enviadas, respondidas, taxa de resposta e situação. Nenhuma delas
 * existe naquela consulta, e acrescentá-las faria as DUAS outras telas que a
 * usam (Inscrições e Presença) pagarem por sete contagens que ignoram.
 *
 * ⚠️ O RECORTE TAMBÉM É OUTRO: "eventos com participante", e não "eventos com
 * página de inscrição". Um evento com página publicada e zero inscritos não tem
 * o que avaliar, e aparecer aqui só empurraria para baixo os que importam.
 */
export default async function EvaluationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const role = await getCurrentUserRole();
  // Sem permissão de VISUALIZAÇÃO não se acessa a funcionalidade. Mesmo desvio
  // das outras telas do módulo: `/dashboard`, e não uma tela de erro.
  if (!hasPermission(role, "evaluations.read")) redirect("/dashboard");

  const { q, page } = await searchParams;
  const busca = q ?? "";
  const paginaAtual = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);

  const { rows, total } = await listEvaluationSummaries(busca, paginaAtual);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{EVALUATION_MODULE_TITLE}</h1>
        <p className="text-muted-foreground text-sm">{EVALUATION_MODULE_SUBTITLE}</p>
      </div>

      <EventSearchBox
        query={busca}
        basePath="/events/evaluations"
        label="Evento"
        placeholder="Buscar por nome do evento"
      />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            {/* "Vazio" e "vazio por causa da busca" são estados diferentes. O
                primeiro diz o que fazer; o segundo oferece o caminho de volta.
                Trocá-los faz alguém concluir que o sistema perdeu os dados. */}
            <p className="text-muted-foreground text-sm">
              {busca.trim()
                ? "Nenhum evento encontrado para esta busca."
                : "Nenhum evento tem participantes ainda. A avaliação vai para quem esteve presente — sem inscrições não há quem avaliar."}
            </p>
            <Button asChild variant="outline">
              <Link href={busca.trim() ? evaluationsHref() : "/events/landing-pages"}>
                {busca.trim() ? "Limpar busca" : "Ir para Landing Pages"}
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
                        "Situação",
                        "Envio",
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
            href={(alvo) => evaluationsHref(alvo, busca)}
            label="Paginação dos eventos"
            noun={["evento", "eventos"]}
          />
        </>
      )}
    </div>
  );
}

function EventoDaLista({ summary }: { summary: EvaluationSummary }) {
  // A situação é DERIVADA, como em toda tela deste módulo. Ver
  // `evaluationStage`: ela é a leitura de quatro fatos, e gravá-la criaria uma
  // quinta cópia que sai de sincronia com os quatro.
  const etapa = evaluationStage(summary);
  const taxa = responseRate(summary.sent, summary.answered);
  const destino = eventEvaluationHref(summary.eventId);

  return (
    <tr className="border-border hover:bg-muted/50 border-b align-middle last:border-0">
      <td className="max-w-64 px-4 py-3">
        <Link href={destino} className="text-primary-strong block truncate hover:underline">
          {summary.eventName}
        </Link>
        {!summary.configured && (
          <span className="text-muted-foreground block text-xs">Avaliação não configurada</span>
        )}
      </td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        {formatCalendarDate(summary.eventDate)}
        <span className="text-muted-foreground block text-xs">
          {formatTimeRange(summary.startTime, summary.endTime)}
        </span>
      </td>

      <td className="px-4 py-3">
        <Badge variant={EVALUATION_STAGE_VARIANTS[etapa]}>{EVALUATION_STAGE_LABELS[etapa]}</Badge>
      </td>

      <td className="text-muted-foreground px-4 py-3 text-xs whitespace-nowrap">
        {/* ⚠️ A HORA DO ENVIO, E NÃO O ATRASO EM MINUTOS. "30 minutos após o
            término" obriga quem lê a fazer a conta de cabeça, com o horário do
            evento que está na coluna ao lado. A data completa responde a
            pergunta que a pessoa realmente tem: "já saiu? quando sai?" */}
        {summary.sendAt ? formatDateTime(summary.sendAt) : "—"}
      </td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <UserCheck className="text-muted-foreground h-4 w-4" aria-hidden="true" />
          {summary.present}
        </span>
      </td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <Send className="text-muted-foreground h-4 w-4" aria-hidden="true" />
          {summary.sent}
        </span>
      </td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="text-primary-strong h-4 w-4" aria-hidden="true" />
          {summary.answered}
        </span>
      </td>

      {/* ⚠️ "—" E NÃO "0%" QUANDO NINGUÉM RECEBEU. "0%" afirma que as pessoas não
          responderam; o travessão diz que não há o que medir ainda. Ver
          `responseRate`. */}
      <td className="px-4 py-3 tabular-nums">{taxa === null ? "—" : `${taxa}%`}</td>

      <td className="px-4 py-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={destino}>{summary.configured ? "Abrir" : "Configurar"}</Link>
        </Button>
      </td>
    </tr>
  );
}
