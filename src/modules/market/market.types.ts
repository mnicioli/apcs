/**
 * Tipos de domínio da Bolsa (camelCase), desacoplados das linhas cruas do banco
 * (snake_case).
 *
 * Os enums espelham os do Postgres criados em
 * `supabase/migrations/20260814000000_create_market_bulletins.sql`. Ao mudar um,
 * mude os dois — o `as const` aqui é a fonte da verdade para o TypeScript.
 *
 * NOME: o negócio diz "Bolsa"; o código diz `MarketBulletin`. Os rótulos de
 * tela vivem em `market.labels.ts` e dizem "Bolsa".
 *
 * DOIS CONCEITOS: um `MarketBulletin` é o cadastro lógico ("Bolsa de Suínos");
 * uma `MarketBulletinVersion` é uma publicação (Bolsa_12Ago26), sempre um par
 * imagem + PDF. Novo upload cria versão, nunca duplica a Bolsa.
 *
 * ⚠️ TRÊS CONCEITOS DE ESTADO, e confundi-los é o erro fácil deste módulo:
 *
 *   `status`       o que uma PESSOA escolheu (enum do banco: active/inactive)
 *   vigente        `effectiveDate <= hoje` — CONTA, não coluna
 *   `situation`    a leitura das duas coisas juntas, para exibir
 *
 * Só o primeiro é gravado. Uma versão publicada hoje para valer dia 15 está
 * ATIVA e AINDA NÃO VIGENTE — e o chatbot exige as duas coisas.
 */

/** O que se grava: apenas a decisão humana. */
export const MARKET_VERSION_STATUSES = ["active", "inactive"] as const;
export type MarketVersionStatus = (typeof MARKET_VERSION_STATUSES)[number];

/**
 * Por que uma versão saiu do ar.
 *
 * `superseded` — outra versão tomou o lugar dela (novo upload ou ativação).
 * `manual`     — alguém a inativou de propósito.
 *
 * ⚠️ Hoje `manual` NUNCA é gravado: a Bolsa não pode ficar sem versão ativa, e
 * como só existe uma ativa por vez, inativar "a ativa" é recusado sempre. O
 * valor existe para o dia em que o negócio decidir permitir a inativação com
 * substituta escolhida — aí ele passa a ser escrito sem migration. Ver a
 * pendência registrada em docs/BOLSA.md.
 */
export const MARKET_STATUS_REASONS = ["manual", "superseded"] as const;
export type MarketStatusReason = (typeof MARKET_STATUS_REASONS)[number];

/**
 * O que se LÊ numa versão — status e vigência já combinados.
 *
 * `current`     ativa e vigente. É esta que o chatbot pode citar.
 * `scheduled`   ativa, mas a vigência ainda não chegou.
 * `historical`  inativa. Fica no acervo, nunca é apagada.
 */
export const MARKET_VERSION_SITUATIONS = ["current", "scheduled", "historical"] as const;
export type MarketVersionSituation = (typeof MARKET_VERSION_SITUATIONS)[number];

/** Abas do filtro de status. `all` é o padrão: a grid abre mostrando tudo. */
export const MARKET_STATUS_FILTERS = ["all", "active", "inactive"] as const;
export type MarketStatusFilter = (typeof MARKET_STATUS_FILTERS)[number];

export const DEFAULT_MARKET_STATUS_FILTER: MarketStatusFilter = "all";

export function isMarketStatusFilter(value: string): value is MarketStatusFilter {
  return (MARKET_STATUS_FILTERS as readonly string[]).includes(value);
}

/** Quem fez uma operação, já com o nome resolvido para exibir. */
export interface MarketActor {
  id: string;
  fullName: string | null;
}

/**
 * O que se guarda sobre um arquivo enviado.
 *
 * O caminho no bucket NÃO está aqui de propósito: o navegador nunca precisa
 * saber onde o arquivo mora. As actions recebem o id da versão e resolvem o
 * caminho no servidor. O que não é enviado não vaza.
 */
export interface MarketFileMeta {
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Uma publicação. Imutável depois de criada: para corrigir, publica-se outra.
 *
 * `image` e `pdf` são sempre os DOIS — nunca um sem o outro, e nunca de
 * publicações diferentes. Isso é garantido pelo `not null` das colunas, não
 * pela boa vontade de quem escreve o código.
 */
export interface MarketBulletinVersion {
  id: string;
  bulletinId: string;
  /** A sequência técnica (1, 2, 3…). Nunca reutilizada. É o que ordena. */
  version: number;
  /** A identidade funcional que a APCS lê: "Bolsa_12Ago26". */
  versionName: string;
  status: MarketVersionStatus;
  statusReason: MarketStatusReason | null;
  /** Data pura AAAA-MM-DD, sem hora e sem fuso. Digitada por quem publica. */
  effectiveDate: string;
  image: MarketFileMeta;
  pdf: MarketFileMeta;
  uploadedBy: MarketActor | null;
  /** Carimbado pelo banco — nunca informado por quem envia. */
  uploadedAt: string;
  activatedAt: string | null;
  deactivatedAt: string | null;
}

/** Uma linha da grid: o cadastro mais a publicação que vale agora. */
export interface MarketBulletinSummary {
  id: string;
  name: string;
  description: string | null;
  /** Se o conteúdo pode ser citado pelo chatbot. Decisão da Bolsa, não da versão. */
  chatbotEnabled: boolean;
  /** A versão ativa. `null` só antes da primeira publicação. */
  activeVersion: MarketBulletinVersion | null;
  versionCount: number;
  updatedAt: string;
}

/** O cadastro com o histórico completo, do mais novo para o mais antigo. */
export interface MarketBulletinDetail extends MarketBulletinSummary {
  versions: MarketBulletinVersion[];
}

/**
 * O QUE O CHATBOT VÊ — e só isso.
 *
 * DTO próprio, e não a entidade: quem responde no WhatsApp não precisa saber
 * quem publicou, quando, qual o número da sequência nem quantas versões
 * existem. Devolver a entidade inteira transformaria cada campo novo do
 * cadastro em vazamento automático para fora da empresa.
 */
export interface MarketBulletinChatbotView {
  bulletinId: string;
  name: string;
  versionName: string;
  effectiveDate: string;
  /** URLs assinadas de vida curta, emitidas no servidor. */
  imageUrl: string;
  pdfUrl: string;
}

/** Uma entrada da trilha de auditoria. */
export interface MarketAuditEntry {
  id: number;
  action: MarketAuditAction;
  /** Resolvido pela FK. `null` se o perfil saiu — veja `actorName`. */
  actor: MarketActor | null;
  /** O nome congelado no momento da ação. Sobrevive à saída do perfil. */
  actorName: string | null;
  createdAt: string;
  /** Livre por ação. Para `bulletin_updated`, traz `changes: MarketFieldChange[]`. */
  metadata: Record<string, unknown>;
}

export const MARKET_AUDIT_ACTIONS = [
  "bulletin_created",
  "bulletin_updated",
  "version_uploaded",
  "version_activated",
  "version_deactivated",
  "version_viewed",
  "version_downloaded",
] as const;
export type MarketAuditAction = (typeof MARKET_AUDIT_ACTIONS)[number];

/** Uma alteração registrada: campo, valor anterior, novo valor. */
export interface MarketFieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

/** Filtros da grid, lidos da URL. */
export interface MarketFilters {
  /** Busca parcial por nome da Bolsa ou da versão. String vazia = sem filtro. */
  query: string;
  status: MarketStatusFilter;
  /** Recorte por vigência, inclusivo nas duas pontas. Vazio = sem limite. */
  from: string;
  to: string;
}
