-- ============================================================================
-- Valores novos de `admin_audit_action`: os cargos entram na trilha
-- ============================================================================
--
-- ⚠️ ARQUIVO SEPARADO, E NÃO POR ORGANIZAÇÃO. O Postgres não deixa USAR um
-- valor de enum na mesma transação que o criou ("unsafe use of new value of
-- enum type"). Como a migration seguinte grava `role_created` dentro de uma
-- função e roda o seed na mesma transação, os valores precisam já existir
-- quando ela começa.
--
-- Mesmo motivo de 20260831000000_admin_user_enums.sql, e a mesma forma.
-- ============================================================================

alter type public.admin_audit_action add value if not exists 'role_created';
alter type public.admin_audit_action add value if not exists 'role_updated';
alter type public.admin_audit_action add value if not exists 'role_deleted';
