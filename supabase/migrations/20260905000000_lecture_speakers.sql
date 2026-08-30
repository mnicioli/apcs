-- ============================================================================
-- PALESTRANTES: um CATÁLOGO DE NOMES ao lado do diretório interno
-- ============================================================================
-- Fecha o GAP registrado em 20260816000000_create_lectures.sql, na coluna
-- `speaker_id`:
--
--   "GAP registrado: palestrante EXTERNO (especialista convidado sem conta
--    no CRM) não tem onde ser cadastrado hoje."
--
-- Era um gap de verdade: quem palestra para a APCS é veterinário, consultor,
-- técnico de cooperativa — gente que não tem (nem vai ter) login no cockpit. O
-- seletor oferecia só os usuários da plataforma, então o campo ficava vazio na
-- maioria das palestras e o nome de quem apresentou virava observação em texto
-- livre: invisível para o filtro e para o alerta de conflito.
--
-- ⚠️ A DECISÃO CENTRAL: o catálogo NÃO substitui `speaker_id`, ele CONVIVE.
-- Um palestrante que é do time continua sendo uma linha de `profiles` — é isso
-- que faz "as palestras da Ana" continuar certo quando ela troca de sobrenome, e
-- é o que a trilha já grava. O catálogo cobre exatamente quem não tem perfil.
-- Duas colunas, um CHECK garantindo que só uma esteja preenchida, e a regra que
-- as duas juntas expressam: uma palestra tem UM palestrante.
--
-- A alternativa — migrar todo mundo para o catálogo, criando linhas espelho para
-- os usuários internos — deixaria duas representações da mesma pessoa e a
-- pergunta "a Ana do catálogo e a Ana do perfil são a mesma?" sem resposta.
--
-- DEPENDE DE: 20260816000000_create_lectures.sql

-- ----------------------------------------------------------------------------
-- 1. A chave de comparação de nomes
-- ----------------------------------------------------------------------------
-- "João Silva", "joao silva" e "JOÃO SILVA" são a MESMA pessoa. Sem normalizar,
-- o catálogo acumularia três linhas para ela e o seletor mostraria as três — que
-- é justamente o defeito que um catálogo existe para evitar.
--
-- ⚠️ `translate` e não `unaccent`: este banco não tem a extensão (conferido na
-- migration de Palestras), e `unaccent` não é IMMUTABLE, então não serviria numa
-- coluna gerada de qualquer forma. Mesma tabela de tradução de
-- `lectures.search_text` e de `normalizeForSearch` (src/lib/utils.ts) — as três
-- precisam concordar.
--
-- ⚠️ MUDAR ESTA FUNÇÃO EXIGE RECONSTRUIR `lecture_speakers.name_key`: ela é
-- usada numa coluna gerada, e o Postgres não recalcula as linhas antigas.
create or replace function public.speaker_name_key(p_name text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select translate(
    lower(btrim(p_name)),
    'áàâãäåéèêëíìîïóòôõöúùûüçñ',
    'aaaaaaeeeeiiiiooooouuuucn'
  );
$$;

comment on function public.speaker_name_key is
  'Chave de comparação de nome de palestrante: minúsculas, sem acento, sem espaço nas pontas.';

-- ----------------------------------------------------------------------------
-- 2. O catálogo
-- ----------------------------------------------------------------------------
create table if not exists public.lecture_speakers (
  id uuid primary key default gen_random_uuid(),

  -- O nome COMO FOI DIGITADO da primeira vez — é ele que aparece na tela.
  name text not null,

  -- A chave de deduplicação. Gerada: ninguém a escreve, ninguém a corrige.
  name_key text generated always as (public.speaker_name_key(name)) stored,

  -- Para tirar da lista quem não palestra mais SEM apagar as palestras dele.
  -- Não há tela para isso ainda; a coluna existe porque `delete` nunca vai ser a
  -- resposta certa aqui (ver o `on delete restrict` da seção 3).
  active boolean not null default true,

  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),

  constraint lecture_speakers_name_len
    check (btrim(name) <> '' and length(name) <= 160)
);

-- ⚠️ ÍNDICE ÚNICO, e não um `unique` decorativo: é ele que o `on conflict` da
-- seção 4 infere, e é ele que impede duas linhas para o mesmo nome quando duas
-- pessoas cadastram a mesma palestrante ao mesmo tempo. Um "procura, e se não
-- achar insere" sem esta garantia perde essa corrida em silêncio.
create unique index if not exists lecture_speakers_key_idx
  on public.lecture_speakers (name_key);

-- A lista do seletor: ativos, em ordem alfabética.
create index if not exists lecture_speakers_active_idx
  on public.lecture_speakers (name) where active;

comment on table public.lecture_speakers is
  'Catálogo de palestrantes SEM conta no cockpit. Complementa lectures.speaker_id, não o substitui.';

-- ----------------------------------------------------------------------------
-- 3. A coluna na palestra
-- ----------------------------------------------------------------------------
-- ⚠️ `on delete restrict`, e NÃO o `set null` que `speaker_id` usa. São casos
-- diferentes: um perfil é apagado quando a PESSOA sai da empresa, e a palestra
-- sobrevive à saída dela. Uma linha do catálogo só existe porque alguém digitou
-- aquele nome; apagá-la enquanto há palestra apontando para lá apagaria o nome
-- de quem apresentou — sem trilha, sem aviso e sem como recuperar.
alter table public.lectures
  add column if not exists speaker_catalog_id uuid
    references public.lecture_speakers on delete restrict;

comment on column public.lectures.speaker_catalog_id is
  'Palestrante externo (catálogo). Exclusivo com speaker_id — ver lectures_single_speaker.';

do $bloco$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lectures_single_speaker'
  ) then
    alter table public.lectures
      add constraint lectures_single_speaker
      check (speaker_id is null or speaker_catalog_id is null);
  end if;
end;
$bloco$;

-- Índice pelo mesmo motivo de `lectures_speaker_idx`: o filtro "palestras de
-- fulano" vira SQL, não `.filter()` em memória.
create index if not exists lectures_speaker_catalog_idx
  on public.lectures (speaker_catalog_id) where speaker_catalog_id is not null;

-- ----------------------------------------------------------------------------
-- 4. Resolver um nome em uma linha do catálogo
-- ----------------------------------------------------------------------------
-- Devolve o id da linha para `p_name`, criando-a se for a primeira vez. É isto
-- que faz o "Outro" do formulário virar uma opção do seletor na próxima
-- palestra, sem tela de cadastro de palestrante e sem um passo a mais para quem
-- só quer marcar uma palestra.
--
-- SECURITY INVOKER (como todo o resto do módulo): quem não pode inserir na
-- tabela não passa a poder por chamar isto.
create or replace function public.resolve_lecture_speaker(p_name text)
returns uuid
language plpgsql
set search_path = ''
as $funcao$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if v_name = '' then
    return null;
  end if;

  -- ⚠️ O `insert` VEM PRIMEIRO, e não depois de um `select` que não achou nada.
  -- Com o select antes, duas sessões cadastrando "Dr. Marcelo" ao mesmo tempo
  -- passariam as duas pelo "não existe" e a segunda estouraria com violação de
  -- unicidade — um erro genérico na cara de quem só digitou um nome. Assim a
  -- segunda cai no `do nothing` e lê a linha que a primeira criou.
  insert into public.lecture_speakers (name)
  values (v_name)
  on conflict (name_key) do nothing;

  select s.id into v_id
  from public.lecture_speakers s
  where s.name_key = public.speaker_name_key(v_name);

  -- Nome já cadastrado e depois desativado volta para a lista: quem acabou de
  -- digitá-lo está dizendo que a pessoa palestra de novo.
  update public.lecture_speakers
  set active = true
  where id = v_id and not active;

  return v_id;
end;
$funcao$;

comment on function public.resolve_lecture_speaker is
  'Id do palestrante com este nome, criando a linha na primeira vez. NULL para nome vazio.';

-- ----------------------------------------------------------------------------
-- 5. O nome do palestrante, venha ele de onde vier
-- ----------------------------------------------------------------------------
-- Usada pela trilha de auditoria. Existe para o histórico gravar o NOME e não só
-- um id: um id de catálogo não teria como ser resolvido depois se a linha fosse
-- desativada — e o histórico é justamente onde se vai olhar quando alguém
-- perguntar quem apresentou.
create or replace function public.lecture_speaker_label(
  p_profile_id uuid,
  p_catalog_id uuid
)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select nullif(btrim(coalesce(p.full_name, p.email, '')), '')
       from public.profiles p where p.id = p_profile_id),
    (select s.name from public.lecture_speakers s where s.id = p_catalog_id)
  );
$$;

-- ----------------------------------------------------------------------------
-- 6. RLS e grants
-- ----------------------------------------------------------------------------
-- Espelha PERMISSION_MATRIX, como a tabela de palestras:
--   lectures.read  → admin, ceo, comercial
--   lectures.write → admin, ceo
alter table public.lecture_speakers enable row level security;

drop policy if exists "lecture_speakers_select" on public.lecture_speakers;
create policy "lecture_speakers_select"
  on public.lecture_speakers for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

drop policy if exists "lecture_speakers_insert" on public.lecture_speakers;
create policy "lecture_speakers_insert"
  on public.lecture_speakers for insert
  with check (
    public.current_app_role() in ('admin', 'ceo')
    and created_by = auth.uid()
  );

-- ⚠️ A policy de UPDATE existe para UMA coisa só — reativar um nome —, e quem
-- garante esse recorte é o grant de coluna logo abaixo, não a policy. RENOMEAR
-- não é operação deste módulo: o nome está congelado em palestras já comunicadas
-- ao solicitante, e corrigir uma digitação em massa é decisão consciente, por
-- migration.
drop policy if exists "lecture_speakers_update" on public.lecture_speakers;
create policy "lecture_speakers_update"
  on public.lecture_speakers for update
  using (public.current_app_role() in ('admin', 'ceo'))
  with check (public.current_app_role() in ('admin', 'ceo'));

-- Sem policy de DELETE: ver o `on delete restrict` da seção 3.

revoke all on public.lecture_speakers from authenticated, anon;
grant select on public.lecture_speakers to authenticated;
-- `created_by` fica FORA da lista: o default `auth.uid()` mais o `with check` da
-- policy fazem a autoria não ser forjável nem precisar ser enviada.
grant insert (name) on public.lecture_speakers to authenticated;
grant update (active) on public.lecture_speakers to authenticated;

grant insert (speaker_catalog_id), update (speaker_catalog_id)
  on public.lectures to authenticated;

revoke execute on function public.speaker_name_key(text) from public;
grant execute on function public.speaker_name_key(text) to authenticated;

revoke execute on function public.resolve_lecture_speaker(text) from public;
grant execute on function public.resolve_lecture_speaker(text) to authenticated;

revoke execute on function public.lecture_speaker_label(uuid, uuid) from public;
grant execute on function public.lecture_speaker_label(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. `create_lecture` passa a aceitar um nome
-- ----------------------------------------------------------------------------
-- ⚠️ DROP ANTES DO CREATE, e não `create or replace`. Acrescentar um parâmetro a
-- uma função existente com `create or replace` cria uma SOBRECARGA: as duas
-- versões passam a existir, e uma chamada por nome de argumento — que é como o
-- PostgREST chama — fica ambígua. Erro 42725 em produção, num caminho que passou
-- no type-check e nos testes.
drop function if exists public.create_lecture(
  text, text, text, text, public.lecture_type, text, public.lecture_format,
  date, time, time, integer, uuid, uuid, public.lecture_priority,
  public.lecture_status, text, text, text, text, text
);

create function public.create_lecture(
  p_name text,
  p_theme text,
  p_city text,
  p_location text,
  p_type public.lecture_type,
  p_type_other text,
  p_format public.lecture_format,
  p_event_date date,
  p_start_time time,
  p_end_time time,
  p_attendees_estimated integer,
  p_speaker_id uuid,
  p_responsible_id uuid,
  p_priority public.lecture_priority,
  p_status public.lecture_status,
  p_notes text,
  p_requester_name text default null,
  p_requester_email text default null,
  p_requester_phone text default null,
  p_requester_organization text default null,
  -- O palestrante SEM perfil, pelo nome. Ignorado quando `p_speaker_id` vem
  -- preenchido: uma palestra tem um palestrante.
  p_speaker_name text default null
)
returns public.lectures
language plpgsql
set search_path = ''
as $funcao$
declare
  v_lecture public.lectures;
  v_speaker_catalog_id uuid;
begin
  if public.current_app_role() not in ('admin', 'ceo') then
    raise exception 'Sem permissão para cadastrar palestras.' using errcode = '42501';
  end if;

  perform public.assert_lecture_profile(p_speaker_id);
  perform public.assert_lecture_profile(p_responsible_id);

  -- O perfil GANHA do nome, em vez de os dois juntos virarem erro: quem mandou
  -- os dois mandou a mesma pessoa duas vezes, e recusar a palestra por causa
  -- disso não protegeria ninguém de nada.
  if p_speaker_id is null then
    v_speaker_catalog_id := public.resolve_lecture_speaker(p_speaker_name);
  end if;

  -- §13. A mensagem precisa dizer O QUE FAZER; deixar o CHECK
  -- `lectures_scheduled_needs_time` estourar diria só "dados inválidos".
  if p_status in ('confirmed', 'held') and p_start_time is null then
    raise exception 'Informe o horário de início para confirmar a palestra.'
      using errcode = 'PL005';
  end if;

  insert into public.lectures (
    origin, status,
    name, theme, city, location, type, type_other, format,
    event_date, start_time, end_time, attendees_estimated,
    speaker_id, speaker_catalog_id, responsible_id, priority, notes,
    -- §26 + §53. Nascer REALIZADA é o registro histórico, e nele a data de
    -- realização é a data da palestra — que é o que a pessoa acabou de digitar.
    held_at,
    requester_name, requester_email, requester_phone, requester_organization
  )
  values (
    'internal', p_status,
    btrim(p_name), btrim(p_theme), btrim(p_city), nullif(btrim(p_location), ''),
    p_type,
    case when p_type = 'other' then nullif(btrim(p_type_other), '') end,
    p_format,
    p_event_date, p_start_time, p_end_time, p_attendees_estimated,
    p_speaker_id, v_speaker_catalog_id, p_responsible_id, coalesce(p_priority, 'normal'),
    nullif(btrim(p_notes), ''),
    case when p_status = 'held' then p_event_date end,
    nullif(btrim(p_requester_name), ''),
    nullif(btrim(p_requester_email), ''),
    nullif(btrim(p_requester_phone), ''),
    nullif(btrim(p_requester_organization), '')
  )
  returning * into v_lecture;

  insert into public.lecture_audit_logs (lecture_id, action, metadata)
  values (
    v_lecture.id,
    'lecture_created',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'origin', 'internal',
      'protocol', v_lecture.protocol,
      'status', v_lecture.status,
      'theme', v_lecture.theme,
      'city', v_lecture.city,
      'eventDate', v_lecture.event_date
    )
  );

  return v_lecture;
end;
$funcao$;

-- ----------------------------------------------------------------------------
-- 8. `assign_lecture_speaker` passa a aceitar um nome
-- ----------------------------------------------------------------------------
-- Mesmo motivo do drop acima. E é isto que fecha o ciclo: sem ela, uma palestra
-- criada com palestrante externo nunca poderia TROCAR de palestrante — a única
-- tela que mexe nisso depois da criação é esta.
drop function if exists public.assign_lecture_speaker(uuid, uuid);

create function public.assign_lecture_speaker(
  p_lecture_id uuid,
  p_profile_id uuid,
  p_speaker_name text default null
)
returns public.lectures
language plpgsql
set search_path = ''
as $funcao$
declare
  v_old public.lectures;
  v_new public.lectures;
  v_catalog_id uuid;
begin
  perform public.lock_lecture(p_lecture_id);
  perform public.assert_lecture_profile(p_profile_id);

  select * into v_old from public.lectures where id = p_lecture_id;
  if not found then
    raise exception 'Palestra não encontrada.' using errcode = 'P0002';
  end if;

  if p_profile_id is null then
    v_catalog_id := public.resolve_lecture_speaker(p_speaker_name);
  end if;

  if v_old.speaker_id is not distinct from p_profile_id
     and v_old.speaker_catalog_id is not distinct from v_catalog_id then
    return v_old;
  end if;

  update public.lectures
  set speaker_id = p_profile_id,
      speaker_catalog_id = v_catalog_id,
      updated_by = auth.uid()
  where id = p_lecture_id
  returning * into v_new;

  -- ⚠️ A trilha grava o NOME além do id, e o nome é a parte que vai continuar
  -- legível daqui a dois anos. `from`/`to` seguem existindo para não quebrar o
  -- que já foi gravado antes desta migration.
  insert into public.lecture_audit_logs (lecture_id, action, metadata)
  values (
    p_lecture_id,
    'lecture_speaker_assigned',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'from', v_old.speaker_id,
      'to', v_new.speaker_id,
      'from_name', public.lecture_speaker_label(v_old.speaker_id, v_old.speaker_catalog_id),
      'to_name', public.lecture_speaker_label(v_new.speaker_id, v_new.speaker_catalog_id)
    )
  );

  return v_new;
end;
$funcao$;

revoke execute on function public.create_lecture(
  text, text, text, text, public.lecture_type, text, public.lecture_format,
  date, time, time, integer, uuid, uuid, public.lecture_priority,
  public.lecture_status, text, text, text, text, text, text
) from public;
grant execute on function public.create_lecture(
  text, text, text, text, public.lecture_type, text, public.lecture_format,
  date, time, time, integer, uuid, uuid, public.lecture_priority,
  public.lecture_status, text, text, text, text, text, text
) to authenticated;

revoke execute on function public.assign_lecture_speaker(uuid, uuid, text) from public;
grant execute on function public.assign_lecture_speaker(uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. A conferência que impede a sobrecarga silenciosa
-- ----------------------------------------------------------------------------
-- ⚠️ O `drop ... if exists` das seções 7 e 8 depende de a assinatura antiga bater
-- EXATAMENTE. Se um dia ela não bater — um parâmetro renomeado, um tipo trocado
-- numa migration intermediária —, o drop não acha nada, o create cria uma SEGUNDA
-- versão, e a migration termina "com sucesso". O erro só aparece depois, em
-- produção, quando o PostgREST chamar por nome de argumento e o Postgres não
-- souber qual das duas escolher (42725).
--
-- Falhar aqui é infinitamente melhor: a migration não passa, e quem a rodou lê
-- exatamente o que aconteceu.
do $checagem$
declare
  v_alvo text;
  v_qtd integer;
begin
  foreach v_alvo in array array['create_lecture', 'assign_lecture_speaker'] loop
    select count(*) into v_qtd
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_alvo;

    if v_qtd <> 1 then
      raise exception
        '% ficou com % versões. Uma chamada por nome de argumento seria ambígua — remova a antiga antes de seguir.',
        v_alvo, v_qtd;
    end if;
  end loop;
end;
$checagem$;

-- ============================================================================
-- ROLLBACK (manual, na ordem)
-- ----------------------------------------------------------------------------
--   drop function if exists public.assign_lecture_speaker(uuid, uuid, text);
--   drop function if exists public.create_lecture(text, text, text, text, public.lecture_type, text, public.lecture_format, date, time, time, integer, uuid, uuid, public.lecture_priority, public.lecture_status, text, text, text, text, text, text);
--   -- e recriar as duas versões antigas a partir de 20260816000000_create_lectures.sql
--   alter table public.lectures drop constraint if exists lectures_single_speaker;
--   alter table public.lectures drop column if exists speaker_catalog_id;
--   drop function if exists public.lecture_speaker_label(uuid, uuid);
--   drop function if exists public.resolve_lecture_speaker(text);
--   drop table if exists public.lecture_speakers;
--   drop function if exists public.speaker_name_key(text);
