import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listMembers } from "@/lib/services/membership";
import { formatCalendarDate } from "@/lib/utils";
import {
  MEMBERSHIP_MODULE_SUBTITLE,
  MEMBERSHIP_MODULE_TITLE,
  MEMBERSHIP_PROFILE_TYPE_LABELS,
  MEMBER_ORIGIN_LABELS,
  MEMBER_STATUS_LABELS,
} from "@/modules/membership/membership.labels";
import {
  APPLICATIONS_BASE,
  MEMBERS_BASE,
  listHref,
  parseMemberParams,
  type RawSearchParams,
} from "@/modules/membership/membership.routes";
import { MEMBER_STATUSES } from "@/modules/membership/membership.types";
import { formatWhatsapp } from "@/modules/membership/membership.schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MEMBER_BADGE_VARIANT } from "./membership-badges";

export const metadata: Metadata = { title: MEMBERSHIP_MODULE_TITLE };

/**
 * O REGISTRO de associados — a fonte única da verdade de quem a APCS reconhece.
 *
 * ⚠️ ESTA TELA É SÓ DE LEITURA, E ISSO É O ESTADO ATUAL, NÃO O DESENHO FINAL.
 * Hoje um associado nasce de uma solicitação aprovada. Faltam duas coisas, e
 * nenhuma delas está escondida:
 *
 *   • A CARGA DOS ASSOCIADOS QUE JÁ EXISTEM. A tabela já está pronta para
 *     recebê-la (`origin = 'import'`, `external_id`, `joined_at`); a importação
 *     em si é trabalho combinado para um segundo momento. Ver o bloco
 *     "SOBRE A CARGA" em supabase/migrations/20260821000000_create_membership.sql.
 *   • Edição de cadastro pelo CRM. Enquanto a carga não define o formato final
 *     do registro, um formulário de edição seria construído contra um alvo que
 *     ainda vai se mexer.
 *
 * O aviso abaixo diz isso na tela. Uma lista vazia sem explicação faria alguém
 * concluir que o sistema perdeu os associados.
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "members.read")) redirect("/dashboard");

  const params = parseMemberParams(await searchParams);
  const pagina = await listMembers({
    status: params.status,
    search: params.search,
    page: params.page,
  });

  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.pageSize));
  const abas = [
    { valor: "all" as const, rotulo: "Todos" },
    ...MEMBER_STATUSES.map((status) => ({ valor: status, rotulo: MEMBER_STATUS_LABELS[status] })),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{MEMBERSHIP_MODULE_TITLE}</h1>
          <p className="text-muted-foreground text-sm">{MEMBERSHIP_MODULE_SUBTITLE}</p>
        </div>
        <Button variant="outline" asChild>
          <Link href={APPLICATIONS_BASE}>Ver solicitações</Link>
        </Button>
      </div>

      <div className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-4 py-3 text-sm">
        A carga dos associados já cadastrados ainda não foi feita — por enquanto, esta lista traz
        apenas quem entrou pelas solicitações do site.
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <nav aria-label="Filtrar por situação" className="flex flex-wrap gap-2">
          {abas.map((aba) => {
            const ativa = params.status === aba.valor;
            return (
              <Link
                key={aba.valor}
                href={listHref(MEMBERS_BASE, params, { status: aba.valor })}
                aria-current={ativa ? "page" : undefined}
                className={
                  ativa
                    ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium"
                    : "text-muted-foreground hover:bg-muted rounded-md px-3 py-1.5 text-sm transition-colors"
                }
              >
                {aba.rotulo}
              </Link>
            );
          })}
        </nav>

        <form method="get" action={MEMBERS_BASE} className="flex items-end gap-2">
          {params.status !== "all" && <input type="hidden" name="status" value={params.status} />}
          <div className="space-y-1.5">
            <Label htmlFor="q">Buscar</Label>
            <Input
              id="q"
              name="q"
              type="search"
              defaultValue={params.search}
              placeholder="Nome, e-mail, código ou telefone"
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
            <p className="font-medium">Nenhum associado encontrado.</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {params.search || params.status !== "all"
                ? "Tente outro termo ou volte para “Todos”."
                : "Aprovar uma solicitação cria o associado aqui."}
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
                    <th className="px-4 py-3 font-medium">Nome</th>
                    <th className="px-4 py-3 font-medium">Perfil</th>
                    <th className="px-4 py-3 font-medium">Contato</th>
                    <th className="px-4 py-3 font-medium">Cidade</th>
                    <th className="px-4 py-3 font-medium">Associado desde</th>
                    <th className="px-4 py-3 font-medium">Origem</th>
                    <th className="px-4 py-3 font-medium">Notificações</th>
                    <th className="px-4 py-3 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.rows.map((membro) => (
                    <tr
                      key={membro.id}
                      className="border-border hover:bg-muted/50 border-b last:border-0"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium">{membro.fullName}</span>
                        {membro.code && (
                          <span className="text-muted-foreground block font-mono text-xs">
                            {membro.code}
                          </span>
                        )}
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {membro.profileType
                          ? MEMBERSHIP_PROFILE_TYPE_LABELS[membro.profileType]
                          : "—"}
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {membro.email ?? "—"}
                        {membro.whatsapp && (
                          <span className="block text-xs">{formatWhatsapp(membro.whatsapp)}</span>
                        )}
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {membro.city ? `${membro.city}/${membro.state ?? ""}` : "—"}
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {membro.joinedAt ? formatCalendarDate(membro.joinedAt) : "—"}
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {MEMBER_ORIGIN_LABELS[membro.origin]}
                      </td>
                      {/*
                        ⚠️ TRÊS ESTADOS, e não dois. "Recebe" e "Não recebe" não
                        cobrem quem não tem WhatsApp cadastrado — essa pessoa não
                        pediu para sair, mas também não vai receber nada. Mostrá-la
                        como "Recebe" faria o time contar com um alcance que não
                        existe.
                      */}
                      <td className="px-4 py-3">
                        {!membro.whatsapp ? (
                          <span className="text-muted-foreground text-xs">Sem WhatsApp</span>
                        ) : membro.optedOut ? (
                          <Badge variant="alert">Não recebe</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">Recebe</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={MEMBER_BADGE_VARIANT[membro.status]}>
                          {MEMBER_STATUS_LABELS[membro.status]}
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
            Página {pagina.page} de {totalPaginas} · {pagina.total} associados
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild disabled={pagina.page <= 1}>
              <Link href={listHref(MEMBERS_BASE, params, { page: Math.max(1, pagina.page - 1) })}>
                Anterior
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild disabled={pagina.page >= totalPaginas}>
              <Link
                href={listHref(MEMBERS_BASE, params, {
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
