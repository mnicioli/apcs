-- ============================================================================
-- Novos verbos da trilha de administração
-- ============================================================================
--
-- ⚠️ POR QUE ESTE ARQUIVO EXISTE SOZINHO, com quatro linhas dentro.
--
-- O Postgres não deixa USAR um valor de enum na mesma transação em que ele foi
-- criado. Como cada migration roda numa transação, a função que grava
-- `user_deactivated` precisa estar num arquivo POSTERIOR a este — senão o
-- `create function` falha com "unsafe use of new value of enum type".
--
-- É a mesma separação de 20260829140000_member_edit_enums.sql. Se um dia
-- alguém juntar os dois arquivos "para simplificar", a migration para de rodar.
-- ============================================================================

alter type public.admin_audit_action add value if not exists 'user_updated';
alter type public.admin_audit_action add value if not exists 'user_deactivated';
alter type public.admin_audit_action add value if not exists 'user_reactivated';
alter type public.admin_audit_action add value if not exists 'user_password_reset';
