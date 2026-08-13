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
  // Atendimento — leads gerados pelos fluxos do chat (ver docs/ROADMAP.md).
  // Deve bater com as policies de `csp_leads` na migration do chat.
  "leads.read": ["admin", "ceo", "comercial"],
  "leads.write": ["admin", "comercial"],

  // Central de Atendimento — a fila de conversas que precisam de uma pessoa.
  // Chave própria (e não `leads.*`) porque os dois vão divergir: o operador de
  // atendimento precisa da fila sem necessariamente ver a carteira comercial.
  // Deve bater com as policies de `chat_conversations` na migration do módulo.
  "attendances.read": ["admin", "ceo", "comercial"],
  "attendances.write": ["admin", "comercial"],

  // Gestão documental — as normativas que o chatbot vai citar.
  // A escrita é mais estreita que a de atendimentos de propósito: quem responde
  // no dia a dia (`comercial`, o "Atendente") precisa CONSULTAR a normativa
  // vigente, mas publicar uma versão nova é decisão de quem responde pela
  // norma. Deve bater com as policies de `documents` / `document_versions`.
  "documents.read": ["admin", "ceo", "comercial"],
  "documents.write": ["admin", "ceo"],

  // Eventos — o que a APCS promove aos associados.
  // Mesmo recorte da gestão documental, e pelo mesmo motivo: quem atende
  // (`comercial`, o "Atendente") precisa CONSULTAR a agenda para responder, mas
  // publicar um evento é decisão de quem responde pela agenda. Deve bater com
  // as policies de `events` / `event_segment_links` / `event_audit_logs`.
  //
  // A trilha de auditoria é mais estreita que a leitura: só admin e ceo a leem,
  // conforme a matriz do escopo. Isso está na RLS de `event_audit_logs` e é
  // checado nas telas por `events.write`.
  "events.read": ["admin", "ceo", "comercial"],
  "events.write": ["admin", "ceo"],

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
