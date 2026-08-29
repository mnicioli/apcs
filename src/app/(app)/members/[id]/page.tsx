import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getMember, listMemberAudit } from "@/lib/services/membership";
import { formatCalendarDate, formatDateTime } from "@/lib/utils";
import {
  MEMBERSHIP_AUDIT_ACTION_LABELS,
  MEMBERSHIP_FIELD_LABELS,
  MEMBERSHIP_PROFILE_TYPE_LABELS,
  MEMBER_FIELD_LABELS,
  MEMBER_ORIGIN_LABELS,
  MEMBER_STATUS_LABELS,
} from "@/modules/membership/membership.labels";
import {
  MEMBERS_BASE,
  applicationHref,
  isMembershipId,
} from "@/modules/membership/membership.routes";
import { formatCnpj, formatWhatsapp } from "@/modules/membership/membership.schema";
import type { MemberDetail } from "@/modules/membership/membership.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MEMBER_BADGE_VARIANT } from "../membership-badges";
import { MemberForm } from "./member-form";
import { MemberNotifications } from "./member-notifications";

export const metadata: Metadata = { title: "Cadastro do associado" };

/**
 * A FICHA DO ASSOCIADO — e o lugar onde o cadastro se corrige.
 *
 * ⚠️ A EDIÇÃO É A TELA, não um botão que leva a outra. Um registro de CRM
 * existe para ser corrigido: telefone que mudou, e-mail digitado errado,
 * associado que se desligou e continua "ativo". Uma ficha só de leitura com um
 * "Editar" ao lado transformaria a tarefa mais comum em dois cliques e duas
 * navegações, e faria a pessoa ler os dados duas vezes — uma na ficha, outra
 * no formulário.
 *
 * ⚠️ QUEM SÓ LÊ VÊ UMA LISTA, NÃO UM FORMULÁRIO DESABILITADO. `comercial` tem
 * `members.read` e não tem `members.write`. Campos cinzas e um botão morto
 * dizem "você poderia, mas não agora"; uma lista diz o que a tela é. E não é só
 * estética: a action e o banco recusariam a escrita de qualquer jeito, então um
 * formulário para essa pessoa só existiria para falhar.
 *
 * O que a ficha mostra e o formulário NÃO edita — origem, matrícula do sistema
 * anterior, datas do sistema — está nos cartões da direita. São fatos, não
 * opinião; ver a decisão 3 de 20260829140100_update_member.sql.
 *
 * O opt-out também fica fora do formulário, mas por outro motivo: ele não é um
 * campo do cadastro (é do TELEFONE, e pode ser compartilhado) e desfazê-lo
 * exige registrar quem pediu. Tem cartão e diálogo próprios — ver
 * `MemberNotifications` e 20260829180100_resume_notifications.sql.
 */
export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "members.read")) redirect("/dashboard");

  const { id } = await params;
  if (!isMembershipId(id)) notFound();

  const associado = await getMember(id);
  if (!associado) notFound();

  const trilha = await listMemberAudit(id);
  const podeEditar = hasPermission(role, "members.write");

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href={MEMBERS_BASE}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Associados
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{associado.fullName}</h1>
            <Badge variant={MEMBER_BADGE_VARIANT[associado.status]}>
              {MEMBER_STATUS_LABELS[associado.status]}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {associado.code && <span className="font-mono">{associado.code} · </span>}
            {associado.profileType
              ? MEMBERSHIP_PROFILE_TYPE_LABELS[associado.profileType]
              : "Perfil não definido"}{" "}
            · {MEMBER_ORIGIN_LABELS[associado.origin]}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div>
          {podeEditar ? <MemberForm member={associado} /> : <ReadOnlyMember member={associado} />}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Notificações</CardTitle>
            </CardHeader>
            <CardContent>
              <MemberNotifications
                memberId={associado.id}
                whatsapp={associado.whatsapp}
                optedOut={associado.optedOut}
                canEdit={podeEditar}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>No sistema</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-border divide-y text-sm">
                <Linha rotulo="Origem" valor={MEMBER_ORIGIN_LABELS[associado.origin]} />
                <Linha
                  rotulo="Cadastro criado em"
                  valor={formatDateTime(associado.createdAt)}
                  dica="Quando a linha entrou neste sistema — diferente de “associado desde”."
                />
                <Linha rotulo="Última alteração" valor={formatDateTime(associado.updatedAt)} />
                {associado.externalId && (
                  <Linha
                    rotulo="Id no cadastro anterior"
                    valor={associado.externalId}
                    dica="Chave da carga. Não é editável: alterá-la duplicaria o associado na próxima importação."
                  />
                )}
              </dl>

              {associado.applicationId && (
                <div className="border-border mt-4 border-t pt-4">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={applicationHref(associado.applicationId)}>
                      Ver solicitação {associado.applicationProtocol}
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {trilha.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Histórico</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3 text-sm">
                  {trilha.map((entrada) => (
                    <li key={entrada.id}>
                      <p>{MEMBERSHIP_AUDIT_ACTION_LABELS[entrada.action]}</p>
                      {/*
                        Quais campos mudaram — nunca os valores. A trilha não
                        guarda o telefone antigo de propósito; ver o bloco sobre
                        LGPD em update_member().
                      */}
                      {camposAlterados(entrada.metadata).length > 0 && (
                        <p className="text-muted-foreground text-xs">
                          {camposAlterados(entrada.metadata)
                            .map((campo) => MEMBER_FIELD_LABELS[campo] ?? campo)
                            .join(", ")}
                        </p>
                      )}
                      <p className="text-muted-foreground text-xs">
                        {formatDateTime(entrada.createdAt)}
                        {entrada.actorName ? ` · ${entrada.actorName}` : " · pelo site"}
                      </p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * `metadata.changed` vem do banco como JSON. Vem de uma coluna `jsonb` que
 * ninguém valida, então a checagem é sobre o valor recebido e não sobre o tipo
 * declarado: um `metadata` de formato antigo devolve lista vazia em vez de
 * derrubar a ficha inteira por causa de uma linha de histórico.
 */
function camposAlterados(metadata: Record<string, unknown>): string[] {
  const bruto = metadata.changed;
  if (!Array.isArray(bruto)) return [];
  return bruto.filter((c): c is string => typeof c === "string");
}

/** A ficha para quem tem `members.read` sem `members.write`. */
function ReadOnlyMember({ member }: { member: MemberDetail }) {
  const campos: Array<[string, string | null]> = [
    [MEMBERSHIP_FIELD_LABELS.fullName, member.fullName],
    ["Matrícula", member.code],
    ["Situação", MEMBER_STATUS_LABELS[member.status]],
    ["Perfil", member.profileType ? MEMBERSHIP_PROFILE_TYPE_LABELS[member.profileType] : null],
    ["Associado desde", member.joinedAt ? formatCalendarDate(member.joinedAt) : null],
    [MEMBERSHIP_FIELD_LABELS.whatsapp, member.whatsapp ? formatWhatsapp(member.whatsapp) : null],
    [MEMBERSHIP_FIELD_LABELS.email, member.email],
    [
      "Cidade / Estado",
      member.city || member.state ? `${member.city ?? "—"} / ${member.state ?? "—"}` : null,
    ],
    [MEMBERSHIP_FIELD_LABELS.organization, member.organization],
    [MEMBERSHIP_FIELD_LABELS.farmName, member.farmName],
    [MEMBERSHIP_FIELD_LABELS.productionCity, member.productionCity],
    [MEMBERSHIP_FIELD_LABELS.sowCount, member.sowCount === null ? null : String(member.sowCount)],
    [MEMBERSHIP_FIELD_LABELS.cnpj, member.cnpj ? formatCnpj(member.cnpj) : null],
    [MEMBERSHIP_FIELD_LABELS.stateRegistration, member.stateRegistration],
    [MEMBERSHIP_FIELD_LABELS.legalName, member.legalName],
    [MEMBERSHIP_FIELD_LABELS.tradeName, member.tradeName],
    [MEMBERSHIP_FIELD_LABELS.activityArea, member.activityArea],
    [MEMBERSHIP_FIELD_LABELS.jobTitle, member.jobTitle],
    [
      MEMBERSHIP_FIELD_LABELS.interests,
      member.interests.length ? member.interests.join(", ") : null,
    ],
    [MEMBERSHIP_FIELD_LABELS.otherInterest, member.otherInterest],
    ["Observações", member.notes],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cadastro</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-4 text-sm">
          Você pode consultar este cadastro, mas não alterá-lo. Alterações são feitas por
          Administrador ou Gestor.
        </p>
        <dl className="divide-border divide-y">
          {campos
            .filter(([, valor]) => valor)
            .map(([rotulo, valor]) => (
              <div key={rotulo} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-4">
                <dt className="text-muted-foreground w-56 shrink-0 text-xs tracking-wide uppercase">
                  {rotulo}
                </dt>
                <dd className="text-sm">{valor}</dd>
              </div>
            ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function Linha({ rotulo, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <div className="py-2.5">
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">{rotulo}</dt>
      <dd>{valor}</dd>
      {dica && <p className="text-muted-foreground mt-0.5 text-xs">{dica}</p>}
    </div>
  );
}
