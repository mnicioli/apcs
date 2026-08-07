import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getAttendance } from "@/lib/services/attendances";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";
import {
  ATTENDANCE_REASON_HINTS,
  ATTENDANCE_REASON_LABELS,
  ATTENDANCE_SITUATION_LABELS,
} from "@/modules/attendance/attendance.labels";
import type { AttendanceDetail } from "@/modules/attendance/attendance.types";
import {
  CONTACT_CHANNEL_LABELS,
  CONTACT_PROFILE_LABELS,
  CONTACT_TIME_LABELS,
  CONVERSATION_STATUS_LABELS,
  INTEREST_LABELS,
  VOLUME_RANGE_LABELS,
} from "@/modules/chat/chat.labels";
import { CSP_SLOT_LABELS } from "@/modules/chat/flows/csp.flow";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { reasonBadgeVariant, situationBadgeVariant } from "../attendance-badges";
import { AttendanceActions } from "./attendance-actions";

export const metadata: Metadata = { title: "Atendimento" };

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
        {label}
      </dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

export default async function AttendanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "attendances.read")) redirect("/dashboard");

  const { id } = await params;
  const attendance = await getAttendance(id);
  if (!attendance) notFound();

  const canWrite = hasPermission(role, "attendances.write");
  const { collected } = attendance;
  const contactValue = collected.preferredChannel === "email" ? collected.email : collected.phone;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/attendances"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para a central
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight">
          {attendance.contactName ?? "Contato sem nome"}
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={situationBadgeVariant(attendance.situation)}>
            {ATTENDANCE_SITUATION_LABELS[attendance.situation]}
          </Badge>
          {attendance.reason && (
            <Badge variant={reasonBadgeVariant(attendance.reason)}>
              {ATTENDANCE_REASON_LABELS[attendance.reason]}
            </Badge>
          )}
          <span className="text-muted-foreground text-sm">
            {CONVERSATION_STATUS_LABELS[attendance.conversationStatus]} · última mensagem{" "}
            {formatRelativeTime(attendance.lastMessageAt)}
          </span>
        </div>
      </div>

      {attendance.reason && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm">{ATTENDANCE_REASON_HINTS[attendance.reason]}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">O que a conversa coletou</CardTitle>
            <CardDescription>
              {attendance.pendingSlot ? (
                <>
                  A triagem parou em <strong>{CSP_SLOT_LABELS[attendance.pendingSlot]}</strong>.
                </>
              ) : (
                "A triagem foi até o fim."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Nome" value={collected.fullName ?? "—"} />
              <Field
                label="Cidade/UF"
                value={
                  collected.city && collected.state ? `${collected.city}/${collected.state}` : "—"
                }
              />
              <Field
                label="Perfil"
                value={
                  collected.contactProfile ? CONTACT_PROFILE_LABELS[collected.contactProfile] : "—"
                }
              />
              <Field
                label="Interesse"
                value={collected.interest ? INTEREST_LABELS[collected.interest] : "—"}
              />
              <Field
                label="Porte"
                value={collected.volumeRange ? VOLUME_RANGE_LABELS[collected.volumeRange] : "—"}
              />
              <Field
                label="Canal"
                value={
                  collected.preferredChannel
                    ? `${CONTACT_CHANNEL_LABELS[collected.preferredChannel]}${
                        contactValue ? ` — ${contactValue}` : ""
                      }`
                    : "—"
                }
              />
              <Field
                label="Melhor horário"
                value={collected.preferredTime ? CONTACT_TIME_LABELS[collected.preferredTime] : "—"}
              />
            </dl>

            <ConsentNote attendance={attendance} />

            {attendance.leadId && (
              <Link
                href={`/leads/${attendance.leadId}`}
                className="text-primary-strong inline-flex items-center gap-1 text-sm hover:underline"
              >
                Ver o lead gerado por esta conversa
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Atendimento</CardTitle>
            <CardDescription>
              {attendance.resolvedAt
                ? `Concluído em ${formatDateTime(attendance.resolvedAt)}${
                    attendance.assignedTo
                      ? ` por ${attendance.assignedTo.fullName ?? "um membro do time"}`
                      : ""
                  }.`
                : attendance.assignedTo
                  ? `Com ${attendance.assignedTo.fullName ?? "um membro do time"} desde ${formatDateTime(
                      attendance.assignedAt ?? "",
                    )}.`
                  : "Ninguém assumiu este atendimento ainda."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {canWrite ? (
              <AttendanceActions
                conversationId={attendance.id}
                isAssigned={attendance.assignedTo !== null}
                isResolved={attendance.resolvedAt !== null}
                defaultNotes={attendance.internalNotes ?? ""}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                {attendance.internalNotes ?? "Sem anotações registradas."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transcrição da conversa</CardTitle>
          <CardDescription>
            Iniciada em {formatDateTime(attendance.createdAt)}. Tudo o que o bot respondeu saiu do
            conteúdo aprovado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {attendance.messages.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma mensagem registrada.</p>
          ) : (
            attendance.messages.map((message) => (
              <div key={message.id} className="space-y-1">
                <p className="text-muted-foreground text-xs">
                  {message.role === "user" ? "Contato" : "Bot"} ·{" "}
                  {formatDateTime(message.createdAt)}
                  {message.contentKey ? ` · ${message.contentKey}` : ""}
                </p>
                <p className="text-sm whitespace-pre-line">{message.content}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Sem consentimento não há base legal para procurar a pessoa — e quem abre a
 * tela para "dar retorno" precisa ler isso antes de pegar o telefone.
 */
function ConsentNote({ attendance }: { attendance: AttendanceDetail }) {
  if (!attendance.consentGivenAt) {
    return (
      <p className="text-destructive text-sm">
        Sem consentimento registrado — não é permitido usar estes dados para entrar em contato.
      </p>
    );
  }

  return (
    <p className="text-muted-foreground text-sm">
      Consentimento registrado em {formatDateTime(attendance.consentGivenAt)}.
      {attendance.wantsHuman && " A pessoa pediu para falar com o time."}
    </p>
  );
}
