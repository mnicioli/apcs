import type {
  MarketAuditAction,
  MarketChatbotFilter,
  MarketStatusFilter,
  MarketStatusReason,
  MarketVersionSituation,
  MarketVersionStatus,
} from "./market.types";

/**
 * Rótulos PT-BR da Bolsa. Ficam aqui, e não espalhados pelas telas, para o
 * vocabulário ser um só: se a grid diz "Vigente", o histórico e o filtro dizem
 * "Vigente" — é assim que a pessoa aprende a se localizar no sistema.
 *
 * É também o único lugar onde `MarketBulletin` vira "Bolsa": o código fala
 * inglês, a tela fala português.
 */

export const MARKET_MODULE_TITLE = "Bolsa";

export const MARKET_MODULE_SUBTITLE =
  "Os boletins de preço da APCS. A versão vigente é a que o chatbot pode citar.";

/** No singular, para frases como "Esta Bolsa ainda não tem publicação". */
export const MARKET_BULLETIN_LABEL = "Bolsa";

/** Uma publicação — o par imagem + PDF. */
export const MARKET_VERSION_LABEL = "publicação";

export const MARKET_STATUS_LABELS: Record<MarketVersionStatus, string> = {
  active: "Ativa",
  inactive: "Inativa",
};

/**
 * O filtro de status da GRID, e os rótulos não são "Ativa/Inativa" à toa.
 *
 * Como a Bolsa não pode ficar sem publicação ativa, o que este filtro de fato
 * separa é "já publicada" de "cadastrada e ainda esperando a primeira". Dizer
 * "Inativa" mandaria a pessoa procurar uma Bolsa desligada, que não existe.
 */
export const MARKET_STATUS_FILTER_LABELS: Record<MarketStatusFilter, string> = {
  all: "Todas",
  active: "Com publicação",
  inactive: "Sem publicação",
};

export const MARKET_CHATBOT_FILTER_LABELS: Record<MarketChatbotFilter, string> = {
  all: "Todas",
  available: "Disponível",
  unavailable: "Não disponível",
};

/**
 * A situação combina status e vigência, e é o que a pessoa realmente precisa
 * ler.
 *
 * "Ativa" sozinho engana: uma publicação escolhida hoje para valer dia 15 está
 * ativa e o chatbot não a cita. "Programada" diz isso sem exigir que ninguém
 * cruze duas colunas de cabeça.
 */
export const MARKET_SITUATION_LABELS: Record<MarketVersionSituation, string> = {
  current: "Vigente",
  scheduled: "Programada",
  historical: "Histórica",
};

export const MARKET_SITUATION_HINTS: Record<MarketVersionSituation, string> = {
  current: "É a publicação oficial e já está valendo.",
  scheduled: "É a publicação oficial, mas só passa a valer na data de vigência.",
  historical: "Foi substituída. Continua no acervo e pode ser reativada.",
};

export const MARKET_STATUS_REASON_LABELS: Record<MarketStatusReason, string> = {
  superseded: "Substituída por outra publicação",
  manual: "Inativada manualmente",
};

/**
 * A trilha em linguagem de quem lê o histórico.
 *
 * Sem jargão de banco: quem abre a auditoria quer saber o que aconteceu, não
 * qual enum foi gravado.
 */
export const MARKET_AUDIT_ACTION_LABELS: Record<MarketAuditAction, string> = {
  bulletin_created: "Bolsa cadastrada",
  bulletin_updated: "Cadastro alterado",
  version_uploaded: "Publicação enviada",
  version_activated: "Publicação ativada",
  version_deactivated: "Publicação inativada",
  version_viewed: "Arquivo visualizado",
  version_downloaded: "Arquivo baixado",
};

/**
 * O aviso que precede a troca da versão oficial.
 *
 * Nomeia a CONSEQUÊNCIA, não a mecânica: o que muda de verdade não é uma
 * coluna de status, é qual boletim de preço a APCS passa a apresentar.
 */
export const MARKET_ACTIVATE_WARNING =
  "Ao ativar esta publicação, a que está ativa hoje será automaticamente inativada. " +
  "Apenas uma publicação da Bolsa pode permanecer ativa.";

/**
 * O motivo de "Inativar" não estar disponível na publicação ativa.
 *
 * Diz o que FAZER, e não só o que é proibido — quem quer trocar a publicação
 * oficial precisa saber que o caminho é ativar a outra.
 */
export const MARKET_DEACTIVATE_BLOCKED =
  "A Bolsa não pode ficar sem uma publicação ativa. Para trocar a publicação oficial, " +
  "ative a desejada — a atual sai do ar automaticamente.";

/** "Disponível para o chatbot" na grid. */
export function chatbotAvailabilityLabel(available: boolean): string {
  return available ? "Sim" : "Não";
}
