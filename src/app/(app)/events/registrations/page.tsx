import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Circle, Users } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listEventRegistrationSummaries } from "@/lib/services/event-landing";
import { formatCalendarDate } from "@/lib/utils";
import {
  LANDING_PAGE_STATUS_LABELS,
  REGISTRATIONS_MODULE_SUBTITLE,
  REGISTRATIONS_MODULE_TITLE,
} from "@/modules/event/event.landing.labels";
import { landingEffectiveStatus } from "@/modules/event/event.landing.rules";
import {
  EMPTY_REGISTRATION_BOARD_FILTERS,
  REGISTRATION_PAGE_SIZE,
  type EventRegistrationSummary,
} from "@/modules/event/event.landing.types";
import {
  eventRegistrationsHref,
  registrationsHref,
} from "@/modules/event/event.registrations.routes";
import { formatTimeRange } from "@/modules/event/event.rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { LANDING_STATUS_BADGE_VARIANT } from "../landing-pages/landing-badges";
import { EventSearch } from "./event-search";

export const metadata: Metadata = { title: "Inscrições" };

/**
 * A TELA INICIAL DE INSCRIÇÕES (§4) — os eventos que têm página de inscrição.
 *
 * ⚠️ SÓ EVENTOS COM LANDING PAGE APARECEM, e é o §4 ao pé da letra. Um evento
 * sem página de inscrição não tem como ter inscritos — listá-lo aqui daria uma
 * linha com cinco zeros e um botão que abre uma grid vazia.
 *
 * ⚠️ AS CINCO CONTAGENS VÊM DO BANCO, numa consulta (§21). Pelo PostgREST elas
 * seriam a lista inteira de participantes vindo para o servidor Next contar em
 * memória — dado pessoal de centenas de terceiros trafegando para responder
 * "quantos são" (§25). Ver `event_registration_summaries`.
 *
 * A permissão é checada aqui (1ª camada) e a RLS das tabelas de inscrição filtra
 * no banco (2ª camada). As duas contam a mesma história.
 */
export default async function RegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "registrations.read")) redirect("/dashboard");

  const { q, page } = await searchParams;
  const busca = q ?? "";
  const paginaAtual = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);

  const { rows, total } = await listEventRegistrationSummaries(busca, paginaAtual);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{REGISTRATIONS_MODULE_TITLE}</h1>
        <p className="text-muted-foreground text-sm">{REGISTRATIONS_MODULE_SUBTITLE}</p>
      </div>

      <EventSearch query={busca} />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            {/* §27 — "vazio" e "vazio por causa da busca" são estados
                diferentes. O primeiro diz o que fazer; o segundo oferece o
                caminho de volta. Trocá-los faz alguém concluir que o sistema
                perdeu os dados. */}
            <p className="text-muted-foreground text-sm">
              {busca.trim()
                ? "Nenhum evento encontrado para esta busca."
                : "Nenhum evento tem página de inscrição ainda. Crie uma em Landing Pages para começar a receber inscrições."}
            </p>
            {busca.trim() ? (
              <Button asChild variant="outline">
                <Link href={registrationsHref()}>Limpar busca</Link>
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
                    Eventos com página de inscrição, dos mais recentes para os mais antigos
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
                        "Não confirmados",
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
                      <EventRow key={linha.eventId} summary={linha} />
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
            href={(alvo) => registrationsHref(alvo, busca)}
            label="Paginação dos eventos"
            noun={["evento", "eventos"]}
          />
        </>
      )}
    </div>
  );
}

function EventRow({ summary }: { summary: EventRegistrationSummary }) {
  // ⚠️ A SITUAÇÃO EXIBIDA É DERIVADA, como em toda tela deste módulo: `status`
  // guarda só a decisão humana, e "Encerrada" também sai do prazo vencido e da
  // lotação atingida. Ver `landingEffectiveStatus`.
  const efetiva = landingEffectiveStatus(
    {
      status: summary.landingStatus,
      closesAt: summary.closesAt,
      maxParticipants: summary.maxParticipants,
      participantCount: summary.participants,
    },
    new Date(),
  );

  const destino = eventRegistrationsHref(summary.eventId, EMPTY_REGISTRATION_BOARD_FILTERS);

  return (
    <tr className="border-border hover:bg-muted/50 border-b align-middle last:border-0">
      <td className="max-w-64 px-4 py-3">
        <Link href={destino} className="text-primary-strong block truncate hover:underline">
          {summary.eventName}
        </Link>
        <span className="text-muted-foreground block truncate font-mono text-xs">
          /eventos/{summary.slug}
        </span>
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
          {summary.maxParticipants !== null && (
            <span className="text-muted-foreground">/ {summary.maxParticipants}</span>
          )}
        </span>
      </td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="text-primary-strong h-4 w-4" aria-hidden="true" />
          {summary.confirmed}
        </span>
      </td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <Circle className="text-muted-foreground h-4 w-4" aria-hidden="true" />
          {summary.notConfirmed}
        </span>
      </td>

      <td className="px-4 py-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={destino}>Ver inscrições</Link>
        </Button>
      </td>
    </tr>
  );
}
