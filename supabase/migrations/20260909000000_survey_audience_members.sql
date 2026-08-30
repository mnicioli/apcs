-- ============================================================================
-- ENQUETES — o público-alvo passa a ser o CADASTRO DE ASSOCIADOS
-- ============================================================================
--
-- O SINTOMA: montar uma enquete, marcar Perfil = Produtor · Associado ·
-- Fornecedor e ler
--
--     "Público estimado: Nenhum contato com telefone cadastrado corresponde a
--      esta segmentação."
--
-- com a base de associados cheia. E, logo acima, "Região: Nenhum contato com
-- estado cadastrado" — numa base em que todo associado tem UF.
--
-- ----------------------------------------------------------------------------
-- A CAUSA: ENQUETES ESTAVA OLHANDO PARA A TABELA ERRADA
-- ----------------------------------------------------------------------------
-- `resolve_audience_criteria` resolvia o público sobre `chat_contacts` — quem
-- conversou com o bot do site. As dimensões refletiam essa tabela:
--
--     Região  → chat_contacts.state
--     Perfil  → chat_contacts.contact_profile  (Produtor · Associado · Fornecedor)
--     Grupo   → chat_contacts.id
--
-- Isso estava certo em 19/08, e o cabeçalho de `20260819000000_create_surveys`
-- diz por quê (GAP 1): "Segmento, Categoria e Carteira dependem do cadastro de
-- associados, que ainda não existe neste sistema". Ele não existia.
--
-- ⚠️ AGORA EXISTE, e o resto do sistema já migrou. Bolsa, Normativas,
-- Comunicação e Eventos disparam por `members` × `event_segments`
-- (20260901000100_broadcasts, 20260828205853_event_dispatch). A unificação de
-- perfis (20260828194955) fez de Criadores · Empresas · Técnicos ·
-- Universidades a ÚNICA taxonomia do sistema. Enquetes ficou para trás,
-- perguntando por Produtor/Associado/Fornecedor — três rótulos que já não
-- descrevem ninguém — a uma tabela de leads.
--
-- ----------------------------------------------------------------------------
-- A DECISÃO: UMA BASE SÓ, A MESMA DE TODO MUNDO
-- ----------------------------------------------------------------------------
-- O público de uma enquete passa a ser o ASSOCIADO ATIVO COM WHATSAPP — a mesma
-- definição, palavra por palavra, que `start_broadcast` usa. É o §24 do escopo
-- sendo cumprido pela primeira vez: ele sempre disse "TODOS OS ASSOCIADOS".
--
-- As dimensões, depois desta migration:
--
--     Toda a base   → todo associado ativo com WhatsApp
--     Público-alvo  → event_segments → profile_for_event_segment → profile_type
--     Região        → members.state
--     Associados    → members escolhidos a dedo
--
-- ⚠️ PERFIL SAI, e não é remoção de recurso — é a mesma unificação de
-- 20260828194955 chegando aqui. Depois dela, "o perfil de um associado" e "o
-- público-alvo" são a MESMA coisa; oferecer as duas seria reabrir exatamente a
-- ambiguidade ("Associados" convivendo com "Produtores") que aquela migration
-- fechou. Categoria e Carteira continuam recusadas: não têm cadastro de apoio.
--
-- ----------------------------------------------------------------------------
-- ⚠️ POR QUE `chat_contacts` CONTINUA NO MEIO
-- ----------------------------------------------------------------------------
-- Toda a espinha de Enquetes se identifica por `chat_contacts.id`: destinatário
-- (`survey_recipients`), resposta (`survey_responses`), pedido de saída
-- (`survey_opt_outs`) e contexto da conversa (`survey_conversation_states`) —
-- quatro FKs, mais o caminho de entrada do chatbot.
--
-- Trocar essa identidade por `member_id` em todas elas seria reescrever o
-- módulo inteiro para resolver um problema de PÚBLICO. A saída é a que o
-- próprio esquema já tinha previsto: `members.contact_id`, cujo comentário em
-- 20260821000000 diz, textualmente, que é por ali que Enquetes vai poder
-- segmentar por "é associado".
--
-- Então esta migration LIGA essa ponte de verdade — a coluna existia e nunca
-- era preenchida — e passa a mantê-la por gatilho. `chat_contacts` é a AGENDA
-- (quem tem telefone), não a tela de Leads: aquela lê `csp_leads`, outra tabela.
--
-- A chave da ligação é `notification_phone_key` (últimos 11 dígitos), a mesma
-- que 20260828205853 criou para comparar `members.whatsapp` (sem DDI) com
-- `chat_contacts.phone` (com DDI). Uma chave só, já em uso.
--
-- DEPENDE DE: 20260819000300_estimate_audience.sql, 20260821000000_create_membership.sql,
--             20260828194955_unify_membership_profiles.sql, 20260828205853_event_dispatch.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A agenda ganha os associados
-- ----------------------------------------------------------------------------
-- Devolve o id de `chat_contacts` que representa este telefone, criando a linha
-- se ela não existir. Recebe CAMPOS, e não um id de associado, porque quem mais
-- a chama é um gatilho BEFORE — onde a linha ainda não está gravada.
--
-- ⚠️ SÓ PREENCHE VAZIO. Um associado que já era lead tem nome, cidade e UF
-- vindos da triagem; sobrescrevê-los com o cadastro faria uma correção feita à
-- mão em Associados apagar em silêncio o que a pessoa mesma tinha dito ao bot.
-- Preencher o que falta acrescenta; substituir o que existe decide por cima de
-- alguém.
create or replace function public.link_phone_book_entry(
  p_full_name text,
  p_phone text,
  p_city text,
  p_state text,
  p_current uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key text;
  v_id uuid;
  v_uf text;
begin
  v_key := public.notification_phone_key(p_phone);

  -- Sem telefone utilizável não há o que ligar — e inventar uma linha de agenda
  -- sem número criaria um destinatário que nunca poderia receber nada.
  if v_key is null or length(v_key) < 10 then
    return p_current;
  end if;

  -- `chat_contacts_state_len` exige exatamente duas letras. Um estado escrito
  -- por extenso na carga do cadastro legado derrubaria o gatilho inteiro.
  v_uf := upper(nullif(btrim(coalesce(p_state, '')), ''));
  if v_uf is not null and length(v_uf) <> 2 then
    v_uf := null;
  end if;

  -- O vínculo que já existe vale, desde que ainda seja do mesmo número. Se o
  -- associado trocou de telefone, a linha antiga é de outra pessoa a partir de
  -- agora — e continuar apontando para ela mandaria a enquete para quem herdou
  -- o número.
  if p_current is not null then
    select c.id into v_id
    from public.chat_contacts c
    where c.id = p_current
      and public.notification_phone_key(c.phone) = v_key;
  end if;

  if v_id is null then
    select c.id into v_id
    from public.chat_contacts c
    where public.notification_phone_key(c.phone) = v_key
    -- Empate acontece (a mesma pessoa cadastrada duas vezes pelo bot). A mais
    -- antiga vence: é ela que tem histórico de conversa pendurado.
    order by c.created_at, c.id
    limit 1;
  end if;

  if v_id is null then
    insert into public.chat_contacts (full_name, phone, city, state)
    values (
      nullif(btrim(coalesce(p_full_name, '')), ''),
      p_phone,
      nullif(btrim(coalesce(p_city, '')), ''),
      v_uf
    )
    returning id into v_id;

    return v_id;
  end if;

  update public.chat_contacts c
  set full_name = coalesce(c.full_name, nullif(btrim(coalesce(p_full_name, '')), '')),
      city      = coalesce(c.city, nullif(btrim(coalesce(p_city, '')), '')),
      state     = coalesce(c.state, v_uf),
      updated_at = now()
  where c.id = v_id
    and (c.full_name is null or c.city is null or c.state is null);

  return v_id;
end;
$fn$;

comment on function public.link_phone_book_entry(text, text, text, text, uuid) is
  'Devolve (criando se preciso) a linha de chat_contacts que representa este telefone. Chave: notification_phone_key. So preenche campo vazio.';

revoke execute on function public.link_phone_book_entry(text, text, text, text, uuid)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1.1 O gatilho que mantém a ponte viva
-- ----------------------------------------------------------------------------
-- ⚠️ BEFORE, E NÃO AFTER, POR UM MOTIVO CONCRETO. Um gatilho AFTER precisaria de
-- um `update public.members set contact_id = ...` — um UPDATE em `members`
-- disparado por um UPDATE em `members`. BEFORE atribui a `new.contact_id` e a
-- gravação sai junto com a linha, sem recursão possível.
--
-- Sem o gatilho, o associado cadastrado amanhã ficaria fora de toda enquete e
-- ninguém descobriria — o número simplesmente viria menor.
create or replace function public.members_link_phone_book()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  new.contact_id := public.link_phone_book_entry(
    new.full_name, new.whatsapp, new.city, new.state, new.contact_id
  );
  return new;
end;
$fn$;

comment on function public.members_link_phone_book() is
  'Mantem members.contact_id apontando para a agenda. BEFORE para nao precisar de UPDATE recursivo em members.';

drop trigger if exists members_link_phone_book on public.members;

create trigger members_link_phone_book
  before insert or update of full_name, whatsapp, city, state on public.members
  for each row
  execute function public.members_link_phone_book();

-- ----------------------------------------------------------------------------
-- 1.2 Backfill de quem já está cadastrado
-- ----------------------------------------------------------------------------
-- Em laço explícito, e não num UPDATE em massa que dispare o gatilho: o gatilho
-- só roda quando uma das colunas vigiadas muda, e aqui nenhuma muda.
do $backfill$
declare
  v_membro record;
  v_ligados integer := 0;
begin
  for v_membro in
    select id, full_name, whatsapp, city, state
    from public.members
    where contact_id is null
      and length(public.notification_phone_key(whatsapp)) >= 10
    order by created_at, id
  loop
    update public.members
    set contact_id = public.link_phone_book_entry(
      v_membro.full_name, v_membro.whatsapp, v_membro.city, v_membro.state, null
    )
    where id = v_membro.id;

    v_ligados := v_ligados + 1;
  end loop;

  raise notice 'Agenda: % associados ligados a chat_contacts.', v_ligados;
end;
$backfill$;

-- ----------------------------------------------------------------------------
-- 2. A regra do público, agora sobre associados
-- ----------------------------------------------------------------------------
-- Mesma forma do §31 — OR dentro da dimensão, AND entre dimensões —, outra
-- entidade. A assinatura não muda: `estimate_audience_criteria` e
-- `resolve_survey_audience` continuam chamando o que chamavam.
--
-- ⚠️ O `distinct on (chave de telefone)` É O MESMO DE `start_broadcast`, e pela
-- mesma razão: dois cadastros com o mesmo WhatsApp são uma pessoa, e ela não
-- pode receber a enquete duas vezes nem contar duas vezes na participação.
--
-- SECURITY INVOKER: a RLS de `members` continua valendo. Quem não pode ler
-- associados não descobre por aqui quantos a APCS tem.
create or replace function public.resolve_audience_criteria(p_criteria jsonb)
returns table (contact_id uuid, full_name text, phone text)
language sql
stable
set search_path = ''
as $$
  with k as (
    select
      c->>'dimension' as dimension,
      nullif(c->>'segmentId', '')::uuid as segment_id,
      nullif(c->>'contactId', '')::uuid as contact_id,
      nullif(btrim(c->>'value'), '') as value
    from jsonb_array_elements(coalesce(p_criteria, '[]'::jsonb)) as c
  ),
  -- §25 PÚBLICO-ALVO → o perfil de associado que cada público representa. O elo
  -- mora em `profile_for_event_segment`, num lugar só — e ela devolve NULL para
  -- atalho e para público aposentado, que aqui simplesmente não filtram nada.
  perfis as (
    select distinct public.profile_for_event_segment(s.slug) as profile_type
    from k
    join public.event_segments s on s.id = k.segment_id
    where k.dimension = 'segment'
      and public.profile_for_event_segment(s.slug) is not null
  ),
  base as (
    select distinct on (public.notification_phone_key(m.whatsapp))
      m.contact_id as contact_id, m.full_name as full_name, m.whatsapp as phone
    from public.members m
    where m.status = 'active'
      -- A ponte da seção 1. Sem ela não há para onde apontar destinatário,
      -- resposta e pedido de saída — as quatro tabelas se identificam por aqui.
      and m.contact_id is not null
      and length(public.notification_phone_key(m.whatsapp)) >= 10
      and (
        -- §24. O atalho "toda a base" dispensa os demais critérios.
        exists (select 1 from k where k.dimension = 'all')
        or (
          -- §25 PÚBLICO-ALVO
          (
            not exists (select 1 from k where k.dimension = 'segment')
            or m.profile_type in (select p.profile_type from perfis p)
          )
          -- §27 REGIÃO → a UF do associado.
          and (
            not exists (select 1 from k where k.dimension = 'region')
            or exists (
              select 1 from k
              where k.dimension = 'region' and upper(k.value) = upper(m.state)
            )
          )
          -- §30 GRUPO ESPECÍFICO → associados escolhidos a dedo.
          and (
            not exists (select 1 from k where k.dimension = 'contact')
            or exists (
              select 1 from k where k.dimension = 'contact' and k.contact_id = m.contact_id
            )
          )
          -- Sem nenhum critério resolvível o público é vazio, e não "todos".
          -- ⚠️ `profile` NÃO ENTRA NESTA LISTA de propósito: uma enquete antiga
          -- que só tenha critérios de Perfil resolve para NINGUÉM em vez de
          -- resolver para a base inteira. Errar para menos é recuperável; errar
          -- para mais já saiu no WhatsApp de todo mundo.
          and exists (
            select 1 from k where k.dimension in ('segment', 'region', 'contact')
          )
        )
      )
    order by public.notification_phone_key(m.whatsapp), m.created_at, m.id
  )
  select b.contact_id, b.full_name, b.phone
  from base b
  order by b.full_name nulls last, b.contact_id;
$$;

comment on function public.resolve_audience_criteria(jsonb) is
  'A regra do §31 (OR dentro da dimensao, AND entre dimensoes) sobre ASSOCIADOS ATIVOS com WhatsApp — a mesma base de start_broadcast.';

revoke execute on function public.resolve_audience_criteria(jsonb) from public, anon;
grant execute on function public.resolve_audience_criteria(jsonb) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2.1 O invólucro por enquete precisa levar o público-alvo junto
-- ----------------------------------------------------------------------------
-- ⚠️ O BUG QUE ESTA RECRIAÇÃO EVITA: o corpo de 20260819000300 montava o jsonb
-- com 'dimension', 'contactId' e 'value' — sem 'segmentId', porque a dimensão
-- `segment` era recusada e nunca chegava aqui. Agora ela chega, e sem esta
-- linha o agendamento fotografaria um público-alvo NULO: a estimativa mostraria
-- 312 e a fila sairia com a base inteira.
create or replace function public.resolve_survey_audience(p_survey_id uuid)
returns table (contact_id uuid, full_name text, phone text)
language sql
stable
set search_path = ''
as $$
  select r.contact_id, r.full_name, r.phone
  from public.resolve_audience_criteria((
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'dimension', k.dimension,
        'segmentId', k.segment_id,
        'contactId', k.contact_id,
        'value', k.value
      )),
      '[]'::jsonb
    )
    from public.survey_audience_criteria k
    where k.survey_id = p_survey_id
  )) r;
$$;

comment on function public.resolve_survey_audience(uuid) is
  'O publico de uma enquete gravada. Delega a resolve_audience_criteria — uma implementacao so (§31).';

-- ----------------------------------------------------------------------------
-- 3. Público-alvo entra; Perfil sai
-- ----------------------------------------------------------------------------
create or replace function public.assert_survey_audience(p_survey_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_blocked text;
begin
  if not exists (
    select 1 from public.survey_audience_criteria where survey_id = p_survey_id
  ) then
    raise exception 'Defina o público-alvo da enquete antes de agendá-la.'
      using errcode = 'SV006';
  end if;

  -- ⚠️ `segment` SAIU DESTA LISTA — é o cadastro de associados que chegou. Ver o
  -- cabeçalho: era exatamente isto que o GAP 1 esperava.
  select string_agg(distinct
    case dimension
      when 'category' then 'Categoria'
      when 'portfolio' then 'Carteira'
      when 'profile' then 'Perfil'
    end, ', ' order by
    case dimension
      when 'category' then 'Categoria'
      when 'portfolio' then 'Carteira'
      when 'profile' then 'Perfil'
    end)
  into v_blocked
  from public.survey_audience_criteria
  where survey_id = p_survey_id
    and dimension in ('category', 'portfolio', 'profile');

  if v_blocked is not null then
    raise exception
      'A segmentação por % não é mais usada. O perfil do associado virou o Público-alvo (Criadores, Empresas, Técnicos, Universidades); use ele, Região, associados específicos ou Toda a base.',
      v_blocked
      using errcode = 'SV007';
  end if;
end;
$$;

revoke execute on function public.assert_survey_audience(uuid) from public;
grant execute on function public.assert_survey_audience(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3.1 As enquetes em rascunho que estavam com o Perfil antigo
-- ----------------------------------------------------------------------------
-- ⚠️ SÓ RASCUNHO. Uma enquete agendada ou ativa já teve o público FOTOGRAFADO
-- (`survey_recipients`); os critérios dela são registro do que foi decidido, e
-- apagá-los reescreveria a história de uma campanha que já saiu.
--
-- No rascunho é o contrário: o critério só serviria para dar erro no
-- agendamento, com uma mensagem sobre uma dimensão que a tela nem oferece mais.
do $limpa$
declare
  v_apagados integer;
begin
  delete from public.survey_audience_criteria k
  using public.surveys s
  where s.id = k.survey_id
    and s.status = 'draft'
    and k.dimension = 'profile';

  get diagnostics v_apagados = row_count;

  if v_apagados > 0 then
    raise notice 'Enquetes: % criterios de Perfil removidos de rascunhos (agora e Publico-alvo).', v_apagados;
  end if;
end;
$limpa$;

-- ----------------------------------------------------------------------------
-- 4. Quem pediu para não receber nada não recebe enquete também
-- ----------------------------------------------------------------------------
-- ⚠️ DEFEITO IRMÃO DO DE 20260829020659. Aquele achou que o SAIR respondido a
-- uma divulgação de evento não tinha onde ser gravado. O bloqueio global
-- (`notification_opt_outs`, por telefone) passou a existir e Divulgações o
-- respeita — Enquetes não: `block_opted_out_recipients` só olhava
-- `survey_opt_outs`, que é o SAIR dito DENTRO de uma enquete.
--
-- Resultado: quem pediu para sair de tudo continuava recebendo enquete. Com o
-- público virando os associados, isso deixaria de ser teórico na primeira
-- campanha.
create or replace function public.block_opted_out_recipients(p_survey_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.survey_recipients r
  set status = 'error',
      last_error = 'Contato optou por não receber mensagens.'
  where r.survey_id = p_survey_id
    and r.status in ('pending', 'sending')
    and (
      exists (
        select 1 from public.survey_opt_outs o where o.contact_id = r.contact_id
      )
      or public.is_notification_blocked(r.contact_phone)
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.block_opted_out_recipients(uuid) is
  '§32/§33. Bloqueia quem optou por sair — da enquete (survey_opt_outs) ou de tudo (notification_opt_outs, por telefone) — antes do envio.';

revoke execute on function public.block_opted_out_recipients(uuid)
  from public, anon, authenticated;
grant execute on function public.block_opted_out_recipients(uuid) to service_role;

-- ============================================================================
-- A CONFERÊNCIA
-- ----------------------------------------------------------------------------
-- ⚠️ NÃO PERGUNTA "A FUNÇÃO EXISTE?" — PERGUNTA "O NÚMERO BATE?".
--
-- Foi um número que não batia (zero, com a base cheia) que trouxe esta
-- migration. A conferência que vale é a que reproduz esse número: para cada
-- público-alvo, o que `estimate_audience_criteria` responde tem de ser
-- exatamente quantos associados daquele perfil existem com WhatsApp.
--
-- Uma conferência que só olhasse `create function` deixaria passar a ponte não
-- preenchida — que é a forma real de esta migration falhar.
-- ============================================================================
do $checagem$
declare
  v_sem_ponte integer;
  v_segmento record;
  v_estimado integer;
  v_esperado integer;
  v_total integer := 0;
begin
  -- 1. Todo associado ativo com telefone utilizável está na agenda.
  select count(*) into v_sem_ponte
  from public.members m
  where m.status = 'active'
    and length(public.notification_phone_key(m.whatsapp)) >= 10
    and m.contact_id is null;

  if v_sem_ponte > 0 then
    raise exception
      '% associados ativos com WhatsApp ficaram sem linha na agenda. Enquete para eles alcancaria ninguem.',
      v_sem_ponte;
  end if;

  -- 2. Para cada público-alvo, a estimativa da tela = a contagem real.
  for v_segmento in
    select s.id, s.slug, s.name
    from public.event_segments s
    where s.active
      and public.profile_for_event_segment(s.slug) is not null
    order by s.slug
  loop
    select public.estimate_audience_criteria(
      jsonb_build_array(jsonb_build_object('dimension', 'segment', 'segmentId', v_segmento.id))
    ) into v_estimado;

    select count(distinct public.notification_phone_key(m.whatsapp))
    into v_esperado
    from public.members m
    where m.status = 'active'
      and m.contact_id is not null
      and length(public.notification_phone_key(m.whatsapp)) >= 10
      and m.profile_type = public.profile_for_event_segment(v_segmento.slug);

    if v_estimado is distinct from v_esperado then
      raise exception
        'Publico-alvo %: a estimativa devolveu % e a base tem %. A segmentacao nao esta lendo members.',
        v_segmento.name, v_estimado, v_esperado;
    end if;

    v_total := v_total + v_esperado;
    raise notice 'Publico-alvo %: % associados alcancaveis.', v_segmento.name, v_esperado;
  end loop;

  -- 3. "Toda a base" alcança pelo menos o que os públicos somam.
  select public.estimate_audience_criteria(
    jsonb_build_array(jsonb_build_object('dimension', 'all'))
  ) into v_estimado;

  if v_estimado < v_total then
    raise exception
      'Toda a base devolveu %, menor que a soma dos publicos (%). A dimensao `all` esta filtrando demais.',
      v_estimado, v_total;
  end if;

  raise notice 'Enquetes: toda a base alcanca % associados.', v_estimado;
end;
$checagem$;

-- ============================================================================
-- ROLLBACK (manual)
-- ----------------------------------------------------------------------------
--   drop trigger if exists members_link_phone_book on public.members;
--   drop function if exists public.members_link_phone_book();
--   drop function if exists public.link_phone_book_entry(text, text, text, text, uuid);
--   -- e devolver os corpos de `resolve_audience_criteria`,
--   -- `resolve_survey_audience` e `assert_survey_audience` de
--   -- 20260819000300_estimate_audience.sql / 20260819000000_create_surveys.sql
--
-- ⚠️ O QUE O ROLLBACK NÃO DESFAZ: as linhas criadas em `chat_contacts` e o
-- vínculo em `members.contact_id`. Apagá-las quebraria FK de destinatário e de
-- resposta de qualquer enquete disparada nesse meio-tempo. Elas são agenda —
-- ficam.
-- ============================================================================
