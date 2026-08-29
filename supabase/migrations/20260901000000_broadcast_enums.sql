-- ============================================================================
-- Os tipos da divulgação genérica
-- ============================================================================
--
-- ⚠️ ARQUIVO SEPARADO PELO MESMO MOTIVO DE SEMPRE: o Postgres não deixa USAR um
-- valor de enum na mesma transação em que ele foi criado, e a migration
-- seguinte usa os três abaixo dentro de funções. Juntar os dois arquivos faz o
-- `create function` falhar com "unsafe use of new value of enum type".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- De onde a mensagem saiu
-- ----------------------------------------------------------------------------
-- ⚠️ NORMATIVA E COMUNICAÇÃO SÃO VALORES DIFERENTES, mesmo saindo os dois da
-- tabela `documents`. Elas são CATEGORIAS de documento, e quem lê o histórico
-- pergunta "quantas vezes divulgamos normativa?", não "quantas vezes
-- divulgamos algo da tabela documents". Um valor só obrigaria a tela a ir
-- buscar a categoria em outra tabela para dizer a mesma coisa.
create type public.broadcast_source as enum (
  'normative',
  'communication',
  'market_bulletin',
  'lecture'
);

comment on type public.broadcast_source is
  'Modulo que originou a divulgacao. Eventos e Enquetes NAO estao aqui: eles tem fila propria, anterior a esta.';

-- ----------------------------------------------------------------------------
-- O estado da campanha
-- ----------------------------------------------------------------------------
-- ⚠️ `running` NÃO SIGNIFICA "acontecendo agora". Significa "tem gente na fila
-- que ainda não recebeu". Sem cron no projeto, cada execução tem orçamento de
-- tempo e para no meio — interromper é o funcionamento normal, e a tela oferece
-- "continuar". Um estado chamado `paused` sugeriria que alguém pausou.
create type public.broadcast_status as enum ('running', 'done', 'failed');

-- ----------------------------------------------------------------------------
-- O estado de cada destinatário
-- ----------------------------------------------------------------------------
-- Espelha `event_recipient_status`, e de propósito: são a mesma máquina de
-- estados, e quem já leu uma entende a outra sem reaprender.
--
-- `blocked` é separado de `error` porque não é falha: é a APCS respeitando um
-- pedido de "não me mande mais". Somar os dois no mesmo balde faria uma
-- campanha bem-sucedida parecer cheia de defeitos.
create type public.broadcast_recipient_status as enum (
  'pending',
  'sending',
  'sent',
  'error',
  'blocked'
);
