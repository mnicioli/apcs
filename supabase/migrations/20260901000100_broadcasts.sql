-- ============================================================================
-- DIVULGAÇÃO GENÉRICA — Normativas, Comunicação, Bolsa e Palestras
-- ============================================================================
--
-- O que passa a existir: nesses quatro módulos, quem publica pode escolher um
-- público-alvo e mandar a mensagem por WhatsApp. Antes, só Eventos e Enquetes
-- enviavam — os outros publicavam e ninguém ficava sabendo.
--
-- ----------------------------------------------------------------------------
-- ⚠️ POR QUE UMA FILA GENÉRICA, E NÃO QUATRO CÓPIAS
-- ----------------------------------------------------------------------------
-- Já existem DUAS cópias do mesmo desenho no banco: `survey_recipients` /
-- `survey_dispatches` e `event_recipients` / `event_dispatches`. Fazer mais
-- quatro daria SEIS lugares onde consertar o mesmo defeito — e a experiência
-- deste repositório é que eles divergem: o opt-out por telefone
-- (20260829020659) precisou ser corrigido em cada um dos lugares que o
-- consultava, e um deles ficou para trás por um dia.
--
-- Aqui a fila é uma só, e o que muda entre módulos é: de onde veio (`source`),
-- o texto (`body`, montado por quem clica) e o anexo (`media_*`). O worker não
-- sabe o que é uma normativa.
--
-- ⚠️ EVENTOS E ENQUETES **NÃO** FORAM MIGRADOS PARA CÁ. Reescrever duas filas
-- que funcionam, em produção, sem ninguém ter pedido, é trocar risco por
-- elegância. Ficam como estão; quando uma delas precisar de mudança grande, aí
-- se avalia trazer para cá.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTE ARQUIVO NÃO INVENTA
-- ----------------------------------------------------------------------------
-- `notification_phone_key`, `is_notification_blocked`,
-- `profile_for_event_segment` e o catálogo `event_segments` já existem e são
-- reusados sem uma linha de mudança. Em especial: a regra de quem está
-- bloqueado é UMA (`is_notification_blocked`), e continua sendo.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. A campanha
-- ----------------------------------------------------------------------------
create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),

  source public.broadcast_source not null,

  -- ⚠️ SEM FK, E ISSO É DELIBERADO. `source_id` aponta para `documents`,
  -- `market_bulletins` ou `lectures` conforme o `source` — quatro tabelas
  -- diferentes. As alternativas seriam quatro colunas anuláveis (e um CHECK
  -- para garantir que só uma está preenchida) ou quatro tabelas de fila. A
  -- primeira polui todas as consultas; a segunda é o que este arquivo existe
  -- para evitar.
  --
  -- O preço: o banco não impede um id órfão. Por isso o `title` abaixo é um
  -- SNAPSHOT — o histórico continua legível mesmo se a normativa for apagada.
  source_id uuid not null,

  -- O que foi divulgado, como estava no momento do clique.
  title text not null,

  -- ⚠️ O TEXTO EXATO QUE SAIU, e não um modelo para reconstruir depois. Se o
  -- rótulo do módulo mudar daqui a seis meses, o histórico continua mostrando
  -- o que a pessoa realmente recebeu — que é a única coisa que serve quando
  -- alguém pergunta "o que vocês me mandaram?".
  body text not null,

  -- O anexo, quando há. Guarda CAMINHO, nunca URL: uma URL assinada expira, e
  -- guardá-la seria guardar uma credencial vencida. Quem assina é o worker, a
  -- cada corrida — o mesmo que `drainEventQueue` faz com a imagem do evento.
  media_bucket text,
  media_path text,
  media_mime text,
  media_filename text,

  status public.broadcast_status not null default 'running',

  total_recipients integer not null default 0,
  total_sent integer not null default 0,
  total_errors integer not null default 0,
  total_blocked integer not null default 0,

  started_at timestamptz not null default now(),
  finished_at timestamptz,
  last_error text,

  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_by_name text,

  constraint broadcasts_counts check (
    total_recipients >= 0 and total_sent >= 0
    and total_errors >= 0 and total_blocked >= 0
  ),

  -- Anexo é tudo-ou-nada: um caminho sem bucket é um arquivo que ninguém acha.
  constraint broadcasts_media_complete check (
    (media_bucket is null and media_path is null)
    or (media_bucket is not null and media_path is not null)
  )
);

comment on table public.broadcasts is
  'Uma divulgacao por WhatsApp saida de Normativas, Comunicacao, Bolsa ou Palestras. Eventos e Enquetes tem fila propria.';

create index broadcasts_source_idx on public.broadcasts (source, source_id, started_at desc);
create index broadcasts_recent_idx on public.broadcasts (started_at desc);


-- ----------------------------------------------------------------------------
-- 2. Os públicos escolhidos
-- ----------------------------------------------------------------------------
-- Snapshot da ESCOLHA, não da audiência. Serve para a tela responder "para
-- quem foi?" depois — a lista de telefones está em `broadcast_recipients`, mas
-- ela não diz qual foi a intenção.
create table public.broadcast_segments (
  broadcast_id uuid not null references public.broadcasts on delete cascade,
  -- `restrict`: um público já usado numa divulgação não some levando junto o
  -- significado daquela divulgação. Mesma decisão de `event_segment_links`.
  segment_id uuid not null references public.event_segments on delete restrict,
  primary key (broadcast_id, segment_id)
);


-- ----------------------------------------------------------------------------
-- 3. A fila
-- ----------------------------------------------------------------------------
create table public.broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.broadcasts on delete cascade,

  -- `set null` + snapshot: `members` pode ser apagado por pedido de eliminação
  -- (LGPD), e sem o snapshot atender esse pedido apagaria também a resposta
  -- para "para quantas pessoas isto foi divulgado?", que é registro
  -- operacional, não dado pessoal em uso.
  member_id uuid references public.members on delete set null,
  member_name text,

  -- ⚠️ SÓ DÍGITOS, e NOT NULL: ninguém entra na fila sem telefone. Um
  -- destinatário sem número não é "pendente", é uma linha que nunca sai de
  -- pendente — e a fila nunca terminaria.
  member_phone text not null,

  status public.broadcast_recipient_status not null default 'pending',

  attempts integer not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  provider_message_id text,

  created_at timestamptz not null default now(),

  constraint broadcast_recipients_attempts_non_negative check (attempts >= 0),
  constraint broadcast_recipients_phone_digits check (member_phone ~ '^[0-9]{10,15}$')
);

comment on table public.broadcast_recipients is
  'A fila de uma divulgacao. Uma linha por TELEFONE — a fotografia de quem era publico-alvo no momento do clique.';

-- ⚠️ A CHAVE É (divulgação, TELEFONE), não (divulgação, associado). Dois
-- cadastros da mesma pessoa — que acontece: carga legada mais cadastro pelo
-- site — mandariam a mesma mensagem duas vezes para o mesmo aparelho. Quem
-- recebe não vê dois registros; vê a APCS mandando duas vezes.
create unique index broadcast_recipients_unique_idx
  on public.broadcast_recipients (broadcast_id, member_phone);

create index broadcast_recipients_queue_idx
  on public.broadcast_recipients (broadcast_id, status, created_at);

create index broadcast_recipients_provider_msg_idx
  on public.broadcast_recipients (provider_message_id)
  where provider_message_id is not null;


-- ----------------------------------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------------------------------
-- ⚠️ LEITURA MAIS LARGA QUE ESCRITA, e a escrita NÃO TEM POLICY NENHUMA.
--
-- Quem atende (`comercial`) precisa ver que a normativa já foi divulgada — é a
-- resposta para "vocês me avisaram?". Mas escrever aqui é DISPARAR MENSAGEM
-- PARA A BASE: não existe policy de insert/update/delete para ninguém, e a
-- única porta é `start_broadcast`, que confere o papel e monta a fila de um
-- jeito só. Uma policy de insert abriria a possibilidade de alguém montar a
-- fila à mão, sem passar pelo filtro de opt-out.
alter table public.broadcasts enable row level security;
alter table public.broadcast_segments enable row level security;
alter table public.broadcast_recipients enable row level security;

create policy "broadcasts_select"
  on public.broadcasts for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

create policy "broadcast_segments_select"
  on public.broadcast_segments for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

-- ⚠️ A FILA É MAIS ESTREITA QUE A CAMPANHA: ela tem NOME E TELEFONE de
-- associado, linha por linha. Quem precisa saber "foi divulgado?" não precisa
-- da lista de telefones de toda a base.
create policy "broadcast_recipients_select"
  on public.broadcast_recipients for select
  using ((select public.current_app_role()) in ('admin', 'ceo'));


-- ----------------------------------------------------------------------------
-- 5. Quem pode divulgar
-- ----------------------------------------------------------------------------
-- ⚠️ UMA FUNÇÃO SÓ PARA OS QUATRO MÓDULOS, e isso é verdade HOJE porque
-- `documents.write`, `market.write` e `lectures.write` têm exatamente a mesma
-- lista na matriz de RBAC: admin e ceo. Está escrito aqui para que, no dia em
-- que uma delas divergir, o lugar de partir a checagem por `source` seja óbvio
-- — e não uma descoberta feita depois de alguém divulgar o que não podia.
create or replace function public.broadcast_is_writer()
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select (select public.current_app_role()) in ('admin', 'ceo');
$fn$;


-- ----------------------------------------------------------------------------
-- 6. Abrir a divulgação e montar a fila
-- ----------------------------------------------------------------------------
-- ⚠️ A FOTOGRAFIA É TIRADA AQUI, no clique — e não a cada envio. Quem entrar na
-- base amanhã não recebe a normativa de hoje, e quem sair também não deixa de
-- receber no meio da corrida. É o mesmo de Eventos, e é o que faz o número na
-- tela ("428 destinatários") significar alguma coisa.
--
-- ⚠️ O BLOQUEIO É CONFERIDO NA MONTAGEM, POR TELEFONE. `is_notification_blocked`
-- é a MESMA função que Eventos usa — ela confere `notification_opt_outs` por
-- `phone_key` e, para as linhas antigas, pelo contato do chatbot. Duplicar essa
-- regra aqui seria criar uma segunda definição de "quem pediu para não
-- receber", que na prática é não ter nenhuma.
create or replace function public.start_broadcast(
  p_source public.broadcast_source,
  p_source_id uuid,
  p_title text,
  p_body text,
  p_segment_ids uuid[],
  p_media_bucket text default null,
  p_media_path text default null,
  p_media_mime text default null,
  p_media_filename text default null
)
returns table (broadcast_id uuid, queued integer, blocked integer)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_total integer;
  v_blocked integer;
begin
  if not public.broadcast_is_writer() then
    raise exception 'Sem permissao para divulgar.' using errcode = '42501';
  end if;

  if p_segment_ids is null or cardinality(p_segment_ids) = 0 then
    raise exception 'Escolha ao menos um publico-alvo antes de divulgar.' using errcode = 'BC001';
  end if;

  if nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'A mensagem nao pode ficar vazia.' using errcode = 'BC002';
  end if;

  -- ⚠️ RECUSA PÚBLICO INEXISTENTE OU INATIVO. Sem isto, um id errado vindo da
  -- tela produziria uma fila VAZIA e uma tela dizendo "divulgado para 0
  -- pessoas" — que parece uma base vazia, não um erro de seleção.
  if exists (
    select 1
    from unnest(p_segment_ids) as pedido(id)
    where not exists (
      select 1 from public.event_segments s where s.id = pedido.id and s.active
    )
  ) then
    raise exception 'Publico-alvo desconhecido ou inativo.' using errcode = 'BC003';
  end if;

  insert into public.broadcasts (
    source, source_id, title, body,
    media_bucket, media_path, media_mime, media_filename,
    created_by_name
  )
  values (
    p_source, p_source_id, p_title, btrim(p_body),
    p_media_bucket, p_media_path, p_media_mime, p_media_filename,
    public.current_actor_name()
  )
  returning id into v_id;

  insert into public.broadcast_segments (broadcast_id, segment_id)
  select v_id, s.id
  from public.event_segments s
  where s.id = any(p_segment_ids);

  -- A FOTOGRAFIA: associados ativos, com telefone, cujo perfil corresponde a
  -- algum dos públicos escolhidos.
  insert into public.broadcast_recipients (
    broadcast_id, member_id, member_name, member_phone, status
  )
  select distinct on (m.whatsapp)
    v_id,
    m.id,
    m.full_name,
    m.whatsapp,
    case
      when public.is_notification_blocked(m.whatsapp)
        then 'blocked'::public.broadcast_recipient_status
      else 'pending'::public.broadcast_recipient_status
    end
  from public.members m
  where m.status = 'active'
    and m.profile_type is not null
    and m.whatsapp ~ '^[0-9]{10,15}$'
    and m.profile_type in (
      select public.profile_for_event_segment(s.slug)
      from public.event_segments s
      where s.id = any(p_segment_ids)
        and public.profile_for_event_segment(s.slug) is not null
    )
  -- `distinct on` exige ordem, e a ordem escolhe QUAL cadastro representa o
  -- telefone quando há dois: o mais antigo, que é o que tem histórico.
  order by m.whatsapp, m.created_at, m.id
  on conflict (broadcast_id, member_phone) do nothing;

  select count(*) into v_total
  from public.broadcast_recipients r where r.broadcast_id = v_id;

  select count(*) into v_blocked
  from public.broadcast_recipients r
  where r.broadcast_id = v_id and r.status = 'blocked';

  update public.broadcasts b
  set total_recipients = v_total,
      total_blocked = v_blocked,
      -- Fila sem ninguém para enviar já nasce encerrada: deixá-la `running`
      -- faria a tela oferecer "continuar" para sempre, sem nada a continuar.
      status = case when v_total - v_blocked = 0 then 'done'::public.broadcast_status
                    else 'running'::public.broadcast_status end,
      finished_at = case when v_total - v_blocked = 0 then now() else null end
  where b.id = v_id;

  return query select v_id, (v_total - v_blocked), v_blocked;
end;
$fn$;

comment on function public.start_broadcast(public.broadcast_source, uuid, text, text, uuid[], text, text, text, text) is
  'Abre uma divulgacao e monta a fila a partir dos publicos-alvo escolhidos. Filtra quem pediu para nao receber.';

revoke execute on function public.start_broadcast(public.broadcast_source, uuid, text, text, uuid[], text, text, text, text)
  from public, anon;
grant execute on function public.start_broadcast(public.broadcast_source, uuid, text, text, uuid[], text, text, text, text)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 7. O worker: reivindicar, liquidar, soltar, encerrar
-- ----------------------------------------------------------------------------
-- Mesmo `for update skip locked` de Eventos e Enquetes: dois workers nunca
-- pegam a mesma pessoa. O comentário longo está em `claim_survey_recipients` e
-- vale igual aqui.
--
-- ⚠️ ESTAS QUATRO NÃO CHECAM PAPEL, e não é esquecimento: elas rodam com
-- `service_role`, onde não existe `auth.uid()` nem papel nenhum. Quem confere a
-- permissão é `start_broadcast`, com a sessão de quem clicou. As quatro só
-- operam uma fila que já foi autorizada — e nenhuma delas aceita um telefone
-- ou um texto vindo de fora.
create or replace function public.claim_broadcast_recipients(
  p_broadcast_id uuid,
  p_limit integer default 25
)
returns table (
  id uuid,
  member_id uuid,
  member_name text,
  member_phone text,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  return query
  with alvo as (
    select r.id
    from public.broadcast_recipients r
    where r.broadcast_id = p_broadcast_id
      and r.status = 'pending'
    order by r.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  update public.broadcast_recipients r
  set status = 'sending',
      attempts = r.attempts + 1,
      last_attempt_at = now()
  from alvo
  where r.id = alvo.id
  returning r.id, r.member_id, r.member_name, r.member_phone, r.attempts;
end;
$fn$;

-- ⚠️ SÓ DOIS DESFECHOS: enviado ou erro. Não existe "devolve para a fila".
--
-- Poderia existir, e seria pior. O worker JÁ REPETE internamente, com espera
-- crescente, antes de liquidar — quando ele chega aqui, a decisão está tomada.
-- Um terceiro estado "tente de novo depois" criaria duas repetições
-- concorrentes (a de dentro do worker e a da fila), e uma pessoa poderia
-- receber a mesma mensagem duas vezes porque o primeiro envio deu certo e a
-- resposta se perdeu.
--
-- O caso "a execução morreu no meio" não passa por aqui: aquelas linhas ficam
-- em `sending` e voltam por `release_stale_broadcast_recipients`.
create or replace function public.settle_broadcast_recipient(
  p_recipient_id uuid,
  p_ok boolean,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.broadcast_recipients r
  set status = case
        when p_ok then 'sent'::public.broadcast_recipient_status
        else 'error'::public.broadcast_recipient_status
      end,
      provider_message_id = coalesce(p_provider_message_id, r.provider_message_id),
      last_error = case when p_ok then null else p_error end
  where r.id = p_recipient_id;
end;
$fn$;

-- Linhas presas em `sending` porque a execução foi morta no meio. Sem isto elas
-- ficariam de fora de todo `claim` futuro — a fila nunca terminaria, e a tela
-- mostraria "faltam 3" para sempre.
create or replace function public.release_stale_broadcast_recipients(
  p_broadcast_id uuid,
  p_older_than interval default '5 minutes'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  update public.broadcast_recipients r
  set status = 'pending'
  where r.broadcast_id = p_broadcast_id
    and r.status = 'sending'
    and r.last_attempt_at < now() - p_older_than;

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- Recalcula os totais e decide se acabou. Chamada ao fim de cada corrida — o
-- estado vem da FILA, nunca de um contador incrementado durante o envio: um
-- contador que erra uma vez erra para sempre.
create or replace function public.finish_broadcast(
  p_broadcast_id uuid,
  p_last_error text default null
)
returns public.broadcasts
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_pendentes integer;
  v_row public.broadcasts%rowtype;
begin
  select count(*) into v_pendentes
  from public.broadcast_recipients r
  where r.broadcast_id = p_broadcast_id
    and r.status in ('pending', 'sending');

  update public.broadcasts b
  set total_sent = (
        select count(*) from public.broadcast_recipients r
        where r.broadcast_id = p_broadcast_id and r.status = 'sent'
      ),
      total_errors = (
        select count(*) from public.broadcast_recipients r
        where r.broadcast_id = p_broadcast_id and r.status = 'error'
      ),
      total_blocked = (
        select count(*) from public.broadcast_recipients r
        where r.broadcast_id = p_broadcast_id and r.status = 'blocked'
      ),
      status = case when v_pendentes = 0 then 'done'::public.broadcast_status
                    else 'running'::public.broadcast_status end,
      finished_at = case when v_pendentes = 0 then now() else null end,
      last_error = p_last_error
  where b.id = p_broadcast_id
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke execute on function public.claim_broadcast_recipients(uuid, integer) from public, anon, authenticated;
revoke execute on function public.settle_broadcast_recipient(uuid, boolean, text, text) from public, anon, authenticated;
revoke execute on function public.release_stale_broadcast_recipients(uuid, interval) from public, anon, authenticated;
revoke execute on function public.finish_broadcast(uuid, text) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 8. Recolocar na fila o que falhou
-- ----------------------------------------------------------------------------
-- ⚠️ NÃO RECOLOCA QUEM ESTÁ BLOQUEADO, e é a linha que importa: `blocked` não é
-- falha, é a APCS respeitando um pedido. Um "tentar de novo" que varresse tudo
-- mandaria mensagem para quem pediu para não receber — o pior desfecho deste
-- módulo, e jurídico antes de ser estético.
create or replace function public.retry_failed_broadcast_recipients(
  p_broadcast_id uuid,
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
  if not public.broadcast_is_writer() then
    raise exception 'Sem permissao para reenviar esta divulgacao.' using errcode = '42501';
  end if;

  update public.broadcast_recipients r
  set status = 'pending',
      last_error = null
  where r.broadcast_id = p_broadcast_id
    and r.status = 'error'
    and r.attempts < p_max_attempts
    and not public.is_notification_blocked(r.member_phone);

  get diagnostics v_count = row_count;

  if v_count > 0 then
    update public.broadcasts b
    set status = 'running', finished_at = null
    where b.id = p_broadcast_id;
  end if;

  return v_count;
end;
$fn$;

revoke execute on function public.retry_failed_broadcast_recipients(uuid, integer) from public, anon;
grant execute on function public.retry_failed_broadcast_recipients(uuid, integer) to authenticated;


-- ----------------------------------------------------------------------------
-- 9. Quantas pessoas este público alcança, antes de clicar
-- ----------------------------------------------------------------------------
-- ⚠️ A MESMA CONTA DA FOTOGRAFIA, e por isso ela é uma função e não um
-- `count(*)` na tela. Se as duas divergirem, a pessoa confere "312 pessoas",
-- clica, e a divulgação sai para 480 — e a diferença só aparece depois de as
-- mensagens terem saído.
create or replace function public.broadcast_audience_size(p_segment_ids uuid[])
returns table (reachable integer, blocked integer)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.broadcast_is_writer() then
    raise exception 'Sem permissao para consultar o alcance.' using errcode = '42501';
  end if;

  return query
  with base as (
    select distinct on (m.whatsapp) m.whatsapp
    from public.members m
    where m.status = 'active'
      and m.profile_type is not null
      and m.whatsapp ~ '^[0-9]{10,15}$'
      and m.profile_type in (
        select public.profile_for_event_segment(s.slug)
        from public.event_segments s
        where s.id = any(coalesce(p_segment_ids, '{}'::uuid[]))
          and public.profile_for_event_segment(s.slug) is not null
      )
    order by m.whatsapp, m.created_at, m.id
  )
  select
    count(*) filter (where not public.is_notification_blocked(b.whatsapp))::integer,
    count(*) filter (where public.is_notification_blocked(b.whatsapp))::integer
  from base b;
end;
$fn$;

revoke execute on function public.broadcast_audience_size(uuid[]) from public, anon;
grant execute on function public.broadcast_audience_size(uuid[]) to authenticated;
