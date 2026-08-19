import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { countMembershipApplications, listMembershipApplications } from "@/lib/services/membership";
import { formatDateTime } from "@/lib/utils";
import {
  APPLICATIONS_SUBTITLE,
  APPLICATIONS_TITLE,
  MEMBERSHIP_APPLICATION_STATUS_LABELS,
  MEMBERSHIP_PROFILE_TYPE_LABELS,
} from "@/modules/membership/membership.labels";
import {
  APPLICATIONS_BASE,
  applicationHref,
  listHref,
  parseApplicationParams,
  type RawSearchParams,
} from "@/modules/membership/membership.routes";
import { MEMBERSHIP_APPLICATION_STATUSES } from "@/modules/membership/membership.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APPLICATION_BADGE_VARIANT } from "../membership-badges";

export const metadata: Metadata = { title: `${APPLICATIONS_TITLE} de associação` };

/**
 * A CAIXA DE ENTRADA das solicitações vindas de /associe-se.
 *
 * Paginada e filtrada NO SERVIDOR: filtro, busca e página viram SQL — ver
 * `listMembershipApplications`. Filtrar depois de paginar devolveria páginas
 * com buracos.
 *
 * A permissão é checada aqui (1ª camada) e a RLS filtra no banco (2ª camada). O
 * `redirect` protege a ROTA: esconder o item do menu não impede ninguém de
 * digitar o endereço.
 *
 * ⚠️ A busca é um `<form method="get">`, sem JavaScript. Numa tela de
 * backoffice que já é servidor, um campo controlado com `router.push` a cada
 * tecla seria mais código para fazer o que o navegador faz sozinho — e pararia
 * de funcionar antes da hidratação.
 */
export default async function MembershipApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "members.read")) redirect("/dashboard");

  const params = parseApplicationParams(await searchParams);
  const [pagina, contagens] = await Promise.all([
    listMembershipApplications({
      status: params.status,
      search: params.search,
      page: params.page,
    }),
    countMembershipApplications(),
  ]);

  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.pageSize));
  const abas = [
    { valor: "all" as const, rotulo: "Todas", contagem: null },
    ...MEMBERSHIP_APPLICATION_STATUSES.map((status) => ({
      valor: status,
      rotulo: MEMBERSHIP_APPLICATION_STATUS_LABELS[status],
      contagem: contagens[status],
    })),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{APPLICATIONS_TITLE}</h1>
          <p className="text-muted-foreground text-sm">{APPLICATIONS_SUBTITLE}</p>
        </div>
        <Button variant="outline" asChild>
          {/* A landing abre em aba nova: quem está triando não quer perder a
              fila para conferir como o formulário está aparecendo lá fora. */}
          <a href="/associe-se" target="_blank" rel="noreferrer noopener">
            Ver o formulário público
          </a>
        </Button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <nav aria-label="Filtrar por situação" className="flex flex-wrap gap-2">
          {abas.map((aba) => {
            const ativa = params.status === aba.valor;
            return (
              <Link
                key={aba.valor}
                href={listHref(APPLICATIONS_BASE, params, { status: aba.valor })}
                aria-current={ativa ? "page" : undefined}
                className={
                  ativa
                    ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium"
                    : "text-muted-foreground hover:bg-muted rounded-md px-3 py-1.5 text-sm transition-colors"
                }
              >
                {aba.rotulo}
                {aba.contagem !== null && (
                  <span className="ml-1.5 tabular-nums opacity-70">{aba.contagem}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <form method="get" action={APPLICATIONS_BASE} className="flex items-end gap-2">
          {/* A situação viaja junto com a busca: procurar "Silva" dentro de
              "Aguardando" tem de continuar dentro de "Aguardando". */}
          {params.status !== "all" && <input type="hidden" name="status" value={params.status} />}
          <div className="space-y-1.5">
            <Label htmlFor="q">Buscar</Label>
            <Input
              id="q"
              name="q"
              type="search"
              defaultValue={params.search}
              placeholder="Protocolo, nome, e-mail ou telefone"
              className="w-72"
            />
          </div>
          <Button type="submit" variant="outline">
            <Search className="h-4 w-4" aria-hidden="true" />
            Buscar
          </Button>
        </form>
      </div>

      {pagina.rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">Nenhuma solicitação encontrada.</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {params.search || params.status !== "all"
                ? "Tente outro termo ou volte para “Todas”."
                : "Quando alguém preencher o formulário do site, a solicitação aparece aqui."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-border text-muted-foreground border-b text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Protocolo</th>
                    <th className="px-4 py-3 font-medium">Nome</th>
                    <th className="px-4 py-3 font-medium">Perfil</th>
                    <th className="px-4 py-3 font-medium">Cidade</th>
                    <th className="px-4 py-3 font-medium">Recebida em</th>
                    <th className="px-4 py-3 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.rows.map((linha) => (
                    <tr
                      key={linha.id}
                      className="border-border hover:bg-muted/50 border-b last:border-0"
                    >
                      <td className="px-4 py-3">
                        {/* O link fica no PROTOCOLO, e não na linha inteira: uma
                            linha clicável impede selecionar o e-mail para
                            copiar, que é o que mais se faz nesta tela. */}
                        <Link
                          href={applicationHref(linha.id)}
                          className="text-primary-strong font-mono underline-offset-4 hover:underline"
                        >
                          {linha.protocol}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{linha.fullName}</span>
                        <span className="text-muted-foreground block text-xs">{linha.email}</span>
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {MEMBERSHIP_PROFILE_TYPE_LABELS[linha.profileType]}
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {linha.city}/{linha.state}
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {formatDateTime(linha.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={APPLICATION_BADGE_VARIANT[linha.status]}>
                          {MEMBERSHIP_APPLICATION_STATUS_LABELS[linha.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {totalPaginas > 1 && (
        <nav aria-label="Paginação" className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">
            Página {pagina.page} de {totalPaginas} · {pagina.total} solicitações
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild disabled={pagina.page <= 1}>
              <Link
                href={listHref(APPLICATIONS_BASE, params, { page: Math.max(1, pagina.page - 1) })}
              >
                Anterior
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild disabled={pagina.page >= totalPaginas}>
              <Link
                href={listHref(APPLICATIONS_BASE, params, {
                  page: Math.min(totalPaginas, pagina.page + 1),
                })}
              >
                Próxima
              </Link>
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
