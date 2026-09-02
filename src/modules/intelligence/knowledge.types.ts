/**
 * Tipos da Base de Conhecimento — o primeiro componente do menu Inteligência.
 *
 * Os enums espelham os do Postgres criados em
 * `supabase/migrations/20260913000100_knowledge.sql`. Ao mudar um, mude os dois:
 * o `as const` aqui é a fonte da verdade para o TypeScript.
 *
 * ⚠️ DUAS DIMENSÕES QUE PARECEM UMA SÓ, e confundi-las é o erro fácil deste
 * módulo:
 *
 *   `status`                 o item vale? (decisão editorial)
 *   `availableForChatbot`    o bot pode dizer isto sozinho? (decisão de canal)
 *
 * Em Documentos as duas são a mesma coisa — lá existe um CHECK que obriga
 * `available_for_chatbot = (status = 'active')`, porque uma normativa publicada
 * é, por definição, a que vale. Aqui NÃO: "nosso telefone é X" pode estar ativo
 * como referência do atendimento humano e ainda não liberado para o bot. É o
 * §19 do escopo, e é o motivo de este módulo não copiar aquele CHECK.
 */

export const KNOWLEDGE_STATUSES = ["active", "inactive"] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

/** Abas do filtro de status. `all` é o padrão: a grid abre mostrando tudo. */
export const KNOWLEDGE_STATUS_FILTERS = ["all", "active", "inactive"] as const;
export type KnowledgeStatusFilter = (typeof KNOWLEDGE_STATUS_FILTERS)[number];

export const DEFAULT_KNOWLEDGE_STATUS_FILTER: KnowledgeStatusFilter = "all";

export function isKnowledgeStatusFilter(value: string): value is KnowledgeStatusFilter {
  return (KNOWLEDGE_STATUS_FILTERS as readonly string[]).includes(value);
}

/**
 * Uma categoria do catálogo.
 *
 * ⚠️ CATÁLOGO, E NÃO ENUM — a migration explica por quê: categoria é taxonomia
 * de negócio, e transformá-la em `create type` faria "quero uma categoria nova"
 * custar migration, deploy e `pnpm db:types`. Na prática, ninguém criaria
 * categoria nenhuma.
 */
export interface KnowledgeCategory {
  id: string;
  name: string;
  active: boolean;
}

/** Quem escreveu ou editou, já com o nome resolvido para exibir. */
export interface KnowledgeActor {
  id: string;
  fullName: string | null;
}

/** Um item de conhecimento, como as telas o consomem. */
export interface KnowledgeEntry {
  id: string;
  categoryId: string;
  categoryName: string;
  /** Como a equipe encontra o item na lista. NÃO é o que o associado lê. */
  title: string;
  /**
   * ⚠️ O TEXTO EXATO QUE O ASSOCIADO LÊ. Não é insumo para um modelo reescrever:
   * o §2 do escopo é que a IA interpreta e o CRM responde. Sai daqui para o
   * WhatsApp sem passar por geração.
   */
  content: string;
  /**
   * O que faz o item ser ENCONTRADO. A busca compara estas palavras com a
   * mensagem da pessoa, e é por isso que o banco as exige de quem liga o
   * chatbot: ninguém escreve "Horário de atendimento" no WhatsApp — escreve
   * "vocês abrem que horas?".
   */
  keywords: string[];
  status: KnowledgeStatus;
  availableForChatbot: boolean;
  /** Datas puras AAAA-MM-DD. `null` = sem limite naquela ponta. */
  startsAt: string | null;
  endsAt: string | null;
  createdBy: KnowledgeActor | null;
  createdAt: string;
  updatedBy: KnowledgeActor | null;
  updatedAt: string;
}

/** Filtros da grid, lidos da URL. */
export interface KnowledgeFilters {
  /** Busca parcial por título, conteúdo ou palavra-chave. Vazio = sem filtro. */
  query: string;
  status: KnowledgeStatusFilter;
  /** Id da categoria, ou string vazia para "todas". */
  categoryId: string;
}

export const EMPTY_KNOWLEDGE_FILTERS: KnowledgeFilters = {
  query: "",
  status: DEFAULT_KNOWLEDGE_STATUS_FILTER,
  categoryId: "",
};

/**
 * Por que um item NÃO está valendo para o chatbot agora.
 *
 * ⚠️ EXISTE PORQUE O SINTOMA É MUDO. Um item escrito, salvo e marcado como
 * disponível que mesmo assim não é respondido manda a pessoa procurar defeito
 * no bot — quando a causa costuma ser uma data de fim que já passou, ou o
 * status que ficou em inativo. A tela responde a pergunta em vez de deixá-la
 * ser investigada.
 *
 * `null` significa que o item está valendo.
 */
export const KNOWLEDGE_BLOCKERS = ["inactive", "notReleased", "notStarted", "expired"] as const;
export type KnowledgeBlocker = (typeof KNOWLEDGE_BLOCKERS)[number];

/** O que a tela mostra sobre um resultado da busca de teste. */
export interface KnowledgeSearchHit {
  id: string;
  title: string;
  content: string;
  category: string;
  score: number;
}
