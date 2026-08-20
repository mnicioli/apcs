import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { maskPhone, sameWhatsAppNumber } from "@/lib/messaging/phone";
import { fetchWithTimeout } from "@/lib/messaging/resilience";
import { logWhatsAppEvent } from "@/lib/messaging/telemetry";
import type { InboundEvent, InboundMedia } from "@/lib/messaging/messaging.types";
import type { WhatsAppMessageKind } from "@/modules/whatsapp/whatsapp.types";

/**
 * O QUE ACONTECE QUANDO UMA MENSAGEM CHEGA NO NÚMERO DA APCS.
 *
 * O webhook é fino de propósito: confere o segredo da URL e entrega os eventos
 * aqui. Toda a gravação mora neste arquivo, que não sabe o que é um header HTTP.
 *
 * ⚠️ ESTE SERVIÇO É O LIVRO-RAZÃO, E ELE VEM ANTES DE TODO MUNDO.
 *
 * A ordem no webhook é: grava aqui → depois entrega o mesmo evento às Enquetes.
 * Se fosse o contrário, uma mensagem que o fluxo de enquete consumisse
 * ("respondeu 3") poderia não aparecer para o atendente — e ele estaria olhando
 * uma conversa com um buraco no meio, sem nenhuma indicação de que há um buraco.
 *
 * ⚠️ NADA AQUI LANÇA PARA FORA. Uma exceção viraria um 500, a Z-API
 * reentregaria o mesmo payload, e o resultado seria um laço de reentrega sobre
 * um erro que não se resolve sozinho. Cada evento é tratado por conta própria.
 */

/**
 * Teto do anexo que guardamos. É o mesmo `file_size_limit` do bucket, e tem de
 * continuar sendo: um teto menor aqui só adiaria a recusa para o Storage, e um
 * maior faria o upload falhar depois de baixar 40 MB à toa.
 */
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

/** Um anexo demora; a resposta ao webhook, não. Ver `downloadPendingMedia`. */
const MEDIA_TIMEOUT_MS = 30_000;

const MEDIA_BUCKET = "whatsapp-media";

export interface PendingMedia {
  messageId: string;
  chatId: string;
  media: InboundMedia;
}

export interface WhatsAppInboxOutcome {
  recorded: number;
  duplicates: number;
  statuses: number;
  ignored: number;
  /** Anexos para baixar DEPOIS de a resposta HTTP ter saído. */
  pendingMedia: PendingMedia[];
}

export async function recordInboundEvents(
  events: readonly InboundEvent[],
  providerName: string,
  correlationId: string,
): Promise<WhatsAppInboxOutcome> {
  const resultado: WhatsAppInboxOutcome = {
    recorded: 0,
    duplicates: 0,
    statuses: 0,
    ignored: 0,
    pendingMedia: [],
  };

  for (const evento of events) {
    try {
      if (evento.kind === "status") {
        const aplicou = await aplicarStatus(evento, providerName, correlationId);
        if (aplicou) resultado.statuses += 1;
        else resultado.ignored += 1;
        continue;
      }

      const gravada = await gravarMensagem(evento, providerName, correlationId);
      if (!gravada) {
        resultado.ignored += 1;
      } else if (gravada.duplicate) {
        resultado.duplicates += 1;
      } else {
        resultado.recorded += 1;
        if (gravada.pending) resultado.pendingMedia.push(gravada.pending);
      }
    } catch (error) {
      resultado.ignored += 1;
      logWhatsAppEvent("error", "inbox.message_ignored", {
        correlationId,
        provider: providerName,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// A mensagem
// ---------------------------------------------------------------------------

interface Gravacao {
  messageId: string;
  chatId: string;
  duplicate: boolean;
  pending: PendingMedia | null;
}

async function gravarMensagem(
  evento: Extract<InboundEvent, { kind: "message" }>,
  providerName: string,
  correlationId: string,
): Promise<Gravacao | null> {
  const admin = createAdminClient();
  const conversa = evento.conversation;
  const isGroup = conversa?.isGroup ?? false;

  // Em grupo o telefone do chat é o id do grupo, e ninguém liga um grupo a um
  // cadastro. Fora de grupo, o `from` É o telefone.
  const phone = isGroup ? null : evento.from;
  const contactId = phone ? await resolverContato(phone) : null;

  const media = evento.media ?? null;
  const kind = tipoDaMensagem(evento.text, media);
  const mediaStatus = media ? avaliarMidia(media) : null;

  const { data, error } = await admin.rpc("whatsapp_record_inbound_message", {
    p_provider: providerName,
    p_chat_key: evento.from,
    p_from_me: conversa?.fromMe ?? false,
    p_provider_message_id: evento.eventId,
    p_body: evento.text,
    p_kind: kind,
    p_phone: phone,
    p_is_group: isGroup,
    p_chat_name: conversa?.chatName ?? null,
    p_photo_url: conversa?.photoUrl ?? null,
    p_sender_name: conversa?.senderName ?? null,
    p_participant_phone: conversa?.participantPhone ?? null,
    p_reply_to: evento.replyToMessageId,
    p_contact_id: contactId,
    p_media_status: mediaStatus,
    p_media_url: media?.url ?? null,
    p_media_mime: media?.mimeType ?? null,
    p_media_file_name: media?.fileName ?? null,
    p_media_duration_seconds: media?.durationSeconds ?? null,
    p_occurred_at: paraIso(evento.timestamp),
    // Descompasso de generics ssr/supabase-js. Ver CONVENTIONS.md.
  } as never);

  if (error) {
    logWhatsAppEvent("error", "inbox.message_ignored", {
      correlationId,
      provider: providerName,
      providerMessageId: evento.eventId,
      reason: `${error.code ?? ""} ${error.message}`.trim(),
    });
    return null;
  }

  const linha = (data as { message_id: string; chat_id: string; duplicate: boolean }[] | null)?.[0];
  if (!linha?.message_id) {
    logWhatsAppEvent("error", "inbox.message_ignored", {
      correlationId,
      provider: providerName,
      providerMessageId: evento.eventId,
      reason: "o banco não devolveu a linha gravada",
    });
    return null;
  }

  logWhatsAppEvent("info", linha.duplicate ? "inbox.message_duplicate" : "inbox.message_recorded", {
    correlationId,
    provider: providerName,
    chatId: linha.chat_id,
    messageId: linha.message_id,
    phone: maskPhone(phone),
    outcome: kind,
  });

  return {
    messageId: linha.message_id,
    chatId: linha.chat_id,
    duplicate: linha.duplicate,
    // Reentrega não rebaixa nada, mas TAMBÉM não rebaixa o anexo: se o download
    // falhou na primeira volta, a segunda é uma chance de graça de acertar.
    pending:
      media && mediaStatus === "pending"
        ? { messageId: linha.message_id, chatId: linha.chat_id, media }
        : null,
  };
}

/**
 * O tipo, decidido AQUI e não pelo fornecedor.
 *
 * `unsupported` é o caso que importa: uma mensagem sem texto e sem anexo
 * reconhecido é algo que chegou e que não sabemos exibir — uma enquete do
 * WhatsApp, um pedido do catálogo, um tipo que a Meta lançou esta semana. Ela
 * PRECISA aparecer na conversa como "chegou algo aqui", porque o atendente vai
 * responder a uma pergunta que não consegue ver.
 */
function tipoDaMensagem(text: string, media: InboundMedia | null): WhatsAppMessageKind {
  if (media) return media.kind;
  return text.trim() === "" ? "unsupported" : "text";
}

/**
 * O anexo entra como `pending` (vamos baixar) ou já recusado com o motivo.
 *
 * ⚠️ SEM `content-length` NÃO DÁ PARA DECIDIR AQUI. A Z-API nem sempre informa
 * o tamanho no payload, então o teto real é aplicado durante o download — este
 * passo só recusa o que já dá para recusar sem gastar rede.
 */
function avaliarMidia(media: InboundMedia): "pending" | "unsupported" {
  return media.url.startsWith("https://") ? "pending" : "unsupported";
}

// ---------------------------------------------------------------------------
// O status
// ---------------------------------------------------------------------------

async function aplicarStatus(
  evento: Extract<InboundEvent, { kind: "status" }>,
  providerName: string,
  correlationId: string,
): Promise<boolean> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("whatsapp_mark_message_status", {
    p_provider: providerName,
    p_provider_message_id: evento.providerMessageId,
    p_status: evento.status === "failed" ? "failed" : evento.status,
    p_error: evento.errorMessage,
    p_occurred_at: paraIso(evento.timestamp),
  } as never);

  if (error) {
    logWhatsAppEvent("error", "inbox.status_applied", {
      correlationId,
      provider: providerName,
      providerMessageId: evento.providerMessageId,
      reason: `${error.code ?? ""} ${error.message}`.trim(),
    });
    return false;
  }

  const aplicou = data === true;

  logWhatsAppEvent("info", "inbox.status_applied", {
    correlationId,
    provider: providerName,
    providerMessageId: evento.providerMessageId,
    // Não aplicar é o caso NORMAL: reentrega, ou aviso sobre uma mensagem que
    // não saiu do CRM (a Z-API notifica tudo que passa pelo número).
    outcome: aplicou ? evento.status : "sem efeito",
  });

  return aplicou;
}

// ---------------------------------------------------------------------------
// O anexo
// ---------------------------------------------------------------------------

/**
 * Baixa os anexos e os guarda no bucket privado.
 *
 * ⚠️ RODA DEPOIS DA RESPOSTA HTTP (`after()` na rota), e é por isso que ela é
 * uma função separada em vez de acontecer dentro de `gravarMensagem`.
 *
 * Um áudio de dois minutos pode levar mais tempo para baixar do que a Z-API
 * espera pelo 200 — e a Z-API entende demora como "não recebeu" e reentrega. O
 * resultado seria uma reentrega em laço causada exatamente pelas mensagens mais
 * pesadas, que são as que mais custam para reprocessar.
 *
 * A consequência aceita: por alguns segundos a conversa mostra "Baixando o
 * arquivo…". É honesto, e é o que a tela diz.
 */
export async function downloadPendingMedia(
  jobs: readonly PendingMedia[],
  correlationId: string,
): Promise<void> {
  for (const job of jobs) {
    try {
      await baixarUm(job, correlationId);
    } catch (error) {
      await marcarMidia(job.messageId, "failed");
      logWhatsAppEvent("error", "inbox.media_failed", {
        correlationId,
        messageId: job.messageId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function baixarUm(job: PendingMedia, correlationId: string): Promise<void> {
  const inicio = Date.now();
  const resposta = await fetchWithTimeout(job.media.url, { method: "GET" }, MEDIA_TIMEOUT_MS);

  if (!resposta.ok || !resposta.response.ok) {
    await marcarMidia(job.messageId, "failed");
    logWhatsAppEvent("error", "inbox.media_failed", {
      correlationId,
      messageId: job.messageId,
      reason: resposta.ok ? `HTTP ${resposta.response.status}` : resposta.error,
    });
    return;
  }

  // O tamanho declarado, quando existe, evita baixar 40 MB para descobrir que
  // não cabem. Quando não existe, o `arrayBuffer` abaixo é conferido de novo.
  const declarado = Number(resposta.response.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > MAX_MEDIA_BYTES) {
    await marcarMidia(job.messageId, "too_large");
    return;
  }

  const bytes = new Uint8Array(await resposta.response.arrayBuffer());
  if (bytes.byteLength > MAX_MEDIA_BYTES) {
    await marcarMidia(job.messageId, "too_large");
    return;
  }

  const mime =
    job.media.mimeType?.split(";")[0]?.trim() ||
    resposta.response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "application/octet-stream";

  // ⚠️ O CAMINHO É DERIVADO DE IDS NOSSOS, nunca do nome do arquivo que chegou.
  // Um `fileName` vindo da internet com `../` ou com barra dentro escreveria
  // fora da pasta da conversa. O nome original continua guardado na coluna
  // `media_file_name`, que é onde ele serve para alguma coisa: o download.
  const caminho = `${job.chatId}/${job.messageId}.${extensaoDe(mime)}`;

  const admin = createAdminClient();
  const { error } = await admin.storage.from(MEDIA_BUCKET).upload(caminho, bytes, {
    contentType: mime,
    // `upsert` porque a reentrega pode trazer o mesmo anexo de novo, e um
    // "arquivo já existe" transformaria um caminho normal em erro.
    upsert: true,
  });

  if (error) {
    await marcarMidia(job.messageId, "failed");
    logWhatsAppEvent("error", "inbox.media_failed", {
      correlationId,
      messageId: job.messageId,
      reason: error.message,
    });
    return;
  }

  await marcarMidia(job.messageId, "stored", caminho, mime, bytes.byteLength);

  logWhatsAppEvent("info", "inbox.media_stored", {
    correlationId,
    messageId: job.messageId,
    bytes: bytes.byteLength,
    durationMs: Date.now() - inicio,
  });
}

async function marcarMidia(
  messageId: string,
  status: "stored" | "failed" | "too_large" | "unsupported",
  caminho: string | null = null,
  mime: string | null = null,
  bytes: number | null = null,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("whatsapp_set_media", {
    p_message_id: messageId,
    p_status: status,
    p_path: caminho,
    p_mime: mime,
    p_size_bytes: bytes,
  } as never);

  if (error) {
    console.error(`[whatsapp-inbox] whatsapp_set_media falhou: ${error.message}`);
  }
}

/**
 * A extensão do arquivo, a partir do tipo declarado.
 *
 * Serve para o navegador e o sistema operacional de quem baixa reconhecerem o
 * arquivo — um `.bin` obriga a pessoa a renomear à mão para abrir um PDF. A
 * lista cobre o que o WhatsApp realmente manda; o resto cai em `bin`, que é
 * feio mas honesto.
 */
function extensaoDe(mime: string): string {
  const mapa: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/plain": "txt",
  };
  return mapa[mime] ?? "bin";
}

// ---------------------------------------------------------------------------
// O contato
// ---------------------------------------------------------------------------

/**
 * Acha o cadastro que corresponde ao número — se houver.
 *
 * ⚠️ DUAS ETAPAS, E A SEGUNDA É A QUE DECIDE.
 *
 * `find_contact_by_whatsapp` ESTREITA a base pelos 8 últimos dígitos; ela
 * mesma diz, no comentário da migration, que não decide. Quem confirma é
 * `sameWhatsAppNumber`, que é a única implementação da regra de número válido
 * (`phone.ts`). Sem a confirmação, dois números diferentes terminados nos
 * mesmos 8 dígitos — que existem, em DDDs distintos — vinculariam a conversa de
 * um associado ao cadastro de outro.
 */
async function resolverContato(phone: string): Promise<string | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .rpc("find_contact_by_whatsapp", { p_number: phone } as never)
    .returns<{ id: string; phone: string | null }[]>();

  if (error || !data) return null;

  return data.find((c) => sameWhatsAppNumber(c.phone, phone))?.id ?? null;
}

/**
 * O carimbo do fornecedor, normalizado.
 *
 * A Z-API manda ISO (já convertido no adaptador) e a Cloud API manda epoch em
 * SEGUNDOS como string. Aceitar os dois aqui evita que o adaptador tenha de
 * mentir sobre o formato — e um carimbo ilegível vira `null`, que o banco
 * traduz para `now()`: uma mensagem com hora errada é pior que uma com a hora
 * em que soubemos dela.
 */
function paraIso(timestamp: string | null): string | null {
  if (!timestamp) return null;

  if (/^\d+$/.test(timestamp)) {
    const n = Number(timestamp);
    // Epoch em segundos tem 10 dígitos até o ano 2286; em milissegundos, 13.
    const ms = timestamp.length > 10 ? n : n * 1000;
    const data = new Date(ms);
    return Number.isNaN(data.getTime()) ? null : data.toISOString();
  }

  const data = new Date(timestamp);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}
