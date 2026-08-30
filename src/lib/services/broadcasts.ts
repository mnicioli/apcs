import "server-only";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/storage";
import { MARKET_BUCKET } from "@/lib/market/storage";
import type {
  Broadcast,
  BroadcastAttachments,
  BroadcastAudience,
  BroadcastSource,
  BroadcastSubject,
} from "@/modules/broadcast/broadcast.types";

/**
 * SERVICE = leitura. Devolve o dado ou LANÇA.
 *
 * ⚠️ `resolveBroadcastSubject` É O CORAÇÃO DESTE ARQUIVO, e a razão de ele
 * existir em vez de a tela montar a mensagem: o texto que sai para a base é
 * composto a partir do REGISTRO, lido agora, com a sessão de quem clicou (logo,
 * sujeito à RLS). Nada do que a tela envia vira texto de mensagem.
 */

/** Só os públicos ligados — não se oferece o que `start_broadcast` recusaria. */
export async function listBroadcastSegments(): Promise<
  { id: string; name: string; description: string | null }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_segments")
    .select("id, name, description")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<{ id: string; name: string; description: string | null }[]>();

  if (error) throw error;
  return data ?? [];
}

/**
 * Quantas pessoas os públicos escolhidos alcançam agora.
 *
 * ⚠️ SAI DA MESMA FUNÇÃO QUE MONTA A FILA (`broadcast_audience_size` repete a
 * consulta de `start_broadcast`). Se a tela contasse por conta própria, a
 * pessoa conferiria "312" e a divulgação sairia para 480 — e a diferença só
 * apareceria depois de as mensagens terem saído.
 */
export async function getBroadcastAudience(segmentIds: string[]): Promise<BroadcastAudience> {
  if (segmentIds.length === 0) return { reachable: 0, blocked: 0 };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("broadcast_audience_size", {
    p_segment_ids: segmentIds,
  } as never);

  if (error) throw error;

  const linha = (data as { reachable: number; blocked: number }[] | null)?.[0];
  return { reachable: linha?.reachable ?? 0, blocked: linha?.blocked ?? 0 };
}

interface BroadcastRow {
  id: string;
  source: BroadcastSource;
  source_id: string;
  title: string;
  body: string;
  status: Broadcast["status"];
  media_path: string | null;
  total_recipients: number;
  total_sent: number;
  total_errors: number;
  total_blocked: number;
  started_at: string;
  finished_at: string | null;
  last_error: string | null;
  created_by_name: string | null;
  broadcast_segments: { event_segments: { name: string } | null }[] | null;
}

/** O histórico de divulgações de UM registro. O painel do módulo o exibe. */
export async function listBroadcastsFor(
  source: BroadcastSource,
  sourceId: string,
): Promise<Broadcast[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .select(
      "id, source, source_id, title, body, status, media_path, total_recipients, total_sent, total_errors, total_blocked, started_at, finished_at, last_error, created_by_name, broadcast_segments(event_segments(name))",
    )
    .eq("source", source)
    .eq("source_id", sourceId)
    .order("started_at", { ascending: false })
    .returns<BroadcastRow[]>();

  if (error) throw error;

  return (data ?? []).map((linha) => ({
    id: linha.id,
    source: linha.source,
    sourceId: linha.source_id,
    title: linha.title,
    body: linha.body,
    status: linha.status,
    hasMedia: linha.media_path !== null,
    totalRecipients: linha.total_recipients,
    totalSent: linha.total_sent,
    totalErrors: linha.total_errors,
    totalBlocked: linha.total_blocked,
    startedAt: linha.started_at,
    finishedAt: linha.finished_at,
    lastError: linha.last_error,
    createdByName: linha.created_by_name,
    segmentNames: (linha.broadcast_segments ?? [])
      .map((elo) => elo.event_segments?.name)
      .filter((nome): nome is string => Boolean(nome)),
  }));
}

/**
 * O QUE VAI SER DIVULGADO — lido do registro, com o anexo quando há.
 *
 * ⚠️ DEVOLVE `null` QUANDO NÃO HÁ O QUE DIVULGAR, e os motivos são específicos
 * de cada módulo:
 *
 *   • documento/boletim SEM VERSÃO ATIVA — anunciar uma normativa cuja versão
 *     vigente foi desativada mandaria as pessoas atrás de um arquivo que a APCS
 *     tirou do ar de propósito;
 *   • palestra SEM DATA — "Palestra confirmada" sem dia é um aviso que não
 *     serve para nada.
 *
 * A tela usa esse `null` para explicar por que o botão não está disponível, em
 * vez de deixar a pessoa clicar e receber um erro.
 */
export async function resolveBroadcastSubject(
  source: BroadcastSource,
  sourceId: string,
): Promise<{ subject: BroadcastSubject; attachments: BroadcastAttachments } | null> {
  const supabase = await createClient();

  if (source === "normative" || source === "communication") {
    const { data, error } = await supabase
      .from("documents")
      .select(
        "id, name, category, document_versions(effective_date, storage_path, mime_type, original_filename, status)",
      )
      .eq("id", sourceId)
      .maybeSingle<{
        id: string;
        name: string;
        category: string;
        document_versions: {
          effective_date: string;
          storage_path: string;
          mime_type: string;
          original_filename: string;
          status: string;
        }[];
      }>();

    if (error) throw error;
    if (!data) return null;

    // ⚠️ A CATEGORIA DO DOCUMENTO TEM DE BATER COM A ORIGEM PEDIDA. Sem esta
    // linha, um id de comunicado enviado com `source: "normative"` sairia
    // anunciado como "Nova normativa publicada" — a tela mentindo sobre o que
    // a APCS acabou de publicar.
    const esperada = source === "normative" ? "normative" : "communication";
    if (data.category !== esperada) return null;

    const versao = data.document_versions.find((v) => v.status === "active");
    if (!versao) return null;

    return {
      subject: { source, title: data.name, effectiveDate: versao.effective_date },
      attachments: {
        // Documento não tem imagem: um envio só, o PDF com o texto.
        image: null,
        document: {
          bucket: DOCUMENTS_BUCKET,
          path: versao.storage_path,
          mime: versao.mime_type,
          filename: versao.original_filename,
        },
      },
    };
  }

  if (source === "market_bulletin") {
    const { data, error } = await supabase
      .from("market_bulletins")
      .select(
        "id, name, market_bulletin_versions(effective_date, version_name, pdf_path, pdf_mime_type, pdf_filename, image_path, image_mime_type, image_filename, status)",
      )
      .eq("id", sourceId)
      .maybeSingle<{
        id: string;
        name: string;
        market_bulletin_versions: {
          effective_date: string;
          version_name: string;
          pdf_path: string;
          pdf_mime_type: string;
          pdf_filename: string;
          image_path: string;
          image_mime_type: string;
          image_filename: string;
          status: string;
        }[];
      }>();

    if (error) throw error;
    if (!data) return null;

    const versao = data.market_bulletin_versions.find((v) => v.status === "active");
    if (!versao) return null;

    return {
      subject: {
        source,
        title: data.name,
        effectiveDate: versao.effective_date,
        versionName: versao.version_name,
      },
      // ⚠️ OS DOIS, e nesta ordem. O boletim é o único registro do sistema que
      // guarda imagem E PDF da mesma versão, e cada um faz uma coisa: a imagem
      // chega ABERTA na conversa e é o que faz alguém parar de rolar; o PDF
      // chega fechado, mas é o que a pessoa guarda, imprime e reencontra na
      // busca do WhatsApp. Mandar só o PDF (como era) fazia o boletim da semana
      // chegar como um anexo que ninguém abriu.
      attachments: {
        image: {
          bucket: MARKET_BUCKET,
          path: versao.image_path,
          mime: versao.image_mime_type,
          filename: versao.image_filename,
        },
        document: {
          bucket: MARKET_BUCKET,
          path: versao.pdf_path,
          mime: versao.pdf_mime_type,
          filename: versao.pdf_filename,
        },
      },
    };
  }

  const { data, error } = await supabase
    .from("lectures")
    .select("id, name, event_date, start_time, end_time, city, location, status")
    .eq("id", sourceId)
    .maybeSingle<{
      id: string;
      name: string;
      event_date: string;
      start_time: string | null;
      end_time: string | null;
      city: string;
      location: string | null;
      status: string;
    }>();

  if (error) throw error;
  if (!data) return null;

  return {
    subject: {
      source: "lecture",
      title: data.name,
      eventDate: data.event_date,
      // O Postgres devolve `time` como "HH:MM:SS"; a mensagem mostra "HH:MM".
      startTime: data.start_time ? data.start_time.slice(0, 5) : null,
      endTime: data.end_time ? data.end_time.slice(0, 5) : null,
      city: data.city,
      location: data.location,
    },
    // Palestra não tem arquivo: o aviso é o texto.
    attachments: { image: null, document: null },
  };
}

/**
 * A palestra está num estado em que faz sentido avisar a base?
 *
 * ⚠️ SÓ `confirmed` E `planned`. Divulgar uma palestra `requested` seria
 * anunciar o que ainda não foi aprovado; `cancelled` e `rejected` mandariam
 * gente para uma palestra que não vai acontecer — o pior desfecho, porque as
 * pessoas se organizam para ir.
 */
export const LECTURE_BROADCASTABLE_STATUSES = ["planned", "confirmed"] as const;

export function canBroadcastLecture(status: string): boolean {
  return (LECTURE_BROADCASTABLE_STATUSES as readonly string[]).includes(status);
}
