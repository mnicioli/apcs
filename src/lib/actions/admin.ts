"use server";

import { revalidatePath } from "next/cache";
import { fail, failFromPostgres, ok, type ActionResult } from "@/lib/actions/errors";
import { assertPermission } from "@/lib/auth/assert-permission";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { untyped } from "@/lib/supabase/untyped";
import { invalidateRoleCache } from "@/lib/services/roles";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSiteOrigin } from "@/lib/http/site-url";
import {
  inviteUserSchema,
  publishConsentSchema,
  resetUserPasswordSchema,
  resumeBlockSchema,
  setSettingSchema,
  setUserActiveSchema,
  updateSegmentSchema,
  updateUserSchema,
  type InviteUserInput,
  type PublishConsentInput,
  type ResetUserPasswordInput,
  type ResumeBlockInput,
  type SetSettingInput,
  type SetUserActiveInput,
  type UpdateSegmentInput,
  type UpdateUserInput,
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
  revalidatePath("/users/[id]", "page");
  revalidatePath("/permissions", "page");
  revalidatePath("/settings", "page");
  revalidatePath("/settings/segments", "page");
  revalidatePath("/settings/notifications", "page");
  revalidatePath("/settings/texts", "page");
  // Trocar o papel/cargo de alguém muda o MENU dessa pessoa, e o menu é
  // desenhado no layout das rotas autenticadas — não na página.
  invalidateRoleCache();
  revalidatePath("/", "layout");
}

/* -------------------------------------------------------------------------- */
/* Usuários                                                                   */
/* -------------------------------------------------------------------------- */

/*
 * ⚠️ `setUserRoleAction` FOI REMOVIDA, e a ausência é decisão.
 *
 * Ela chamava `set_user_role` (o PAPEL do enum). Desde
 * 20260903000100_custom_roles.sql quem manda é o CARGO, e a função de cargo
 * (`set_user_role_key`) tem uma trava que a antiga não tem: não deixar o
 * sistema sem ninguém capaz de administrar usuários (AR006). Duas portas para
 * a mesma decisão, uma delas sem a trava, é o tipo de coisa que só aparece no
 * dia em que alguém usa a errada.
 *
 * A função `set_user_role` continua no banco — é ela que atende uma correção
 * manual no SQL Editor, e o trigger `profiles_sync_role_key` mantém o cargo
 * de acordo depois.
 *
 * Trocar cargo agora é `setUserRoleKeyAction`, em src/lib/actions/roles.ts.
 */
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

    // O cargo, agora que o perfil existe. Pelo cliente AUTENTICADO: é
    // `set_user_role_key` que audita, e ela precisa saber quem está
    // convidando.
    const supabase = await createClient();
    const { error: papelError } = await untyped(supabase).rpc("set_user_role_key", {
      p_user_id: novoId,
      p_role_key: role,
    });

    if (papelError) {
      console.error("[admin.invite] papel não aplicado:", papelError.code);
    }

    await untyped(supabase).rpc("log_user_invite_cargo", {
      p_email: email,
      p_role_key: role,
    });

    revalidateAdmin();
    return ok({ roleApplied: !papelError });
  } catch (erro) {
    console.error("[admin.invite] erro inesperado:", erro);
    return fail("unexpected");
  }
}

/**
 * EDITA O CADASTRO: nome e e-mail.
 *
 * ⚠️ DOIS SISTEMAS, E A ORDEM É AUTH PRIMEIRO. O e-mail que autentica mora em
 * `auth.users`; `profiles.email` é a cópia que a lista exibe. Se a cópia fosse
 * gravada antes e a troca de identidade falhasse, a tela passaria a mostrar um
 * endereço que NÃO entra no sistema — o pior estado possível, porque parece
 * certo. Nesta ordem, a falha do segundo passo só deixa a tela desatualizada.
 *
 * ⚠️ `email_confirm: true` APLICA A TROCA NA HORA, sem mandar confirmação para
 * o endereço novo. É deliberado: quem administra está corrigindo o cadastro de
 * um colega, e o fluxo de confirmação deixaria a identidade suspensa entre dois
 * endereços — com a cópia em `profiles` sem saber em qual. Quem digitar errado
 * corrige de novo por aqui; o custo é uma edição, não um acesso perdido.
 *
 * ⚠️ SÓ CHAMA A API DE AUTH SE O E-MAIL MUDOU. Editar o nome de alguém não é
 * motivo para tocar na identidade de login.
 */
export async function updateUserAction(input: UpdateUserInput): Promise<ActionResult<null>> {
  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<null>("users.manage");
  if (negado) return negado;

  const { userId, fullName, email } = parsed.data;

  try {
    const supabase = await createClient();

    const { data: atual, error: erroLeitura } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle()
      .returns<{ email: string } | null>();

    if (erroLeitura)
      return failFromPostgres("admin.updateUser", erroLeitura, { userId, etapa: "leitura" });
    if (!atual) return fail("notFound");

    if (atual.email !== email) {
      const admin = createAdminClient();
      const { error } = await admin.auth.admin.updateUserById(userId, {
        email,
        email_confirm: true,
      });

      if (error) {
        console.error("[admin.updateUser] troca de e-mail falhou:", error.message);
        if (/already|registered|exists/i.test(error.message)) return fail("emailInUse");
        return fail("unexpected");
      }
    }

    const { error } = await supabase.rpc("update_user_profile", {
      p_user_id: userId,
      p_full_name: fullName,
      p_email: email,
    } as never);

    if (error) return failFromPostgres("admin.updateUser", error, { userId });

    revalidateAdmin();
    return ok(null);
  } catch (erro) {
    console.error("[admin.updateUser] erro inesperado:", erro);
    return fail("unexpected");
  }
}

/** Liga ou desliga a conta. As travas de verdade estão em `set_user_active`. */
export async function setUserActiveAction(input: SetUserActiveInput): Promise<ActionResult<null>> {
  const parsed = setUserActiveSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<null>("users.manage");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_user_active", {
      p_user_id: parsed.data.userId,
      p_active: parsed.data.active,
    } as never);

    if (error)
      return failFromPostgres("admin.setUserActive", error, {
        userId: parsed.data.userId,
        active: parsed.data.active,
      });

    revalidateAdmin();
    return ok(null);
  } catch (erro) {
    console.error("[admin.setUserActive] erro inesperado:", erro);
    return fail("unexpected");
  }
}

/**
 * MANDA O E-MAIL DE RECUPERAÇÃO DE SENHA para outra pessoa.
 *
 * ⚠️ O CLIENTE AQUI NÃO É O DA SESSÃO, E ESSA É A LINHA QUE FAZ O FLUXO
 * FUNCIONAR. O cliente de `@/lib/supabase/server` usa PKCE: ao pedir a
 * recuperação, ele grava um "verificador" num cookie DO NAVEGADOR DE QUEM
 * PEDIU. Como quem pede é o administrador e quem clica no link é outra pessoa,
 * o verificador estaria na máquina errada e a troca falharia com "link
 * inválido" — sem nenhuma pista do motivo.
 *
 * Um cliente sem cookie nenhum não gera verificador, e o link do e-mail vale
 * para quem o receber.
 *
 * ⚠️ ISSO EXIGE O MODELO DE E-MAIL COM TokenHash no painel do Supabase
 * (Authentication > Email Templates > Reset Password), apontando para
 * `/auth/callback`. Com o modelo padrão, o link sai no formato de fragmento
 * (`#access_token=`), que o servidor não consegue ler — e a pessoa cai na tela
 * de "link expirado". Está escrito no .env.example.
 *
 * ⚠️ O E-MAIL VEM DO BANCO, e não do formulário. Aceitar um endereço vindo da
 * tela transformaria esta action num disparador de e-mails para qualquer
 * endereço, assinado pelo domínio da APCS.
 */
export async function resetUserPasswordAction(
  input: ResetUserPasswordInput,
): Promise<ActionResult<{ email: string }>> {
  const parsed = resetUserPasswordSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ email: string }>("users.manage");
  if (negado) return negado;

  try {
    const supabase = await createClient();

    const { data: alvo, error: erroLeitura } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", parsed.data.userId)
      .maybeSingle()
      .returns<{ email: string } | null>();

    if (erroLeitura)
      return failFromPostgres("admin.resetPassword", erroLeitura, {
        userId: parsed.data.userId,
      });
    if (!alvo) return fail("notFound");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return fail("unexpected");

    const semCookie = createSupabaseClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const origem = await getSiteOrigin();
    const { error } = await semCookie.auth.resetPasswordForEmail(alvo.email, {
      redirectTo: origem + "/auth/callback?next=/auth/reset-password",
    });

    if (error) {
      console.error("[admin.resetPassword] envio falhou:", error.message);
      return fail("inviteFailed");
    }

    // A trilha registra DEPOIS do envio: registrar algo que não aconteceu é
    // pior que não registrar.
    const { error: erroTrilha } = await supabase.rpc("log_password_reset", {
      p_email: alvo.email,
    } as never);
    if (erroTrilha) console.error("[admin.resetPassword] trilha falhou:", erroTrilha.message);

    revalidateAdmin();
    return ok({ email: alvo.email });
  } catch (erro) {
    console.error("[admin.resetPassword] erro inesperado:", erro);
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

    if (error)
      return failFromPostgres("admin.updateSegment", error, {
        segmentId: parsed.data.segmentId,
      });

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

    if (error) return failFromPostgres("admin.setSetting", error, { chave: parsed.data.key });

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

    if (error)
      return failFromPostgres("admin.publishConsent", error, { versao: parsed.data.version });

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

    if (error)
      return failFromPostgres("admin.resumeBlock", error, { blockId: parsed.data.blockId });

    revalidateAdmin();
    revalidatePath("/members", "page");
    revalidatePath("/members/[id]", "page");
    return ok({ revoked: data === true });
  } catch (erro) {
    console.error("[admin.resumeBlock] erro inesperado:", erro);
    return fail("unexpected");
  }
}
