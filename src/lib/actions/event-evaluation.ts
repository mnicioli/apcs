"use server";

import { revalidatePath } from "next/cache";
import { failFromPostgres, fail, ok, type ActionResult } from "@/lib/actions/errors";
import { assertPermission } from "@/lib/auth/assert-permission";
import { createClient } from "@/lib/supabase/server";
import {
  applyTemplateSchema,
  evaluationParticipantActionSchema,
  evaluationSettingsSchema,
  evaluationStructureSchema,
  type ApplyTemplateInput,
  type EvaluationParticipantActionInput,
  type EvaluationSettingsInput,
  type EvaluationStructureInput,
} from "@/modules/event/event.evaluation.schema";
import type { EvaluationDetail } from "@/modules/event/event.evaluation.types";

/**
 * AS ESCRITAS DA AVALIAÇÃO DE EVENTO.
 *
 * Ver docs/SERVICE-ACTION-PATTERN.md: escrita retorna `ActionResult`, nunca
 * lança.
 *
 * ============================================================================
 * ⚠️ TRÊS PERMISSÕES NESTE ARQUIVO, E NÃO UMA.
 * ============================================================================
 *   `evaluations.write`  configurar e editar perguntas  (Administrador)
 *   `evaluations.send`   reenviar e cancelar convite    (Adm. e Atendente)
 *   `evaluations.write`  reabrir uma respondida         (Administrador)
 *
 * Cada action declara a sua, e as três voltam a aparecer DENTRO das funções do
 * Postgres. A checagem daqui é a 1ª camada — a que produz a mensagem certa e
 * esconde o botão; a do banco é a que VALE, inclusive para quem chamar o
 * PostgREST direto.
 *
 * ⚠️ E A DO BANCO NÃO É REDUNDANTE. As funções são `SECURITY DEFINER` (precisam
 * ser: gravam na trilha, que é fechada), e DEFINER desliga a RLS. Sem a
 * checagem lá dentro, esta aqui seria a única — e uma action é código de
 * aplicação, alcançável por qualquer rota nova que alguém escreva.
 */

/**
 * ⚠️ O PADRÃO DE ROTA, E NÃO O ENDEREÇO CONCRETO — é o que
 * `revalidatePath("/events/presence/[eventId]", "page")` já faz neste módulo.
 * `revalidatePath("/events/evaluations")` NÃO alcança
 * `/events/evaluations/<id>`: a tela que acabou de mudar continuaria servindo o
 * cache antigo.
 *
 * ⚠️ E AS DUAS, aqui — diferente da presença. A grid de seleção mostra
 * "configurada", "habilitada", "enviadas" e "respondidas", e todas as quatro
 * mudam quando alguém mexe na configuração de um evento. Invalidar só a tela de
 * dentro deixaria a lista mentindo até a próxima revalidação.
 */
function revalidarAvaliacoes(): void {
  revalidatePath("/events/evaluations/[eventId]", "page");
  revalidatePath("/events/evaluations", "page");
}

/**
 * Habilita, desabilita e configura o envio (§9, §22).
 *
 * ⚠️ HABILITAR TAMBÉM CRIA A AVALIAÇÃO DO EVENTO, e isso acontece no banco
 * (`ensure_event_evaluation`), não aqui. Duas chamadas — "cria" e depois
 * "configura" — poderiam falhar entre uma e outra e deixar o evento com uma
 * avaliação órfã que ninguém pediu.
 *
 * ⚠️ SEM HORÁRIO DE TÉRMINO O BANCO RECUSA (AV001, §10). É a única regra deste
 * módulo que nasce de um campo OPCIONAL de outro módulo (`events.end_time`), e
 * por isso ela mora lá: a tela avisa, mas quem impede é o Postgres.
 */
export async function saveEvaluationSettingsAction(
  input: EvaluationSettingsInput,
): Promise<ActionResult<EvaluationDetail>> {
  const parsed = evaluationSettingsSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<EvaluationDetail>("evaluations.write");
  if (negado) return negado;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("save_event_evaluation_settings", {
    p_event_id: parsed.data.eventId,
    p_enabled: parsed.data.enabled,
    p_delay_minutes: parsed.data.delayMinutes,
    p_response_window_days: parsed.data.responseWindowDays ?? undefined,
    p_template_id: parsed.data.templateId ?? undefined,
  } as never);

  if (error || !data) {
    return error
      ? failFromPostgres("evaluation.settings", error, { eventId: parsed.data.eventId })
      : fail("unexpected");
  }

  revalidarAvaliacoes();
  return ok(data as unknown as EvaluationDetail);
}

/**
 * Recomeça a partir de um modelo (§22).
 *
 * ⚠️ ACTION SEPARADA DA CONFIGURAÇÃO, e a razão é que ela DESTRÓI trabalho:
 * trocar o modelo joga fora as perguntas que alguém escreveu. Enfiada dentro de
 * "salvar configuração", seria disparada por quem só queria mudar o atraso de
 * 30 para 60 minutos.
 *
 * O banco recusa quando já há resposta (AV004) — ali não existe a saída do §23
 * (versionar), porque trocar o modelo inteiro não é alterar a estrutura: é
 * outra pesquisa.
 */
export async function applyEvaluationTemplateAction(
  input: ApplyTemplateInput,
): Promise<ActionResult<EvaluationDetail>> {
  const parsed = applyTemplateSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<EvaluationDetail>("evaluations.write");
  if (negado) return negado;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("apply_evaluation_template", {
    p_event_id: parsed.data.eventId,
    p_template_id: parsed.data.templateId,
  } as never);

  if (error || !data) {
    return error
      ? failFromPostgres("evaluation.template", error, {
          eventId: parsed.data.eventId,
          templateId: parsed.data.templateId,
        })
      : fail("unexpected");
  }

  revalidarAvaliacoes();
  return ok(data as unknown as EvaluationDetail);
}

/**
 * Salva o formulário inteiro (§24).
 *
 * ⚠️ A ESTRUTURA VAI COMPLETA, E NÃO EM PEDAÇOS. Não existe "adicionar bloco"
 * nem "mover pergunta" como operação — a tela edita um rascunho em memória e
 * manda tudo de uma vez. Ver a decisão 3 da migration: é o que faz reordenar,
 * remover e acrescentar serem UMA transação, e não três que podem falhar pela
 * metade.
 *
 * ⚠️ SALVAR PODE CRIAR UMA VERSÃO NOVA, e quem decide é o banco (§23). Se a
 * versão corrente já tem resposta, ele constrói a v+1 em vez de reescrever — e
 * a tela avisa isso antes, lendo `versionHasAnswers`.
 */
export async function saveEvaluationStructureAction(
  input: EvaluationStructureInput,
): Promise<ActionResult<EvaluationDetail>> {
  // ⚠️ A MENSAGEM DETALHADA É DO CLIENTE, e não daqui — é a convenção do
  // projeto (`fail` leva código, não frase). O construtor roda o MESMO
  // `evaluationStructureSchema` antes de chamar, e é lá que "o bloco X está sem
  // perguntas" aparece ao lado do bloco X. Este `safeParse` é a barreira para
  // quem não passou por aquela tela.
  const parsed = evaluationStructureSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<EvaluationDetail>("evaluations.write");
  if (negado) return negado;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("save_event_evaluation_structure", {
    p_event_id: parsed.data.eventId,
    // ⚠️ O `position` NÃO É ENVIADO. Quem numera é o banco, com `ordinality`
    // sobre o array recebido — a ORDEM do array é a ordem do formulário. Mandar
    // a posição daqui criaria uma segunda fonte para ela, e as duas divergiriam
    // no primeiro arrastar-e-soltar.
    p_sections: parsed.data.sections,
  } as never);

  if (error || !data) {
    return error
      ? failFromPostgres("evaluation.structure", error, { eventId: parsed.data.eventId })
      : fail("unexpected");
  }

  revalidarAvaliacoes();
  return ok(data as unknown as EvaluationDetail);
}

/**
 * Reenvia o convite de uma pessoa (§17).
 *
 * ⚠️ `evaluations.send`, E NÃO `evaluations.write`. Reenviar é operação de quem
 * está tocando o evento; editar a pergunta é decisão de quem responde pela
 * pesquisa. O Atendente faz a primeira e não a segunda.
 *
 * ⚠️ E ISSO NÃO CRIA RESPOSTA NENHUMA. A linha é a mesma, com a mesma chave
 * (evento, participante) e o MESMO token — o link que a pessoa talvez já tenha
 * continua valendo. O banco recusa se ela já respondeu (AV004).
 */
export async function resendEvaluationAction(
  input: EvaluationParticipantActionInput,
): Promise<ActionResult<{ id: string; status: string }>> {
  return acaoPorParticipante(input, "resend_event_evaluation", "evaluations.send");
}

/** Tira o convite da fila (§8). Recusa depois de respondida. */
export async function cancelEvaluationAction(
  input: EvaluationParticipantActionInput,
): Promise<ActionResult<{ id: string; status: string }>> {
  return acaoPorParticipante(input, "cancel_event_evaluation", "evaluations.send");
}

/**
 * A exceção do §19 — reabrir uma avaliação já respondida.
 *
 * ⚠️ NADA É APAGADO. O banco incrementa `answer_round`: as respostas anteriores
 * continuam onde estão e a pessoa responde AO LADO delas. O §19 é explícito —
 * "não apagar histórico", "não implementar exclusão física da resposta".
 *
 * ⚠️ `evaluations.write`, E NÃO `send` COMO AS DUAS DE CIMA. Reenviar é
 * operação; reabrir MEXE NO DADO JÁ COLETADO, e quem responde pelo que a APCS
 * vai concluir da pesquisa é quem configura a pesquisa.
 */
export async function reopenEvaluationAction(
  input: EvaluationParticipantActionInput,
): Promise<ActionResult<{ id: string; status: string }>> {
  return acaoPorParticipante(input, "reopen_event_evaluation", "evaluations.write");
}

/**
 * As três ações por participante, num lugar só.
 *
 * ⚠️ ELAS SÃO A MESMA FORMA: o mesmo payload, a mesma cadeia a conferir, o
 * mesmo tratamento de erro, a mesma revalidação. O que muda é a função do banco
 * e a permissão — e os dois são parâmetros. Três cópias deste corpo seriam três
 * lugares para a próxima correção não chegar, e a de menos uso seria a que
 * ficaria para trás.
 */
async function acaoPorParticipante(
  input: EvaluationParticipantActionInput,
  fn: "resend_event_evaluation" | "cancel_event_evaluation" | "reopen_event_evaluation",
  permissao: "evaluations.send" | "evaluations.write",
): Promise<ActionResult<{ id: string; status: string }>> {
  const parsed = evaluationParticipantActionSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string; status: string }>(permissao);
  if (negado) return negado;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(fn, {
    // ⚠️ §28 — SEM O EVENTO, UM ID DE AVALIAÇÃO DE OUTRO EVENTO PASSARIA.
    // `participantEvaluationId` vem do navegador; é o banco que confere se ele
    // pertence a este evento, e recusa sem distinguir "não existe" de "é de
    // outro".
    p_event_id: parsed.data.eventId,
    p_participant_evaluation_id: parsed.data.participantEvaluationId,
  } as never);

  if (error || !data) {
    return error
      ? failFromPostgres(`evaluation.${fn}`, error, {
          // ⚠️ IDS, NUNCA NOME OU E-MAIL. O log de erro é um caminho que ninguém
          // audita, e dado pessoal que entra nele não sai.
          eventId: parsed.data.eventId,
          participantEvaluationId: parsed.data.participantEvaluationId,
        })
      : fail("unexpected");
  }

  revalidarAvaliacoes();
  return ok(data as unknown as { id: string; status: string });
}
