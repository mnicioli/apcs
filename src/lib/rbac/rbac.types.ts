/**
 * Definições de RBAC (papéis e permissões).
 *
 * Os papéis (`Role`) espelham o enum `app_role` da migration do banco. Manter
 * os dois em sincronia: ao adicionar um papel, atualize AQUI e na migration.
 */

export const VALID_ROLES = [
  "admin",
  "ceo",
  "pm",
  "tech_lead",
  "comercial",
  "financeiro",
  "viewer",
] as const;

export type Role = (typeof VALID_ROLES)[number];

/** Rótulos PT-BR de cada papel, para exibir na UI. */
export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  ceo: "CEO",
  pm: "Gerente de Projeto",
  tech_lead: "Tech Lead",
  comercial: "Comercial",
  financeiro: "Financeiro",
  viewer: "Visualização",
};

/**
 * Permissões granulares. Convenção: `<dominio>.<verbo>`.
 * Os domínios seguem os módulos do produto (ver docs/ROADMAP.md).
 */
export type Permission =
  | "clients.read"
  | "clients.write"
  | "projects.read"
  | "projects.write"
  | "resources.read"
  | "resources.write"
  | "allocation.read"
  | "allocation.write"
  | "finance.read"
  | "finance.write"
  | "infrastructure.read"
  | "infrastructure.write"
  | "analytics.read"
  | "users.manage"
  | "settings.manage";

export function isRole(value: string): value is Role {
  return (VALID_ROLES as readonly string[]).includes(value);
}
