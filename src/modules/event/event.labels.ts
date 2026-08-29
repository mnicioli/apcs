import type {
  EventAuditAction,
  EventEffectiveStatus,
  EventStatusFilter,
  EventStatusReason,
} from "./event.types";

/**
 * Rótulos PT-BR de Eventos. Todo texto que o usuário lê sai daqui — a UI não
 * inventa string. Sendo `Record`s completos, o TypeScript aponta cada lugar que
 * falta quando um valor novo entra num enum.
 */

/**
 * "Expirado" aparece na tela mesmo o escopo listando só ATIVO/INATIVO como
 * status. O motivo é prático: um evento marcado "Inativo" que ninguém inativou
 * faz a pessoa procurar quem foi. O FILTRO continua com três opções (Todos,
 * Ativo, Inativo) — Expirado cai dentro de Inativo.
 */
export const EVENT_STATUS_LABELS: Record<EventEffectiveStatus, string> = {
  active: "Ativo",
  inactive: "Inativo",
  expired: "Expirado",
};

export const EVENT_STATUS_FILTER_LABELS: Record<EventStatusFilter, string> = {
  all: "Todos",
  active: "Ativo",
  inactive: "Inativo",
};

export const EVENT_STATUS_REASON_LABELS: Record<EventStatusReason, string> = {
  manual: "Inativado manualmente",
  expired: "A data do evento já passou",
};

export const EVENT_AUDIT_ACTION_LABELS: Record<EventAuditAction, string> = {
  event_created: "Evento cadastrado",
  event_updated: "Evento editado",
  event_activated: "Evento ativado",
  event_deactivated: "Evento inativado",
  event_image_uploaded: "Imagem enviada",
  event_image_replaced: "Imagem substituída",
  event_segments_updated: "Público-alvo alterado",
  event_dispatch_started: "Divulgação iniciada",
  event_dispatch_completed: "Divulgação concluída",
};

/**
 * Nome de campo para a trilha de auditoria.
 *
 * O banco grava a chave em camelCase (`eventDate`); quem lê a auditoria precisa
 * ver "Data do evento". Campo desconhecido cai no próprio nome em vez de sumir:
 * um registro de auditoria incompleto é pior que um rótulo feio.
 */
const AUDIT_FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  location: "Local",
  registrationUrl: "Link de inscrição",
  eventDate: "Data do evento",
  startTime: "Hora de início",
  endTime: "Hora de término",
};

export function auditFieldLabel(field: string): string {
  return AUDIT_FIELD_LABELS[field] ?? field;
}

/**
 * A MENSAGEM QUE SAI NO WHATSAPP.
 *
 * Função pura, aqui e não no worker, pelo mesmo motivo de
 * `surveyWhatsAppMessage`: é testável sem rede, sem banco e sem fornecedor — e
 * é o texto que milhares de pessoas vão ler, então errar aqui é caro.
 *
 * ⚠️ A ÚLTIMA LINHA NÃO É ENFEITE NEM EXIGÊNCIA LEGAL DECORATIVA. Sem uma saída
 * escrita na própria mensagem, a única forma de parar de receber é bloquear o
 * número da APCS — e um número bloqueado por muita gente é um número que o
 * WhatsApp derruba. A saída explícita protege o canal, não só a pessoa.
 *
 * ⚠️ Sem `preview_url`: a Z-API sempre gera prévia de link e não há como
 * desligar (ver o adaptador). O link de inscrição vai por último de propósito —
 * a prévia que o WhatsApp monta fica embaixo, sem empurrar data e local para
 * fora da primeira tela.
 */
export function eventWhatsAppMessage(event: {
  name: string;
  location: string;
  eventDate: string;
  startTime: string;
  endTime: string | null;
  registrationUrl: string | null;
}): string {
  const linhas = [
    "*APCS — Associação Paulista de Criadores de Suínos*",
    "",
    `*${event.name}*`,
    "",
    // ⚠️ UM RÓTULO POR LINHA, e não tudo junto numa frase. A mensagem chega
    // numa tela de celular, e "Data" / "Horário" / "Local" alinhados são o que
    // permite conferir o dia sem ler o texto inteiro. Era isso que faltava: os
    // dados estavam lá, grudados numa linha só, e quem batia o olho não achava.
    `📅 *Data:* ${formatEventDateBr(event.eventDate)}`,
    `🕒 *Horário:* ${eventTimeRangeBr(event.startTime, event.endTime)}`,
    `📍 *Local:* ${event.location}`,
  ];

  if (event.registrationUrl) {
    // ⚠️ O LINK VAI SOZINHO NA ÚLTIMA LINHA. A Z-API sempre gera prévia e não
    // há como desligar; com a URL no meio de uma frase, o cartão que o WhatsApp
    // monta empurra data e local para fora da primeira tela.
    linhas.push("", "🔗 *Inscrições:*", event.registrationUrl);
  }

  linhas.push("", "Para não receber mais avisos da APCS, responda SAIR.");

  return linhas.join("\n");
}

/**
 * `"19:00"` + `"22:00"` → `"19:00 às 22:00"`. Sem término → `"a partir das 19:00"`.
 *
 * ⚠️ "A PARTIR DAS", e não o horário nu. Um `🕒 Horário: 19:00` sozinho é lido
 * como "acaba às 19h" com a mesma facilidade com que é lido como "começa às
 * 19h" — e quem chega às 18h30 num evento que já acabou não volta.
 */
export function eventTimeRangeBr(startTime: string, endTime: string | null): string {
  return endTime ? `${startTime} às ${endTime}` : `a partir das ${startTime}`;
}

/**
 * `2026-09-01` → `01/09/2026`.
 *
 * ⚠️ RECORTE DE STRING, e não `new Date()`. `eventDate` é data pura, sem hora e
 * sem fuso; passá-la por `Date` a interpreta como meia-noite UTC e, no fuso de
 * São Paulo, devolve o dia ANTERIOR. Um evento anunciado com um dia de
 * antecedência errado é o tipo de defeito que só aparece depois de enviado.
 */
export function formatEventDateBr(isoDate: string): string {
  const [ano, mes, dia] = isoDate.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : isoDate;
}

/** Texto das confirmações de ativação e inativação (itens 22 do escopo). */
export const EVENT_CONFIRMATION_COPY = {
  activate:
    "Deseja ativar este evento? Ele poderá ser disponibilizado para consulta e " +
    "comunicação aos associados conforme sua segmentação.",
  deactivate:
    "Deseja realmente inativar este evento? Eventos inativos não serão " +
    "disponibilizados para o chatbot e futuras comunicações.",
} as const;
