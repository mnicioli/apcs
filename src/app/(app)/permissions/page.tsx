import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Minus } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission, PERMISSION_MATRIX } from "@/lib/rbac/rbac.config";
import {
  PERMISSION_GROUPS,
  PERMISSION_GROUP_NOTES,
  PERMISSION_LABELS,
  type PermissionGroup,
} from "@/lib/rbac/rbac.labels";
import { ROLE_LABELS, VALID_ROLES, type Role } from "@/lib/rbac/rbac.types";
import { listUsers } from "@/lib/services/admin";
import { ROLE_DESCRIPTIONS } from "@/modules/admin/admin.labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Matriz de Acesso" };

/**
 * O QUE CADA PAPEL PODE FAZER — a matriz inteira, numa tela.
 *
 * ⚠️ ELA É SÓ LEITURA, E ISSO É UMA DECISÃO, NÃO UMA ETAPA QUE FALTOU.
 *
 * O acesso neste sistema é decidido em DUAS camadas que precisam contar a mesma
 * história: `PERMISSION_MATRIX` (o que a tela mostra e deixa clicar) e as
 * policies RLS de cada tabela no Postgres (o que o banco entrega, mesmo para
 * quem chamar a API por fora). Uma caixinha clicável aqui mexeria só na
 * primeira — e o resultado seria pior que não ter a tela: a matriz diria
 * "Atendente não vê Financeiro" enquanto o banco continuaria entregando, e
 * ninguém desconfiaria, porque a tela mostra o contrário.
 *
 * Tornar isto editável de verdade é um projeto, não um botão: as permissões
 * teriam de sair do código para uma tabela, e cada policy do banco teria de
 * passar a consultá-la. Enquanto isso não acontecer, mudar acesso é mexer em
 * `rbac.config.ts` MAIS a migration da tabela — e esta tela é a conferência de
 * que as duas concordam.
 *
 * ⚠️ A CONTAGEM DE PESSOAS POR PAPEL não é enfeite. "Quem pode publicar um
 * evento?" tem duas respostas — quais papéis, e quantas pessoas os têm hoje. A
 * segunda é a que importa quando ninguém está conseguindo publicar.
 */
export default async function PermissionsPage() {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "users.manage")) redirect("/dashboard");

  const usuarios = await listUsers();

  // Só contas ATIVAS: um papel com três pessoas, todas desligadas, tem zero
  // pessoas para o que esta tela responde.
  const porPapel = new Map<Role, number>(VALID_ROLES.map((papel) => [papel, 0]));
  for (const usuario of usuarios) {
    if (usuario.active) porPapel.set(usuario.role, (porPapel.get(usuario.role) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Matriz de Acesso</h1>
        <p className="text-muted-foreground text-sm">
          O que cada papel pode fazer em cada módulo. Para mudar o papel de alguém, vá em{" "}
          <Link href="/users" className="text-primary-strong hover:underline">
            Usuários
          </Link>
          .
        </p>
      </div>

      <div className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-4 py-3 text-sm">
        Esta tela é uma <strong className="text-foreground">consulta</strong>. O acesso é decidido
        no código e repetido nas regras do banco — as duas camadas precisam concordar, e uma
        caixinha clicável aqui mexeria só em uma delas. Para alterar de verdade, peça a mudança a
        quem mantém o sistema.
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-border border-b">
                  <th className="bg-card sticky left-0 px-4 py-3 text-left font-medium">
                    O que a pessoa pode fazer
                  </th>
                  {VALID_ROLES.map((papel) => {
                    const quantos = porPapel.get(papel) ?? 0;
                    return (
                      <th key={papel} className="px-3 py-3 text-center font-medium">
                        <span className="block">{ROLE_LABELS[papel]}</span>
                        <span
                          className="text-muted-foreground block text-xs font-normal"
                          title={ROLE_DESCRIPTIONS[papel]}
                        >
                          {quantos === 0
                            ? "ninguém"
                            : quantos === 1
                              ? "1 pessoa"
                              : `${quantos} pessoas`}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_GROUPS.map((grupo) => (
                  <GrupoDeLinhas key={grupo.title} grupo={grupo} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Os papéis, em uma frase</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-border divide-y text-sm">
            {VALID_ROLES.map((papel) => (
              <div key={papel} className="grid gap-1 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
                <dt className="font-medium">{ROLE_LABELS[papel]}</dt>
                <dd className="text-muted-foreground">{ROLE_DESCRIPTIONS[papel] ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function GrupoDeLinhas({ grupo }: { grupo: PermissionGroup }) {
  const nota = PERMISSION_GROUP_NOTES[grupo.status];

  return (
    <>
      <tr className="bg-muted/50 border-border border-y">
        <th
          colSpan={VALID_ROLES.length + 1}
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
          {VALID_ROLES.map((papel) => {
            const pode = PERMISSION_MATRIX[permissao].includes(papel);
            return (
              <td key={papel} className="px-3 py-2.5 text-center">
                {/*
                  ⚠️ O SÍMBOLO TEM TEXTO ALTERNATIVO. Uma tabela de sete colunas
                  por trinta linhas, lida por leitor de tela, precisa dizer
                  "pode" ou "não pode" em cada célula — um ícone mudo viraria
                  trinta linhas de silêncio.
                */}
                {pode ? (
                  <Check className="text-primary-strong mx-auto h-4 w-4" aria-hidden="true" />
                ) : (
                  <Minus className="text-muted-foreground/40 mx-auto h-4 w-4" aria-hidden="true" />
                )}
                <span className="sr-only">
                  {ROLE_LABELS[papel]} {pode ? "pode" : "não pode"}
                </span>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
