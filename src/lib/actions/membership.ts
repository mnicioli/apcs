"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { fail, mapPostgresError, ok, type ActionResult } from "@/lib/actions/errors";
import { assertPermission } from "@/lib/auth/assert-permission";
import { clientIpHashFromHeaders } from "@/lib/security/client-ip";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  applicationIdSchema,
  approveApplicationSchema,
  membershipApplicationSchema,
  onlyDigits,
  rejectApplicationSchema,
  type ApproveApplicationInput,
  type MembershipApplicationInput,
  type RejectApplicationInput,
} from "@/modules/membership/membership.schema";
import { MEMBERSHIP_CONSENT_VERSION } from "@/modules/membership/membership.labels";

/**
 * ACTION = escrita. SEMPRE retorna `ActionResult<T>`, NUNCA lança.
 *
 * Ordem obrigatória: validar → autorizar → escrever → mapear erro → revalidar.
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 *
 * ⚠️ ESTE ARQUIVO TEM DOIS PÚBLICOS, E ELES NÃO SE MISTURAM.
 *
 * 1. `submitMembershipApplicationAction` é PÚBLICA: quem a chama é um visitante
 *    sem sessão, vindo de /associe-se. Ela usa o cliente `service_role` porque
 *    não existe usuário para a RLS avaliar — e a autorização, nesse caso, é a
 *    assinatura da função no banco: `submit_membership_application` não tem
 *    parâmetro capaz de mexer em outra coisa que não seja criar uma solicitação
 *    nova. É o mesmo desenho de `register_survey_response` em Enquetes.
 *
 * 2. As demais são do CRM: passam por `assertPermission("members.write")`, pelo
 *    cliente autenticado (logo, pela RLS) e por funções que checam o papel
 *    (`membership_is_writer`). Três camadas — uma chamada direta ao PostgREST
 *    pula a primeira e para nas outras duas.
 */

/* -------------------------------------------------------------------------- */
/* 1. O formulário público                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Janela da chave de deduplicação.
 *
 * Cinco minutos: longo o bastante para cobrir duplo clique, F5 e rede ruim;
 * curto o bastante para não impedir alguém de corrigir um erro de digitação e
 * reenviar. Fora da janela, o mesmo e-mail cria uma solicitação nova — que é o
 * comportamento certo, porque a segunda pode ser justamente a correta.
 */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

function buildDedupeKey(email: string, profileType: string): string {
  const janela = Math.floor(Date.now() / DEDUPE_WINDOW_MS);
  return `${email.trim().toLowerCase()}|${profileType}|${janela}`;
}

export interface MembershipSubmitResult {
  protocol: string;
  /** `true` quando o envio caiu na janela de deduplicação — a tela não precisa
   *  contar isso à pessoa, que enviou uma vez e recebeu um protocolo. */
  duplicate: boolean;
}

export async function submitMembershipApplicationAction(
  input: MembershipApplicationInput,
): Promise<ActionResult<MembershipSubmitResult>> {
  const parsed = membershipApplicationSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const dados = parsed.data;

  // Sem `assertPermission`: não há usuário. O que substitui a permissão aqui é
  // a estreiteza da função do banco somada ao limite de taxa por IP.
  const cabecalhos = await headers();
  const ipHash = clientIpHashFromHeaders(cabecalhos);

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("submit_membership_application", {
      p_profile_type: dados.profileType,
      p_full_name: dados.fullName,
      p_whatsapp: onlyDigits(dados.whatsapp),
      p_email: dados.email,
      p_city: dados.city,
      p_state: dados.state,
      p_dedupe_key: buildDedupeKey(dados.email, dados.profileType),
      p_organization: dados.organization,
      p_farm_name: dados.farmName,
      p_production_city: dados.productionCity,
      // O formulário coleta texto (é um `<input>`); o banco guarda inteiro.
      p_sow_count: dados.sowCount ? Number(dados.sowCount) : undefined,
      p_cnpj: dados.cnpj ? onlyDigits(dados.cnpj) : undefined,
      p_state_registration: dados.stateRegistration,
      p_activity_area: dados.activityArea,
      p_job_title: dados.jobTitle,
      p_legal_name: dados.legalName,
      p_trade_name: dados.tradeName,
      p_interests: dados.interests,
      p_other_interest: dados.otherInterest,
      p_consent_policy_version: MEMBERSHIP_CONSENT_VERSION,
      p_source_ip_hash: ipHash ?? undefined,
      p_user_agent: cabecalhos.get("user-agent") ?? undefined,
    });

    if (error) {
      // ⚠️ O log fica no SERVIDOR e sem dado pessoal: o formulário é público, e
      // um erro que despeje nome e e-mail no log de produção é um vazamento
      // silencioso. O código do Postgres é o que interessa para depurar.
      console.error("[membership.submit] falha ao registrar solicitação:", error.code);
      return fail(mapPostgresError(error).code);
    }

    const linha = data?.[0];
    if (!linha) return fail("unexpected");

    // A caixa de entrada do CRM tem um contador na navegação: sem isto, quem
    // está com a tela aberta não vê a solicitação nova chegar.
    revalidateMembership();

    return ok({ protocol: linha.protocol, duplicate: linha.duplicate });
  } catch (erro) {
    console.error("[membership.submit] erro inesperado:", erro);
    return fail("unexpected");
  }
}

/* -------------------------------------------------------------------------- */
/* 2. As decisões do CRM                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Invalida o cache das telas de Associados.
 *
 * Usa o PADRÃO da rota de detalhe, e não o endereço concreto: qualquer escrita
 * muda o que a caixa de entrada, o detalhe e o registro mostram, e invalidar os
 * três custa nada numa tela de backoffice.
 */
function revalidateMembership(): void {
  revalidatePath("/members", "page");
  revalidatePath("/members/applications", "page");
  revalidatePath("/members/applications/[id]", "page");
}

export async function startMembershipReviewAction(id: string): Promise<ActionResult<null>> {
  const parsed = applicationIdSchema.safeParse({ id });
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<null>("members.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    // ⚠️ `as never` nos argumentos: é o mesmo contorno usado em todas as
    // actions do projeto (ver src/lib/actions/surveys.ts). O cliente do
    // `@supabase/ssr` perde a inferência de `Args` do RPC e cai no default
    // `never` do postgrest-js — sem o cast, uma chamada CORRETA não compila.
    // Os tipos gerados continuam valendo: quem confere a assinatura de verdade
    // é o banco, e a bateria SQL cobre cada uma destas funções.
    const { error } = await supabase.rpc("start_membership_review", {
      p_application_id: parsed.data.id,
    } as never);
    if (error) return fail(mapPostgresError(error).code);

    revalidateMembership();
    return ok(null);
  } catch (erro) {
    console.error("[membership.startReview] erro inesperado:", erro);
    return fail("unexpected");
  }
}

export async function approveMembershipApplicationAction(
  input: ApproveApplicationInput,
): Promise<ActionResult<{ memberId: string }>> {
  const parsed = approveApplicationSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ memberId: string }>("members.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    // A função devolve a linha do ASSOCIADO — criar (ou vincular) e marcar a
    // solicitação acontecem na mesma transação, no banco. Aqui não dá para
    // fazer as duas coisas e ter certeza de que as duas aconteceram.
    const { data, error } = await supabase.rpc("approve_membership_application", {
      p_application_id: parsed.data.id,
      p_note: parsed.data.note,
    } as never);

    if (error) return fail(mapPostgresError(error).code);
    const membro = data as { id: string } | null;
    if (!membro?.id) return fail("unexpected");

    revalidateMembership();
    return ok({ memberId: membro.id });
  } catch (erro) {
    console.error("[membership.approve] erro inesperado:", erro);
    return fail("unexpected");
  }
}

export async function rejectMembershipApplicationAction(
  input: RejectApplicationInput,
): Promise<ActionResult<null>> {
  const parsed = rejectApplicationSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<null>("members.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("reject_membership_application", {
      p_application_id: parsed.data.id,
      p_reason: parsed.data.reason,
    } as never);
    if (error) return fail(mapPostgresError(error).code);

    revalidateMembership();
    return ok(null);
  } catch (erro) {
    console.error("[membership.reject] erro inesperado:", erro);
    return fail("unexpected");
  }
}

export async function reopenMembershipApplicationAction(id: string): Promise<ActionResult<null>> {
  const parsed = applicationIdSchema.safeParse({ id });
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<null>("members.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("reopen_membership_application", {
      p_application_id: parsed.data.id,
    } as never);
    if (error) return fail(mapPostgresError(error).code);

    revalidateMembership();
    return ok(null);
  } catch (erro) {
    console.error("[membership.reopen] erro inesperado:", erro);
    return fail("unexpected");
  }
}
