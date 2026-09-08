import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, Pencil, Search } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listMembers } from "@/lib/services/membership";
import { formatCalendarDate } from "@/lib/utils";
import {
  MEMBERSHIP_MODULE_SUBTITLE,
  MEMBERSHIP_MODULE_TITLE,
  MEMBERSHIP_PROFILE_TYPE_LABELS,
  MEMBER_ORIGIN_LABELS,
  MEMBER_SORT_LABELS,
  MEMBER_STATUS_LABELS,
} from "@/modules/membership/membership.labels";
import {
  APPLICATIONS_BASE,
  MEMBERS_BASE,
  listHref,
  memberHref,
  memberSortHref,
  memberSortParams,
  parseMemberParams,
  type MemberListParams,
  type RawSearchParams,
} from "@/modules/membership/membership.routes";
import { MEMBER_STATUSES, type MemberSortField } from "@/modules/membership/membership.types";
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
 * A LISTA é só de leitura; o CADASTRO se edita na ficha (`/members/[id]`), que
 * tanto o nome quanto o botão "Editar" da última coluna abrem. Edição em grade
 * seria mais rápida para trocar uma situação e péssima para todo o resto: são
 * vinte campos por associado, e a maioria não cabe numa célula.
 *
 * A ORDEM PADRÃO é alfabética (ver `DEFAULT_MEMBER_SORT`). Ordenar é NAVEGAR:
 * os cabeçalhos são links, a ordem mora na URL e o `order by` acontece no SQL —
 * ordenar em memória só acertaria a página que está na tela e mentiria sobre as
 * outras dezenove.
 *
 * ⚠️ A CARGA DOS ASSOCIADOS QUE JÁ EXISTEM AINDA NÃO FOI FEITA. A tabela está
 * pronta para recebê-la (`origin = 'import'`, `external_id`, `joined_at`); a
 * importação em si é trabalho combinado para um segundo momento. Ver o bloco
 * "SOBRE A CARGA" em supabase/migrations/20260821000000_create_membership.sql.
 *
 * O aviso abaixo diz isso na tela. Uma lista curta sem explicação faria alguém
 * concluir que o sistema perdeu os associados.
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "members.read")) redirect("/dashboard");

  const podeEditar = hasPermission(role, "members.write");

  const params = parseMemberParams(await searchParams);
  const pagina = await listMembers({
    status: params.status,
    search: params.search,
    page: params.page,
    sort: params.sort,
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
          {/* Buscar não pode desfazer a ordem escolhida — ver `memberSortParams`. */}
          {memberSortParams(params.sort).map((p) => (
            <input key={p.name} type="hidden" name={p.name} value={p.value} />
          ))}
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
                <caption className="sr-only">
                  Associados da APCS, {pagina.total} no total, ordenados por{" "}
                  {MEMBER_SORT_LABELS[params.sort.field]}
                  {params.sort.ascending ? ", de forma crescente" : ", de forma decrescente"}
                </caption>
                <thead className="border-border text-muted-foreground border-b text-left">
                  <tr>
                    <SortableTh field="name" params={params}>
                      Nome
                    </SortableTh>
                    <th className="px-4 py-3 font-medium">Perfil</th>
                    <th className="px-4 py-3 font-medium">Contato</th>
                    <th className="px-4 py-3 font-medium">Cidade</th>
                    <SortableTh field="joinedAt" params={params}>
                      Associado desde
                    </SortableTh>
                    <th className="px-4 py-3 font-medium">Origem</th>
                    <th className="px-4 py-3 font-medium">Notificações</th>
                    <th className="px-4 py-3 font-medium">Situação</th>
                    {/*
                      A coluna de ação fica ENCOSTADA À DIREITA (`w-0` + o
                      `whitespace-nowrap` da célula): sem isso a tabela dividiria
                      a sobra de largura com ela, e um botão de dez caracteres
                      ganharia o mesmo espaço que "Contato".
                    */}
                    <th className="w-0 px-4 py-3 font-medium whitespace-nowrap">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.rows.map((membro) => (
                    <tr
                      key={membro.id}
                      className="border-border hover:bg-muted/50 border-b last:border-0"
                    >
                      {/*
                        O NOME CONTINUA SENDO LINK mesmo com a coluna de ação no
                        fim da linha, e não é redundância: quem já leu o nome
                        clica ali mesmo, sem atravessar a tabela com o olho até a
                        última coluna. Os dois vão para a MESMA ficha — o botão
                        da direita é o atalho de quem varre a lista pela
                        situação, não um destino diferente.
                      */}
                      <td className="px-4 py-3">
                        <Link
                          href={memberHref(membro.id)}
                          className="font-medium hover:underline focus-visible:underline"
                        >
                          {membro.fullName}
                        </Link>
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
                      {/*
                        ⚠️ "EDITAR" SÓ PARA QUEM EDITA. `comercial` tem
                        `members.read` e não tem `members.write`: para essa
                        pessoa a ficha abre como lista de leitura, então o botão
                        diz "Abrir". Prometer "Editar" e entregar texto seria
                        mentir na altura do clique.
                      */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link
                          href={memberHref(membro.id)}
                          className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {podeEditar ? (
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {podeEditar ? "Editar" : "Abrir"}
                          {/* A tabela tem uma linha por associado e um botão por
                              linha: fora do contexto visual, "Editar" repetido
                              vinte vezes não diz editar QUEM. */}
                          <span className="sr-only">{membro.fullName}</span>
                        </Link>
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

/**
 * Cabeçalho que ordena.
 *
 * É um LINK, e não um botão com JavaScript: a ordenação acontece no SQL, então
 * mudar a ordem é NAVEGAR — e um recorte ordenado pode ser mandado por link e
 * sobrevive ao F5. Mesmo desenho do `SortableTh` de Palestras.
 *
 * ⚠️ `aria-sort` não é enfeite: sem ele, a seta diz a ordem só para quem
 * enxerga. E a coluna ativa mostra a seta do sentido ATUAL, não do que o clique
 * fará — a tabela relata o que está na tela; o que o clique faz o cursor já
 * sugere.
 */
function SortableTh({
  field,
  params,
  children,
}: {
  field: MemberSortField;
  params: MemberListParams;
  children: React.ReactNode;
}) {
  const ativo = params.sort.field === field;

  return (
    <th
      scope="col"
      aria-sort={ativo ? (params.sort.ascending ? "ascending" : "descending") : "none"}
      className="px-4 py-3 font-medium whitespace-nowrap"
    >
      <Link
        href={memberSortHref(params, field)}
        className={
          ativo
            ? "text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
            : "hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        }
      >
        {children}
        {ativo &&
          (params.sort.ascending ? (
            <ArrowUp className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden="true" />
          ))}
      </Link>
    </th>
  );
}
