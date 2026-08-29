import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { ROLE_LABELS } from "@/lib/rbac/rbac.types";
import { countActiveAdmins, getAdminUser, listAdminAudit } from "@/lib/services/admin";
import { formatDateTime } from "@/lib/utils";
import { ADMIN_AUDIT_ACTION_LABELS, ROLE_DESCRIPTIONS } from "@/modules/admin/admin.labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserRoleSelect } from "../user-role-select";
import { UserEditForm } from "./user-edit-form";
import { UserAccessActions } from "./user-access-actions";

export const metadata: Metadata = { title: "Usuário" };

/**
 * O CADASTRO DE UMA PESSOA COM ACESSO.
 *
 * ⚠️ TRÊS CARTÕES, E A SEPARAÇÃO NÃO É ESTÉTICA. Editar o nome, trocar o papel
 * e desligar a conta têm consequências de tamanhos muito diferentes, e travas
 * de banco diferentes. Um formulão com tudo junto faria "corrigi um sobrenome"
 * ser recusado por uma regra sobre administradores — e a pessoa não saberia
 * qual campo causou.
 *
 * ⚠️ NÃO EXISTE EXCLUIR, aqui nem na lista. Apagar de `auth.users` derruba o
 * perfil junto (cascade) e deixa a trilha de todos os módulos apontando para
 * ninguém. Inativar tira o acesso e preserva o histórico — é o que a coluna
 * `profiles.active` existe para fazer.
 */
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "users.manage")) redirect("/dashboard");

  const { id } = await params;
  const usuario = await getAdminUser(id);
  if (!usuario) notFound();

  // ⚠️ A TRILHA É BUSCADA PELO E-MAIL ATUAL. Linhas gravadas antes de uma troca
  // de endereço ficaram com o antigo e não aparecem aqui — está dito na tela,
  // porque um histórico que parece completo e não é engana mais que um vazio.
  const [admins, trilha] = await Promise.all([
    countActiveAdmins(),
    listAdminAudit(20, usuario.email),
  ]);

  const ultimoAdmin = usuario.role === "admin" && usuario.active && admins <= 1;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/users"
          className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Usuários
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {usuario.fullName ?? "Sem nome"}
          </h1>
          {usuario.isSelf && <Badge>você</Badge>}
          {!usuario.active && <Badge variant="alert">Conta inativa</Badge>}
        </div>
        <p className="text-muted-foreground text-sm">
          {usuario.email} · {ROLE_LABELS[usuario.role]} · no sistema desde{" "}
          {formatDateTime(usuario.createdAt)}
        </p>
      </div>

      {!usuario.active && (
        <div className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-4 py-3 text-sm">
          Esta conta está desligada: a pessoa não entra no sistema e não lê nada, mesmo que tenha
          uma aba aberta. O cadastro e o histórico dela continuam aqui.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cadastro</CardTitle>
          </CardHeader>
          <CardContent>
            <UserEditForm
              userId={usuario.id}
              fullName={usuario.fullName ?? ""}
              email={usuario.email}
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Papel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <UserRoleSelect
                userId={usuario.id}
                role={usuario.role}
                locked={usuario.isSelf || ultimoAdmin}
              />
              <p className="text-muted-foreground text-sm">{ROLE_DESCRIPTIONS[usuario.role]}</p>
              {ultimoAdmin && (
                <p className="text-muted-foreground text-xs">
                  É o único administrador ativo. Promova outra pessoa antes de mudar isto.
                </p>
              )}
              <p className="text-xs">
                <Link href="/permissions" className="text-primary-strong hover:underline">
                  Ver o que cada papel pode fazer
                </Link>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Acesso</CardTitle>
            </CardHeader>
            <CardContent>
              <UserAccessActions
                userId={usuario.id}
                email={usuario.email}
                active={usuario.active}
                isSelf={usuario.isSelf}
                lastActiveAdmin={ultimoAdmin}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Histórico desta conta</CardTitle>
        </CardHeader>
        <CardContent>
          {trilha.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nada registrado para {usuario.email}.</p>
          ) : (
            <ol className="space-y-3 text-sm">
              {trilha.map((entrada) => (
                <li key={entrada.id}>
                  <p>{ADMIN_AUDIT_ACTION_LABELS[entrada.action]}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatDateTime(entrada.createdAt)}
                    {entrada.actorName ? ` · ${entrada.actorName}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <p className="text-muted-foreground mt-4 text-xs">
            O histórico é buscado pelo e-mail atual. Se o endereço já foi trocado, o que aconteceu
            antes está registrado sob o endereço antigo.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
