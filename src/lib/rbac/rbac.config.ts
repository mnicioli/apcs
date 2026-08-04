import type { Permission, Role } from "./rbac.types";

/**
 * Matriz de permissões: quais papéis têm cada permissão.
 *
 * Regra: se o papel está na lista, tem a permissão; senão, NEGADO
 * (deny-by-default). Esta matriz é a 1ª camada (app-side). A 2ª camada é a
 * RLS no banco — as duas devem contar a mesma história.
 *
 * Estes são padrões SENSATOS de partida — ajuste conforme as regras reais da
 * empresa. Ao mudar aqui, lembre de refletir nas policies RLS das tabelas.
 */
export const PERMISSION_MATRIX: Record<Permission, readonly Role[]> = {
  // Módulo 01 — Clientes
  "clients.read": ["admin", "ceo", "comercial", "pm"],
  "clients.write": ["admin", "comercial"],

  // Módulo 02 — Projetos
  "projects.read": ["admin", "ceo", "pm", "tech_lead", "comercial", "financeiro"],
  "projects.write": ["admin", "pm"],

  // Módulo 03 — Recursos / colaboradores
  "resources.read": ["admin", "ceo", "pm", "tech_lead"],
  "resources.write": ["admin", "pm"],

  // Módulo 04 — Alocação
  "allocation.read": ["admin", "ceo", "pm", "tech_lead"],
  "allocation.write": ["admin", "pm"],

  // Módulo 05 / 08 / 11 — Financeiro e rentabilidade
  "finance.read": ["admin", "ceo", "financeiro"],
  "finance.write": ["admin", "financeiro"],

  // Módulo 06 — Infraestrutura & Assets
  "infrastructure.read": ["admin", "ceo", "tech_lead"],
  "infrastructure.write": ["admin", "tech_lead"],

  // Módulos analíticos (07 Health Score, 09 Capacity, 10 Simulador, 12 IA, 13 Cockpit)
  "analytics.read": ["admin", "ceo", "pm", "comercial", "financeiro"],

  // Administração do sistema
  "users.manage": ["admin"],
  "settings.manage": ["admin"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return PERMISSION_MATRIX[permission].includes(role);
}

export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}
