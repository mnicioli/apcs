import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, ExternalLink, Pencil } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  countEventAudience,
  getEvent,
  getLatestEventDispatch,
  listEventAuditLogs,
  type EventDispatchSummary,
} from "@/lib/services/events";
import { formatCalendarDate, formatDateTime, todayInSaoPaulo } from "@/lib/utils";
import {
  auditFieldLabel,
  EVENT_AUDIT_ACTION_LABELS,
  EVENT_STATUS_LABELS,
  EVENT_STATUS_REASON_LABELS,
} from "@/modules/event/event.labels";
import { effectiveStatus, formatTime, statusReason } from "@/modules/event/event.rules";
import type { EventAuditEntry, EventFieldChange } from "@/modules/event/event.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EventStatusActions } from "../event-status-actions";
import { EventDispatchButton } from "../event-dispatch-button";
import { SignedImage } from "@/components/ui/signed-image";
import { STATUS_BADGE_VARIANT } from "../event-badges";

export const metadata: Metadata = { title: "Evento" };

/**
 * Detalhes de um evento.
 *
 * É página e não modal porque segue o padrão do projeto (`/leads/[id]`,
 * `/attendances/[id]`): dá para mandar o link para alguém, sobrevive ao F5 e não
 * precisa buscar dados no cliente.
 *
 * A trilha de auditoria só é montada para quem tem `events.write`. A RLS de
 * `event_audit_logs` já barra os demais, mas ela devolve LISTA VAZIA sem erro —
 * então, sem esta checagem, um Atendente veria a seção com "nenhum registro",
 * que é informação errada.
 */
export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; updated?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "events.read")) redirect("/dashboard");

  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();

  const canWrite = hasPermission(role, "events.write");
  const audit = canWrite ? await listEventAuditLogs(event.id) : [];

  const today = todayInSaoPaulo();
  const effective = effectiveStatus(event, today);
  const reason = statusReason(event, today);

  // ⚠️ SÓ CALCULA A AUDIÊNCIA QUANDO O BOTÃO PODE APARECER. Um evento vencido
  // ou inativo não divulga (`start_event_dispatch` recusa), e varrer `members`
  // para desenhar um botão que não existe seria trabalho por nada em toda
  // abertura de evento antigo.
  const podeDivulgar = canWrite && effective === "active";
  const [audience, lastDispatch] = podeDivulgar
    ? await Promise.all([countEventAudience(event.id), getLatestEventDispatch(event.id)])
    : [null, null];

  const { created, updated } = await searchParams;
  const successMessage = created
    ? "Evento cadastrado com sucesso."
    : updated
      ? "Evento atualizado com sucesso."
      : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/events"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para os eventos
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{event.name}</h1>

          {canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline">
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
                size="default"
              />
              {podeDivulgar && audience && (
                <EventDispatchButton
                  eventId={event.id}
                  eventName={event.name}
                  segmentNames={event.segments.map((s) => s.name)}
                  audience={audience}
                  remaining={lastDispatch?.remaining ?? 0}
                  size="default"
                />
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_BADGE_VARIANT[effective]}>{EVENT_STATUS_LABELS[effective]}</Badge>
          {reason && (
            <span className="text-muted-foreground text-sm">
              {EVENT_STATUS_REASON_LABELS[reason]}
            </span>
          )}
        </div>
      </div>

      {/* Confirmação depois de salvar. Vive na URL porque a navegação acontece
          entre duas telas — o CRM não tem sistema de toast, e inventar um para
          uma mensagem seria criar um padrão novo só para este módulo. */}
      {successMessage && (
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="text-primary-strong h-5 w-5 shrink-0" aria-hidden="true" />
            <p role="status" className="text-sm">
              {successMessage}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Dados do evento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <SignedImage
              url={event.imageUrl}
              alt={event.name}
              sizes="h-56 w-full max-w-md"
              className="rounded-lg"
            />

            <dl className="grid gap-4 sm:grid-cols-2">
              <Item label="Local">{event.location}</Item>
              <Item label="Data">{formatCalendarDate(event.eventDate)}</Item>
              <Item label="Hora de início">{formatTime(event.startTime)}</Item>
              {/* Sem hora de término, o campo não aparece — um "—" só ocuparia
                  espaço para dizer que não há nada. */}
              {event.endTime && <Item label="Hora de término">{formatTime(event.endTime)}</Item>}

              {event.registrationUrl && (
                <Item label="Link de inscrição" className="sm:col-span-2">
                  {/* `rel="noopener noreferrer"`: sem `noopener`, a página de
                      destino recebe `window.opener` e pode redirecionar esta
                      aba. O protocolo já foi restrito a http/https no Zod e no
                      CHECK da tabela. */}
                  <a
                    href={event.registrationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-strong inline-flex items-center gap-1 break-all hover:underline"
                  >
                    {event.registrationUrl}
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </a>
                </Item>
              )}
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Público-alvo</CardTitle>
              <CardDescription>Quem poderá receber informações sobre este evento.</CardDescription>
            </CardHeader>
            <CardContent>
              {event.segments.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nenhum público definido.</p>
              ) : (
                <ul className="space-y-3">
                  {event.segments.map((segment) => (
                    <li key={segment.id}>
                      <p className="text-sm font-medium">{segment.name}</p>
                      {segment.description && (
                        <p className="text-muted-foreground text-sm">{segment.description}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Registro</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-4">
                <Item label="Criado em">{formatDateTime(event.createdAt)}</Item>
                <Item label="Criado por">{event.createdBy?.fullName ?? "—"}</Item>
                <Item label="Atualizado em">{formatDateTime(event.updatedAt)}</Item>
                <Item label="Atualizado por">{event.updatedBy?.fullName ?? "—"}</Item>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      {lastDispatch && <DispatchCard dispatch={lastDispatch} />}

      {canWrite && <AuditCard entries={audit} />}
    </div>
  );
}

function Item({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

/**
 * O andamento da divulgação.
 *
 * ⚠️ "PENDENTES" É UM NÚMERO DE PRIMEIRA CLASSE AQUI, e não um detalhe. Sem
 * cron neste projeto, uma divulgação grande TERMINA com gente na fila — é o
 * funcionamento normal, não uma falha. Esconder esse número faria o time achar
 * que a base inteira foi avisada quando metade não foi.
 *
 * ⚠️ "NÃO RECEBERAM (OPT-OUT)" APARECE SEPARADO DE "ERROS". Somar os dois
 * mostraria 40 falhas onde há 40 pessoas respeitadas, e alguém tentaria
 * consertar reenviando — que é exatamente o que não pode acontecer.
 */
function DispatchCard({ dispatch }: { dispatch: EventDispatchSummary }) {
  const emAndamento = dispatch.remaining > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Divulgação por WhatsApp</CardTitle>
        <CardDescription>
          Iniciada em {formatDateTime(dispatch.startedAt)}
          {dispatch.finishedAt &&
            !emAndamento &&
            ` · concluída em ${formatDateTime(dispatch.finishedAt)}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">Enviadas</dt>
            <dd className="text-lg font-semibold tabular-nums">{dispatch.totalSent}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">Pendentes</dt>
            <dd className="text-lg font-semibold tabular-nums">{dispatch.remaining}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">Erros</dt>
            <dd className="text-lg font-semibold tabular-nums">{dispatch.totalErrors}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">Não receberam</dt>
            <dd className="text-lg font-semibold tabular-nums">{dispatch.totalBlocked}</dd>
          </div>
        </dl>

        {emAndamento && (
          <p className="text-muted-foreground mt-4 text-sm">
            Ainda há {dispatch.remaining} {dispatch.remaining === 1 ? "pessoa" : "pessoas"} na fila.
            Use “Continuar divulgação” para retomar de onde parou.
          </p>
        )}

        {dispatch.lastError && (
          <p role="alert" className="text-destructive mt-4 text-sm">
            {dispatch.lastError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AuditCard({ entries }: { entries: EventAuditEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Auditoria</CardTitle>
        <CardDescription>
          Da mais recente para a mais antiga. A trilha não é editável nem apagável — nem por
          administrador.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum registro de auditoria.</p>
        ) : (
          <ol className="space-y-5">
            {entries.map((entry) => (
              <li key={entry.id} className="border-border border-l-2 pl-4">
                <p className="text-sm font-medium">{EVENT_AUDIT_ACTION_LABELS[entry.action]}</p>
                <p className="text-muted-foreground text-xs">
                  {formatDateTime(entry.createdAt)} · {entry.actor?.fullName ?? "Usuário removido"}
                </p>
                <AuditDetail entry={entry} />
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** Os detalhes de uma entrada — o que muda por tipo de ação. */
function AuditDetail({ entry }: { entry: EventAuditEntry }) {
  if (entry.action === "event_updated") {
    const changes = entry.metadata.changes;
    if (!Array.isArray(changes) || changes.length === 0) return null;

    return (
      <dl className="mt-2 space-y-1">
        {(changes as EventFieldChange[]).map((change) => (
          <div key={change.field} className="flex flex-wrap gap-x-2 text-sm">
            <dt className="text-muted-foreground">{auditFieldLabel(change.field)}:</dt>
            <dd className="text-muted-foreground line-through">{auditValue(change.from)}</dd>
            <dd aria-hidden="true">→</dd>
            <dd>{auditValue(change.to)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  if (entry.action === "event_deactivated" && typeof entry.metadata.reason === "string") {
    return (
      <p className="text-muted-foreground mt-2 text-sm">
        Motivo: {entry.metadata.reason === "manual" ? "Inativação manual" : entry.metadata.reason}
      </p>
    );
  }

  return null;
}

/**
 * Formata um valor da trilha para leitura.
 *
 * Datas e horários são gravados como o Postgres os devolve ("2026-08-20",
 * "14:00:00"); quem lê a auditoria espera "20/08/2026" e "14:00". Vazio vira
 * "(vazio)" em vez de sumir: "Link: → https://..." esconderia que o campo
 * estava em branco antes.
 */
function auditValue(value: string | null): string {
  if (value === null || value === "") return "(vazio)";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatCalendarDate(value);
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return formatTime(value);
  return value;
}
