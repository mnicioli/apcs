-- ============================================================================
-- Voltar a receber notificações — o valor de enum, sozinho
-- ----------------------------------------------------------------------------
-- ⚠️ ARQUIVO SEPARADO PELO MESMO MOTIVO DE SEMPRE: o Postgres não deixa USAR um
-- valor de enum na mesma transação que o criou. A função da migration seguinte
-- grava 'member_notifications_resumed' na trilha, então o valor precisa vir de
-- um arquivo anterior. Ver 20260829140000_member_edit_enums.sql.
-- ============================================================================

alter type public.membership_audit_action
  add value if not exists 'member_notifications_resumed';
