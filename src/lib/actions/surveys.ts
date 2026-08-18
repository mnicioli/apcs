"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/assert-permission";
import { fail, mapPostgresError, ok, type ActionResult } from "@/lib/actions/errors";
import { searchContacts } from "@/lib/services/surveys";
import { createClient } from "@/lib/supabase/server";
import {
  surveyAudienceSchema,
  surveyCancelSchema,
  surveyCoreSchema,
  surveyDetailsSchema,
  surveyQuestionSchema,
  surveyScheduleSchema,
  type SurveyAudienceInput,
  type SurveyDetailsInput,
  type SurveyFormInput,
  type SurveyQuestionInput,
  type SurveyScheduleInput,
} from "@/modules/survey/survey.schema";
import type { SurveyStatus } from "@/modules/survey/survey.types";

/**
 * ACTION = escrita. SEMPRE retorna `ActionResult<T>`, NUNCA lança.
 *
 * Ordem obrigatória: validar → autorizar → escrever → mapear erro → revalidar.
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 *
 * O QUE FICA NO BANCO, E POR QUÊ: toda operação aqui são VÁRIAS escritas que
 * precisam acontecer juntas (§80) — a linha, a pergunta, as alternativas, a
 * fotografia do público, a auditoria. O supabase-js não faz transação de várias
 * chamadas, então isso são funções Postgres. Aqui em cima ficam a autorização e
 * a validação de formulário.
 *
 * ⚠️ `assertPermission` NÃO é a barreira — é a primeira de três. Abaixo dela
 * estão a RLS e, nas funções, a checagem de papel (`survey_is_writer`). Uma
 * chamada direta ao PostgREST pula esta camada e para nas outras duas; foi
 * testado papel a papel na bateria de permissões.
 */

/** O que as funções transacionais devolvem: a linha da enquete afetada. */
interface SurveyRpcResult {
  id: string;
  title: string;
  status: SurveyStatus;
  starts_at: string | null;
  ends_at: string | null;
  scheduled_at: string | null;
}

/**
 * Invalida o cache das telas de enquetes.
 *
 * Usa o PADRÃO da rota de detalhe (`/surveys/[id]`), e não o endereço concreto:
 * qualquer escrita muda o que a grid, o detalhe e os resultados mostram, e
 * invalidar os três de uma vez custa nada numa tela de backoffice.
 */
function revalidateSurveys(): void {
  revalidatePath("/surveys", "page");
  revalidatePath("/surveys/[id]", "page");
  revalidatePath("/surveys/results", "page");
}

/** `""` do formulário significa "não informado", que no banco é NULL. */
function nullIfEmpty(value: string | undefined | null): string | null {
  const limpo = value?.trim();
  return limpo ? limpo : null;
}

// ---------------------------------------------------------------------------
// Criação (§4, §6, §7)
// ---------------------------------------------------------------------------

export async function createSurveyAction(
  input: SurveyFormInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = surveyCoreSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  // `assertPermission` devolve NULL quando autorizado, e um ActionResult
  // `forbidden` quando não. Devolver o próprio resultado (em vez de montar um
  // `fail` novo) mantém o contrato num lugar só.
  const negado = await assertPermission<never>("surveys.write");
  if (negado) return negado;

  const dados = parsed.data;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_survey", {
      p_title: dados.title,
      p_description: nullIfEmpty(dados.description),
      p_question: dados.question,
      p_options: dados.options,
      p_starts_at: nullIfEmpty(dados.startsAt),
      p_ends_at: nullIfEmpty(dados.endsAt),
      p_scheduled_at: nullIfEmpty(dados.scheduledAt),
      p_is_anonymous: dados.isAnonymous,
      p_allows_response_change: dados.allowsResponseChange,
    } as never);

    if (error) {
      const mapeado = mapPostgresError(error);
      return fail(mapeado.code, mapeado.constraint);
    }
    if (!data) return fail("unexpected");

    revalidateSurveys();
    return ok({ id: (data as SurveyRpcResult).id });
  } catch (error) {
    console.error(
      `[surveys] createSurvey falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

// ---------------------------------------------------------------------------
// Edição descritiva (§60)
// ---------------------------------------------------------------------------

export async function updateSurveyAction(
  id: string,
  input: SurveyDetailsInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = surveyDetailsSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  // `assertPermission` devolve NULL quando autorizado, e um ActionResult
  // `forbidden` quando não. Devolver o próprio resultado (em vez de montar um
  // `fail` novo) mantém o contrato num lugar só.
  const negado = await assertPermission<never>("surveys.write");
  if (negado) return negado;

  const dados = parsed.data;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("update_survey", {
      p_survey_id: id,
      p_title: dados.title,
      p_description: nullIfEmpty(dados.description),
      p_starts_at: nullIfEmpty(dados.startsAt),
      p_ends_at: nullIfEmpty(dados.endsAt),
      p_scheduled_at: nullIfEmpty(dados.scheduledAt),
      p_is_anonymous: dados.isAnonymous,
      p_allows_response_change: dados.allowsResponseChange,
    } as never);

    if (error) {
      const mapeado = mapPostgresError(error);
      return fail(mapeado.code, mapeado.constraint);
    }
    if (!data) return fail("notFound");

    revalidateSurveys();
    return ok({ id: (data as SurveyRpcResult).id });
  } catch (error) {
    console.error(
      `[surveys] updateSurvey falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

// ---------------------------------------------------------------------------
// Pergunta e alternativas (§60, §61)
// ---------------------------------------------------------------------------

export async function updateSurveyQuestionAction(
  id: string,
  input: SurveyQuestionInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = surveyQuestionSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  // `assertPermission` devolve NULL quando autorizado, e um ActionResult
  // `forbidden` quando não. Devolver o próprio resultado (em vez de montar um
  // `fail` novo) mantém o contrato num lugar só.
  const negado = await assertPermission<never>("surveys.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_survey_question", {
      p_survey_id: id,
      p_question: parsed.data.question,
      p_options: parsed.data.options,
    } as never);

    if (error) {
      const mapeado = mapPostgresError(error);
      return fail(mapeado.code, mapeado.constraint);
    }

    revalidateSurveys();
    return ok({ id });
  } catch (error) {
    console.error(
      `[surveys] updateSurveyQuestion falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

// ---------------------------------------------------------------------------
// Segmentação (§23 a §31, §71)
// ---------------------------------------------------------------------------

/**
 * Substitui o conjunto de critérios e devolve QUANTAS PESSOAS ele alcança.
 *
 * O total volta junto de propósito: o §32 pede o número antes do envio, e
 * devolvê-lo aqui evita uma segunda ida ao servidor logo depois de salvar — que
 * é exatamente o momento em que a pessoa quer saber se acertou a segmentação.
 */
export async function setSurveyAudienceAction(
  id: string,
  input: SurveyAudienceInput,
): Promise<ActionResult<{ eligible: number }>> {
  const parsed = surveyAudienceSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  // `assertPermission` devolve NULL quando autorizado, e um ActionResult
  // `forbidden` quando não. Devolver o próprio resultado (em vez de montar um
  // `fail` novo) mantém o contrato num lugar só.
  const negado = await assertPermission<never>("surveys.write");
  if (negado) return negado;

  const criterios = parsed.data.map((c) => ({
    dimension: c.dimension,
    segmentId: nullIfEmpty(c.segmentId),
    contactId: nullIfEmpty(c.contactId),
    value: nullIfEmpty(c.value),
  }));

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("set_survey_audience", {
      p_survey_id: id,
      p_criteria: criterios,
    } as never);

    if (error) {
      const mapeado = mapPostgresError(error);
      return fail(mapeado.code, mapeado.constraint);
    }

    revalidateSurveys();
    return ok({ eligible: (data as number | null) ?? 0 });
  } catch (error) {
    console.error(
      `[surveys] setSurveyAudience falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

/**
 * §30. Quantas pessoas estes critérios alcançam — SEM gravar nada.
 *
 * ⚠️ É uma action de LEITURA, e isso é deliberado. Ela não vive no service
 * porque a tela precisa chamá-la do navegador a cada mudança de critério, e um
 * service (`server-only`) não é chamável de um componente cliente.
 *
 * Não persiste: no formulário de criação a enquete ainda nem existe. A regra de
 * combinação é a MESMA que o agendamento vai aplicar — as duas passam por
 * `resolve_audience_criteria` no banco (§66: não duplicar regra no frontend).
 * É isso que faz o número previsto e o número fotografado serem o mesmo número.
 */
export async function estimateAudienceAction(
  input: SurveyAudienceInput,
): Promise<ActionResult<{ eligible: number }>> {
  // ⚠️ VAZIO E INVÁLIDO NÃO SÃO A MESMA COISA, e confundi-los custou um defeito.
  //
  // Nada selecionado ainda é uma estimativa legítima de zero: a pessoa está no
  // meio da escolha, e mostrar "dados inválidos" a cada clique seria implicar
  // com quem está trabalhando.
  //
  // Já um payload MALFORMADO é um defeito nosso — e devolver `0` para ele
  // exibiria "nenhum contato" com toda a confiança, indistinguível de um público
  // realmente vazio. Foi assim que a estimativa mostrou zero para "Região = SP",
  // que alcança quatro pessoas. Agora falha visivelmente.
  if (!Array.isArray(input) || input.length === 0) return ok({ eligible: 0 });

  const parsed = surveyAudienceSchema.safeParse(input);
  if (!parsed.success) {
    console.error(
      `[surveys] estimativa recebeu critérios inválidos: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
    return fail("invalidInput");
  }

  const negado = await assertPermission<never>("surveys.read");
  if (negado) return negado;

  const criterios = parsed.data.map((c) => ({
    dimension: c.dimension,
    segmentId: nullIfEmpty(c.segmentId),
    contactId: nullIfEmpty(c.contactId),
    value: nullIfEmpty(c.value),
  }));

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("estimate_audience_criteria", {
      p_criteria: criterios,
    } as never);

    if (error) {
      const mapeado = mapPostgresError(error);
      return fail(mapeado.code, mapeado.constraint);
    }

    return ok({ eligible: (data as number | null) ?? 0 });
  } catch (error) {
    console.error(
      `[surveys] estimateAudience falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

/**
 * §29/§64. O autocomplete de contatos específicos.
 *
 * Action, e não service, pelo mesmo motivo da estimativa: quem chama é um
 * componente cliente enquanto a pessoa digita.
 */
export async function searchContactsAction(
  term: string,
): Promise<ActionResult<{ contactId: string; fullName: string | null; phone: string | null }[]>> {
  const negado = await assertPermission<never>("surveys.read");
  if (negado) return negado;

  try {
    return ok(await searchContacts(term));
  } catch (error) {
    console.error(
      `[surveys] searchContacts falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

// ---------------------------------------------------------------------------
// Agendamento e ciclo de vida (§35, §57, §58, §59)
// ---------------------------------------------------------------------------

export async function scheduleSurveyAction(
  id: string,
  input: SurveyScheduleInput,
): Promise<ActionResult<{ id: string; recipients: number }>> {
  const parsed = surveyScheduleSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  // `assertPermission` devolve NULL quando autorizado, e um ActionResult
  // `forbidden` quando não. Devolver o próprio resultado (em vez de montar um
  // `fail` novo) mantém o contrato num lugar só.
  const negado = await assertPermission<never>("surveys.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("schedule_survey", {
      p_survey_id: id,
      p_scheduled_at: parsed.data.scheduledAt,
      p_starts_at: nullIfEmpty(parsed.data.startsAt),
      p_ends_at: parsed.data.endsAt,
    } as never);

    if (error) {
      const mapeado = mapPostgresError(error);
      return fail(mapeado.code, mapeado.constraint);
    }
    if (!data) return fail("notFound");

    // A fotografia acabou de ser tirada (§33); o número dela é o que a tela
    // precisa confirmar ("50 contatos receberão").
    const { count } = await supabase
      .from("survey_recipients")
      .select("id", { count: "exact", head: true })
      .eq("survey_id", id);

    revalidateSurveys();
    return ok({ id: (data as SurveyRpcResult).id, recipients: count ?? 0 });
  } catch (error) {
    console.error(
      `[surveys] scheduleSurvey falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

/** §11. Volta ao rascunho para corrigir antes do disparo — descarta a fotografia. */
export async function unscheduleSurveyAction(id: string): Promise<ActionResult<{ id: string }>> {
  return simpleStatusAction(id, "unschedule_survey", "unscheduleSurvey");
}

/** §3/§12. Ativa a enquete: a partir daqui ela recebe respostas. */
export async function activateSurveyAction(id: string): Promise<ActionResult<{ id: string }>> {
  return simpleStatusAction(id, "activate_survey", "activateSurvey");
}

/** §58. Encerramento manual, antes da data prevista. */
export async function closeSurveyAction(id: string): Promise<ActionResult<{ id: string }>> {
  return simpleStatusAction(id, "close_survey", "closeSurvey");
}

/** §14/§59. Cancela — e tira da fila o que ainda não saiu. */
export async function cancelSurveyAction(
  id: string,
  input: { reason?: string } = {},
): Promise<ActionResult<{ id: string }>> {
  const parsed = surveyCancelSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  // `assertPermission` devolve NULL quando autorizado, e um ActionResult
  // `forbidden` quando não. Devolver o próprio resultado (em vez de montar um
  // `fail` novo) mantém o contrato num lugar só.
  const negado = await assertPermission<never>("surveys.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("cancel_survey", {
      p_survey_id: id,
      p_reason: nullIfEmpty(parsed.data.reason),
    } as never);

    if (error) {
      const mapeado = mapPostgresError(error);
      return fail(mapeado.code, mapeado.constraint);
    }
    if (!data) return fail("notFound");

    revalidateSurveys();
    return ok({ id: (data as SurveyRpcResult).id });
  } catch (error) {
    console.error(
      `[surveys] cancelSurvey falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

/**
 * §19/§27 do PROMPT 3/3. Devolve à fila quem falhou no envio.
 *
 * Existe porque a causa mais comum de falha é externa e passageira — o
 * fornecedor fora do ar, o número corrigido no cadastro, o template aprovado
 * depois. Sem este caminho, a única saída seria reagendar a campanha inteira,
 * o que reenviaria para quem JÁ RECEBEU.
 *
 * ⚠️ O teto de tentativas e a recusa de ressuscitar quem pediu opt-out são do
 * banco, não daqui: `retry_failed_survey_recipients` os aplica mesmo que este
 * arquivo seja chamado de outro lugar.
 */
export async function retryFailedRecipientsAction(
  id: string,
): Promise<ActionResult<{ id: string; requeued: number }>> {
  // `assertPermission` devolve NULL quando autorizado, e um ActionResult
  // `forbidden` quando não. Devolver o próprio resultado (em vez de montar um
  // `fail` novo) mantém o contrato num lugar só.
  const negado = await assertPermission<never>("surveys.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("retry_failed_survey_recipients", {
      p_survey_id: id,
    } as never);

    if (error) {
      const mapeado = mapPostgresError(error);
      return fail(mapeado.code, mapeado.constraint);
    }

    revalidateSurveys();
    return ok({ id, requeued: typeof data === "number" ? data : 0 });
  } catch (error) {
    console.error(
      `[surveys] retryFailedRecipients falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

/** §10. Descarta um rascunho. Depois disso o caminho é o cancelamento. */
export async function deleteSurveyAction(id: string): Promise<ActionResult<{ id: string }>> {
  // `assertPermission` devolve NULL quando autorizado, e um ActionResult
  // `forbidden` quando não. Devolver o próprio resultado (em vez de montar um
  // `fail` novo) mantém o contrato num lugar só.
  const negado = await assertPermission<never>("surveys.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_survey", { p_survey_id: id } as never);

    if (error) {
      const mapeado = mapPostgresError(error);
      return fail(mapeado.code, mapeado.constraint);
    }

    revalidateSurveys();
    return ok({ id });
  } catch (error) {
    console.error(
      `[surveys] deleteSurvey falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

/**
 * As três operações que só recebem o id e devolvem a linha.
 *
 * Uma função em vez de três cópias porque o corpo é idêntico e o que muda é o
 * nome da RPC — e três cópias é como uma delas esquece de revalidar o cache.
 */
async function simpleStatusAction(
  id: string,
  rpc: "unschedule_survey" | "activate_survey" | "close_survey",
  label: string,
): Promise<ActionResult<{ id: string }>> {
  // `assertPermission` devolve NULL quando autorizado, e um ActionResult
  // `forbidden` quando não. Devolver o próprio resultado (em vez de montar um
  // `fail` novo) mantém o contrato num lugar só.
  const negado = await assertPermission<never>("surveys.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(rpc, { p_survey_id: id } as never);

    if (error) {
      const mapeado = mapPostgresError(error);
      return fail(mapeado.code, mapeado.constraint);
    }
    if (!data) return fail("notFound");

    revalidateSurveys();
    return ok({ id: (data as SurveyRpcResult).id });
  } catch (error) {
    console.error(`[surveys] ${label} falhou: ${error instanceof Error ? error.message : error}`);
    return fail("unexpected");
  }
}
