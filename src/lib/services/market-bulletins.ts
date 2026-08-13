import "server-only";
import { createClient } from "@/lib/supabase/server";
import { todayInSaoPaulo } from "@/lib/utils";
import {
  activeVersion,
  compareBulletins,
  compareVersionsDesc,
  matchesMarketFilters,
} from "@/modules/market/market.rules";
import type {
  MarketAuditAction,
  MarketAuditEntry,
  MarketBulletinDetail,
  MarketBulletinSummary,
  MarketBulletinVersion,
  MarketFilters,
  MarketStatusReason,
  MarketVersionStatus,
} from "@/modules/market/market.types";

/**
 * SERVICE = leitura. Retorna o dado ou LANÇA erro (o caller decide como tratar).
 *
 * Passa pelo cliente autenticado — ou seja, pela RLS de `market_bulletins` e
 * `market_bulletin_versions`. Quem não é `admin`/`ceo`/`comercial` não vê linha
 * nenhuma, mesmo que a checagem de permissão da app falhe.
 *
 * NÃO emite URL assinada. O caminho no bucket nunca sai daqui: quem precisa do
 * arquivo chama `getBulletinFileUrlAction`, que confere a permissão e registra
 * o acesso na trilha. Um service que devolvesse URLs assinadas na listagem
 * emitiria acesso para arquivos que ninguém pediu.
 *
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 */

/**
 * Teto da leitura.
 *
 * A tela lê as bolsas com todas as versões embutidas e filtra em memória, em vez
 * de filtrar no SQL. A razão é a busca por nome: `ilike` no Postgres é sensível
 * a acento, e ninguém digita "Suínos" com acento numa caixa de busca. Filtrar
 * aqui usa `normalizeForSearch` e resolve isso sem depender da extensão
 * `unaccent`.
 *
 * O volume esperado é uma bolsa com uma publicação por semana — dezenas de
 * linhas por ano. Se passar deste teto, o caminho é paginar o HISTÓRICO (não a
 * lista de bolsas) e mover a busca para uma coluna normalizada com índice.
 */
const LIST_LIMIT = 100;

/** Teto do histórico lido de uma vez, no detalhe de uma Bolsa. */
const VERSION_LIMIT = 500;

/**
 * `uploaded_by` é uma de TRÊS chaves estrangeiras para `profiles` nesta tabela
 * (as outras são `activated_by` e `deactivated_by`). Sem apontar a constraint,
 * o PostgREST não sabe qual seguir e devolve erro de ambiguidade.
 */
const VERSION_COLUMNS =
  "id, bulletin_id, version, version_name, status, status_reason, effective_date, " +
  "image_filename, image_mime_type, image_size_bytes, " +
  "pdf_filename, pdf_mime_type, pdf_size_bytes, " +
  "uploaded_at, activated_at, deactivated_at, " +
  "uploader:profiles!market_bulletin_versions_uploaded_by_fkey (id, full_name)";

const BULLETIN_COLUMNS =
  `id, name, description, chatbot_enabled, updated_at, ` +
  // Aqui `market_bulletins` é o lado PAI, então o embed devolve uma LISTA — que
  // é exatamente o que o HISTÓRICO precisa.
  `versions:market_bulletin_versions (${VERSION_COLUMNS})`;

/**
 * As colunas da GRID — e a diferença com as de cima não é cosmética.
 *
 * ⚠️ A grid precisa de UMA publicação por Bolsa (a ativa) e do total. Usar o
 * embed de cima aqui traria TODAS as publicações de TODAS as bolsas só para
 * escolher uma e contar o resto. Medido com 6000 publicações: **82 ms contra
 * 3 ms** — e o custo real é pior que isso, porque as 6000 linhas ainda
 * atravessam a rede e passam por `toVersion` no Node.
 *
 * O `!left` é obrigatório: sem ele, filtrar o embed por `status = 'active'`
 * viraria junção interna e a Bolsa recém-cadastrada, que ainda não tem
 * publicação, sumiria da grid.
 */
const BULLETIN_LIST_COLUMNS =
  `id, name, description, chatbot_enabled, updated_at, ` +
  `active:market_bulletin_versions!left (${VERSION_COLUMNS}), ` +
  `total:market_bulletin_versions!left (count)`;

interface VersionRow {
  id: string;
  bulletin_id: string;
  version: number;
  version_name: string;
  status: MarketVersionStatus;
  status_reason: MarketStatusReason | null;
  effective_date: string;
  image_filename: string;
  image_mime_type: string;
  image_size_bytes: number;
  pdf_filename: string;
  pdf_mime_type: string;
  pdf_size_bytes: number;
  uploaded_at: string;
  activated_at: string | null;
  deactivated_at: string | null;
  uploader: { id: string; full_name: string | null } | null;
}

interface BulletinRow {
  id: string;
  name: string;
  description: string | null;
  chatbot_enabled: boolean;
  updated_at: string;
  versions: VersionRow[];
}

function toVersion(row: VersionRow): MarketBulletinVersion {
  return {
    id: row.id,
    bulletinId: row.bulletin_id,
    version: row.version,
    versionName: row.version_name,
    status: row.status,
    statusReason: row.status_reason,
    effectiveDate: row.effective_date,
    image: {
      originalFilename: row.image_filename,
      mimeType: row.image_mime_type,
      sizeBytes: row.image_size_bytes,
    },
    pdf: {
      originalFilename: row.pdf_filename,
      mimeType: row.pdf_mime_type,
      sizeBytes: row.pdf_size_bytes,
    },
    uploadedBy: row.uploader ? { id: row.uploader.id, fullName: row.uploader.full_name } : null,
    uploadedAt: row.uploaded_at,
    activatedAt: row.activated_at,
    deactivatedAt: row.deactivated_at,
  };
}

/**
 * A linha da GRID: no máximo uma publicação (a ativa) e a contagem do resto.
 *
 * `active` vem como LISTA mesmo trazendo um elemento só — é o formato do embed
 * de PostgREST para o lado filho, e o índice único parcial garante que ela
 * nunca tem dois.
 */
interface BulletinListRow {
  id: string;
  name: string;
  description: string | null;
  chatbot_enabled: boolean;
  updated_at: string;
  active: VersionRow[];
  total: { count: number }[];
}

function toListSummary(row: BulletinListRow): MarketBulletinSummary {
  const active = row.active[0];

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    chatbotEnabled: row.chatbot_enabled,
    activeVersion: active ? toVersion(active) : null,
    versionCount: row.total[0]?.count ?? 0,
    updatedAt: row.updated_at,
  };
}

function toSummary(row: BulletinRow, versions: MarketBulletinVersion[]): MarketBulletinSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    chatbotEnabled: row.chatbot_enabled,
    activeVersion: activeVersion(versions),
    versionCount: versions.length,
    updatedAt: row.updated_at,
  };
}

/**
 * A grid das bolsas, já filtrada e ordenada.
 *
 * `today` é PARÂMETRO e não `new Date()` aqui dentro: o filtro de chatbot
 * depende de "hoje" e a página já apurou essa data uma vez. Duas leituras do
 * relógio na mesma renderização podem cair em dias diferentes na virada da
 * meia-noite — e aí a grid discordaria dela mesma.
 */
export async function listBulletins(
  filters: MarketFilters,
  today: string = todayInSaoPaulo(),
): Promise<MarketBulletinSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("market_bulletins")
    .select(BULLETIN_LIST_COLUMNS)
    // O filtro cita o APELIDO do embed, e só ele: `total` continua contando o
    // histórico inteiro.
    .eq("active.status", "active")
    .limit(LIST_LIMIT)
    // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
    .returns<BulletinListRow[]>();

  if (error) {
    console.error(`[market] listBulletins falhou: ${error.message}`);
    throw error;
  }

  return (data ?? [])
    .map(toListSummary)
    .filter((bulletin) => matchesMarketFilters(bulletin, filters, today))
    .sort(compareBulletins);
}

/** Uma Bolsa com o histórico completo, do mais novo para o mais antigo. */
export async function getBulletin(bulletinId: string): Promise<MarketBulletinDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("market_bulletins")
    .select(BULLETIN_COLUMNS)
    .eq("id", bulletinId)
    // ⚠️ O APELIDO, não o nome da tabela. O postgrest-js monta o parâmetro como
    // `<referencedTable>.limit`, e o PostgREST resolve isso contra o APELIDO do
    // embed (`versions:market_bulletin_versions`). Passar o nome da tabela aqui
    // compila, não avisa nada e o limite simplesmente não vale.
    .limit(VERSION_LIMIT, { referencedTable: "versions" })
    .returns<BulletinRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[market] getBulletin falhou: ${error.message}`);
    throw error;
  }
  if (!data) return null;

  const versions = data.versions.map(toVersion).sort(compareVersionsDesc);
  return { ...toSummary(data, versions), versions };
}

interface AuditRow {
  id: number;
  action: MarketAuditAction;
  metadata: Record<string, unknown>;
  created_at: string;
  actor: { id: string; full_name: string | null } | null;
}

/**
 * A trilha de uma Bolsa, do mais recente para o mais antigo.
 *
 * A RLS já restringe isto a `admin` e `ceo` — o Atendente consulta e baixa o
 * boletim, mas o histórico de quem publicou o quê não é dele. Uma chamada feita
 * por quem não pode simplesmente volta vazia, sem erro.
 */
export async function listBulletinAudit(bulletinId: string): Promise<MarketAuditEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("market_bulletin_audit_logs")
    .select(
      "id, action, metadata, created_at, " +
        "actor:profiles!market_bulletin_audit_logs_actor_id_fkey (id, full_name)",
    )
    .eq("bulletin_id", bulletinId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LIST_LIMIT)
    .returns<AuditRow[]>();

  if (error) {
    console.error(`[market] listBulletinAudit falhou: ${error.message}`);
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    action: row.action,
    actor: row.actor ? { id: row.actor.id, fullName: row.actor.full_name } : null,
    // O nome CONGELADO no momento da ação. Sobrevive à saída do perfil, que
    // zeraria o `actor` acima por causa do `on delete set null`.
    actorName: typeof row.metadata.actor_name === "string" ? row.metadata.actor_name : null,
    createdAt: row.created_at,
    metadata: row.metadata,
  }));
}
