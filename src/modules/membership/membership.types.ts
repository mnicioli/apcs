import type { Database } from "@/types/database";

/**
 * Tipos do domínio Associados.
 *
 * Os enums vêm do banco (via `pnpm db:types`), e não de literais escritos aqui:
 * é o que faz um valor novo no Postgres virar erro de compilação no TypeScript
 * em vez de um `default:` silencioso numa tela.
 */

export type MembershipProfileType = Database["public"]["Enums"]["membership_profile_type"];
export type MembershipApplicationStatus =
  Database["public"]["Enums"]["membership_application_status"];
export type MemberStatus = Database["public"]["Enums"]["member_status"];
export type MemberOrigin = Database["public"]["Enums"]["member_origin"];
export type MembershipAuditAction = Database["public"]["Enums"]["membership_audit_action"];

/**
 * As LISTAS, para `z.enum` e para ordenar filtros.
 *
 * ⚠️ Os TIPOS acima vêm do banco; estas listas existem porque `z.enum` precisa
 * de uma tupla literal, que um tipo não fornece. O `satisfies` impede as duas de
 * divergirem numa direção: um valor inventado aqui não compila. A outra direção
 * — um valor novo no Postgres que ninguém trouxe para cá — é pega pelos
 * `Record<...>` de membership.labels.ts, que ficam incompletos.
 */
/**
 * ⚠️ A ORDEM É A DOS ASSOCIADOS PRIMEIRO, e ela aparece na tela.
 *
 * Criador, Empresa e Técnico são os três tipos de ASSOCIADO; Universidade é o
 * único perfil que não é. Não há coluna dizendo isso — "ser associado" é uma
 * leitura do perfil (ver `isAssociateProfile`), porque uma coluna separada
 * poderia contradizer o perfil e duas verdades sobre o mesmo fato foi
 * exatamente o que a unificação veio acabar.
 */
export const MEMBERSHIP_PROFILE_TYPES = [
  "criador",
  "empresa",
  "tecnico",
  "universidade",
] as const satisfies readonly MembershipProfileType[];

/** Os três perfis que são associados. Universidade fica de fora. */
export const ASSOCIATE_PROFILE_TYPES = [
  "criador",
  "empresa",
  "tecnico",
] as const satisfies readonly MembershipProfileType[];

/**
 * "Esta pessoa é associada?" — a pergunta que antes não tinha onde ser feita.
 *
 * Função e não `includes` solto na tela: quando um quinto perfil entrar, é
 * aqui que se decide de que lado ele cai, e não em cada arquivo que perguntou.
 */
export function isAssociateProfile(profile: MembershipProfileType | null): boolean {
  return profile !== null && (ASSOCIATE_PROFILE_TYPES as readonly string[]).includes(profile);
}

export const MEMBERSHIP_APPLICATION_STATUSES = [
  "pending",
  "in_review",
  "approved",
  "rejected",
] as const satisfies readonly MembershipApplicationStatus[];

export const MEMBER_STATUSES = [
  "active",
  "inactive",
  "suspended",
] as const satisfies readonly MemberStatus[];

/**
 * A única situação de onde não se sai. Serve à LEITURA (esconder botões que
 * levariam a um erro); quem autoriza a transição continua sendo o banco.
 */
export const TERMINAL_APPLICATION_STATUSES: readonly MembershipApplicationStatus[] = ["approved"];

/** Linha da solicitação como a grid e o detalhe a consomem. */
export interface MembershipApplicationRow {
  id: string;
  protocol: string;
  status: MembershipApplicationStatus;
  profileType: MembershipProfileType;
  fullName: string;
  email: string;
  whatsapp: string;
  city: string;
  state: string;
  organization: string | null;
  createdAt: string;
  reviewedAt: string | null;
  memberId: string | null;
}

/** A solicitação inteira, para a tela de detalhe. */
export interface MembershipApplicationDetail extends MembershipApplicationRow {
  farmName: string | null;
  productionCity: string | null;
  sowCount: number | null;
  cnpj: string | null;
  stateRegistration: string | null;
  activityArea: string | null;
  jobTitle: string | null;
  legalName: string | null;
  tradeName: string | null;
  interests: string[];
  otherInterest: string | null;
  consentAt: string;
  consentPolicyVersion: string | null;
  reviewNote: string | null;
  reviewedByName: string | null;
  member: MemberRow | null;
}

/** Linha do associado no registro. */
export interface MemberRow {
  id: string;
  code: string | null;
  status: MemberStatus;
  origin: MemberOrigin;
  profileType: MembershipProfileType | null;
  fullName: string;
  email: string | null;
  whatsapp: string | null;
  city: string | null;
  state: string | null;
  organization: string | null;
  joinedAt: string | null;
  createdAt: string;
  /**
   * Pediu para não receber notificações da APCS.
   *
   * ⚠️ NÃO É UMA COLUNA DE `members`, e não é preguiça: o bloqueio é do
   * TELEFONE, e dois associados podem compartilhar um (marido e mulher na mesma
   * granja, um número de escritório). Uma coluna criaria a possibilidade de os
   * dois discordarem sobre o mesmo aparelho.
   */
  optedOut: boolean;
}

/** Contadores da caixa de entrada, por situação. */
export type MembershipApplicationCounts = Record<MembershipApplicationStatus, number>;
