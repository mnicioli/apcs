"use server";

import { revalidatePath } from "next/cache";
import { fail, mapPostgresError, ok, type ActionResult } from "@/lib/actions/errors";
import { assertPermission } from "@/lib/auth/assert-permission";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  inviteUserSchema,
  publishConsentSchema,
  resumeBlockSchema,
  setSettingSchema,
  setUserRoleSchema,
  updateSegmentSchema,
  type InviteUserInput,
  type PublishConsentInput,
  type ResumeBlockInput,
  type SetSettingInput,
  type SetUserRoleInput,
  type UpdateSegmentInput,
} from "@/modules/admin/admin.schema";

/**
 * ACTION = escrita. SEMPRE retorna `ActionResult<T>`, NUNCA lança.
 *
 * ⚠️ TODAS AS ESCRITAS DAQUI PASSAM POR FUNÇÃO `SECURITY DEFINER` QUE CHECA
 * `is_admin()` NO BANCO. O `assertPermission` abaixo é a primeira camada, e ela
 * existe para a pessoa receber "você não tem permissão" em vez de um erro cru —
 * mas quem realmente decide é o Postgres. Uma chamada direta ao PostgREST pula
 * a primeira e para na segunda.
 *
 * A exceção é o CONVITE, que não é uma escrita no `public`: ele fala com a API
 * de autenticação do Supabase, e por isso é o único lugar deste arquivo que usa
 * `service_role`. Ver `inviteUserAction`.
 */

function revalidateAdmin(): void {
  revalidatePath("/users", "page");
  revalidatePath("/settings", "page");
  revalidatePath("/settings/segments", "page");
  revalidatePath("/settings/notifications", "page");
  revalidatePath("/settings/texts", "page");
}

/* -------------------------------------------------------------------------- */
/* Usuários                                                                   */
/* -------------------------------------------------------------------------- */

export async function setUserRoleAction(input: SetUserRoleInput): Promise<ActionResult<null>> {
  const parsed = setUserRoleSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<null>("users.manage");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_user_role", {
      p_user_id: parsed.data.userId,
      p_role: parsed.data.role,
    } as never);

    if (error) return fail(mapPostgresError(error).code);

    revalidateAdmin();
    return ok(null);
  } catch (erro) {
    console.error("[admin.setUserRole] erro inesperado:", erro);
    return fail("unexpected");
  }
}

/**
 * CONVIDA ALGUÉM PARA O SISTEMA.
 *
 * ⚠️ ESTE É O ÚNICO LUGAR DA ADMINISTRAÇÃO QUE USA `service_role`, e o motivo é
 * que criar um usuário não é escrever numa tabela do `public`: é falar com a
 * API de autenticação do Supabase, onde não existe RLS para respeitar. A
 * autorização aqui é código — `assertPermission` mais o `is_admin()` que
 * `log_user_invite` confere no banco antes de registrar.
 *
 * ⚠️ A ORDEM É CONVITE → PAPEL → TRILHA, e ela importa:
 *
 *   1. `inviteUserByEmail` cria o usuário em `auth.users` e manda o e-mail.
 *      O trigger `handle_new_user` cria o perfil como `viewer` — sempre, e é
 *      o certo: NUNCA confiar em metadata de signup para definir papel.
 *   2. Só então o papel escolhido é aplicado, por `set_user_role`.
 *   3. A trilha registra.
 *
 * Se o passo 2 falhar, a pessoa fica como `viewer` e o convite JÁ FOI. É por
 * isso que o retorno diz `roleApplied`: a tela precisa poder avisar "convite
 * enviado, mas o papel não foi aplicado — ajuste na lista", em vez de mentir
 * que deu tudo certo.
 *
 * ⚠️ O E-MAIL DE CONVITE DEPENDE DO SUPABASE. Se o projeto não tiver SMTP
 * configurado, esta chamada falha — e a mensagem que volta diz isso, em vez de
 * "erro inesperado", porque a solução é no painel do Supabase e não aqui.
 */
export async function inviteUserAction(
  input: InviteUserInput,
): Promise<ActionResult<{ roleApplied: boolean }>> {
  const parsed = inviteUserSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ roleApplied: boolean }>("users.manage");
  if (negado) return negado;

  const { email, fullName, role } = parsed.data;

  try {
    const admin = createAdminClient();

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: fullName ? { full_name: fullName } : undefined,
    });

    if (error) {
      // Sem e-mail pessoal no log: a mensagem do Supabase basta para depurar.
      console.error("[admin.invite] convite falhou:", error.message);
      // `already been registered` é o caso comum e merece frase própria.
      if (/already/i.test(error.message)) return fail("uniqueViolation");
      return fail("inviteFailed");
    }

    const novoId = data?.user?.id;
    if (!novoId) return fail("unexpected");

    // O papel, agora que o perfil existe. Pelo cliente AUTENTICADO: é
    // `set_user_role` que audita, e ela precisa saber quem está convidando.
    const supabase = await createClient();
    const { error: papelError } = await supabase.rpc("set_user_role", {
      p_user_id: novoId,
      p_role: role,
    } as never);

    if (papelError) {
      console.error("[admin.invite] papel não aplicado:", papelError.code);
    }

    await supabase.rpc("log_user_invite", { p_email: email, p_role: role } as never);

    revalidateAdmin();
    return ok({ roleApplied: !papelError });
  } catch (erro) {
    console.error("[admin.invite] erro inesperado:", erro);
    return fail("unexpected");
  }
}

/* -------------------------------------------------------------------------- */
/* Configurações                                                              */
/* -------------------------------------------------------------------------- */

export async function updateEventSegmentAction(
  input: UpdateSegmentInput,
): Promise<ActionResult<null>> {
  const parsed = updateSegmentSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<null>("settings.manage");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_event_segment", {
      p_segment_id: parsed.data.segmentId,
      p_name: parsed.data.name,
      p_description: parsed.data.description,
      p_active: parsed.data.active,
    } as never);

    if (error) return fail(mapPostgresError(error).code);

    revalidateAdmin();
    // A grade de eventos mostra o nome do público em cada linha.
    revalidatePath("/events", "page");
    revalidatePath("/events/[id]", "page");
    return ok(null);
  } catch (erro) {
    console.error("[admin.updateSegment] erro inesperado:", erro);
    return fail("unexpected");
  }
}

export async function setAppSettingAction(input: SetSettingInput): Promise<ActionResult<null>> {
  const parsed = setSettingSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<null>("settings.manage");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_app_setting", {
      p_key: parsed.data.key,
      p_value: parsed.data.value,
    } as never);

    if (error) return fail(mapPostgresError(error).code);

    revalidateAdmin();
    return ok(null);
  } catch (erro) {
    console.error("[admin.setSetting] erro inesperado:", erro);
    return fail("unexpected");
  }
}

/**
 * Publica uma NOVA versão do texto de consentimento.
 *
 * ⚠️ NUNCA REESCREVE UMA VERSÃO EXISTENTE — o banco recusa com AD003. Uma
 * autorização só vale para o texto que a pessoa leu, e as solicitações de
 * agosto precisam continuar apontando para o texto de agosto. Ver a decisão 2
 * de 20260830100000_admin_module.sql.
 */
export async function publishConsentTextAction(
  input: PublishConsentInput,
): Promise<ActionResult<null>> {
  const parsed = publishConsentSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<null>("settings.manage");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("publish_consent_text", {
      p_version: parsed.data.version,
      p_body: parsed.data.body,
    } as never);

    if (error) return fail(mapPostgresError(error).code);

    revalidateAdmin();
    // A landing pública mostra o texto vigente.
    revalidatePath("/associe-se", "page");
    return ok(null);
  } catch (erro) {
    console.error("[admin.publishConsent] erro inesperado:", erro);
    return fail("unexpected");
  }
}

export async function resumeNotificationBlockAction(
  input: ResumeBlockInput,
): Promise<ActionResult<{ revoked: boolean }>> {
  const parsed = resumeBlockSchema.safeParse(input);
  if (!parsed.success) return fail("membershipConsentRequired");

  const negado = await assertPermission<{ revoked: boolean }>("settings.manage");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("resume_notification_block", {
      p_opt_out_id: parsed.data.blockId,
      p_note: parsed.data.note,
    } as never);

    if (error) return fail(mapPostgresError(error).code);

    revalidateAdmin();
    revalidatePath("/members", "page");
    revalidatePath("/members/[id]", "page");
    return ok({ revoked: data === true });
  } catch (erro) {
    console.error("[admin.resumeBlock] erro inesperado:", erro);
    return fail("unexpected");
  }
}
