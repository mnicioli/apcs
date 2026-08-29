-- ============================================================================
-- DIVULGAÇÃO DE EVENTOS — a fila, o opt-out global e o worker
-- ============================================================================
--
-- O que passa a existir: o time cadastra o evento, confere, e QUANDO QUISER
-- clica em "Divulgar". Só então as mensagens saem, para os associados dos
-- públicos-alvo daquele evento.
--
-- ⚠️ DIVULGAR É UM ATO SEPARADO DE CRIAR, e isso é requisito, não detalhe. Um
-- evento criado com data errada e corrigido cinco minutos depois não pode ter
-- avisado a base inteira nesses cinco minutos — mensagem de WhatsApp não tem
-- botão de desfazer.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTE ARQUIVO NÃO INVENTA
-- ----------------------------------------------------------------------------
-- A porta de mensageria, o adaptador da Z-API, o limite de ritmo, o disjuntor e
-- o backoff já existem e estão em uso por Enquetes. Nada disso é tocado aqui.
-- Este arquivo acrescenta a FILA de Eventos e as funções que a operam — o
-- mesmo desenho de `survey_recipients`/`survey_dispatches`, pelos mesmos
-- motivos, que estão documentados lá e valem igual aqui.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. O opt-out deixa de ser "de enquete" e passa a ser DE NOTIFICAÇÃO
-- ----------------------------------------------------------------------------
-- ⚠️ A TABELA NUNCA FOI POR ENQUETE. A chave única sempre foi
-- `(contact_id, channel)` — nunca teve `survey_id`. Quem respondeu SAIR já
-- estava saindo de TUDO; só o nome dizia outra coisa.
--
-- Renomear agora é o que impede o erro previsível: alguém, daqui a três meses,
-- criar `event_opt_outs` porque "o de enquete não serve para evento" — e a
-- partir daí a APCS teria duas listas de quem pediu para não ser incomodado, o
-- que na prática é não ter nenhuma.
alter table public.survey_opt_outs rename to notification_opt_outs;
alter index survey_opt_outs_unique_idx rename to notification_opt_outs_unique_idx;

comment on table public.notification_opt_outs is
  'Quem pediu para nao receber. Vale para TODA notificacao — enquete, evento, o que vier. Consultado ANTES de cada disparo: nao e preferencia, e bloqueio.';

-- ⚠️ O TIPO `survey_channel` NÃO foi renomeado junto, e é decisão consciente:
-- ele está na assinatura de `register_survey_opt_out`, e trocar o tipo exigiria
-- derrubar e recriar a função — mais superfície de risco num módulo que hoje
-- funciona, por ganho puramente cosmético. Fica registrado como dívida.
comment on type public.survey_channel is
  'Canal de notificacao. O nome ainda diz "survey" por heranca: ele e usado por notification_opt_outs, que vale para toda notificacao.';

-- As duas funções que citam a tabela pelo nome antigo. `create or replace` não
-- as recria do zero: só troca o corpo, mantendo assinatura, grants e políticas.
create or replace function public.retry_failed_survey_recipients(
  p_survey_id uuid,
  p_max_attempts integer default 5
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  if not public.survey_is_writer() then
    raise exception 'Sem permissao para reenviar esta enquete.' using errcode = '42501';
  end if;

  update public.survey_recipients r
  set status = 'pending',
      last_error = null
  where r.survey_id = p_survey_id
    and r.status = 'error'
    and r.attempts < p_max_attempts
    and not exists (
      select 1 from public.notification_opt_outs o where o.contact_id = r.contact_id
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- 1.1 A comparação de telefone entre as duas tabelas
-- ----------------------------------------------------------------------------
-- ⚠️ `members.whatsapp` E `chat_contacts.phone` NÃO ESTÃO NO MESMO FORMATO.
--
--   members.whatsapp     DDD + numero, so digitos ....... 19992773100   (11)
--   chat_contacts.phone  vem do fornecedor, com DDI ...... 5519992773100 (13)
--
-- Comparar por igualdade faria o opt-out NUNCA casar — e o efeito seria mandar
-- evento para quem respondeu SAIR, que é o pior desfecho deste módulo e é
-- jurídico antes de ser estético. Um `=` aqui falharia em silêncio: nenhum
-- erro, nenhum log, só mensagens indo para quem pediu para não recebê-las.
--
-- Os últimos 11 dígitos são o denominador comum: DDD + 9 dígitos do celular
-- brasileiro. Não são 8 ou 9 — aí dois números de DDDs diferentes colidiriam, e
-- bloquear a pessoa errada é tão ruim quanto não bloquear a certa.
create or replace function public.notification_phone_key(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 11);
$fn$;

comment on function public.notification_phone_key(text) is
  'Chave de comparacao de telefone entre members.whatsapp (sem DDI) e chat_contacts.phone (com DDI): os ultimos 11 digitos.';

-- ----------------------------------------------------------------------------
-- 2. O mapeamento público-alvo → perfil de associado
-- ----------------------------------------------------------------------------
-- É o elo que a unificação dos perfis criou. Fica numa função, e não espalhado
-- em `case` dentro das consultas, porque quando entrar um quinto público é aqui
-- — num lugar só — que se decide a quem ele corresponde.
--
-- ⚠️ DEVOLVE NULL PARA `all-members` E `associados`, e isso está certo:
--   • `all-members` é atalho, nunca fica vinculado a evento (é expandido na
--     gravação — ver docs/EVENTS.md);
--   • `associados` foi aposentado na unificação.
-- Null aqui significa "este slug não corresponde a perfil nenhum", e quem
-- consulta filtra. Devolver um perfil qualquer seria mandar mensagem para o
-- grupo errado em silêncio.
create or replace function public.profile_for_event_segment(p_slug text)
returns public.membership_profile_type
language sql
immutable
set search_path = ''
as $fn$
  select case p_slug
    when 'produtores'    then 'criador'
    when 'empresas'      then 'empresa'
    when 'tecnicos'      then 'tecnico'
    when 'universidades' then 'universidade'
    else null
  end::public.membership_profile_type;
$fn$;

comment on function public.profile_for_event_segment(text) is
  'Traduz slug de publico-alvo em perfil de associado. Null quando o slug nao corresponde a perfil (atalho ou publico aposentado).';

-- ----------------------------------------------------------------------------
-- 3. Os estados
-- ----------------------------------------------------------------------------
-- Tipos NOVOS podem ser criados e usados na mesma transação — a restrição do
-- Postgres é sobre `add value` em tipo que já existe, e é por isso que os dois
-- valores de `event_audit_action` vieram no arquivo anterior.
create type public.event_dispatch_status as enum (
  'running',    -- há fila e alguém está drenando
  'completed',  -- a fila acabou
  'failed'      -- parou por erro que não adianta insistir (disjuntor aberto)
);

create type public.event_recipient_status as enum (
  'pending',
  'sending',
  'sent',
  'delivered',
  'read',
  'error',
  -- ⚠️ `blocked` NÃO É ERRO. É quem pediu para não receber. Somar os dois num
  -- "não recebeu" faria a tela mostrar 40 falhas onde há 40 pessoas
  -- respeitadas — e alguém tentaria "consertar" reenviando.
  'blocked'
);

-- ----------------------------------------------------------------------------
-- 4. A corrida de divulgação
-- ----------------------------------------------------------------------------
create table public.event_dispatches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,

  status public.event_dispatch_status not null default 'running',

  total_recipients integer not null default 0,
  total_sent integer not null default 0,
  total_errors integer not null default 0,
  total_blocked integer not null default 0,

  started_at timestamptz not null default now(),
  finished_at timestamptz,
  last_error text,

  created_by uuid references public.profiles on delete set null default auth.uid(),

  constraint event_dispatches_counts check (
    total_recipients >= 0 and total_sent >= 0
    and total_errors >= 0 and total_blocked >= 0
  )
);

comment on table public.event_dispatches is
  'Uma corrida de divulgacao. Sem cron no projeto, uma base grande precisa de mais de uma — a fila e a mesma, a corrida e outra.';

create index event_dispatches_event_idx on public.event_dispatches (event_id, started_at desc);

-- ----------------------------------------------------------------------------
-- 5. A fila
-- ----------------------------------------------------------------------------
create table public.event_recipients (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,

  -- `set null` + snapshot, como `survey_recipients`: `members` pode ser apagado
  -- por pedido de eliminação (LGPD), e sem o snapshot atender esse pedido
  -- apagaria também a resposta para "para quantas pessoas este evento foi
  -- divulgado?", que é registro operacional, não dado pessoal em uso.
  member_id uuid references public.members on delete set null,
  member_name text,

  -- ⚠️ SÓ DÍGITOS, e NOT NULL: ninguém entra na fila sem telefone. Um
  -- destinatário sem número não é "pendente", é uma linha que nunca sairá de
  -- pendente — e a fila nunca terminaria.
  member_phone text not null,

  status public.event_recipient_status not null default 'pending',

  attempts integer not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  provider_message_id text,

  last_dispatch_id uuid references public.event_dispatches on delete set null,

  created_at timestamptz not null default now(),

  constraint event_recipients_attempts_non_negative check (attempts >= 0),
  constraint event_recipients_phone_digits check (member_phone ~ '^[0-9]{10,15}$')
);

comment on table public.event_recipients is
  'A fila de divulgacao de um evento. Uma linha por telefone — a fotografia de quem era publico-alvo no momento do clique.';

-- ⚠️ A CHAVE É (evento, TELEFONE), não (evento, associado). Dois cadastros da
-- mesma pessoa — que acontece: carga legada mais cadastro pelo site — mandariam
-- a mesma mensagem duas vezes para o mesmo aparelho. Quem recebe não vê dois
-- registros; vê a APCS mandando duas vezes.
create unique index event_recipients_unique_idx
  on public.event_recipients (event_id, member_phone);

create index event_recipients_queue_idx
  on public.event_recipients (event_id, status, created_at);

-- O caminho que o webhook percorre para casar "entregue"/"lido" com a linha.
create index event_recipients_provider_msg_idx
  on public.event_recipients (provider_message_id)
  where provider_message_id is not null;

-- ----------------------------------------------------------------------------
-- 6. RLS
-- ----------------------------------------------------------------------------
alter table public.event_dispatches enable row level security;
alter table public.event_recipients enable row level security;

-- Leitura para quem já pode ler eventos. A escrita NÃO tem policy: quem grava
-- são as funções `security definer` abaixo e o worker com `service_role`.
create policy "event_dispatches_select"
  on public.event_dispatches for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

create policy "event_recipients_select"
  on public.event_recipients for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

revoke insert, update, delete on public.event_dispatches from authenticated, anon;
revoke insert, update, delete on public.event_recipients from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 7. Divulgar: monta a fila e abre a corrida
-- ----------------------------------------------------------------------------
-- Devolve a corrida e os números da fotografia. Chamada pela action do botão.
--
-- ⚠️ REENTRANTE DE PROPÓSITO. Sem cron, uma base grande exige clicar
-- "Continuar divulgação". A segunda chamada NÃO refaz a fila: o
-- `on conflict do nothing` preserva quem já está lá, com o status que já tem.
-- Só entram números que ainda não estavam — o associado que se cadastrou entre
-- uma corrida e outra.
create or replace function public.start_event_dispatch(p_event_id uuid)
returns table (dispatch_id uuid, queued integer, blocked integer, already integer)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_dispatch_id uuid;
  v_event public.events%rowtype;
  v_before integer;
  v_after integer;
  v_blocked integer;
begin
  -- A barreira de papel. `events.write` na matriz de RBAC = admin e ceo.
  if (select public.current_app_role()) not in ('admin', 'ceo') then
    raise exception 'Sem permissao para divulgar eventos.' using errcode = '42501';
  end if;

  select * into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null then
    raise exception 'Evento nao encontrado.' using errcode = 'P0002';
  end if;

  -- ⚠️ EVENTO INATIVO OU VENCIDO NÃO DIVULGA. A expiração é derivada (não há
  -- coluna), então a regra é a data — a mesma de `set_event_status`. Divulgar
  -- um evento de ontem é o tipo de erro que só se percebe pelas respostas.
  if v_event.status <> 'active' then
    raise exception 'Ative o evento antes de divulgar.' using errcode = 'EV004';
  end if;
  if v_event.event_date < (select public.event_today()) then
    raise exception 'Este evento ja passou e nao pode ser divulgado.' using errcode = 'EV005';
  end if;

  if not exists (
    select 1 from public.event_segment_links l where l.event_id = p_event_id
  ) then
    raise exception 'Defina o publico-alvo antes de divulgar.' using errcode = 'EV006';
  end if;

  select count(*) into v_before from public.event_recipients r where r.event_id = p_event_id;

  insert into public.event_dispatches (event_id)
  values (p_event_id)
  returning id into v_dispatch_id;

  -- A FOTOGRAFIA. Associados ativos, com telefone, cujo perfil corresponde a
  -- algum público-alvo do evento.
  --
  -- ⚠️ O OPT-OUT É CONFERIDO POR TELEFONE, não por `contact_id`. `members.
  -- contact_id` é nulo em quase todo mundo (só a carga legada o preenche), e
  -- conferir só por ele faria quem respondeu SAIR no chatbot receber o evento
  -- assim mesmo. Esse é o pior desfecho possível deste módulo, e ele é
  -- jurídico antes de ser estético.
  insert into public.event_recipients (event_id, member_id, member_name, member_phone, status)
  select distinct on (m.whatsapp)
    p_event_id,
    m.id,
    m.full_name,
    m.whatsapp,
    case
      when exists (
        select 1
        from public.notification_opt_outs o
        join public.chat_contacts c on c.id = o.contact_id
        where public.notification_phone_key(c.phone)
            = public.notification_phone_key(m.whatsapp)
      ) then 'blocked'::public.event_recipient_status
      else 'pending'::public.event_recipient_status
    end
  from public.members m
  where m.status = 'active'
    and m.profile_type is not null
    and m.whatsapp ~ '^[0-9]{10,15}$'
    and m.profile_type in (
      select public.profile_for_event_segment(s.slug)
      from public.event_segment_links l
      join public.event_segments s on s.id = l.segment_id
      where l.event_id = p_event_id
        and public.profile_for_event_segment(s.slug) is not null
    )
  -- `distinct on` exige ordem, e a ordem escolhe QUAL cadastro representa o
  -- telefone quando há dois: o mais antigo, que é o que tem histórico.
  order by m.whatsapp, m.created_at, m.id
  on conflict (event_id, member_phone) do nothing;

  select count(*) into v_after from public.event_recipients r where r.event_id = p_event_id;

  select count(*) into v_blocked
  from public.event_recipients r
  where r.event_id = p_event_id and r.status = 'blocked';

  update public.event_dispatches d
  set total_recipients = v_after,
      total_blocked = v_blocked
  where d.id = v_dispatch_id;

  insert into public.event_audit_logs (event_id, action, metadata)
  values (
    p_event_id,
    'event_dispatch_started',
    jsonb_build_object(
      'dispatchId', v_dispatch_id,
      'queued', v_after - v_before,
      'blocked', v_blocked,
      'total', v_after
    )
  );

  return query select v_dispatch_id, (v_after - v_before), v_blocked, v_before;
end;
$fn$;

comment on function public.start_event_dispatch(uuid) is
  'Abre uma corrida de divulgacao e monta a fila a partir dos publicos-alvo do evento. Reentrante: nao refaz quem ja esta na fila.';

-- ----------------------------------------------------------------------------
-- 8. O worker: reivindicar, liquidar, encerrar
-- ----------------------------------------------------------------------------
-- Mesmo `for update skip locked` de Enquetes: dois workers nunca pegam a mesma
-- pessoa. Ver o comentário longo em `claim_survey_recipients`.
create or replace function public.claim_event_recipients(
  p_event_id uuid,
  p_dispatch_id uuid,
  p_limit integer default 25
)
returns setof public.event_recipients
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'O lote deve ficar entre 1 e 500 destinatarios.' using errcode = 'EV007';
  end if;

  -- ⚠️ O OPT-OUT É RECONFERIDO A CADA LOTE, e não só na montagem da fila.
  -- Entre o clique em "Divulgar" e a última mensagem podem passar minutos —
  -- tempo de sobra para alguém responder SAIR numa mensagem anterior desta
  -- mesma divulgação. Quem pediu para sair no minuto 2 não pode receber no
  -- minuto 7.
  update public.event_recipients r
  set status = 'blocked'
  where r.event_id = p_event_id
    and r.status = 'pending'
    and exists (
      select 1
      from public.notification_opt_outs o
      join public.chat_contacts c on c.id = o.contact_id
      where public.notification_phone_key(c.phone)
          = public.notification_phone_key(r.member_phone)
    );

  return query
  update public.event_recipients r
  set status = 'sending',
      last_attempt_at = now(),
      last_dispatch_id = p_dispatch_id
  where r.id in (
    select c.id
    from public.event_recipients c
    where c.event_id = p_event_id
      and c.status = 'pending'
    order by c.created_at, c.id
    for update skip locked
    limit p_limit
  )
  returning r.*;
end;
$fn$;

comment on function public.claim_event_recipients(uuid, uuid, integer) is
  'Reivindica um lote da fila com FOR UPDATE SKIP LOCKED, reconferindo o opt-out antes.';

-- O resultado de UMA mensagem. `p_error` nulo = sucesso.
create or replace function public.settle_event_recipient(
  p_recipient_id uuid,
  p_provider_message_id text,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.event_recipients r
  set status = case when p_error is null then 'sent' else 'error' end,
      attempts = r.attempts + 1,
      provider_message_id = coalesce(p_provider_message_id, r.provider_message_id),
      last_error = p_error,
      last_attempt_at = now()
  where r.id = p_recipient_id
    -- Só liquida o que ESTE worker reivindicou. Uma liquidação atrasada, de um
    -- worker que a plataforma matou e voltou, não pode sobrescrever o resultado
    -- de quem já refez o trabalho.
    and r.status = 'sending';
end;
$fn$;

comment on function public.settle_event_recipient(uuid, text, text) is
  'Liquida uma mensagem: sent ou error. So age sobre linha em sending.';

-- ⚠️ A RECUPERAÇÃO. Um worker morto no meio (deploy, timeout) deixa linhas em
-- 'sending' para sempre — elas não são reivindicáveis e a fila nunca termina.
-- Devolvê-las a 'pending' depois de um tempo é o que faz a fila se curar
-- sozinha, sem ninguém precisar perceber que algo travou.
create or replace function public.release_stale_event_recipients(
  p_event_id uuid,
  p_older_than interval default interval '10 minutes'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  update public.event_recipients r
  set status = 'pending'
  where r.event_id = p_event_id
    and r.status = 'sending'
    and r.last_attempt_at < now() - p_older_than;

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

comment on function public.release_stale_event_recipients(uuid, interval) is
  'Devolve a fila quem ficou preso em sending. Sem isto, um worker morto trava o evento para sempre.';

-- Encerra a corrida com os números e escreve a auditoria.
create or replace function public.finish_event_dispatch(
  p_dispatch_id uuid,
  p_status public.event_dispatch_status,
  p_last_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_event_id uuid;
  v_sent integer;
  v_errors integer;
  v_blocked integer;
  v_pending integer;
begin
  select d.event_id into v_event_id from public.event_dispatches d where d.id = p_dispatch_id;
  if v_event_id is null then
    raise exception 'Corrida de divulgacao nao encontrada.' using errcode = 'P0002';
  end if;

  select
    count(*) filter (where r.status in ('sent', 'delivered', 'read')),
    count(*) filter (where r.status = 'error'),
    count(*) filter (where r.status = 'blocked'),
    count(*) filter (where r.status in ('pending', 'sending'))
  into v_sent, v_errors, v_blocked, v_pending
  from public.event_recipients r
  where r.event_id = v_event_id;

  update public.event_dispatches d
  set status = p_status,
      total_sent = v_sent,
      total_errors = v_errors,
      total_blocked = v_blocked,
      last_error = p_last_error,
      finished_at = now()
  where d.id = p_dispatch_id;

  insert into public.event_audit_logs (event_id, action, metadata)
  values (
    v_event_id,
    'event_dispatch_completed',
    jsonb_build_object(
      'dispatchId', p_dispatch_id,
      'status', p_status,
      'sent', v_sent,
      'errors', v_errors,
      'blocked', v_blocked,
      'remaining', v_pending
    )
  );
end;
$fn$;

comment on function public.finish_event_dispatch(uuid, public.event_dispatch_status, text) is
  'Encerra a corrida com os numeros apurados da fila e registra a auditoria.';

-- ----------------------------------------------------------------------------
-- 9. Privilégios
-- ----------------------------------------------------------------------------
-- ⚠️ O `alter default privileges` do Supabase concede EXECUTE a `anon` em TODA
-- função nova de `public` — inclusive `security definer`, que é a combinação
-- mais perigosa que existe. Revogar não é zelo: é desfazer um grant que
-- ninguem pediu. Mesmo raciocinio da secao 13 da migration do WhatsApp.

-- O botao: quem tem papel de escrita em eventos.
revoke execute on function public.start_event_dispatch(uuid) from public, anon;
grant execute on function public.start_event_dispatch(uuid) to authenticated;

-- O worker: so o servidor.
revoke execute on function public.claim_event_recipients(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_event_recipients(uuid, uuid, integer) to service_role;

revoke execute on function public.settle_event_recipient(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.settle_event_recipient(uuid, text, text) to service_role;

revoke execute on function public.release_stale_event_recipients(uuid, interval)
  from public, anon, authenticated;
grant execute on function public.release_stale_event_recipients(uuid, interval) to service_role;

revoke execute on function public.finish_event_dispatch(uuid, public.event_dispatch_status, text)
  from public, anon, authenticated;
grant execute on function public.finish_event_dispatch(uuid, public.event_dispatch_status, text)
  to service_role;

-- A auxiliar de mapeamento: usada dentro das funções acima, que rodam como
-- dono. Ninguém a chama de fora.
revoke execute on function public.profile_for_event_segment(text)
  from public, anon, authenticated;
revoke execute on function public.notification_phone_key(text)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 10. Como desfazer
-- ----------------------------------------------------------------------------
--   drop function if exists public.finish_event_dispatch(uuid, public.event_dispatch_status, text);
--   drop function if exists public.release_stale_event_recipients(uuid, interval);
--   drop function if exists public.settle_event_recipient(uuid, text, text);
--   drop function if exists public.claim_event_recipients(uuid, uuid, integer);
--   drop function if exists public.start_event_dispatch(uuid);
--   drop function if exists public.profile_for_event_segment(text);
--   drop table if exists public.event_recipients;
--   drop table if exists public.event_dispatches;
--   drop type if exists public.event_recipient_status;
--   drop type if exists public.event_dispatch_status;
--   alter table public.notification_opt_outs rename to survey_opt_outs;
--   -- e recriar retry_failed_survey_recipients citando o nome antigo.
--
-- ⚠️ Os dois valores de `event_audit_action` NÃO saem — o Postgres não remove
-- valor de enum. Ver o arquivo de enums.
-- ----------------------------------------------------------------------------
