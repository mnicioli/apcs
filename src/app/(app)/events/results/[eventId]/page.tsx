import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  getResultsPending,
  getResultsQuestions,
  getResultsResponses,
  getResultsSummary,
} from "@/lib/services/event-results";
import { formatCalendarDate, formatDateTime } from "@/lib/utils";
import {
  KPI_HINTS,
  PENDING_STATUS_LABELS,
  RESULTS_STAGE_COPY,
  RESULTS_TAB_LABELS,
} from "@/modules/event/event.results.labels";
import {
  formatAverage,
  formatPercent,
  pendingStage,
  ratingScaleMax,
  responseRatePercent,
  resultsStage,
} from "@/modules/event/event.results.rules";
import {
  eventResultsHref,
  hasActiveResultsFilters,
  parseResultsFilters,
  responseDetailHref,
  resultsExportHref,
} from "@/modules/event/event.results.routes";
import {
  RESULTS_PAGE_SIZE,
  RESULTS_TABS,
  type ResultsFilters,
  type ResultsPendingRow,
  type ResultsResponseRow,
  type ResultsSummary,
} from "@/modules/event/event.results.types";
import { formatTimeRange } from "@/modules/event/event.rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { DistributionBars, KpiCard, SectionResults } from "../results-charts";
import { ResultsFiltersBar } from "./results-filters";
import { PendingActions } from "./pending-actions";

export const metadata: Metadata = { title: "Resultados do evento" };

/**
 * O PAINEL DE RESULTADOS DE UM EVENTO (§3 a §18, §31).
 *
 * ============================================================================
 * ⚠️ TRÊS ABAS, E CADA UMA CARREGA SÓ O QUE DESENHA (§43).
 * ============================================================================
 * "Evitar criar um endpoint gigantesco retornando absolutamente todos os dados
 * se isso prejudicar performance." A aba de Painel não busca a lista de
 * pendentes; a de Respostas não recalcula a distribuição; a de Pendentes não
 * toca em resposta nenhuma.
 *
 * Os KPIs do topo aparecem nas três porque são o contexto de todas — e são UMA
 * consulta agregada, não uma varredura.
 *
 * ⚠️ A ABA MORA NA URL. Um `useState` faria o endereço não ser compartilhável e
 * obrigaria a busca e a paginação a virarem estado de cliente junto — que é
 * exatamente o que o §17 proíbe ("a busca deve utilizar o backend quando o
 * projeto trabalhar com paginação server-side").
 *
 * ============================================================================
 * ⚠️ NENHUMA MÉDIA É CALCULADA NESTE ARQUIVO (§22, §44).
 * ============================================================================
 * "O frontend apenas apresenta os resultados." Média, mínimo, máximo,
 * distribuição, contagem de elegíveis e separação por versão vêm prontos do
 * Postgres. O que roda aqui é `toLocaleString` e largura de barra.
 *
 * ⚠️ E OS DADOS SÃO LIDOS A CADA ABERTURA (§24). Server Component sem cache: uma
 * resposta nova aparece no próximo carregamento, sem tempo real e sem
 * revalidação manual.
 */
export default async function EventResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "results.read")) redirect("/dashboard");

  const { eventId } = await params;
  const filtros = parseResultsFilters(await searchParams);

  const resumo = await getResultsSummary(eventId);
  // §45. Evento inexistente — ou existente e barrado pela RLS. Os dois chegam
  // aqui iguais de propósito: distinguir contaria a quem está tentando que o id
  // acertado é real.
  if (!resumo) notFound();

  const podeExportar = hasPermission(role, "results.export");
  const etapa = resultsStage(resumo);
  const taxa = responseRatePercent(resumo.sent, resumo.answered);

  return (
    <div className="space-y-6">
      <Cabecalho resumo={resumo} filtros={filtros} podeExportar={podeExportar} />

      <Indicadores resumo={resumo} taxa={taxa} />

      {/* §38 — o painel vazio explica POR QUE está vazio, e o que fazer. Cada
          etapa tem uma providência diferente; "sem dados" mandaria investigar
          quatro coisas. */}
      {etapa !== "ready" ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <p className="font-medium">{RESULTS_STAGE_COPY[etapa]?.titulo}</p>
            <p className="text-muted-foreground text-sm">{RESULTS_STAGE_COPY[etapa]?.corpo}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Abas eventId={eventId} filtros={filtros} />

          {filtros.tab === "dashboard" && <AbaPainel eventId={eventId} resumo={resumo} />}
          {filtros.tab === "responses" && (
            <AbaRespostas eventId={eventId} filtros={filtros} resumo={resumo} />
          )}
          {filtros.tab === "pending" && <AbaPendentes eventId={eventId} filtros={filtros} />}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Cabecalho({
  resumo,
  filtros,
  podeExportar,
}: {
  resumo: ResultsSummary;
  filtros: ResultsFilters;
  podeExportar: boolean;
}) {
  return (
    <div className="space-y-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/events/results">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Resultados
        </Link>
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{resumo.eventName}</h1>
          <p className="text-muted-foreground text-sm">
            {formatCalendarDate(resumo.eventDate)} ·{" "}
            {formatTimeRange(resumo.startTime, resumo.endTime)} · {resumo.location}
          </p>
        </div>

        {/* ⚠️ O BOTÃO SÓ EXISTE COM `results.export` (§40, §41). A rota confere
            de novo — ela é uma URL, alcançável sem passar por esta tela. */}
        {podeExportar && resumo.answered > 0 && (
          <Button asChild variant="outline">
            <Link href={resultsExportHref(resumo.eventId, filtros)}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Baixar planilha
            </Link>
          </Button>
        )}
      </div>

      {/* §21. Duas versões respondidas mudam a leitura do painel inteiro, e
          quem olha precisa saber antes de comparar blocos. */}
      {resumo.answeredVersions > 1 && (
        <p
          role="note"
          className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-4 py-3 text-sm"
        >
          {KPI_HINTS.multipleVersions}
        </p>
      )}
    </div>
  );
}

function Indicadores({ resumo, taxa }: { resumo: ResultsSummary; taxa: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard label="Participantes" value={resumo.participants} />
      <KpiCard label="Presentes" value={resumo.present} />
      {/* §4. Elegíveis é SEMPRE igual a presentes, e aparece separado para a
          regra ficar legível na tela em vez de decorada. */}
      <KpiCard label="Elegíveis" value={resumo.eligible} hint={KPI_HINTS.eligible} />
      <KpiCard label="Enviadas" value={resumo.sent} />
      <KpiCard label="Respondidas" value={resumo.answered} destaque />
      <KpiCard label="Pendentes" value={resumo.pending} />
      <KpiCard
        label="Taxa de resposta"
        value={`${formatPercent(taxa)}%`}
        // §6. Zero enviadas dá 0% — e a frase embaixo impede o zero de ser lido
        // como fracasso de adesão.
        hint={resumo.sent === 0 ? KPI_HINTS.responseRateZero : KPI_HINTS.responseRate}
        destaque
      />
      {/* §34. Sem pergunta marcada como geral, "N/A" e a instrução de como
          resolver — nunca uma média inventada a partir de perguntas que medem
          coisas diferentes. */}
      <KpiCard
        label="Nota média geral"
        value={resumo.hasOverallQuestion ? formatAverage(resumo.overallAverage) : "N/A"}
        /**
         * ⚠️ O CONSELHO SÓ APARECE QUANDO HÁ FORMULÁRIO EM USO. Sem nenhuma
         * avaliação criada ainda, `hasOverallQuestion` é falso porque não há
         * versão a consultar — e mandar "marque uma pergunta como avaliação
         * geral" ali culparia a configuração por um evento que simplesmente
         * ainda não foi processado.
         */
        hint={
          resumo.hasOverallQuestion
            ? `${resumo.overallCount} ${resumo.overallCount === 1 ? "resposta" : "respostas"}`
            : resumo.sent + resumo.pending > 0
              ? KPI_HINTS.overallNA
              : undefined
        }
        destaque={resumo.hasOverallQuestion}
      />

      {/* §28. A falha só ocupa espaço quando existe. */}
      {resumo.failed > 0 && (
        <KpiCard label="Falha no envio" value={resumo.failed} hint={KPI_HINTS.failed} alerta />
      )}
    </div>
  );
}

/**
 * ⚠️ AS ABAS SÃO LINKS, E NÃO BOTÕES. Elas trocam a URL, o servidor rebusca e a
 * página redesenha — então são navegação, e um `<button>` ali quebraria abrir em
 * nova aba, copiar o endereço e o botão "voltar".
 */
function Abas({ eventId, filtros }: { eventId: string; filtros: ResultsFilters }) {
  return (
    <nav aria-label="Seções dos resultados" className="border-border flex gap-1 border-b">
      {RESULTS_TABS.map((aba) => {
        const ativa = filtros.tab === aba;
        return (
          <Link
            key={aba}
            // Trocar de aba zera busca, filtro e página: os filtros de uma não
            // fazem sentido na outra, e levá-los junto daria uma lista vazia
            // sem explicação.
            href={eventResultsHref(eventId, { tab: aba, query: "", filter: "all", page: 1 })}
            aria-current={ativa ? "page" : undefined}
            className={`rounded-t-md px-4 py-2 text-sm transition-colors ${
              ativa
                ? "border-primary text-primary-strong border-b-2 font-medium"
                : "text-muted-foreground hover:text-foreground border-b-2 border-transparent"
            }`}
          >
            {RESULTS_TAB_LABELS[aba]}
          </Link>
        );
      })}
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* Aba 1 — o painel (§7 a §12, §33)                                            */
/* -------------------------------------------------------------------------- */

async function AbaPainel({ eventId, resumo }: { eventId: string; resumo: ResultsSummary }) {
  const blocos = await getResultsQuestions(eventId);

  if (blocos.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground text-sm">
            As respostas existem, mas o formulário que elas responderam não pôde ser carregado.
            Avise quem cuida do sistema.
          </p>
        </CardContent>
      </Card>
    );
  }

  // §11. A avaliação geral vem primeiro e com destaque próprio — ela é a
  // resposta à pergunta "o evento foi bom?", e procurá-la no meio de cinco
  // blocos seria pedir que quem lê já soubesse onde ela está.
  const geral = blocos
    .flatMap((bloco) => bloco.questions.map((q) => ({ bloco, q })))
    .find((item) => item.q.isOverall);

  return (
    <div className="space-y-4">
      {geral && (
        <Card className="border-primary/40">
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h2 className="font-semibold tracking-tight">Avaliação geral</h2>
                <p className="text-muted-foreground text-sm">{geral.q.prompt}</p>
              </div>
              <p className="text-primary-strong text-3xl font-semibold tabular-nums">
                {formatAverage(geral.q.average)}
                <span className="text-muted-foreground text-base font-normal">
                  {" / "}
                  {/* ⚠️ O TETO VEM DAS OPÇÕES (§10). A primeira versão tinha um
                      `5` como piso do `Math.max` — e uma escala de 0 a 3
                      apareceria como "2,4 / 5". É a mesma `ratingScaleMax` que
                      as barras do resto do painel já usavam. */}
                  {ratingScaleMax(geral.q)}
                </span>
              </p>
            </div>
            <p className="text-muted-foreground text-xs tabular-nums">
              {geral.q.answers} {geral.q.answers === 1 ? "resposta" : "respostas"}
            </p>
            {/* O MESMO componente de distribuição do resto do painel — o
                destaque muda a moldura, e não a forma de ler o número. */}
            <DistributionBars question={geral.q} />
          </CardContent>
        </Card>
      )}

      {blocos.map((bloco) => (
        <SectionResults
          key={bloco.sectionId}
          section={bloco}
          mostrarVersao={resumo.answeredVersions > 1}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Aba 2 — as respostas e os comentários (§13 a §18)                           */
/* -------------------------------------------------------------------------- */

async function AbaRespostas({
  eventId,
  filtros,
  resumo,
}: {
  eventId: string;
  filtros: ResultsFilters;
  resumo: ResultsSummary;
}) {
  const lista = await getResultsResponses(eventId, filtros);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <ResultsFiltersBar
          eventId={eventId}
          filtros={filtros}
          // §18. Os cinco filtros de nota só aparecem quando existe uma pergunta
          // geral para filtrar. Sem ela, seriam cinco opções que não devolvem
          // nada — e o §18 proíbe aplicá-los a qualquer pergunta.
          temPerguntaGeral={resumo.hasOverallQuestion}
        />

        <p className="text-muted-foreground text-sm">
          {lista.total} {lista.total === 1 ? "resposta" : "respostas"} · {lista.withComment}{" "}
          {lista.withComment === 1 ? "com comentário" : "com comentário"}
        </p>

        {lista.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {hasActiveResultsFilters(filtros)
              ? "Nenhuma resposta encontrada com estes filtros."
              : "Ainda não existem respostas para este evento."}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Respostas recebidas, das mais recentes para as mais antigas
                </caption>
                <thead className="text-muted-foreground border-border border-b text-left">
                  <tr>
                    {[
                      "Participante",
                      "Granja / Empresa",
                      "Contato",
                      "Respondida em",
                      "Nota geral",
                      "Comentário",
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
                  {lista.rows.map((linha) => (
                    <LinhaDeResposta
                      key={linha.participantEvaluationId}
                      row={linha}
                      eventId={eventId}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={lista.page}
              pageSize={RESULTS_PAGE_SIZE}
              total={lista.total}
              href={(alvo) => eventResultsHref(eventId, { ...filtros, page: alvo })}
              label="Paginação das respostas"
              noun={["resposta", "respostas"]}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LinhaDeResposta({ row, eventId }: { row: ResultsResponseRow; eventId: string }) {
  return (
    <tr className="border-border hover:bg-muted/50 border-b align-top last:border-0">
      <td className="max-w-48 px-4 py-3">
        <Link
          href={responseDetailHref(eventId, row.participantEvaluationId)}
          className="text-primary-strong block truncate hover:underline"
        >
          {row.fullName}
        </Link>
      </td>

      <td className="max-w-40 truncate px-4 py-3">{row.companyName}</td>

      <td className="text-muted-foreground max-w-44 px-4 py-3 text-xs">
        <span className="block truncate">{row.email}</span>
        {row.whatsapp && <span className="block truncate">{row.whatsapp}</span>}
      </td>

      <td className="text-muted-foreground px-4 py-3 text-xs whitespace-nowrap">
        {formatDateTime(row.answeredAt)}
      </td>

      <td className="px-4 py-3 whitespace-nowrap">
        {row.overallValue === null ? (
          <span className="text-muted-foreground text-xs">—</span>
        ) : (
          <Badge variant={row.overallValue >= 4 ? "done" : "attention"}>
            {row.overallValue}
            {row.overallLabel ? ` — ${row.overallLabel}` : ""}
          </Badge>
        )}
      </td>

      {/* §13. O comentário aparece na própria linha, ao lado de quem escreveu —
          a APCS optou por identificação, e separar os dois obrigaria a abrir uma
          tela por comentário para saber de quem é. */}
      <td className="max-w-72 px-4 py-3">
        {row.comment ? (
          <span className="line-clamp-3 text-xs">{row.comment}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>

      <td className="px-4 py-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={responseDetailHref(eventId, row.participantEvaluationId)}>Ver</Link>
        </Button>
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------------------- */
/* Aba 3 — quem não respondeu (§31, §32)                                       */
/* -------------------------------------------------------------------------- */

async function AbaPendentes({ eventId, filtros }: { eventId: string; filtros: ResultsFilters }) {
  const lista = await getResultsPending(eventId, filtros);
  const role = await getCurrentUserRole();
  // §32. O reenvio REUSA a permissão e a action do Prompt 2 — nada de lógica
  // nova aqui.
  const podeReenviar = hasPermission(role, "evaluations.send");

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <ResultsFiltersBar
          eventId={eventId}
          filtros={filtros}
          temPerguntaGeral={false}
          somenteBusca
        />

        <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
          <span>{lista.metrics.notCreated} ainda não gerada</span>
          <span>{lista.metrics.queued} na fila</span>
          <span>{lista.metrics.sent} enviada</span>
          <span>{lista.metrics.expired} expirada</span>
          {lista.metrics.failed > 0 && (
            <span className="text-destructive">{lista.metrics.failed} com falha</span>
          )}
        </div>

        {lista.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {hasActiveResultsFilters(filtros)
              ? "Nenhum participante encontrado com esta busca."
              : "Todo mundo que esteve presente já respondeu."}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Participantes presentes que ainda não responderam a avaliação
                </caption>
                <thead className="text-muted-foreground border-border border-b text-left">
                  <tr>
                    {[
                      "Participante",
                      "Granja / Empresa",
                      "WhatsApp",
                      "Situação",
                      "Enviada em",
                      "Prazo",
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
                  {lista.rows.map((linha) => (
                    <LinhaPendente
                      key={linha.participantId}
                      row={linha}
                      eventId={eventId}
                      podeReenviar={podeReenviar}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={lista.page}
              pageSize={RESULTS_PAGE_SIZE}
              total={lista.total}
              href={(alvo) => eventResultsHref(eventId, { ...filtros, page: alvo })}
              label="Paginação dos pendentes"
              noun={["participante", "participantes"]}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LinhaPendente({
  row,
  eventId,
  podeReenviar,
}: {
  row: ResultsPendingRow;
  eventId: string;
  podeReenviar: boolean;
}) {
  /**
   * §29 do Prompt 3 + §15/§28 do Prompt 4. A situação vem do enum do Prompt 2;
   * `not_created` é a ausência de linha ganhando nome, e `retry_exhausted` é a
   * linha que continua agendada mas que o worker não pega mais. Nenhum dos dois
   * é valor de enum — os dois são LEITURA. Ver `pendingStage`.
   */
  const situacao = pendingStage({
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
  }) as keyof typeof PENDING_STATUS_LABELS;

  return (
    <tr className="border-border hover:bg-muted/50 border-b align-middle last:border-0">
      <td className="max-w-48 px-4 py-3">
        <span className="block truncate">{row.fullName}</span>
        <span className="text-muted-foreground block truncate text-xs">{row.email}</span>
      </td>

      <td className="max-w-40 truncate px-4 py-3">{row.companyName}</td>

      <td className="text-muted-foreground px-4 py-3 text-xs whitespace-nowrap">
        {row.whatsapp ?? row.phone ?? "—"}
      </td>

      <td className="px-4 py-3">
        {/* ⚠️ "Falha no envio" é o único selo de alerta desta coluna. Ele diz
            que aquela linha PAROU — e é a diferença entre esperar e agir. */}
        <Badge
          variant={
            situacao === "retry_exhausted" ? "alert" : situacao === "expired" ? "done" : "default"
          }
        >
          {PENDING_STATUS_LABELS[situacao]}
        </Badge>
        {/* ⚠️ O MOTIVO DA FALHA APARECE AQUI, e é o que torna o reenvio útil:
            "telefone inválido" pede corrigir o cadastro; um erro do fornecedor
            pede só tentar de novo. Sem o motivo, os dois viram o mesmo clique. */}
        {row.lastError && (
          <span className="text-destructive mt-1 block max-w-56 truncate text-xs">
            {row.lastError}
          </span>
        )}
      </td>

      <td className="text-muted-foreground px-4 py-3 text-xs whitespace-nowrap">
        {row.sentAt ? formatDateTime(row.sentAt) : "—"}
      </td>

      <td className="text-muted-foreground px-4 py-3 text-xs whitespace-nowrap">
        {row.expiresAt ? formatDateTime(row.expiresAt) : "sem prazo"}
      </td>

      <td className="px-4 py-3">
        <PendingActions
          eventId={eventId}
          participantEvaluationId={row.participantEvaluationId}
          status={row.status}
          canSend={podeReenviar}
        />
      </td>
    </tr>
  );
}
