-- ============================================================================
-- A PORTA DE SAÍDA DO ROBÔ — e o silêncio dele quando há gente atendendo
-- ============================================================================
--
-- O PROMPT 1/3 construiu a decisão (`intelligence_interactions`,
-- `conversation_context`, o roteador). Ela nunca chegou ao WhatsApp porque
-- faltavam duas coisas que só o banco resolve:
--
--   1. um jeito de o robô GRAVAR o que mandou, sem se passar por atendente
--   2. um jeito de ele FICAR CALADO quando uma pessoa assumiu a conversa
--
-- ----------------------------------------------------------------------------
-- ⚠️ POR QUE NÃO DEU PARA REUSAR `whatsapp_start_outbound_message`
-- ----------------------------------------------------------------------------
-- Ela existe desde 20260822000000 e faz quase tudo o que o robô precisa. Três
-- coisas impedem, e a terceira é a que dói:
--
--   • carimba `origin = 'agent'` — o robô viraria atendente no histórico;
--   • carimba `sent_by = auth.uid()` — que é NULL para o robô, o que é certo,
--     mas some junto com a distinção de quem falou;
--   • ZERA `unread_count`, com a justificativa (correta, para uma pessoa) de
--     que "responder é ler".
--
-- O terceiro item é um defeito silencioso se aplicado ao robô. O contador é o
-- que acende a aba "Não lidas" da caixa de entrada. Um robô que responde e zera
-- o contador faz a conversa DESAPARECER da fila do atendente — e o associado
-- que escreveu "quero falar com alguém" recebe a frase de encaminhamento e
-- nunca mais é procurado. Ninguém veria: a caixa fica bonita, vazia e errada.
--
-- Por isso uma função irmã, e não um parâmetro a mais na existente: são regras
-- diferentes, e um `if p_bot then` dentro da função do atendente seria um
-- convite a mexer nela por engano.
--
-- ----------------------------------------------------------------------------
-- ⚠️ O SILÊNCIO NÃO É "ATRIBUIÇÃO DE CONVERSA", E NÃO PRETENDE SER
-- ----------------------------------------------------------------------------
-- `docs/WHATSAPP.md` §11 registra: "Não tem atribuição nem fila. Não há
-- 'assumir conversa' como na Central de Atendimento. As colunas para isso não
-- existem — quando existirem, entram por migration."
--
-- Esta migration NÃO cria atribuição. Ela cria uma pergunta bem menor, que é a
-- única que o robô precisa responder: "eu devo falar agora?". Uma coluna de
-- data, não um dono. Quando a atribuição chegar, ela substitui a checagem de
-- pausa dentro de `whatsapp_bot_should_answer` e nada mais neste módulo muda.
--
-- DEPENDE DE: 20260822000000_create_whatsapp_inbox.sql,
--             20260914000200_intelligence.sql
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. A janela de silêncio
-- ----------------------------------------------------------------------------
alter table public.whatsapp_chats
  add column if not exists bot_paused_until timestamptz;

comment on column public.whatsapp_chats.bot_paused_until is
  'Ate quando o robo fica calado nesta conversa. NULL = pode falar.';

-- ⚠️ POR QUE UMA DATA, E NÃO UM `boolean`.
--
-- Um `bot_ativo = false` precisaria de alguém para voltar a ligar, e a caixa de
-- entrada do WhatsApp não tem botão de "resolver" (só a Central de Atendimento
-- tem). O robô ficaria mudo para sempre naquela conversa, e o sintoma apareceria
-- meses depois como "o bot parou de responder para o fulano".
--
-- Com data, o silêncio EXPIRA sozinho. Cada nova fala humana o renova; passada
-- a janela sem ninguém falar, o atendimento acabou e o robô volta.
create or replace function public.whatsapp_bot_pause_minutes()
returns integer
language sql
immutable
as $$ select 60; $$;

comment on function public.whatsapp_bot_pause_minutes is
  'Quanto tempo o robo fica calado depois de uma fala humana. Um lugar so.';


-- ----------------------------------------------------------------------------
-- 2. Falou uma pessoa, o robô cala
-- ----------------------------------------------------------------------------
-- ⚠️ É UM GATILHO, E NÃO UMA CHAMADA — de propósito.
--
-- A alternativa era o atendente chamar "pausar" ao responder, o que significa
-- lembrar de chamar. E há DOIS caminhos por onde uma pessoa fala neste sistema:
-- a tela do CRM (`origin = 'agent'`) e o celular físico, cujas mensagens a
-- Z-API devolve pelo webhook (`origin = 'phone'`). O segundo não passa por
-- código nosso nenhum — não existe lugar onde encaixar a chamada.
--
-- No gatilho, os dois caminhos são cobertos e nenhuma linha das que já
-- funcionam precisou mudar.
create or replace function public.whatsapp_pause_bot_on_human()
returns trigger
language plpgsql
-- INVOKER, e não DEFINER: quem insere em `whatsapp_messages` já é ou uma função
-- `security definer` (a resposta do atendente, a ingestão do webhook) ou o
-- `service_role`. Em todos os caminhos o privilégio para este UPDATE já existe,
-- e um gatilho DEFINER seria poder guardado sem necessidade.
set search_path = ''
as $$
begin
  -- ⚠️ O ECO DAS NOSSAS PRÓPRIAS MENSAGENS. Sem este desvio, o robô se calaria
  -- por uma hora logo depois de responder — e o sintoma seria "ele responde a
  -- primeira mensagem e ignora o resto".
  --
  -- A Z-API devolve pelo webhook TUDO que sai do número, inclusive o que ela
  -- mesma acabou de enviar a nosso pedido (`ReceivedCallback` com
  -- `fromMe: true`). `whatsapp_record_inbound_message` grava esse retorno como
  -- `origin = 'phone'` — "veio do aparelho" —, e descarta a duplicata pelo
  -- índice de `provider_message_id`.
  --
  -- Só que o id do fornecedor é escrito na LIQUIDAÇÃO, depois do envio. Entre
  -- gravar pendente e liquidar cabem os 15 s do timeout do fornecedor, e um eco
  -- que chegue nessa janela não casa com nada: entra como linha nova, com cara
  -- de pessoa digitando no celular.
  --
  -- A condição abaixo é exatamente essa janela — "há mensagem nossa em voo
  -- nesta conversa". Uma pessoa que escreva do aparelho NO MESMO instante não
  -- pausa o robô; a mensagem seguinte dela pausa, e é por isso que o custo do
  -- falso negativo aqui é um turno, enquanto o do falso positivo era uma hora.
  if new.origin = 'phone' and exists (
    select 1
    from public.whatsapp_messages m
    where m.chat_id = new.chat_id
      and m.direction = 'outbound'
      and m.status = 'pending'
      and m.provider_message_id is null
  ) then
    return null;
  end if;

  update public.whatsapp_chats
  set bot_paused_until =
        pg_catalog.now() + (public.whatsapp_bot_pause_minutes() || ' minutes')::interval,
      updated_at = pg_catalog.now()
  where id = new.chat_id;

  return null;
end;
$$;

comment on function public.whatsapp_pause_bot_on_human is
  'Toda fala humana (CRM ou celular) renova o silencio do robo naquela conversa.';

drop trigger if exists whatsapp_messages_pause_bot on public.whatsapp_messages;

create trigger whatsapp_messages_pause_bot
  after insert on public.whatsapp_messages
  for each row
  -- ⚠️ `contact` (o associado) e `bot` ficam de fora, e a segunda é a que
  -- importa: incluir `bot` faria o robô se calar sozinho ao responder — a
  -- primeira resposta dele seria a última.
  when (new.origin in ('agent', 'phone'))
  execute function public.whatsapp_pause_bot_on_human();


-- ----------------------------------------------------------------------------
-- 3. "Eu devo falar agora?"
-- ----------------------------------------------------------------------------
-- A pergunta inteira num lugar só. Três motivos para calar, e cada um tem uma
-- razão diferente de existir:
create or replace function public.whatsapp_bot_should_answer(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.whatsapp_chats c
    where c.id = p_chat_id

      -- (a) GRUPO NUNCA. Um grupo não é uma pessoa perguntando: é dezenas de
      -- pessoas conversando entre si, e o robô responderia a cada menção de
      -- "bolsa" no meio de um papo. Além disso, `chat_key` de grupo não é
      -- telefone de ninguém — não há a quem mandar o PDF.
      and not c.is_group

      -- (b) SILÊNCIO EM VIGOR. Ver a seção 1.
      and (c.bot_paused_until is null or c.bot_paused_until <= pg_catalog.now())

      -- (c) ATENDIMENTO HUMANO ABERTO na Central de Atendimento.
      --
      -- ⚠️ ESTA É A MESMA CHECAGEM QUE AS ENQUETES JÁ FAZEM em `survey-inbox`,
      -- e ela está aqui — em SQL — para ser a mesma de verdade, e não duas
      -- cópias que envelhecem separadas.
      --
      -- `contact_id` NULO faz o `not exists` valer: não há como haver
      -- atendimento aberto de alguém que o CRM não conhece, e o robô responde.
      -- É o certo — a maioria de quem escreve para a APCS não é cadastro nenhum.
      and not exists (
        select 1
        from public.chat_conversations cc
        where cc.contact_id = c.contact_id
          and cc.assigned_to is not null
          and cc.resolved_at is null
      )
  );
$$;

comment on function public.whatsapp_bot_should_answer is
  'Grupo, silencio em vigor ou atendimento humano aberto: o robo nao fala.';

-- ⚠️ NÃO CONFUNDIR COM "ESTA CONVERSA TEM CHATBOT LIGADO". Não existe tal
-- interruptor, e a ausência dele é uma decisão: o que liga e desliga o robô é o
-- conteúdo estar publicado (`disponivel_para_chatbot`), que já é por publicação
-- e já tem tela. Um segundo interruptor por conversa criaria duas verdades
-- sobre o mesmo "o robô responde?".


-- ----------------------------------------------------------------------------
-- 4. Calar por decisão (o encaminhamento)
-- ----------------------------------------------------------------------------
-- Quando o próprio robô encaminha para uma pessoa, ele se cala na hora — sem
-- esperar que alguém responda. Entre o "vou te encaminhar" e o atendente
-- aparecer podem se passar horas, e nesse intervalo o robô responderia
-- alegremente a tudo que a pessoa escrevesse enquanto espera.
create or replace function public.whatsapp_pause_bot(
  p_chat_id uuid,
  p_minutes integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minutos integer := coalesce(p_minutes, public.whatsapp_bot_pause_minutes());
begin
  if v_minutos <= 0 or v_minutos > 10080 then
    raise exception 'Janela de silencio invalida: % minutos.', v_minutos
      using errcode = 'WA004';
  end if;

  update public.whatsapp_chats
  set bot_paused_until = pg_catalog.now() + (v_minutos || ' minutes')::interval,
      updated_at = pg_catalog.now()
  where id = p_chat_id;
end;
$$;

comment on function public.whatsapp_pause_bot is
  'Cala o robo por N minutos (padrao: whatsapp_bot_pause_minutes).';


-- ----------------------------------------------------------------------------
-- 5. A porta de saída
-- ----------------------------------------------------------------------------
-- Mesma coreografia da resposta do atendente — GRAVA PENDENTE → MANDA →
-- LIQUIDA — e pelo mesmo motivo, que está escrito em `whatsapp.ts`: entre o
-- envio e a resposta do fornecedor cabe uma falha, e uma mensagem ENTREGUE cuja
-- resposta se perdeu não pode sumir do CRM.
--
-- A liquidação reusa `whatsapp_settle_outbound_message` sem alteração: ela já
-- aceita o `service_role` (`whatsapp_is_writer()` vale quando `auth.uid()` é
-- nulo) e já protege a escala de status.
create or replace function public.whatsapp_start_bot_message(
  p_chat_id uuid,
  p_body text,
  p_kind public.whatsapp_message_kind default 'text'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_texto text := pg_catalog.btrim(coalesce(p_body, ''));
  v_provider text;
begin
  select c.provider into v_provider from public.whatsapp_chats c where c.id = p_chat_id;
  if v_provider is null then
    raise exception 'Conversa nao encontrada.' using errcode = 'P0002';
  end if;

  -- ⚠️ TEXTO VAZIO É RECUSADO AQUI TAMBÉM, e vale para anexo: a legenda de um
  -- anexo do robô é sempre ou a resposta oficial ou o nome do arquivo. Uma
  -- linha vazia no histórico faria o atendente ver um balão em branco e
  -- concluir que a mensagem falhou.
  if v_texto = '' then
    raise exception 'Mensagem do robo sem corpo.' using errcode = 'WA002';
  end if;

  insert into public.whatsapp_messages (
    chat_id, provider, direction, origin, kind, body, status, sent_by, occurred_at
  )
  values (
    p_chat_id, v_provider,
    'outbound'::public.whatsapp_direction,
    'bot'::public.whatsapp_message_origin,
    p_kind, v_texto,
    'pending'::public.whatsapp_delivery_status,
    -- Sem autor. `sent_by` é uma FK para `profiles`, e o robô não é ninguém.
    null, pg_catalog.now()
  )
  returning id into v_id;

  update public.whatsapp_chats
  set last_message_at = pg_catalog.now(),
      last_message_preview = pg_catalog.left(v_texto, 140),
      last_message_from_me = true,
      -- ⚠️ `unread_count` NÃO É TOCADO, e é a razão desta função existir.
      -- Ver o cabeçalho: o robô responder não é o time ter lido.
      updated_at = pg_catalog.now()
  where id = p_chat_id;

  return v_id;
end;
$$;

comment on function public.whatsapp_start_bot_message is
  'Grava pendente uma mensagem do ROBO (origin=bot). Nao zera unread_count.';


-- ----------------------------------------------------------------------------
-- 6. A ponta final da rastreabilidade
-- ----------------------------------------------------------------------------
-- §46 pede a corrente inteira:
--
--   mensagem recebida → conversa → intenção → ferramenta → mensagem enviada
--
-- As quatro primeiras já estavam em `intelligence_interactions`. A quinta é
-- esta coluna: a PRIMEIRA mensagem que o robô mandou em resposta àquele turno.
-- Com ela, uma linha da trilha responde "o que foi decidido E o que saiu"; sem
-- ela, é preciso adivinhar por proximidade de horário.
alter table public.intelligence_interactions
  add column if not exists reply_message_id uuid
    references public.whatsapp_messages on delete set null;

comment on column public.intelligence_interactions.reply_message_id is
  'A primeira mensagem enviada em resposta a este turno. Fecha a corrente do §46.';

-- ⚠️ SÓ A PRIMEIRA, e não uma contagem de anexos. Quantos arquivos saíram, e se
-- saíram, já está em `whatsapp_messages` — uma linha por peça, com o id do
-- fornecedor e o status de entrega. Um contador aqui seria um segundo registro
-- do mesmo fato, com menos informação e livre para divergir.


-- ----------------------------------------------------------------------------
-- 7. Privilégios de execução
-- ----------------------------------------------------------------------------
-- ⚠️ O MESMO MOTIVO DA SEÇÃO 13 DE 20260822000000: o Supabase declara
-- `alter default privileges ... grant execute on functions to anon,
-- authenticated, service_role` no schema `public`. Toda função nova nasce
-- executável por `anon` — inclusive `security definer`. Revogar é desfazer um
-- grant que ninguém pediu.

-- A porta de saída do robô: só o servidor, e só pelo webhook.
revoke execute on function public.whatsapp_start_bot_message(
  uuid, text, public.whatsapp_message_kind
) from public, anon, authenticated;
grant execute on function public.whatsapp_start_bot_message(
  uuid, text, public.whatsapp_message_kind
) to service_role;

revoke execute on function public.whatsapp_pause_bot(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.whatsapp_pause_bot(uuid, integer) to service_role;

-- A pergunta "devo falar?" é leitura pura e não muda nada — mas ela enxerga
-- `chat_conversations`, então também não é para o visitante.
revoke execute on function public.whatsapp_bot_should_answer(uuid)
  from public, anon, authenticated;
grant execute on function public.whatsapp_bot_should_answer(uuid) to service_role;

revoke execute on function public.whatsapp_pause_bot_on_human() from public, anon, authenticated;
revoke execute on function public.whatsapp_bot_pause_minutes() from public, anon;


-- ============================================================================
-- A CONFERÊNCIA
-- ----------------------------------------------------------------------------
-- ⚠️ ELA CONFERE O GATILHO E O `unread_count`, e não só a existência das
-- funções. Um `create or replace function` sempre "dá certo"; o que ele não
-- garante é que o gatilho tenha sido criado nem que a função de saída não
-- tenha, um dia, ganhado a linha que zera o contador.
--
-- O que ela NÃO faz é ler `whatsapp_chats` ou `chat_conversations`: o papel do
-- `supabase db push` não tem privilégio nessas tabelas, e foi assim que
-- 20260912000000 abortou duas vezes num relatório.
-- ============================================================================
do $conferencia$
declare
  v_fonte text;
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'whatsapp_messages_pause_bot'
      and tgrelid = 'public.whatsapp_messages'::regclass
  ) then
    raise exception
      'O gatilho whatsapp_messages_pause_bot nao existe — o robo atravessaria conversa humana.';
  end if;

  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.whatsapp_chats'::regclass
      and attname = 'bot_paused_until'
      and not attisdropped
  ) then
    raise exception 'A coluna whatsapp_chats.bot_paused_until nao existe.';
  end if;

  -- ⚠️ O DESVIO DO ECO. Ver o comentário na seção 2. Sem ele o robô responde a
  -- primeira mensagem e fica mudo por uma hora — e nada no sistema acusa.
  select pg_catalog.pg_get_functiondef(p.oid) into v_fonte
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'whatsapp_pause_bot_on_human';

  -- Os comentários saem antes da busca — ver a explicação mais abaixo, no
  -- `unread_count`. Aqui o efeito é o inverso e igualmente importante: sem
  -- retirá-los, um comentário FALANDO do desvio bastaria para a conferência
  -- passar, mesmo com o código dele apagado.
  v_fonte := pg_catalog.regexp_replace(
    coalesce(v_fonte, ''), '--[^' || chr(10) || ']*', '', 'g'
  );

  if v_fonte not like '%provider_message_id is null%' then
    raise exception
      'whatsapp_pause_bot_on_human perdeu o desvio do eco. O retorno do proprio envio calaria o robo por uma hora depois da primeira resposta.';
  end if;

  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.intelligence_interactions'::regclass
      and attname = 'reply_message_id'
      and not attisdropped
  ) then
    raise exception 'A coluna intelligence_interactions.reply_message_id nao existe.';
  end if;

  -- ⚠️ A CONFERÊNCIA QUE VALE MAIS. Ler o corpo da função e exigir que ele NÃO
  -- mexa no contador. Se alguém "unificar" esta função com a do atendente por
  -- simetria, o push para aqui e explica o porquê — em vez de a caixa de
  -- entrada silenciosamente parar de acusar conversa nova.
  select pg_catalog.pg_get_functiondef(p.oid) into v_fonte
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'whatsapp_start_bot_message';

  if v_fonte is null then
    raise exception 'whatsapp_start_bot_message nao existe.';
  end if;

  -- ⚠️ OS COMENTÁRIOS SAEM ANTES DA BUSCA. `pg_get_functiondef` devolve o corpo
  -- INTEIRO, comentários inclusive — e o comentário que explica esta regra
  -- contém, necessariamente, a palavra que a regra proíbe. Sem esta linha a
  -- conferência acusaria a si mesma e abortaria todo `db:push`.
  v_fonte := pg_catalog.regexp_replace(v_fonte, '--[^' || chr(10) || ']*', '', 'g');

  if v_fonte like '%unread_count%' then
    raise exception
      'whatsapp_start_bot_message mexe em unread_count. O robo respondendo zeraria a aba "Nao lidas" e a conversa sumiria da fila do atendente.';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role', 'public.whatsapp_start_bot_message(uuid, text, public.whatsapp_message_kind)', 'EXECUTE'
  ) then
    raise exception 'service_role nao pode executar whatsapp_start_bot_message — o robo nao conseguiria responder.';
  end if;

  if pg_catalog.has_function_privilege(
    'anon', 'public.whatsapp_start_bot_message(uuid, text, public.whatsapp_message_kind)', 'EXECUTE'
  ) then
    raise exception 'anon pode executar whatsapp_start_bot_message — qualquer pessoa escreveria no historico da APCS.';
  end if;

  raise notice 'Robo do WhatsApp: porta de saida, silencio e rastreabilidade conferidos.';
end;
$conferencia$;
