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

  // Caixa de entrada do WhatsApp — as conversas do número da APCS.
  //
  // ⚠️ AQUI A ESCRITA NÃO É MAIS ESTREITA QUE A LEITURA, e é o único módulo em
  // que isso acontece. Em Documentos, Eventos, Bolsa, Palestras e Associados o
  // Atendente (`comercial`) só LÊ, porque publicar uma normativa ou aprovar um
  // associado é decisão de quem responde por aquilo. Responder a mensagem de um
  // associado no WhatsApp não é decisão: É O TRABALHO DO ATENDENTE. Uma caixa
  // de entrada que ele pode abrir e não pode responder não serve para nada.
  //
  // Chaves próprias (e não `attendances.*`) porque são coisas diferentes: a
  // Central de Atendimento é a fila do chat da WEB, com triagem de bot e
  // consentimento LGPD; esta é a conversa de WhatsApp, que não tem nem um nem
  // outro. Um dia restringir uma não pode mexer na outra.
  //
  // Devem bater com `whatsapp_is_reader()` / `whatsapp_is_writer()` em
  // supabase/migrations/20260822000000_create_whatsapp_inbox.sql.
  "whatsapp.read": ["admin", "ceo", "comercial"],
  "whatsapp.write": ["admin", "ceo", "comercial"],

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

  // Bolsa — os boletins de preço da APCS.
  // Mesmo recorte da gestão documental, e pelo mesmo motivo: quem atende
  // (`comercial`, o "Atendente") precisa CONSULTAR e BAIXAR o boletim vigente
  // para responder, mas publicar uma versão nova é decisão de quem responde
  // pelo boletim. Deve bater com as policies de `market_bulletins` /
  // `market_bulletin_versions` / `market_bulletin_audit_logs`.
  //
  // Chave própria (e não `documents.*`) mesmo com a mesma lista de papéis: são
  // decisões de negócio distintas, e um dia restringir quem publica a Bolsa não
  // pode mexer em quem publica normativa.
  //
  // A trilha de auditoria é mais estreita que a leitura: só admin e ceo a leem.
  // Isso está na RLS de `market_bulletin_audit_logs` e é checado nas telas por
  // `market.write`.
  "market.read": ["admin", "ceo", "comercial"],
  "market.write": ["admin", "ceo"],

  // Palestras — as que pedem pelo chatbot e as que o time marca.
  // Mesmo recorte de Eventos e da Bolsa, e pelo §39 do escopo: ADMINISTRADOR e
  // GESTOR planejam, atribuem e decidem status; o ATENDENTE (`comercial`)
  // VISUALIZA — precisa consultar a agenda para responder, mas aprovar uma
  // solicitação é decisão de quem responde pela agenda.
  //
  // Chave própria (e não `events.*`) mesmo com a mesma lista de papéis: são
  // decisões de negócio distintas, e um dia restringir quem aprova palestra não
  // pode mexer em quem publica evento.
  //
  // Deve bater com as policies de `lectures` / `lecture_status_transitions` /
  // `lecture_audit_logs`. A trilha é mais estreita que a leitura: só admin e ceo
  // a leem, o que está na RLS e é checado nas telas por `lectures.write`.
  "lectures.read": ["admin", "ceo", "comercial"],
  "lectures.write": ["admin", "ceo"],

  // Enquetes — o que a APCS pergunta à base e o que a base respondeu.
  // O §3 do escopo é explícito e coincide com o recorte dos outros módulos de
  // conteúdo: ADMINISTRADOR e GESTOR fazem tudo (criar, editar, agendar, ativar,
  // encerrar, cancelar, ver resultados); o ATENDENTE (`comercial`) VISUALIZA.
  //
  // Chave própria (e não `events.*`) mesmo com a mesma lista de papéis: são
  // decisões de negócio distintas, e um dia restringir quem dispara uma enquete
  // para toda a base não pode mexer em quem publica evento.
  //
  // ⚠️ `surveys.read` NÃO dá acesso a QUEM respondeu o quê. Isso é decidido por
  // enquete, pela configuração de anonimato (§21/§54), e imposto no banco:
  // `survey_responses` não tem policy de SELECT para ninguém, e
  // `survey_participants` se recusa a responder para enquete anônima.
  //
  // Deve bater com as policies de `surveys` / `survey_questions` /
  // `survey_options` / `survey_audience_criteria` / `survey_recipients` /
  // `survey_dispatches` / `survey_audit_logs`. A trilha é mais estreita que a
  // leitura: só admin e ceo a leem, o que está na RLS.
  "surveys.read": ["admin", "ceo", "comercial"],
  "surveys.write": ["admin", "ceo"],

  // Associados — quem se cadastrou pela landing e quem a APCS reconhece.
  // Mesmo recorte dos outros módulos: ADMINISTRADOR e GESTOR decidem; o
  // ATENDENTE (`comercial`) VISUALIZA. É deliberado que o Atendente NÃO aprove:
  // aprovar cria uma linha no registro de associados, que é a fonte única da
  // verdade da entidade — e a carga do cadastro legado vai desembocar na mesma
  // tabela. Se um dia a triagem virar rotina do atendimento, mover `comercial`
  // para `members.write` é uma linha aqui MAIS as policies/funções do banco: as
  // duas camadas têm de contar a mesma história.
  //
  // Deve bater com `membership_is_reader()` / `membership_is_writer()` em
  // supabase/migrations/20260821000000_create_membership.sql. A trilha
  // (`membership_audit_logs`) é mais estreita que a leitura: só admin e ceo.
  "members.read": ["admin", "ceo", "comercial"],
  "members.write": ["admin", "ceo"],

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
