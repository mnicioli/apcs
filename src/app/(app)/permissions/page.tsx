import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Minus } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  PERMISSION_GROUPS,
  PERMISSION_GROUP_NOTES,
  PERMISSION_LABELS,
  type PermissionGroup,
} from "@/lib/rbac/rbac.labels";
import type { RoleDefinition } from "@/lib/rbac/rbac.runtime";
import { ROLE_LABELS, VALID_ROLES, type Permission, type Role } from "@/lib/rbac/rbac.types";
import { countActiveUsersByRole, getRoleCeilings, listRoleDefinitions } from "@/lib/services/roles";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RoleManager } from "./role-manager";

export const metadata: Metadata = { title: "Matriz de Acesso" };

/**
 * O QUE CADA CARGO PODE FAZER — a matriz inteira, numa tela, e agora editável.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ ELA ERA SÓ LEITURA, E O MOTIVO DISSO CONTINUA VALENDO PELA METADE
 * ----------------------------------------------------------------------------
 * O acesso é decidido em DUAS camadas que precisam contar a mesma história:
 * a matriz da aplicação (o que a tela mostra e deixa clicar) e as policies RLS
 * no Postgres (o que o banco entrega, inclusive a quem chamar a API por fora).
 * Uma caixinha clicável mexeria só na primeira.
 *
 * O que 20260903000100_custom_roles.sql fez foi tornar isso SEGURO NUMA
 * DIREÇÃO SÓ: um cargo se apoia num papel-base e só consegue TIRAR dele.
 *
 *   • TIRAR é honesto: a tela some, a ação recusa, e o banco continua mais
 *     largo do que a tela — a matriz é mais estreita que a RLS, nunca o
 *     contrário. É recorte de trabalho, não tranca contra alguém mal
 *     intencionado. A tela diz isso, com estas palavras, logo abaixo.
 *
 *   • ACRESCENTAR continua impossível, e é o que impede a tela de mentir. Dar
 *     "publicar evento" a um cargo cujo papel-base não publica faria o botão
 *     aparecer e o Postgres recusar o clique.
 *
 * ⚠️ A CONTAGEM DE PESSOAS POR CARGO não é enfeite. "Quem pode publicar um
 * evento?" tem duas respostas — quais cargos, e quantas pessoas os têm hoje. A
 * segunda é a que importa quando ninguém está conseguindo publicar.
 */
export default async function PermissionsPage() {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "users.manage")) redirect("/dashboard");

  const [cargos, tetos, contagem] = await Promise.all([
    listRoleDefinitions(),
    getRoleCeilings(),
    countActiveUsersByRole(),
  ]);

  // Mapas viram objetos simples para atravessar a fronteira servidor → cliente
  // sem depender de como o Next serializa estruturas.
  const tetoPorPapel: Record<string, readonly Permission[]> = Object.fromEntries(
    VALID_ROLES.map((papel: Role) => [papel, [...(tetos.get(papel) ?? [])]]),
  );
  const pessoasPorCargo: Record<string, number> = Object.fromEntries(contagem);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Matriz de Acesso</h1>
        <p className="text-muted-foreground text-sm">
          O que cada cargo pode fazer em cada módulo. Para dar um cargo a alguém, vá em{" "}
          <Link href="/users" className="text-primary-strong hover:underline">
            Usuários
          </Link>
          .
        </p>
      </div>

      {/*
        ⚠️ ESTE AVISO É PARTE DO RECURSO, e não um rodapé jurídico. Sem ele,
        "desmarquei Financeiro para essa pessoa" vira "então ela não consegue
        acessar o financeiro de jeito nenhum" — e essa conclusão está errada.
      */}
      <div className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-4 py-3 text-sm">
        Tirar uma permissão de um cargo <strong className="text-foreground">esconde a tela</strong>{" "}
        e faz o sistema recusar a ação — vale para todo mundo que usa a APCS pelo navegador. Não é
        uma tranca no banco de dados: quem tem o cargo continua tendo, lá dentro, o acesso do papel
        de que ele parte. Para trancar de verdade, a mudança é nas regras do banco — fale com quem
        mantém o sistema.
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cargos</CardTitle>
        </CardHeader>
        <CardContent>
          <RoleManager roles={cargos} ceilings={tetoPorPapel} counts={pessoasPorCargo} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-border border-b">
                  <th className="bg-card sticky left-0 px-4 py-3 text-left font-medium">
                    O que a pessoa pode fazer
                  </th>
                  {cargos.map((cargo) => {
                    const quantos = pessoasPorCargo[cargo.key] ?? 0;
                    return (
                      <th key={cargo.key} className="px-3 py-3 text-center font-medium">
                        <span className="block">{cargo.label}</span>
                        <span
                          className="text-muted-foreground block text-xs font-normal"
                          title={cargo.description ?? undefined}
                        >
                          {quantos === 0
                            ? "ninguém"
                            : quantos === 1
                              ? "1 pessoa"
                              : `${quantos} pessoas`}
                        </span>
                        {/* De qual papel o cargo parte: é o que explica por que
                            uma coluna não consegue receber certas marcas. */}
                        {!cargo.isBuiltin && (
                          <span className="text-muted-foreground block text-[11px] font-normal">
                            parte de {ROLE_LABELS[cargo.baseRole]}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_GROUPS.map((grupo) => (
                  <GrupoDeLinhas key={grupo.title} grupo={grupo} cargos={cargos} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Os cargos, em uma frase</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-border divide-y text-sm">
            {cargos.map((cargo) => (
              <div key={cargo.key} className="grid gap-1 py-2.5 sm:grid-cols-[12rem_1fr] sm:gap-4">
                <dt className="font-medium">{cargo.label}</dt>
                <dd className="text-muted-foreground">{cargo.description ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function GrupoDeLinhas({
  grupo,
  cargos,
}: {
  grupo: PermissionGroup;
  cargos: readonly RoleDefinition[];
}) {
  const nota = PERMISSION_GROUP_NOTES[grupo.status];

  return (
    <>
      <tr className="bg-muted/50 border-border border-y">
        <th
          colSpan={cargos.length + 1}
          className="px-4 py-2 text-left text-xs font-semibold tracking-wide uppercase"
        >
          <span className="inline-flex flex-wrap items-center gap-2">
            {grupo.title}
            {grupo.status === "roadmap" && <Badge>Em breve</Badge>}
            {grupo.status === "unused" && <Badge variant="done">Sem tela</Badge>}
          </span>
          {nota && (
            <span className="text-muted-foreground mt-1 block text-xs font-normal normal-case">
              {nota}
            </span>
          )}
        </th>
      </tr>

      {grupo.permissions.map((permissao) => (
        <tr key={permissao} className="border-border hover:bg-muted/30 border-b last:border-0">
          <td className="bg-card sticky left-0 px-4 py-2.5">
            {PERMISSION_LABELS[permissao]}
            {/* A chave crua fica visível: é ela que se procura no código quando
                a matriz e o comportamento discordam. */}
            <span className="text-muted-foreground block font-mono text-[11px]">{permissao}</span>
          </td>
          {cargos.map((cargo) => {
            const pode = cargo.permissions.includes(permissao);
            return (
              <td key={cargo.key} className="px-3 py-2.5 text-center">
                {/*
                  ⚠️ O SÍMBOLO TEM TEXTO ALTERNATIVO. Uma tabela de vários
                  cargos por trinta e três linhas, lida por leitor de tela,
                  precisa dizer "pode" ou "não pode" em cada célula — um ícone
                  mudo viraria trinta e três linhas de silêncio.
                */}
                {pode ? (
                  <Check className="text-primary-strong mx-auto h-4 w-4" aria-hidden="true" />
                ) : (
                  <Minus className="text-muted-foreground/40 mx-auto h-4 w-4" aria-hidden="true" />
                )}
                <span className="sr-only">
                  {cargo.label} {pode ? "pode" : "não pode"}
                </span>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
