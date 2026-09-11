"use server";

import { fail, mapPostgresError, ok, type ActionResult } from "@/lib/actions/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  publicEvaluationSubmissionSchema,
  type PublicEvaluationSubmissionInput,
} from "@/modules/event/event.evaluation.schema";

/**
 * A PORTA PÚBLICA DA AVALIAÇÃO — a resposta vinda de `/avaliacoes/[token]`.
 *
 * ============================================================================
 * ⚠️ ELA NÃO TEM `assertPermission`, E ISSO NÃO É UM ESQUECIMENTO.
 * ============================================================================
 * Não há usuário para autorizar: quem responde é um participante de granja, sem
 * sessão nenhuma. O que substitui a permissão são quatro coisas, e nenhuma delas
 * está nesta tela:
 *
 *   1. O TOKEN. 122 bits de um gerador criptográfico, gerado no banco, nunca
 *      derivado de nada da pessoa e nunca exposto em listagem (a coluna não tem
 *      grant nem para `authenticated`).
 *   2. A ESTREITEZA DA FUNÇÃO. `submit_event_evaluation` recebe um token e um
 *      conjunto de respostas. Não há parâmetro capaz de mexer em configuração,
 *      em pergunta, em outro participante ou em outro evento.
 *   3. A CADEIA CONFERIDA NO BANCO. Toda pergunta respondida tem de pertencer à
 *      VERSÃO daquela avaliação, e toda alternativa à sua pergunta. Um id
 *      trocado é recusado, não gravado no lugar errado (§28, §29).
 *   4. A TRANSAÇÃO. Uma função é uma transação: qualquer recusa desfaz tudo, e
 *      não existe "resposta pela metade" (§30).
 *
 * É o mesmo desenho de `submitPublicRegistrationAction` e de
 * `submitMembershipApplicationAction` — as portas deste sistema que escrevem sem
 * sessão têm de ser reconhecíveis umas nas outras.
 *
 * ============================================================================
 * ⚠️ O QUE NÃO VIAJA NESTE PAYLOAD, E A AUSÊNCIA É A REGRA
 * ============================================================================
 *   • `participantId` — quem responde é definido pelo TOKEN, e só por ele. Um
 *     id de participante no corpo seria um convite a responder no lugar de
 *     outra pessoa (§29).
 *   • o VALOR da nota — o navegador manda QUAL alternativa foi marcada; quanto
 *     ela vale é o banco quem diz, copiando de `numeric_value` (§32). Aceitar o
 *     número de fora deixaria qualquer pessoa mandar "10" numa escala de 5.
 *   • qualquer dado cadastral — o §6 é explícito: a avaliação não pede de novo
 *     o que o sistema já tem.
 */

export type SubmissionOutcome = { state: "answered" };

export async function submitPublicEvaluationAction(
  input: PublicEvaluationSubmissionInput,
): Promise<ActionResult<SubmissionOutcome>> {
  const parsed = publicEvaluationSubmissionSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const admin = createAdminClient();

  const { data, error } = await admin.rpc("submit_event_evaluation", {
    p_token: parsed.data.token,
    // O banco ignora entradas sem conteúdo (texto vazio, nenhuma alternativa) e
    // depois confere as obrigatórias contra o que FOI GRAVADO — então mandar a
    // lista inteira, inclusive o que a pessoa deixou em branco, é seguro e
    // simplifica o formulário.
    p_answers: parsed.data.answers,
  });

  if (error) {
    /**
     * ⚠️ O TOKEN NUNCA ENTRA NO LOG (§34). Ele é a credencial de acesso àquela
     * avaliação — escrito aqui, ficaria em texto puro num lugar que ninguém
     * audita e que costuma ser encaminhado para fora.
     *
     * ⚠️ E `failFromPostgres` NÃO É USADA, pelo mesmo motivo: ela registra
     * `message`, `details` e `hint` do Postgres, e a mensagem de AV006 CARREGA
     * O ENUNCIADO DAS PERGUNTAS que faltaram. Não é dado pessoal, mas é conteúdo
     * da pesquisa indo parar num log por engano — e o hábito de mandar tudo
     * para o log é justamente como dado sensível acaba lá.
     */
    console.error(`[evaluation.public] o banco recusou a resposta: ${error.code}`);
    return fail(mapPostgresError(error).code);
  }

  if (!data || typeof data !== "object") return fail("unexpected");

  /**
   * ⚠️ SEM `revalidatePath`. Esta página é dinâmica por token e não tem cache a
   * invalidar; a tela de gestão, que TEM, é outra rota e outro visitante — e
   * revalidá-la daqui faria uma resposta de participante disparar trabalho de
   * servidor numa tela que ninguém está olhando.
   *
   * A tela de Avaliações lê números do banco a cada abertura, então ela já
   * mostra a resposta nova na próxima visita.
   */
  return ok({ state: "answered" });
}
