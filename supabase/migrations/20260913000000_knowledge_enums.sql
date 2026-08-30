-- ============================================================================
-- Os tipos da Base de Conhecimento
-- ============================================================================
--
-- ⚠️ ARQUIVO SEPARADO PELO MESMO MOTIVO DE SEMPRE: o Postgres não deixa USAR um
-- valor de enum na mesma transação em que ele foi criado, e a migration
-- seguinte usa os quatro verbos de auditoria abaixo dentro de um gatilho.
-- Juntar os dois arquivos faz o `create function` falhar com "unsafe use of new
-- value of enum type".
--
-- É a mesma lição de `20260910000000_admin_audit_enum_repair.sql`, e ela custou
-- um defeito em produção: o PL/pgSQL só planeja um comando na PRIMEIRA vez que
-- ele executa, então um `create function` que menciona um valor inexistente
-- passa limpo na migration e só quebra no dia em que alguém clica no botão.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. O estado de um item de conhecimento
-- ----------------------------------------------------------------------------
-- ⚠️ TIPO PRÓPRIO, MESMO SENDO IGUAL A `document_version_status`. Reaproveitar
-- o enum de Documentos amarraria os dois módulos: o dia em que a Base de
-- Conhecimento precisar de um terceiro estado (um rascunho, por exemplo), o
-- `alter type` cairia sobre as normativas junto — e cada `case` exaustivo de
-- Documentos passaria a ter um ramo faltando, em silêncio.
create type public.knowledge_status as enum ('active', 'inactive');

comment on type public.knowledge_status is
  'Estado de um item da Base de Conhecimento. Somente ATIVO pode ser considerado pelo chatbot.';

-- ----------------------------------------------------------------------------
-- 2. Os verbos novos da trilha da Administração
-- ----------------------------------------------------------------------------
-- ⚠️ ATIVAR E DESATIVAR SÃO VERBOS PRÓPRIOS, e não `knowledge_updated` com um
-- campo no metadata. A pergunta que a trilha responde na prática é "desde
-- quando o bot passou a dizer isso?" — e ela precisa ser respondível filtrando
-- a lista, não lendo o jsonb de cada linha de edição.
--
-- `if not exists` porque `alter type ... add value` não é idempotente sozinho, e
-- uma migration que já rodou não pode falhar ao rodar de novo.
alter type public.admin_audit_action add value if not exists 'knowledge_created';
alter type public.admin_audit_action add value if not exists 'knowledge_updated';
alter type public.admin_audit_action add value if not exists 'knowledge_activated';
alter type public.admin_audit_action add value if not exists 'knowledge_deactivated';

-- ============================================================================
-- ROLLBACK (manual)
-- ----------------------------------------------------------------------------
--   drop type if exists public.knowledge_status;
--   -- Os valores de `admin_audit_action` NÃO são removíveis: o Postgres não sabe
--   -- tirar valor de enum, e a trilha já gravada aponta para eles. Ficam
--   -- inertes, como 'ceo' em `app_role` (ver 20260902000000_retire_roles.sql).
-- ============================================================================
