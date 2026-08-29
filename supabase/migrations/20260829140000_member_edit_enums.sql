-- ============================================================================
-- Edição do cadastro do associado — os valores de enum, sozinhos
-- ----------------------------------------------------------------------------
-- ⚠️ ARQUIVO SEPARADO, E É OBRIGATÓRIO QUE SEJA. O Postgres não deixa USAR um
-- valor de enum na MESMA transação que o criou ("unsafe use of new value of
-- enum type"). Como `supabase db push` roda cada arquivo em uma transação, a
-- função da migration seguinte — que grava 'member_updated' na trilha — só
-- compila se o valor já existir de um arquivo anterior.
--
-- É a mesma separação de 20260828205845_event_dispatch_enums.sql. Se um dia
-- alguém juntar os dois arquivos "para simplificar", o push quebra.
--
-- `if not exists` porque estas migrations vêm sendo aplicadas pelo SQL Editor
-- do Dashboard, que faz autocommit por comando: uma execução parcial não pode
-- impedir a próxima de rodar inteira.
-- ============================================================================

alter type public.membership_audit_action add value if not exists 'member_updated';
