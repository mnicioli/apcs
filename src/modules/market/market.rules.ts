import { normalizeForSearch } from "@/lib/utils";
import type {
  MarketBulletinSummary,
  MarketBulletinVersion,
  MarketFilters,
  MarketVersionSituation,
} from "./market.types";

/**
 * As regras da Bolsa — puras, sem I/O, testáveis uma a uma.
 *
 * O que é regra de NEGÓCIO com consequência de escrita (uma versão ativa por
 * vez, numeração que nunca reusa, sufixo do segundo envio do dia, a Bolsa nunca
 * sem versão ativa) vive no BANCO, porque é lá que a garantia precisa valer
 * mesmo com duas telas concorrentes. O que está aqui é a LEITURA dessas regras:
 * como ordenar, como filtrar, o que exibir, quem o chatbot pode citar.
 *
 * `buildVersionName` e `nextVersionNumber` espelham o que as funções do
 * Postgres fazem, e existem para o comportamento poder ser verificado sem banco.
 * ⚠️ Quando as duas discordarem, o banco é quem está certo — ele é o único que
 * enxerga as outras versões.
 */

/**
 * Os meses como a APCS os escreve.
 *
 * Lista explícita, e não `Intl`/`toLocaleString`: o formato de mês abreviado
 * varia entre runtimes (alguns devolvem "ago.", com ponto) e mudaria a
 * identidade da publicação conforme onde o código roda. A MESMA lista está na
 * função `market_bulletin_version_name` do Postgres.
 */
const MONTHS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

/**
 * A identidade funcional de uma publicação: "Bolsa_12Ago26".
 *
 * Recebe AAAA-MM-DD e recorta a string — nunca passa por `Date`. `new
 * Date("2026-08-12")` é meia-noite UTC, que em São Paulo é 21h do dia ANTERIOR:
 * a publicação do dia 12 viraria "Bolsa_11Ago26".
 *
 * ⚠️ NÃO trata o sufixo do segundo envio do dia ("-2"). Isso depende de saber
 * o que já existe naquela Bolsa, e quem sabe é o banco. Aqui o resultado serve
 * para PREVER o nome na tela e para testar o formato.
 */
export function buildVersionName(isoDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;

  const [, year, month, day] = match;
  // O regex garante os três grupos, mas `noUncheckedIndexedAccess` não sabe
  // disso — e a checagem custa nada perto de gravar "Bolsa_undefined".
  if (!year || !month || !day) return null;

  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return null;

  return `Bolsa_${day}${monthName}${year.slice(2)}`;
}

/**
 * O próximo número da sequência.
 *
 * É `maior + 1`, nunca `quantidade + 1`: versões não são apagadas, então o
 * maior número já visto é a memória da sequência. É por isso que reativar a v1
 * quando existem v1..v3 ainda produz v4 — reativar não devolve um número ao
 * estoque.
 */
export function nextVersionNumber(
  versions: readonly Pick<MarketBulletinVersion, "version">[],
): number {
  return versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
}

/**
 * A publicação já entrou em vigor?
 *
 * Comparação de string em AAAA-MM-DD é a comparação de calendário — o formato é
 * ordenável por construção, e não há fuso envolvido.
 */
export function isEffective(
  version: Pick<MarketBulletinVersion, "effectiveDate">,
  today: string,
): boolean {
  return version.effectiveDate <= today;
}

/**
 * O estado que a tela mostra, com status e vigência já combinados.
 *
 * ATIVA ≠ VIGENTE: uma publicação escolhida hoje para valer dia 15 é
 * `scheduled`. Ela é a versão oficial, e ainda assim o chatbot não pode citá-la.
 */
export function versionSituation(
  version: Pick<MarketBulletinVersion, "status" | "effectiveDate">,
  today: string,
): MarketVersionSituation {
  if (version.status !== "active") return "historical";
  return isEffective(version, today) ? "current" : "scheduled";
}

/** Da mais nova para a mais antiga — a ordem em que o histórico é lido. */
export function compareVersionsDesc(
  a: Pick<MarketBulletinVersion, "version">,
  b: Pick<MarketBulletinVersion, "version">,
): number {
  return b.version - a.version;
}

/**
 * A versão ativa, ou `null`.
 *
 * O banco garante que existe no máximo UMA (índice único parcial), então
 * `find` não esconde ambiguidade nenhuma: se houver duas, o problema aconteceu
 * antes, e nenhuma escolha aqui consertaria.
 */
export function activeVersion(
  versions: readonly MarketBulletinVersion[],
): MarketBulletinVersion | null {
  return versions.find((v) => v.status === "active") ?? null;
}

/**
 * Esta versão pode ser inativada?
 *
 * ⚠️ A REGRA QUE SEPARA A BOLSA DAS NORMATIVAS: a Bolsa nunca fica sem versão
 * ativa. Como só existe uma ativa por vez, inativar "a ativa" é exatamente o que
 * deixaria a Bolsa vazia — então a resposta é sempre não.
 *
 * Para trocar a versão oficial, ATIVE a outra: ativar já inativa a anterior na
 * mesma transação. O banco impõe o mesmo (MB001); isto aqui existe para a tela
 * não oferecer um botão que só serve para dar erro.
 */
export function canDeactivateVersion(version: Pick<MarketBulletinVersion, "status">): boolean {
  return version.status !== "active";
}

/**
 * A PORTA DO CHATBOT, em forma de regra pura.
 *
 * As três condições, e nenhuma a menos:
 *   1. a Bolsa permite consumo por robô (`chatbotEnabled`);
 *   2. a versão é a ATIVA;
 *   3. a vigência já chegou.
 *
 * Não existe caminho aqui que devolva "a anterior" quando a atual não serve.
 * Citar um boletim de preço que ainda não vale — ou que foi substituído — é
 * pior do que dizer "não tenho essa informação agora".
 */
export function isAvailableForChatbot(
  bulletin: Pick<MarketBulletinSummary, "chatbotEnabled">,
  version: Pick<MarketBulletinVersion, "status" | "effectiveDate"> | null,
  today: string,
): boolean {
  if (!bulletin.chatbotEnabled) return false;
  if (!version) return false;
  return version.status === "active" && isEffective(version, today);
}

/** Busca parcial pelo nome da Bolsa. Vazio = passa tudo. */
export function matchesBulletinFilters(
  bulletin: Pick<MarketBulletinSummary, "name">,
  filters: Pick<MarketFilters, "query">,
): boolean {
  const query = normalizeForSearch(filters.query);
  if (!query) return true;

  return normalizeForSearch(bulletin.name).includes(query);
}

/**
 * O recorte do HISTÓRICO: nome da versão, status e faixa de vigência.
 *
 * A busca por nome passa por `normalizeForSearch` pelo mesmo motivo do resto do
 * sistema: ninguém digita acento numa caixa de busca. Aqui isso quase não pesa
 * ("Bolsa_12Ago26" não tem acento), mas uma regra só, valendo em todo lugar, é
 * mais fácil de confiar do que uma exceção a lembrar.
 */
export function matchesVersionFilters(
  version: Pick<MarketBulletinVersion, "versionName" | "status" | "effectiveDate">,
  filters: MarketFilters,
): boolean {
  if (filters.status !== "all" && version.status !== filters.status) return false;
  if (filters.from && version.effectiveDate < filters.from) return false;
  if (filters.to && version.effectiveDate > filters.to) return false;

  const query = normalizeForSearch(filters.query);
  if (!query) return true;

  return normalizeForSearch(version.versionName).includes(query);
}

/** Ordem alfabética pelo nome, com as regras do português. */
export function compareBulletins(
  a: Pick<MarketBulletinSummary, "name">,
  b: Pick<MarketBulletinSummary, "name">,
): number {
  return a.name.localeCompare(b.name, "pt-BR");
}
