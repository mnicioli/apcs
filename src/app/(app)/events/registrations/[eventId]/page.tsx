import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getLandingPageByEvent, getRegistrationBoard } from "@/lib/services/event-landing";
import { formatCalendarDate, formatDateTime } from "@/lib/utils";
import { formatWhatsapp } from "@/lib/format/phone";
import {
  LANDING_PAGE_STATUS_LABELS,
  PARTICIPANT_CONFIRMATION_LABELS,
} from "@/modules/event/event.landing.labels";
import { landingEffectiveStatus } from "@/modules/event/event.landing.rules";
import {
  REGISTRATION_PAGE_SIZE,
  type LandingPageWithEvent,
  type RegistrationBoardMetrics,
  type RegistrationBoardRow,
} from "@/modules/event/event.landing.types";
import {
  eventRegistrationsHref,
  hasActiveFilters,
  parseRegistrationFilters,
  registrationsExportHref,
} from "@/modules/event/event.registrations.routes";
import { formatTimeRange } from "@/modules/event/event.rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { LANDING_STATUS_BADGE_VARIANT } from "../../landing-pages/landing-badges";
import { BoardFilters } from "./board-filters";
import { ConfirmationToggle } from "./confirmation-toggle";
import { ParticipantActions } from "./participant-actions";

/**
 * A GRID DE PARTICIPANTES DE UM EVENTO (§5 a §10).
 *
 * ============================================================================
 * ⚠️ TUDO O QUE ESTA TELA MOSTRA ESTÁ PRESO AO EVENTO DA ROTA (§5, §26).
 * ============================================================================
 * `eventId` vem da URL e entra em TODAS as leituras e em TODAS as escritas. Não
 * existe caminho em que um participante de outro evento apareça aqui, e não
 * existe caminho em que uma edição feita nesta tela alcance outro evento — as
 * funções do banco recusam quando o alvo não pertence ao `p_event_id` recebido.
 *
 * ⚠️ BUSCA, FILTRO, ORDENAÇÃO E PAGINAÇÃO SÃO DO SERVIDOR (§7, §21). Nada é
 * filtrado no navegador. A razão não é só desempenho: filtrar aqui exigiria
 * baixar TODOS os participantes do evento para o cliente — nome, e-mail e
 * telefone de centenas de terceiros — para depois esconder a maioria (§25).
 *
 * ⚠️ OS INDICADORES DO §6 RESPEITAM OS FILTROS, e vêm da mesma consulta das
 * linhas. Ver o cabeçalho de `event_registrations_board`.
 */

/**
 * A leitura acontece DUAS vezes por requisição — em generateMetadata e no
 * componente. Sem o cache do React seriam duas consultas ao banco (e duas
 * assinaturas de URL de imagem) para desenhar uma tela, que é o oposto do que o
 * §21 pede. Mesma decisão da pagina publica do Prompt 3.
 */
const carregarLanding = cache(getLandingPageByEvent);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string }>;
}): Promise<Metadata> {
  const { eventId } = await params;
  const landing = await carregarLanding(eventId).catch(() => null);
  return { title: landing ? `Inscrições · ${landing.event.name}` : "Inscrições" };
}

export default async function EventRegistrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "registrations.read")) redirect("/dashboard");

  const { eventId } = await params;
  const filters = parseRegistrationFilters(await searchParams);

  // ⚠️ A LANDING PAGE É A PORTA DE ENTRADA DO EVENTO NESTA TELA. Um evento sem
  // página de inscrição não tem inscritos e não tem por que abrir aqui — o §4
  // lista só os que têm. `notFound()` e não uma tela vazia: um id inventado na
  // URL não deve devolver o cabeçalho de um evento que a pessoa não escolheu.
  const landing = await carregarLanding(eventId);
  if (!landing) notFound();

  const board = await getRegistrationBoard(eventId, filters);
  const canWrite = hasPermission(role, "registrations.write");
  const filtrado = hasActiveFilters(filters);

  return (
    <div className="space-y-6">
      <CabecalhoDoEvento landing={landing} />

      <MetricasDoEvento metrics={board.metrics} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <BoardFilters eventId={eventId} filters={filters} />

        {/* §18 e §19 — um LINK, e não um botão com `fetch`. O arquivo é um
            download: precisa de `Content-Disposition`, que uma Server Action não
            tem como definir. E o endereço carrega os MESMOS filtros da tela,
            montado pela mesma função que monta a paginação. */}
        <Button asChild variant="outline">
          <a href={registrationsExportHref(eventId, filters)}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Exportar para Excel
          </a>
        </Button>
      </div>

      {board.rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            {/* §27 — três estados vazios diferentes, e confundi-los faz alguém
                concluir que o sistema perdeu os dados. */}
            <p className="text-muted-foreground text-sm">
              {filtrado
                ? "Nenhuma inscrição encontrada."
                : "Ainda não existem inscrições para este evento."}
            </p>
            {filtrado && (
              <Button asChild variant="outline">
                <Link
                  href={eventRegistrationsHref(eventId, {
                    ...filters,
                    query: "",
                    confirmation: "all",
                    from: "",
                    to: "",
                    page: 1,
                  })}
                >
                  Limpar filtros
                </Link>
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
                    Participantes inscritos em {landing.event.name}
                  </caption>
                  <thead className="text-muted-foreground border-border border-b text-left">
                    <tr>
                      {[
                        "Granja / Empresa",
                        "Participante",
                        "E-mail",
                        "Telefone",
                        "WhatsApp",
                        "Confirmado",
                        "Data da inscrição",
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
                    {board.rows.map((linha) => (
                      <ParticipantRow
                        key={linha.participantId}
                        eventId={eventId}
                        row={linha}
                        canWrite={canWrite}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Pagination
            page={board.page}
            pageSize={REGISTRATION_PAGE_SIZE}
            total={board.total}
            href={(alvo) => eventRegistrationsHref(eventId, { ...filters, page: alvo })}
            label="Paginação dos participantes"
            noun={["participante", "participantes"]}
          />
        </>
      )}
    </div>
  );
}

/** §5 — o topo: de que evento se está falando, e como voltar. */
function CabecalhoDoEvento({ landing }: { landing: LandingPageWithEvent }) {
  const efetiva = landingEffectiveStatus(landing, new Date());

  return (
    <div className="space-y-3">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/events/registrations">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para eventos
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{landing.event.name}</h1>
          <p className="text-muted-foreground text-sm">
            {formatCalendarDate(landing.event.eventDate)} ·{" "}
            {formatTimeRange(landing.event.startTime, landing.event.endTime)} ·{" "}
            {landing.event.location}
          </p>
        </div>

        <Badge variant={LANDING_STATUS_BADGE_VARIANT[efetiva]}>
          {LANDING_PAGE_STATUS_LABELS[efetiva]}
        </Badge>
      </div>
    </div>
  );
}

/**
 * §6 — os indicadores.
 *
 * ⚠️ ELES MUDAM COM O FILTRO, e o texto diz isso quando é o caso. Um número que
 * some sem explicação faz quem opera desconfiar da contagem; um número que
 * anuncia "no recorte atual" é informação.
 */
function MetricasDoEvento({ metrics }: { metrics: RegistrationBoardMetrics }) {
  const cartoes: [string, number][] = [
    ["Inscrições", metrics.registrations],
    ["Participantes", metrics.participants],
    ["Confirmados", metrics.confirmed],
    ["Não confirmados", metrics.notConfirmed],
    ["Granjas / Empresas", metrics.companies],
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cartoes.map(([rotulo, valor]) => (
        <Card key={rotulo}>
          <CardContent className="p-4">
            <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {rotulo}
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{valor}</dd>
          </CardContent>
        </Card>
      ))}
    </dl>
  );
}

function ParticipantRow({
  eventId,
  row,
  canWrite,
}: {
  eventId: string;
  row: RegistrationBoardRow;
  canWrite: boolean;
}) {
  return (
    <tr className="border-border hover:bg-muted/50 border-b align-middle last:border-0">
      <td className="max-w-48 px-4 py-3">
        <span className="block truncate" title={row.companyName}>
          {row.companyName}
        </span>
      </td>

      <td className="max-w-48 px-4 py-3">
        <span className="block truncate" title={row.fullName}>
          {row.fullName}
        </span>
      </td>

      <td className="text-muted-foreground max-w-56 px-4 py-3">
        <span className="block truncate" title={row.email}>
          {row.email}
        </span>
      </td>

      {/* ⚠️ A MÁSCARA É DA TELA. O banco guarda só dígitos (e a exportação sai
          com dígitos, para a planilha não transformar o número em fórmula);
          aqui ela existe porque ninguém lê "11999998888" de olho. */}
      <td className="text-muted-foreground px-4 py-3 whitespace-nowrap tabular-nums">
        {row.phone ? formatWhatsapp(row.phone) : "—"}
      </td>

      <td className="text-muted-foreground px-4 py-3 whitespace-nowrap tabular-nums">
        {row.whatsapp ? formatWhatsapp(row.whatsapp) : "—"}
      </td>

      <td className="px-4 py-3">
        {canWrite ? (
          <ConfirmationToggle
            eventId={eventId}
            participantId={row.participantId}
            participantName={row.fullName}
            confirmation={row.confirmation}
          />
        ) : (
          // Sem `registrations.write` o estado ainda é LEGÍVEL — só não é
          // clicável. Esconder a coluna faria a tela mentir sobre o que existe.
          <Badge variant={row.confirmation === "confirmed" ? "attention" : "default"}>
            {PARTICIPANT_CONFIRMATION_LABELS[row.confirmation]}
          </Badge>
        )}
      </td>

      <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
        {formatDateTime(row.registeredAt)}
      </td>

      <td className="px-4 py-3">
        <ParticipantActions eventId={eventId} row={row} canWrite={canWrite} />
      </td>
    </tr>
  );
}
