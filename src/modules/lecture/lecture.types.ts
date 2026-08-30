/**
 * Tipos de domínio de Palestras (camelCase), desacoplados das linhas cruas do
 * banco (snake_case).
 *
 * Os enums espelham os do Postgres criados em
 * `supabase/migrations/20260816000000_create_lectures.sql`. Ao mudar um, mude os
 * dois — o `as const` aqui é a fonte da verdade para o TypeScript.
 *
 * ⚠️ O QUE NÃO ESTÁ AQUI, e é a decisão mais importante do módulo: **o grafo de
 * transições**. Ele mora no banco (`lecture_status_transitions`) e chega às
 * telas como DADO, via `listStatusTransitions()`. Uma cópia em TypeScript
 * pareceria conveniente e seria a segunda fonte da verdade que este desenho
 * evita: no dia em que o fluxo mudar por migration, a cópia continuaria
 * mostrando botões que o banco recusa.
 */

/** O que se grava. A ordem é a do fluxo do escopo — usada para ordenar filtros. */
export const LECTURE_STATUSES = [
  "requested",
  "under_review",
  "approved",
  "rejected",
  "planned",
  "confirmed",
  "held",
  "cancelled",
] as const;
export type LectureStatus = (typeof LECTURE_STATUSES)[number];

/**
 * Os status de onde não se sai. É a mesma lista que o grafo do banco deixa sem
 * aresta de saída — aqui ela serve para a LEITURA (o que já está encerrado),
 * não para autorizar transição, que continua sendo decisão do banco.
 */
export const TERMINAL_LECTURE_STATUSES: readonly LectureStatus[] = [
  "held",
  "rejected",
  "cancelled",
];

/**
 * Os status em que a APCS assumiu um compromisso de horário — os mesmos que
 * `find_lecture_conflicts` considera ocupando a agenda, e os únicos que
 * aparecem no calendário por padrão.
 */
export const SCHEDULED_LECTURE_STATUSES: readonly LectureStatus[] = [
  "planned",
  "confirmed",
  "held",
];

export const LECTURE_TYPES = ["company", "associate", "university", "other"] as const;
export type LectureType = (typeof LECTURE_TYPES)[number];

export const LECTURE_FORMATS = ["in_person", "online", "hybrid"] as const;
export type LectureFormat = (typeof LECTURE_FORMATS)[number];

export const LECTURE_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type LecturePriority = (typeof LECTURE_PRIORITIES)[number];

export const DEFAULT_LECTURE_PRIORITY: LecturePriority = "normal";

export const LECTURE_ORIGINS = ["chatbot", "internal"] as const;
export type LectureOrigin = (typeof LECTURE_ORIGINS)[number];

/**
 * A LEITURA derivada, que nunca é gravada.
 *
 * O §56 proíbe marcar uma palestra como realizada só porque a data passou, e o
 * §53 pede que uma data passada seja "avaliada automaticamente". As duas coisas
 * convivem porque isto aqui é uma leitura, não uma escrita: uma palestra
 * marcada cuja data passou e que ninguém fechou aparece como
 * `awaiting_outcome` — alguém precisa dizer se aconteceu.
 *
 * É o mesmo desenho da expiração de Eventos, pelo mesmo motivo: o projeto não
 * tem infraestrutura de job, e uma rotina que não roda mente em silêncio.
 */
export const LECTURE_STAGES = [
  "pending", // solicitada, em análise ou aprovada — ainda não marcada
  "scheduled", // planejada ou confirmada, e a data não chegou
  "awaiting_outcome", // planejada ou confirmada, e a data JÁ passou
  "closed", // realizada, rejeitada ou cancelada
] as const;
export type LectureStage = (typeof LECTURE_STAGES)[number];

/**
 * Quem fez uma operação, já com o nome resolvido para exibir.
 *
 * ⚠️ `email` existe porque `fullName` PODE SER NULO — um usuário que ainda não
 * preencheu o perfil. Sem ele, a tela mostrava "Não definido" no lugar de quem
 * estava definido, e a diferença entre "ninguém é responsável" e "o responsável
 * não preencheu o nome" desaparecia. Ver `actorLabel`.
 */
export interface LectureActor {
  id: string;
  fullName: string | null;
  email: string | null;
}

/**
 * Um palestrante do CATÁLOGO — quem apresenta sem ter conta no cockpit.
 *
 * ⚠️ NÃO É UM `LectureActor` mal preenchido. Um ator é uma pessoa do time, com
 * perfil, papel e e-mail; isto é um NOME que a APCS já usou uma vez e vai usar
 * de novo. Dar a mesma forma aos dois faria o `id` daqui parecer um id de perfil
 * — e o dia em que alguém o passasse para `assign_lecture_speaker` como
 * `profileId`, o banco recusaria com uma mensagem sobre "perfil não encontrado"
 * que não explicaria nada.
 *
 * Ver `lecture_speakers` em supabase/migrations/20260905000000_lecture_speakers.sql.
 */
export interface LectureSpeaker {
  id: string;
  name: string;
}

/**
 * Uma palestra, na forma que as telas consomem.
 *
 * `searchText` NÃO está aqui de propósito: é coluna de infraestrutura de busca,
 * não informação de negócio, e não tem por que atravessar a rede.
 */
export interface Lecture {
  id: string;
  /** SOL-000001. Único e imutável. */
  protocol: string;
  origin: LectureOrigin;

  name: string;
  theme: string;
  city: string;
  location: string | null;

  type: LectureType;
  /** Só existe quando `type === "other"`. */
  typeOther: string | null;
  format: LectureFormat | null;

  /** Data pura AAAA-MM-DD, sem hora e sem fuso. */
  eventDate: string;
  /** "HH:MM" — já recortado do `time` do Postgres, que vem como "HH:MM:SS". */
  startTime: string | null;
  endTime: string | null;

  attendeesEstimated: number | null;
  attendeesActual: number | null;

  /**
   * ⚠️ DOIS CAMPOS PARA UM PALESTRANTE, e no máximo um deles preenchido (o banco
   * impõe com o CHECK `lectures_single_speaker`). Quem é do time é `speaker`;
   * quem é de fora é `speakerCatalog`. Para EXIBIR, use `speakerLabel` — ele
   * resolve os dois e é o único lugar que precisa saber que são dois.
   */
  speaker: LectureActor | null;
  speakerCatalog: LectureSpeaker | null;
  responsible: LectureActor | null;

  priority: LecturePriority;
  status: LectureStatus;

  notes: string | null;
  rejectionReason: string | null;
  cancellationReason: string | null;

  requestedAt: string;
  heldAt: string | null;
  outcomeNotes: string | null;

  /** O SNAPSHOT de quem pediu, congelado no momento da solicitação. */
  requester: LectureRequester;

  createdBy: LectureActor | null;
  createdAt: string;
  updatedBy: LectureActor | null;
  updatedAt: string;
}

/**
 * Quem pediu, como estava no dia do pedido.
 *
 * `contactId` liga ao `chat_contacts`, que é editável e apagável (LGPD). Os
 * demais campos são cópia: sem eles, atender um pedido de eliminação apagaria
 * junto a resposta para "quem pediu a SOL-000042?", que é registro operacional
 * da APCS.
 */
export interface LectureRequester {
  contactId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  organization: string | null;
}

/**
 * Uma palestra que disputa o mesmo horário (§25, §33).
 *
 * ⚠️ É um recorte, não a `Lecture` inteira: o aviso não abre a palestra
 * concorrente, ele identifica. Os campos são exatamente os que o §25 manda
 * mostrar — qual é, quando, onde e quem cuida — para a pessoa decidir se há
 * palestrante disponível para as duas.
 */
export interface LectureConflict {
  id: string;
  protocol: string;
  name: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  city: string;
  responsibleName: string | null;
  speakerName: string | null;
}

/** Uma aresta do grafo. `from` nulo é ponto de entrada. */
export interface LectureTransition {
  from: LectureStatus | null;
  to: LectureStatus;
}

/** Uma entrada da trilha de auditoria. */
export interface LectureAuditEntry {
  id: number;
  action: LectureAuditAction;
  actor: LectureActor | null;
  /** O nome CONGELADO no momento da ação — sobrevive à saída do perfil. */
  actorName: string | null;
  createdAt: string;
  /** Livre por ação. Para os diffs, traz `changes: LectureFieldChange[]`. */
  metadata: Record<string, unknown>;
}

export const LECTURE_AUDIT_ACTIONS = [
  "lecture_created",
  "lecture_updated",
  "lecture_status_changed",
  "lecture_rescheduled",
  "lecture_responsible_assigned",
  "lecture_speaker_assigned",
  "lecture_cancelled",
  "lecture_rejected",
  "lecture_outcome_registered",
] as const;
export type LectureAuditAction = (typeof LECTURE_AUDIT_ACTIONS)[number];

/** Uma alteração registrada: campo, valor anterior, novo valor. */
export interface LectureFieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

/**
 * Os filtros da listagem (§32, §49).
 *
 * ⚠️ Diferente de Eventos e da Bolsa, estes filtros viram SQL, não `.filter()`
 * em memória. O motivo é o §48: a listagem é paginada no servidor, e filtrar
 * depois de paginar devolveria páginas com buracos. A busca por texto usa a
 * coluna `search_text` do banco, que já vem sem acento.
 *
 * Vazio em todos = passa tudo.
 */
export interface LectureFilters {
  /** Busca parcial por nome, tema, cidade, protocolo ou solicitante. */
  query: string;
  status: LectureStatus[];
  origin: LectureOrigin | null;
  type: LectureType | null;
  format: LectureFormat | null;
  priority: LecturePriority | null;
  city: string;
  responsibleId: string | null;
  /**
   * O palestrante escolhido — id de PERFIL ou id do CATÁLOGO, indistintamente.
   *
   * Um só campo para as duas origens porque, para quem filtra, "palestras da
   * Ana" é uma pergunta só; se a Ana tem login ou não é detalhe de
   * implementação. Como os dois lados são uuid, não há como um valor casar com a
   * coluna errada — o serviço consulta as duas e o banco resolve.
   */
  speakerId: string | null;
  /** Recorte por data do evento, inclusivo nas duas pontas. */
  from: string;
  to: string;
}

export const EMPTY_LECTURE_FILTERS: LectureFilters = {
  query: "",
  status: [],
  origin: null,
  type: null,
  format: null,
  priority: null,
  city: "",
  responsibleId: null,
  speakerId: null,
  from: "",
  to: "",
};

/** Colunas por que se pode ordenar (§49). Lista fechada: vira SQL. */
export const LECTURE_SORT_FIELDS = [
  "eventDate",
  "requestedAt",
  "status",
  "city",
  "priority",
] as const;
export type LectureSortField = (typeof LECTURE_SORT_FIELDS)[number];

export interface LectureSort {
  field: LectureSortField;
  ascending: boolean;
}

/**
 * A ordem padrão da grid: o que chegou por último, primeiro.
 *
 * É a pergunta que a operação faz ao abrir a tela ("o que chegou de novo?"),
 * não "o que acontece primeiro" — para isso existe o calendário.
 */
export const DEFAULT_LECTURE_SORT: LectureSort = { field: "requestedAt", ascending: false };

/** Uma página de resultados (§48). */
export interface LecturePage {
  items: Lecture[];
  /** Total de linhas que casam com o filtro, ignorando a paginação. */
  total: number;
  page: number;
  pageSize: number;
}

/**
 * A contagem da caixa de entrada (§57).
 *
 * Não existe central de notificações neste projeto. O que existe é isto: quantas
 * solicitações ainda não foram decididas. É o número que vira badge na tela.
 */
export interface LectureInbox {
  requested: number;
  underReview: number;
  /** A soma — o número que vai no badge. */
  total: number;
}
