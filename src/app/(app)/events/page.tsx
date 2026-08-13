import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye, Pencil, Plus } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listEvents } from "@/lib/services/events";
import { formatCalendarDate, todayInSaoPaulo } from "@/lib/utils";
import { EVENT_STATUS_LABELS, EVENT_STATUS_REASON_LABELS } from "@/modules/event/event.labels";
import { effectiveStatus, formatTimeRange, statusReason } from "@/modules/event/event.rules";
import {
  DEFAULT_EVENT_STATUS_FILTER,
  isEventStatusFilter,
  type EventFilters,
  type EventSummary,
} from "@/modules/event/event.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { STATUS_BADGE_VARIANT } from "./event-badges";
import { EventSegmentsCell } from "./event-segments-cell";
import { EventStatusActions } from "./event-status-actions";
import { EventThumbnail } from "./event-thumbnail";
import { EventsFilters } from "./events-filters";

export const metadata: Metadata = { title: "Eventos" };

/**
 * Grid de eventos.
 *
 * ⚠️ O STATUS EXIBIDO É DERIVADO, não lido de uma coluna. `status` no banco
 * guarda só a decisão humana; "Expirado" sai da comparação entre a data do
 * evento e o dia de hoje em São Paulo. Ver `event.rules.ts`.
 *
 * O "hoje" é decidido UMA VEZ aqui e passado adiante: se cada linha chamasse o
 * relógio, duas linhas renderizadas na virada da meia-noite mostrariam status
 * calculados em dias diferentes.
 *
 * A permissão é checada aqui (1ª camada) e a RLS de `events` filtra no banco
 * (2ª camada) — as duas contam a mesma história.
 */
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; from?: string; to?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "events.read")) redirect("/dashboard");

  const { q, status, from, to } = await searchParams;
  const filters: EventFilters = {
    query: q ?? "",
    // Status desconhecido cai no padrão em vez de mostrar lista vazia: uma URL
    // colada errada não deve parecer "não há nada aqui".
    status: status && isEventStatusFilter(status) ? status : DEFAULT_EVENT_STATUS_FILTER,
    from: from ?? "",
    to: to ?? "",
  };

  const today = todayInSaoPaulo();
  const { events, truncated } = await listEvents(filters, today);
  const canWrite = hasPermission(role, "events.write");
  const isFiltered =
    filters.query.trim() !== "" ||
    filters.status !== "all" ||
    filters.from !== "" ||
    filters.to !== "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Eventos</h1>
          <p className="text-muted-foreground text-sm">
            A agenda da APCS. Eventos ativos e futuros são os que o chatbot poderá oferecer aos
            associados.
          </p>
        </div>
        {canWrite && <NovoEventoButton />}
      </div>

      <EventsFilters filters={filters} />

      {/* A leitura tem teto e a busca por nome roda sobre o que veio. Sem este
          aviso, procurar um evento que existe mas ficou fora da leitura
          devolveria "nenhum evento encontrado" — e a pessoa concluiria que ele
          não está cadastrado. */}
      {truncated && (
        <p role="status" className="text-muted-foreground text-sm">
          Há mais eventos do que cabe nesta leitura. Use o período para estreitar a busca — o
          resultado pode estar incompleto.
        </p>
      )}

      {events.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-muted-foreground text-sm">
              {isFiltered
                ? "Nenhum evento encontrado para os filtros selecionados."
                : "Nenhum evento cadastrado."}
            </p>
            {isFiltered ? (
              <Button asChild variant="outline">
                <Link href="/events">Limpar filtros</Link>
              </Button>
            ) : (
              canWrite && <NovoEventoButton />
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Eventos da APCS, dos mais próximos para os mais distantes
                </caption>
                <thead className="text-muted-foreground border-border border-b text-left">
                  <tr>
                    {[
                      "Imagem",
                      "Nome",
                      "Local",
                      "Data",
                      "Horário",
                      "Status",
                      "Público",
                      "Ações",
                    ].map((label) => (
                      <th
                        key={label}
                        scope="col"
                        className="px-4 py-3 font-medium whitespace-nowrap"
                      >
                        {label === "Imagem" ? <span className="sr-only">Imagem</span> : label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <EventRow key={event.id} event={event} canWrite={canWrite} today={today} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function NovoEventoButton() {
  return (
    <Button asChild>
      <Link href="/events/new">
        <Plus className="h-4 w-4" aria-hidden="true" />
        Novo Evento
      </Link>
    </Button>
  );
}

function EventRow({
  event,
  canWrite,
  today,
}: {
  event: EventSummary;
  canWrite: boolean;
  today: string;
}) {
  const effective = effectiveStatus(event, today);
  const reason = statusReason(event, today);

  return (
    <tr className="border-border hover:bg-muted/50 border-b align-middle last:border-0">
      <td className="py-2 pr-2 pl-4">
        <EventThumbnail url={event.imageUrl} alt={event.name} />
      </td>

      <td className="max-w-56 px-4 py-3">
        <Link
          href={`/events/${event.id}`}
          className="text-primary-strong block truncate hover:underline"
          title={event.name}
        >
          {event.name}
        </Link>
      </td>

      <td className="text-muted-foreground max-w-40 px-4 py-3">
        <span className="block truncate" title={event.location}>
          {event.location}
        </span>
      </td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        {formatCalendarDate(event.eventDate)}
      </td>

      <td className="text-muted-foreground px-4 py-3 whitespace-nowrap tabular-nums">
        {formatTimeRange(event.startTime, event.endTime)}
      </td>

      <td className="px-4 py-3">
        {/* O motivo vai no `title`: a grid mostra "Expirado", e quem passa o
            mouse descobre por quê sem precisar abrir o evento. */}
        <Badge
          variant={STATUS_BADGE_VARIANT[effective]}
          title={reason ? EVENT_STATUS_REASON_LABELS[reason] : undefined}
        >
          {EVENT_STATUS_LABELS[effective]}
        </Badge>
      </td>

      <td className="px-4 py-3">
        <EventSegmentsCell segments={event.segments} eventName={event.name} />
      </td>

      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/events/${event.id}`}>
              <Eye className="h-4 w-4" aria-hidden="true" />
              Visualizar
            </Link>
          </Button>

          {canWrite && (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/events/${event.id}/edit`}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  Editar
                </Link>
              </Button>
              <EventStatusActions
                eventId={event.id}
                eventName={event.name}
                status={event.status}
                eventDate={event.eventDate}
                today={today}
              />
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
