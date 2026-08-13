-- ============================================================================
-- Corrige os SQLSTATE das funções de evento
-- ----------------------------------------------------------------------------
-- A migration 20260813000000 escolheu P0003, P0004 e P0005 para as três regras
-- de negócio do módulo. Foi um erro, descoberto ao verificar as funções contra
-- o banco: A CLASSE `P0` É RESERVADA PELO PL/pgSQL.
--
--   P0001  raise_exception
--   P0002  no_data_found
--   P0003  too_many_rows      ← usado por engano para "evento expirado"
--   P0004  assert_failure     ← usado por engano para "público inválido"
--
-- O caso grave é o P0004. `exception when others` NÃO captura `assert_failure`
-- (nem `query_canceled`) — é uma exclusão documentada do PL/pgSQL. Na prática,
-- "Público-alvo inválido." atravessava qualquer bloco de tratamento e derrubava
-- a transação inteira, em vez de virar uma mensagem para quem está preenchendo
-- o formulário. Isso foi observado, não deduzido.
--
-- A correção usa a classe `EV`, que não é usada pelo Postgres nem pelo padrão
-- SQL (as classes ocupadas são 00-0Z, 20-2F, 34-3F, 40-58, 72, F0, HV, P0, XX):
--
--   EV001  evento expirado — não pode ser ativado
--   EV002  público-alvo inexistente, inativo ou lista vazia
--   EV003  data anterior a hoje
--
-- `P0002` (no_data_found) continua para "não encontrado": é o significado real
-- do código, é capturável, e já está mapeado em src/lib/actions/errors.ts.
--
-- Migration aditiva, e não uma edição da anterior: o histórico de migrations é
-- um log append-only. As três funções são `create or replace`, então trocar o
-- corpo é a operação certa — nenhuma tabela, dado ou permissão é tocado.
-- ============================================================================

create or replace function public.assert_event_segments(p_segment_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_found integer;
begin
  if p_segment_ids is null or array_length(p_segment_ids, 1) is null then
    raise exception 'Selecione ao menos um público-alvo.' using errcode = 'EV002';
  end if;

  select count(*) into v_found
  from public.event_segments
  where id = any (p_segment_ids) and active;

  if v_found <> (select count(distinct s) from unnest(p_segment_ids) as s) then
    raise exception 'Público-alvo inválido.' using errcode = 'EV002';
  end if;
end;
$$;

create or replace function public.create_event(
  p_event_id uuid,
  p_name text,
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
as $$
declare
  v_event public.events;
begin
  if public.current_app_role() not in ('admin', 'ceo') then
    raise exception 'Sem permissão para criar eventos.' using errcode = '42501';
  end if;

  if p_event_date < public.event_today() then
    raise exception 'Não é possível cadastrar um evento com data anterior à data atual.'
      using errcode = 'EV003';
  end if;

  perform public.assert_event_segments(p_segment_ids);

  insert into public.events (
    id, name, location, registration_url, event_date, start_time, end_time,
    image_path, image_mime, image_size_bytes
  )
  values (
    p_event_id, p_name, p_location, nullif(btrim(p_registration_url), ''),
    p_event_date, p_start_time, p_end_time,
    p_image_path, p_image_mime, p_image_size_bytes
  )
  returning * into v_event;

  insert into public.event_segment_links (event_id, segment_id)
  select v_event.id, s
  from (select distinct unnest(p_segment_ids) as s) as ids;

  insert into public.event_audit_logs (event_id, action, metadata)
  values (
    v_event.id,
    'event_created',
    jsonb_build_object(
      'name', v_event.name,
      'eventDate', v_event.event_date,
      'segmentIds', to_jsonb(p_segment_ids)
    )
  ),
  (
    v_event.id,
    'event_image_uploaded',
    jsonb_build_object('mime', v_event.image_mime, 'sizeBytes', v_event.image_size_bytes)
  );

  return v_event;
end;
$$;

create or replace function public.update_event(
  p_event_id uuid,
  p_name text,
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
as $$
declare
  v_old public.events;
  v_new public.events;
  v_changes jsonb := '[]'::jsonb;
  v_old_segments uuid[];
  v_new_segments uuid[];
  v_url text := nullif(btrim(p_registration_url), '');
begin
  perform public.lock_event(p_event_id);

  select * into v_old from public.events where id = p_event_id;
  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- Mover a data para o passado é recusado; MANTER uma data que já passou não.
  -- Sem essa distinção, um evento expirado ficaria impossível de editar — nem
  -- para corrigir o local no registro, nem para remarcá-lo.
  if p_event_date <> v_old.event_date and p_event_date < public.event_today() then
    raise exception 'Não é possível cadastrar um evento com data anterior à data atual.'
      using errcode = 'EV003';
  end if;

  perform public.assert_event_segments(p_segment_ids);

  update public.events
  set name = p_name,
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

  -- `is distinct from` e não `<>`: com NULL de um dos lados, `<>` devolve NULL
  -- e a mudança passaria despercebida.
  if v_old.name is distinct from v_new.name then
    v_changes := v_changes || jsonb_build_object('field', 'name', 'from', v_old.name, 'to', v_new.name);
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
  from unnest(p_segment_ids) as s;

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
$$;

create or replace function public.set_event_status(
  p_event_id uuid,
  p_command text
)
returns public.events
language plpgsql
set search_path = ''
as $$
declare
  v_old public.events;
  v_new public.events;
begin
  perform public.lock_event(p_event_id);

  if p_command not in ('activate', 'deactivate') then
    raise exception 'Comando inválido.' using errcode = '22023';
  end if;

  select * into v_old from public.events where id = p_event_id;
  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- Sem esta checagem a expiração derivada teria um furo: bastaria mandar
  -- `activate` num evento de ontem para ele voltar a contar como ativo na
  -- consulta do chatbot.
  if p_command = 'activate' and v_old.event_date < public.event_today() then
    raise exception 'Não é possível ativar um evento cuja data já passou.'
      using errcode = 'EV001';
  end if;

  update public.events
  set status = (case when p_command = 'activate' then 'active' else 'inactive' end)::public.event_status,
      updated_by = auth.uid()
  where id = p_event_id
  returning * into v_new;

  insert into public.event_audit_logs (event_id, action, metadata)
  values (
    p_event_id,
    (case when p_command = 'activate' then 'event_activated' else 'event_deactivated' end)::public.event_audit_action,
    jsonb_build_object(
      'from', v_old.status,
      'to', v_new.status,
      'reason', case when p_command = 'activate' then null else 'manual' end,
      'eventDate', v_new.event_date
    )
  );

  return v_new;
end;
$$;

-- ----------------------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- Reaplicar os corpos da migration 20260813000000. Não recomendado: eles têm o
-- defeito descrito no cabeçalho.
-- ----------------------------------------------------------------------------
