"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertPermission } from "@/lib/auth/assert-permission";
import { fail, mapPostgresError, ok, type ActionResult } from "@/lib/actions/errors";
import { inspectImage } from "@/lib/files/image";
import { buildImagePath, EVENTS_BUCKET } from "@/lib/events/storage";
import {
  createEventSchema,
  dispatchEventSchema,
  eventCommandSchema,
  imageUploadTicketSchema,
  updateEventSchema,
  validateImageCandidate,
  type CreateEventInput,
  type DispatchEventInput,
  type EventCommandInput,
  type ImageUploadTicketInput,
  type UpdateEventInput,
} from "@/modules/event/event.schema";
import type { EventStatus } from "@/modules/event/event.types";

/**
 * ACTION = escrita. SEMPRE retorna `ActionResult<T>`, NUNCA lança.
 *
 * Ordem obrigatória: validar → autorizar → escrever → mapear erro → revalidar.
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 *
 * O QUE FICA NO BANCO, E POR QUÊ: criar um evento são três escritas que
 * precisam acontecer juntas (a linha, os vínculos de público e a auditoria), e
 * editar exige comparar a linha antiga com a nova para gravar o diff. O
 * supabase-js não faz transação de várias chamadas, então isso são funções
 * Postgres. Aqui em cima ficam só a autorização e a validação do ARQUIVO — que
 * é o que o banco não tem como fazer.
 */

/** O que as funções transacionais devolvem: a linha do evento afetado. */
interface EventRpcResult {
  id: string;
  status: EventStatus;
  image_path: string;
}

/**
 * Invalida o cache das telas de eventos.
 *
 * Usa o PADRÃO da rota de detalhe (`/events/[id]`), e não o endereço concreto:
 * uma edição pode mudar o que a grid mostra e o que a página do evento mostra,
 * e invalidar as duas de uma vez custa nada numa tela de backoffice.
 */
function revalidateEvents(): void {
  revalidatePath("/events", "page");
  revalidatePath("/events/[id]", "page");
}

// ----------------------------------------------------------------------------
// Upload da imagem
// ----------------------------------------------------------------------------

/**
 * Passo 1: autoriza e devolve um endereço para o navegador enviar a imagem
 * DIRETO ao Supabase Storage.
 *
 * O arquivo não passa pelo servidor Next por um motivo concreto: a Vercel corta
 * o corpo de qualquer requisição serverless em 4,5 MB, e o limite do módulo é
 * 5 MB. Não é questão de configuração — uma imagem de 5 MB simplesmente não
 * chega por Server Action. O que trafega aqui são algumas centenas de bytes.
 *
 * ⚠️ O `eventId` é SORTEADO AQUI quando não vem um. É o que permite a imagem ser
 * obrigatória já no primeiro insert: o caminho nasce dentro da pasta do evento
 * (`<event_id>/<uuid>.<ext>`) antes de a linha existir, e o mesmo id é usado
 * como chave primária no passo 3. Sem isso, seria preciso ou criar o evento sem
 * cartaz (violando a obrigatoriedade) ou inventar uma pasta de rascunho.
 */
export async function requestEventImageUploadAction(
  input: ImageUploadTicketInput,
): Promise<ActionResult<{ eventId: string; bucket: string; path: string; token: string }>> {
  type Ticket = { eventId: string; bucket: string; path: string; token: string };

  const parsed = imageUploadTicketSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<Ticket>("events.write");
  if (denied) return denied;

  // `type: ""` porque o servidor não vê o MIME que o navegador declarou — aqui
  // só dá para conferir extensão e tamanho. O que o arquivo REALMENTE é fica
  // para o passo 3, depois de ele existir.
  const issue = validateImageCandidate({
    name: parsed.data.filename,
    size: parsed.data.sizeBytes,
    type: "",
  });
  if (issue) return fail(issue);

  const supabase = await createClient();

  // Na EDIÇÃO o id vem de fora e precisa existir: sem esta conferência, a
  // imagem subiria para a pasta de um evento que não existe e só
  // descobriríamos no passo 3.
  if (parsed.data.eventId) {
    const { data, error } = await supabase
      .from("events")
      .select("id")
      .eq("id", parsed.data.eventId)
      .returns<{ id: string }[]>()
      .maybeSingle();

    if (error) {
      console.error(`[events] leitura do evento falhou: ${error.message}`);
      return { ok: false, error: mapPostgresError(error) };
    }
    if (!data) return fail("notFound");
  }

  const eventId = parsed.data.eventId ?? crypto.randomUUID();
  const path = buildImagePath(eventId, parsed.data.filename);

  const { data, error } = await supabase.storage.from(EVENTS_BUCKET).createSignedUploadUrl(path);

  if (error || !data) {
    console.error(`[events] URL de upload falhou: ${error?.message ?? "sem dados"}`);
    return fail("unexpected");
  }

  return ok({ eventId, bucket: EVENTS_BUCKET, path: data.path, token: data.token });
}

/**
 * Baixa o que subiu e examina os BYTES.
 *
 * A validação de conteúdo acontece DEPOIS do upload físico — é o preço de não
 * poder trafegar 5 MB pelo servidor. Por isso todo caminho de recusa apaga o
 * objeto: um arquivo no bucket sem linha em `events` é lixo que ninguém
 * referencia e ninguém vai limpar depois.
 */
async function inspectUploadedImage(
  storagePath: string,
): Promise<
  { mime: string; sizeBytes: number } | { issue: "fileNotImage" | "fileTooLarge" | "notFound" }
> {
  const supabase = await createClient();

  const { data: blob, error } = await supabase.storage.from(EVENTS_BUCKET).download(storagePath);

  if (error || !blob) {
    console.error(`[events] download para validação falhou: ${error?.message ?? "sem dados"}`);
    return { issue: "notFound" };
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());

  // O tamanho conferido é o dos BYTES QUE CHEGARAM, não o que o cliente disse
  // ter enviado. O bucket já impõe o mesmo teto; esta é a checagem que não
  // depende de nenhum limite estar configurado corretamente lá.
  // A extensão conferida é a do CAMINHO NO BUCKET, que o servidor montou a
  // partir da allowlist — não o nome que a pessoa enviou, que já não existe
  // mais neste ponto.
  const inspection = inspectImage(bytes, storagePath);
  if (!inspection.ok) return { issue: inspection.issue };

  return { mime: inspection.mime, sizeBytes: bytes.byteLength };
}

/**
 * Tira do bucket um arquivo que foi recusado.
 *
 * Best-effort: se a remoção falhar, o upload continua recusado — o que não pode
 * acontecer é um arquivo inválido virar o cartaz de um evento porque a limpeza
 * deu errado.
 */
async function discardOrphan(storagePath: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.storage.from(EVENTS_BUCKET).remove([storagePath]);

  if (error) {
    console.error(`[events] arquivo órfão não removido (${storagePath}): ${error.message}`);
  }
}

/**
 * Descarta a imagem ANTIGA depois de uma substituição — e só se for seguro.
 *
 * "Seguro" tem uma definição precisa aqui: nenhum evento aponta mais para
 * aquele caminho. A conferência não é zelo excessivo — duas edições
 * simultâneas do mesmo evento são serializadas pelo lock consultivo, mas a
 * segunda pode ter reposto um caminho que a primeira ia apagar. Perguntar ao
 * banco antes troca "apagar a imagem viva de um evento" por "deixar um órfão",
 * que é o lado certo da troca.
 */
async function discardReplacedImage(storagePath: string): Promise<void> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("events")
    .select("id")
    .eq("image_path", storagePath)
    .returns<{ id: string }[]>()
    .maybeSingle();

  if (error) {
    console.error(`[events] checagem antes de apagar imagem falhou: ${error.message}`);
    return;
  }
  if (data) return; // ainda referenciada — não apaga

  await discardOrphan(storagePath);
}

// ----------------------------------------------------------------------------
// Escrita — exige `events.write` (Administrador e Gestor)
// ----------------------------------------------------------------------------

/** Cadastra um evento. A imagem já está no bucket; aqui ela é conferida e gravada. */
export async function createEventAction(
  input: CreateEventInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<{ id: string }>("events.write");
  if (denied) return denied;

  const { eventId, storagePath } = parsed.data;

  // O caminho volta pelo cliente, então não é confiável. Confinar à pasta do
  // próprio evento impede que um evento aponte para a imagem de outro.
  if (!storagePath.startsWith(`${eventId}/`)) return fail("invalidInput");

  const image = await inspectUploadedImage(storagePath);
  if ("issue" in image) {
    await discardOrphan(storagePath);
    return fail(image.issue);
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_event", {
    p_event_id: eventId,
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? null,
    p_location: parsed.data.location,
    p_registration_url: parsed.data.registrationUrl || null,
    p_event_date: parsed.data.eventDate,
    p_start_time: parsed.data.startTime,
    p_end_time: parsed.data.endTime || null,
    p_image_path: storagePath,
    p_image_mime: image.mime,
    p_image_size_bytes: image.sizeBytes,
    p_segment_ids: parsed.data.segmentIds,
  } as never);

  if (error || !data) {
    console.error(`[events] criação falhou: ${error?.message ?? "sem dados"}`);
    await discardOrphan(storagePath);
    return error ? { ok: false, error: mapPostgresError(error) } : fail("unexpected");
  }

  revalidateEvents();
  return ok({ id: (data as EventRpcResult).id });
}

/**
 * Edita um evento. `storagePath` ausente significa MANTER a imagem atual.
 *
 * A ordem importa: a imagem nova é validada ANTES de a linha ser alterada. Se
 * ela for recusada, o objeto novo é apagado e o evento continua exatamente como
 * estava, apontando para a imagem que sempre funcionou. A imagem antiga só é
 * descartada DEPOIS que a troca já está gravada — nunca há um instante em que o
 * banco aponte para um arquivo que não existe.
 */
export async function updateEventAction(
  input: UpdateEventInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateEventSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<{ id: string }>("events.write");
  if (denied) return denied;

  const { eventId, storagePath } = parsed.data;
  const supabase = await createClient();

  let mime: string | null = null;
  let sizeBytes: number | null = null;
  let previousPath: string | null = null;

  if (storagePath) {
    if (!storagePath.startsWith(`${eventId}/`)) return fail("invalidInput");

    const image = await inspectUploadedImage(storagePath);
    if ("issue" in image) {
      await discardOrphan(storagePath);
      return fail(image.issue);
    }

    mime = image.mime;
    sizeBytes = image.sizeBytes;

    // Guardado só para a limpeza posterior. Se a leitura falhar, seguimos sem
    // limpar: um órfão custa espaço, uma edição perdida custa o trabalho da
    // pessoa.
    const { data: current } = await supabase
      .from("events")
      .select("image_path")
      .eq("id", eventId)
      .returns<{ image_path: string }[]>()
      .maybeSingle();

    previousPath = current?.image_path ?? null;
  }

  const { data, error } = await supabase.rpc("update_event", {
    p_event_id: eventId,
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? null,
    p_location: parsed.data.location,
    p_registration_url: parsed.data.registrationUrl || null,
    p_event_date: parsed.data.eventDate,
    p_start_time: parsed.data.startTime,
    p_end_time: parsed.data.endTime || null,
    p_image_path: storagePath ?? null,
    p_image_mime: mime,
    p_image_size_bytes: sizeBytes,
    p_segment_ids: parsed.data.segmentIds,
  } as never);

  if (error || !data) {
    console.error(`[events] edição falhou: ${error?.message ?? "sem dados"}`);
    if (storagePath) await discardOrphan(storagePath);
    return error ? { ok: false, error: mapPostgresError(error) } : fail("unexpected");
  }

  if (previousPath && previousPath !== storagePath) {
    await discardReplacedImage(previousPath);
  }

  revalidateEvents();
  return ok({ id: (data as EventRpcResult).id });
}

/**
 * Ativar ou inativar.
 *
 * A regra que dá sustentação à expiração derivada é imposta DENTRO da função
 * Postgres: um evento cuja data passou não pode ser ativado (EV001). Sem isso,
 * bastaria chamar esta action num evento de ontem para ele voltar a contar como
 * ativo na consulta do chatbot.
 */
export async function setEventStatusAction(
  input: EventCommandInput,
): Promise<ActionResult<{ id: string; status: EventStatus }>> {
  type Changed = { id: string; status: EventStatus };

  const parsed = eventCommandSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<Changed>("events.write");
  if (denied) return denied;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_event_status", {
    p_event_id: parsed.data.eventId,
    p_command: parsed.data.command,
  } as never);

  if (error || !data) {
    console.error(`[events] ${parsed.data.command} falhou: ${error?.message ?? "sem dados"}`);
    return error ? { ok: false, error: mapPostgresError(error) } : fail("unexpected");
  }

  const changed = data as EventRpcResult;
  revalidateEvents();
  return ok({ id: changed.id, status: changed.status });
}

/**
 * DIVULGAR — o botão que faz as mensagens saírem.
 *
 * ⚠️ DUAS FASES, E A SEPARAÇÃO É O DESENHO INTEIRO:
 *
 *   1. `start_event_dispatch` roda com a SESSÃO DE QUEM CLICOU. É lá que a
 *      permissão é conferida e a auditoria registra quem mandou divulgar. É
 *      rápido: monta a fila e devolve os números.
 *   2. O envio roda DEPOIS da resposta, via `after()`, com `service_role`.
 *
 * Sem a fase 2 fora do caminho da resposta, o navegador ficaria pendurado
 * minutos esperando as mensagens saírem — e a Vercel mataria a requisição no
 * meio, deixando metade da base avisada e nenhum sinal na tela de que faltou
 * gente.
 *
 * ⚠️ O RESULTADO QUE VOLTA É DA FILA, NÃO DO ENVIO. "247 na fila" é honesto;
 * "247 enviadas" seria mentira no instante em que é dito. A tela mostra o
 * andamento real lendo `event_dispatches`.
 */
export async function dispatchEventAction(
  input: DispatchEventInput,
): Promise<ActionResult<{ dispatchId: string; queued: number; blocked: number; already: number }>> {
  type Started = { dispatchId: string; queued: number; blocked: number; already: number };

  const parsed = dispatchEventSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<Started>("events.write");
  if (denied) return denied;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("start_event_dispatch", {
    p_event_id: parsed.data.eventId,
  } as never);

  if (error) {
    console.error(`[events] divulgação falhou: ${error.message}`);
    return { ok: false, error: mapPostgresError(error) };
  }

  // A função devolve UMA linha (`returns table`), então o cliente entrega array.
  const linha = (Array.isArray(data) ? data[0] : data) as
    | { dispatch_id: string; queued: number; blocked: number; already: number }
    | undefined;

  if (!linha?.dispatch_id) return fail("unexpected");

  // O envio, fora do caminho da resposta. `after` roda depois que o navegador
  // já recebeu — é o mesmo mecanismo que o webhook usa para baixar anexo.
  after(async () => {
    const { drainEventQueue } = await import("@/lib/services/event-dispatch");
    await drainEventQueue(parsed.data.eventId, linha.dispatch_id);
  });

  revalidateEvents();
  return ok({
    dispatchId: linha.dispatch_id,
    queued: linha.queued,
    blocked: linha.blocked,
    already: linha.already,
  });
}
