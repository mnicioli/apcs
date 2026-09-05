-- ============================================================================
-- Mensagem de confirmação — as variáveis passam a ser `{{...}}`
-- ----------------------------------------------------------------------------
-- ⚠️ O PROMPT 1 SEMEOU `<EVENTO>` E `<DATA>`; O §18 DO PROMPT 2 PEDE
-- `{{event_name}}`, `{{event_date}}`, `{{event_start_time}}` e
-- `{{event_end_time}}`. Esta migration troca os textos SEMEADOS para a sintaxe
-- pedida, e acrescenta as duas variáveis de horário que não existiam.
--
-- ⚠️ A TROCA É CONDICIONADA AO TEXTO ORIGINAL, e isso é o ponto da migration.
-- `app_settings` é editável em /settings/texts: se alguém já reescreveu a
-- mensagem, o `where value = '<texto exato semeado>'` não casa e o texto dessa
-- pessoa fica intacto. Um `update` sem condição apagaria o trabalho dela sem
-- aviso — e ninguém pediria de volta porque ninguém veria acontecer.
--
-- ⚠️ A SINTAXE ANTIGA CONTINUA FUNCIONANDO. `resolveSuccessMessage` reconhece
-- as duas: qualquer Landing Page que já tenha gravado `<EVENTO>` no override
-- dela continua renderizando certo. Não há migração de dado a fazer — só uma
-- sintaxe nova sendo oferecida daqui para a frente.
-- ============================================================================

update public.app_settings
set value = 'Seu cadastro para o {{event_name}} foi realizado com sucesso.',
    updated_at = now()
where key = 'events.registration_success_message'
  and value = 'Seu cadastro para o <EVENTO> foi realizado com sucesso.';


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   update public.app_settings
--   set value = 'Seu cadastro para o <EVENTO> foi realizado com sucesso.'
--   where key = 'events.registration_success_message'
--     and value = 'Seu cadastro para o {{event_name}} foi realizado com sucesso.';
--
-- O título e o rodapé nunca tiveram variável, então não entram nem aqui nem
-- acima.
-- ============================================================================
