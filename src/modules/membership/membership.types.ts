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
export const MEMBERSHIP_PROFILE_TYPES = [
  "suinocultor",
  "profissional",
  "empresa",
] as const satisfies readonly MembershipProfileType[];

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
}

/** Contadores da caixa de entrada, por situação. */
export type MembershipApplicationCounts = Record<MembershipApplicationStatus, number>;
