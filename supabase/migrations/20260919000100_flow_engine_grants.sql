-- ============================================================================
-- FLOW ENGINE — os grants explícitos para service_role
-- ============================================================================
--
-- ⚠️ ESTA MIGRATION NÃO CONSERTA UM DEFEITO. Ela torna EXPLÍCITO um privilégio
-- que já existia — e o parágrafo abaixo existe para ninguém repetir o erro de
-- diagnóstico que a criou.
--
-- 20260919000000 termina cada função com
--
--     revoke execute on function public.flow_… from public, anon, authenticated;
--
-- e não concede nada. A suspeita era de que isso trancasse o `service_role`
-- junto, porque `revoke ... from public` tira a concessão PADRÃO. A suspeita
-- estava ERRADA, e foi verificada contra o banco: `compile_flow_definition`
-- (20260917000100) tem exatamente o mesmo padrão — revoke sem grant — e o
-- `service_role` a executa sem problema. O Supabase concede EXECUTE a ele por
-- `alter default privileges`, e não por herança de `PUBLIC`; o revoke não o
-- alcança.
--
-- ⚠️ O QUE DE FATO ESTAVA QUEBRADO ERA A CHAVE, e não o privilégio: o
-- `.env.local` tinha a chave PUBLICÁVEL no lugar da secreta, e todo `42501`
-- observado veio de o cliente estar entrando como `anon`.
--
-- ENTÃO POR QUE MANTER ISTO. Porque o privilégio implícito é uma promessa da
-- PLATAFORMA, não do schema: ele depende de as default privileges do projeto
-- continuarem como estão, o que não é algo que esta migration controla nem que
-- apareça em lugar nenhum ao ler o SQL. Escrever o grant custa cinco linhas,
-- torna a intenção legível ("quem chama isto é o servidor") e é o padrão que
-- `whatsapp_bot_should_answer` (20260915000000) e `process_scheduled_surveys`
-- (20260819000000) já seguem.
--
-- É cinto e suspensório, e está declarado como tal.
-- ============================================================================

grant execute on function public.flow_begin_run(public.flow_channel, uuid)
  to service_role;

grant execute on function public.flow_claim_step(
  uuid, text, uuid, public.flow_node_type, jsonb, uuid
) to service_role;

grant execute on function public.flow_commit_step(
  bigint, integer, uuid, public.flow_run_status, public.flow_conversation_status,
  jsonb, integer, text, public.flow_step_status, jsonb, text, text, jsonb
) to service_role;

grant execute on function public.flow_set_automation_pause(uuid, timestamptz)
  to service_role;

grant execute on function public.flow_timeout_due(integer)
  to service_role;


-- ============================================================================
-- ROLLBACK
-- ============================================================================
--   revoke execute on function public.flow_timeout_due(integer) from service_role;
--   revoke execute on function public.flow_set_automation_pause(uuid, timestamptz) from service_role;
--   revoke execute on function public.flow_commit_step(bigint, integer, uuid, public.flow_run_status, public.flow_conversation_status, jsonb, integer, text, public.flow_step_status, jsonb, text, text, jsonb) from service_role;
--   revoke execute on function public.flow_claim_step(uuid, text, uuid, public.flow_node_type, jsonb, uuid) from service_role;
--   revoke execute on function public.flow_begin_run(public.flow_channel, uuid) from service_role;
--   -- Desfazer isto é seguro: o privilégio implícito da plataforma continua
--   -- valendo. O que se perde é a declaração de intenção. Ver o cabeçalho.
-- ============================================================================
