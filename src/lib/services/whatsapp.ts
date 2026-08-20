import "server-only";
import { createClient } from "@/lib/supabase/server";
import { messagingProvider } from "@/lib/messaging/registry";
import type {
  WhatsAppChat,
  WhatsAppConversation,
  WhatsAppCounts,
  WhatsAppFilter,
  WhatsAppIntegrationStatus,
  WhatsAppMessage,
} from "@/modules/whatsapp/whatsapp.types";

/**
 * SERVICE = leitura. Retorna o dado ou LANÇA erro (o caller decide como tratar).
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 *
 * A RLS de `whatsapp_chats` e `whatsapp_messages` é quem autoriza: este arquivo
 * usa o cliente do USUÁRIO, nunca o `service_role`. Quem não pode ler a caixa
 * recebe lista vazia do próprio Postgres, e não uma checagem que alguém aqui
 * poderia esquecer de escrever.
 */

const MEDIA_BUCKET = "whatsapp-media";

/**
 * Vida da URL assinada do anexo.
 *
 * Curta porque o conteúdo é o mais sensível do sistema (documento pessoal, foto,
 * áudio de reclamação) e a URL, uma vez gerada, vale para quem a tiver. Uma hora
 * cobre folgadamente ler uma conversa e baixar o que precisa.
 */
const MEDIA_URL_TTL_SECONDS = 60 * 60;

/**
 * Teto da lista de conversas.
 *
 * ⚠️ Não há paginação, e é uma decisão. Uma caixa de entrada é usada com busca e
 * rolagem, não com "página 3" — ninguém procura uma conversa por número de
 * página. O teto existe para a tela não tentar desenhar dez mil linhas; quando
 * ele é atingido, a tela DIZ isso e pede para usar a busca.
 */
const MAX_CHATS = 200;

/** Teto da transcrição carregada de uma vez. */
const MAX_MESSAGES = 300;

interface ChatRow {
  id: string;
  phone: string | null;
  is_group: boolean;
  name: string | null;
  photo_url: string | null;
  contact_id: string | null;
  member_id: string | null;
  unread_count: number;
  archived: boolean;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_from_me: boolean | null;
}

const CHAT_COLUMNS =
  "id, phone, is_group, name, photo_url, contact_id, member_id, unread_count, archived, last_message_at, last_message_preview, last_message_from_me";

function toChat(row: ChatRow): WhatsAppChat {
  return {
    id: row.id,
    phone: row.phone,
    isGroup: row.is_group,
    name: row.name,
    photoUrl: row.photo_url,
    contactId: row.contact_id,
    memberId: row.member_id,
    unreadCount: row.unread_count,
    archived: row.archived,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    lastMessageFromMe: row.last_message_from_me,
  };
}

/**
 * Aplica o recorte de uma aba.
 *
 * ⚠️ SÓ "Arquivadas" MOSTRA ARQUIVADAS. As outras três excluem — inclusive
 * "Todas", que quer dizer "todas as ativas". Uma conversa arquivada aparecendo
 * em "Não lidas" desfaria o único efeito de arquivar.
 */
type ChatQuery = ReturnType<ReturnType<typeof filtroBase>>;

function filtroBase(
  supabase: Awaited<ReturnType<typeof createClient>>,
): (filter: WhatsAppFilter, options?: { head?: boolean }) => ReturnType<typeof build> {
  function build(filter: WhatsAppFilter, options: { head?: boolean } = {}) {
    let query = supabase
      .from("whatsapp_chats")
      .select(
        options.head ? "id" : CHAT_COLUMNS,
        options.head ? { count: "exact", head: true } : {},
      );

    query = filter === "archived" ? query.eq("archived", true) : query.eq("archived", false);
    if (filter === "unread") query = query.gt("unread_count", 0);
    if (filter === "groups") query = query.eq("is_group", true);

    return query;
  }
  return build;
}

/**
 * A busca por nome ou telefone.
 *
 * ⚠️ O TERMO É ESCAPADO ANTES DE ENTRAR NO `ilike`. Sem isto, um `%` digitado
 * casa com tudo e uma `,` quebra o parser do PostgREST — o que transforma uma
 * busca inocente em erro 400 na cara de quem digitou.
 */
function termoDeBusca(search: string): string | null {
  const limpo = search
    .trim()
    .replace(/[%_,()]/g, " ")
    .trim();
  return limpo.length > 0 ? limpo : null;
}

export interface WhatsAppInbox {
  items: WhatsAppChat[];
  counts: WhatsAppCounts;
  /** `true` quando a lista bateu no teto: pode haver conversa fora dela. */
  truncated: boolean;
}

export async function listWhatsAppChats(
  filter: WhatsAppFilter,
  search = "",
): Promise<WhatsAppInbox> {
  const supabase = await createClient();
  const build = filtroBase(supabase);
  const termo = termoDeBusca(search);

  function comBusca<T extends ChatQuery>(query: T): T {
    if (!termo) return query;
    // Só dígitos no telefone: quem procura "54 99123" está procurando o número,
    // e o banco guarda `5554991234567`.
    const digitos = termo.replace(/\D/g, "");
    const alvos = [`name.ilike.%${termo}%`];
    if (digitos.length >= 3) alvos.push(`phone.ilike.%${digitos}%`);
    return query.or(alvos.join(",")) as T;
  }

  // As quatro contagens e a lista em PARALELO: são independentes, e somá-las em
  // série atrasaria a tela por nada. As contagens ignoram a busca de propósito —
  // o número na aba responde "quanto há ali", não "quanto há ali do que digitei".
  const [lista, todas, naoLidas, grupos, arquivadas] = await Promise.all([
    comBusca(build(filter))
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(MAX_CHATS)
      .returns<ChatRow[]>(),
    build("all", { head: true }),
    build("unread", { head: true }),
    build("groups", { head: true }),
    build("archived", { head: true }),
  ]);

  if (lista.error) {
    console.error(`[whatsapp] listWhatsAppChats falhou: ${lista.error.message}`);
    throw lista.error;
  }

  const rows = lista.data ?? [];

  return {
    items: rows.map(toChat),
    counts: {
      all: todas.count ?? 0,
      unread: naoLidas.count ?? 0,
      groups: grupos.count ?? 0,
      archived: arquivadas.count ?? 0,
    },
    truncated: rows.length >= MAX_CHATS,
  };
}

interface MessageRow {
  id: string;
  direction: WhatsAppMessage["direction"];
  origin: WhatsAppMessage["origin"];
  kind: WhatsAppMessage["kind"];
  body: string;
  sender_name: string | null;
  participant_phone: string | null;
  status: WhatsAppMessage["status"];
  error_message: string | null;
  occurred_at: string;
  media_status: NonNullable<WhatsAppMessage["media"]>["status"] | null;
  media_path: string | null;
  media_mime: string | null;
  media_file_name: string | null;
  media_size_bytes: number | null;
  media_duration_seconds: number | null;
  sender: { full_name: string | null } | null;
}

/**
 * A conversa aberta: a linha da lista mais a transcrição.
 *
 * Devolve `null` — e não lança — quando a conversa não existe OU quando a RLS a
 * escondeu. São indistinguíveis de fora, e é o certo: dizer "existe, mas você
 * não pode ver" já conta que ela existe.
 */
export async function getWhatsAppConversation(
  chatId: string,
): Promise<WhatsAppConversation | null> {
  const supabase = await createClient();

  const { data: chat, error: chatError } = await supabase
    .from("whatsapp_chats")
    .select(CHAT_COLUMNS)
    .eq("id", chatId)
    .returns<ChatRow[]>()
    .maybeSingle();

  if (chatError) {
    console.error(`[whatsapp] getWhatsAppConversation falhou: ${chatError.message}`);
    throw chatError;
  }
  if (!chat) return null;

  // ⚠️ ORDENA POR `seq`, NUNCA POR `occurred_at`. O carimbo vem do fornecedor
  // com granularidade de segundo: duas mensagens seguidas empatam e a ordem
  // sairia indefinida — a conversa apareceria embaralhada de vez em quando, que
  // é o tipo de defeito que ninguém consegue reproduzir.
  //
  // Desce (as mais novas) para pegar as últimas `MAX_MESSAGES`, e a tela
  // reinverte: numa conversa de dois anos, o começo não é o que interessa.
  const { data: mensagens, error: msgError } = await supabase
    .from("whatsapp_messages")
    .select(
      "id, direction, origin, kind, body, sender_name, participant_phone, status, error_message, occurred_at, media_status, media_path, media_mime, media_file_name, media_size_bytes, media_duration_seconds, sender:profiles!whatsapp_messages_sent_by_fkey(full_name)",
    )
    .eq("chat_id", chatId)
    .order("seq", { ascending: false })
    .limit(MAX_MESSAGES)
    .returns<MessageRow[]>();

  if (msgError) {
    console.error(`[whatsapp] transcrição falhou: ${msgError.message}`);
    throw msgError;
  }

  const rows = (mensagens ?? []).slice().reverse();
  const urls = await signMediaUrls(
    supabase,
    rows.filter((r) => r.media_status === "stored" && r.media_path).map((r) => r.media_path!),
  );

  return {
    ...toChat(chat),
    messages: rows.map((row) => toMessage(row, urls)),
  };
}

function toMessage(row: MessageRow, urls: Map<string, string>): WhatsAppMessage {
  return {
    id: row.id,
    direction: row.direction,
    origin: row.origin,
    kind: row.kind,
    body: row.body,
    senderName: row.sender_name,
    participantPhone: row.participant_phone,
    status: row.status,
    errorMessage: row.error_message,
    sentByName: row.sender?.full_name ?? null,
    occurredAt: row.occurred_at,
    media: row.media_status
      ? {
          status: row.media_status,
          url: row.media_path ? (urls.get(row.media_path) ?? null) : null,
          mimeType: row.media_mime,
          fileName: row.media_file_name,
          sizeBytes: row.media_size_bytes,
          durationSeconds: row.media_duration_seconds,
        }
      : null,
  };
}

/**
 * URLs assinadas para todos os anexos da conversa de uma vez.
 *
 * Uma chamada, e não uma por mensagem: uma conversa com trinta fotos seriam
 * trinta idas ao Storage no meio da renderização. Falha devolve `null` para o
 * anexo afetado — a conversa continua legível com um aviso no lugar da imagem,
 * que é infinitamente melhor que a página inteira não carregar.
 */
async function signMediaUrls(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;

  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(paths, MEDIA_URL_TTL_SECONDS);

  if (error) {
    console.error(`[whatsapp] URLs assinadas falharam: ${error.message}`);
    return urls;
  }

  for (const item of data ?? []) {
    if (item.signedUrl && item.path) urls.set(item.path, item.signedUrl);
  }

  return urls;
}

/**
 * O contador do menu: quantas conversas têm mensagem não lida.
 *
 * Devolve 0 em vez de lançar. Ele é apurado no layout de TODAS as telas do
 * sistema — um contador indisponível não pode derrubar o menu inteiro.
 */
export async function countUnreadWhatsAppChats(): Promise<number> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("whatsapp_unread_total");
    if (error) {
      console.error(`[whatsapp] contador falhou: ${error.message}`);
      return 0;
    }
    return typeof data === "number" ? data : 0;
  } catch (error) {
    console.error(`[whatsapp] contador indisponível: ${String(error)}`);
    return 0;
  }
}

/**
 * O estado da integração, para a tela poder ser honesta.
 *
 * ⚠️ NÃO É COSMÉTICO. Sem isto, uma caixa vazia porque ninguém configurou o
 * fornecedor é visualmente idêntica a uma caixa vazia porque ninguém escreveu —
 * e alguém passaria a semana achando que o WhatsApp está quieto.
 *
 * Lê só nome e estado do adaptador. Nenhum segredo sai daqui: `missing` é uma
 * lista de NOMES de variáveis, nunca de valores.
 */
export function whatsAppIntegrationStatus(): WhatsAppIntegrationStatus {
  const provider = messagingProvider();
  return {
    provider: provider.name,
    configured: provider.configured,
    missing: provider.missing,
  };
}
