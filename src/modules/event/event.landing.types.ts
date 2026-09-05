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
export type LandingPageStatusReason = "draft" | "manual" | "expired" | "full" | "inactive";

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
  description: string | null;
  /** URL assinada da imagem PRÓPRIA da página, ou `null` — aí vale a do evento. */
  imageUrl: string | null;
  formFields: LandingFieldKey[];
  /** Os três campos crus, como estão gravados. Nulo = usa o padrão. */
  successTitle: string | null;
  successMessage: string | null;
  successFooter: string | null;
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
