-- ============================================================================
-- Remove TODOS os dados de demonstracao criados por `seed-demo.sql`.
-- Roda no SQL Editor do Supabase. So apaga linhas cujo id comeca com `ddddddd`.
-- Mensagens somem junto por cascade (chat_messages, whatsapp_messages).
-- ============================================================================

begin;

delete from public.whatsapp_chats           where id::text like 'ddddddd7-%';
delete from public.lectures                 where id::text like 'ddddddd6-%';
delete from public.membership_applications  where id::text like 'ddddddd5-%';
delete from public.members                  where id::text like 'ddddddd4-%';
delete from public.csp_leads                where id::text like 'ddddddd3-%';
delete from public.chat_conversations       where id::text like 'ddddddd2-%';
delete from public.chat_contacts            where id::text like 'ddddddd1-%';

commit;
