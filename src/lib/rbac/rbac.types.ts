/**
 * Definições de RBAC (papéis e permissões).
 *
 * Os papéis (`Role`) espelham o enum `app_role` da migration do banco. Manter
 * os dois em sincronia: ao adicionar um papel, atualize AQUI e na migration.
 *
 * ⚠️ ESTA LISTA É MAIS CURTA QUE O ENUM DO BANCO, E ISSO É PROPOSITAL.
 *
 * `ceo`, `pm` e `tech_lead` foram APOSENTADOS em
 * 20260902000000_retire_roles.sql. Eles continuam existindo no enum `app_role`
 * porque o Postgres não sabe remover valor de enum — mas um CHECK em
 * `profiles.role` impede que qualquer conta os tenha, então eles nunca chegam
 * até aqui. `isRole()` devolve `false` para os três, e quem por algum caminho
 * estranho os carregasse cairia em `viewer`, que não tem permissão nenhuma:
 * falha FECHADA, que é a direção certa.
 *
 * Não os traga de volta só para "casar com o banco". As duas listas contam a
 * mesma história — a do banco só carrega o histórico junto.
 */

export const VALID_ROLES = ["admin", "comercial", "financeiro", "viewer"] as const;

export type Role = (typeof VALID_ROLES)[number];

/**
 * A identificação de um CARGO — e ela é `string`, não `Role`, de propósito.
 *
 * ⚠️ PAPEL E CARGO NÃO SÃO A MESMA COISA, e confundi-los é o erro que este tipo
 * existe para evitar.
 *
 * • `Role` (o enum `app_role`) é o que o BANCO entende. Está em
 *   `profiles.role`, é o que `current_app_role()` devolve e é o que as 122
 *   policies de RLS consultam. Só muda por migration.
 *
 * • `RoleKey` é o que a APCS cria pela tela: "Editor de Conteúdo", "Secretaria".
 *   Cada cargo se apoia num papel-base e só pode conter permissões que a base
 *   já tem — ou seja, um cargo TIRA, nunca acrescenta. Ver a migration
 *   20260903000100_custom_roles.sql, que explica a regra inteira.
 *
 * Os quatro papéis embutidos existem também como cargo, com a mesma chave, para
 * que a interface tenha um único vocabulário. Por isso todo `Role` é um
 * `RoleKey` válido — a recíproca é que não vale.
 */
export type RoleKey = string;

/**
 * Rótulos PT-BR dos papéis EMBUTIDOS.
 *
 * ⚠️ É A CÓPIA DE EMERGÊNCIA, não a fonte. Desde 20260903000100 os rótulos
 * moram em `app_roles.label`, no banco, junto com os dos cargos criados pela
 * APCS. Esta lista serve para quando a consulta ainda não aconteceu (o cliente,
 * um teste) e para os quatro nomes que nunca mudam.
 */
export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  comercial: "Comercial",
  financeiro: "Financeiro",
  viewer: "Visualização",
};

/**
 * Permissões granulares. Convenção: `<dominio>.<verbo>`.
 * Os domínios seguem os módulos do produto (ver docs/ROADMAP.md).
 */
export type Permission =
  // Atendimento (chat + leads dos fluxos)
  | "leads.read"
  | "leads.write"
  | "attendances.read"
  | "attendances.write"
  // Caixa de entrada do WhatsApp — ler as conversas e responder
  | "whatsapp.read"
  | "whatsapp.write"
  // Gestão documental (normativas e, no futuro, procedimentos e manuais)
  | "documents.read"
  | "documents.write"
  // Eventos da APCS
  | "events.read"
  | "events.write"
  // Bolsa — os boletins de preço (submenu de Documentos)
  | "market.read"
  | "market.write"
  // Palestras — solicitações do chatbot, planejamento e calendário
  | "lectures.read"
  | "lectures.write"
  // Enquetes — criação, segmentação, disparo e resultados
  | "surveys.read"
  | "surveys.write"
  // Associados — solicitações do formulário público e o registro definitivo
  | "members.read"
  | "members.write"
  // Base de Conhecimento — as respostas escritas que o chatbot pode dar
  | "knowledge.read"
  | "knowledge.write"
  // Fluxos de Atendimento — o desenho da triagem que o chatbot executa
  | "flows.read"
  | "flows.write"
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
