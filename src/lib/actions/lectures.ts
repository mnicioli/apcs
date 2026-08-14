"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertPermission } from "@/lib/auth/assert-permission";
import { fail, mapPostgresError, ok, type ActionResult } from "@/lib/actions/errors";
import { findLectureConflicts } from "@/lib/services/lectures";
import {
  assignLectureSchema,
  createLectureSchema,
  lectureOutcomeSchema,
  lectureStatusSchema,
  rescheduleLectureSchema,
  scheduledNeedsTime,
  updateLectureSchema,
  type AssignLectureInput,
  type CreateLectureInput,
  type LectureOutcomeInput,
  type LectureStatusInput,
  type RescheduleLectureInput,
  type UpdateLectureInput,
} from "@/modules/lecture/lecture.schema";
import { actorLabel } from "@/modules/lecture/lecture.rules";
import type { Lecture, LectureConflict, LectureStatus } from "@/modules/lecture/lecture.types";

/**
 * ACTION = escrita. SEMPRE retorna `ActionResult<T>`, NUNCA lança.
 *
 * Ordem obrigatória: validar → autorizar → escrever → mapear erro → revalidar.
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 *
 * O QUE FICA NO BANCO, E POR QUÊ: toda operação aqui são DUAS escritas que
 * precisam acontecer juntas — a linha e a auditoria —, e a edição exige comparar
 * a linha antiga com a nova para gravar o diff. O supabase-js não faz transação
 * de várias chamadas, então isso são funções Postgres. Aqui em cima ficam a
 * autorização, a validação de formulário e o ALERTA DE CONFLITO, que não é
 * regra do banco porque não bloqueia nada (§33).
 */

/** O que as funções transacionais devolvem: a linha da palestra afetada. */
interface LectureRpcResult {
  id: string;
  protocol: string;
  status: LectureStatus;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
}

/** O retorno das operações de agenda: o que mudou + o que isso atropela. */
export interface LectureScheduleResult {
  id: string;
  conflicts: LectureConflict[];
}

function toConflicts(lectures: Lecture[]): LectureConflict[] {
  return lectures.map((lecture) => ({
    id: lecture.id,
    protocol: lecture.protocol,
    name: lecture.name,
    eventDate: lecture.eventDate,
    startTime: lecture.startTime,
    endTime: lecture.endTime,
    city: lecture.city,
    // `actorLabel` e não `fullName`: um responsável sem nome preenchido sumiria
    // do alerta, e o §25 pede justamente que dê para saber QUEM cuida da
    // palestra que está sendo atropelada.
    responsibleName: actorLabel(lecture.responsible),
    speakerName: actorLabel(lecture.speaker),
  }));
}

/**
 * O alerta de conflito NUNCA derruba a operação.
 *
 * Se a consulta falhar, a palestra continua marcada e a pessoa fica sem o aviso
 * — que é o lado certo da troca. Transformar uma falha de leitura em falha de
 * escrita faria a agenda parar por causa de um alerta.
 */
async function conflictsFor(
  eventDate: string,
  startTime: string | null,
  endTime: string | null,
  excludeId: string,
): Promise<LectureConflict[]> {
  try {
    return toConflicts(await findLectureConflicts(eventDate, startTime, endTime, excludeId));
  } catch (error) {
    console.error(
      `[lectures] alerta de conflito indisponível: ${error instanceof Error ? error.message : error}`,
    );
    return [];
  }
}

/**
 * Invalida o cache das telas de palestras.
 *
 * Usa o PADRÃO da rota de detalhe (`/lectures/[id]`), e não o endereço
 * concreto: qualquer escrita muda o que a grid, o calendário e a página da
 * palestra mostram, e invalidar as três de uma vez custa nada numa tela de
 * backoffice.
 */
function revalidateLectures(): void {
  revalidatePath("/lectures", "page");
  revalidatePath("/lectures/[id]", "page");
  revalidatePath("/lectures/calendar", "page");
}

/** `""` do formulário significa "não informado", que no banco é NULL. */
function nullIfEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * O número que veio do formulário, ou NULL.
 *
 * Os campos numéricos trafegam como STRING (é o que um `<input type="number">`
 * guarda), e a conversão acontece aqui — um lugar só. Vazio é "não informado",
 * que no banco é NULL; `"0"` continua sendo zero, que é um resultado válido de
 * realização (§52).
 */
function numberOrNull(value: string | number | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

// ----------------------------------------------------------------------------
// Escrita — exige `lectures.write` (Administrador e Gestor)
// ----------------------------------------------------------------------------

/**
 * Cadastra uma palestra pelo time interno (§28).
 *
 * A origem é `internal` e não é parâmetro: quem cria por aqui está autenticado,
 * e a policy de insert exige `origin = 'internal'` — a origem `chatbot` só
 * existe pela porta do chatbot. Um admin não consegue forjar um pedido de fora.
 *
 * ⚠️ ACEITA DATA NO PASSADO, ao contrário de Eventos (§53). Um evento é um
 * convite e não pode ser emitido para ontem; uma palestra é também um REGISTRO,
 * e a APCS precisa poder lançar a que aconteceu semana passada.
 */
export async function createLectureAction(
  input: CreateLectureInput,
): Promise<ActionResult<LectureScheduleResult>> {
  const parsed = createLectureSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<LectureScheduleResult>("lectures.write");
  if (denied) return denied;

  const data = parsed.data;

  // §13. A checagem cruzada status × horário não cabe no schema (o `and` de dois
  // objetos não aceita `refine` sobre o combinado sem perder a inferência), e o
  // banco a impõe de qualquer forma — aqui ela só chega antes, com a mensagem
  // certa.
  if (scheduledNeedsTime(data)) return fail("lectureNeedsTime");

  const supabase = await createClient();

  const { data: created, error } = await supabase.rpc("create_lecture", {
    p_name: data.name,
    p_theme: data.theme,
    p_city: data.city,
    p_location: nullIfEmpty(data.location),
    p_type: data.type,
    p_type_other: nullIfEmpty(data.typeOther),
    p_format: nullIfEmpty(data.format),
    p_event_date: data.eventDate,
    p_start_time: nullIfEmpty(data.startTime),
    p_end_time: nullIfEmpty(data.endTime),
    p_attendees_estimated: numberOrNull(data.attendeesEstimated),
    p_speaker_id: nullIfEmpty(data.speakerId),
    p_responsible_id: nullIfEmpty(data.responsibleId),
    p_priority: data.priority,
    p_status: data.status,
    p_notes: nullIfEmpty(data.notes),
    p_requester_name: nullIfEmpty(data.requesterName),
    p_requester_email: nullIfEmpty(data.requesterEmail),
    p_requester_phone: nullIfEmpty(data.requesterPhone),
    p_requester_organization: nullIfEmpty(data.requesterOrganization),
  } as never);

  if (error || !created) {
    console.error(`[lectures] criação falhou: ${error?.message ?? "sem dados"}`);
    return error ? { ok: false, error: mapPostgresError(error) } : fail("unexpected");
  }

  const row = created as LectureRpcResult;

  revalidateLectures();
  return ok({
    id: row.id,
    conflicts: await conflictsFor(row.event_date, row.start_time, row.end_time, row.id),
  });
}

/**
 * Edita os campos DESCRITIVOS (§42).
 *
 * Data, horário, situação, responsável e palestrante não passam por aqui — cada
 * um tem a sua operação. Não é rigor formal: é o que permite auditar "remarcou"
 * e "mudou o tema" como coisas diferentes, em vez de esconder um reagendamento
 * no meio de um diff de doze campos.
 */
export async function updateLectureAction(
  input: UpdateLectureInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateLectureSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<{ id: string }>("lectures.write");
  if (denied) return denied;

  const data = parsed.data;
  const supabase = await createClient();

  const { data: updated, error } = await supabase.rpc("update_lecture", {
    p_lecture_id: data.lectureId,
    p_name: data.name,
    p_theme: data.theme,
    p_city: data.city,
    p_location: nullIfEmpty(data.location),
    p_type: data.type,
    p_type_other: nullIfEmpty(data.typeOther),
    p_format: nullIfEmpty(data.format),
    p_attendees_estimated: numberOrNull(data.attendeesEstimated),
    p_priority: data.priority,
    p_notes: nullIfEmpty(data.notes),
  } as never);

  if (error || !updated) {
    console.error(`[lectures] edição falhou: ${error?.message ?? "sem dados"}`);
    return error ? { ok: false, error: mapPostgresError(error) } : fail("unexpected");
  }

  revalidateLectures();
  return ok({ id: (updated as LectureRpcResult).id });
}

/**
 * Muda a situação (§43).
 *
 * O caminho é validado pelo GRAFO no banco (`lecture_status_transitions` + o
 * trigger). Esta action não repete o grafo — se repetisse, a tela e o banco
 * poderiam discordar, e quem manda é o banco.
 *
 * Rejeitar e cancelar exigem motivo (§24, §25). O schema pede, o banco recusa
 * sem (PL004), e as duas mensagens são a mesma.
 */
export async function setLectureStatusAction(
  input: LectureStatusInput,
): Promise<ActionResult<{ id: string; status: LectureStatus }>> {
  type Changed = { id: string; status: LectureStatus };

  const parsed = lectureStatusSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<Changed>("lectures.write");
  if (denied) return denied;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_lecture_status", {
    p_lecture_id: parsed.data.lectureId,
    p_status: parsed.data.status,
    p_reason: nullIfEmpty(parsed.data.reason),
  } as never);

  if (error || !data) {
    console.error(`[lectures] mudança de situação falhou: ${error?.message ?? "sem dados"}`);
    return error ? { ok: false, error: mapPostgresError(error) } : fail("unexpected");
  }

  const row = data as LectureRpcResult;
  revalidateLectures();
  return ok({ id: row.id, status: row.status });
}

/**
 * Reagenda (§34, §35, §44).
 *
 * ⚠️ NÃO cria palestra nova: mesma linha, mesmo protocolo, data nova. É a mesma
 * action que o arrastar-e-soltar do calendário vai chamar — os dois caminhos
 * precisam da mesma validação, da mesma auditoria e da mesma resposta.
 *
 * O conflito volta como AVISO junto do sucesso (§33). Bloquear seria errado:
 * pode haver mais de um palestrante disponível, e quem sabe disso é quem está
 * olhando a tela.
 */
export async function rescheduleLectureAction(
  input: RescheduleLectureInput,
): Promise<ActionResult<LectureScheduleResult>> {
  const parsed = rescheduleLectureSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<LectureScheduleResult>("lectures.write");
  if (denied) return denied;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("reschedule_lecture", {
    p_lecture_id: parsed.data.lectureId,
    p_event_date: parsed.data.eventDate,
    p_start_time: nullIfEmpty(parsed.data.startTime),
    p_end_time: nullIfEmpty(parsed.data.endTime),
  } as never);

  if (error || !data) {
    console.error(`[lectures] reagendamento falhou: ${error?.message ?? "sem dados"}`);
    return error ? { ok: false, error: mapPostgresError(error) } : fail("unexpected");
  }

  const row = data as LectureRpcResult;
  revalidateLectures();
  return ok({
    id: row.id,
    conflicts: await conflictsFor(row.event_date, row.start_time, row.end_time, row.id),
  });
}

/** Define o responsável interno (§45). `profileId` vazio DESATRIBUI. */
export async function assignLectureResponsibleAction(
  input: AssignLectureInput,
): Promise<ActionResult<{ id: string }>> {
  return assign("assign_lecture_responsible", input, "responsável");
}

/** Define o palestrante (§46). `profileId` vazio DESATRIBUI. */
export async function assignLectureSpeakerAction(
  input: AssignLectureInput,
): Promise<ActionResult<{ id: string }>> {
  return assign("assign_lecture_speaker", input, "palestrante");
}

/**
 * As duas atribuições têm o mesmo corpo e funções diferentes no banco — porque
 * a ação na trilha é diferente, e um dia a permissão pode ser (definir
 * palestrante é decisão de agenda; definir responsável é decisão de time).
 */
async function assign(
  rpc: "assign_lecture_responsible" | "assign_lecture_speaker",
  input: AssignLectureInput,
  papel: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = assignLectureSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<{ id: string }>("lectures.write");
  if (denied) return denied;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(rpc, {
    p_lecture_id: parsed.data.lectureId,
    p_profile_id: nullIfEmpty(parsed.data.profileId),
  } as never);

  if (error || !data) {
    console.error(`[lectures] atribuição de ${papel} falhou: ${error?.message ?? "sem dados"}`);
    return error ? { ok: false, error: mapPostgresError(error) } : fail("unexpected");
  }

  revalidateLectures();
  return ok({ id: (data as LectureRpcResult).id });
}

/**
 * Registra o resultado da realização (§26).
 *
 * Separado da mudança de situação porque o §26 é explícito: esses campos podem
 * ser preenchidos DEPOIS. Marcar como realizada e contar quantos vieram são dois
 * momentos — às vezes dois dias. O banco exige que a palestra já esteja
 * realizada (PL003).
 */
export async function registerLectureOutcomeAction(
  input: LectureOutcomeInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = lectureOutcomeSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<{ id: string }>("lectures.write");
  if (denied) return denied;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("register_lecture_outcome", {
    p_lecture_id: parsed.data.lectureId,
    p_held_at: nullIfEmpty(parsed.data.heldAt),
    p_attendees_actual: numberOrNull(parsed.data.attendeesActual),
    p_outcome_notes: nullIfEmpty(parsed.data.outcomeNotes),
  } as never);

  if (error || !data) {
    console.error(`[lectures] registro de resultado falhou: ${error?.message ?? "sem dados"}`);
    return error ? { ok: false, error: mapPostgresError(error) } : fail("unexpected");
  }

  revalidateLectures();
  return ok({ id: (data as LectureRpcResult).id });
}

/**
 * Consulta de conflito SEM escrever nada (§33, §34).
 *
 * Existe para o calendário perguntar "se eu soltar aqui, atropela alguém?" antes
 * de a pessoa soltar. Exige `lectures.read` — quem só consulta a agenda também
 * precisa saber o que está cheio.
 */
export async function checkLectureConflictsAction(input: {
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  excludeId?: string;
}): Promise<ActionResult<LectureConflict[]>> {
  const denied = await assertPermission<LectureConflict[]>("lectures.read");
  if (denied) return denied;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)) return fail("invalidInput");

  try {
    const conflicts = await findLectureConflicts(
      input.eventDate,
      input.startTime,
      input.endTime,
      input.excludeId,
    );
    return ok(toConflicts(conflicts));
  } catch (error) {
    console.error(
      `[lectures] consulta de conflito falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}
