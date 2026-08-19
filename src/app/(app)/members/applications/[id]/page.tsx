import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getMembershipApplication, listMembershipAudit } from "@/lib/services/membership";
import { formatDateTime } from "@/lib/utils";
import {
  MEMBERSHIP_APPLICATION_STATUS_HINTS,
  MEMBERSHIP_APPLICATION_STATUS_LABELS,
  MEMBERSHIP_AUDIT_ACTION_LABELS,
  MEMBERSHIP_FIELD_LABELS,
  MEMBERSHIP_PROFILE_TYPE_LABELS,
  MEMBER_ORIGIN_LABELS,
  MEMBER_STATUS_LABELS,
} from "@/modules/membership/membership.labels";
import { APPLICATIONS_BASE, isMembershipId } from "@/modules/membership/membership.routes";
import { formatCnpj, formatWhatsapp } from "@/modules/membership/membership.schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APPLICATION_BADGE_VARIANT, MEMBER_BADGE_VARIANT } from "../../membership-badges";
import { ApplicationDecision } from "../application-decision";

export const metadata: Metadata = { title: "Solicitação de associação" };

/**
 * O DETALHE de uma solicitação: tudo o que a pessoa escreveu, mais a decisão.
 *
 * ⚠️ Os campos vazios NÃO aparecem. Um perfil "empresa" não tem número de
 * matrizes, e uma lista cheia de "—" faria quem analisa procurar o que ficou
 * faltando num campo que nunca foi perguntado a essa pessoa.
 *
 * A trilha de auditoria é lida com a permissão de quem abriu: para `comercial`
 * a RLS devolve lista vazia, e a seção some. Não é erro — é a trilha ser mais
 * estreita que a leitura, como nos outros módulos.
 */
export default async function MembershipApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "members.read")) redirect("/dashboard");

  const { id } = await params;
  if (!isMembershipId(id)) notFound();

  const solicitacao = await getMembershipApplication(id);
  if (!solicitacao) notFound();

  const trilha = await listMembershipAudit(id);
  const podeDecidir = hasPermission(role, "members.write");

  const campos: Array<[string, string | null]> = [
    [MEMBERSHIP_FIELD_LABELS.fullName, solicitacao.fullName],
    [MEMBERSHIP_FIELD_LABELS.whatsapp, formatWhatsapp(solicitacao.whatsapp)],
    [MEMBERSHIP_FIELD_LABELS.email, solicitacao.email],
    ["Cidade / Estado", `${solicitacao.city} / ${solicitacao.state}`],
    [MEMBERSHIP_FIELD_LABELS.organization, solicitacao.organization],
    [MEMBERSHIP_FIELD_LABELS.farmName, solicitacao.farmName],
    [MEMBERSHIP_FIELD_LABELS.productionCity, solicitacao.productionCity],
    [
      MEMBERSHIP_FIELD_LABELS.sowCount,
      solicitacao.sowCount === null ? null : String(solicitacao.sowCount),
    ],
    [MEMBERSHIP_FIELD_LABELS.legalName, solicitacao.legalName],
    [MEMBERSHIP_FIELD_LABELS.tradeName, solicitacao.tradeName],
    [MEMBERSHIP_FIELD_LABELS.cnpj, solicitacao.cnpj ? formatCnpj(solicitacao.cnpj) : null],
    [MEMBERSHIP_FIELD_LABELS.stateRegistration, solicitacao.stateRegistration],
    [MEMBERSHIP_FIELD_LABELS.activityArea, solicitacao.activityArea],
    [MEMBERSHIP_FIELD_LABELS.jobTitle, solicitacao.jobTitle],
    [
      MEMBERSHIP_FIELD_LABELS.interests,
      solicitacao.interests.length > 0 ? solicitacao.interests.join(", ") : null,
    ],
    [MEMBERSHIP_FIELD_LABELS.otherInterest, solicitacao.otherInterest],
  ];

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href={APPLICATIONS_BASE}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Solicitações
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{solicitacao.fullName}</h1>
            <Badge variant={APPLICATION_BADGE_VARIANT[solicitacao.status]}>
              {MEMBERSHIP_APPLICATION_STATUS_LABELS[solicitacao.status]}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            <span className="font-mono">{solicitacao.protocol}</span> ·{" "}
            {MEMBERSHIP_PROFILE_TYPE_LABELS[solicitacao.profileType]} · recebida em{" "}
            {formatDateTime(solicitacao.createdAt)}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {MEMBERSHIP_APPLICATION_STATUS_HINTS[solicitacao.status]}
          </p>
        </div>
      </div>

      {podeDecidir && <ApplicationDecision id={solicitacao.id} status={solicitacao.status} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>O que foi informado</CardTitle>
          </CardHeader>
          <CardContent>
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

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Consentimento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Aceito em {formatDateTime(solicitacao.consentAt)}.</p>
              {solicitacao.consentPolicyVersion && (
                <p className="text-muted-foreground">
                  Versão do texto: {solicitacao.consentPolicyVersion}
                </p>
              )}
            </CardContent>
          </Card>

          {solicitacao.member && (
            <Card>
              <CardHeader>
                <CardTitle>Associado</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{solicitacao.member.fullName}</span>
                  <Badge variant={MEMBER_BADGE_VARIANT[solicitacao.member.status]}>
                    {MEMBER_STATUS_LABELS[solicitacao.member.status]}
                  </Badge>
                </div>
                <p className="text-muted-foreground">
                  {MEMBER_ORIGIN_LABELS[solicitacao.member.origin]}
                  {solicitacao.member.code ? ` · ${solicitacao.member.code}` : ""}
                </p>
              </CardContent>
            </Card>
          )}

          {(solicitacao.reviewNote || solicitacao.reviewedByName) && (
            <Card>
              <CardHeader>
                <CardTitle>Análise</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {solicitacao.reviewedByName && (
                  <p className="text-muted-foreground">Por {solicitacao.reviewedByName}</p>
                )}
                {solicitacao.reviewedAt && (
                  <p className="text-muted-foreground">{formatDateTime(solicitacao.reviewedAt)}</p>
                )}
                {solicitacao.reviewNote && <p className="mt-2">{solicitacao.reviewNote}</p>}
              </CardContent>
            </Card>
          )}

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
                      <p className="text-muted-foreground text-xs">
                        {formatDateTime(entrada.createdAt)}
                        {/* Sem ator = escrita do próprio sistema: foi o
                            formulário público, onde não existe usuário. */}
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
