import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { getSiteOrigin } from "@/lib/http/site-url";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getLandingPage, getRegistrationSuccessDefaults } from "@/lib/services/event-landing";
import { LandingBuilder } from "./landing-builder";

export const metadata: Metadata = { title: "Landing Page" };

/**
 * O Builder de uma Landing Page (§6).
 *
 * ⚠️ ABRE PARA QUEM SÓ LÊ, e é decisão. `events.read` entra; `events.write`
 * edita. O Atendente precisa consultar o que a página diz para responder a quem
 * pergunta — e uma tela de leitura separada seria uma segunda cópia do mesmo
 * layout, que divergiria da primeira. Os campos vêm desabilitados e os botões
 * de ação não são renderizados.
 *
 * ⚠️ A ORIGEM É RESOLVIDA NO SERVIDOR (§27). `getSiteOrigin()` respeita
 * `NEXT_PUBLIC_SITE_URL` antes de qualquer coisa vinda da requisição — montar a
 * URL no navegador com `window.location.origin` daria o endereço da prévia da
 * Vercel, que morre no dia seguinte.
 */
export default async function LandingBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "events.read")) redirect("/dashboard");

  const { id } = await params;

  // As três leituras são independentes: uma ida ao servidor em vez de três em
  // fila. A da página é a única que pode faltar.
  const [page, successDefaults, origin] = await Promise.all([
    getLandingPage(id),
    getRegistrationSuccessDefaults(),
    getSiteOrigin(),
  ]);

  if (!page) notFound();

  return (
    <LandingBuilder
      page={page}
      origin={origin}
      successDefaults={successDefaults}
      canWrite={hasPermission(role, "events.write")}
    />
  );
}
