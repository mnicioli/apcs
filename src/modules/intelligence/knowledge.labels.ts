import type { KnowledgeBlocker, KnowledgeStatus, KnowledgeStatusFilter } from "./knowledge.types";

/**
 * Todo texto PT-BR da Base de Conhecimento. Nenhuma frase visível nasce solta
 * numa tela: mudar o que a equipe lê é mudar este arquivo.
 */

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  active: "Ativo",
  inactive: "Inativo",
};

export const KNOWLEDGE_STATUS_FILTER_LABELS: Record<KnowledgeStatusFilter, string> = {
  all: "Todos",
  active: "Ativos",
  inactive: "Inativos",
};

/**
 * ⚠️ CADA FRASE DIZ O QUE FAZER, e não só o que está errado. O item aparece na
 * lista escrito e salvo; sem esta explicação, "o bot não responde" vira
 * investigação no chatbot — que está funcionando.
 */
export const KNOWLEDGE_BLOCKER_LABELS: Record<KnowledgeBlocker, string> = {
  inactive: "Inativo — ative o item para o chatbot poder usá-lo.",
  notReleased: "Não liberado — marque “Disponível para o chatbot” para o bot responder sozinho.",
  notStarted: "Ainda não começou a valer — a data inicial é futura.",
  expired: "Fora da vigência — a data final já passou.",
};

/** O selo curto da grid, ao lado do título. */
export const KNOWLEDGE_BLOCKER_BADGES: Record<KnowledgeBlocker, string> = {
  inactive: "Inativo",
  notReleased: "Fora do chatbot",
  notStarted: "Agendado",
  expired: "Vencido",
};

export const KNOWLEDGE_AVAILABLE_BADGE = "No chatbot";

/* -------------------------------------------------------------------------- */
/* Telas                                                                      */
/* -------------------------------------------------------------------------- */

export const KNOWLEDGE_PAGE_TITLE = "Base de Conhecimento";

export const KNOWLEDGE_PAGE_DESCRIPTION =
  "As respostas escritas que o chatbot pode dar em nome da APCS. O texto sai daqui para o associado exatamente como está escrito.";

/**
 * ⚠️ O AVISO MAIS IMPORTANTE DA TELA, e ele fica onde a pessoa escreve.
 *
 * O risco real deste módulo não é técnico: é alguém colar o preço da semana ou
 * o resumo de uma normativa aqui. Bolsa, Normativas e Comunicação têm versão,
 * vigência e controle de publicação; uma cópia solta neste campo não tem nada
 * disso e nunca mais é revisada.
 */
export const KNOWLEDGE_CONTENT_WARNING =
  "Não escreva aqui preços da Bolsa nem o conteúdo de normativas e comunicados: eles têm módulo próprio, com versão e vigência, e o chatbot já consulta a publicação vigente. Use este campo para o que não tem outro lugar — horário, contato, como funciona um processo.";

export const KNOWLEDGE_KEYWORDS_HELP =
  "Separadas por vírgula. Escreva as palavras que o associado usaria (“horas”, “aberto”, “funcionamento”), não as do título — é por elas que o robô acha este item. Evite palavras com menos de 4 letras: a busca casa por trecho, e “oi” casa dentro de “foi”.";

export const KNOWLEDGE_CHATBOT_HELP =
  "Ativo diz que a resposta vale. Disponível para o chatbot diz que o bot pode dizê-la sozinho — são decisões diferentes, e uma resposta pode valer para o atendimento humano antes de valer para o robô.";

export const KNOWLEDGE_WINDOW_HELP =
  "Opcional. Use para o que nasce com prazo (recesso, horário de feira). Em branco dos dois lados, a resposta vale por tempo indeterminado.";

export const KNOWLEDGE_EMPTY = "Nenhum item cadastrado ainda.";

export const KNOWLEDGE_EMPTY_FILTERED = "Nenhum item corresponde aos filtros escolhidos.";

/** O contador do topo. Responde “o que o bot sabe agora?” sem abrir item nenhum. */
export function knowledgeCoverage(available: number, total: number): string {
  if (total === 0) return KNOWLEDGE_EMPTY;
  if (available === 0) {
    return `Nenhum dos ${total} itens está disponível para o chatbot agora.`;
  }
  if (available === total) {
    return total === 1
      ? "O único item cadastrado está disponível para o chatbot."
      : `Os ${total} itens estão disponíveis para o chatbot.`;
  }
  return `${available} de ${total} itens estão disponíveis para o chatbot agora.`;
}

/* -------------------------------------------------------------------------- */
/* A busca de teste                                                           */
/* -------------------------------------------------------------------------- */

export const KNOWLEDGE_SEARCH_TITLE = "Testar o que o chatbot encontraria";

export const KNOWLEDGE_SEARCH_HELP =
  "Escreva a mensagem como o associado escreveria. A busca aplica as mesmas regras do robô — só considera itens ativos, liberados e dentro da vigência.";

export const KNOWLEDGE_SEARCH_EMPTY =
  "Nada encontrado. Com esta mensagem, o chatbot responderia com o texto de “Nenhum resultado” e ofereceria um atendente.";

export const KNOWLEDGE_SEARCH_PLACEHOLDER = "Ex.: vocês abrem que horas?";

/* -------------------------------------------------------------------------- */
/* Confirmações                                                               */
/* -------------------------------------------------------------------------- */

export const KNOWLEDGE_CREATED = "Item de conhecimento criado.";
export const KNOWLEDGE_UPDATED = "Item de conhecimento salvo.";
export const KNOWLEDGE_ACTIVATED = "Item ativado.";
export const KNOWLEDGE_DEACTIVATED = "Item inativado.";
