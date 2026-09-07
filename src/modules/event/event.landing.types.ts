import type { Database } from "@/types/database";

/**
 * Tipos de domínio das Landing Pages e das Inscrições.
 *
 * ⚠️ FICAM EM `src/modules/event/`, e não num módulo novo. A hierarquia do
 * escopo é explícita — EVENTOS ├── Eventos ├── Landing Pages └── Inscrições —,
 * e uma Landing Page sem evento não é nada. Um `src/modules/registration/`
 * separado obrigaria os dois a importarem um do outro para responder qualquer
 * pergunta interessante ("este evento tem página?", "de que evento é esta
 * inscrição?"), que é o formato de uma divisão errada.
 *
 * Os enums vêm do banco (via `pnpm db:types`) e não de literais escritos aqui:
 * é o que faz um valor novo no Postgres virar erro de compilação em vez de um
 * `default:` silencioso numa tela.
 *
 * ⚠️ DOIS CONCEITOS DE SITUAÇÃO, e confundi-los é o erro fácil deste módulo —
 * exatamente como em Eventos:
 *
 *   `status`           o que uma PESSOA decidiu   (enum do banco)
 *   `effectiveStatus`  o que VALE agora           (derivado de prazo e lotação)
 *
 * Só o primeiro é gravado. "Encerrada porque o prazo passou" e "encerrada
 * porque lotou" nunca são escritos em lugar nenhum. Ver `event.landing.rules.ts`
 * e o cabeçalho de 20260922000100_event_landing.sql.
 */

export type LandingPageStatus = Database["public"]["Enums"]["event_landing_page_status"];
export type RegistrationStatus = Database["public"]["Enums"]["event_registration_status"];
export type RegistrationOrigin = Database["public"]["Enums"]["event_registration_origin"];
export type ParticipantConfirmation = Database["public"]["Enums"]["event_participant_confirmation"];
export type RegistrationAuditAction =
  Database["public"]["Enums"]["event_registration_audit_action"];

/**
 * As LISTAS, para `z.enum` e para ordenar filtros.
 *
 * Os TIPOS acima vêm do banco; estas listas existem porque `z.enum` precisa de
 * uma tupla literal, que um tipo não fornece. O `satisfies` impede as duas de
 * divergirem numa direção: um valor inventado aqui não compila. A outra direção
 * — um valor novo no Postgres que ninguém trouxe para cá — é pega pelos
 * `Record<...>` de `event.landing.labels.ts`, que ficam incompletos.
 */
export const LANDING_PAGE_STATUSES = [
  "draft",
  "published",
  "closed",
  "inactive",
] as const satisfies readonly LandingPageStatus[];

export const REGISTRATION_STATUSES = [
  "active",
  "cancelled",
] as const satisfies readonly RegistrationStatus[];

export const PARTICIPANT_CONFIRMATIONS = [
  "confirmed",
  "not_confirmed",
] as const satisfies readonly ParticipantConfirmation[];

/**
 * O que se LÊ. `closed` aparece aqui e no enum do banco pelo mesmo nome, e é
 * proposital: para quem olha a tela, "encerrada porque alguém encerrou" e
 * "encerrada porque o prazo venceu" são a mesma coisa — as inscrições estão
 * fechadas. O que muda é o MOTIVO, e é para isso que existe
 * `LandingPageStatusReason`.
 */
export type LandingPageEffectiveStatus = LandingPageStatus;

/**
 * Por que as inscrições não estão abertas.
 *
 * Derivado, e não gravado: com o encerramento calculado, uma coluna seria
 * sempre uma cópia do que já se sabe — e cópias saem de sincronia. É a mesma
 * `EventStatusReason` de Eventos, com dois motivos a mais.
 */
export type LandingPageStatusReason =
  | "draft"
  | "manual"
  | "expired"
  | "full"
  | "inactive"
  // O dia do evento passou. Ver isEventPast em event.landing.rules.ts.
  | "eventPassed";

/* -------------------------------------------------------------------------- */
/* Campos do formulário                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Os campos que o formulário aceita NESTA VERSÃO.
 *
 * ⚠️ A ORDEM DESTA CONSTANTE É A ORDEM PADRÃO EXIGIDA PELO §7 — Granja/Empresa,
 * E-mail, Nome do Participante, Telefone, WhatsApp. Ela é o padrão de uma
 * Landing Page nova; a partir daí quem manda é `formFields`, que o Builder do
 * Prompt 2 reordena.
 *
 * ⚠️ CAMPO CUSTOMIZADO NÃO EXISTE, POR ORDEM DO §7 — e o desenho não fecha essa
 * porta. `formFields` é uma lista guardada em jsonb: o dia em que campos livres
 * entrarem, cada item deixa de ser uma string e passa a ser um objeto, sem
 * migração de tabela e sem mexer em nenhuma FK.
 */
export const LANDING_FIELD_KEYS = [
  "GRANJA_EMPRESA",
  "EMAIL",
  "NOME_PARTICIPANTE",
  "TELEFONE",
  "WHATSAPP",
] as const;

export type LandingFieldKey = (typeof LANDING_FIELD_KEYS)[number];

/**
 * Os três que o §8 declara obrigatórios. Uma Landing Page não pode ser salva
 * sem eles — o formulário sem nome ou sem e-mail não identifica ninguém, e sem
 * granja não sabe de quem é a inscrição.
 */
export const REQUIRED_LANDING_FIELD_KEYS = [
  "GRANJA_EMPRESA",
  "EMAIL",
  "NOME_PARTICIPANTE",
] as const satisfies readonly LandingFieldKey[];

/**
 * Os dois de contato. Individualmente opcionais; pelo menos um tem de estar no
 * formulário, e pelo menos um tem de vir preenchido por participante (§8).
 *
 * ⚠️ A SEGUNDA METADE DESSA REGRA É A QUE SE ESQUECE: se o formulário não
 * oferecesse NENHUM dos dois, nenhuma inscrição jamais poderia ser aceita — a
 * página nasceria morta. `assertLandingFields` recusa essa configuração.
 */
export const CONTACT_LANDING_FIELD_KEYS = [
  "TELEFONE",
  "WHATSAPP",
] as const satisfies readonly LandingFieldKey[];

/* -------------------------------------------------------------------------- */
/* Landing Page                                                               */
/* -------------------------------------------------------------------------- */

/** Quem fez uma operação, já com o nome resolvido para exibir. */
export interface LandingActor {
  id: string;
  fullName: string | null;
}

/**
 * A mensagem exibida depois da inscrição (§18).
 *
 * ⚠️ NUNCA VEM VAZIA. Cada campo é o da Landing Page quando ela o definiu, e o
 * padrão da plataforma (`app_settings`) quando não. A resolução acontece num
 * lugar só — `resolveSuccessMessage` —, para as duas telas que a mostram (a
 * prévia do backoffice e a página pública) não darem respostas diferentes.
 */
export interface LandingSuccessMessage {
  title: string;
  message: string;
  footer: string;
}

/**
 * Uma Landing Page, na forma que as telas consomem.
 *
 * `imagePath` NÃO está aqui de propósito — o caminho no bucket nunca precisa
 * chegar ao navegador. O que vai é `imageUrl`, uma URL assinada de vida curta
 * emitida no servidor. Mesma decisão de `EventSummary`.
 */
export interface LandingPageSummary {
  id: string;
  eventId: string;
  /** A decisão humana gravada. Para exibir, use `effectiveStatus`. */
  status: LandingPageStatus;
  slug: string;
  /** URL assinada da imagem PRÓPRIA da página, ou `null` — aí vale a do evento. */
  imageUrl: string | null;
  /**
   * URL assinada do BANNER DE CONFIRMAÇÃO — a arte que substitui o texto depois
   * da inscrição.
   *
   * ⚠️ NULO NÃO CAI NO CARTAZ DO EVENTO, ao contrário de `imageUrl`. São duas
   * artes com finalidades diferentes: mostrar a peça de divulgação como se
   * fosse o comprovante seria pior do que não mostrar imagem nenhuma. Sem
   * banner, a confirmação usa o TEXTO padrão da plataforma.
   *
   * ⚠️ E OS TEXTOS POR PÁGINA NÃO EXISTEM MAIS. `description`, `successTitle`,
   * `successMessage` e `successFooter` saíram daqui quando o cliente pediu a
   * página sem texto solto. As COLUNAS continuam no banco, com o conteúdo que
   * tinham, mas nada as escreve nem as lê — ver a decisão 1 de
   * 20260928000000_event_landing_success_image.sql.
   */
  successImageUrl: string | null;
  formFields: LandingFieldKey[];
  /** ISO 8601 com fuso. Nulo = sem prazo. */
  closesAt: string | null;
  /** Nulo = sem limite (§14). */
  maxParticipants: number | null;
  /** Pessoas já inscritas — a contagem que o §14 manda usar. */
  participantCount: number;
  createdBy: LandingActor | null;
  createdAt: string;
  updatedBy: LandingActor | null;
  updatedAt: string;
  publishedAt: string | null;
  publishedBy: LandingActor | null;
}

/**
 * A Landing Page COM o evento dela, que é como toda tela precisa dela.
 *
 * ⚠️ O EVENTO NÃO É COPIADO PARA DENTRO DA LANDING (§3). Nome, data e local
 * moram em `events` e continuam morando lá; o que existe aqui é a referência
 * resolvida na leitura. Uma cópia sairia de sincronia na primeira vez que
 * alguém remarcasse o evento — e a página anunciaria a data antiga.
 */
export interface LandingPageWithEvent extends LandingPageSummary {
  event: {
    id: string;
    name: string;
    /** AAAA-MM-DD, sem hora e sem fuso. */
    eventDate: string;
    /** "HH:MM". */
    startTime: string;
    endTime: string | null;
    location: string;
    description: string | null;
    /** URL assinada do cartaz do evento. É a que vale quando a página não tem a sua. */
    imageUrl: string | null;
  };
}

/* -------------------------------------------------------------------------- */
/* Inscrição e participante                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Um participante.
 *
 * ⚠️ TUDO AQUI É DADO PESSOAL (§29): nome, e-mail, telefone e WhatsApp. Este
 * tipo não deve ser registrado em log, nem em metadata de auditoria, nem
 * enviado para lugar nenhum que não seja a tela de quem tem
 * `registrations.read`.
 */
export interface ParticipantRow {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  whatsapp: string | null;
  confirmation: ParticipantConfirmation;
  createdAt: string;
  updatedAt: string;
}

/** Uma inscrição — a linha da granja/empresa, com as pessoas dela. */
export interface RegistrationRow {
  id: string;
  eventId: string;
  landingPageId: string;
  companyName: string;
  status: RegistrationStatus;
  origin: RegistrationOrigin;
  registeredAt: string;
  participants: ParticipantRow[];
  createdBy: LandingActor | null;
  updatedBy: LandingActor | null;
  updatedAt: string;
}

/** Uma entrada da trilha de inscrições. */
export interface RegistrationAuditEntry {
  id: number;
  action: RegistrationAuditAction;
  /** Nulo quando a inscrição veio da página pública: não havia usuário. */
  actor: LandingActor | null;
  createdAt: string;
  /** Livre por ação. NUNCA contém dado pessoal — ver o §29 na migration. */
  metadata: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Filtros                                                                    */
/* -------------------------------------------------------------------------- */

export const LANDING_STATUS_FILTERS = ["all", "draft", "published", "closed", "inactive"] as const;
export type LandingStatusFilter = (typeof LANDING_STATUS_FILTERS)[number];

export const DEFAULT_LANDING_STATUS_FILTER: LandingStatusFilter = "all";

export function isLandingStatusFilter(value: string): value is LandingStatusFilter {
  return (LANDING_STATUS_FILTERS as readonly string[]).includes(value);
}

/** Filtros da grid de Landing Pages, lidos da URL (§23). */
export interface LandingPageFilters {
  /** Busca parcial pelo nome do EVENTO. String vazia = sem filtro. */
  query: string;
  status: LandingStatusFilter;
  /** Recorte pela data do evento, inclusivo nas duas pontas. Vazio = sem limite. */
  from: string;
  to: string;
}

export const CONFIRMATION_FILTERS = ["all", "confirmed", "not_confirmed"] as const;
export type ConfirmationFilter = (typeof CONFIRMATION_FILTERS)[number];

export function isConfirmationFilter(value: string): value is ConfirmationFilter {
  return (CONFIRMATION_FILTERS as readonly string[]).includes(value);
}

/**
 * Filtros da tela de Inscrições (§23).
 *
 * ⚠️ `query` PROCURA EM TRÊS LUGARES: granja/empresa, nome do participante e
 * e-mail. Uma caixa só, e não três, porque quem abre a tela está procurando uma
 * pessoa ou uma granja e não sabe de antemão por qual dos campos vai achar.
 */
export interface RegistrationFilters {
  query: string;
  status: "all" | RegistrationStatus;
  confirmation: ConfirmationFilter;
}

/* -------------------------------------------------------------------------- */
/* A página pública (Prompt 3)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Teto de participantes numa única inscrição.
 *
 * ⚠️ SÃO VINTE, E ISSO FOI CORRIGIDO NA HOMOLOGAÇÃO. O Prompt 1 escreveu 200
 * tratando o número como limite de TAMANHO DE PAYLOAD; o §7 do Prompt 5 é
 * explícito em outra direção — "o limite padrão definido anteriormente é 20
 * participantes por inscrição (...) não permitir ultrapassar o limite".
 *
 * Quem limita quantas pessoas cabem no EVENTO continua sendo `maxParticipants`
 * da Landing Page, que é outra pergunta: este é o teto de uma inscrição só.
 *
 * ⚠️ E O NÚMERO EXISTE EM DOIS LUGARES QUE PRECISAM CONCORDAR: aqui e em
 * `event_registration_max_participants()` no Postgres. Não é duplicação por
 * descuido — é o §24 ("regra crítica não fica só na aplicação"): o Zod dá a
 * mensagem no campo certo, e a função do banco recusa quem chamar o RPC direto
 * pelo PostgREST. Há teste de SQL que falha se o valor de lá mudar sozinho.
 */
export const MAX_PARTICIPANTS_PER_REGISTRATION = 20;

/**
 * A Landing Page como o MUNDO a vê.
 *
 * ⚠️ ESTE TIPO É A FRONTEIRA, e o que ele NÃO tem é o ponto. Sem `eventId`, sem
 * `createdBy`/`updatedBy`/`publishedBy`, sem `registration_url`, sem
 * segmentação, sem trilha de auditoria e sem uma única linha de
 * `event_registrations` ou `event_participants` (§33). Comparar com
 * `LandingPageWithEvent`, que é a mesma página para quem está logado, mostra
 * exatamente o que fica do lado de dentro.
 *
 * O `status` só chega como `published` ou `closed`:
 * `get_public_event_landing_page` não devolve linha para as outras duas (§4).
 * O tipo continua largo porque estreitá-lo obrigaria a converter na leitura, e
 * a conversão é que erraria no dia em que um valor novo entrasse no enum.
 */
export interface PublicLandingPage {
  /**
   * ⚠️ NÃO EXISTE `landingPageId` AQUI, E A AUSÊNCIA É A GARANTIA.
   *
   * Ela estava. A revisão do §45 encontrou o problema: este objeto desce
   * INTEIRO como prop de um Client Component, então tudo o que ele tem é
   * serializado no payload do RSC e chega ao navegador. O id da página estava
   * indo junto — enquanto o comentário do schema afirmava que o navegador nunca
   * o recebia.
   *
   * Tirar o campo é o que torna a afirmação verdadeira em vez de vigiada: a
   * leitura pública não devolve o id, e quem precisa dele (a action de envio,
   * para chamar a função Postgres) o resolve no servidor por
   * `resolvePublicLandingPageId`. Não há caminho por onde ele saia.
   */
  slug: string;
  status: LandingPageStatus;
  /** URL assinada. O caminho no bucket nunca sai do servidor. */
  imageUrl: string | null;
  /** O banner de confirmação. Nulo = a confirmação usa `successDefaults`. */
  successImageUrl: string | null;
  formFields: LandingFieldKey[];
  closesAt: string | null;
  maxParticipants: number | null;
  participantCount: number;
  event: {
    name: string;
    /** AAAA-MM-DD. */
    eventDate: string;
    /** "HH:MM" ou "HH:MM:SS" — a tela passa por `formatTime`. */
    startTime: string;
    endTime: string | null;
    location: string;
  };
  /** O texto padrão da plataforma, para `resolveSuccessMessage`. */
  successDefaults: LandingSuccessMessage;
  /**
   * O consentimento vigente (§35). A VERSÃO viaja com o envio e é gravada na
   * inscrição — uma autorização só vale para o texto que a pessoa leu.
   */
  consent: { version: string; body: string } | null;
}

/**
 * Os estados da tela pública (§41).
 *
 * ⚠️ DOIS DOS OITO DO §41 NÃO ESTÃO AQUI, e não é esquecimento:
 *
 *   LOADING    é `loading.tsx` do App Router — a página é Server Component, e o
 *              carregamento acontece antes de este componente existir.
 *   NOT_FOUND  é `notFound()`, que troca a árvore inteira por `not-found.tsx`.
 *              Um estado interno para ele significaria renderizar o formulário
 *              e depois escondê-lo, que é o desenho que vaza a existência da
 *              página (§5).
 *
 * Os outros seis são deste componente porque todos eles ainda MOSTRAM o evento.
 */
export type PublicRegistrationState =
  | "ready"
  | "submitting"
  | "success"
  | "error"
  | "closed"
  | "soldOut";

/**
 * O QUE O FORMULÁRIO PÚBLICO RECEBE — e é menos que a página inteira.
 *
 * ============================================================================
 * ⚠️ ESTE `Pick` É O §33 ESCRITO COMO TIPO.
 * ============================================================================
 * O componente do formulário é `"use client"`: tudo o que a página passar para
 * ele é serializado no payload do RSC e viaja para o navegador de quem se
 * inscreve. Passar `PublicLandingPage` inteira mandaria junto a contagem de
 * inscritos, a capacidade, o prazo e a situação — nada disso é usado ali, e
 * "não é usado" é diferente de "não foi enviado".
 *
 * A página monta este objeto CAMPO A CAMPO, e não com um spread: é a forma de
 * acrescentar algo novo à leitura pública sem que ele chegue ao navegador por
 * distração.
 */
export type PublicRegistrationFormData = Pick<
  PublicLandingPage,
  "slug" | "formFields" | "successImageUrl" | "successDefaults"
> & {
  event: PublicLandingPage["event"];
  consent: PublicLandingPage["consent"];
};

/* -------------------------------------------------------------------------- */
/* O backoffice de Inscrições (Prompt 4)                                      */
/* -------------------------------------------------------------------------- */

/**
 * Uma linha da grid do §9 — UMA PESSOA, e não uma inscrição.
 *
 * ⚠️ É A MUDANÇA DE UNIDADE QUE DEFINE ESTA TELA. `RegistrationRow` (Prompt 1) é
 * a granja com as pessoas dentro, e serve para a visualização do §17. A GRID é
 * de pessoas: quem opera está procurando o fulano, decidindo se ele vem, e
 * exportando uma linha por participante (§18).
 *
 * As duas convivem porque respondem a perguntas diferentes. O que não pode é a
 * tela derivar uma da outra no navegador — foi por isso que a leitura virou
 * `event_registrations_board`, no banco.
 */
export interface RegistrationBoardRow {
  participantId: string;
  registrationId: string;
  companyName: string;
  fullName: string;
  email: string;
  phone: string | null;
  whatsapp: string | null;
  confirmation: ParticipantConfirmation;
  /** ISO 8601 com fuso. */
  registeredAt: string;
  registrationStatus: RegistrationStatus;
  origin: RegistrationOrigin;
}

/**
 * Os indicadores do §6.
 *
 * ⚠️ ELES RESPEITAM OS FILTROS ATIVOS, e é por isso que vêm da MESMA consulta
 * que as linhas. Contá-los à parte abriria a porta para a tela dizer "12
 * confirmados" sobre uma lista de 5 — e ninguém confere a soma à mão.
 */
export interface RegistrationBoardMetrics {
  /** Inscrições distintas (a granja, não a pessoa). */
  registrations: number;
  participants: number;
  confirmed: number;
  notConfirmed: number;
  /** Granjas/empresas distintas, comparadas sem acento e sem caixa. */
  companies: number;
}

export interface RegistrationBoardPage {
  rows: RegistrationBoardRow[];
  metrics: RegistrationBoardMetrics;
  /** Total de participantes que casam com o filtro — o denominador da paginação. */
  total: number;
  page: number;
  pageSize: number;
}

/** Uma linha da tela inicial de Inscrições (§4). */
export interface EventRegistrationSummary {
  eventId: string;
  landingPageId: string;
  slug: string;
  landingStatus: LandingPageStatus;
  closesAt: string | null;
  maxParticipants: number | null;
  eventName: string;
  eventDate: string;
  startTime: string;
  endTime: string | null;
  registrations: number;
  participants: number;
  confirmed: number;
  notConfirmed: number;
}

export interface EventRegistrationSummaryPage {
  rows: EventRegistrationSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * As ordenações que a grid aceita (§21).
 *
 * ⚠️ LISTA FECHADA, e a função Postgres tem a mesma. `p_sort` vem da URL: um
 * `order by` montado com texto recebido de fora é injeção de SQL por outro
 * nome. Aqui o tipo impede o valor errado de compilar; lá o `case` o ignora.
 */
export const REGISTRATION_SORTS = ["recent", "company", "participant"] as const;
export type RegistrationSort = (typeof REGISTRATION_SORTS)[number];

export function isRegistrationSort(value: string): value is RegistrationSort {
  return (REGISTRATION_SORTS as readonly string[]).includes(value);
}

export const DEFAULT_REGISTRATION_SORT: RegistrationSort = "recent";

/**
 * Os filtros da grid, lidos da URL (§7, §8).
 *
 * ⚠️ NÃO HÁ FILTRO DE GRANJA SEPARADO, e o §8 permite ("não criar filtros
 * desnecessários"). A caixa de busca já procura na granja — um segundo campo
 * que faz parte do que o primeiro faz é uma escolha a mais para quem opera, sem
 * nada em troca.
 */
export interface RegistrationBoardFilters {
  /** Granja, nome, e-mail, telefone ou WhatsApp. Vazio = sem busca. */
  query: string;
  confirmation: ConfirmationFilter;
  /** Recorte pela DATA DA INSCRIÇÃO (não a do evento). Vazio = sem limite. */
  from: string;
  to: string;
  sort: RegistrationSort;
  page: number;
}

export const EMPTY_REGISTRATION_BOARD_FILTERS: RegistrationBoardFilters = {
  query: "",
  confirmation: "all",
  from: "",
  to: "",
  sort: DEFAULT_REGISTRATION_SORT,
  page: 1,
};

/** Quantas linhas por página. O mesmo de Palestras e Associados. */
export const REGISTRATION_PAGE_SIZE = 25;
