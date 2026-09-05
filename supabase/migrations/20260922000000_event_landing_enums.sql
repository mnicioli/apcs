-- ============================================================================
-- Landing Pages e Inscrições — os enums
-- ----------------------------------------------------------------------------
-- ⚠️ ARQUIVO SEPARADO POR OBRIGAÇÃO DO POSTGRES, e não por organização.
--
-- `alter type ... add value` e o USO do valor novo não podem estar na mesma
-- migration: o Postgres recusa com "unsafe use of new value of enum type". Como
-- este módulo acrescenta cinco ações à trilha de auditoria de Eventos
-- (`event_audit_action`) e as USA em funções na migration seguinte, os dois
-- precisam de arquivos diferentes. `src/test/sql-enum-values.test.ts` guarda
-- essa separação.
--
-- Os `create type` abaixo não teriam essa restrição — um tipo NOVO já pode ser
-- usado no mesmo arquivo. Estão aqui pela convenção do projeto
-- (`20260828205845_event_dispatch_enums.sql`, `20260917000000_flow_enums.sql`):
-- o que é vocabulário fica junto.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Situação da Landing Page
-- ----------------------------------------------------------------------------
-- ⚠️ SÓ A DECISÃO HUMANA ENTRA AQUI. Não existe um valor para "encerrou porque
-- a data passou" nem para "encerrou porque lotou", e a ausência é o desenho:
--
--     'draft'      criada, ainda não está no ar
--     'published'  no ar, aceitando inscrição
--     'closed'     alguém ENCERROU à mão
--     'inactive'   alguém TIROU DO AR à mão
--
-- O encerramento por data ou por lotação é DERIVADO na leitura, exatamente como
-- a expiração de um evento (ver o cabeçalho de 20260813000000_create_events.sql
-- e `effectiveStatus` em event.rules.ts). O projeto não tem cron; uma rotina que
-- virasse as linhas falharia em silêncio, e o formulário continuaria aceitando
-- inscrição depois do prazo.
--
-- A regra que PRECISA valer de verdade — não aceitar inscrição fora do prazo ou
-- acima da capacidade — é imposta na escrita, dentro de
-- `create_event_registration`, sob lock. Derivação é para LER; a barreira é
-- para ESCREVER.
create type public.event_landing_page_status as enum (
  'draft',
  'published',
  'closed',
  'inactive'
);


-- ----------------------------------------------------------------------------
-- 2. Situação da inscrição
-- ----------------------------------------------------------------------------
-- Duas, e só duas. `cancelled` é o que substitui a exclusão: o §13 do escopo
-- proíbe apagar inscrição, e este projeto não tem soft delete em lugar nenhum
-- (ver o comentário do módulo Palestras) — o controle é sempre uma situação.
create type public.event_registration_status as enum (
  'active',
  'cancelled'
);


-- ----------------------------------------------------------------------------
-- 3. Por onde a inscrição entrou
-- ----------------------------------------------------------------------------
-- ⚠️ EXISTE ANTES DE A LANDING PÚBLICA EXISTIR, de propósito. A página pública é
-- o Prompt 3; o backoffice é o Prompt 2. Quando as duas portas estiverem
-- abertas, "de onde veio esta inscrição?" vira a primeira pergunta de qualquer
-- investigação — e uma coluna acrescentada depois não sabe responder pelo que
-- já foi gravado.
create type public.event_registration_origin as enum (
  'landing_page',
  'backoffice'
);


-- ----------------------------------------------------------------------------
-- 4. Confirmação do participante
-- ----------------------------------------------------------------------------
-- ⚠️ SÓ DUAS, POR ORDEM EXPRESSA DO §11. `cancelled`, `present` e `absent` estão
-- previstos no escopo e NÃO entram agora.
--
-- Acrescentá-los depois é `alter type ... add value` num arquivo próprio — o
-- mesmo movimento que esta migration está fazendo com `event_audit_action`. O
-- que NÃO se faz é criá-los agora "já que é barato": um valor de enum que
-- nenhuma tela escreve e nenhuma regra lê é uma promessa que o próximo leitor
-- vai tentar cumprir sem saber o que ela significava.
create type public.event_participant_confirmation as enum (
  'confirmed',
  'not_confirmed'
);


-- ----------------------------------------------------------------------------
-- 5. Ações da trilha de inscrições
-- ----------------------------------------------------------------------------
-- Enum próprio, tabela própria — ver a justificativa na seção 6 da migration
-- seguinte, junto da tabela.
create type public.event_registration_audit_action as enum (
  'registration_created',
  'registration_updated',
  'registration_cancelled',
  'registration_reactivated',
  'participant_confirmation_changed'
);


-- ----------------------------------------------------------------------------
-- 6. A Landing Page entra na trilha do EVENTO
-- ----------------------------------------------------------------------------
-- ⚠️ AQUI NÃO NASCE TRILHA NOVA, e é o §20 sendo levado a sério. A Landing Page
-- é 1:1 com o evento e o ciclo dela (criar, publicar, encerrar, tirar do ar) é
-- decisão de quem responde pela agenda — a mesma pessoa, a mesma tela, o mesmo
-- histórico. `event_audit_logs` já guarda isso, com `event_id` e tudo.
--
-- `if not exists` porque `alter type add value` não é idempotente por natureza e
-- uma migration precisa poder ser reaplicada num banco novo sem estourar.
alter type public.event_audit_action add value if not exists 'landing_page_created';
alter type public.event_audit_action add value if not exists 'landing_page_updated';
alter type public.event_audit_action add value if not exists 'landing_page_published';
alter type public.event_audit_action add value if not exists 'landing_page_closed';
alter type public.event_audit_action add value if not exists 'landing_page_deactivated';


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   drop type if exists public.event_registration_audit_action;
--   drop type if exists public.event_participant_confirmation;
--   drop type if exists public.event_registration_origin;
--   drop type if exists public.event_registration_status;
--   drop type if exists public.event_landing_page_status;
--
-- Os cinco valores acrescentados a `event_audit_action` NÃO têm desfazimento: o
-- Postgres não remove valor de enum. É inofensivo — um valor que ninguém
-- escreve não aparece em lugar nenhum —, e é a mesma situação dos papéis
-- aposentados em 20260902000000.
-- ============================================================================
