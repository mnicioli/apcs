import type { EvaluationStatus } from "./event.evaluation.types";
import type { ResultsStage } from "./event.results.rules";
import type { ResultsFilter } from "./event.results.types";

/**
 * Os textos PT-BR dos Resultados.
 *
 * ⚠️ OS `Record<Enum, string>` SÃO UMA BARREIRA, e não conveniência: um valor
 * novo no enum do Postgres chega ao TypeScript pelo `pnpm db:types` e derruba o
 * type-check aqui, porque o `Record` fica incompleto.
 */

export const RESULTS_MODULE_TITLE = "Resultados";
export const RESULTS_MODULE_SUBTITLE = "O que os participantes responderam sobre cada evento.";

export const RESULTS_FILTER_LABELS: Record<ResultsFilter, string> = {
  all: "Todas as respostas",
  with_comment: "Com comentário",
  rating_5: "Nota 5 na avaliação geral",
  rating_4: "Nota 4 na avaliação geral",
  rating_3: "Nota 3 na avaliação geral",
  rating_2: "Nota 2 na avaliação geral",
  rating_1: "Nota 1 na avaliação geral",
};

export const RESULTS_TAB_LABELS = {
  dashboard: "Painel",
  responses: "Respostas",
  pending: "Pendentes",
} as const;

/**
 * A situação do envio, na visão de pendentes (§29, §31).
 *
 * ⚠️ REAPROVEITA O ENUM DO PROMPT 2 INTEIRO, e acrescenta UMA chave que não é
 * do enum: `not_created`, para quem ainda não tem linha. O §29 proíbe uma
 * segunda enumeração — e isto não é uma: é a ausência de linha ganhando nome na
 * tela.
 *
 * ⚠️ "FALHA" NÃO ESTÁ AQUI, e o §29 a lista. O banco não tem esse status: falha
 * é `scheduled` com `last_error`. A tela mostra o selo "Na fila" junto do motivo
 * do erro, que é mais informativo que um selo "Falha" sozinho — ele diria que
 * acabou, quando na verdade a próxima passada vai tentar de novo.
 */
export const PENDING_STATUS_LABELS: Record<
  EvaluationStatus | "not_created" | "retry_exhausted",
  string
> = {
  /**
   * ⚠️ §15/§28 DO PROMPT 4 — "NA FILA" E "NUNCA MAIS SERÁ TENTADA" ERAM O MESMO
   * SELO, e isso é o único ponto onde a tela confundia situação da AVALIAÇÃO com
   * situação da NOTIFICAÇÃO.
   *
   * Uma linha que estourou as cinco tentativas continua `scheduled` no banco —
   * e está certo: o estado da avaliação é "agendada", e um reenvio manual a
   * devolve para a fila zerando o contador. Mas `claim_event_evaluations` não a
   * pega mais, então "Na fila" era uma promessa que ninguém ia cumprir.
   *
   * O §28 é explícito: isso "deve aparecer como pendência/falha operacional. Não
   * simplesmente desaparecer do sistema."
   *
   * ⚠️ E NÃO É UM VALOR DE ENUM NOVO (§15 proíbe a segunda enumeração). É uma
   * LEITURA de `status` + `attempts` + `last_error`, feita na apresentação —
   * exatamente onde as duas situações precisam ser distinguidas para quem opera.
   */
  retry_exhausted: "Falha no envio",
  not_created: "Ainda não gerada",
  pending: "Sem data de envio",
  scheduled: "Na fila",
  sent: "Enviada",
  answered: "Respondida",
  expired: "Expirada",
  cancelled: "Cancelada",
};

export const RESULTS_STAGE_COPY: Record<ResultsStage, { titulo: string; corpo: string } | null> = {
  // ⚠️ CADA VAZIO DIZ A PROVIDÊNCIA, e não só o que falta (§38). "Sem dados"
  // mandaria a pessoa investigar quatro coisas; cada frase aqui aponta uma.
  no_participants: {
    titulo: "Este evento ainda não tem participantes.",
    corpo: "A avaliação vai para quem esteve presente — sem inscrições não há quem avaliar.",
  },
  no_present: {
    titulo: "Ninguém foi marcado como presente neste evento.",
    corpo:
      "Só quem esteve presente recebe avaliação. Marque a presença na Lista de Presença e os resultados aparecem aqui.",
  },
  no_sent: {
    titulo: "Nenhuma avaliação foi enviada ainda.",
    corpo:
      "O convite sai depois do término do evento, mais o atraso configurado. Confira a configuração em Avaliações.",
  },
  no_answers: {
    titulo: "Ainda não existem respostas para este evento.",
    corpo:
      "Os convites saíram e ninguém respondeu até agora. Os números aparecem na primeira resposta.",
  },
  ready: null,
};

/** O texto sob o número, quando ele precisa de uma linha para não enganar. */
export const KPI_HINTS = {
  eligible: "Somente quem esteve presente. Confirmação de inscrição não conta.",
  responseRate: "Respondidas sobre enviadas.",
  responseRateZero: "Nenhuma avaliação enviada ainda.",
  overallNA:
    "Nenhuma pergunta deste formulário está marcada como avaliação geral. Marque uma em Avaliações → Perguntas.",
  failed: "Tentativas de envio com erro. A rotina tenta de novo sozinha.",
  multipleVersions:
    "As perguntas mudaram durante a coleta. Cada versão aparece em bloco próprio — respostas antigas continuam ligadas ao formulário que aquelas pessoas leram.",
  multipleChoice:
    "Cada participante pode marcar mais de uma alternativa, então a soma dos percentuais passa de 100%.",
} as const;
