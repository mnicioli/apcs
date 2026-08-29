-- ============================================================================
-- Voltar a receber — o caminho de volta do opt-out
-- ----------------------------------------------------------------------------
-- Fecha o buraco que 20260820000100_survey_messaging.sql deixou ANOTADO, e nos
-- termos em que ele mesmo pediu:
--
--   "SEM policy de DELETE, e isto é deliberado. Apagar um opt-out é 'voltar a
--    mandar mensagem para quem pediu para parar'. Se um dia houver um caminho
--    legítimo (a própria pessoa pedindo para voltar), ele será uma função com
--    trilha, e não um DELETE que não deixa rastro."
--
-- O caso real que faltava: a pessoa respondeu SAIR, mudou de ideia, e avisa a
-- APCS por telefone, no evento, ou pessoalmente. Até aqui a única saída era
-- alguém abrir o banco e apagar a linha à mão — sem registro de quem mandou,
-- sem registro de quem autorizou.
--
-- ----------------------------------------------------------------------------
-- ⚠️ AS QUATRO DECISÕES
-- ----------------------------------------------------------------------------
--
-- 1. NÃO APAGA: MARCA. `revoked_at`, `revoked_by` e `revoked_note` entram na
--    linha, e ela fica. O DELETE devolveria o mesmo estado do banco e destruiria
--    a única prova de que a pessoa um dia pediu para sair — e é justamente essa
--    prova que a APCS precisa ter se alguém reclamar de ter voltado a receber.
--
-- 2. EXIGE DIZER QUEM PEDIU. `revoked_note` é obrigatória (MA008), e não é
--    burocracia: reativar é a APCS voltar a mandar mensagem para quem tinha
--    mandado parar. O que torna isso legítimo é a pessoa ter pedido — e o que
--    prova que ela pediu é alguém ter escrito onde e quando. Sem a nota, a
--    trilha registra o ato e não registra a autorização, que é a metade que
--    importa.
--
-- 3. UM SAIR DEPOIS DE UMA REATIVAÇÃO BLOQUEIA DE NOVO. As duas funções de
--    registro (`register_notification_opt_out` e `register_survey_opt_out`)
--    tinham `on conflict DO NOTHING`: com a linha revogada ainda lá, o segundo
--    SAIR bateria no conflito, não faria nada, e a pessoa continuaria
--    recebendo. Isto seria uma reencenação exata do bug que
--    20260829020659_global_optout_by_phone.sql veio consertar — por isso as
--    duas passam a LIMPAR a revogação no conflito.
--
-- 4. TODO MUNDO QUE LÊ A TABELA PRECISA IGNORAR AS REVOGADAS. São cinco
--    funções, e elas estão todas recriadas abaixo. Deixar uma de fora não daria
--    erro nenhum: daria uma pessoa reativada que volta a receber evento e não
--    volta a receber enquete, ou o contrário — o tipo de diferença que ninguém
--    percebe até alguém perguntar por quê.
--
-- ----------------------------------------------------------------------------
-- CÓDIGOS DE ERRO
--   42501  sem permissão
--   P0002  associado não encontrado
--   MA008  é preciso registrar quem pediu para voltar a receber
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. As colunas da revogação
-- ----------------------------------------------------------------------------
alter table public.notification_opt_outs
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.profiles on delete set null,
  add column if not exists revoked_note text;

comment on column public.notification_opt_outs.revoked_at is
  'Quando o bloqueio foi desfeito a pedido da propria pessoa. Nulo = bloqueio VALENDO. A linha nunca e apagada.';
comment on column public.notification_opt_outs.revoked_note is
  'Quem pediu para voltar a receber, e por onde. E o registro da autorizacao — sem ela a reativacao nao acontece.';

do $guard$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notification_opt_outs_revoked_note_len'
  ) then
    alter table public.notification_opt_outs
      add constraint notification_opt_outs_revoked_note_len
      check (revoked_note is null or char_length(revoked_note) between 5 and 300);
  end if;

  -- Uma linha revogada sem nota seria um bloqueio desfeito por ninguém: o
  -- estado que a decisão 2 existe para impedir. O CHECK garante que nem uma
  -- escrita direta no banco consiga produzi-lo.
  if not exists (
    select 1 from pg_constraint where conname = 'notification_opt_outs_revoked_has_note'
  ) then
    alter table public.notification_opt_outs
      add constraint notification_opt_outs_revoked_has_note
      check (revoked_at is null or revoked_note is not null);
  end if;
end
$guard$;

-- ----------------------------------------------------------------------------
-- 2. Quem lê a tabela passa a ignorar as revogadas
-- ----------------------------------------------------------------------------
-- ⚠️ A LINHA CONTINUA ÚNICA POR TELEFONE. Os índices de unicidade NÃO mudam:
-- uma linha por (telefone, canal), revogada ou não, e o histórico dos ciclos
-- mora em `membership_audit_logs`, que é append-only. Índices parciais em
-- `revoked_at is null` dariam várias linhas por telefone e obrigariam toda
-- consulta a escolher a certa — mais peças para o mesmo resultado.

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
    where o.revoked_at is null
      and (
        o.phone_key = public.notification_phone_key(p_phone)
        or public.notification_phone_key(c.phone) = public.notification_phone_key(p_phone)
      )
  );
$fn$;

comment on function public.is_notification_blocked(text) is
  'Este telefone pediu para nao receber E nao voltou atras? Confere por telefone e, para as linhas antigas, pelo contato.';

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
    return query select false, null::timestamptz, null::text;
    return;
  end if;

  return query
  select true, o.created_at, o.source
  from public.notification_opt_outs o
  left join public.chat_contacts c on c.id = o.contact_id
  where o.revoked_at is null
    and (
      o.phone_key = public.notification_phone_key(v_phone)
      or public.notification_phone_key(c.phone) = public.notification_phone_key(v_phone)
    )
  order by o.created_at asc
  limit 1;

  if not found then
    return query select false, null::timestamptz, null::text;
  end if;
end;
$fn$;

-- §32/§33 do módulo de Enquetes. Bloqueia antes do envio — e agora só quem
-- ainda está bloqueado.
create or replace function public.block_opted_out_recipients(p_survey_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  update public.survey_recipients r
  set status = 'error',
      last_error = 'Contato optou por não receber mensagens desta campanha.'
  where r.survey_id = p_survey_id
    and r.status in ('pending', 'sending')
    and exists (
      select 1
      from public.notification_opt_outs o
      where o.contact_id = r.contact_id
        and o.revoked_at is null
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

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
      select 1
      from public.notification_opt_outs o
      where o.contact_id = r.contact_id
        and o.revoked_at is null
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- 3. Registrar opt-out volta a bloquear quem havia sido reativado
-- ----------------------------------------------------------------------------
-- ⚠️ ESTA É A PARTE QUE NÃO PODE FALHAR (decisão 3). Sem o `do update` que
-- limpa a revogação, um SAIR vindo de alguém já reativado seria engolido pelo
-- `do nothing` — e a pessoa continuaria recebendo depois de pedir para parar
-- pela segunda vez.
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
    contact_id = coalesce(public.notification_opt_outs.contact_id, excluded.contact_id),
    -- O bloqueio volta a valer.
    revoked_at = null,
    revoked_by = null,
    revoked_note = null,
    -- ⚠️ A DATA SÓ ANDA QUANDO HOUVE REATIVAÇÃO NO MEIO. Um SAIR repetido de
    -- quem nunca foi reativado (a pessoa manda de novo porque a primeira não
    -- pareceu funcionar) preserva a data do PRIMEIRO pedido, que é a data que
    -- importa. Depois de uma reativação, porém, a data antiga é anterior ao
    -- "volte a me mandar" — mostrá-la na ficha faria parecer que a reativação
    -- não pegou.
    created_at = case
      when public.notification_opt_outs.revoked_at is not null then now()
      else public.notification_opt_outs.created_at
    end,
    source = case
      when public.notification_opt_outs.revoked_at is not null then excluded.source
      else public.notification_opt_outs.source
    end
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.register_notification_opt_out(text, public.survey_channel, text, text, uuid) is
  'Registra "nao me mande mais" pelo TELEFONE. Idempotente, e volta a bloquear quem havia sido reativado.';

-- O mesmo cuidado no caminho das Enquetes, que registra por contato.
--
-- ⚠️ E DE QUEBRA CONSERTA UM ERRO QUE ESTAVA ARMADO AQUI. Esta função ainda
-- dizia `on conflict (contact_id, channel)`, sem WHERE — o que casava com o
-- índice TOTAL que existia quando ela foi escrita. A migration
-- 20260829020659_global_optout_by_phone.sql derrubou aquele índice e criou um
-- PARCIAL (`where contact_id is not null`), e o Postgres não aceita um
-- `on conflict` sem WHERE contra índice parcial: a chamada morre com "there is
-- no unique or exclusion constraint matching the ON CONFLICT specification".
-- Ou seja, desde aquela migration um SAIR repetido vindo de uma conversa de
-- ENQUETE levantava exceção. O WHERE abaixo é o conserto.
create or replace function public.register_survey_opt_out(
  p_contact_id uuid,
  p_channel public.survey_channel,
  p_source text default 'chatbot',
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  insert into public.notification_opt_outs (contact_id, channel, source, note)
  values (p_contact_id, p_channel, p_source, left(nullif(btrim(p_note), ''), 300))
  on conflict (contact_id, channel) where contact_id is not null
  do update set
    revoked_at = null,
    revoked_by = null,
    revoked_note = null,
    created_at = case
      when public.notification_opt_outs.revoked_at is not null then now()
      else public.notification_opt_outs.created_at
    end
  returning id into v_id;

  -- §38/§39. Quem pediu para sair não continua com perguntas em aberto.
  update public.survey_conversation_states
  set status = 'released',
      cleared_at = now(),
      cleared_reason = 'opt_out'
  where contact_id = p_contact_id
    and channel = p_channel
    and status = 'awaiting_reply';

  return v_id is not null;
end;
$fn$;

comment on function public.register_survey_opt_out(uuid, public.survey_channel, text, text) is
  'Registra o SAIR vindo de uma conversa de enquete. Volta a bloquear quem havia sido reativado.';

-- ----------------------------------------------------------------------------
-- 4. A reativação
-- ----------------------------------------------------------------------------
-- ⚠️ RECEBE O ASSOCIADO, NÃO O TELEFONE. Uma função que aceitasse telefone solto
-- seria uma porta para liberar QUALQUER número, inclusive um que não está no
-- cadastro — e quem a chamasse não precisaria nem saber de quem é. Passando pelo
-- associado, a autorização fica presa a uma pessoa identificada, e a trilha tem
-- onde ser gravada.
--
-- ⚠️ LIBERA O TELEFONE, E ISSO PODE ALCANÇAR MAIS DE UM ASSOCIADO. O bloqueio é
-- do número (marido e mulher na mesma granja, um telefone de escritório), então
-- reativar um reativa todos os que compartilham o aparelho. É o comportamento
-- correto — o pedido veio de quem atende aquele número — e a função devolve
-- quantas linhas mexeu para a tela poder dizer isso.
create or replace function public.resume_member_notifications(
  p_member_id uuid,
  p_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_phone text;
  v_key text;
  v_count integer;
begin
  if not public.membership_is_writer() then
    raise exception 'Sem permissao para alterar notificacoes de associados.' using errcode = '42501';
  end if;

  if v_note is null or char_length(v_note) < 5 then
    raise exception 'Registre quem pediu para voltar a receber.' using errcode = 'MA008';
  end if;

  select m.whatsapp into v_phone from public.members m where m.id = p_member_id;
  if not found then
    raise exception 'Associado nao encontrado.' using errcode = 'P0002';
  end if;

  v_key := public.notification_phone_key(coalesce(v_phone, ''));
  if v_key = '' then
    -- Sem telefone não há bloqueio a desfazer. Zero, e não erro: a resposta
    -- honesta é "não havia nada aqui", e a tela nem oferece o botão nesse caso.
    return 0;
  end if;

  update public.notification_opt_outs o
  set revoked_at = now(),
      revoked_by = (select auth.uid()),
      revoked_note = left(v_note, 300)
  where o.revoked_at is null
    and (
      o.phone_key = v_key
      or exists (
        select 1 from public.chat_contacts c
        where c.id = o.contact_id
          and public.notification_phone_key(c.phone) = v_key
      )
    );

  get diagnostics v_count = row_count;

  -- ⚠️ A TRILHA GUARDA A NOTA, e aqui isso é o oposto do que `update_member`
  -- decidiu. Lá a nota seria uma segunda cópia do cadastro; aqui ela É a
  -- autorização — o registro de que a pessoa pediu para voltar. Sem ela, a
  -- linha do histórico diria que alguém religou as mensagens e não diria por
  -- quê, que é exatamente a pergunta que vai ser feita.
  if v_count > 0 then
    insert into public.membership_audit_logs (member_id, action, actor_id, actor_name, metadata)
    values (
      p_member_id,
      'member_notifications_resumed',
      (select auth.uid()),
      public.current_actor_name(),
      jsonb_build_object('note', left(v_note, 300), 'unblocked', v_count)
    );
  end if;

  return v_count;
end;
$fn$;

comment on function public.resume_member_notifications(uuid, text) is
  'Desfaz o opt-out do telefone de um associado, a pedido dele. Exige registrar quem pediu. Nao apaga a linha: marca revoked_at.';

-- ----------------------------------------------------------------------------
-- 5. EXECUTE
-- ----------------------------------------------------------------------------
revoke execute on function public.resume_member_notifications(uuid, text) from public, anon;
grant execute on function public.resume_member_notifications(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Como desfazer
-- ----------------------------------------------------------------------------
--   drop function if exists public.resume_member_notifications(uuid, text);
--   alter table public.notification_opt_outs
--     drop constraint if exists notification_opt_outs_revoked_has_note,
--     drop constraint if exists notification_opt_outs_revoked_note_len;
--   -- ⚠️ Antes de derrubar as colunas, note que as linhas revogadas voltariam a
--   -- BLOQUEAR: quem foi reativado pararia de receber outra vez, sem aviso.
--   alter table public.notification_opt_outs
--     drop column if exists revoked_at,
--     drop column if exists revoked_by,
--     drop column if exists revoked_note;
-- ----------------------------------------------------------------------------
