import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getLandingPageByEvent, getRegistrationBoard } from "@/lib/services/event-landing";
import { formatCalendarDate, formatDateTime } from "@/lib/utils";
import { formatWhatsapp } from "@/lib/format/phone";
import {
  PARTICIPANT_CONFIRMATION_LABELS,
  PRESENCE_MODULE_TITLE,
  presenceLabel,
} from "@/modules/event/event.landing.labels";
import {
  REGISTRATION_PAGE_SIZE,
  type LandingPageWithEvent,
  type RegistrationBoardMetrics,
  type RegistrationBoardRow,
} from "@/modules/event/event.landing.types";
import {
  eventPresenceHref,
  hasActiveFilters,
  parsePresenceFilters,
} from "@/modules/event/event.registrations.routes";
import { formatTimeRange } from "@/modules/event/event.rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { PresenceFiltersBar } from "./presence-filters";
import { PresenceToggle } from "./presence-toggle";

/**
 * A LISTA DE PRESENÇA DE UM EVENTO (§7 a §16).
 *
 * ============================================================================
 * ⚠️ TUDO O QUE ESTA TELA MOSTRA ESTÁ PRESO AO EVENTO DA ROTA (§18).
 * ============================================================================
 * `eventId` vem da URL e entra em TODAS as leituras e em TODAS as escritas. Não
 * existe caminho em que um participante de outro evento apareça aqui, e não
 * existe caminho em que um check-in feito nesta tela alcance outro evento — a
 * função do banco recusa quando o alvo não pertence ao `p_event_id` recebido.
 *
 * ⚠️ A FONTE É A CADEIA QUE JÁ EXISTE (§6): evento → inscrição → participante.
 * Não há participante independente, criado só para registrar presença. Quem não
 * tem inscrição válida não aparece nesta lista, e não há como criá-lo por aqui.
 *
 * ⚠️ BUSCA, FILTRO, ORDENAÇÃO E PAGINAÇÃO SÃO DO SERVIDOR (§14, §16). Nada é
 * filtrado no navegador. A razão não é só desempenho: filtrar aqui exigiria
 * baixar TODOS os participantes do evento para o cliente — nome, e-mail e
 * telefone de centenas de terceiros — para depois esconder a maioria.
 *
 * ⚠️ OS INDICADORES DO §9 RESPEITAM OS FILTROS, e vêm da mesma consulta das
 * linhas. Ver o cabeçalho de `event_registrations_board`.
 *
 * ⚠️ E A LEITURA É A MESMA DA GRID DE INSCRIÇÕES, de propósito. Ver a decisão 2
 * de 20261001000100: as duas telas fazem a mesma pergunta ao banco, com filtros
 * diferentes. O que muda aqui é o que se DESTACA (presença, e não a data da
 * inscrição) e o que se pode EDITAR (presença, e não a confirmação).
 */

/**
 * A leitura acontece DUAS vezes por requisição — em generateMetadata e no
 * componente. Sem o cache do React seriam duas consultas ao banco (e duas
 * assinaturas de URL de imagem) para desenhar uma tela. Mesma decisão da grid
 * de Inscrições.
 */
const carregarLanding = cache(getLandingPageByEvent);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string }>;
}): Promise<Metadata> {
  const { eventId } = await params;
  const landing = await carregarLanding(eventId).catch(() => null);
  return { title: landing ? `Presença · ${landing.event.name}` : PRESENCE_MODULE_TITLE };
}

export default async function EventPresencePage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getCurrentUserRole();
  // §24 — sem permissão de visualização não se acessa a funcionalidade.
  if (!hasPermission(role, "presence.read")) redirect("/dashboard");

  const { eventId } = await params;
  const filters = parsePresenceFilters(await searchParams);

  // ⚠️ §24 — EVENTO INEXISTENTE E EVENTO SEM PÁGINA DE INSCRIÇÃO CAEM AQUI.
  // Um evento sem página de inscrição não tem como ter tido inscritos, e
  // portanto não tem lista de presença. `notFound()` e não uma tela vazia: um id
  // inventado na URL não deve devolver o cabeçalho de um evento que a pessoa não
  // escolheu.
  const landing = await carregarLanding(eventId);
  if (!landing) notFound();

  const board = await getRegistrationBoard(eventId, filters);
  // §19 — quem não tem `presence.write` VÊ a lista e não muda nada.
  const canWrite = hasPermission(role, "presence.write");
  const filtrado = hasActiveFilters(filters);

  return (
    <div className="space-y-6">
      <CabecalhoDoEvento landing={landing} canWrite={canWrite} />

      <IndicadoresDaLista metrics={board.metrics} />

      <PresenceFiltersBar eventId={eventId} filters={filters} />

      {board.rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            {/* §24 — três estados vazios diferentes, e confundi-los faz alguém
                concluir que o sistema perdeu os dados. */}
            <p className="text-muted-foreground text-sm">
              {filtrado
                ? "Nenhum participante encontrado com estes filtros."
                : "Este evento ainda não tem participantes inscritos. A lista de presença é montada a partir das inscrições."}
            </p>
            {filtrado ? (
              <Button asChild variant="outline">
                <Link
                  href={eventPresenceHref(eventId, {
                    ...filters,
                    query: "",
                    presence: "all",
                    confirmation: "all",
                    page: 1,
                  })}
                >
                  Limpar filtros
                </Link>
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link href={`/events/registrations/${eventId}`}>Ver inscrições do evento</Link>
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
                    Participantes de {landing.event.name}, para registro de presença
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
                        "Presença",
                        "Check-in",
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
                      <LinhaDePresenca
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
            href={(alvo) => eventPresenceHref(eventId, { ...filters, page: alvo })}
            label="Paginação dos participantes"
            noun={["participante", "participantes"]}
          />
        </>
      )}
    </div>
  );
}

/** §8 — o topo: de que evento se está falando, e como voltar. */
function CabecalhoDoEvento({
  landing,
  canWrite,
}: {
  landing: LandingPageWithEvent;
  canWrite: boolean;
}) {
  return (
    <div className="space-y-3">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/events/presence">
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

        {/* §19 e §24 — quem não pode editar precisa SABER que não pode, e não
            descobrir clicando num toggle que não responde. */}
        {!canWrite && <Badge variant="done">Somente leitura</Badge>}
      </div>
    </div>
  );
}

/**
 * §9 — os indicadores.
 *
 * ⚠️ ELES MUDAM COM O FILTRO, e vêm da mesma consulta das linhas. Um número
 * apurado à parte diria "73 presentes" sobre uma lista de 5 no dia em que um
 * filtro novo entrasse só em um dos dois lugares — e ninguém confere a soma à
 * mão.
 *
 * ⚠️ A ORDEM É A DO ESCOPO: total, confirmados, presentes, ausentes. Ela conta a
 * jornada na sequência em que ela acontece, e é a mesma sequência que a pessoa
 * lê em voz alta ao relatar o evento.
 */
function IndicadoresDaLista({ metrics }: { metrics: RegistrationBoardMetrics }) {
  const cartoes: [string, number][] = [
    ["Participantes", metrics.participants],
    ["Confirmados", metrics.confirmed],
    ["Presentes", metrics.present],
    ["Ausentes", metrics.absent],
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

function LinhaDePresenca({
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

      {/* A máscara é da TELA. O banco guarda só dígitos; aqui ela existe porque
          ninguém lê "11999998888" de olho. */}
      <td className="text-muted-foreground px-4 py-3 whitespace-nowrap tabular-nums">
        {row.phone ? formatWhatsapp(row.phone) : "—"}
      </td>

      <td className="text-muted-foreground px-4 py-3 whitespace-nowrap tabular-nums">
        {row.whatsapp ? formatWhatsapp(row.whatsapp) : "—"}
      </td>

      {/*
        ⚠️ §11 — A CONFIRMAÇÃO É EXIBIDA, E NÃO EDITÁVEL NESTA TELA.
        O objetivo aqui é controlar PRESENÇA. Um segundo toggle ao lado do
        primeiro convidaria ao clique errado numa fila de gente esperando — e a
        confirmação continua tendo a tela dela, com a permissão dela
        (`registrations.write`, que o Atendente não tem). Não há uma segunda
        lógica de confirmação: há a mesma informação, só de leitura.
      */}
      <td className="px-4 py-3">
        <Badge variant={row.confirmation === "confirmed" ? "attention" : "default"}>
          {PARTICIPANT_CONFIRMATION_LABELS[row.confirmation]}
        </Badge>
      </td>

      <td className="px-4 py-3">
        {canWrite ? (
          <PresenceToggle
            eventId={eventId}
            participantId={row.participantId}
            participantName={row.fullName}
            present={row.present}
          />
        ) : (
          // Sem `presence.write` o estado ainda é LEGÍVEL — só não é clicável.
          // Esconder a coluna faria a tela mentir sobre o que existe.
          <Badge variant={row.present ? "attention" : "default"}>
            {presenceLabel(row.present)}
          </Badge>
        )}
      </td>

      {/*
        ⚠️ O CARIMBO É DO BANCO, E É EXIBIDO NO FUSO DA APCS. `formatDateTime`
        aplica `America/Sao_Paulo` explicitamente — sem isso, a hora seguiria o
        fuso do SERVIDOR (UTC na Vercel) e a lista mostraria todo mundo chegando
        três horas depois.

        Vazio quando não há presença — inclusive depois de uma reversão (§13). O
        registro de que a presença existiu está na trilha, não aqui.
      */}
      <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
        {row.checkedInAt ? formatDateTime(row.checkedInAt) : "—"}
      </td>
    </tr>
  );
}
