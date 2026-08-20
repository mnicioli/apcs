import { DEFAULT_WHATSAPP_FILTER, isWhatsAppFilter, type WhatsAppFilter } from "./whatsapp.types";

/**
 * As URLs da caixa de entrada.
 *
 * ⚠️ A CONVERSA ABERTA É UM PARÂMETRO DA URL, E NÃO ESTADO DE COMPONENTE.
 *
 * Poderia ser `useState` — a tela tem duas colunas e nada obriga a mudar de
 * rota. Mas aí colar o endereço no WhatsApp do time abriria a caixa vazia, o
 * botão "voltar" do navegador sairia da tela inteira em vez de fechar a
 * conversa, e recarregar a página perderia onde a pessoa estava. Uma caixa de
 * entrada é o tipo de tela em que alguém manda link para o colega o dia todo.
 */

export const WHATSAPP_BASE = "/whatsapp";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWhatsAppId(value: string): boolean {
  return UUID.test(value);
}

export interface WhatsAppParams {
  filter: WhatsAppFilter;
  search: string;
  /** A conversa aberta, quando há uma. */
  chatId: string | null;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Lê a URL sem nunca quebrar a tela: filtro desconhecido vira "Todas", id que
 * não é uuid vira "nenhuma conversa aberta". Um link velho colado no grupo do
 * time tem de mostrar a caixa, não um erro.
 */
export function parseWhatsAppParams(params: RawParams): WhatsAppParams {
  const filtroBruto = first(params["filtro"]) ?? "";
  const chatBruto = first(params["conversa"]) ?? "";

  return {
    filter: isWhatsAppFilter(filtroBruto) ? filtroBruto : DEFAULT_WHATSAPP_FILTER,
    search: (first(params["q"]) ?? "").trim(),
    chatId: isWhatsAppId(chatBruto) ? chatBruto : null,
  };
}

/**
 * Monta um endereço preservando o que já estava aplicado.
 *
 * ⚠️ TROCAR DE ABA OU DE BUSCA FECHA A CONVERSA ABERTA, de propósito: a
 * conversa que estava na tela quase nunca está na aba nova, e deixá-la aberta
 * mostraria uma transcrição que não corresponde a nenhuma linha da lista ao
 * lado. O oposto vale: abrir uma conversa não mexe no filtro.
 */
export function whatsappHref(atual: WhatsAppParams, mudanca: Partial<WhatsAppParams>): string {
  const mudouRecorte = mudanca.filter !== undefined || mudanca.search !== undefined;

  const filter = mudanca.filter ?? atual.filter;
  const search = mudanca.search ?? atual.search;
  const chatId = mudanca.chatId !== undefined ? mudanca.chatId : mudouRecorte ? null : atual.chatId;

  const query = new URLSearchParams();
  if (filter !== DEFAULT_WHATSAPP_FILTER) query.set("filtro", filter);
  if (search) query.set("q", search);
  if (chatId) query.set("conversa", chatId);

  const qs = query.toString();
  return qs ? `${WHATSAPP_BASE}?${qs}` : WHATSAPP_BASE;
}
