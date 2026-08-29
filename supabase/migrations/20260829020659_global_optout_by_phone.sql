-- ============================================================================
-- O OPT-OUT PASSA A SER POR TELEFONE — corrige um SAIR que não saía
-- ============================================================================
--
-- BUG ENCONTRADO EM PRODUÇÃO: um associado recebeu a divulgação de um evento,
-- respondeu SAIR, e continuou recebendo.
--
-- Duas causas independentes, e as duas precisavam ser corrigidas:
--
--   1. O SAIR só era interpretado DENTRO de uma conversa de enquete
--      (`survey-inbox.ts`: sem contexto aberto, a função retorna antes de ler
--      o texto). Quem recebeu um evento nunca tem esse contexto. Isso se
--      conserta no código.
--
--   2. ⚠️ NÃO HAVIA ONDE GRAVAR. `notification_opt_outs.contact_id` é
--      obrigatório e aponta para `chat_contacts` — a tabela de quem conversou
--      com o bot da web. Um associado que nunca falou com o chatbot NÃO TEM
--      linha lá. Mesmo que o SAIR fosse reconhecido, o registro não caberia
--      em lugar nenhum. É isto que esta migration conserta.
--
-- ----------------------------------------------------------------------------
-- A DECISÃO: A IDENTIDADE DE QUEM NÃO QUER RECEBER É O TELEFONE
-- ----------------------------------------------------------------------------
-- `chat_contacts` é um registro de LEADS da web; `members`, o cadastro de
-- associados. A mesma pessoa pode estar nos dois, em um só, ou em nenhum — e o
-- WhatsApp não conhece nenhum dos dois. Ele conhece um número.
--
-- Prender o "não me mande mais" a uma dessas tabelas é o que produziu o bug:
-- a pessoa existia para o disparo (via `members`) e não existia para o
-- bloqueio (via `chat_contacts`).
--
-- `contact_id` continua existindo e continua sendo preenchido quando se sabe
-- quem é — ele serve para a tela mostrar o nome. Mas quem MANDA no bloqueio
-- passa a ser `phone_key`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A coluna nova
-- ----------------------------------------------------------------------------
alter table public.notification_opt_outs
  add column if not exists phone_key text;

comment on column public.notification_opt_outs.phone_key is
  'Ultimos 11 digitos do telefone (DDD + celular). E a identidade do bloqueio: o WhatsApp conhece numero, nao cadastro.';

-- Backfill do que já existe, a partir do contato.
update public.notification_opt_outs o
set phone_key = public.notification_phone_key(c.phone)
from public.chat_contacts c
where c.id = o.contact_id
  and o.phone_key is null
  and public.notification_phone_key(c.phone) <> '';

-- ⚠️ `contact_id` VIRA OPCIONAL. Quem responde SAIR a uma divulgação de evento
-- pode não ter nenhuma linha em `chat_contacts` — e é exatamente esse o caso
-- que estava quebrado.
alter table public.notification_opt_outs
  alter column contact_id drop not null;

-- ⚠️ NENHUMA LINHA PODE FICAR SEM AS DUAS. Um opt-out que não identifica
-- ninguém não bloqueia ninguém: seria um registro de que alguém pediu para
-- sair, sem saber quem — pior que não ter o registro, porque parece proteção.
alter table public.notification_opt_outs
  add constraint notification_opt_outs_identifies_someone
  check (phone_key is not null or contact_id is not null);

-- ----------------------------------------------------------------------------
-- 2. As chaves de unicidade
-- ----------------------------------------------------------------------------
-- Duas parciais em vez de uma total: a linha pode ter só telefone (associado
-- que nunca falou com o bot), só contato (o backfill que não achou telefone),
-- ou os dois.
drop index if exists notification_opt_outs_unique_idx;

create unique index notification_opt_outs_phone_idx
  on public.notification_opt_outs (phone_key, channel)
  where phone_key is not null;

create unique index notification_opt_outs_contact_idx
  on public.notification_opt_outs (contact_id, channel)
  where contact_id is not null;

-- ----------------------------------------------------------------------------
-- 3. Registrar um opt-out por telefone
-- ----------------------------------------------------------------------------
-- ⚠️ O `on conflict` USA A CHAVE DE TELEFONE. Quem responde SAIR duas vezes
-- (porque a primeira não pareceu funcionar, que é justamente o que acabou de
-- acontecer) não pode gerar erro nem linha duplicada.
--
-- `p_contact_id` é opcional e serve só para a tela mostrar o nome depois. O
-- bloqueio não depende dele.
create or replace function public.register_notification_opt_out(
  p_phone text,
  p_channel public.survey_channel default 'whatsapp',
  p_source text default 'chatbot',
  p_note text default null,
  p_contact_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key text := public.notification_phone_key(p_phone);
  v_id uuid;
begin
  if v_key is null or v_key = '' then
    raise exception 'Telefone invalido para registrar opt-out.' using errcode = 'NO001';
  end if;

  insert into public.notification_opt_outs (contact_id, phone_key, channel, source, note)
  values (p_contact_id, v_key, p_channel, p_source, p_note)
  on conflict (phone_key, channel) where phone_key is not null
  do update set
    -- Só PREENCHE o contato quando ele ainda não era conhecido; nunca apaga o
    -- que já estava lá.
    contact_id = coalesce(public.notification_opt_outs.contact_id, excluded.contact_id)
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.register_notification_opt_out(text, public.survey_channel, text, text, uuid) is
  'Registra "nao me mande mais" pelo TELEFONE. Idempotente: responder SAIR duas vezes nao gera erro nem duplicata.';

revoke execute on function public.register_notification_opt_out(
  text, public.survey_channel, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.register_notification_opt_out(
  text, public.survey_channel, text, text, uuid
) to service_role;

-- ----------------------------------------------------------------------------
-- 4. O bloqueio passa a olhar o telefone direto
-- ----------------------------------------------------------------------------
-- Antes, as duas funções de evento só achavam o opt-out passando por
-- `chat_contacts` — que é justamente a tabela que o associado pode não ter.
-- Agora conferem `phone_key` PRIMEIRO, e mantêm o caminho pelo contato para
-- não perder as linhas antigas cujo backfill não achou telefone.
create or replace function public.is_notification_blocked(p_phone text)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.notification_opt_outs o
    left join public.chat_contacts c on c.id = o.contact_id
    where o.phone_key = public.notification_phone_key(p_phone)
       or public.notification_phone_key(c.phone) = public.notification_phone_key(p_phone)
  );
$fn$;

comment on function public.is_notification_blocked(text) is
  'Este telefone pediu para nao receber? Confere por telefone e, para as linhas antigas, tambem pelo contato.';

revoke execute on function public.is_notification_blocked(text) from public, anon;
grant execute on function public.is_notification_blocked(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. As três funções que consultavam o opt-out passam a usar a auxiliar
-- ----------------------------------------------------------------------------
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

  -- O opt-out é reconferido a cada lote: entre o clique e a última mensagem
  -- podem passar minutos, tempo de sobra para alguém responder SAIR numa
  -- mensagem anterior desta mesma divulgação.
  update public.event_recipients r
  set status = 'blocked'
  where r.event_id = p_event_id
    and r.status = 'pending'
    and public.is_notification_blocked(r.member_phone);

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

create or replace function public.count_event_audience(p_event_id uuid)
returns table (total integer, blocked integer)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if (select public.current_app_role()) not in ('admin', 'ceo', 'comercial') then
    raise exception 'Sem permissao para consultar a audiencia.' using errcode = '42501';
  end if;

  return query
  with alvo as (
    select distinct on (m.whatsapp)
      m.whatsapp,
      public.is_notification_blocked(m.whatsapp) as opted_out
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
    order by m.whatsapp, m.created_at, m.id
  )
  select
    count(*) filter (where not a.opted_out)::integer,
    count(*) filter (where a.opted_out)::integer
  from alvo a;
end;
$fn$;

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
  if (select public.current_app_role()) not in ('admin', 'ceo') then
    raise exception 'Sem permissao para divulgar eventos.' using errcode = '42501';
  end if;

  select * into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null then
    raise exception 'Evento nao encontrado.' using errcode = 'P0002';
  end if;

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

  insert into public.event_recipients (event_id, member_id, member_name, member_phone, status)
  select distinct on (m.whatsapp)
    p_event_id,
    m.id,
    m.full_name,
    m.whatsapp,
    case
      when public.is_notification_blocked(m.whatsapp)
        then 'blocked'::public.event_recipient_status
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

-- ----------------------------------------------------------------------------
-- 6. A ficha do associado precisa saber
-- ----------------------------------------------------------------------------
-- ⚠️ NÃO É UMA COLUNA EM `members`, e não é preguiça: o opt-out é do TELEFONE,
-- e dois associados podem compartilhar um (marido e mulher na mesma granja, um
-- número de escritório). Uma coluna criaria a possibilidade de os dois
-- discordarem sobre o mesmo aparelho.
--
-- ⚠️ SÓ DEVOLVE O ESTADO, NUNCA A LISTA. Quem lê a ficha de um associado
-- pergunta sobre AQUELE associado.
create or replace function public.member_notification_status(p_member_id uuid)
returns table (opted_out boolean, opted_out_at timestamptz, source text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_phone text;
begin
  if (select public.current_app_role()) not in ('admin', 'ceo', 'comercial') then
    raise exception 'Sem permissao para consultar o associado.' using errcode = '42501';
  end if;

  select m.whatsapp into v_phone from public.members m where m.id = p_member_id;

  if v_phone is null or public.notification_phone_key(v_phone) = '' then
    -- Sem telefone não há o que bloquear nem o que liberar. `false` aqui
    -- significa "não pediu para sair", que é verdade — a tela distingue isso
    -- de "recebe" mostrando que não há WhatsApp cadastrado.
    return query select false, null::timestamptz, null::text;
    return;
  end if;

  return query
  select true, o.created_at, o.source
  from public.notification_opt_outs o
  left join public.chat_contacts c on c.id = o.contact_id
  where o.phone_key = public.notification_phone_key(v_phone)
     or public.notification_phone_key(c.phone) = public.notification_phone_key(v_phone)
  order by o.created_at asc
  limit 1;

  if not found then
    return query select false, null::timestamptz, null::text;
  end if;
end;
$fn$;

comment on function public.member_notification_status(uuid) is
  'Este associado pediu para nao receber notificacoes? Responde pelo telefone dele. So o estado, nunca a lista.';

revoke execute on function public.member_notification_status(uuid) from public, anon;
grant execute on function public.member_notification_status(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Como desfazer
-- ----------------------------------------------------------------------------
--   drop function if exists public.member_notification_status(uuid);
--   drop function if exists public.is_notification_blocked(text);
--   drop function if exists public.register_notification_opt_out(text, public.survey_channel, text, text, uuid);
--   drop index if exists notification_opt_outs_phone_idx;
--   drop index if exists notification_opt_outs_contact_idx;
--   alter table public.notification_opt_outs drop constraint notification_opt_outs_identifies_someone;
--   -- ⚠️ Voltar `contact_id` a NOT NULL exige apagar as linhas que só têm
--   -- telefone — ou seja, exige apagar pedidos legítimos de "nao me mande
--   -- mais". Não faça isso sem pensar.
-- ----------------------------------------------------------------------------
