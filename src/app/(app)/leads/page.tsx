import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listCspLeads } from "@/lib/services/leads";
import { formatDateTime } from "@/lib/utils";
import {
  CONTACT_PROFILE_LABELS,
  INTEREST_LABELS,
  LEAD_STATUS_LABELS,
} from "@/modules/chat/chat.labels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Leads do CSP" };

/**
 * Lista dos leads gerados pelo fluxo CSP no chat público.
 *
 * A permissão é checada aqui (1ª camada) e a RLS de `csp_leads` filtra no banco
 * (2ª camada) — as duas contam a mesma história.
 */
export default async function LeadsPage() {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "leads.read")) redirect("/dashboard");

  const leads = await listCspLeads();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Leads do CSP</h1>
        <p className="text-muted-foreground text-sm">
          Contatos qualificados pelo atendimento automático de compras coletivas.
        </p>
      </div>

      {leads.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nenhum lead ainda</CardTitle>
            <CardDescription>
              Assim que alguém concluir a triagem em <code>/chat</code>, o contato aparece aqui.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Leads do CSP, do mais recente ao mais antigo</caption>
                <thead className="text-muted-foreground border-border border-b text-left">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Nome
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Cidade
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Perfil
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Interesse
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Recebido em
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr
                      key={lead.id}
                      className="border-border hover:bg-muted/50 border-b last:border-0"
                    >
                      <td className="px-4 py-3">
                        <Link href={`/leads/${lead.id}`} className="text-primary hover:underline">
                          {lead.fullName}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {lead.city}/{lead.state}
                      </td>
                      <td className="px-4 py-3">{CONTACT_PROFILE_LABELS[lead.contactProfile]}</td>
                      <td className="px-4 py-3">{INTEREST_LABELS[lead.interest]}</td>
                      <td className="px-4 py-3">{LEAD_STATUS_LABELS[lead.status]}</td>
                      <td className="text-muted-foreground px-4 py-3">
                        {formatDateTime(lead.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
