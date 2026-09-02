import { surveyWhatsAppMessage } from "./survey.labels";
import type { SurveyOption, SurveyResponseOutcome } from "./survey.types";

/**
 * O CONTRATO DO CHATBOT — o recorte que pode sair para fora da APCS.
 *
 * ⚠️ A lista é fechada, e o que está FORA importa mais que o que está dentro:
 * não vai público-alvo, não vai total de destinatários, não vai resultado
 * parcial, não vai quem já respondeu, não vai a configuração de anonimato.
 *
 * O resultado parcial é o mais importante da lista. Mandá-lo junto com a
 * pergunta ("já votaram 40% em Aumentar") ENVIESARIA a enquete — a pessoa
 * responderia sabendo o que os outros responderam, e o número que a APCS usaria
 * para decidir passaria a medir o efeito manada em vez da expectativa de
 * mercado. Não é vazamento de privacidade: é vazamento que estraga o dado.
 */
export interface ChatbotSurvey {
  surveyId: string;
  title: string;
  questionId: string;
  question: string;
  options: SurveyOption[];
  /** §41. A mensagem pronta, no formato do WhatsApp. */
  message: string;
}

export function toChatbotSurvey(input: {
  surveyId: string;
  title: string;
  /** Opcionais: a mensagem os omite quando não vierem. */
  description?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  questionId: string;
  question: string;
  options: SurveyOption[];
}): ChatbotSurvey {
  // Só as ATIVAS, e ordenadas por `position`: é essa numeração que a pessoa vê
  // e é por ela que `resolveOptionByPosition` traduz a resposta de volta.
  const ativas = input.options.filter((o) => o.active).sort((a, b) => a.position - b.position);

  return {
    surveyId: input.surveyId,
    title: input.title,
    questionId: input.questionId,
    question: input.question,
    options: ativas,
    message: surveyWhatsAppMessage({
      title: input.title,
      description: input.description,
      question: input.question,
      options: ativas,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    }),
  };
}

/**
 * O resultado de buscar a enquete para montar a mensagem.
 *
 * ⚠️ `not-available` cobre tanto "não existe" quanto "existe mas não está
 * aceitando resposta", pelo mesmo motivo que Palestras colapsa os dele: separar
 * confirmaria a existência de uma campanha a quem não deveria saber dela.
 */
export type ChatbotSurveyResult =
  | { status: "found"; survey: ChatbotSurvey }
  | { status: "not-available" };

/**
 * O resultado de registrar uma resposta (§43 a §50).
 *
 * `outcome` é o enum que o banco devolveu; `message` é a frase pronta do
 * catálogo. Os dois juntos porque o bot precisa da frase, e quem estiver
 * depurando precisa saber qual dos seis desfechos aconteceu.
 *
 * `failed` não carrega detalhe nenhum de propósito: o que o bot diz nesse caso é
 * um texto fixo, e a causa real fica no log do servidor (§72-análogo).
 */
export type ChatbotSurveyResponseResult =
  | { status: "handled"; outcome: SurveyResponseOutcome; message: string }
  | { status: "failed" };
