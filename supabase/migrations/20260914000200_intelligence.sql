-- ============================================================================
-- INTELLIGENCE LAYER — o contexto da conversa e a trilha de decisão
-- ============================================================================
--
-- Duas tabelas, e as duas respondem perguntas que nenhuma tabela existente
-- responde:
--
--   `conversation_context`        o que o robô LEMBRA da conversa (§28, §29)
--   `intelligence_interactions`   o que ele DECIDIU, e por quê (§26, §36)
--
-- ----------------------------------------------------------------------------
-- ⚠️ NENHUMA DAS DUAS É UMA SEGUNDA ESTRUTURA DE CONVERSA (§27)
-- ----------------------------------------------------------------------------
-- O histórico já existe e é `whatsapp_chats` / `whatsapp_messages` — o
-- livro-razão que grava TUDO que entra e sai do número da APCS
-- (20260822000000, decisão 2). As duas tabelas abaixo APONTAM para ele; nenhuma
-- guarda o texto de uma mensagem, e nenhuma tenta ser a fonte da conversa.
--
-- É a diferença entre "o que foi dito" (lá) e "o que o robô entendeu do que foi
-- dito" (aqui). Juntar as duas coisas na mesma tabela faria a caixa de entrada
-- do atendente carregar o raciocínio do modelo em toda linha.
--
-- ----------------------------------------------------------------------------
-- ⚠️ POR QUE SÓ WHATSAPP, E O QUE FAZER NO DIA DO SEGUNDO CANAL
-- ----------------------------------------------------------------------------
-- O chat da web tem motor próprio (`src/lib/chat/`), roteiro próprio e
-- consentimento LGPD próprio, e não está sendo religado — ele funciona e está
-- homologado. Inventar hoje uma coluna anulável para um canal que não vai usá-la
-- seria construir para uma suposição.
--
-- Quando houver o segundo canal, a mudança é conhecida e cabe numa migration:
-- acrescentar `web_conversation_id uuid references chat_conversations`, trocar a
-- chave primária por `id` e impor um CHECK de "exatamente um dos dois não é
-- nulo". Está escrito aqui para não ser redescoberto.
--
-- DEPENDE DE: 20260822000000_create_whatsapp_inbox.sql,
--             20260914000100_intelligence_enums.sql
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. O contexto da conversa (§28, §29, §30)
-- ----------------------------------------------------------------------------
-- ⚠️ É O QUE FAZ "E A CÂMARA SETORIAL?" FUNCIONAR. Essa frase não tem verbo:
-- sozinha, é ininteligível. Com a intenção do turno anterior guardada, ela vira
-- "consultar a normativa da Câmara Setorial", que é o que a pessoa quis dizer.
--
-- ⚠️ UMA LINHA POR CONVERSA — a chave primária É o id da conversa. Isso não é
-- economia de espaço: é o que dispensa rotina de limpeza. O §30 pede que o
-- contexto não seja infinito, e aqui ele não é em duas dimensões — no TEMPO
-- (`expires_at`, conferido em código a cada turno) e em VOLUME (a tabela nunca
-- passa do número de conversas existentes).
--
-- ⚠️ SEM `on delete cascade` NÃO HAVERIA GARANTIA NENHUMA: conversa apagada
-- deixaria para trás um contexto órfão que o próximo chat com o mesmo id
-- herdaria. Não acontece hoje, e é exatamente o tipo de coisa que se descobre
-- tarde.
create table if not exists public.conversation_context (
  whatsapp_chat_id uuid primary key references public.whatsapp_chats on delete cascade,

  -- ⚠️ `text`, E NÃO UM ENUM DE INTENÇÕES. O registro de intenções vive no
  -- TypeScript (`intent.registry.ts`) porque o §11 pede que acrescentar uma
  -- intenção seja acrescentar uma entrada — não uma migration, um deploy e um
  -- `pnpm db:types`. Um enum aqui transformaria cada intenção nova em mudança
  -- de schema, e cada intenção APOSENTADA num valor inerte para sempre (o
  -- Postgres não sabe remover valor de enum — ver 20260902000000).
  --
  -- O que o banco garante é o formato; o que garante o vocabulário é o teste
  -- `src/test/intelligence-registry.test.ts`, que roda no CI.
  current_intent text,
  current_subject text,

  -- A intenção esperando um "sim" ou "não" (§23, §24).
  pending_intent text,
  pending_subject text,

  expires_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint conversation_context_intent_format
    check (current_intent is null or current_intent ~ '^[a-z_]{3,40}$'),
  constraint conversation_context_pending_format
    check (pending_intent is null or pending_intent ~ '^[a-z_]{3,40}$'),
  -- Assunto é o termo que a PESSOA escreveu. Teto generoso e finito: sem ele,
  -- uma mensagem de mil caracteres viraria "assunto".
  constraint conversation_context_subject_len
    check (current_subject is null or char_length(current_subject) <= 200),
  constraint conversation_context_pending_subject_len
    check (pending_subject is null or char_length(pending_subject) <= 200),
  -- Assunto pendente sem intenção pendente é um estado que não significa nada —
  -- e é o que sobraria de um UPDATE parcial mal escrito.
  constraint conversation_context_pending_pair
    check (pending_subject is null or pending_intent is not null)
);

comment on table public.conversation_context is
  'O que o robo lembra de cada conversa. Uma linha por conversa, com prazo — nao cresce e nao dura para sempre.';

comment on column public.conversation_context.current_intent is
  'Intencao do ultimo turno que executou. E o que faz uma frase sem verbo ("e a Camara Setorial?") ser compreensivel.';

-- O motor lê por conversa (a chave primária resolve) e o suporte lê "o que está
-- vivo agora". Índice parcial: só as linhas que ainda contam.
create index if not exists conversation_context_alive_idx
  on public.conversation_context (expires_at desc)
  where expires_at is not null;

create trigger on_conversation_context_updated
  before update on public.conversation_context
  for each row execute procedure public.handle_updated_at();


-- ----------------------------------------------------------------------------
-- 2. A trilha de decisão (§26, §34, §36)
-- ----------------------------------------------------------------------------
-- Uma linha por mensagem recebida que o roteador processou. Responde as
-- perguntas que ninguém consegue responder olhando a conversa:
--
--   "o robô está entendendo as pessoas?"      → distribuição de `intent`
--   "está chutando?"                          → distribuição de `confidence`
--   "está achando o conteúdo?"                → `tool_ok` vs `tool_empty`
--   "está quebrando?"                         → `tool_error`
--   "está empurrando tudo para o humano?"     → `handoff`
--
-- ⚠️ ELA NÃO GUARDA O TEXTO DA MENSAGEM, e isso é uma decisão de privacidade
-- (§35), não um esquecimento. O texto já está em `whatsapp_messages`, com a
-- política de retenção daquele módulo; copiá-lo para cá criaria um segundo
-- lugar com dado pessoal, com outro ciclo de vida e outra regra de acesso. O
-- que fica aqui é o RACIOCÍNIO — intenção, confiança, ferramenta, desfecho —
-- e o ponteiro para a mensagem.
--
-- ⚠️ `subject` É A ÚNICA EXCEÇÃO, e é limitado a 200 caracteres. Sem ele, a
-- pergunta mais útil do log ("que normativa as pessoas pedem e a gente não
-- tem?") fica sem resposta. É o termo que a pessoa usou, não a mensagem dela.
create table if not exists public.intelligence_interactions (
  id bigint generated always as identity primary key,

  -- `set null` (e não cascade): a trilha tem de sobreviver ao que ela audita.
  -- É a mesma escolha de `document_audit_logs`.
  whatsapp_chat_id uuid references public.whatsapp_chats on delete set null,
  whatsapp_message_id uuid references public.whatsapp_messages on delete set null,

  intent text not null,
  -- 0.000 a 1.000. Anulável: nem todo turno passa pelo classificador (uma
  -- resposta "sim" a uma confirmação é lida sem modelo, de propósito).
  confidence numeric(4, 3),
  tool text,
  outcome public.intelligence_outcome not null,

  subject text,
  latency_ms integer,
  -- §36. O mesmo id que viaja no log do WhatsApp — é ele que costura a decisão
  -- do robô ao evento do webhook que a originou.
  correlation_id text,

  created_at timestamptz not null default now(),

  constraint intelligence_interactions_intent_format check (intent ~ '^[a-z_]{3,40}$'),
  constraint intelligence_interactions_tool_format
    check (tool is null or tool ~ '^[a-zA-Z]{3,60}$'),
  constraint intelligence_interactions_confidence_range
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint intelligence_interactions_subject_len
    check (subject is null or char_length(subject) <= 200),
  constraint intelligence_interactions_latency
    check (latency_ms is null or (latency_ms >= 0 and latency_ms <= 600000))
);

comment on table public.intelligence_interactions is
  'Trilha das decisoes do robo. NAO guarda o texto da mensagem: ele vive em whatsapp_messages, com a politica de retencao de la.';

create index if not exists intelligence_interactions_created_idx
  on public.intelligence_interactions (created_at desc);

create index if not exists intelligence_interactions_chat_idx
  on public.intelligence_interactions (whatsapp_chat_id, created_at desc);

-- ⚠️ ÍNDICE PARCIAL SOBRE O QUE DÓI. "O que as pessoas pedem e a APCS não tem"
-- e "o que está quebrando" são as duas perguntas que se faz com pressa, e são
-- a minoria das linhas — indexar a tabela inteira por `outcome` pagaria pelas
-- respostas bem-sucedidas, que ninguém procura.
create index if not exists intelligence_interactions_problems_idx
  on public.intelligence_interactions (outcome, created_at desc)
  where outcome in ('tool_empty', 'tool_error');


-- ----------------------------------------------------------------------------
-- 3. Row Level Security
-- ----------------------------------------------------------------------------
-- ⚠️ SÓ O ADMINISTRADOR LÊ, e é mais estreito que a caixa de entrada de
-- propósito. É a mesma regra de toda trilha deste projeto (`event_audit_logs`,
-- `lecture_audit_logs`, `survey_audit_logs`): quem atende precisa da CONVERSA,
-- que está em `whatsapp_messages` e ele já lê; o raciocínio do robô é material
-- de quem administra o sistema.
--
-- ⚠️ NENHUMA POLICY DE ESCRITA, PARA NINGUÉM. Quem grava as duas tabelas é o
-- servidor Next com `service_role`, no caminho do webhook — que é o único lugar
-- de onde uma decisão do robô pode nascer. Uma policy de insert aqui permitiria
-- forjar uma trilha, que é o oposto do que uma trilha serve.
alter table public.conversation_context enable row level security;
alter table public.intelligence_interactions enable row level security;

create policy "conversation_context_select"
  on public.conversation_context for select
  using (public.is_admin());

create policy "intelligence_interactions_select"
  on public.intelligence_interactions for select
  using (public.is_admin());

revoke insert, update, delete on public.conversation_context from authenticated, anon;
revoke insert, update, delete on public.intelligence_interactions from authenticated, anon;


-- ----------------------------------------------------------------------------
-- 4. A sexta frase do chatbot
-- ----------------------------------------------------------------------------
-- ⚠️ NÃO DÁ PARA REAPROVEITAR `chatbot.no_result`, e a diferença é factual. A
-- agenda de eventos é SEGMENTADA por público: sem reconhecer o telefone, o robô
-- não sabe o que aquela pessoa poderia ver.
--
-- "Não há eventos disponíveis" ali seria uma afirmação FALSA sobre a agenda — e
-- a pessoa desistiria de perguntar. O que ela precisa saber é outra coisa: que
-- o número não está no cadastro.
--
-- As cinco primeiras estão em 20260913000100_knowledge.sql, seção 8.
insert into public.app_settings (key, value) values
  (
    'chatbot.unidentified',
    'Não encontrei este número no cadastro de associados da APCS, e a agenda de eventos depende disso. Posso encaminhar você para um atendente?'
  )
on conflict (key) do nothing;


-- ============================================================================
-- A CONFERÊNCIA
-- ----------------------------------------------------------------------------
-- ⚠️ ELA CONFERE O CHECK, E NÃO SÓ A EXISTÊNCIA DA TABELA. Um `create table if
-- not exists` que encontra a tabela já criada NÃO acrescenta constraint nenhuma
-- — ele simplesmente não faz nada. Numa base onde uma versão anterior desta
-- migration tenha rodado, a tabela existiria sem os CHECKs, e nada avisaria.
--
-- O que ela NÃO faz é ler `whatsapp_chats` ou `members`: o papel que o
-- `supabase db push` usa não tem privilégio nessas tabelas, e foi assim que
-- 20260912000000 abortou duas vezes num relatório.
-- ============================================================================
do $conferencia$
declare
  v_faltando text[] := '{}';
  v_nome text;
begin
  foreach v_nome in array array[
    'conversation_context_intent_format',
    'conversation_context_pending_pair',
    'intelligence_interactions_intent_format',
    'intelligence_interactions_confidence_range'
  ] loop
    if not exists (select 1 from pg_constraint where conname = v_nome) then
      v_faltando := v_faltando || v_nome;
    end if;
  end loop;

  if cardinality(v_faltando) > 0 then
    raise exception
      'Constraints ausentes: %. A tabela ja existia sem elas — `create table if not exists` nao acrescenta constraint.',
      array_to_string(v_faltando, ', ');
  end if;

  -- A trilha não pode ser escrita de fora. Se algum dia alguém criar uma policy
  -- de insert aqui, é este `raise` que avisa.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'intelligence_interactions'
      and cmd <> 'SELECT'
  ) then
    raise exception 'intelligence_interactions ganhou policy de escrita — a trilha passaria a ser forjavel.';
  end if;

  raise notice 'Intelligence Layer: contexto e trilha criados, com CHECKs e RLS conferidos.';
end;
$conferencia$;


-- ============================================================================
-- ROLLBACK (manual)
-- ----------------------------------------------------------------------------
--   drop table if exists public.intelligence_interactions;
--   drop table if exists public.conversation_context;
--   -- (o robo perde a memoria da conversa e para de registrar decisoes; as
--   --  conversas em si continuam intactas em whatsapp_messages)
-- ============================================================================
