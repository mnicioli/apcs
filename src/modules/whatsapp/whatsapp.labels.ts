import type {
  WhatsAppDeliveryStatus,
  WhatsAppFilter,
  WhatsAppMessageKind,
  WhatsAppMessageOrigin,
} from "./whatsapp.types";

/**
 * Todo texto PT-BR da caixa de entrada. Num arquivo só porque é aqui que se
 * confere se a tela fala a mesma língua em todo lugar — e porque um rótulo
 * espalhado em seis componentes vira seis rótulos diferentes.
 */

export const WHATSAPP_FILTER_LABELS: Record<WhatsAppFilter, string> = {
  all: "Todas",
  unread: "Não lidas",
  groups: "Grupos",
  archived: "Arquivadas",
};

export const WHATSAPP_KIND_LABELS: Record<WhatsAppMessageKind, string> = {
  text: "Mensagem",
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contact: "Contato",
  unsupported: "Mensagem não suportada",
};

/**
 * O que o atendente lê ao passar o mouse no visto de entrega.
 *
 * Escrito do ponto de vista de quem está olhando a tela, e não do protocolo:
 * "Entregue no aparelho" diz onde a mensagem está; "delivered" não diz nada
 * para quem só precisa saber se pode parar de se preocupar.
 */
export const WHATSAPP_STATUS_LABELS: Record<WhatsAppDeliveryStatus, string> = {
  pending: "Enviando…",
  sent: "Enviada",
  delivered: "Entregue no aparelho",
  read: "Lida",
  failed: "Não foi entregue",
};

/**
 * De onde a mensagem saiu. Só aparece nas que SAEM — dizer "do contato" numa
 * mensagem que obviamente é do contato é ruído.
 */
export const WHATSAPP_ORIGIN_LABELS: Record<WhatsAppMessageOrigin, string> = {
  contact: "",
  agent: "pelo sistema",
  bot: "automática",
  phone: "pelo celular",
};

/** Título e explicação de cada aba vazia. Cada uma quer dizer algo diferente. */
export const WHATSAPP_EMPTY_STATES: Record<WhatsAppFilter, string> = {
  all: "Nenhuma conversa ainda. A caixa se preenche sozinha assim que alguém escrever para o número da APCS.",
  unread: "Nada esperando resposta. Tudo que chegou já foi lido por alguém do time.",
  groups: "Nenhum grupo. Grupos aparecem aqui quando o número da APCS for adicionado a um.",
  archived: "Nada arquivado. Conversas arquivadas voltam sozinhas se a pessoa escrever de novo.",
};

export const WHATSAPP_NO_CHAT_SELECTED = "Escolha uma conversa à esquerda para ler e responder.";

/**
 * ⚠️ A frase que a tela mostra quando a integração não está configurada.
 *
 * Ela diz o que NÃO acontece ("nada entra e nada sai") antes de dizer o que
 * fazer. Sem isso, uma caixa vazia por falta de configuração é indistinguível
 * de uma caixa vazia por não ter chegado mensagem — e alguém passaria a semana
 * achando que o WhatsApp está quieto.
 */
export function whatsappNotConfigured(missing: readonly string[]): string {
  const faltando = missing.length > 0 ? ` Falta configurar: ${missing.join(", ")}.` : "";
  return `A integração de WhatsApp não está ligada: nada entra e nada sai por aqui.${faltando}`;
}

/** O aviso do anexo que não conseguimos guardar. Diz onde ele ainda existe. */
export const WHATSAPP_MEDIA_FAILED = "Não foi possível baixar este arquivo. Abra no celular.";
export const WHATSAPP_MEDIA_TOO_LARGE = "Arquivo grande demais para o sistema. Abra no celular.";
export const WHATSAPP_MEDIA_PENDING = "Baixando o arquivo…";
