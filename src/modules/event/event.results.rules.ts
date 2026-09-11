import type { ResultsOption, ResultsQuestion, ResultsSummary } from "./event.results.types";

/**
 * As regras DERIVADAS dos resultados — as que se calculam e nunca se gravam.
 *
 * ⚠️ ELAS SÃO POUCAS DE PROPÓSITO, e o §44 é o motivo: "O frontend NÃO deve ser
 * responsável pela regra de negócio dos indicadores." Média, mínimo, máximo,
 * distribuição e contagens vêm PRONTOS do Postgres, agregados lá.
 *
 * O que sobrou para cá é o que só faz sentido perto da tela:
 *
 *   • transformar contagem em PERCENTUAL (a apresentação de um número que o
 *     banco já entregou);
 *   • decidir a LARGURA da barra (puro desenho);
 *   • formatar a nota em português.
 *
 * Nenhuma delas busca dado, e nenhuma delas decide o que é elegível, o que conta
 * como respondido ou qual pergunta é a geral — isso tudo é do banco.
 *
 * ⚠️ E ESTE ARQUIVO NÃO IMPORTA NADA DO SERVIDOR. Roda no Server Component que
 * desenha o painel e nos testes, com objetos literais.
 */

/**
 * A taxa de resposta (§6, §30).
 *
 * ⚠️ RESPONDIDAS / ENVIADAS, e é a regra que o §30 recomenda explicitamente:
 * "isso evita considerar participantes que não eram elegíveis ou que não
 * receberam a avaliação". Dividir por PRESENTES misturaria a adesão de quem
 * recebeu com a eficiência do disparo — duas coisas com causas e donos
 * diferentes.
 *
 * ⚠️ ZERO ENVIADAS DEVOLVE ZERO, e não nulo. O §6 é explícito ("Quando não
 * houver avaliações enviadas: Taxa de resposta = 0%").
 *
 * ⚠️ ISSO DIFERE DA GRID DE AVALIAÇÕES (Prompt 2), onde `responseRate` devolve
 * `null` e a coluna mostra "—", e a diferença é deliberada: lá a taxa é uma
 * COLUNA COMPARANDO EVENTOS, e "—" distingue "não enviou nada" de "enviou e
 * ninguém respondeu"; aqui ela é um indicador de UM evento, ao lado de
 * "Enviadas: 0", que já explica o zero. A tela acompanha o número com essa
 * frase justamente para o 0% não ser lido como fracasso de adesão.
 */
export function responseRatePercent(sent: number, answered: number): number {
  if (sent <= 0) return 0;
  return (answered / sent) * 100;
}

/**
 * O percentual de uma alternativa (§7, §9, §36, §37).
 *
 * ⚠️ O DENOMINADOR É `respondents`, e não o total de marcações — é a decisão 3
 * da migration chegando à tela. Em múltipla escolha uma pessoa gera várias
 * linhas; dividir pelas linhas daria "quanto esta opção representa das
 * marcações", que ninguém pediu. Dividindo por PESSOAS, cada percentual é
 * "quantos dos que responderam marcaram isto" — e a soma passa de 100%, que é
 * exatamente o que o §36 descreve.
 */
export function optionPercent(option: ResultsOption, respondents: number): number {
  if (respondents <= 0) return 0;
  return (option.total / respondents) * 100;
}

/**
 * A largura da barra, de 0 a 100 (§12).
 *
 * ⚠️ RELATIVA À MAIOR ALTERNATIVA, e não ao total. É o mesmo desenho de
 * `SurveyResultsChart`, e pelo mesmo motivo: numa distribuição em que a maior
 * opção tem 30%, cinco barras desenhadas sobre o total ficariam todas curtinhas
 * e o gráfico não diria nada. O NÚMERO ao lado continua sendo o percentual de
 * verdade.
 */
export function barWidth(total: number, maior: number): number {
  if (maior <= 0) return 0;
  return (total / maior) * 100;
}

/** A maior contagem entre as alternativas — o 100% da barra. */
export function largestOption(options: readonly ResultsOption[]): number {
  return Math.max(1, ...options.map((o) => o.total));
}

/**
 * A escala de uma pergunta de nota — o teto para a barra de média (§10).
 *
 * ⚠️ VEM DAS OPÇÕES, e nunca de um `5` escrito no código. O §9 é explícito: "não
 * assumir que todas as avaliações futuras obrigatoriamente terão 5 opções". Uma
 * escala de 0 a 10 desenharia barras pela metade se o divisor fosse fixo.
 */
export function ratingScaleMax(question: ResultsQuestion): number {
  const valores = question.options.map((o) => o.value).filter((v): v is number => v !== null);

  return valores.length > 0 ? Math.max(...valores) : 5;
}

/**
 * A nota em português: uma casa decimal, vírgula.
 *
 * "4,6" e não "4.6" nem "4,60" — a segunda casa sugere uma precisão que a média
 * de 60 respostas não tem.
 */
export function formatAverage(valor: number | null): string {
  if (valor === null || Number.isNaN(valor)) return "—";
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
}

/**
 * O percentual em português: vírgula decimal, sem casas quando é redondo.
 *
 * Mesma função de `survey-metrics-cards`, repetida aqui porque aquela vive numa
 * tela de Enquetes e importar componente de outro módulo para usar um formatador
 * criaria uma dependência entre dois domínios que não se conhecem.
 */
export function formatPercent(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

/**
 * A pergunta merece média? (§35)
 *
 * ⚠️ A RESPOSTA VEM DO DADO, E NÃO DO TIPO. Um `single_choice` cujas opções
 * tenham valor numérico É uma escala com outro nome, e um `rating` sem valor
 * nenhum não é média de coisa alguma. Olhar `average !== null` — que o Postgres
 * só preenche quando houve `numeric_value` — acerta os dois casos sem uma lista
 * de tipos para manter.
 */
export function hasAverage(question: ResultsQuestion): boolean {
  return question.average !== null && question.answers > 0;
}

/**
 * Em que pé está a coleta — a frase do estado vazio (§38).
 *
 * ⚠️ CINCO ESTADOS, E NÃO UM "SEM DADOS". Cada um tem uma providência diferente:
 * sem participante é problema de inscrição; sem presente é problema da lista de
 * presença; sem envio é o cron ou a configuração; enviado e sem resposta é
 * tempo. Uma frase só mandaria a pessoa investigar tudo.
 */
export type ResultsStage = "no_participants" | "no_present" | "no_sent" | "no_answers" | "ready";

export function resultsStage(
  summary: Pick<ResultsSummary, "participants" | "present" | "sent" | "answered">,
): ResultsStage {
  if (summary.participants === 0) return "no_participants";
  if (summary.present === 0) return "no_present";
  if (summary.sent === 0) return "no_sent";
  if (summary.answered === 0) return "no_answers";
  return "ready";
}

/**
 * O TETO DE TENTATIVAS DO WORKER.
 *
 * ⚠️ CÓPIA DE UM NÚMERO QUE MORA NO SQL (`claim_event_evaluations`:
 * `pe.attempts < 5`), e a duplicação é consciente. O banco DECIDE; esta cópia só
 * APRESENTA — ela existe para a tela conseguir dizer "esta linha não será
 * tentada de novo" sem perguntar ao Postgres o que ele já respondeu ao não
 * devolver a linha na fila.
 *
 * Se o teto mudar lá, este número precisa vir junto. É o custo de mostrar, na
 * tela, uma regra que é do agendador.
 */
export const MAX_SEND_ATTEMPTS = 5;

/**
 * Como a linha pendente deve ser LIDA (§15, §28 do Prompt 4).
 *
 * ============================================================================
 * ⚠️ O ÚNICO PONTO ONDE A TELA PRECISA DISTINGUIR DUAS SITUAÇÕES QUE MORAM NA
 * MESMA LINHA.
 * ============================================================================
 * `event_participant_evaluations` guarda o estado da AVALIAÇÃO em `status`, e o
 * estado da NOTIFICAÇÃO em `attempts` / `last_error` / `provider_message_id` /
 * `sent_at`. Os dois são separados no modelo — só não são dois enums, e o §15
 * pede justamente que não se use "um único status para representar conceitos
 * diferentes".
 *
 * Na maior parte do tempo eles contam a mesma história e um selo basta. Há um
 * caso em que não: a linha que estourou as cinco tentativas continua
 * `scheduled` (a avaliação SEGUE agendada, e um reenvio a revive) mas nunca
 * mais é reivindicada. "Na fila" ali é uma promessa que ninguém vai cumprir.
 *
 * ⚠️ SEM VALOR DE ENUM NOVO. É leitura, e não estado — é por isso que ela mora
 * aqui e não numa migration.
 */
export function pendingStage(row: {
  status: string | null;
  attempts: number;
  lastError: string | null;
}): string {
  if (row.status === null) return "not_created";

  if (row.status === "scheduled" && row.attempts >= MAX_SEND_ATTEMPTS && row.lastError !== null) {
    return "retry_exhausted";
  }

  return row.status;
}
