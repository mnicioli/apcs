import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatTime } from "@/lib/utils";
import {
  toChatbotLecture,
  type ChatbotLectureRequestResult,
  type ChatbotLectureResult,
} from "@/modules/lecture/lecture.chatbot";
import {
  lectureProtocolSchema,
  lectureRequestSchema,
  type LectureRequestInput,
} from "@/modules/lecture/lecture.schema";
import type { Lecture, LectureStatus } from "@/modules/lecture/lecture.types";

/**
 * A PORTA DO CHATBOT PARA PALESTRAS — a única.
 *
 * O chat público (`/chat`) é ANÔNIMO: não há `auth.uid()`, não há papel, e as
 * tabelas não têm policy de escrita para `anon`. Por isso este arquivo usa o
 * cliente `service_role`, exatamente como `csp_leads` já faz (ver o cabeçalho
 * de 20260804000000_create_chat_csp.sql). A superfície pública do banco continua
 * sendo zero: toda escrita anônima passa pelo servidor Next.
 *
 * ⚠️ O QUE AUTORIZA ISSO NÃO É ESTE ARQUIVO — é a assinatura da função no banco.
 *
 * `create_lecture_request` não tem parâmetro de status, prioridade, responsável
 * nem palestrante. O §6 (o chatbot só CRIA solicitação) não é uma checagem que
 * alguém pode esquecer de fazer: é uma impossibilidade. Nem um bug aqui dentro
 * consegue aprovar uma palestra, porque não existe argumento para isso.
 *
 * ⚠️ AINDA NÃO ESTÁ LIGADA AO `decide.ts`, e isso é deliberado: hoje o único
 * fluxo do chat é o CSP, e todo texto do bot sai de um catálogo aprovado. Ligar
 * Palestras exige um `chat_flow_key` novo e um roteiro de perguntas — trabalho
 * de conversa, não de banco. Ver docs/PALESTRAS.md.
 */

interface LectureRequestRow {
  id: string;
  protocol: string;
  status: LectureStatus;
}

/**
 * Registra a solicitação e devolve o protocolo (§40, §58, §59).
 *
 * NUNCA lança: o chat não pode cair porque uma solicitação falhou. Os três
 * resultados possíveis são distintos de propósito — `invalid` faz o bot repetir
 * a pergunta, `failed` faz o bot pedir para tentar mais tarde, e confundir os
 * dois faria a pessoa reescrever uma resposta que estava certa.
 */
export async function createLectureRequest(
  input: LectureRequestInput,
): Promise<ChatbotLectureRequestResult> {
  const parsed = lectureRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid",
      issues: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const data = parsed.data;

  try {
    const admin = createAdminClient();

    const { data: created, error } = await admin.rpc("create_lecture_request", {
      p_requester_name: data.requesterName,
      p_city: data.city,
      p_type: data.type,
      p_type_other: data.typeOther || null,
      p_theme: data.theme,
      p_event_date: data.eventDate,
      p_start_time: data.startTime || null,
      p_location: data.location || null,
      p_format: data.format || null,
      p_attendees_estimated:
        typeof data.attendeesEstimated === "number" ? data.attendeesEstimated : null,
      p_notes: data.notes || null,
      p_requester_contact_id: data.requesterContactId ?? null,
      p_requester_email: data.requesterEmail || null,
      p_requester_phone: data.requesterPhone || null,
      p_requester_organization: data.requesterOrganization || null,
      // §7 coleta um único "Nome". Enquanto o negócio não disser se o chatbot
      // deve perguntar também um TÍTULO, a solicitação nasce com os dois iguais
      // — e a função já tem o parâmetro pronto para a resposta.
      p_name: null,
      // §59/§60. Sem chave, um retry técnico (conexão que cai DEPOIS do insert e
      // antes da resposta) vira dois protocolos para o mesmo pedido. Com chave,
      // a segunda tentativa devolve o primeiro pedido — do ponto de vista de
      // quem chamou, a primeira simplesmente funcionou.
      p_idempotency_key: data.idempotencyKey || null,
    } as never);

    if (error || !created) {
      // A mensagem crua fica no log do servidor. O que volta para a janela do
      // chat é um texto fixo: código de erro e nome de tabela numa tela pública
      // não ajudam ninguém e mapeiam o sistema para quem estiver medindo (§59).
      console.error(`[lecture-chatbot] solicitação falhou: ${error?.message ?? "sem dados"}`);
      return { status: "failed" };
    }

    const row = created as LectureRequestRow;
    return { status: "created", protocol: row.protocol, lectureStatus: row.status };
  } catch (error) {
    console.error(
      `[lecture-chatbot] solicitação falhou: ${error instanceof Error ? error.message : error}`,
    );
    return { status: "failed" };
  }
}

const PROTOCOL_COLUMNS =
  "id, protocol, origin, name, theme, city, location, type, type_other, format, " +
  "event_date, start_time, end_time, priority, status, requested_at, held_at, " +
  "requester_contact_id, created_at, updated_at";

/**
 * O recorte que a consulta do bot traz.
 *
 * ⚠️ Repare no que NÃO está aqui: observações, motivo de rejeição, participantes,
 * responsável, palestrante. Não é economia de rede — é o §60 sendo cumprido na
 * consulta, e não depois. Um campo que nunca é lido não pode vazar por um erro
 * de mapeamento mais adiante.
 */
interface ProtocolRow {
  id: string;
  protocol: string;
  origin: Lecture["origin"];
  name: string;
  theme: string;
  city: string;
  location: string | null;
  type: Lecture["type"];
  type_other: string | null;
  format: Lecture["format"];
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  priority: Lecture["priority"];
  status: LectureStatus;
  requested_at: string;
  held_at: string | null;
  requester_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Consulta uma solicitação pelo protocolo (§60).
 *
 * ⚠️ `contactId` NÃO É OPCIONAL, e é ele que faz este endpoint ser seguro.
 *
 * O protocolo é sequencial e previsível: sem amarrar a consulta a quem pediu,
 * varrer de SOL-000001 a SOL-000999 devolveria o mapa de quem pediu palestra
 * para a APCS, com cidade e tema. O contato vem da CONVERSA (o cookie httpOnly),
 * nunca de algo que a pessoa digita — senão bastaria enviar o id de outro.
 *
 * Uma solicitação sem contato registrado (as que o time interno anota) nunca
 * casa, e isso está certo: ela não veio do chat, então não se consulta por ele.
 *
 * Os dois "nãos" — não existe, e existe mas não é seu — colapsam em
 * `not-found`, pelo mesmo motivo que Eventos colapsa os dele.
 */
export async function getLectureRequestByProtocol(
  protocol: string,
  contactId: string,
): Promise<ChatbotLectureResult> {
  const parsedProtocol = lectureProtocolSchema.safeParse(protocol);
  if (!parsedProtocol.success) return { status: "not-found" };

  // Um contato inválido não pode virar consulta: `.eq()` com string vazia casaria
  // com nada, mas depender disso é depender de um detalhe do PostgREST.
  if (!/^[0-9a-f-]{36}$/i.test(contactId)) return { status: "not-found" };

  try {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("lectures")
      .select(PROTOCOL_COLUMNS)
      .eq("protocol", parsedProtocol.data)
      .eq("requester_contact_id", contactId)
      .returns<ProtocolRow[]>()
      .maybeSingle();

    if (error) {
      console.error(`[lecture-chatbot] consulta por protocolo falhou: ${error.message}`);
      return { status: "not-found" };
    }
    if (!data) return { status: "not-found" };

    return { status: "found", lecture: toChatbotLecture(toPartialLecture(data)) };
  } catch (error) {
    console.error(
      `[lecture-chatbot] consulta por protocolo falhou: ${error instanceof Error ? error.message : error}`,
    );
    return { status: "not-found" };
  }
}

/**
 * Monta um `Lecture` a partir do recorte reduzido que a consulta do bot traz.
 *
 * Os campos ausentes viram nulo em vez de `undefined`: `toChatbotLecture` só usa
 * uma fatia deles, e um objeto meio preenchido que atravessa a fronteira é como
 * um `undefined` acaba renderizado numa janela de chat.
 */
function toPartialLecture(row: ProtocolRow): Lecture {
  return {
    id: row.id,
    protocol: row.protocol,
    origin: row.origin,
    name: row.name,
    theme: row.theme,
    city: row.city,
    location: row.location,
    type: row.type,
    typeOther: row.type_other,
    format: row.format,
    eventDate: row.event_date,
    startTime: row.start_time ? formatTime(row.start_time) : null,
    endTime: row.end_time ? formatTime(row.end_time) : null,
    attendeesEstimated: null,
    attendeesActual: null,
    speaker: null,
    speakerCatalog: null,
    responsible: null,
    priority: row.priority,
    status: row.status,
    notes: null,
    rejectionReason: null,
    cancellationReason: null,
    requestedAt: row.requested_at,
    heldAt: row.held_at,
    outcomeNotes: null,
    requester: {
      contactId: row.requester_contact_id,
      name: null,
      email: null,
      phone: null,
      organization: null,
    },
    createdBy: null,
    createdAt: row.created_at,
    updatedBy: null,
    updatedAt: row.updated_at,
  };
}
