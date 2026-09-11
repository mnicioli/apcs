import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, Send, UserCheck } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  EVALUATION_PARTICIPANT_PAGE_SIZE,
  getEvaluationDetail,
  getEvaluationParticipants,
} from "@/lib/services/event-evaluation";
import { formatCalendarDate, formatDateTime } from "@/lib/utils";
import {
  EVALUATION_STAGE_LABELS,
  EVALUATION_STAGE_VARIANTS,
  EVALUATION_STATUS_LABELS,
  EVALUATION_STATUS_VARIANTS,
} from "@/modules/event/event.evaluation.labels";
import { evaluationStage, responseRate } from "@/modules/event/event.evaluation.rules";
import {
  eventEvaluationHref,
  hasActiveEvaluationFilters,
  parseEvaluationFilters,
} from "@/modules/event/event.evaluation.routes";
import type { EvaluationParticipantRow } from "@/modules/event/event.evaluation.types";
import { formatTimeRange } from "@/modules/event/event.rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { EvaluationSettingsForm } from "./evaluation-settings-form";
import { EvaluationBuilder } from "./evaluation-builder";
import { EvaluationFiltersBar } from "./evaluation-filters";
import { ParticipantEvaluationActions } from "./participant-actions";

export const metadata: Metadata = { title: "Avaliação do evento" };

/**
 * A GESTÃO DA AVALIAÇÃO DE UM EVENTO (§21, §22, §24).
 *
 * ============================================================================
 * ⚠️ TRÊS BLOCOS NUMA TELA SÓ, E NÃO TRÊS TELAS.
 * ============================================================================
 * Configuração de envio, perguntas e andamento. Separá-los em abas ou rotas
 * pareceria mais organizado e seria pior: as três respondem à MESMA pergunta
 * operacional ("a avaliação deste evento está de pé?"), e a resposta depende
 * das três ao mesmo tempo. Com o formulário numa aba e o andamento em outra,
 * ninguém repara que o evento está habilitado e sem pergunta nenhuma.
 *
 * ============================================================================
 * ⚠️ DUAS PERMISSÕES DECIDEM O QUE APARECE.
 * ============================================================================
 *   `evaluations.read`   abre a tela — sem ela, `/dashboard`
 *   `evaluations.write`  configura e edita as perguntas
 *   `evaluations.send`   reenvia e cancela um convite
 *
 * O Atendente tem a primeira e a terceira. Para ele, o formulário aparece em
 * modo de leitura e os botões de reenvio funcionam — que é exatamente o recorte
 * de quem opera o evento sem responder pelo que a APCS pergunta.
 *
 * ⚠️ A CHECAGEM DA TELA NÃO É A QUE VALE. Ela esconde o botão; quem recusa a
 * gravação é a função do Postgres, que confere a permissão por dentro (ela é
 * SECURITY DEFINER, e DEFINER desliga a RLS).
 */
export default async function EventEvaluationPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "evaluations.read")) redirect("/dashboard");

  const { eventId } = await params;
  const filtros = parseEvaluationFilters(await searchParams);

  const detalhe = await getEvaluationDetail(eventId);
  // Evento inexistente — ou existente e barrado pela RLS. Os dois chegam aqui
  // iguais de propósito: distinguir contaria a quem está tentando que o id
  // acertado é real.
  if (!detalhe) notFound();

  const lista = await getEvaluationParticipants(eventId, filtros);

  const podeEscrever = hasPermission(role, "evaluations.write");
  const podeEnviar = hasPermission(role, "evaluations.send");

  const etapa = evaluationStage({
    enabled: detalhe.enabled,
    endTime: detalhe.endTime,
    sendAt: detalhe.sendAt,
    present: detalhe.present,
    sent: detalhe.sent,
    answered: detalhe.answered,
    // A tela de dentro não recebe `queued` da consulta de resumo; o que ela tem
    // é a lista filtrada. "Ainda há quem não recebeu" é present − sent.
    queued: Math.max(detalhe.present - detalhe.sent, 0),
  });

  const taxa = responseRate(detalhe.sent, detalhe.answered);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/events/evaluations">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Avaliações
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{detalhe.eventName}</h1>
          <Badge variant={EVALUATION_STAGE_VARIANTS[etapa]}>{EVALUATION_STAGE_LABELS[etapa]}</Badge>
          {!podeEscrever && <Badge variant="done">Somente leitura</Badge>}
        </div>

        <p className="text-muted-foreground text-sm">
          {formatCalendarDate(detalhe.eventDate)} ·{" "}
          {formatTimeRange(detalhe.startTime, detalhe.endTime)}
          {detalhe.sendAt && ` · convite em ${formatDateTime(detalhe.sendAt)}`}
        </p>
      </div>

      {/* ⚠️ O AVISO DO §10 FICA NO TOPO, e não dentro do formulário. Sem horário
          de término não há "término + atraso" a calcular, e o campo que falta é
          de OUTRA tela — quem lê precisa saber para onde ir antes de mexer em
          qualquer coisa aqui. */}
      {detalhe.endTime === null && (
        <Card>
          <CardContent className="p-4">
            <p role="alert" className="text-sm">
              Este evento não tem <strong>horário de término</strong>. A avaliação é enviada a
              partir do fim do evento, então ela não pode ser habilitada sem ele.{" "}
              <Link
                href={`/events/${detalhe.eventId}`}
                className="text-primary-strong hover:underline"
              >
                Informar o término no cadastro do evento
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador label="Presentes" valor={detalhe.present} icon="present" />
        <Indicador label="Enviadas" valor={detalhe.sent} icon="sent" />
        <Indicador label="Respondidas" valor={detalhe.answered} icon="answered" />
        <Indicador label="Taxa de resposta" valor={taxa === null ? "—" : `${taxa}%`} />
      </div>

      <EvaluationSettingsForm detail={detalhe} canWrite={podeEscrever} />

      <EvaluationBuilder detail={detalhe} canWrite={podeEscrever} />

      <Card>
        <CardHeader>
          <CardTitle>Andamento por participante</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* ⚠️ SÓ PRESENTES NESTA LISTA (§11), e o recorte está no banco. Quem
              não apareceu não é elegível; listá-lo com "—" em toda coluna faria
              a taxa de resposta parecer pior do que é. */}
          <p className="text-muted-foreground text-sm">
            Somente quem esteve <strong>presente</strong> no evento. Confirmação de inscrição não é
            critério para receber a avaliação.
          </p>

          <EvaluationFiltersBar eventId={eventId} filters={filtros} />

          {lista.rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {hasActiveEvaluationFilters(filtros)
                ? "Nenhum participante encontrado com estes filtros."
                : "Ninguém foi marcado como presente neste evento ainda."}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Participantes presentes e a situação da avaliação de cada um
                  </caption>
                  <thead className="text-muted-foreground border-border border-b text-left">
                    <tr>
                      {[
                        "Granja / Empresa",
                        "Participante",
                        "Situação",
                        "Enviada em",
                        "Respondida em",
                        "Tentativas",
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
                      <LinhaDeParticipante
                        key={linha.participantId}
                        row={linha}
                        eventId={eventId}
                        canSend={podeEnviar}
                        canWrite={podeEscrever}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination
                page={lista.page}
                pageSize={EVALUATION_PARTICIPANT_PAGE_SIZE}
                total={lista.total}
                href={(alvo) => eventEvaluationHref(eventId, { ...filtros, page: alvo })}
                label="Paginação dos participantes"
                noun={["participante", "participantes"]}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Indicador({
  label,
  valor,
  icon,
}: {
  label: string;
  valor: number | string;
  icon?: "present" | "sent" | "answered";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {icon === "present" && <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />}
          {icon === "sent" && <Send className="h-3.5 w-3.5" aria-hidden="true" />}
          {icon === "answered" && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{valor}</p>
      </CardContent>
    </Card>
  );
}

function LinhaDeParticipante({
  row,
  eventId,
  canSend,
  canWrite,
}: {
  row: EvaluationParticipantRow;
  eventId: string;
  canSend: boolean;
  canWrite: boolean;
}) {
  return (
    <tr className="border-border hover:bg-muted/50 border-b align-middle last:border-0">
      <td className="max-w-48 truncate px-4 py-3">{row.companyName}</td>

      <td className="max-w-56 px-4 py-3">
        <span className="block truncate">{row.fullName}</span>
        <span className="text-muted-foreground block truncate text-xs">{row.email}</span>
      </td>

      <td className="px-4 py-3">
        {row.status === null ? (
          // ⚠️ ESTADO PRÓPRIO, E NÃO UM TRAVESSÃO. "Ainda não gerada" significa
          // que a rotina não passou por aqui — porque o evento não terminou,
          // porque o atraso não venceu, ou porque a avaliação foi habilitada
          // depois. Um "—" faria parecer erro.
          <Badge variant="default">Ainda não gerada</Badge>
        ) : (
          <Badge variant={EVALUATION_STATUS_VARIANTS[row.status]}>
            {EVALUATION_STATUS_LABELS[row.status]}
          </Badge>
        )}
        {row.lastError && row.status !== "answered" && (
          // ⚠️ O MOTIVO DA FALHA APARECE, e é o que torna o reenvio do §17 útil:
          // "telefone inválido" pede corrigir o cadastro; um erro do fornecedor
          // pede só tentar de novo. Sem o motivo, os dois viram o mesmo clique.
          <span className="text-destructive mt-1 block max-w-56 truncate text-xs">
            {row.lastError}
          </span>
        )}
      </td>

      <td className="text-muted-foreground px-4 py-3 text-xs whitespace-nowrap">
        {row.sentAt ? formatDateTime(row.sentAt) : "—"}
      </td>

      <td className="text-muted-foreground px-4 py-3 text-xs whitespace-nowrap">
        {row.answeredAt ? formatDateTime(row.answeredAt) : "—"}
      </td>

      <td className="px-4 py-3 tabular-nums">{row.attempts}</td>

      <td className="px-4 py-3">
        <ParticipantEvaluationActions
          eventId={eventId}
          participantEvaluationId={row.participantEvaluationId}
          status={row.status}
          fullName={row.fullName}
          canSend={canSend}
          canWrite={canWrite}
        />
      </td>
    </tr>
  );
}
