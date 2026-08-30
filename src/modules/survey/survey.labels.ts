import type {
  SurveyAuditAction,
  SurveyAudienceDimension,
  SurveyAnswerType,
  SurveyRecipientStatus,
  SurveySortField,
  SurveyStage,
  SurveyStatus,
} from "./survey.types";

/**
 * Rótulos PT-BR de Enquetes. Ficam aqui, e não espalhados pelas telas, para o
 * vocabulário ser um só: se a grid diz "Agendada", o filtro e o detalhe dizem
 * "Agendada" — é assim que a pessoa aprende a se localizar no sistema.
 *
 * É também o único lugar onde `Survey` vira "Enquete": o código fala inglês, a
 * tela fala português.
 */

export const SURVEY_MODULE_TITLE = "Enquetes";

export const SURVEY_MODULE_SUBTITLE =
  "As perguntas que a APCS faz à sua base, e o que a base respondeu.";

export const SURVEY_LABEL = "enquete";

export const SURVEY_STATUS_LABELS: Record<SurveyStatus, string> = {
  draft: "Rascunho",
  scheduled: "Agendada",
  active: "Ativa",
  closed: "Encerrada",
  cancelled: "Cancelada",
};

/**
 * O que cada situação significa, em uma frase.
 *
 * Existe porque "Agendada" e "Ativa" soam parecido para quem chega agora, e a
 * diferença entre elas — já pode receber resposta, ou não — é exatamente o que
 * decide o que fazer em seguida.
 */
export const SURVEY_STATUS_HINTS: Record<SurveyStatus, string> = {
  draft: "Em construção. Não recebe resposta e não é enviada.",
  scheduled: "Público definido e envio marcado. Ainda não recebe resposta.",
  active: "Recebendo respostas.",
  closed: "Não recebe mais respostas. Os resultados ficam disponíveis.",
  cancelled: "Não vai ser enviada nem receber respostas.",
};

/**
 * A ETAPA DERIVADA — o que a pessoa realmente precisa ler na grid.
 *
 * "Ativa" sozinho engana quando a data de encerramento já passou: no banco a
 * urna já está fechada, mas o rótulo continua "Ativa" até alguém encerrar.
 */
export const SURVEY_STAGE_LABELS: Record<SurveyStage, string> = {
  draft: "Rascunho",
  scheduled: "Aguardando envio",
  open: "Recebendo respostas",
  expired: "Prazo encerrado",
  closed: "Encerrada",
  cancelled: "Cancelada",
};

export const SURVEY_STAGE_HINTS: Record<SurveyStage, string> = {
  draft: "Falta definir pergunta, público ou datas.",
  scheduled: "Tudo pronto. O envio acontece na data marcada.",
  open: "Está no ar e aceitando respostas.",
  expired:
    "A data de encerramento passou. Não aceita mais respostas — encerre para fechar o registro.",
  closed: "Fechada. Os resultados continuam disponíveis.",
  cancelled: "Encerrada sem envio.",
};

export const SURVEY_ANSWER_TYPE_LABELS: Record<SurveyAnswerType, string> = {
  single_choice: "Escolha única",
  multiple_choice: "Escolha múltipla",
  yes_no: "Sim ou não",
  scale: "Escala",
  text: "Texto livre",
  rating: "Nota",
};

/**
 * As dimensões de segmentação (§23).
 *
 * ⚠️ Três delas não têm cadastro que as sustente neste banco — ver
 * `SURVEY_AUDIENCE_UNAVAILABLE` logo abaixo e o GAP 1 em docs/ENQUETES.md.
 */
export const SURVEY_AUDIENCE_DIMENSION_LABELS: Record<SurveyAudienceDimension, string> = {
  all: "Toda a base",
  // "Público-alvo", e não "Segmento": é o mesmo nome que Eventos, Bolsa e
  // Normativas usam para a mesma escolha. Dois nomes para o mesmo controle
  // fariam parecer que são coisas diferentes.
  segment: "Público-alvo",
  category: "Categoria",
  region: "Região",
  profile: "Perfil",
  portfolio: "Carteira",
  contact: "Associados específicos",
};

/**
 * As dimensões que o banco RECUSA hoje, com o motivo.
 *
 * A tela deve desabilitá-las e mostrar este texto — deixar a pessoa escolher
 * para o banco recusar depois é fazê-la perder o trabalho de preencher.
 */
export const SURVEY_AUDIENCE_UNAVAILABLE: Partial<Record<SurveyAudienceDimension, string>> = {
  // ⚠️ Perfil não é uma pendência — é uma aposentadoria. O perfil do associado
  // virou o Público-alvo na unificação de 28/08; quem procurar por ele aqui
  // precisa ser mandado para o lugar certo, não informado de que "falta".
  profile: "O perfil do associado virou o Público-alvo, logo acima.",
  category: "Depende de um cadastro de categorias, que ainda não existe no sistema.",
  portfolio: "Depende de um cadastro de carteiras, que ainda não existe no sistema.",
};

/** §39. O estado de cada pessoa no disparo, dito sem jargão. */
export const SURVEY_RECIPIENT_STATUS_LABELS: Record<SurveyRecipientStatus, string> = {
  pending: "Aguardando envio",
  // §25. "Enviando" é o estado de quem foi reivindicado pelo worker e ainda
  // está em voo. Aparece por segundos — mas quando NÃO desaparece, é o sintoma
  // de um worker que morreu no meio, e é o que a rotina do §87 vai destravar.
  sending: "Enviando",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  responded: "Respondeu",
  error: "Falhou",
};

export const SURVEY_SORT_LABELS: Record<SurveySortField, string> = {
  createdAt: "Data de criação",
  title: "Título",
  status: "Situação",
  startsAt: "Início",
  endsAt: "Encerramento",
};

/**
 * A trilha em linguagem de quem lê o histórico.
 *
 * Sem jargão de banco: quem abre a auditoria quer saber o que aconteceu, não
 * qual enum foi gravado.
 */
export const SURVEY_AUDIT_ACTION_LABELS: Record<SurveyAuditAction, string> = {
  survey_created: "Enquete criada",
  survey_updated: "Enquete alterada",
  survey_question_updated: "Pergunta ou alternativas alteradas",
  survey_audience_updated: "Público-alvo alterado",
  survey_scheduled: "Envio agendado",
  survey_activated: "Enquete ativada",
  survey_dispatched: "Disparo iniciado",
  survey_dispatch_completed: "Disparo concluído",
  survey_closed: "Enquete encerrada",
  survey_cancelled: "Enquete cancelada",
  survey_response_registered: "Resposta registrada",
};

/** Os nomes dos campos no diff da auditoria. */
export const SURVEY_FIELD_LABELS: Record<string, string> = {
  title: "Título",
  description: "Descrição",
  startsAt: "Início",
  endsAt: "Encerramento",
  scheduledAt: "Envio",
  isAnonymous: "Respostas anônimas",
  allowsResponseChange: "Permite alterar resposta",
  status: "Situação",
};

// ---------------------------------------------------------------------------
// As falas do chatbot (§41, §44, §46, §47, §48)
// ---------------------------------------------------------------------------
// Os textos exatos do escopo, num lugar só. O bot NUNCA improvisa: cada frase
// sai daqui, do mesmo jeito que o fluxo CSP tira as dele de um catálogo
// versionado — é o que torna auditável o que a APCS disse a um associado.

/** §46. Depois de uma resposta válida. */
export const SURVEY_RESPONSE_THANKS = "Obrigado pela sua participação!";

/**
 * §37 do PROMPT 3/3. A confirmação, quando a resposta veio pelo WhatsApp.
 *
 * A janela de chat da web mostra a mensagem entrar na conversa — a pessoa VÊ
 * que chegou. No WhatsApp não há esse retorno visual, e "Obrigado pela sua
 * participação!" sozinho pode ser lido como uma gentileza automática. A segunda
 * frase diz o que aconteceu de fato.
 */
export const SURVEY_RESPONSE_RECORDED = "Sua resposta foi registrada com sucesso.";

/** §44. Quando o número digitado não corresponde a nenhuma alternativa. */
export const SURVEY_RESPONSE_INVALID =
  "Não identificamos uma opção válida. Por favor, escolha uma das opções apresentadas.";

/** §47. Quando a pessoa já participou. */
export const SURVEY_RESPONSE_ALREADY = "Você já participou desta enquete. Obrigado!";

/** §48. Depois do encerramento — por status ou por data. */
export const SURVEY_RESPONSE_CLOSED = "Esta enquete já foi encerrada.";

/**
 * §49/§50. Cancelada, rascunho ou agendada.
 *
 * O texto é o mesmo para os três de propósito: para quem está do lado de fora,
 * "foi cancelada", "ainda é rascunho" e "está agendada" são a mesma informação
 * útil — não dá para responder agora. Distinguir revelaria o estado interno de
 * uma campanha que talvez nem devesse ser conhecida ainda.
 */
export const SURVEY_RESPONSE_UNAVAILABLE =
  "Esta enquete não está disponível para respostas no momento.";

/**
 * §9 do PROMPT 3/3. Mais de uma enquete em aberto para a mesma pessoa.
 *
 * ⚠️ POR QUE O BOT PEDE PARA CITAR A MENSAGEM, e não "responda 1 para a
 * primeira, 2 para a segunda".
 *
 * Um seletor numerado criaria a ambiguidade que ele deveria resolver: depois de
 * "1 ou 2?", a resposta "1" pode ser a enquete 1 ou a alternativa 1 — e não há
 * como saber qual, porque as duas leituras são igualmente plausíveis. Pedir
 * para citar a mensagem original é a única desambiguação que NÃO depende de
 * interpretar nada: o WhatsApp devolve o id da mensagem citada, e ele aponta
 * para uma enquete só.
 */
export function surveyAmbiguousContext(titulos: readonly string[]): string {
  const lista = titulos.map((t) => `• ${t}`).join("\n");
  return (
    `Você tem mais de uma enquete em aberto:\n\n${lista}\n\n` +
    `Para responder, use *Responder* na mensagem da enquete desejada e escolha o número da opção.`
  );
}

/** §32. Confirmação do pedido de saída. */
export const SURVEY_OPT_OUT_CONFIRMED =
  "Tudo bem. Você não receberá mais enquetes da APCS por aqui. " +
  "Se mudar de ideia, é só falar com a nossa equipe.";

/**
 * §39/§40. A pessoa pediu para falar com gente.
 *
 * A enquete SOLTA a conversa em vez de insistir — e diz isso, para que a pessoa
 * não fique esperando uma resposta que o bot da enquete não vai dar.
 */
export const SURVEY_HUMAN_HANDOFF =
  "Sem problema — vou encaminhar você para o nosso atendimento. " +
  "A enquete fica registrada, e você pode respondê-la depois se quiser.";

/**
 * §41. A mensagem do WhatsApp: identificação, pergunta, opções e instrução.
 *
 * Os números vêm de `position`, não do índice do array: é `position` que o banco
 * guarda e que `register_survey_response` valida, e usar duas fontes para o
 * mesmo número é como a opção 3 vira a resposta 4.
 */
export function surveyWhatsAppMessage(
  question: string,
  options: readonly { position: number; text: string }[],
): string {
  const linhas = options.map((o) => `${numberEmoji(o.position)} ${o.text}`).join("\n");
  return (
    `*APCS — Associação Paulista de Criadores de Suínos*\n\n` +
    `${question}\n\n` +
    `${linhas}\n\n` +
    `Responda com o número da opção escolhida.`
  );
}

/**
 * O número em emoji (1️⃣, 2️⃣, ...) do §41.
 *
 * Acima de 10 devolve o número puro: os emojis de teclado só vão até 10, e
 * inventar um símbolo para o 11 deixaria a lista desalinhada — pior que a
 * ausência do enfeite.
 */
export function numberEmoji(position: number): string {
  const teclas = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  return teclas[position] ?? `${position}.`;
}

/** O aviso de que a segmentação não alcança ninguém (§32). */
export function audienceSummary(total: number): string {
  if (total <= 0) {
    return "Nenhum associado ativo com WhatsApp corresponde a esta segmentação.";
  }
  return total === 1
    ? "1 associado receberá esta enquete."
    : `${total} associados receberão esta enquete.`;
}
