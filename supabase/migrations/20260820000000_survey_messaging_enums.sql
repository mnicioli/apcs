-- ============================================================================
-- ENQUETES — PROMPT 3/3 · valores novos de enum
-- ============================================================================
--
-- ⚠️ POR QUE ESTA MIGRATION EXISTE SOZINHA, com duas linhas
--
-- `alter type ... add value` pode rodar dentro de transação no Postgres 12+,
-- mas o valor novo NÃO PODE SER USADO na mesma transação que o criou. O
-- `supabase db push` roda cada arquivo de migration em uma transação. Se estas
-- duas linhas estivessem no mesmo arquivo que as funções que usam 'sending',
-- o push falharia com:
--
--   unsafe use of new value "sending" of enum type survey_recipient_status
--
-- Separar em dois arquivos é o que garante o commit entre a criação e o uso.
-- Não junte com a migration seguinte.
-- ============================================================================

-- §25. O escopo lista sete estados por destinatário: PENDENTE, ENVIANDO,
-- ENVIADO, ENTREGUE, LIDO, RESPONDIDO, ERRO. Faltava ENVIANDO.
--
-- Não é decoração: é o estado que torna a fila SEGURA. Reivindicar um lote é
-- `pending → sending`; enquanto a mensagem está em voo, nenhum outro worker
-- pega aquela linha (§15, §76). Sem um estado intermediário, dois workers
-- simultâneos leriam os mesmos "pendentes" e a pessoa receberia duas mensagens.
alter type public.survey_recipient_status add value if not exists 'sending' after 'pending';

-- §35/§91. O fim da corrida de disparo entra na trilha com os números.
-- `survey_dispatched` marca o INÍCIO; sem um par, "a campanha de terça terminou?"
-- não tem resposta auditável — só o `finished_at` da tabela, que é mutável.
alter type public.survey_audit_action add value if not exists 'survey_dispatch_completed';
