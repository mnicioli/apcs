-- ============================================================================
-- Eventos — cadastro, segmentação e trilha de auditoria
-- ----------------------------------------------------------------------------
-- Terceiro módulo de conteúdo do CRM. Guarda os eventos da APCS e responde à
-- pergunta que o chatbot vai fazer: QUAIS EVENTOS ESTÃO DE PÉ, QUANDO E PARA
-- QUEM?
--
-- ⚠️ A DECISÃO CENTRAL — A EXPIRAÇÃO É DERIVADA, NÃO GRAVADA.
--
-- A coluna `status` guarda APENAS a decisão humana ('active' | 'inactive').
-- "Expirado" nunca é escrito em lugar nenhum: é calculado toda vez que alguém
-- lê, comparando `event_date` com a data de hoje em São Paulo.
--
--     status = 'inactive'                   → alguém inativou   (MANUAL)
--     status = 'active' e data já passou    → expirado          (EXPIRED)
--     status = 'active' e data não passou   → ativo
--
-- POR QUE ASSIM, e não uma rotina que vira as linhas:
--
--   1. O projeto não tem infraestrutura de job — sem cron, sem pg_cron, sem
--      worker. Uma rotina agendada seria a primeira, e uma rotina que não roda
--      falha em silêncio: o evento de ontem continuaria no ar.
--   2. A derivação SÓ SABE REBAIXAR. Um evento inativado à mão nunca volta a
--      aparecer como ativo pela passagem do tempo — a exigência de "expiração
--      não reativa evento manual" deixa de ser uma regra a lembrar e vira uma
--      impossibilidade estrutural.
--   3. Idempotência de graça: não há rotina para rodar duas vezes.
--
-- O QUE ISSO CUSTA, dito na cara: não existe linha de auditoria "o sistema
-- expirou o evento X às 00:00", porque nada acontece — a verdade muda com o
-- calendário. Foi uma troca consciente, aprovada no plano.
--
-- A regra que PRECISA ser imposta de verdade, e é: um evento cuja data já
-- passou não pode ser ativado (ver `set_event_status`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
-- Só a decisão humana. Não existe 'expired' aqui de propósito: um valor de enum
-- para um estado que ninguém escreve seria um convite a alguém escrevê-lo e
-- criar a segunda fonte da verdade que este desenho evita.
create type public.event_status as enum ('active', 'inactive');

create type public.event_audit_action as enum (
  'event_created',
  'event_updated',
  'event_activated',
  'event_deactivated',
  'event_image_uploaded',
  'event_image_replaced',
  'event_segments_updated'
);

-- ----------------------------------------------------------------------------
-- 2. Eventos
-- ----------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),

  name text not null,
  location text not null,
  registration_url text,

  -- `date` e `time` separados, sem fuso, de propósito. Um `timestamptz` seria
  -- convertido na leitura e um evento das 00:30 viraria o dia anterior para
  -- quem estivesse em outro fuso. O que a APCS marca é "dia 20, às 14h", não um
  -- instante absoluto na linha do tempo.
  event_date date not null,
  start_time time not null,
  end_time time,

  status public.event_status not null default 'active',

  -- Caminho no bucket privado `events`. NUNCA contém o nome enviado pela pessoa
  -- (é `<event_id>/<uuid>.<ext>`) — nome vindo de fora não vira caminho, nunca.
  image_path text not null unique,
  -- O MIME dos BYTES, apurado pelo servidor. Não é o que o navegador declarou.
  image_mime text not null,
  image_size_bytes integer not null,

  -- `default auth.uid()` + o `with check` das policies: a autoria não pode ser
  -- forjada nem precisa ser enviada pela aplicação. Nulável porque a FK é
  -- `on delete set null` — o evento sobrevive à saída de quem o cadastrou.
  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),

  constraint events_name_len check (char_length(name) between 2 and 160),
  constraint events_location_len check (char_length(location) between 2 and 200),

  -- Igual permitido: um evento pode começar e terminar na mesma marca.
  constraint events_time_order check (end_time is null or end_time >= start_time),

  -- O link de inscrição é DADO EXTERNO NÃO CONFIÁVEL. A allowlist de protocolo
  -- está aqui, e não só no Zod, porque `javascript:alert(1)` passa por
  -- `z.string().url()` — e um href com esse valor é XSS na tela de quem clicar.
  constraint events_url_scheme
    check (registration_url is null or registration_url ~* '^https?://[^[:space:]]+$'),
  constraint events_url_len
    check (registration_url is null or char_length(registration_url) <= 2048),

  constraint events_image_mime
    check (image_mime in ('image/jpeg', 'image/png', 'image/webp')),
  -- 5 MB exatos passam. É a última das quatro barreiras de tamanho: navegador,
  -- action, bucket e aqui.
  constraint events_image_size
    check (image_size_bytes > 0 and image_size_bytes <= 5242880)
);

comment on table public.events is
  'Eventos da APCS. `status` guarda só a decisão humana; "expirado" é derivado de event_date na leitura.';

comment on column public.events.status is
  'Decisão HUMANA apenas. Nunca gravamos expiração aqui — ver o cabeçalho da migration.';

-- SEM índice único em `name`: dois "Workshop APCS" em anos diferentes são dois
-- eventos legítimos.

-- Ordenação da grid e filtro por período.
create index events_date_idx on public.events (event_date, start_time);

-- A consulta do chatbot: ativos daqui para a frente. Parcial porque é sempre
-- sobre o mesmo recorte, e o índice fica uma fração do tamanho.
create index events_active_date_idx
  on public.events (event_date)
  where status = 'active';

-- ----------------------------------------------------------------------------
-- 3. Catálogo de públicos (segmentação)
-- ----------------------------------------------------------------------------
-- NÃO EXISTE cadastro de associados neste banco. As tabelas de pessoas são
-- `profiles` (usuários do CRM) e `chat_contacts` (quem falou com o bot) —
-- nenhuma delas é um registro de associados da APCS.
--
-- Então a segmentação nasce com o que dá para modelar com honestidade: um
-- CATÁLOGO de públicos e o VÍNCULO evento↔público. A resolução
-- "público → lista de associados" fica deliberadamente ausente, para ser
-- escrita quando existir a quem resolver. Ver docs/EVENTS.md.
create table public.event_segments (
  id uuid primary key default gen_random_uuid(),
  -- Chave estável para o futuro resolvedor de audiência se prender. O `name` é
  -- rótulo de tela e alguém vai renomeá-lo; o slug não muda.
  slug text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint event_segments_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint event_segments_name_len check (char_length(name) between 2 and 120)
);

comment on table public.event_segments is
  'Catálogo de públicos-alvo. Público novo = um insert numa migration, sem código.';

-- ----------------------------------------------------------------------------
-- 4. Vínculo evento × público (N:N)
-- ----------------------------------------------------------------------------
-- Um evento alcança N públicos SEM SE DUPLICAR. E nenhum dado de associado
-- (nome, telefone, e-mail) é copiado para cá: o evento referencia o segmento, e
-- só.
create table public.event_segment_links (
  event_id uuid not null references public.events on delete cascade,
  -- `restrict`, não `cascade`: um público já usado por um evento não some
  -- levando junto o significado daquele evento.
  segment_id uuid not null references public.event_segments on delete restrict,
  created_at timestamptz not null default now(),
  primary key (event_id, segment_id)
);

-- A PK cobre buscas por evento. Esta cobre o caminho inverso — "quais eventos
-- deste público?" —, que é exatamente o que o chatbot vai perguntar.
create index event_segment_links_segment_idx on public.event_segment_links (segment_id);

-- ----------------------------------------------------------------------------
-- 5. Trilha de auditoria
-- ----------------------------------------------------------------------------
-- Espelha `document_audit_logs`. Tabela própria, e não a de documentos, porque
-- aquela tem FK para `documents`/`document_versions` e enum próprio — só o
-- PADRÃO é reutilizável. A unificação numa auditoria de plataforma é o módulo
-- #8 do roadmap, e é mais barata de fazer com dois casos na mão do que de
-- adivinhar agora com um.
create table public.event_audit_logs (
  id bigint generated always as identity primary key,
  -- `set null` (e não cascade): a trilha tem de sobreviver ao que ela audita.
  event_id uuid references public.events on delete set null,
  action public.event_audit_action not null,
  actor_id uuid references public.profiles on delete set null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.event_audit_logs is
  'Trilha imutável das operações sobre eventos. Só aceita INSERT — nunca update nem delete.';

create index event_audit_logs_event_idx
  on public.event_audit_logs (event_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 6. Row Level Security
-- ----------------------------------------------------------------------------
-- Espelha PERMISSION_MATRIX em src/lib/rbac/rbac.config.ts:
--   events.read  → admin, ceo, comercial   (Administrador, Gestor, Atendente)
--   events.write → admin, ceo              (Administrador, Gestor)
-- As duas camadas contam a mesma história.
alter table public.events enable row level security;
alter table public.event_segments enable row level security;
alter table public.event_segment_links enable row level security;
alter table public.event_audit_logs enable row level security;

create policy "events_select"
  on public.events for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

create policy "events_insert"
  on public.events for insert
  with check (
    public.current_app_role() in ('admin', 'ceo')
    and created_by = auth.uid()
  );

-- `updated_by = auth.uid()` no `with check` faz duas coisas: impede assinar a
-- edição com o nome de outra pessoa E impede uma alteração anônima — quem não
-- preencher a autoria não consegue atualizar linha nenhuma.
create policy "events_update"
  on public.events for update
  using (public.current_app_role() in ('admin', 'ceo'))
  with check (
    public.current_app_role() in ('admin', 'ceo')
    and updated_by = auth.uid()
  );

create policy "event_segments_select"
  on public.event_segments for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

-- Sem policy de insert/update/delete: o catálogo só muda por migration.

create policy "event_segment_links_select"
  on public.event_segment_links for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

create policy "event_segment_links_insert"
  on public.event_segment_links for insert
  with check (public.current_app_role() in ('admin', 'ceo'));

-- Trocar a segmentação de um evento é apagar os vínculos e gravar os novos.
create policy "event_segment_links_delete"
  on public.event_segment_links for delete
  using (public.current_app_role() in ('admin', 'ceo'));

-- Auditoria é legível só por quem tem a permissão de auditoria (Administrador e
-- Gestor). O Atendente consulta eventos, não a trilha de quem mexeu neles.
create policy "event_audit_logs_select"
  on public.event_audit_logs for select
  using (public.current_app_role() in ('admin', 'ceo'));

-- Só INSERT, e só em nome de si mesmo. Sem policy de update/delete, a RLS já
-- barra reescrever a trilha.
create policy "event_audit_logs_insert"
  on public.event_audit_logs for insert
  with check (
    public.current_app_role() in ('admin', 'ceo')
    and actor_id = auth.uid()
  );

-- ----------------------------------------------------------------------------
-- 7. Grants de coluna (RLS filtra LINHA, não COLUNA)
-- ----------------------------------------------------------------------------
-- Sem isto, um `ceo` chamando o PostgREST direto com o próprio JWT reescreveria
-- `created_by` ou `created_at` de um evento alheio — a policy de update
-- deixaria passar, porque ela olha a linha, não as colunas tocadas.
revoke update on public.events from authenticated;
grant update (
  name,
  location,
  registration_url,
  event_date,
  start_time,
  end_time,
  status,
  image_path,
  image_mime,
  image_size_bytes,
  updated_by,
  updated_at
) on public.events to authenticated;

-- Não existe exclusão física de evento: ele pode já ter sido consultado pelo
-- chatbot ou comunicado a associados. O controle é ativo/inativo.
revoke delete on public.events from authenticated, anon;

-- O catálogo de públicos não se edita pela aplicação.
revoke insert, update, delete on public.event_segments from authenticated, anon;

-- A trilha não se reescreve nem se apaga.
revoke update, delete on public.event_audit_logs from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 8. updated_at automático
-- ----------------------------------------------------------------------------
create trigger on_events_updated
  before update on public.events
  for each row execute procedure public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 9. Storage
-- ----------------------------------------------------------------------------
-- Bucket PRIVADO, igual a `documents`. Não é um Storage paralelo — é o mesmo
-- Supabase Storage; um bucket separado é obrigatório porque `documents` declara
-- `allowed_mime_types = ['application/pdf']` e recusaria qualquer imagem.
--
-- `file_size_limit` e `allowed_mime_types` aqui são a barreira que sobra caso
-- alguém pule a aplicação e use o token de upload direto.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'events',
  'events',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy "events_bucket_select"
  on storage.objects for select
  using (
    bucket_id = 'events'
    and public.current_app_role() in ('admin', 'ceo', 'comercial')
  );

create policy "events_bucket_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'events'
    and public.current_app_role() in ('admin', 'ceo')
  );

-- DELETE existe para dois casos, e só eles: apagar o órfão de um upload que a
-- validação de conteúdo recusou, e descartar a imagem antiga DEPOIS que a
-- substituição já foi gravada com sucesso.
create policy "events_bucket_delete"
  on storage.objects for delete
  using (
    bucket_id = 'events'
    and public.current_app_role() in ('admin', 'ceo')
  );

-- ----------------------------------------------------------------------------
-- 10. Operações transacionais
-- ----------------------------------------------------------------------------
-- Criar um evento são três escritas que precisam acontecer juntas ou não
-- acontecer: a linha, os vínculos de segmento e a auditoria. O supabase-js não
-- faz transação de várias chamadas, então isso vive no banco.
--
-- SECURITY INVOKER (padrão do plpgsql): a RLS e os grants de coluna continuam
-- valendo DENTRO da função. A checagem de papel no topo existe só para devolver
-- um erro limpo (42501 → "forbidden" em mapPostgresError) em vez de um
-- "permission denied for table" cru.
--
-- CÓDIGOS DE ERRO usados aqui e mapeados em src/lib/actions/errors.ts:
--   42501  sem permissão
--   P0002  evento não encontrado (no_data_found)
--   P0003  evento expirado — não pode ser ativado
--   P0004  segmento de público inexistente ou inativo
--   P0005  data anterior a hoje

-- O "hoje" oficial da aplicação. Existe como função para que a data de corte
-- seja apurada num lugar só: o fuso da APCS, não o do servidor (que é UTC na
-- Vercel, e viraria o dia três horas antes para quem está no Brasil).
create or replace function public.event_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

comment on function public.event_today() is
  'A data de hoje no fuso da APCS. A referência única para expiração de eventos.';

-- Serializa operações concorrentes sobre o MESMO evento (usuário A ativa,
-- usuário B inativa, usuário C edita a data).
--
-- Por que lock consultivo e não `select ... for update`: em tabela com RLS,
-- `for update` também exige policy e privilégio de UPDATE, e aqui o Atendente
-- tem SELECT mas não UPDATE — um `for update` numa leitura dele quebraria. O
-- lock consultivo faz exatamente um trabalho, enfileirar, sem pedir permissão
-- que não deveria existir.
create or replace function public.lock_event(p_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if public.current_app_role() not in ('admin', 'ceo') then
    raise exception 'Sem permissão para alterar eventos.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_event_id::text));
end;
$$;

revoke execute on function public.lock_event(uuid) from public;
grant execute on function public.lock_event(uuid) to authenticated;

-- Confere que todo id recebido existe no catálogo E está ativo, e que a lista
-- não veio vazia. A FK sozinha pegaria o inexistente, mas com o código 23503,
-- que a aplicação traduz como "há registros vinculados" — a mensagem errada
-- para este problema.
create or replace function public.assert_event_segments(p_segment_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_found integer;
begin
  if p_segment_ids is null or array_length(p_segment_ids, 1) is null then
    raise exception 'Selecione ao menos um público-alvo.' using errcode = 'P0004';
  end if;

  select count(*) into v_found
  from public.event_segments
  where id = any (p_segment_ids) and active;

  -- `distinct` no cardinal esperado: ids repetidos na entrada não devem
  -- reprovar uma seleção legítima.
  if v_found <> (select count(distinct s) from unnest(p_segment_ids) as s) then
    raise exception 'Público-alvo inválido.' using errcode = 'P0004';
  end if;
end;
$$;

revoke execute on function public.assert_event_segments(uuid[]) from public;
grant execute on function public.assert_event_segments(uuid[]) to authenticated;

-- Cria o evento com a imagem, os públicos e a auditoria, tudo de uma vez.
--
-- O `p_event_id` vem de fora, e isso é proposital: o caminho da imagem no
-- bucket é `<event_id>/<uuid>.<ext>` e o arquivo sobe ANTES da linha existir
-- (a Vercel corta o corpo de requisições serverless em 4,5 MB, então 5 MB de
-- imagem não passam por Server Action). Sortear o id na emissão do endereço de
-- upload é o que permite a imagem ser obrigatória já no primeiro insert, sem
-- pasta de rascunho.
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

  -- Um evento nasce ATIVO. Nascer no passado seria nascer expirado — quase
  -- sempre um erro de digitação, e o texto abaixo é o que manda corrigir.
  if p_event_date < public.event_today() then
    raise exception 'Não é possível cadastrar um evento com data anterior à data atual.'
      using errcode = 'P0005';
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

-- Edita o evento, troca os públicos e grava o DIFF campo a campo.
--
-- O diff é o motivo de isto ser uma função e não um update na aplicação: ele
-- precisa da linha antiga e da nova na mesma transação. Lido antes e escrito
-- depois pela aplicação, duas edições simultâneas registrariam "de A para C" e
-- "de A para B" — e o histórico contaria uma mentira.
--
-- `p_image_path` nulo significa MANTER a imagem atual.
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
  -- para corrigir o local no registro, nem para remarcá-lo, porque qualquer
  -- edição carrega a data atual dele junto.
  if p_event_date <> v_old.event_date and p_event_date < public.event_today() then
    raise exception 'Não é possível cadastrar um evento com data anterior à data atual.'
      using errcode = 'P0005';
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

  -- O diff. `is distinct from` e não `<>`: com NULL dos dois lados, `<>` devolve
  -- NULL e a mudança (ou a não-mudança) passaria despercebida.
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

  -- Segmentação: compara os conjuntos antes de reescrever, para não registrar
  -- "alterou o público" numa edição que só mexeu no local.
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

-- Ativa ou inativa, com a regra que o desenho derivado exige que seja imposta
-- de verdade: NÃO SE ATIVA UM EVENTO CUJA DATA JÁ PASSOU.
--
-- Sem esta checagem, a expiração derivada teria um furo: bastaria mandar
-- `status = 'active'` num evento de ontem para ele voltar a contar como ativo
-- na consulta do chatbot.
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

  if p_command = 'activate' and v_old.event_date < public.event_today() then
    raise exception 'Não é possível ativar um evento cuja data já passou.'
      using errcode = 'P0003';
  end if;

  update public.events
  set status = (case when p_command = 'activate' then 'active' else 'inactive' end)::public.event_status,
      updated_by = auth.uid()
  where id = p_event_id
  returning * into v_new;

  -- Registra o estado ANTERIOR e o NOVO. O motivo da inativação é sempre
  -- 'manual': a expiração não passa por aqui, porque ela não é uma escrita.
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

-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- O CLI do Supabase não tem down-migration; o desfazimento é manual. Na ordem
-- (dependências primeiro), e esvaziando o bucket antes, senão o delete falha:
--
--   drop function if exists public.set_event_status(uuid, text);
--   drop function if exists public.update_event(uuid, text, text, text, date, time, time, text, text, integer, uuid[]);
--   drop function if exists public.create_event(uuid, text, text, text, date, time, time, text, text, integer, uuid[]);
--   drop function if exists public.assert_event_segments(uuid[]);
--   drop function if exists public.lock_event(uuid);
--   drop function if exists public.event_today();
--   drop policy if exists "events_bucket_select" on storage.objects;
--   drop policy if exists "events_bucket_insert" on storage.objects;
--   drop policy if exists "events_bucket_delete" on storage.objects;
--   delete from storage.objects where bucket_id = 'events';
--   delete from storage.buckets where id = 'events';
--   drop table if exists public.event_audit_logs;
--   drop table if exists public.event_segment_links;
--   drop table if exists public.event_segments;
--   drop table if exists public.events;
--   drop type if exists public.event_audit_action;
--   drop type if exists public.event_status;
--
-- Nenhuma tabela existente é alterada por esta migration, então o rollback não
-- toca em dado de outro módulo.
-- ============================================================================
