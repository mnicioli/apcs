import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getEvent, listEventSegments } from "@/lib/services/events";
import { todayInSaoPaulo } from "@/lib/utils";
import { EventForm } from "../../event-form";

export const metadata: Metadata = { title: "Editar evento" };

/**
 * Edição de evento.
 *
 * Não há botão de excluir, e nem existe caminho para isso: o evento pode já ter
 * sido consultado pelo chatbot ou comunicado a associados, então o controle é
 * ativo/inativo. O banco impõe (`revoke delete on public.events`).
 *
 * A imagem atual aparece no preview e é MANTIDA se ninguém enviar outra — o
 * formulário só manda um caminho novo quando há arquivo novo.
 */
export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "events.write")) redirect("/events");

  const { id } = await params;
  const [event, segments] = await Promise.all([getEvent(id), listEventSegments()]);
  if (!event) notFound();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/events/${event.id}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para o evento
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight">Editar evento</h1>
        <p className="text-muted-foreground text-sm">
          Toda alteração fica registrada na auditoria, com o valor anterior e o novo.
        </p>
      </div>

      <EventForm segments={segments} today={todayInSaoPaulo()} event={event} />
    </div>
  );
}
