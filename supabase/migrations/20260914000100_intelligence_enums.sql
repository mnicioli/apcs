-- ============================================================================
-- O tipo do desfecho de uma decisão do robô
-- ============================================================================
--
-- ⚠️ ARQUIVO SEPARADO PELO MESMO MOTIVO DE SEMPRE: o Postgres não deixa USAR um
-- valor de enum na mesma transação em que ele foi criado, e a migration
-- seguinte o usa num CHECK e num índice parcial.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- O que aconteceu com a mensagem
-- ----------------------------------------------------------------------------
-- ⚠️ SEIS VALORES, E OS TRÊS PRIMEIROS SÃO A RAZÃO DE ELE EXISTIR. O §22 e o §40
-- do escopo tratam de coisas diferentes, e o log é onde a diferença tem de
-- sobreviver:
--
--   `tool_ok`      a ferramenta entregou conteúdo oficial
--   `tool_empty`   a consulta funcionou e NÃO há publicação vigente. Não é
--                  falha: é a APCS não ter o que mandar. Trabalho de quem
--                  publica.
--   `tool_error`   a consulta falhou de verdade. Trabalho de quem cuida do
--                  sistema.
--
-- Um valor só para os três faria a pergunta "o robô está funcionando?"
-- deixar de ser respondível: mil `tool_empty` são um catálogo desatualizado,
-- mil `tool_error` são um incidente, e a soma dos dois não distingue nada.
--
--   `confirmed`    pediu confirmação (faixa média — §23/§24)
--   `message`      respondeu com uma frase configurada
--   `handoff`      encaminhou para uma pessoa (§31)
create type public.intelligence_outcome as enum (
  'tool_ok',
  'tool_empty',
  'tool_error',
  'confirmed',
  'message',
  'handoff'
);

comment on type public.intelligence_outcome is
  'Desfecho de uma decisao do roteador. tool_empty e tool_error sao separados de proposito: um e trabalho de quem publica, o outro de quem cuida do sistema.';

-- ============================================================================
-- ROLLBACK (manual)
-- ----------------------------------------------------------------------------
--   drop type if exists public.intelligence_outcome;
-- ============================================================================
