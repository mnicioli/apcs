import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { History } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listBulletins } from "@/lib/services/market-bulletins";
import { formatCalendarDate, formatDateTime, todayInSaoPaulo } from "@/lib/utils";
import {
  MARKET_MODULE_SUBTITLE,
  MARKET_MODULE_TITLE,
  MARKET_SITUATION_LABELS,
} from "@/modules/market/market.labels";
import { marketHref } from "@/modules/market/market.routes";
import { isAvailableForChatbot, versionSituation } from "@/modules/market/market.rules";
import {
  isMarketChatbotFilter,
  isMarketStatusFilter,
  type MarketBulletinSummary,
  type MarketFilters,
} from "@/modules/market/market.types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { BulletinFormDialog } from "./bulletin-form-dialog";
import { MarketFiltersBar } from "./market-filters";
import { SITUATION_BADGE_VARIANT } from "./market-badges";
import { PublishVersionDialog } from "./publish-version-dialog";
import { VersionAccess } from "./version-access";

export const metadata: Metadata = { title: MARKET_MODULE_TITLE };

/**
 * Grid da Bolsa.
 *
 * Mostra a SITUAÇÃO ATUAL de cada Bolsa — uma linha por cadastro, com a
 * publicação que vale hoje. As anteriores ficam no histórico: uma lista com
 * todas as publicações de todas as bolsas responderia a pergunta errada, que é
 * "qual boletim eu apresento agora?".
 *
 * A permissão é checada aqui (1ª camada) e a RLS de `market_bulletins` filtra no
 * banco (2ª camada) — as duas contam a mesma história. O `redirect` protege a
 * ROTA: esconder o item do menu não impede ninguém de digitar o endereço.
 */
export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    chatbot?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "market.read")) redirect("/dashboard");

  const { q, status, chatbot, from, to } = await searchParams;
  const filters: MarketFilters = {
    query: q ?? "",
    // Valor desconhecido cai no padrão em vez de mostrar lista vazia: uma URL
    // colada errada não deve parecer "não há nada aqui".
    status: status && isMarketStatusFilter(status) ? status : "all",
    chatbot: chatbot && isMarketChatbotFilter(chatbot) ? chatbot : "all",
    from: from ?? "",
    to: to ?? "",
  };

  // "Hoje" é apurado UMA vez e desce para tudo que depende dele. Duas leituras
  // do relógio na mesma renderização podem cair em dias diferentes na virada da
  // meia-noite, e aí a grid discordaria dela mesma.
  const today = todayInSaoPaulo();
  const bulletins = await listBulletins(filters, today);
  const canWrite = hasPermission(role, "market.write");
  const isFiltered =
    filters.query.trim() !== "" ||
    filters.status !== "all" ||
    filters.chatbot !== "all" ||
    filters.from !== "" ||
    filters.to !== "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{MARKET_MODULE_TITLE}</h1>
          <p className="text-muted-foreground text-sm">{MARKET_MODULE_SUBTITLE}</p>
        </div>
        {canWrite && <BulletinFormDialog />}
      </div>

      <MarketFiltersBar filters={filters} />

      {bulletins.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-muted-foreground text-sm">
              {isFiltered
                ? "Nenhuma Bolsa encontrada para os filtros selecionados."
                : "Nenhuma Bolsa cadastrada."}
            </p>
            {/* No estado vazio POR FILTRO o botão não aparece: quem procurou
                algo específico quer ajustar a busca, não cadastrar. */}
            {canWrite && !isFiltered && <BulletinFormDialog />}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Bolsas da APCS e a publicação que vale hoje em cada uma
                </caption>
                <thead className="text-muted-foreground border-border border-b text-left">
                  <tr>
                    {[
                      "Bolsa",
                      "Publicação ativa",
                      "Vigência",
                      "Situação",
                      "Chatbot",
                      "Atualizada em",
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
                  {bulletins.map((bulletin) => (
                    <BulletinRow
                      key={bulletin.id}
                      bulletin={bulletin}
                      canWrite={canWrite}
                      today={today}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BulletinRow({
  bulletin,
  canWrite,
  today,
}: {
  bulletin: MarketBulletinSummary;
  canWrite: boolean;
  today: string;
}) {
  const version = bulletin.activeVersion;

  return (
    <tr className="border-border hover:bg-muted/50 border-b align-middle last:border-0">
      <td className="px-4 py-3">
        <Link href={marketHref(bulletin.id)} className="text-primary-strong hover:underline">
          {bulletin.name}
        </Link>
        <span className="text-muted-foreground block text-xs">
          {bulletin.versionCount === 0
            ? "Nenhuma publicação"
            : `${bulletin.versionCount} ${bulletin.versionCount === 1 ? "publicação" : "publicações"}`}
        </span>
      </td>

      {version ? (
        <>
          <td className="px-4 py-3 font-medium whitespace-nowrap">{version.versionName}</td>
          <td className="px-4 py-3 whitespace-nowrap">
            {formatCalendarDate(version.effectiveDate)}
          </td>
          <td className="px-4 py-3">
            <Badge variant={SITUATION_BADGE_VARIANT[versionSituation(version, today)]}>
              {MARKET_SITUATION_LABELS[versionSituation(version, today)]}
            </Badge>
          </td>
          <td className="px-4 py-3">
            <ChatbotCell bulletin={bulletin} today={today} />
          </td>
          <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
            {formatDateTime(bulletin.updatedAt)}
          </td>
          <td className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-1">
              <VersionAccess
                versionId={version.id}
                versionName={version.versionName}
                bulletinName={bulletin.name}
              />
              {canWrite && (
                <>
                  <PublishVersionDialog
                    bulletinId={bulletin.id}
                    bulletinName={bulletin.name}
                    currentVersionName={version.versionName}
                    today={today}
                    trigger="menu"
                  />
                  <BulletinFormDialog bulletin={bulletin} />
                </>
              )}
              <HistoryLink bulletinId={bulletin.id} />
            </div>
          </td>
        </>
      ) : (
        /* Bolsa cadastrada e ainda sem publicação. A linha existe para quem pode
           publicar saber que ela está esperando — e não some da grid só por
           estar incompleta. */
        <>
          <td className="text-muted-foreground px-4 py-3" colSpan={3}>
            Nenhuma publicação enviada ainda.
          </td>
          <td className="px-4 py-3">
            <ChatbotCell bulletin={bulletin} today={today} />
          </td>
          <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
            {formatDateTime(bulletin.updatedAt)}
          </td>
          <td className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-1">
              {canWrite && (
                <>
                  <PublishVersionDialog
                    bulletinId={bulletin.id}
                    bulletinName={bulletin.name}
                    currentVersionName={null}
                    today={today}
                    trigger="menu"
                  />
                  <BulletinFormDialog bulletin={bulletin} />
                </>
              )}
              <HistoryLink bulletinId={bulletin.id} />
            </div>
          </td>
        </>
      )}
    </tr>
  );
}

/**
 * O que o CHATBOT enxerga — que não é o valor da coluna `chatbot_enabled`.
 *
 * ⚠️ Uma Bolsa ligada cuja publicação só vale semana que vem NÃO está
 * disponível hoje. Escrever "Sim" aqui faria alguém prometer ao associado uma
 * resposta que o robô não dá. Por isso a célula diz a partir de quando.
 */
function ChatbotCell({ bulletin, today }: { bulletin: MarketBulletinSummary; today: string }) {
  const version = bulletin.activeVersion;

  if (isAvailableForChatbot(bulletin, version, today)) {
    return <Badge variant="attention">Disponível</Badge>;
  }

  if (bulletin.chatbotEnabled && version && version.effectiveDate > today) {
    return (
      <span className="text-muted-foreground text-xs">
        Disponível em {formatCalendarDate(version.effectiveDate)}
      </span>
    );
  }

  return (
    <Badge variant="done">{bulletin.chatbotEnabled ? "Sem publicação" : "Não disponível"}</Badge>
  );
}

function HistoryLink({ bulletinId }: { bulletinId: string }) {
  return (
    <Link
      href={marketHref(bulletinId)}
      className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs transition-colors"
    >
      <History className="h-4 w-4" aria-hidden="true" />
      Histórico
    </Link>
  );
}
