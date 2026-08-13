import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listEventSegments } from "@/lib/services/events";
import { todayInSaoPaulo } from "@/lib/utils";
import { EventForm } from "../event-form";

export const metadata: Metadata = { title: "Novo evento" };

/**
 * Cadastro de evento.
 *
 * Página, e não modal: são oito campos mais o cartaz e a lista de públicos.
 * Diálogo é o padrão do projeto para confirmação e formulário curto (ver
 * Documentos); formulário longo é página, como `/leads/[id]`.
 *
 * O "hoje" vem do SERVIDOR e desce como propriedade. O relógio do navegador
 * pode estar em outro fuso, e é ele que decidiria se a data é passada.
 */
export default async function NewEventPage() {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "events.write")) redirect("/events");

  const segments = await listEventSegments();

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

        <h1 className="text-2xl font-semibold tracking-tight">Novo evento</h1>
        <p className="text-muted-foreground text-sm">
          O evento nasce ativo. Enquanto a data não passar, ele fica disponível para consulta e para
          o chatbot, conforme o público-alvo escolhido.
        </p>
      </div>

      <EventForm segments={segments} today={todayInSaoPaulo()} />
    </div>
  );
}
