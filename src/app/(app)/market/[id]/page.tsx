import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getBulletin, listBulletinAudit } from "@/lib/services/market-bulletins";
import { formatCalendarDate, formatDateTime, formatFileSize, todayInSaoPaulo } from "@/lib/utils";
import {
  MARKET_AUDIT_ACTION_LABELS,
  MARKET_DEACTIVATE_BLOCKED,
  MARKET_MODULE_TITLE,
  MARKET_SITUATION_HINTS,
  MARKET_SITUATION_LABELS,
  MARKET_STATUS_REASON_LABELS,
} from "@/modules/market/market.labels";
import { marketHref } from "@/modules/market/market.routes";
import { isAvailableForChatbot, versionSituation } from "@/modules/market/market.rules";
import type { MarketBulletinDetail, MarketBulletinVersion } from "@/modules/market/market.types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BulletinFormDialog } from "../bulletin-form-dialog";
import { SITUATION_BADGE_VARIANT } from "../market-badges";
import { PublishVersionDialog } from "../publish-version-dialog";
import { VersionAccess } from "../version-access";
import { VersionStatusActions } from "../version-status-actions";

export const metadata: Metadata = { title: "Histórico de publicações" };

/**
 * Detalhe de uma Bolsa e o histórico completo das publicações.
 *
 * É página e não modal porque segue o padrão do projeto (`/leads/[id]`,
 * `/documents/[category]/[id]`): dá para mandar o link para alguém, sobrevive ao
 * F5 e não precisa buscar dados no cliente.
 *
 * Nenhuma publicação pode ser EDITADA aqui — nem os arquivos, nem o nome, nem a
 * vigência. Boletim errado se corrige com uma publicação nova. O banco impõe
 * isso: `market_bulletin_versions` não concede UPDATE nessas colunas.
 */
export default async function BulletinHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "market.read")) redirect("/dashboard");

  const { id } = await params;
  const bulletin = await getBulletin(id);
  if (!bulletin) notFound();

  const canWrite = hasPermission(role, "market.write");
  const today = todayInSaoPaulo();
  const active = bulletin.activeVersion;

  // A trilha é de Administrador e Gestor. A RLS já devolveria vazio para o
  // Atendente; não pedir o dado é mais honesto do que pedir e descartar.
  const audit = canWrite ? await listBulletinAudit(bulletin.id) : [];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={marketHref()}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para {MARKET_MODULE_TITLE}
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{bulletin.name}</h1>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <BulletinFormDialog bulletin={bulletin} />
              <PublishVersionDialog
                bulletinId={bulletin.id}
                bulletinName={bulletin.name}
                currentVersionName={active?.versionName ?? null}
                today={today}
              />
            </div>
          )}
        </div>

        {bulletin.description && (
          <p className="text-muted-foreground text-sm">{bulletin.description}</p>
        )}
      </div>

      <BulletinSummaryCard bulletin={bulletin} today={today} />

      {canWrite && active && (
        <Card>
          <CardContent className="p-4">
            {/* ⚠️ A explicação existe no lugar do botão "Inativar". Oferecer o
                botão seria convidar a pessoa a clicar, ler um erro e não
                descobrir que o caminho é ATIVAR a outra publicação. */}
            <p className="text-sm">{MARKET_DEACTIVATE_BLOCKED}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico de publicações</CardTitle>
          <CardDescription>
            Da mais recente para a mais antiga. Nenhuma publicação é apagada: o histórico é o
            registro do que já valeu.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {bulletin.versions.length === 0 ? (
            <p className="text-muted-foreground px-6 pb-6 text-sm">
              Nenhuma publicação cadastrada.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Publicações de {bulletin.name}, da mais recente para a mais antiga
                </caption>
                <thead className="text-muted-foreground border-border border-y text-left">
                  <tr>
                    {[
                      "Publicação",
                      "Vigência",
                      "Situação",
                      "Arquivos",
                      "Enviada em",
                      "Responsável",
                      "Ações",
                    ].map((label) => (
                      <th
                        key={label}
                        scope="col"
                        className="px-4 py-3 font-medium whitespace-nowrap"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bulletin.versions.map((version) => (
                    <VersionRow
                      key={version.id}
                      version={version}
                      bulletinId={bulletin.id}
                      bulletinName={bulletin.name}
                      activeVersionName={active?.versionName ?? null}
                      canWrite={canWrite}
                      today={today}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trilha de auditoria</CardTitle>
            <CardDescription>
              Quem fez o quê, e quando. A trilha não é editada nem apagada — nem pelo sistema.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {audit.length === 0 ? (
              <p className="text-muted-foreground px-6 pb-6 text-sm">Nenhum registro ainda.</p>
            ) : (
              <ul className="divide-border divide-y">
                {audit.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap justify-between gap-2 px-6 py-3">
                    <span className="text-sm">{MARKET_AUDIT_ACTION_LABELS[entry.action]}</span>
                    <span className="text-muted-foreground text-xs">
                      {/* O nome CONGELADO na trilha vem primeiro: ele sobrevive
                          à saída do perfil, que zeraria o vínculo. */}
                      {entry.actorName ?? entry.actor?.fullName ?? "—"} ·{" "}
                      {formatDateTime(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Os metadados que respondem "o que vale nesta Bolsa agora?". */
function BulletinSummaryCard({
  bulletin,
  today,
}: {
  bulletin: MarketBulletinDetail;
  today: string;
}) {
  const version = bulletin.activeVersion;
  const situacao = version ? versionSituation(version, today) : null;
  const disponivel = isAvailableForChatbot(bulletin, version, today);

  return (
    <Card>
      <CardContent className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotulo="Publicação ativa" valor={version?.versionName ?? "Nenhuma"} />
        <Campo
          rotulo="Vigência"
          valor={version ? formatCalendarDate(version.effectiveDate) : "—"}
          nota={situacao ? MARKET_SITUATION_HINTS[situacao] : undefined}
        />
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Situação</p>
          {situacao ? (
            <Badge variant={SITUATION_BADGE_VARIANT[situacao]}>
              {MARKET_SITUATION_LABELS[situacao]}
            </Badge>
          ) : (
            <p className="text-sm">Sem publicação</p>
          )}
        </div>
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Chatbot</p>
          <Badge variant={disponivel ? "attention" : "done"}>
            {disponivel ? "Disponível" : "Não disponível"}
          </Badge>
          {!disponivel && bulletin.chatbotEnabled && version && (
            <p className="text-muted-foreground text-xs">
              Passa a valer em {formatCalendarDate(version.effectiveDate)}.
            </p>
          )}
          {!bulletin.chatbotEnabled && (
            <p className="text-muted-foreground text-xs">Desligado no cadastro desta Bolsa.</p>
          )}
        </div>
        <Campo rotulo="Enviada em" valor={version ? formatDateTime(version.uploadedAt) : "—"} />
        <Campo rotulo="Responsável" valor={version?.uploadedBy?.fullName ?? "—"} />
        <Campo rotulo="Publicações" valor={String(bulletin.versionCount)} />
      </CardContent>
    </Card>
  );
}

function Campo({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{rotulo}</p>
      <p className="text-sm font-medium">{valor}</p>
      {nota && <p className="text-muted-foreground text-xs">{nota}</p>}
    </div>
  );
}

function VersionRow({
  version,
  bulletinId,
  bulletinName,
  activeVersionName,
  canWrite,
  today,
}: {
  version: MarketBulletinVersion;
  bulletinId: string;
  bulletinName: string;
  activeVersionName: string | null;
  canWrite: boolean;
  today: string;
}) {
  const situacao = versionSituation(version, today);

  return (
    <tr className="border-border hover:bg-muted/50 border-b align-middle last:border-0">
      <td className="px-4 py-3 font-medium whitespace-nowrap">{version.versionName}</td>
      <td className="px-4 py-3 whitespace-nowrap">{formatCalendarDate(version.effectiveDate)}</td>
      <td className="px-4 py-3">
        <Badge variant={SITUATION_BADGE_VARIANT[situacao]}>
          {MARKET_SITUATION_LABELS[situacao]}
        </Badge>
        {version.statusReason && (
          <span className="text-muted-foreground mt-1 block text-xs">
            {MARKET_STATUS_REASON_LABELS[version.statusReason]}
          </span>
        )}
      </td>
      <td className="text-muted-foreground max-w-56 px-4 py-3">
        <span className="block truncate" title={version.image.originalFilename}>
          {version.image.originalFilename}
        </span>
        <span className="block truncate text-xs" title={version.pdf.originalFilename}>
          {version.pdf.originalFilename}
        </span>
        <span className="text-xs">
          {formatFileSize(version.image.sizeBytes + version.pdf.sizeBytes)} no total
        </span>
      </td>
      <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
        {formatDateTime(version.uploadedAt)}
      </td>
      <td className="text-muted-foreground max-w-40 truncate px-4 py-3">
        {version.uploadedBy?.fullName ?? "—"}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1">
          <VersionAccess
            versionId={version.id}
            versionName={version.versionName}
            bulletinName={bulletinName}
          />
          {canWrite && (
            <VersionStatusActions
              bulletinId={bulletinId}
              versionId={version.id}
              versionName={version.versionName}
              status={version.status}
              activeVersionName={activeVersionName}
            />
          )}
        </div>
      </td>
    </tr>
  );
}
