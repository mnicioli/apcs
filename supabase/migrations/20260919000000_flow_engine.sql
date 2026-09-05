-- ============================================================================
-- FLOW ENGINE — o motor de execução (Prompt 3)
-- ============================================================================
--
-- A fundação (20260917000100) já sabia GUARDAR uma execução: `flow_runs` tem o
-- nó atual, as variáveis e a versão presa. O que faltava era o que acontece
-- entre uma mensagem e a seguinte — e é quase tudo o que esta migration traz:
--
--   §21  o histórico com desfecho, erro e duração POR PASSO
--   §22  os eventos da conversa, que são vários dentro de um passo
--   §23  a idempotência, que já era um índice único e agora tem uma porta
--   §24  a concorrência: `for update` para o número do passo, `lock_version`
--        para o estado
--   §27  o tempo: uma política por fluxo, e a varredura que a executa
--   §29  a pausa quando uma pessoa assume — e o §30, que é ela terminando
--
-- ⚠️ A DECISÃO ESTRUTURAL DESTE ARQUIVO: TODA ESCRITA DE ESTADO PASSA POR UMA
-- FUNÇÃO. Nenhuma delas é alcançável por `authenticated` — quem chama é o
-- servidor, com `service_role`, atendendo um associado anônimo.
--
-- A razão não é permissão: é TRANSAÇÃO (§43). Avançar uma conversa é mudar o nó
-- atual, gravar as variáveis, fechar o passo e registrar os eventos — quatro
-- escritas que precisam valer todas ou nenhuma. Feitas do lado do Node, uma
-- falha no meio deixaria o nó já avançado e o passo em aberto: a conversa
-- estaria num ponto que nenhuma trilha explica. Dentro de uma função, o
-- Postgres desfaz tudo.
--
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Os tipos
-- ----------------------------------------------------------------------------
-- ⚠️ `create type`, E NÃO `alter type ... add value`. A diferença importa e já
-- mordeu este projeto: um valor acrescentado a um enum existente NÃO pode ser
-- usado na mesma transação ("unsafe use of new value of enum type"). Tipos
-- novos não têm essa restrição — dá para criar e usar no mesmo arquivo, que é o
-- que as funções lá embaixo fazem.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'flow_step_status') then
    create type public.flow_step_status as enum ('succeeded', 'failed', 'skipped');
  end if;
end $$;

comment on type public.flow_step_status is
  'Desfecho de UM passo. `skipped` e o passo que nao aconteceu porque nao devia.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'flow_event_type') then
    create type public.flow_event_type as enum (
      'conversation_started',
      'flow_started',
      'node_started',
      'node_completed',
      'message_sent',
      'question_sent',
      'answer_received',
      'answer_rejected',
      'condition_evaluated',
      'action_executed',
      'transferred_to_team',
      'flow_completed',
      'flow_failed',
      'flow_timeout',
      'automation_paused',
      'automation_resumed'
    );
  end if;
end $$;

comment on type public.flow_event_type is
  'Os eventos do §22. Varios por passo — nao confundir com flow_run_steps.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'flow_timeout_action') then
    create type public.flow_timeout_action as enum ('none', 'remind', 'close', 'transfer');
  end if;
end $$;

comment on type public.flow_timeout_action is
  'O que fazer com uma conversa que emudeceu (§27). `none` e o padrao: nao decidir por ninguem.';


-- ----------------------------------------------------------------------------
-- 2. A política de tempo — no FLUXO, e não na versão (§27)
-- ----------------------------------------------------------------------------
-- ⚠️ E A ESCOLHA DO LUGAR É O PONTO DESTA SEÇÃO. Tempo de espera é política
-- OPERACIONAL ("quanto tempo damos ao associado"), não desenho de conversa.
-- Mudá-lo de 24h para 12h não deveria exigir publicar uma versão nova — e,
-- pior, se ele morasse no retrato congelado, as conversas EM ANDAMENTO
-- continuariam com o prazo antigo, porque retrato congelado é justamente o que
-- não muda no meio do caminho. O resultado seria uma configuração que só passa
-- a valer amanhã, sem ninguém entender por quê.

alter table public.flows
  add column if not exists timeout_minutes integer,
  add column if not exists timeout_action public.flow_timeout_action not null default 'none',
  add column if not exists timeout_team_id uuid references public.attendance_teams on delete set null,
  add column if not exists timeout_message text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'flows_timeout_shape') then
    alter table public.flows add constraint flows_timeout_shape check (
      -- Uma ação de tempo sem prazo nunca dispara; um prazo sem ação não faz
      -- nada. Os dois casos são configuração pela metade, e os dois são
      -- silenciosos — que é exatamente o que um CHECK serve para impedir.
      (timeout_action = 'none' and timeout_minutes is null)
      or (timeout_action <> 'none' and timeout_minutes is not null and timeout_minutes between 5 and 20160)
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'flows_timeout_team') then
    alter table public.flows add constraint flows_timeout_team check (
      timeout_action <> 'transfer' or timeout_team_id is not null
    );
  end if;
end $$;

comment on column public.flows.timeout_minutes is
  'Minutos de silencio ate a conversa vencer. Politica operacional — por isso mora no fluxo, nao na versao.';


-- ----------------------------------------------------------------------------
-- 3. O estado de execução — a trava e o relógio (§24, §27, §29)
-- ----------------------------------------------------------------------------
alter table public.flow_runs
  add column if not exists lock_version integer not null default 0,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_activity_at timestamptz not null default now(),
  add column if not exists automation_paused_until timestamptz,
  add column if not exists failure_reason text;

comment on column public.flow_runs.lock_version is
  'Trava otimista (§24). Toda escrita exige o numero lido e o incrementa; a segunda mensagem nao acha linha.';

comment on column public.flow_runs.automation_paused_until is
  'Ate quando o robo fica calado porque uma pessoa assumiu (§29). E ISTO que o motor consulta, nao o status.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'flow_runs_attempts_range') then
    alter table public.flow_runs add constraint flow_runs_attempts_range
      check (attempt_count between 0 and 100);
  end if;
end $$;

-- ⚠️ A VARREDURA DO §27 PRECISA DESTE ÍNDICE, e ele é PARCIAL de propósito. Uma
-- conversa encerrada nunca vence, e elas serão a esmagadora maioria das linhas
-- em seis meses. Um índice sobre a tabela inteira faria o cron pagar por todo o
-- histórico a cada cinco minutos.
create index if not exists flow_runs_timeout_idx
  on public.flow_runs (last_activity_at)
  where status in ('running', 'waiting_reply');


-- ----------------------------------------------------------------------------
-- 4. O histórico de execução (§21)
-- ----------------------------------------------------------------------------
-- A tabela existia com `input`/`output`. O que faltava era o que se pergunta
-- quando algo deu errado: em que nó, de que tipo, quanto demorou, e o que o
-- Postgres ou o handler disse.
alter table public.flow_run_steps
  add column if not exists node_type public.flow_node_type,
  add column if not exists status public.flow_step_status not null default 'succeeded',
  add column if not exists error text,
  add column if not exists started_at timestamptz not null default now(),
  add column if not exists completed_at timestamptz,
  add column if not exists duration_ms integer,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'flow_run_steps_metadata_object') then
    alter table public.flow_run_steps add constraint flow_run_steps_metadata_object
      check (jsonb_typeof(metadata) = 'object');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'flow_run_steps_duration_positive') then
    alter table public.flow_run_steps add constraint flow_run_steps_duration_positive
      check (duration_ms is null or duration_ms >= 0);
  end if;
end $$;

comment on column public.flow_run_steps.error is
  'A frase TECNICA. Nunca vai para o associado (§35) — a tela dele le uma mensagem configurada.';

comment on column public.flow_run_steps.node_type is
  'O tipo do no NA HORA da execucao. Guardado, e nao consultado por join: a versao pode ter sumido do desenho.';


-- ----------------------------------------------------------------------------
-- 5. Os eventos da conversa (§22)
-- ----------------------------------------------------------------------------
-- ⚠️ POR QUE UMA SEGUNDA TABELA, E NÃO MAIS COLUNAS EM `flow_run_steps`.
--
-- Passo e evento respondem perguntas diferentes, e uma tabela só obrigaria a
-- escolher qual delas perder:
--
--   PASSO    o que o motor FEZ com UMA mensagem recebida. É a unidade de
--            idempotência (§23) — uma linha por chave, e a reentrega não cria
--            outra.
--   EVENTO   o que ACONTECEU dentro daquele passo. Um passo que atravessa
--            mensagem → condição → ação emite três.
--
-- Com uma tabela só, ou a chave de idempotência deixaria de ser única (e o §23
-- cairia), ou a trilha perderia a granularidade que o §36 pede para medir
-- duração por nó.
create table if not exists public.flow_run_events (
  id bigint generated always as identity primary key,
  flow_run_id uuid not null references public.flow_runs on delete cascade,

  type public.flow_event_type not null,

  -- Anulável: `conversation_started` e `flow_timeout` não acontecem em nó nenhum.
  node_id uuid,

  -- ⚠️ SEM O TEXTO DO ASSOCIADO. O que a pessoa escreveu vive em
  -- `whatsapp_messages`, com a política de retenção de lá. Aqui ficam a chave da
  -- alternativa escolhida, o nome da variável gravada, o time de destino, a
  -- duração — o que serve à investigação sem duplicar dado pessoal numa segunda
  -- tabela que ninguém lembraria de expurgar.
  payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint flow_run_events_payload_object check (jsonb_typeof(payload) = 'object')
);

comment on table public.flow_run_events is
  'Os eventos do §22. Varios por passo — ver o comentario da secao 5 da migration.';

-- A leitura é sempre "a trilha desta conversa, em ordem".
create index if not exists flow_run_events_run_idx
  on public.flow_run_events (flow_run_id, id);

-- E a segunda leitura é a do §36: "quais nós falham mais", numa janela de tempo.
create index if not exists flow_run_events_type_idx
  on public.flow_run_events (type, created_at desc);

alter table public.flow_run_events enable row level security;

-- ⚠️ SÓ LEITURA, PARA QUEM JÁ PODE VER O DESENHO. Quem escreve é o motor, com
-- `service_role`, que não passa por RLS. Uma policy de insert aqui permitiria
-- forjar a trilha de um atendimento — é a mesma decisão de `flow_runs`.
create policy "flow_run_events_select" on public.flow_run_events
  for select using ((select public.flow_is_writer()));

revoke insert, update, delete on public.flow_run_events from authenticated, anon;


-- ----------------------------------------------------------------------------
-- 6. Abrir uma execução (§3, §4, §28, §33, §34)
-- ----------------------------------------------------------------------------
-- ⚠️ A SELEÇÃO DO FLUXO ACONTECE AQUI, E NÃO NO NODE, e é a resposta ao §37
-- ("nunca confiar em IDs enviados pelo frontend"). Quem chama informa o CANAL e
-- a CONVERSA; qual fluxo atende e qual versão executa é decidido pelo banco,
-- lendo `is_entry`, `status` e `active_version_id`. Não existe parâmetro capaz
-- de mandar o motor executar um rascunho.
create or replace function public.flow_begin_run(
  p_channel public.flow_channel,
  p_chat_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_run_id uuid;
  v_flow_id uuid;
  v_version_id uuid;
begin
  -- §28. REENTRADA. Uma conversa encerrada pode começar outra; uma conversa EM
  -- ANDAMENTO não começa uma segunda. Devolver a execução aberta é o que faz
  -- uma segunda mensagem entrar no fluxo que já está correndo, em vez de abrir
  -- um paralelo — que é o defeito que o índice `flow_runs_open_idx` já recusaria
  -- com 23505, mas tarde e como erro.
  select r.id into v_run_id
  from public.flow_runs r
  where r.whatsapp_chat_id = p_chat_id
    and r.status in ('running', 'waiting_reply', 'handed_off')
  limit 1;

  if v_run_id is not null then
    return v_run_id;
  end if;

  -- §3. O fluxo de entrada do canal, ATIVO, com versão publicada.
  --
  -- ⚠️ A CONFERÊNCIA DE `status = 'published'` É REDUNDANTE E FICA. Hoje
  -- `active_version_id` só é preenchido por `publish_flow_version`, então a
  -- versão apontada é sempre publicada. "Sempre" é uma propriedade do código de
  -- hoje; o §3 é uma regra de negócio ("nunca executar rascunho, nunca executar
  -- teste"), e regra de negócio que depende de um invariante não escrito é uma
  -- regra que se perde na próxima refatoração.
  select f.id, f.active_version_id into v_flow_id, v_version_id
  from public.flows f
  join public.flow_versions v on v.id = f.active_version_id
  where f.channel = p_channel
    and f.is_entry
    and f.status = 'active'
    and v.status = 'published'
  limit 1;

  if v_flow_id is null then
    return null;
  end if;

  insert into public.flow_runs (flow_id, flow_version_id, whatsapp_chat_id, status, conversation_status)
  values (v_flow_id, v_version_id, p_chat_id, 'running', 'new')
  returning id into v_run_id;

  insert into public.flow_run_events (flow_run_id, type, payload)
  values
    (v_run_id, 'conversation_started', jsonb_build_object('channel', p_channel)),
    -- §33. A versão fica registrada no evento ALÉM da coluna. A coluna diz o que
    -- vale; o evento diz o que valia — e é ele que responde "esta conversa
    -- começou antes ou depois da publicação da v3".
    (v_run_id, 'flow_started', jsonb_build_object('flowId', v_flow_id, 'versionId', v_version_id));

  return v_run_id;
end;
$fn$;

comment on function public.flow_begin_run(public.flow_channel, uuid) is
  'Abre (ou reencontra) a execucao de uma conversa. A escolha do fluxo e da versao e do BANCO — §37.';

revoke execute on function public.flow_begin_run(public.flow_channel, uuid)
  from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 7. Reivindicar um passo — a idempotência (§23) e metade da concorrência (§24)
-- ----------------------------------------------------------------------------
-- ⚠️ ESTA FUNÇÃO É A PORTA DO §23, E ELA NÃO "CONFERE SE JÁ PROCESSOU": ela
-- TENTA INSERIR. A diferença é tudo.
--
-- Um `select ... if not found then insert` perde a corrida exatamente quando o
-- webhook reentrega — que é sob carga, com as duas cópias em voo ao mesmo
-- tempo. As duas leriam "não existe", as duas inseririam, e o fluxo avançaria
-- duas vezes. Com `on conflict do nothing`, quem perde a corrida recebe zero
-- linhas e sabe, sem adivinhar, que aquele passo já foi dado.
--
-- ⚠️ E O `for update` NO INÍCIO NÃO É SOBRE IDEMPOTÊNCIA — é sobre o NÚMERO do
-- passo. `seq` tem índice único, e calculá-lo com `max(seq) + 1` em duas
-- transações simultâneas produziria o mesmo número e um 23505 numa constraint
-- que não tem nada a ver com reentrega. O bloqueio na linha da execução
-- serializa a numeração; ele cai quando esta função retorna.
create or replace function public.flow_claim_step(
  p_run_id uuid,
  p_key text,
  p_node_id uuid,
  p_node_type public.flow_node_type,
  p_input jsonb default '{}'::jsonb,
  p_inbound_message_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_step_id bigint;
  v_seq integer;
begin
  perform 1 from public.flow_runs where id = p_run_id for update;
  if not found then
    return null;
  end if;

  select coalesce(max(s.seq), 0) + 1 into v_seq
  from public.flow_run_steps s
  where s.flow_run_id = p_run_id;

  insert into public.flow_run_steps (
    flow_run_id, node_id, node_type, seq, idempotency_key,
    inbound_message_id, input, status, started_at
  )
  values (
    p_run_id, p_node_id, p_node_type, v_seq, p_key,
    p_inbound_message_id, coalesce(p_input, '{}'::jsonb), 'succeeded', now()
  )
  on conflict (flow_run_id, idempotency_key) do nothing
  returning id into v_step_id;

  -- `null` significa "esta mensagem já foi processada". Não é erro, e quem
  -- chama não deve tratá-la como tal: deve parar em silêncio.
  return v_step_id;
end;
$fn$;

comment on function public.flow_claim_step(uuid, text, uuid, public.flow_node_type, jsonb, uuid) is
  'Reivindica um passo. Devolve NULL quando a chave ja foi usada — e e assim que o §23 se cumpre.';

revoke execute on function public.flow_claim_step(uuid, text, uuid, public.flow_node_type, jsonb, uuid)
  from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 8. Fechar o passo e mover o estado — a transação do §43 e a trava do §24
-- ----------------------------------------------------------------------------
-- ⚠️ AS QUATRO ESCRITAS DE UM AVANÇO ACONTECEM AQUI, JUNTAS: o estado da
-- execução, as variáveis, o fechamento do passo e os eventos. Feitas separadas
-- do lado do Node, uma falha no meio deixaria a conversa num ponto que a trilha
-- não explica — o nó já teria avançado e o passo ficaria eternamente em aberto.
--
-- ⚠️ E O `lock_version` É O QUE IMPEDE O CENÁRIO DO §24. Duas mensagens que
-- chegam juntas leem `lock_version = 3`. A primeira grava e o número vira 4. A
-- segunda pede `where lock_version = 3` e NÃO ENCONTRA LINHA — devolve `false`,
-- e quem chamou relê o estado em vez de escrever por cima. Sem isso, a segunda
-- sobrescreveria o nó atual com um avanço calculado a partir de um estado que
-- já não existe.
create or replace function public.flow_commit_step(
  p_step_id bigint,
  p_lock_version integer,
  p_current_node_id uuid,
  p_run_status public.flow_run_status,
  p_conversation_status public.flow_conversation_status,
  p_variables jsonb,
  p_attempt_count integer,
  p_team_key text default null,
  p_step_status public.flow_step_status default 'succeeded',
  p_output jsonb default '{}'::jsonb,
  p_error text default null,
  p_failure_reason text default null,
  p_events jsonb default '[]'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_run_id uuid;
  v_team_id uuid;
  v_started timestamptz;
  v_encerrada boolean;
  v_evento jsonb;
begin
  select s.flow_run_id, s.started_at into v_run_id, v_started
  from public.flow_run_steps s
  where s.id = p_step_id;

  if v_run_id is null then
    return false;
  end if;

  -- §17. A transferência aponta para o TIME, e o time é resolvido por CHAVE —
  -- nunca por um id vindo de fora. Uma chave que não existe (ou de um time
  -- desativado) resolve para nulo, e a conversa fica sem fila em vez de entrar
  -- numa fila errada.
  if p_team_key is not null and p_team_key <> '' then
    select t.id into v_team_id
    from public.attendance_teams t
    where t.key = p_team_key and t.status = 'active';
  end if;

  v_encerrada := p_run_status in ('completed', 'failed', 'cancelled');

  update public.flow_runs r
  set current_node_id = p_current_node_id,
      status = p_run_status,
      conversation_status = p_conversation_status,
      variables = coalesce(p_variables, '{}'::jsonb),
      attempt_count = greatest(0, least(100, coalesce(p_attempt_count, 0))),
      assigned_team_id = coalesce(v_team_id, r.assigned_team_id),
      failure_reason = p_failure_reason,
      last_activity_at = now(),
      -- O CHECK `flow_runs_closed_stamp` cobra os dois lados: nenhum desfecho
      -- sem carimbo, nenhum carimbo sem desfecho. Reabrir não acontece hoje, e
      -- o `null` no ramo aberto é o que garante que continue não acontecendo.
      completed_at = case when v_encerrada then coalesce(r.completed_at, now()) else null end,
      lock_version = r.lock_version + 1
  where r.id = v_run_id
    and r.lock_version = p_lock_version;

  if not found then
    -- Outra mensagem moveu a conversa entre a leitura e esta escrita. Quem
    -- chamou relê e recalcula; não há nada a consertar aqui.
    return false;
  end if;

  update public.flow_run_steps s
  set status = p_step_status,
      output = coalesce(p_output, '{}'::jsonb),
      error = p_error,
      completed_at = now(),
      duration_ms = greatest(0, (extract(epoch from (now() - v_started)) * 1000)::integer)
  where s.id = p_step_id;

  -- Os eventos do §22, no MESMO commit do estado. Uma trilha que pudesse ficar
  -- para trás em relação ao que aconteceu seria pior do que trilha nenhuma:
  -- ela mentiria com aparência de registro.
  for v_evento in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb))
  loop
    insert into public.flow_run_events (flow_run_id, type, node_id, payload)
    values (
      v_run_id,
      (v_evento ->> 'type')::public.flow_event_type,
      nullif(v_evento ->> 'nodeId', '')::uuid,
      coalesce(v_evento -> 'payload', '{}'::jsonb)
    );
  end loop;

  return true;
end;
$fn$;

comment on function public.flow_commit_step(bigint, integer, uuid, public.flow_run_status, public.flow_conversation_status, jsonb, integer, text, public.flow_step_status, jsonb, text, text, jsonb) is
  'Fecha o passo e move o estado, num commit so (§43). Devolve false quando a trava otimista recusa (§24).';

revoke execute on function public.flow_commit_step(bigint, integer, uuid, public.flow_run_status, public.flow_conversation_status, jsonb, integer, text, public.flow_step_status, jsonb, text, text, jsonb)
  from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 9. A pausa humana (§29) e o caminho de volta (§30)
-- ----------------------------------------------------------------------------
-- ⚠️ O MOTOR CONSULTA `automation_paused_until`, E NÃO `conversation_status`, e
-- a separação é deliberada. O status descreve o ATENDIMENTO ("em atendimento",
-- "aguardando cliente") e serve à tela da fila; a pausa descreve o ROBÔ ("não
-- fale"). Amarrar um ao outro faria toda mudança de rótulo na fila mexer, sem
-- querer, em quem pode falar com o associado.
--
-- O §30 é a mesma função com `p_until = null`: a conversa volta ao fluxo
-- automático sem nada precisar ser desfeito.
create or replace function public.flow_set_automation_pause(
  p_run_id uuid,
  p_until timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.flow_runs
  set automation_paused_until = p_until,
      last_activity_at = now(),
      lock_version = lock_version + 1
  where id = p_run_id;

  if not found then
    return false;
  end if;

  insert into public.flow_run_events (flow_run_id, type, payload)
  values (
    p_run_id,
    case when p_until is null then 'automation_resumed' else 'automation_paused' end,
    jsonb_build_object('until', p_until)
  );

  return true;
end;
$fn$;

comment on function public.flow_set_automation_pause(uuid, timestamptz) is
  'Cala o robo (§29) ou o devolve a conversa (§30). NULL = voltar a atender.';

revoke execute on function public.flow_set_automation_pause(uuid, timestamptz)
  from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 10. O tempo (§27) — a varredura
-- ----------------------------------------------------------------------------
-- ⚠️ ELA SÓ DEVOLVE CANDIDATAS. A função não encerra, não transfere e não manda
-- lembrete: quem faz isso é o motor, no servidor, passando pelas MESMAS portas
-- de qualquer outro avanço — `flow_claim_step` e `flow_commit_step`.
--
-- Fazer o encerramento aqui dentro seria um segundo caminho de escrita de
-- estado, com as próprias regras, ao lado do primeiro. Na primeira mudança do
-- motor os dois divergiriam, e a conversa encerrada por tempo passaria a ter uma
-- trilha diferente da encerrada por conversa — pelo mesmo desfecho.
create or replace function public.flow_timeout_due(p_limit integer default 50)
returns table (
  run_id uuid,
  flow_id uuid,
  flow_version_id uuid,
  whatsapp_chat_id uuid,
  current_node_id uuid,
  lock_version integer,
  timeout_action public.flow_timeout_action,
  timeout_team_key text,
  timeout_message text,
  silent_minutes integer
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.id,
         r.flow_id,
         r.flow_version_id,
         r.whatsapp_chat_id,
         r.current_node_id,
         r.lock_version,
         f.timeout_action,
         t.key,
         f.timeout_message,
         (extract(epoch from (now() - r.last_activity_at)) / 60)::integer
  from public.flow_runs r
  join public.flows f on f.id = r.flow_id
  left join public.attendance_teams t on t.id = f.timeout_team_id
  where r.status in ('running', 'waiting_reply')
    and f.timeout_action <> 'none'
    and f.timeout_minutes is not null
    and r.last_activity_at < now() - make_interval(mins => f.timeout_minutes)
    -- Uma conversa que uma pessoa assumiu não vence por silêncio do robô: o
    -- silêncio ali é o atendimento humano acontecendo fora deste sistema.
    and (r.automation_paused_until is null or r.automation_paused_until < now())
  order by r.last_activity_at
  limit greatest(1, least(500, coalesce(p_limit, 50)));
$fn$;

comment on function public.flow_timeout_due(integer) is
  'As conversas que venceram (§27). So LE — quem age e o motor, pelas portas normais.';

revoke execute on function public.flow_timeout_due(integer) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 11. A validação ganha a regra do fallback (§11)
-- ----------------------------------------------------------------------------
-- ⚠️ `create or replace` DA FUNÇÃO INTEIRA, e não um "acrescentar uma regra" —
-- não existe isso em PL/pgSQL. O corpo abaixo é o de 20260918000000 com a regra
-- 9 no fim; qualquer divergência entre os dois é um defeito, e é por isso que
-- `src/test/sql-flow-validation.test.ts` lê SEMPRE a última definição.
create or replace function public.validate_flow_version(p_version_id uuid)
returns table (code text, detail text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_flow_id uuid;
begin
  select v.flow_id into v_flow_id
  from public.flow_versions v
  where v.id = p_version_id;

  if v_flow_id is null then
    return query select 'version_not_found'::text, 'A versao nao existe.'::text;
    return;
  end if;

  -- 1. Nó inicial.
  if not exists (
    select 1 from public.flow_nodes n where n.flow_version_id = p_version_id and n.is_start
  ) then
    return query select 'missing_start'::text, 'O fluxo precisa de um no inicial.'::text;
  end if;

  -- 2. Sem nó final, toda conversa fica em aberto para sempre.
  if not exists (
    select 1 from public.flow_nodes n where n.flow_version_id = p_version_id and n.type = 'end'
  ) then
    return query select 'missing_end'::text, 'O fluxo precisa de ao menos um no de encerramento.'::text;
  end if;

  -- 3. Nó sem saída que não encerra nem transfere.
  return query
    select 'dead_end'::text,
           format('O no "%s" nao tem saida e nao encerra o atendimento.', n.key)::text
    from public.flow_nodes n
    where n.flow_version_id = p_version_id
      and n.type not in ('end', 'attendant')
      and not exists (
        select 1 from public.flow_transitions t
        where t.flow_version_id = p_version_id and t.source_node_id = n.id
      );

  -- 4. Nó órfão.
  return query
    select 'unreachable'::text,
           format('O no "%s" nao e alcancado por nenhuma transicao.', n.key)::text
    from public.flow_nodes n
    where n.flow_version_id = p_version_id
      and not n.is_start
      and not exists (
        select 1 from public.flow_transitions t
        where t.flow_version_id = p_version_id and t.target_node_id = n.id
      );

  -- 5. Pergunta DE ESCOLHA sem duas alternativas PREENCHIDAS.
  return query
    select 'question_without_options'::text,
           format('A pergunta "%s" nao tem duas alternativas preenchidas.', n.key)::text
    from public.flow_nodes n
    where n.flow_version_id = p_version_id
      and n.type = 'question'
      and coalesce(n.configuration ->> 'kind', 'buttons') in ('buttons', 'list')
      and (
        select count(*)
        from jsonb_array_elements(
          case when jsonb_typeof(n.configuration -> 'options') = 'array'
               then n.configuration -> 'options' else '[]'::jsonb end
        ) as opcao
        where btrim(coalesce(opcao ->> 'label', '')) <> ''
      ) < 2;

  -- 6. Pergunta ABERTA com mais de uma saída.
  return query
    select 'open_question_branches'::text,
           format('A pergunta "%s" e de resposta aberta e nao pode ter mais de uma saida.', n.key)::text
    from public.flow_nodes n
    where n.flow_version_id = p_version_id
      and n.type = 'question'
      and coalesce(n.configuration ->> 'kind', 'buttons') in ('free_text', 'number')
      and (
        select count(*) from public.flow_transitions t
        where t.flow_version_id = p_version_id and t.source_node_id = n.id
      ) > 1;

  -- 7. Mensagem ou pergunta SEM TEXTO.
  return query
    select 'empty_message'::text,
           format('A etapa "%s" nao tem texto para enviar.', n.key)::text
    from public.flow_nodes n
    where n.flow_version_id = p_version_id
      and n.type in ('message', 'question')
      and btrim(coalesce(n.configuration ->> 'text', '')) = '';

  -- 8. Transferir para um time que não existe (ou que foi desativado).
  return query
    select 'attendant_without_team'::text,
           format('O no "%s" nao aponta para um time ativo.', n.key)::text
    from public.flow_nodes n
    where n.flow_version_id = p_version_id
      and n.type = 'attendant'
      and not exists (
        select 1 from public.attendance_teams tm
        where tm.key = (n.configuration ->> 'teamKey') and tm.status = 'active'
      );

  -- 9. A REGRA NOVA DO PROMPT 3 (§11). Uma pergunta cujo desfecho de tentativas
  --    esgotadas é TRANSFERIR precisa dizer para qual time.
  --
  --    ⚠️ SEM ELA, O DEFEITO SERIA DOS PIORES: tudo funcionaria até o dia em que
  --    alguém errasse três vezes seguidas — e só então a conversa morreria, sem
  --    fila, sem mensagem e sem ninguém saber. Um caminho que só executa no pior
  --    momento da conversa de alguém é exatamente o que a publicação existe para
  --    conferir antes.
  return query
    select 'fallback_without_team'::text,
           format('A pergunta "%s" transfere ao esgotar as tentativas e nao aponta para um time ativo.', n.key)::text
    from public.flow_nodes n
    where n.flow_version_id = p_version_id
      and n.type = 'question'
      and (n.configuration ->> 'onExhausted') = 'transfer'
      and not exists (
        select 1 from public.attendance_teams tm
        where tm.key = (n.configuration ->> 'fallbackTeamKey') and tm.status = 'active'
      );

  -- 10. A SEGUNDA REGRA NOVA (§14). Uma seta que COMPARA e não diz com o quê.
  --
  --     ⚠️ O ZOD ACEITA ISTO DE PROPÓSITO — trocar a condição de uma seta grava
  --     na hora, com o campo de valor ainda em branco, porque a pessoa acabou de
  --     escolher o tipo e vai digitar em seguida. Cobrar no teclado faria o auto
  --     save recusar entre um clique e o outro, que é o defeito que
  --     `messageTextSchema` já pagou uma vez.
  --
  --     E o estrago em execução não é a seta ser ignorada: a condição nunca
  --     casa, e se não houver outra saída a conversa morre em
  --     `no_matching_transition` no meio de uma frase.
  --
  --     ⚠️ A LISTA DE OPERADORES SEM VALOR ESTÁ ESCRITA AQUI E EM
  --     `flow.operators.ts`. É duplicação deliberada — o Postgres não tem como
  --     ler o registro do TypeScript — e ela é guardada por
  --     `src/test/sql-flow-engine.test.ts`, que confere que os dois lados
  --     listam os mesmos quatro.
  return query
    select 'condition_without_value'::text,
           format('A ligacao que sai de "%s" compara %s e nao diz com o que.',
                  n.key, t.condition ->> 'name')::text
    from public.flow_transitions t
    join public.flow_nodes n on n.id = t.source_node_id
    where t.flow_version_id = p_version_id
      and (t.condition ->> 'type') = 'variable'
      and coalesce(t.condition ->> 'operator', 'eq')
          not in ('exists', 'not_exists', 'is_true', 'is_false')
      and btrim(coalesce(t.condition ->> 'value', '')) = '';
end;
$fn$;


-- ----------------------------------------------------------------------------
-- 12. Os grants de coluna — as colunas novas de `flows`
-- ----------------------------------------------------------------------------
-- ⚠️ ESTA SEÇÃO É OBRIGATÓRIA E FÁCIL DE ESQUECER. `flows` tem `revoke update`
-- seguido de `grant update (colunas)`: uma coluna que não aparece na lista não
-- pode ser escrita por `authenticated`, e o sintoma é 42501 — que a tela mostra
-- como "Você não tem permissão para esta ação", para um administrador com todas
-- as permissões. Foi assim que `events.description` quebrou.
--
-- `src/test/sql-column-grants.test.ts` guarda esta porta.
grant update (
  name, description, channel, is_entry, updated_by, updated_at,
  timeout_minutes, timeout_action, timeout_team_id, timeout_message
) on public.flows to authenticated;


-- ============================================================================
-- ROLLBACK
-- ============================================================================
--   drop function if exists public.flow_timeout_due(integer);
--   drop function if exists public.flow_set_automation_pause(uuid, timestamptz);
--   drop function if exists public.flow_commit_step(bigint, integer, uuid, public.flow_run_status, public.flow_conversation_status, jsonb, integer, text, public.flow_step_status, jsonb, text, text, jsonb);
--   drop function if exists public.flow_claim_step(uuid, text, uuid, public.flow_node_type, jsonb, uuid);
--   drop function if exists public.flow_begin_run(public.flow_channel, uuid);
--   drop table if exists public.flow_run_events;
--   alter table public.flow_run_steps
--     drop column if exists node_type, drop column if exists status,
--     drop column if exists error, drop column if exists started_at,
--     drop column if exists completed_at, drop column if exists duration_ms,
--     drop column if exists metadata;
--   alter table public.flow_runs
--     drop column if exists lock_version, drop column if exists attempt_count,
--     drop column if exists last_activity_at, drop column if exists automation_paused_until,
--     drop column if exists failure_reason;
--   alter table public.flows
--     drop column if exists timeout_minutes, drop column if exists timeout_action,
--     drop column if exists timeout_team_id, drop column if exists timeout_message;
--   drop type if exists public.flow_timeout_action;
--   drop type if exists public.flow_event_type;
--   drop type if exists public.flow_step_status;
--   -- E restaurar validate_flow_version da 20260918000000.
-- ============================================================================
