-- ============================================================================
-- Os públicos-alvo reais da APCS, mais o atalho "Toda a base"
-- ----------------------------------------------------------------------------
-- O catálogo nasceu com um público só (`all-members`), porque na etapa anterior
-- ninguém tinha dito quais eram os de verdade. Enquanto foi assim, a
-- segmentação ROTULAVA MAS NÃO SEPARAVA: todo evento alcançava todo mundo.
--
-- Agora são cinco públicos:
--
--     Associados · Empresas · Produtores · Universidades · Técnicos
--
-- mais o atalho "Toda a base", que é o `all-members` RENOMEADO. O slug não muda
-- — é exatamente para isso que ele é imutável: `name` é rótulo de tela e alguém
-- vai renomeá-lo; o slug é a chave que o resto do sistema segura.
--
-- ============================================================================
-- ⚠️ A DECISÃO CENTRAL — "TODA A BASE" É EXPANDIDO NA GRAVAÇÃO, NÃO NA LEITURA
-- ============================================================================
--
-- Marcar "Toda a base" grava vínculos com OS CINCO PÚBLICOS. O próprio
-- `all-members` NÃO é gravado.
--
--     seleção: [Toda a base]
--     gravado: [Associados, Empresas, Produtores, Universidades, Técnicos]
--
-- A alternativa seria gravar `all-members` e ensinar a leitura a tratá-lo como
-- "alcança todo mundo". Foi recusada, e o motivo é concreto: a regra de
-- elegibilidade (`matchesAnySegment`) NÃO TEM CASO ESPECIAL NENHUM hoje, e é
-- disso que vem a confiança nela. Um slug mágico obrigaria toda leitura futura —
-- chatbot, campanha, exportação, relatório — a conhecer a exceção. A primeira
-- que esquecesse mandaria comunicação para menos gente do que devia, em
-- silêncio.
--
-- Expandindo na gravação, o que fica no banco DIZ EXATAMENTE quem é alcançado.
-- A auditoria registra os cinco ids. Nenhum consumidor precisa saber que o
-- atalho existe.
--
-- O QUE ISSO CUSTA, dito na cara:
--
--   1. A seleção não volta como foi feita. Quem salvar com "Toda a base" e
--      reabrir a edição verá os CINCO marcados, não o atalho. É a informação
--      verdadeira (o evento alcança esses cinco públicos), mas não é o clique
--      que a pessoa deu.
--   2. A expansão é uma FOTOGRAFIA do momento. Se um sexto público entrar no
--      catálogo amanhã, os eventos salvos hoje continuam com cinco. Eventos
--      novos pegam os seis. Para um evento já cadastrado — muitas vezes já
--      divulgado —, congelar o público decidido é o comportamento certo.
--
-- A expansão vive no BANCO, não na tela: `create_event` e `update_event` são o
-- único caminho de escrita, e é lá que a garantia vale mesmo se alguém chamar a
-- API por fora.
-- ============================================================================

insert into public.event_segments (slug, name)
values
  ('associados',    'Associados'),
  ('empresas',      'Empresas'),
  ('produtores',    'Produtores'),
  ('universidades', 'Universidades'),
  ('tecnicos',      'Técnicos')
on conflict (slug) do nothing;

-- O CHECK `event_segments_slug_format` só aceita [a-z0-9-]: daí `tecnicos` sem
-- acento no slug e `Técnicos` com acento no nome de tela.

update public.event_segments
set name = 'Toda a base',
    description = 'Atalho: grava o evento para os cinco públicos de uma vez.',
    active = true
where slug = 'all-members';

-- ----------------------------------------------------------------------------
-- A expansão
-- ----------------------------------------------------------------------------
-- Troca o atalho pelos públicos ativos que ele representa. Selecionar o atalho
-- junto com públicos avulsos é inofensivo: `distinct` resolve a sobreposição.
--
-- ⚠️ Esta função NÃO VALIDA. Ela ignora id que não existe, e é por isso que
-- `assert_event_segments` roda ANTES dela nas duas funções de escrita — se
-- rodasse depois, um id inválido seria silenciosamente descartado aqui e a
-- validação passaria sobre uma lista já limpa.
create or replace function public.expand_event_segments(p_segment_ids uuid[])
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct id), '{}')
  from (
    -- o que foi escolhido, menos o atalho
    select s.id
    from public.event_segments s
    where s.id = any (p_segment_ids)
      and s.slug <> 'all-members'

    union

    -- e, se o atalho veio, todos os demais públicos ATIVOS
    select s.id
    from public.event_segments s
    where s.slug <> 'all-members'
      and s.active
      and exists (
        select 1
        from public.event_segments atalho
        where atalho.id = any (p_segment_ids)
          and atalho.slug = 'all-members'
      )
  ) z;
$$;

comment on function public.expand_event_segments(uuid[]) is
  'Troca o atalho "Toda a base" pelos públicos que ele representa. Não valida — ver assert_event_segments.';

revoke execute on function public.expand_event_segments(uuid[]) from public;
grant execute on function public.expand_event_segments(uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- create_event — agora expande antes de gravar os vínculos
-- ----------------------------------------------------------------------------
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

  -- Só aconteceria com o catálogo tendo apenas o atalho ativo. Sem isto, o
  -- evento nasceria sem público — alcançando ninguém, em silêncio.
  if array_length(v_segment_ids, 1) is null then
    raise exception 'Público-alvo inválido.' using errcode = 'EV002';
  end if;

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
  select v_event.id, s from unnest(v_segment_ids) as s;

  -- A auditoria registra os públicos EXPANDIDOS: é quem o evento alcança de
  -- verdade, e é isso que alguém vai querer saber daqui a um ano.
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
$$;

-- ----------------------------------------------------------------------------
-- update_event — mesma expansão, mesma ordem
-- ----------------------------------------------------------------------------
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

  -- Compara CONJUNTOS EXPANDIDOS dos dois lados. Sem isto, reabrir um evento
  -- salvo com o atalho e salvar de novo registraria "público alterado" numa
  -- edição que não mudou nada.
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
$$;

-- ----------------------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   -- 1. devolver os corpos de create_event e update_event da migration
--   --    20260813000200 (as versões sem expansão);
--   drop function if exists public.expand_event_segments(uuid[]);
--
--   update public.event_segments
--      set name = 'Todos os associados',
--          description = 'Eventos abertos a toda a base de associados da APCS.'
--    where slug = 'all-members';
--
--   update public.event_segments set active = false
--    where slug in ('associados','empresas','produtores','universidades','tecnicos');
--
-- Desativar, e não apagar: a FK de `event_segment_links` é `on delete restrict`
-- e a auditoria grava IDS de segmento — apagar a linha transformaria o histórico
-- de um evento num id órfão que ninguém mais traduz.
-- ----------------------------------------------------------------------------
