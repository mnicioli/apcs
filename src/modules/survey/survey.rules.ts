import {
  SURVEY_RESPONSE_ALREADY,
  SURVEY_RESPONSE_CLOSED,
  SURVEY_RESPONSE_INVALID,
  SURVEY_RESPONSE_THANKS,
  SURVEY_RESPONSE_UNAVAILABLE,
} from "./survey.labels";
import type {
  Survey,
  SurveyAudienceCriterion,
  SurveyAudienceDimension,
  SurveyOption,
  SurveyResponseOutcome,
  SurveyStage,
  SurveyStatus,
} from "./survey.types";

/**
 * Regras puras de Enquetes. Sem banco, sem React — só decisão.
 *
 * ⚠️ ONDE ESTE ARQUIVO É AUTORIDADE E ONDE NÃO É:
 *
 * Ele NÃO decide se uma resposta entra. Quem decide é `survey_response_gate()`,
 * no banco, porque é lá que a regra vale para todo caminho de escrita — o
 * chatbot, uma chamada direta ao PostgREST, um psql. O que existe aqui é a
 * LEITURA da mesma regra, para a tela poder dizer "prazo encerrado" sem ir ao
 * servidor perguntar.
 *
 * As duas precisam contar a mesma história, e a bateria SQL confere isso caso a
 * caso. Se divergirem, quem está certo é o banco.
 */

/**
 * A ETAPA DERIVADA (§16, §57).
 *
 * `expired` é o caso que justifica esta função existir: a enquete está com
 * `status = 'active'`, mas a data de encerramento passou. No banco a urna já
 * está fechada; o rótulo só muda quando alguém — ou a rotina — encerrar. Sem
 * esta derivação a grid mostraria "Ativa" para uma enquete que não aceita mais
 * nada, e alguém iria cobrar por que ninguém está respondendo.
 */
export function surveyStage(survey: Survey, now: Date = new Date()): SurveyStage {
  if (survey.status === "cancelled") return "cancelled";
  if (survey.status === "closed") return "closed";
  if (survey.status === "draft") return "draft";
  if (survey.status === "scheduled") return "scheduled";

  // Daqui para baixo é `active`.
  const instante = now.getTime();

  if (survey.endsAt !== null && instante >= Date.parse(survey.endsAt)) return "expired";
  if (survey.startsAt !== null && instante < Date.parse(survey.startsAt)) return "scheduled";

  return "open";
}

/**
 * Aceita resposta agora? (§12, §16, §48, §49, §50)
 *
 * Espelha `survey_response_gate()`. Usada pela tela; NÃO é a barreira.
 */
export function isAcceptingResponses(survey: Survey, now: Date = new Date()): boolean {
  return surveyStage(survey, now) === "open";
}

/**
 * §52. Respostas ÷ mensagens entregues × 100.
 *
 * Divisor zero devolve 0 — que é o que o §52 manda, e também a única resposta
 * honesta: sem ninguém alcançado não existe taxa de participação, e devolver
 * `NaN` ou `null` empurraria a decisão para cada tela que consome o número.
 */
export function participationRate(responses: number, delivered: number): number {
  if (delivered <= 0) return 0;
  return Math.round((responses / delivered) * 10000) / 100;
}

/**
 * §53. O percentual de uma alternativa sobre o total de respostas.
 *
 * Sem respostas, 0% — nunca divisão por zero.
 */
export function optionPercentage(optionTotal: number, overallTotal: number): number {
  if (overallTotal <= 0) return 0;
  return Math.round((optionTotal / overallTotal) * 10000) / 100;
}

/**
 * §43/§44. Traduz o que a pessoa digitou no WhatsApp numa alternativa.
 *
 * Aceita só o NÚMERO, e é uma decisão: o §43 desenha a interação como "responda
 * com o número", e tentar casar texto ("acho que vai aumentar") transformaria
 * uma enquete num classificador de intenção — que erraria, e erraria gravando
 * um voto que a pessoa não deu.
 *
 * Devolve `null` para qualquer coisa que não seja o número de uma alternativa
 * ATIVA, e é o chamador que transforma isso na frase do §44.
 *
 * ⚠️ Casa por `position`, não por índice do array: `position` é o que o banco
 * guarda e o que o WhatsApp mostrou. Uma alternativa inativa no meio faria as
 * duas numerações divergirem, e o voto no 3 viraria o 4.
 */
export function resolveOptionByPosition(
  options: readonly SurveyOption[],
  reply: string,
): SurveyOption | null {
  const limpo = reply.trim();
  // `^\d{1,3}$` e não `parseInt`: "3 opções" e "1.5" viram 3 e 1 no parseInt, e
  // as duas frases são qualquer coisa menos a escolha de uma alternativa.
  if (!/^\d{1,3}$/.test(limpo)) return null;

  const numero = Number(limpo);
  return options.find((o) => o.active && o.position === numero) ?? null;
}

/**
 * §43 a §50. O desfecho do banco vira a frase que o bot manda.
 *
 * Um lugar só para o mapeamento, para que nenhuma tela ou fluxo invente um
 * texto novo — os do escopo são literais e foram acordados.
 */
export function responseMessage(outcome: SurveyResponseOutcome): string {
  switch (outcome) {
    case "registered":
      return SURVEY_RESPONSE_THANKS;
    case "already_answered":
      return SURVEY_RESPONSE_ALREADY;
    case "invalid_option":
      return SURVEY_RESPONSE_INVALID;
    case "closed":
      return SURVEY_RESPONSE_CLOSED;
    // §49/§50 e a enquete inexistente colapsam na mesma frase: para quem está do
    // lado de fora as três dizem a mesma coisa útil, e distinguir revelaria o
    // estado interno de uma campanha (ou a existência de um id).
    case "cancelled":
    case "not_active":
    case "not_found":
      return SURVEY_RESPONSE_UNAVAILABLE;
  }
}

/**
 * §60/§61. A pergunta e as alternativas ainda podem mudar?
 *
 * Espelha `assert_survey_structure_editable`. Duas condições, e a segunda é a
 * que o §60 escreve explicitamente: encerrada/cancelada nunca; com respostas,
 * nunca — mesmo ATIVA, porque mudar o texto de uma alternativa reescreveria o
 * que as pessoas já escolheram.
 */
export function canEditStructure(status: SurveyStatus, hasResponses: boolean): boolean {
  if (status === "closed" || status === "cancelled") return false;
  return !hasResponses;
}

/** §60. A edição descritiva (título, datas, configurações). */
export function canEditDetails(status: SurveyStatus): boolean {
  return status !== "closed" && status !== "cancelled";
}

/** §23/§33. O público só muda enquanto a fotografia não foi tirada. */
export function canEditAudience(status: SurveyStatus): boolean {
  return status === "draft";
}

/** §10. Exclusão física só de rascunho; depois disso o caminho é cancelar. */
export function canDelete(status: SurveyStatus): boolean {
  return status === "draft";
}

/** §59. Cancelar sai de qualquer situação não terminal. */
export function canCancel(status: SurveyStatus): boolean {
  return status === "draft" || status === "scheduled" || status === "active";
}

/** §58. Encerrar manualmente só faz sentido para quem está ativa. */
export function canClose(status: SurveyStatus): boolean {
  return status === "active";
}

/** §3/§9. Ativar é o passo seguinte ao agendamento. */
export function canActivate(status: SurveyStatus): boolean {
  return status === "scheduled";
}

/** §9. Agendar é o passo seguinte ao rascunho. */
export function canSchedule(status: SurveyStatus): boolean {
  return status === "draft";
}

/**
 * §23 + GAP 1. A dimensão de segmentação está utilizável?
 *
 * Três das seis do escopo dependem de um cadastro de associados que este banco
 * não tem. `assert_survey_audience` as recusa; esta função existe para a tela
 * poder desabilitá-las ANTES, em vez de deixar a pessoa preencher e levar erro.
 */
const DIMENSOES_DISPONIVEIS: readonly SurveyAudienceDimension[] = [
  "all",
  "region",
  "profile",
  "contact",
];

export function isAudienceDimensionAvailable(dimension: SurveyAudienceDimension): boolean {
  return DIMENSOES_DISPONIVEIS.includes(dimension);
}

/**
 * §31. Agrupa os critérios POR DIMENSÃO, na ordem em que a tela deve mostrá-los.
 *
 * É o que torna a regra de combinação legível sem um parágrafo de explicação:
 * agrupado, "Região: SP ou PR · Perfil: Produtor" já mostra o OR dentro do grupo
 * e o AND entre grupos. Uma lista plana ("SP, PR, Produtor") não distingue as
 * duas coisas, e é aí que alguém marca dois perfis achando que soma e na verdade
 * está restringindo.
 *
 * `all` volta sozinho quando presente: o atalho dispensa os demais critérios, e
 * mostrá-los ao lado sugeriria uma restrição que não existe.
 */
export function groupAudience(
  criteria: readonly SurveyAudienceCriterion[],
): { dimension: SurveyAudienceDimension; values: string[] }[] {
  if (criteria.some((c) => c.dimension === "all")) {
    return [{ dimension: "all", values: [] }];
  }

  const ordem: SurveyAudienceDimension[] = [
    "region",
    "profile",
    "contact",
    "segment",
    "category",
    "portfolio",
  ];

  const grupos: { dimension: SurveyAudienceDimension; values: string[] }[] = [];

  for (const dimension of ordem) {
    const doGrupo = criteria.filter((c) => c.dimension === dimension);
    if (doGrupo.length === 0) continue;

    grupos.push({
      dimension,
      values: doGrupo
        .map((c) => c.value ?? c.contactId ?? c.segmentId ?? "")
        .filter((v) => v !== ""),
    });
  }

  return grupos;
}

/**
 * §17. A janela é coerente?
 *
 * ESTRITAMENTE maior, como o escopo pede em duas frases separadas ("não
 * permitir igual", "não permitir menor") — justamente porque `>=` é o erro fácil
 * de cometer.
 */
export function isWindowValid(startsAt: string | null, endsAt: string | null): boolean {
  if (startsAt === null || endsAt === null) return true;
  return Date.parse(endsAt) > Date.parse(startsAt);
}

/** §35. Enviar antes de abrir a urna produziria resposta recusada em massa. */
export function isDispatchAfterStart(startsAt: string | null, scheduledAt: string | null): boolean {
  if (startsAt === null || scheduledAt === null) return true;
  return Date.parse(scheduledAt) >= Date.parse(startsAt);
}
