import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Pencil, Plus, Users } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listLandingPages } from "@/lib/services/event-landing";
import { formatCalendarDate, formatRelativeDate, todayInSaoPaulo } from "@/lib/utils";
import {
  LANDING_MODULE_SUBTITLE,
  LANDING_MODULE_TITLE,
  LANDING_PAGE_STATUS_LABELS,
  LANDING_STATUS_REASON_LABELS,
} from "@/modules/event/event.landing.labels";
import { landingEffectiveStatus, landingStatusReason } from "@/modules/event/event.landing.rules";
import {
  DEFAULT_LANDING_STATUS_FILTER,
  isLandingStatusFilter,
  type LandingPageFilters,
  type LandingPageWithEvent,
} from "@/modules/event/event.landing.types";
import { formatTimeRange } from "@/modules/event/event.rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LANDING_STATUS_BADGE_VARIANT } from "./landing-badges";
import { LandingFilters } from "./landing-filters";
import { LandingStatusActions } from "./landing-status-actions";

export const metadata: Metadata = { title: "Landing Pages" };

/**
 * Grid de Landing Pages (§3).
 *
 * ⚠️ A SITUAÇÃO EXIBIDA É DERIVADA, não lida de uma coluna. `status` no banco
 * guarda só a decisão humana; "Encerrada" também sai do prazo vencido e da
 * lotação atingida. Ver `event.landing.rules.ts` e o cabeçalho da migration.
 *
 * O "agora" é decidido UMA VEZ aqui e passado adiante: se cada linha chamasse o
 * relógio, duas linhas renderizadas na virada de um prazo mostrariam situações
 * calculadas em instantes diferentes.
 *
 * A permissão é checada aqui (1ª camada) e a RLS de `event_landing_pages`
 * filtra no banco (2ª camada) — as duas contam a mesma história.
 */
export default async function LandingPagesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; from?: string; to?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "events.read")) redirect("/dashboard");

  const { q, status, from, to } = await searchParams;
  const filters: LandingPageFilters = {
    query: q ?? "",
    // Situação desconhecida cai no padrão em vez de mostrar lista vazia: uma
    // URL colada errada não deve parecer "não há nada aqui".
    status: status && isLandingStatusFilter(status) ? status : DEFAULT_LANDING_STATUS_FILTER,
    from: from ?? "",
    to: to ?? "",
  };

  const today = todayInSaoPaulo();
  const now = new Date();
  const { pages, truncated } = await listLandingPages(filters, today, now);
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
          <h1 className="text-2xl font-semibold tracking-tight">{LANDING_MODULE_TITLE}</h1>
          <p className="text-muted-foreground text-sm">{LANDING_MODULE_SUBTITLE}</p>
        </div>
        {canWrite && <NovaLandingButton />}
      </div>

      <LandingFilters filters={filters} />

      {/* A leitura tem teto e a busca roda sobre o que veio. Sem este aviso,
          procurar uma página que existe mas ficou fora da leitura devolveria
          "nenhuma página encontrada" — e a pessoa concluiria que ela não foi
          criada. */}
      {truncated && (
        <p role="status" className="text-muted-foreground text-sm">
          Há mais páginas do que cabe nesta leitura. Use o período para estreitar a busca — o
          resultado pode estar incompleto.
        </p>
      )}

      {pages.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-muted-foreground text-sm">
              {isFiltered
                ? "Nenhuma página encontrada para os filtros selecionados."
                : "Nenhuma página de inscrição criada. Cada evento pode ter uma."}
            </p>
            {isFiltered ? (
              <Button asChild variant="outline">
                <Link href="/events/landing-pages">Limpar filtros</Link>
              </Button>
            ) : (
              canWrite && <NovaLandingButton />
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Páginas de inscrição, dos eventos mais próximos para os mais distantes
                </caption>
                <thead className="text-muted-foreground border-border border-b text-left">
                  <tr>
                    {["Evento", "Data", "Situação", "Inscritos", "Atualizado em", "Ações"].map(
                      (label) => (
                        <th
                          key={label}
                          scope="col"
                          className="px-4 py-3 font-medium whitespace-nowrap"
                        >
                          {label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {pages.map((page) => (
                    <LandingRow key={page.id} page={page} canWrite={canWrite} now={now} />
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

function NovaLandingButton() {
  return (
    <Button asChild>
      <Link href="/events/landing-pages/new">
        <Plus className="h-4 w-4" aria-hidden="true" />
        Criar Landing Page
      </Link>
    </Button>
  );
}

function LandingRow({
  page,
  canWrite,
  now,
}: {
  page: LandingPageWithEvent;
  canWrite: boolean;
  now: Date;
}) {
  const efetiva = landingEffectiveStatus(page, now);
  const motivo = landingStatusReason(page, now);

  return (
    <tr className="border-border hover:bg-muted/50 border-b align-middle last:border-0">
      <td className="max-w-64 px-4 py-3">
        <Link
          href={`/events/landing-pages/${page.id}`}
          className="text-primary-strong block truncate hover:underline"
          title={page.event.name}
        >
          {page.event.name}
        </Link>
        {/* O endereço público sob o nome: é por ele que se procura na busca, e
            é ele que se cola numa conversa. */}
        <span className="text-muted-foreground block truncate font-mono text-xs">
          /eventos/{page.slug}
        </span>
      </td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        {formatCalendarDate(page.event.eventDate)}
        <span className="text-muted-foreground block text-xs">
          {formatTimeRange(page.event.startTime, page.event.endTime)}
        </span>
      </td>

      <td className="px-4 py-3">
        {/* O motivo vai no `title`: a grid mostra "Encerrada", e quem passa o
            mouse descobre se foi o prazo, a lotação ou uma decisão — três
            providências diferentes. */}
        <Badge
          variant={LANDING_STATUS_BADGE_VARIANT[efetiva]}
          title={motivo ? LANDING_STATUS_REASON_LABELS[motivo] : undefined}
        >
          {LANDING_PAGE_STATUS_LABELS[efetiva]}
        </Badge>
      </td>

      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <Users className="text-muted-foreground h-4 w-4" aria-hidden="true" />
          {page.participantCount}
          {page.maxParticipants !== null && (
            <span className="text-muted-foreground">/ {page.maxParticipants}</span>
          )}
        </span>
      </td>

      <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
        {formatRelativeDate(page.updatedAt)}
      </td>

      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1">
          {/* ⚠️ UM BOTÃO SÓ PARA VER E EDITAR, e não dois. O Builder É a tela de
              detalhe: quem não tem `events.write` abre a mesma tela em modo de
              leitura (os campos vêm desabilitados). Dois destinos para a mesma
              página seria uma escolha sem diferença. */}
          <Button asChild variant="ghost" size="sm">
            <Link href={`/events/landing-pages/${page.id}`}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              {canWrite ? "Abrir" : "Visualizar"}
            </Link>
          </Button>

          {canWrite && (
            <LandingStatusActions
              landingPageId={page.id}
              eventName={page.event.name}
              status={page.status}
            />
          )}
        </div>
      </td>
    </tr>
  );
}
