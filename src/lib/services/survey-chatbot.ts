import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  toChatbotSurvey,
  type ChatbotSurveyResponseResult,
  type ChatbotSurveyResult,
} from "@/modules/survey/survey.chatbot";
import { SURVEY_RESPONSE_INVALID } from "@/modules/survey/survey.labels";
import { surveyReplySchema, surveyResponseSchema } from "@/modules/survey/survey.schema";
import { resolveOptionByPosition, responseMessage } from "@/modules/survey/survey.rules";
import type { SurveyOption, SurveyResponseOutcome } from "@/modules/survey/survey.types";

/**
 * A PORTA DO CHATBOT PARA ENQUETES — a única.
 *
 * O chat público é ANÔNIMO: não há `auth.uid()`, não há papel, e
 * `survey_responses` não tem policy de escrita para ninguém. Por isso este
 * arquivo usa o cliente `service_role`, exatamente como `csp_leads` e Palestras
 * já fazem. A superfície pública do banco continua sendo zero: toda escrita
 * anônima passa pelo servidor Next.
 *
 * ⚠️ O QUE AUTORIZA ISSO NÃO É ESTE ARQUIVO — é a assinatura da função no banco.
 *
 * `register_survey_response` não tem parâmetro de status, de data, nem de
 * qualquer coisa que altere a enquete. O bot só pode fazer uma coisa: registrar
 * um voto de uma pessoa numa alternativa. Não é uma checagem que alguém pode
 * esquecer de fazer — é uma impossibilidade, porque não existe argumento para
 * mais nada.
 *
 * ⚠️ AINDA NÃO ESTÁ LIGADA AO `decide.ts`, e isso é deliberado: hoje o único
 * fluxo do chat é o CSP, e todo texto do bot sai de um catálogo aprovado. Ligar
 * Enquetes exige um `chat_flow_key` novo e um roteiro — trabalho de conversa,
 * não de banco. E o envio pelo WhatsApp não existe (GAP 2). Ver docs/ENQUETES.md.
 */

interface ChatbotOptionRow {
  survey_id: string;
  title: string;
  question_id: string;
  question: string;
  option_id: string;
  option_position: number;
  option_text: string;
}

/**
 * §41/§42. Traz a enquete pronta para virar mensagem.
 *
 * ⚠️ Confere o PORTÃO antes de devolver: uma enquete encerrada, cancelada ou
 * ainda em rascunho não vira mensagem. Sem isto, um disparo atrasado mandaria
 * um convite para responder algo que já não aceita resposta.
 */
export async function getSurveyForChatbot(surveyId: string): Promise<ChatbotSurveyResult> {
  if (!isUuid(surveyId)) return { status: "not-available" };

  try {
    const admin = createAdminClient();

    const { data: gate, error: gateError } = await admin.rpc("survey_response_gate", {
      p_survey_id: surveyId,
    });

    if (gateError) {
      console.error(`[survey-chatbot] portão falhou: ${gateError.message}`);
      return { status: "not-available" };
    }
    if (gate !== "registered") return { status: "not-available" };

    const { data, error } = await admin
      .rpc("get_survey_for_chatbot", { p_survey_id: surveyId })
      .returns<ChatbotOptionRow[]>();

    if (error) {
      console.error(`[survey-chatbot] consulta falhou: ${error.message}`);
      return { status: "not-available" };
    }

    const linhas = data ?? [];
    const primeira = linhas[0];
    if (!primeira) return { status: "not-available" };

    const options: SurveyOption[] = linhas.map((l) => ({
      id: l.option_id,
      position: l.option_position,
      text: l.option_text,
      active: true, // a função só devolve as ativas
    }));

    return {
      status: "found",
      survey: toChatbotSurvey({
        surveyId: primeira.survey_id,
        title: primeira.title,
        questionId: primeira.question_id,
        question: primeira.question,
        options,
      }),
    };
  } catch (error) {
    console.error(
      `[survey-chatbot] consulta falhou: ${error instanceof Error ? error.message : error}`,
    );
    return { status: "not-available" };
  }
}

/**
 * §43 a §50. Registra a resposta a partir do que a pessoa DIGITOU.
 *
 * NUNCA lança: o chat não pode cair porque uma resposta falhou.
 *
 * ⚠️ A OPÇÃO É RESOLVIDA AQUI, MAS VALIDADA LÁ. `resolveOptionByPosition`
 * traduz "3" no id da terceira alternativa; `register_survey_response` confere,
 * no banco, que aquele id existe, está ativo e pertence A ESTA enquete. A
 * segunda checagem é a que importa: sem ela, um id de alternativa de outra
 * enquete registraria um voto no lugar errado.
 */
export async function registerSurveyReply(input: {
  surveyId: string;
  contactId: string;
  reply: string;
  sourceMessageId?: string;
}): Promise<ChatbotSurveyResponseResult> {
  const parsed = surveyReplySchema.safeParse(input);
  if (!parsed.success) return { status: "failed" };

  const dados = parsed.data;

  const enquete = await getSurveyForChatbot(dados.surveyId);
  if (enquete.status !== "found") {
    // O portão já disse que não aceita. Perguntar de novo qual é o motivo exato
    // custaria outra ida ao banco para chegar à mesma frase.
    const outcome = await gateOutcome(dados.surveyId);
    return { status: "handled", outcome, message: responseMessage(outcome) };
  }

  const escolhida = resolveOptionByPosition(enquete.survey.options, dados.reply);
  if (!escolhida) {
    // §44. Não vai ao banco: não há o que registrar, e a frase é a mesma.
    return {
      status: "handled",
      outcome: "invalid_option",
      message: SURVEY_RESPONSE_INVALID,
    };
  }

  return registerSurveyResponse({
    surveyId: dados.surveyId,
    optionId: escolhida.id,
    contactId: dados.contactId,
    sourceMessageId: dados.sourceMessageId,
  });
}

/**
 * §73. Registra a resposta por id de alternativa.
 *
 * Separada de `registerSurveyReply` porque são entradas diferentes: uma vem de
 * alguém digitando num chat, a outra de um webhook que já traz o id escolhido
 * (um botão de lista do WhatsApp, por exemplo). As duas terminam na mesma função
 * do banco, que é onde as regras moram.
 */
export async function registerSurveyResponse(input: {
  surveyId: string;
  optionId: string;
  contactId: string;
  sourceMessageId?: string;
}): Promise<ChatbotSurveyResponseResult> {
  const parsed = surveyResponseSchema.safeParse(input);
  if (!parsed.success) return { status: "failed" };

  const dados = parsed.data;

  try {
    const admin = createAdminClient();

    const { data, error } = await admin.rpc("register_survey_response", {
      p_survey_id: dados.surveyId,
      p_option_id: dados.optionId,
      p_contact_id: dados.contactId,
      p_source_message_id: dados.sourceMessageId || null,
      // `as never`: contorno do descompasso de generics ssr/supabase-js — o
      // mesmo de insert/update, ver CONVENTIONS.md. Os tipos gerados declaram os
      // parâmetros opcionais como `string`, sem `| null`, e a função no banco
      // aceita NULL de propósito (nem todo canal fornece id de mensagem).
    } as never);

    if (error || !data) {
      // A mensagem crua fica no log do servidor. O que volta para a janela do
      // chat é um texto fixo: código de erro e nome de tabela numa tela pública
      // não ajudam ninguém e mapeiam o sistema para quem estiver medindo.
      console.error(`[survey-chatbot] resposta falhou: ${error?.message ?? "sem desfecho"}`);
      return { status: "failed" };
    }

    const outcome = data as SurveyResponseOutcome;
    return { status: "handled", outcome, message: responseMessage(outcome) };
  } catch (error) {
    console.error(
      `[survey-chatbot] resposta falhou: ${error instanceof Error ? error.message : error}`,
    );
    return { status: "failed" };
  }
}

/** O desfecho do portão, para transformar em frase quando a enquete não aceita. */
async function gateOutcome(surveyId: string): Promise<SurveyResponseOutcome> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("survey_response_gate", {
      p_survey_id: surveyId,
    });
    if (error || !data) return "not_found";
    return data as SurveyResponseOutcome;
  } catch {
    return "not_found";
  }
}

/**
 * Um id inválido não pode virar consulta: `.eq()` com lixo casaria com nada, mas
 * depender disso é depender de um detalhe do PostgREST.
 */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
