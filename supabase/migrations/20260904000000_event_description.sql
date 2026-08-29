-- ============================================================================
-- Eventos: descrição livre, e o fim do atalho "Toda a base"
-- ============================================================================
--
-- Duas mudanças pedidas juntas:
--
--   1. UMA DESCRIÇÃO. O evento tinha nome, local, data e horário — e nada que
--      dissesse o que ele É. Quem recebia a divulgação no WhatsApp lia
--      "Encontro Técnico e Comercial" e precisava adivinhar o resto. O texto
--      entra no cadastro e sai na mensagem, logo abaixo do nome.
--
--   2. O ATALHO "TODA A BASE" SAI DO CADASTRO. Ele gravava o evento para os
--      cinco públicos de uma vez, e estava confundindo quem cadastra: a seleção
--      não voltava como foi feita (reabrir a edição mostrava os cinco marcados,
--      não o atalho), e "Toda a base" ao lado de "Criadores" parecia mais um
--      público, não um atalho.
--
-- ----------------------------------------------------------------------------
-- ⚠️ ESTA MIGRATION TROCA A ASSINATURA DE `create_event` E `update_event`
-- ----------------------------------------------------------------------------
-- Um parâmetro novo não pode entrar por `create or replace`: o Postgres trataria
-- a função de 12 argumentos como uma SOBRECARGA da de 11, e a chamada por nome
-- que o aplicativo faz ficaria ambígua ("function is not unique"). Então as
-- antigas são derrubadas e recriadas.
--
-- ⚠️ CONSEQUÊNCIA PRÁTICA: entre rodar este SQL e subir o código novo, cadastrar
-- e editar evento FALHA — o código no ar chama a assinatura que acabou de
-- deixar de existir. É uma janela curta e só afeta essas duas telas; nada mais
-- do sistema usa estas funções. Rode e faça o deploy em seguida.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. A coluna
-- ----------------------------------------------------------------------------
-- ⚠️ NULA É PERMITIDA, e o evento antigo continua válido sem descrição. Um
-- `not null default ''` obrigaria a distinguir "sem descrição" de "descrição
-- vazia" em todo lugar que lê — e as duas são a mesma coisa aqui.
alter table public.events
  add column if not exists description text;

comment on column public.events.description is
  'Texto livre que descreve o evento. Sai na divulgacao de WhatsApp, logo abaixo do nome.';

-- 600 caracteres: a mensagem inteira precisa caber numa legenda de imagem do
-- WhatsApp (limite de 1024) junto com nome, data, horário, local e o aviso de
-- saída. Sem teto, uma descrição longa empurraria o "responda SAIR" para fora —
-- e é justamente a linha que não pode sumir.
do $constraint$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_description_len') then
    alter table public.events
      add constraint events_description_len
      check (description is null or char_length(description) <= 600);
  end if;
end
$constraint$;


-- ----------------------------------------------------------------------------
-- 2. O atalho sai do cadastro
-- ----------------------------------------------------------------------------
-- ⚠️ DESATIVADO, NÃO APAGADO — e a diferença importa. A FK de
-- `event_segment_links` é `on delete restrict`, e a auditoria de todo evento
-- antigo guarda IDS de segmento: apagar a linha transformaria o histórico num
-- id órfão que ninguém mais traduz.
--
-- Desativar basta para tirá-lo da tela E do servidor: `assert_event_segments`
-- exige `active`, então nem uma chamada direta à API consegue mais usá-lo.
--
-- Os eventos já cadastrados não mudam: o atalho nunca foi gravado como vínculo
-- (ver 20260813000300 — ele era EXPANDIDO nos cinco públicos na gravação).
update public.event_segments
set active = false
where slug = 'all-members';

-- `expand_event_segments` continua existindo e vira, na prática, um filtro de
-- duplicados. Não é removida de propósito: ela é chamada pelas duas funções
-- abaixo, e um evento antigo que ainda aponte para o atalho continua sendo
-- tratado corretamente se alguém reabrir a edição.


-- ----------------------------------------------------------------------------
-- 3. create_event — com descrição
-- ----------------------------------------------------------------------------
drop function if exists public.create_event(
  uuid, text, text, text, date, time, time, text, text, integer, uuid[]
);

create or replace function public.create_event(
  p_event_id uuid,
  p_name text,
  p_description text,
  p_location text,
  p_registration_url text,
  p_event_date date,
  p_start_time time,
  p_end_time time,
  p_image_path text,
  p_image_mime text,
  p_image_size_bytes integer,
  p_segment_ids uuid[]
)
returns public.events
language plpgsql
set search_path = ''
as $fn$
declare
  v_event public.events;
  v_segment_ids uuid[];
begin
  if public.current_app_role() not in ('admin', 'ceo') then
    raise exception 'Sem permissão para criar eventos.' using errcode = '42501';
  end if;

  if p_event_date < public.event_today() then
    raise exception 'Não é possível cadastrar um evento com data anterior à data atual.'
      using errcode = 'EV003';
  end if;

  -- Valida o que a pessoa escolheu; só depois expande. A ordem é a defesa
  -- contra id inválido sumir na expansão.
  perform public.assert_event_segments(p_segment_ids);
  v_segment_ids := public.expand_event_segments(p_segment_ids);

  if array_length(v_segment_ids, 1) is null then
    raise exception 'Público-alvo inválido.' using errcode = 'EV002';
  end if;

  insert into public.events (
    id, name, description, location, registration_url, event_date, start_time, end_time,
    image_path, image_mime, image_size_bytes
  )
  values (
    p_event_id, p_name, nullif(btrim(p_description), ''), p_location,
    nullif(btrim(p_registration_url), ''),
    p_event_date, p_start_time, p_end_time,
    p_image_path, p_image_mime, p_image_size_bytes
  )
  returning * into v_event;

  insert into public.event_segment_links (event_id, segment_id)
  select v_event.id, s from unnest(v_segment_ids) as s;

  insert into public.event_audit_logs (event_id, action, metadata)
  values (
    v_event.id,
    'event_created',
    jsonb_build_object(
      'name', v_event.name,
      'eventDate', v_event.event_date,
      'segmentIds', to_jsonb(v_segment_ids)
    )
  ),
  (
    v_event.id,
    'event_image_uploaded',
    jsonb_build_object('mime', v_event.image_mime, 'sizeBytes', v_event.image_size_bytes)
  );

  return v_event;
end;
$fn$;


-- ----------------------------------------------------------------------------
-- 4. update_event — com descrição, e a descrição na trilha
-- ----------------------------------------------------------------------------
drop function if exists public.update_event(
  uuid, text, text, text, date, time, time, text, text, integer, uuid[]
);

create or replace function public.update_event(
  p_event_id uuid,
  p_name text,
  p_description text,
  p_location text,
  p_registration_url text,
  p_event_date date,
  p_start_time time,
  p_end_time time,
  p_image_path text,
  p_image_mime text,
  p_image_size_bytes integer,
  p_segment_ids uuid[]
)
returns public.events
language plpgsql
set search_path = ''
as $fn$
declare
  v_old public.events;
  v_new public.events;
  v_changes jsonb := '[]'::jsonb;
  v_old_segments uuid[];
  v_new_segments uuid[];
  v_url text := nullif(btrim(p_registration_url), '');
  v_description text := nullif(btrim(p_description), '');
begin
  perform public.lock_event(p_event_id);

  select * into v_old from public.events where id = p_event_id;
  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  if p_event_date <> v_old.event_date and p_event_date < public.event_today() then
    raise exception 'Não é possível cadastrar um evento com data anterior à data atual.'
      using errcode = 'EV003';
  end if;

  perform public.assert_event_segments(p_segment_ids);

  update public.events
  set name = p_name,
      description = v_description,
      location = p_location,
      registration_url = v_url,
      event_date = p_event_date,
      start_time = p_start_time,
      end_time = p_end_time,
      image_path = coalesce(p_image_path, v_old.image_path),
      image_mime = coalesce(p_image_mime, v_old.image_mime),
      image_size_bytes = coalesce(p_image_size_bytes, v_old.image_size_bytes),
      updated_by = auth.uid()
  where id = p_event_id
  returning * into v_new;

  if v_old.name is distinct from v_new.name then
    v_changes := v_changes || jsonb_build_object('field', 'name', 'from', v_old.name, 'to', v_new.name);
  end if;
  -- ⚠️ A DESCRIÇÃO ENTRA NA TRILHA COMO OS OUTROS CAMPOS. Ela é o texto que sai
  -- para milhares de pessoas no WhatsApp — saber quem o mudou e quando vale
  -- tanto quanto saber quem mudou a data.
  if v_old.description is distinct from v_new.description then
    v_changes := v_changes || jsonb_build_object('field', 'description', 'from', v_old.description, 'to', v_new.description);
  end if;
  if v_old.location is distinct from v_new.location then
    v_changes := v_changes || jsonb_build_object('field', 'location', 'from', v_old.location, 'to', v_new.location);
  end if;
  if v_old.registration_url is distinct from v_new.registration_url then
    v_changes := v_changes || jsonb_build_object('field', 'registrationUrl', 'from', v_old.registration_url, 'to', v_new.registration_url);
  end if;
  if v_old.event_date is distinct from v_new.event_date then
    v_changes := v_changes || jsonb_build_object('field', 'eventDate', 'from', v_old.event_date, 'to', v_new.event_date);
  end if;
  if v_old.start_time is distinct from v_new.start_time then
    v_changes := v_changes || jsonb_build_object('field', 'startTime', 'from', v_old.start_time, 'to', v_new.start_time);
  end if;
  if v_old.end_time is distinct from v_new.end_time then
    v_changes := v_changes || jsonb_build_object('field', 'endTime', 'from', v_old.end_time, 'to', v_new.end_time);
  end if;

  if jsonb_array_length(v_changes) > 0 then
    insert into public.event_audit_logs (event_id, action, metadata)
    values (p_event_id, 'event_updated', jsonb_build_object('changes', v_changes));
  end if;

  if v_old.image_path is distinct from v_new.image_path then
    insert into public.event_audit_logs (event_id, action, metadata)
    values (
      p_event_id,
      'event_image_replaced',
      jsonb_build_object('from', v_old.image_path, 'to', v_new.image_path)
    );
  end if;

  select coalesce(array_agg(segment_id order by segment_id), '{}')
    into v_old_segments
  from public.event_segment_links
  where event_id = p_event_id;

  select coalesce(array_agg(distinct s order by s), '{}')
    into v_new_segments
  from unnest(public.expand_event_segments(p_segment_ids)) as s;

  if array_length(v_new_segments, 1) is null then
    raise exception 'Público-alvo inválido.' using errcode = 'EV002';
  end if;

  if v_old_segments is distinct from v_new_segments then
    delete from public.event_segment_links where event_id = p_event_id;

    insert into public.event_segment_links (event_id, segment_id)
    select p_event_id, s from unnest(v_new_segments) as s;

    insert into public.event_audit_logs (event_id, action, metadata)
    values (
      p_event_id,
      'event_segments_updated',
      jsonb_build_object('from', to_jsonb(v_old_segments), 'to', to_jsonb(v_new_segments))
    );
  end if;

  return v_new;
end;
$fn$;


-- ----------------------------------------------------------------------------
-- 5. Privilégios
-- ----------------------------------------------------------------------------
-- ⚠️ `DROP FUNCTION` LEVA OS PRIVILÉGIOS JUNTO, e o que a função recriada ganha
-- de volta é o `alter default privileges` do Supabase — que concede EXECUTE a
-- `anon` em toda função nova de `public`.
--
-- As duas originais viviam com esse padrão. Ele nunca abriu nada de fato: elas
-- NÃO são `security definer`, então um anônimo que as chamasse esbarraria na RLS
-- de `events` no `insert`. Mas a guarda de papel dentro delas é
-- `current_app_role() not in ('admin','ceo')`, e para um anônimo isso é
-- `null not in (...)` — que é NULL, e não dispara o `raise`. Ou seja: a única
-- coisa entre o anônimo e a tabela era a RLS, sozinha.
--
-- Revogar aqui é fechar a porta antes do corredor, e é o mesmo que as migrations
-- de divulgação e de WhatsApp já fazem.
revoke execute on function public.create_event(
  uuid, text, text, text, text, date, time, time, text, text, integer, uuid[]
) from public, anon;
grant execute on function public.create_event(
  uuid, text, text, text, text, date, time, time, text, text, integer, uuid[]
) to authenticated;

revoke execute on function public.update_event(
  uuid, text, text, text, text, date, time, time, text, text, integer, uuid[]
) from public, anon;
grant execute on function public.update_event(
  uuid, text, text, text, text, date, time, time, text, text, integer, uuid[]
) to authenticated;


-- ============================================================================
-- Para desfazer:
--   1. devolver os corpos de create_event e update_event de
--      20260813000300_seed_event_audience_segments.sql (as versões de 11
--      argumentos), derrubando antes as de 12;
--   2. update public.event_segments set active = true where slug = 'all-members';
--   3. alter table public.events drop constraint if exists events_description_len;
--      alter table public.events drop column if exists description;
-- ============================================================================
