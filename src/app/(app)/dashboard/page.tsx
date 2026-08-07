import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser, getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getCspLeadsSummary, listRecentCspLeads } from "@/lib/services/leads";
import { formatRelativeDate } from "@/lib/utils";
import { INTEREST_LABELS, LEAD_STATUS_LABELS } from "@/modules/chat/chat.labels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Painel de abertura.
 *
 * Antes esta tela repetia, em cartões, os mesmos módulos que a barra lateral já
 * lista — inclusive os onze marcados "Em breve". Era uma segunda cópia da
 * navegação, não levava a lugar nenhum (os cartões nem eram clicáveis) e não
 * dizia nada sobre o trabalho de quem entrava. Agora abre com o que a pessoa
 * precisa saber: quantos leads esperam contato e quais chegaram por último.
 */
export default async function DashboardPage() {
  const [user, role] = await Promise.all([getCurrentUser(), getCurrentUserRole()]);
  const firstName = user?.fullName?.split(" ")[0] ?? "";
  const greeting = firstName ? `Olá, ${firstName}` : "Olá";

  // A RLS já barra quem não pode ler `csp_leads`, mas ela devolve ZERO LINHAS,
  // não um erro. Sem esta checagem, um `viewer` veria "0 leads" — que se lê como
  // "não há leads", e não como "você não tem acesso a eles".
  if (!hasPermission(role, "leads.read")) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seu acesso ainda não inclui os leads</CardTitle>
            <CardDescription>
              O acompanhamento comercial do CSP é restrito aos papéis de administração e comercial.
              Peça a um administrador para ajustar seu papel se precisar acompanhar os contatos.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const [summary, recent] = await Promise.all([getCspLeadsSummary(), listRecentCspLeads(5)]);
  const novos = summary.byStatus.new;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {summary.total === 0
            ? "Nenhum lead ainda. Assim que alguém concluir a triagem no atendimento, o contato aparece aqui."
            : novos === 0
              ? "Nenhum lead aguardando primeiro contato."
              : `${novos === 1 ? "Um lead aguarda" : `${novos} leads aguardam`} o primeiro contato.`}
        </p>
      </div>

      <section aria-label="Resumo dos leads" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Novos" value={novos} highlight />
        <SummaryTile label="Em contato" value={summary.byStatus.in_contact} />
        <SummaryTile label="Qualificados" value={summary.byStatus.qualified} />
        <SummaryTile label="Total" value={summary.total} />
      </section>

      <section aria-labelledby="leads-recentes">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="leads-recentes" className="text-base font-semibold tracking-tight">
            Leads recentes
          </h2>
          {summary.total > 0 && (
            <Link href="/leads" className="text-primary-strong text-sm hover:underline">
              Ver todos
            </Link>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            {recent.length === 0 ? (
              <p className="text-muted-foreground p-6 text-sm">
                A lista se preenche sozinha conforme as conversas do atendimento são concluídas.
              </p>
            ) : (
              <ul className="divide-border divide-y">
                {recent.map((lead) => (
                  <li key={lead.id}>
                    <Link
                      href={`/leads/${lead.id}`}
                      className="hover:bg-muted/50 flex items-center gap-4 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-primary-strong truncate text-sm font-medium">
                          {lead.fullName}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {lead.city}/{lead.state}
                        </p>
                      </div>
                      <p className="text-muted-foreground hidden w-28 shrink-0 text-sm sm:block">
                        {INTEREST_LABELS[lead.interest]}
                      </p>
                      <p className="flex w-28 shrink-0 items-center gap-1.5 text-sm">
                        {/* Só "Novo" recebe cor. Se cada status tivesse a sua,
                            nenhum se destacaria — e o olho iria para o mais
                            bonito, não para o que exige ação. */}
                        {lead.status === "new" && (
                          <span
                            aria-hidden
                            className="bg-primary h-1.5 w-1.5 shrink-0 rounded-full"
                          />
                        )}
                        {LEAD_STATUS_LABELS[lead.status]}
                      </p>
                      <p className="text-muted-foreground w-20 shrink-0 text-right text-xs">
                        {formatRelativeDate(lead.createdAt)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  /** Destaca o número quando ele pede ação. Zero nunca é destaque. */
  highlight?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p
          className={
            highlight && value > 0
              ? "text-primary-strong mt-1 text-2xl font-semibold"
              : "mt-1 text-2xl font-semibold"
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
