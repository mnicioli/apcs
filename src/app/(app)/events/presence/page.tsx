import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Users } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listEventRegistrationSummaries } from "@/lib/services/event-landing";
import { formatCalendarDate } from "@/lib/utils";
import {
  LANDING_PAGE_STATUS_LABELS,
  PRESENCE_MODULE_SUBTITLE,
  PRESENCE_MODULE_TITLE,
} from "@/modules/event/event.landing.labels";
import { landingEffectiveStatus } from "@/modules/event/event.landing.rules";
import {
  EMPTY_PRESENCE_BOARD_FILTERS,
  REGISTRATION_PAGE_SIZE,
  type EventRegistrationSummary,
} from "@/modules/event/event.landing.types";
import { eventPresenceHref, presenceHref } from "@/modules/event/event.registrations.routes";
import { formatTimeRange } from "@/modules/event/event.rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { LANDING_STATUS_BADGE_VARIANT } from "../landing-pages/landing-badges";
import { PresenceEventSearch } from "./presence-event-search";

export const metadata: Metadata = { title: "Lista de Presença" };

/**
 * A TELA DE SELEÇÃO DE EVENTO (§7 passos 1 a 3, §8).
 *
 * ============================================================================
 * ⚠️ ELA REUSA `listEventRegistrationSummaries` INTEIRA, SEM UMA LINHA NOVA.
 * ============================================================================
 * O §8 pede nome do evento, data, situação, quantidade de inscrições e
 * quantidade de participantes. É exatamente o que a tela inicial de Inscrições
 * já lê do banco, numa consulta só, com as contagens feitas lá (e não em
 * memória, o que faria dado pessoal de centenas de terceiros trafegar para
 * responder "quantos são").
 *
 * ⚠️ E A FONTE ESTAR CERTA NÃO É COINCIDÊNCIA: uma inscrição só existe através
 * de uma página de inscrição (`event_registrations.landing_page_id` é `not
 * null`), então "eventos com página de inscrição" e "eventos que podem ter
 * participantes" são o mesmo conjunto. Uma função nova que listasse "eventos
 * para a presença" devolveria a mesma lista, com a chance de divergir.
 *
 * ⚠️ O QUE ESTA TELA NÃO MOSTRA É "quantos já estão presentes". Seria útil e
 * seria caro: exigiria mais uma contagem por evento na consulta que serve as
 * DUAS telas, para um número que só interessa a esta. Quem quer saber abre o
 * evento — e lá o indicador está, respeitando o filtro (§9).
 */
export default async function PresencePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const role = await getCurrentUserRole();
  // §24 — sem permissão de VISUALIZAÇÃO não se acessa a funcionalidade. Mesmo
  // desvio das outras telas do módulo: `/dashboard`, e não uma tela de erro.
  if (!hasPermission(role, "presence.read")) redirect("/dashboard");

  const { q, page } = await searchParams;
  const busca = q ?? "";
  const paginaAtual = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);

  const { rows, total } = await listEventRegistrationSummaries(busca, paginaAtual);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{PRESENCE_MODULE_TITLE}</h1>
        <p className="text-muted-foreground text-sm">{PRESENCE_MODULE_SUBTITLE}</p>
      </div>

      <PresenceEventSearch query={busca} />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            {/* §24 — "vazio" e "vazio por causa da busca" são estados
                diferentes. O primeiro diz o que fazer; o segundo oferece o
                caminho de volta. Trocá-los faz alguém concluir que o sistema
                perdeu os dados. */}
            <p className="text-muted-foreground text-sm">
              {busca.trim()
                ? "Nenhum evento encontrado para esta busca."
                : "Nenhum evento tem página de inscrição ainda. Sem inscrições não há participantes para registrar presença."}
            </p>
            {busca.trim() ? (
              <Button asChild variant="outline">
                <Link href={presenceHref()}>Limpar busca</Link>
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link href="/events/landing-pages">Ir para Landing Pages</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Eventos com inscrições, dos mais recentes para os mais antigos
                  </caption>
                  <thead className="text-muted-foreground border-border border-b text-left">
                    <tr>
                      {[
                        "Evento",
                        "Data",
                        "Situação",
                        "Inscrições",
                        "Participantes",
                        "Confirmados",
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
            pageSize={REGISTRATION_PAGE_SIZE}
            total={total}
            href={(alvo) => presenceHref(alvo, busca)}
            label="Paginação dos eventos"
            noun={["evento", "eventos"]}
          />
        </>
      )}
    </div>
  );
}

function EventoDaLista({ summary }: { summary: EventRegistrationSummary }) {
  // A situação exibida é DERIVADA, como em toda tela deste módulo: `status`
  // guarda só a decisão humana, e "Encerrada" também sai do prazo vencido e da
  // lotação atingida. Ver `landingEffectiveStatus`.
  const efetiva = landingEffectiveStatus(
    {
      status: summary.landingStatus,
      closesAt: summary.closesAt,
      maxParticipants: summary.maxParticipants,
      participantCount: summary.participants,
      eventDate: summary.eventDate,
    },
    new Date(),
  );

  const destino = eventPresenceHref(summary.eventId, EMPTY_PRESENCE_BOARD_FILTERS);
  const semParticipantes = summary.participants === 0;

  return (
    <tr className="border-border hover:bg-muted/50 border-b align-middle last:border-0">
      <td className="max-w-64 px-4 py-3">
        <Link href={destino} className="text-primary-strong block truncate hover:underline">
          {summary.eventName}
        </Link>
      </td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        {formatCalendarDate(summary.eventDate)}
        <span className="text-muted-foreground block text-xs">
          {formatTimeRange(summary.startTime, summary.endTime)}
        </span>
      </td>

      <td className="px-4 py-3">
        <Badge variant={LANDING_STATUS_BADGE_VARIANT[efetiva]}>
          {LANDING_PAGE_STATUS_LABELS[efetiva]}
        </Badge>
      </td>

      <td className="px-4 py-3 tabular-nums">{summary.registrations}</td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <Users className="text-muted-foreground h-4 w-4" aria-hidden="true" />
          {summary.participants}
        </span>
      </td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="text-primary-strong h-4 w-4" aria-hidden="true" />
          {summary.confirmed}
        </span>
      </td>

      <td className="px-4 py-3">
        {/* ⚠️ O EVENTO SEM PARTICIPANTES CONTINUA CLICÁVEL, e isso é deliberado
            (§24). Um botão desabilitado obrigaria a pessoa a adivinhar por quê;
            a lista aberta explica em uma frase que ninguém se inscreveu ainda e
            oferece o caminho. */}
        <Button asChild variant="ghost" size="sm">
          <Link href={destino}>{semParticipantes ? "Abrir" : "Abrir lista"}</Link>
        </Button>
      </td>
    </tr>
  );
}
