import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listAdminAudit, listUsers } from "@/lib/services/admin";
import { formatDateTime } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/rbac/rbac.types";
import {
  ADMIN_AUDIT_ACTION_LABELS,
  ROLE_DESCRIPTIONS,
  USERS_SUBTITLE,
  USERS_TITLE,
} from "@/modules/admin/admin.labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteUserDialog } from "./invite-user-dialog";
import { UserRoleSelect } from "./user-role-select";

export const metadata: Metadata = { title: USERS_TITLE };

/**
 * QUEM TEM ACESSO AO SISTEMA.
 *
 * ⚠️ SÓ ADMINISTRADOR ENTRA AQUI, e isso é mais estreito que o resto do CRM de
 * propósito: um Gestor decide sobre associados, eventos e enquetes, mas quem
 * decide QUEM DECIDE é outra coisa. A matriz (`users.manage: ["admin"]`), a
 * policy de `profiles` e as funções do banco contam a mesma história.
 *
 * ⚠️ NÃO HÁ BOTÃO DE EXCLUIR, e a ausência é decisão. Apagar um usuário do
 * `auth.users` derruba junto o perfil (cascade) e deixa a trilha de auditoria
 * de todos os módulos apontando para ninguém — "aprovado por [vazio]". Quem sai
 * da APCS tem a conta INATIVADA: perde o acesso na hora, inclusive em abas já
 * abertas, e o histórico continua legível. É em `/users/[id]`.
 */
export default async function UsersPage() {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "users.manage")) redirect("/dashboard");

  const [usuarios, trilha] = await Promise.all([listUsers(), listAdminAudit(15)]);

  // ⚠️ ADMINS **ATIVOS**. Um administrador desligado não administra nada — a
  // conta dele devolve `viewer` em toda regra do banco. Contá-lo aqui faria o
  // aviso de "administrador único" sumir justamente quando ele é verdade.
  const admins = usuarios.filter((u) => u.role === "admin" && u.active).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{USERS_TITLE}</h1>
          <p className="text-muted-foreground text-sm">{USERS_SUBTITLE}</p>
        </div>
        <InviteUserDialog />
      </div>

      {/*
        ⚠️ O AVISO DO ADMINISTRADOR ÚNICO aparece ANTES de alguém tentar, e não
        como erro depois. O banco recusa rebaixar o último admin (AD001), mas
        descobrir isso no meio de uma troca de papel é descobrir tarde: a
        pessoa já decidiu o que queria fazer.
      */}
      {admins <= 1 && (
        <div className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-4 py-3 text-sm">
          Há apenas um administrador ativo no sistema. O papel dele não pode ser alterado, e a conta
          não pode ser inativada, enquanto for o único — promova outra pessoa primeiro.
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-border text-muted-foreground border-b text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Pessoa</th>
                  <th className="px-4 py-3 font-medium">Papel</th>
                  <th className="px-4 py-3 font-medium">O que pode fazer</th>
                  <th className="px-4 py-3 font-medium">Situação</th>
                  <th className="px-4 py-3 font-medium">No sistema desde</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((usuario) => (
                  <tr
                    key={usuario.id}
                    className="border-border hover:bg-muted/50 border-b last:border-0"
                  >
                    <td className="px-4 py-3">
                      {/* O nome é o caminho para o cadastro. Um botão "editar"
                          numa coluna extra seria mais um alvo para a mesma
                          ação, e a linha já tem seletor de papel. */}
                      <Link
                        href={`/users/${usuario.id}`}
                        className="hover:text-primary-strong font-medium hover:underline"
                      >
                        {usuario.fullName ?? "Sem nome"}
                      </Link>
                      {usuario.isSelf && <Badge className="ml-2">você</Badge>}
                      <span className="text-muted-foreground block text-xs">{usuario.email}</span>
                    </td>
                    <td className="px-4 py-3">
                      <UserRoleSelect
                        userId={usuario.id}
                        role={usuario.role}
                        // Quem olha não troca o próprio papel (AD002), e o
                        // último administrador não deixa de ser (AD001). O
                        // seletor some nos dois casos, em vez de oferecer um
                        // clique que só sabe dar erro.
                        locked={usuario.isSelf || (usuario.role === "admin" && admins <= 1)}
                      />
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {ROLE_DESCRIPTIONS[usuario.role] ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {usuario.active ? (
                        <Badge variant="done">Ativa</Badge>
                      ) : (
                        <Badge variant="alert">Inativa</Badge>
                      )}
                    </td>
                    <td className="text-muted-foreground px-4 py-3">
                      {formatDateTime(usuario.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico da administração</CardTitle>
        </CardHeader>
        <CardContent>
          {trilha.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nada registrado ainda. Trocas de papel, convites e mudanças de configuração aparecem
              aqui.
            </p>
          ) : (
            <ol className="space-y-3 text-sm">
              {trilha.map((entrada) => (
                <li key={entrada.id}>
                  <p>
                    {ADMIN_AUDIT_ACTION_LABELS[entrada.action]}
                    {entrada.target && (
                      <span className="text-muted-foreground"> · {entrada.target}</span>
                    )}
                  </p>
                  {entrada.action === "user_role_changed" && (
                    <p className="text-muted-foreground text-xs">
                      {rotuloPapel(entrada.metadata.from)} → {rotuloPapel(entrada.metadata.to)}
                    </p>
                  )}
                  <p className="text-muted-foreground text-xs">
                    {formatDateTime(entrada.createdAt)}
                    {entrada.actorName ? ` · ${entrada.actorName}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * O papel gravado na trilha vem de uma coluna `jsonb`, então o tipo declarado
 * não prova nada sobre o valor. Um papel que saiu do enum um dia aparece cru em
 * vez de derrubar a página — uma linha de histórico feia é melhor que uma tela
 * que não abre.
 */
function rotuloPapel(valor: unknown): string {
  if (typeof valor !== "string") return "—";
  return ROLE_LABELS[valor as keyof typeof ROLE_LABELS] ?? valor;
}
