import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listEventsWithoutLandingPage } from "@/lib/services/event-landing";
import { Card, CardContent } from "@/components/ui/card";
import { NewLandingForm } from "./new-landing-form";

export const metadata: Metadata = { title: "Criar Landing Page" };

/**
 * Passo 1 da criação: escolher o evento (§5).
 *
 * ⚠️ EXIGE `events.write`, e não `events.read`. Esta tela CRIA — quem só
 * consulta a agenda não chega aqui. A RLS de `event_landing_pages` e o
 * `raise 42501` de `create_event_landing_page` são as outras duas camadas.
 */
export default async function NewLandingPage() {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "events.write")) redirect("/events/landing-pages");

  const events = await listEventsWithoutLandingPage();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/events/landing-pages"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Landing Pages
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Criar Landing Page</h1>
        <p className="text-muted-foreground text-sm">
          Cada evento tem uma página de inscrição. Escolha o evento para começar — o resto se
          configura no passo seguinte.
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          <NewLandingForm events={events} />
        </CardContent>
      </Card>
    </div>
  );
}
