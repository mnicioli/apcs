import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getConversationMessages } from "@/lib/services/conversations";
import { getCspLead } from "@/lib/services/leads";
import { formatDateTime } from "@/lib/utils";
import {
  CONTACT_CHANNEL_LABELS,
  CONTACT_PROFILE_LABELS,
  CONTACT_TIME_LABELS,
  INTEREST_LABELS,
  LEAD_STATUS_LABELS,
  VOLUME_RANGE_LABELS,
} from "@/modules/chat/chat.labels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LeadStatusForm } from "./lead-status-form";

export const metadata: Metadata = { title: "Lead do CSP" };

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

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "leads.read")) redirect("/dashboard");

  const { id } = await params;
  const lead = await getCspLead(id);
  if (!lead) notFound();

  const messages = await getConversationMessages(lead.conversationId);
  const contactValue = lead.preferredChannel === "email" ? lead.email : lead.phone;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/leads"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para os leads
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{lead.fullName}</h1>
        <p className="text-muted-foreground text-sm">
          Recebido em {formatDateTime(lead.createdAt)} · {LEAD_STATUS_LABELS[lead.status]}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Triagem</CardTitle>
            <CardDescription>Dados informados pelo contato durante a conversa.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Nome" value={lead.fullName} />
              <Field label="Cidade/UF" value={`${lead.city}/${lead.state}`} />
              <Field label="Perfil" value={CONTACT_PROFILE_LABELS[lead.contactProfile]} />
              <Field label="Interesse" value={INTEREST_LABELS[lead.interest]} />
              <Field
                label="Porte"
                value={lead.volumeRange ? VOLUME_RANGE_LABELS[lead.volumeRange] : "—"}
              />
              <Field
                label="Canal"
                value={`${CONTACT_CHANNEL_LABELS[lead.preferredChannel]}${
                  contactValue ? ` — ${contactValue}` : ""
                }`}
              />
              <Field
                label="Melhor horário"
                value={lead.preferredTime ? CONTACT_TIME_LABELS[lead.preferredTime] : "—"}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Acompanhamento</CardTitle>
            <CardDescription>Registre o andamento do contato comercial.</CardDescription>
          </CardHeader>
          <CardContent>
            {hasPermission(role, "leads.write") ? (
              <LeadStatusForm
                leadId={lead.id}
                defaultStatus={lead.status}
                defaultNotes={lead.notes ?? ""}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                {lead.notes ?? "Sem observações registradas."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transcrição da conversa</CardTitle>
          <CardDescription>
            Histórico completo do atendimento automático que gerou este lead.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {messages.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma mensagem registrada.</p>
          ) : (
            messages.map((message) => (
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
