import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listAttendances } from "@/lib/services/attendances";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  ATTENDANCE_FILTER_LABELS,
  ATTENDANCE_REASON_LABELS,
} from "@/modules/attendance/attendance.labels";
import {
  ATTENDANCE_FILTERS,
  DEFAULT_ATTENDANCE_FILTER,
  isAttendanceFilter,
  type Attendance,
  type AttendanceFilter,
} from "@/modules/attendance/attendance.types";
import { CONVERSATION_STATUS_LABELS } from "@/modules/chat/chat.labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { reasonBadgeVariant } from "./attendance-badges";

export const metadata: Metadata = { title: "Central de Atendimento" };

/** O que dizer quando a aba está vazia — cada uma quer dizer algo diferente. */
const EMPTY_STATES: Record<AttendanceFilter, string> = {
  queued: "Nada na fila. Conversas que pedirem uma pessoa aparecem aqui automaticamente.",
  assigned: "Ninguém está com um atendimento em aberto agora.",
  resolved: "Nenhum atendimento concluído ainda.",
  all: "Nenhuma conversa registrada. A lista se preenche conforme o chat é usado.",
};

/**
 * Central de Atendimento — a fila de conversas que precisam de uma pessoa.
 *
 * A tela de leads mostra o DESFECHO das conversas que deram certo. Esta mostra
 * as que não deram: quem parou no meio da triagem, quem pediu para falar com
 * alguém, quem bateu no limite de mensagens. Antes deste módulo, nada disso
 * aparecia em lugar nenhum do sistema.
 */
export default async function AttendancesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "attendances.read")) redirect("/dashboard");

  const { filter: raw } = await searchParams;
  // Filtro desconhecido cai no padrão em vez de mostrar lista vazia: uma URL
  // colada errada não deve parecer "não há nada aqui".
  const filter = raw && isAttendanceFilter(raw) ? raw : DEFAULT_ATTENDANCE_FILTER;

  const { items, counts } = await listAttendances(filter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Central de Atendimento</h1>
        <p className="text-muted-foreground text-sm">
          Conversas do chat que dependem de alguém do time para seguir.
        </p>
      </div>

      <nav aria-label="Filtrar atendimentos" className="border-border flex gap-1 border-b">
        {ATTENDANCE_FILTERS.map((option) => {
          const isActive = option === filter;
          return (
            <Link
              key={option}
              href={`/attendances?filter=${option}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors",
                isActive
                  ? "border-primary text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {ATTENDANCE_FILTER_LABELS[option]}
              <span className="text-muted-foreground text-xs tabular-nums">{counts[option]}</span>
            </Link>
          );
        })}
      </nav>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground text-sm">{EMPTY_STATES[filter]}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {items.map((attendance) => (
                <li key={attendance.id}>
                  <AttendanceRow attendance={attendance} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AttendanceRow({ attendance }: { attendance: Attendance }) {
  const place =
    attendance.city && attendance.state ? `${attendance.city}/${attendance.state}` : null;

  return (
    <Link
      href={`/attendances/${attendance.id}`}
      className="hover:bg-muted/50 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
    >
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-primary-strong truncate text-sm font-medium">
          {/* Uma conversa pode chegar à fila antes de a pessoa dizer o nome —
              a triagem começa perguntando isso, e é justamente aí que muita
              gente desiste. */}
          {attendance.contactName ?? "Contato sem nome"}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          {place ?? CONVERSATION_STATUS_LABELS[attendance.conversationStatus]}
        </p>
      </div>

      {attendance.reason && (
        <Badge variant={reasonBadgeVariant(attendance.reason)}>
          {ATTENDANCE_REASON_LABELS[attendance.reason]}
        </Badge>
      )}

      <p className="text-muted-foreground w-40 shrink-0 truncate text-sm">
        {attendance.assignedTo
          ? (attendance.assignedTo.fullName ?? "Atribuído")
          : attendance.resolvedAt
            ? "Concluído"
            : ""}
      </p>

      <p className="text-muted-foreground w-24 shrink-0 text-right text-xs">
        {formatRelativeTime(attendance.lastMessageAt)}
      </p>
    </Link>
  );
}
