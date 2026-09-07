-- ============================================================================
-- O BANNER DE CONFIRMAÇÃO — E O FIM DOS TEXTOS EDITÁVEIS DA LANDING PAGE
-- ============================================================================
-- Pedido do cliente, depois do go live: a página de inscrição deixa de ter
-- texto solto. Nome, data, hora e local já tinham saído da tela e passado para
-- o banner (ver o cabeçalho de src/app/eventos/[slug]/page.tsx). Agora saem os
-- dois blocos que restavam:
--
--   * a DESCRIÇÃO, que ficava abaixo da arte;
--   * a MENSAGEM APÓS A INSCRIÇÃO — título, mensagem e rodapé —, que era a tela
--     inteira de confirmação.
--
-- No lugar da segunda entra uma IMAGEM: o banner de confirmação. Quem monta a
-- página envia duas artes — a da inscrição e a da confirmação — e não escreve
-- mais nada.
--
-- ----------------------------------------------------------------------------
-- DECISÃO 1 — AS COLUNAS DE TEXTO FICAM. O QUE SAI É A ESCRITA.
-- ----------------------------------------------------------------------------
-- `description`, `success_title`, `success_message` e `success_footer` NÃO são
-- derrubadas. Elas têm conteúdo em produção, escrito por gente, e um drop de
-- coluna apagaria esse conteúdo sem volta para atender a um pedido de LAYOUT.
-- Se amanhã a decisão for outra, o texto continua lá.
--
-- O que muda é que nada mais escreve nelas:
--
--   * `create_event_landing_page` e `update_event_landing_page` perdem os
--     quatro parâmetros — as duas são recriadas abaixo com assinatura menor;
--   * o grant de UPDATE de cada uma das quatro é REVOGADO. Não é redundância
--     com o item anterior: as funções são SECURITY INVOKER, então o privilégio
--     de coluna é a barreira que vale mesmo se alguém escrever um UPDATE novo
--     por distração — inclusive direto pelo PostgREST.
--
-- ⚠️ E ISSO NÃO TIRA O TEXTO DA CONFIRMAÇÃO DE VEZ. O padrão da plataforma
-- (`app_settings`, editável em Configurações → Textos) continua existindo e
-- continua descendo na leitura pública: ele é o que a página mostra quando a
-- Landing Page ainda não tem banner de confirmação, e é o que um leitor de tela
-- recebe quando ela tem — porque um banner é uma imagem, e imagem não se lê.
--
-- ----------------------------------------------------------------------------
-- DECISÃO 2 — A SEGUNDA IMAGEM É UM TRIO DE COLUNAS, IGUAL À PRIMEIRA
-- ----------------------------------------------------------------------------
-- `success_image_path`, `success_image_mime`, `success_image_size_bytes`, com o
-- mesmo CHECK de "os três ou nenhum" que `image_path` já tem. Copiar a forma é
-- deliberado: a arte da página e a da confirmação passam pelo MESMO bucket, o
-- mesmo teto de 5 MB, a mesma inspeção de bytes no servidor e o mesmo
-- `discardReplacedImage`. Uma segunda forma de guardar imagem seria uma segunda
-- configuração para manter em dia.
--
-- ⚠️ UNIQUE NO CAMINHO, como em `image_path`. Duas linhas apontando para o
-- mesmo arquivo fariam `discardReplacedImage` apagar um arquivo ainda em uso —
-- ele pergunta "alguém ainda referencia este caminho?" antes de remover, e a
-- resposta precisa ser confiável.
--
-- ----------------------------------------------------------------------------
-- DECISÃO 3 — A LEITURA PÚBLICA PERDE O QUE A PÁGINA NÃO DESENHA MAIS
-- ----------------------------------------------------------------------------
-- `get_public_event_landing_page` deixa de devolver `description`,
-- `successTitle`, `successMessage` e `successFooter`, e passa a devolver
-- `successImagePath`. O princípio é o do cabeçalho de 20260924000000: o que a
-- porta pública não devolve não pode vazar. Campo que a tela não usa mais e
-- continua no jsonb é campo que desce para o navegador sem ninguém notar.
--
-- ⚠️ `successDefaults` CONTINUA. Ver a decisão 1: ele é o fallback e o texto
-- alternativo do banner, não um resquício.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. As colunas do banner de confirmação
-- ----------------------------------------------------------------------------
alter table public.event_landing_pages
  add column if not exists success_image_path text,
  add column if not exists success_image_mime text,
  add column if not exists success_image_size_bytes integer;

comment on column public.event_landing_pages.success_image_path is
  'Caminho no bucket events do banner exibido apos a inscricao. Nulo = usa o texto padrao da plataforma.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'event_landing_pages_success_image_path_key'
  ) then
    alter table public.event_landing_pages
      add constraint event_landing_pages_success_image_path_key unique (success_image_path);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'event_landing_pages_success_image'
  ) then
    alter table public.event_landing_pages
      add constraint event_landing_pages_success_image
      check (
        (success_image_path is null and success_image_mime is null and success_image_size_bytes is null)
        or (success_image_path is not null and success_image_mime is not null and success_image_size_bytes is not null)
      );
  end if;
end
$$;


-- ----------------------------------------------------------------------------
-- 2. Os privilégios de coluna
-- ----------------------------------------------------------------------------
-- ⚠️ ESTA TABELA TEM GRANT POR COLUNA (ver a seção 6 de 20260922000100), e é
-- exatamente a armadilha que `src/test/sql-column-grants.test.ts` existe para
-- pegar: coluna nova sem grant não falha na migration — falha no navegador de
-- quem usa o sistema, com 42501, e o sintoma aponta para o RBAC.
grant update (
  success_image_path,
  success_image_mime,
  success_image_size_bytes
) on public.event_landing_pages to authenticated;

-- E o caminho inverso, pela decisão 1: os quatro textos deixam de ser graváveis.
revoke update (
  description,
  success_title,
  success_message,
  success_footer
) on public.event_landing_pages from authenticated;


-- ----------------------------------------------------------------------------
-- 3. Gravar o banner de confirmação
-- ----------------------------------------------------------------------------
-- Gêmea de `set_event_landing_page_image`, e SECURITY INVOKER como ela: a RLS e
-- os grants de coluna continuam valendo por dentro, e a checagem de papel no
-- topo existe para devolver um erro legível em vez de "permission denied".
--
-- ⚠️ `p_success_image_path` NULO SIGNIFICA REMOVER, e é assim que o botão
-- "Remover" funciona. Não há ambiguidade porque os três parâmetros andam juntos
-- — é o mesmo CHECK da seção 1 escrito na assinatura.
create or replace function public.set_event_landing_page_success_image(
  p_landing_page_id uuid,
  p_success_image_path text,
  p_success_image_mime text,
  p_success_image_size_bytes integer
)
returns public.event_landing_pages
language plpgsql
set search_path = ''
as $$
declare
  v_old public.event_landing_pages;
  v_new public.event_landing_pages;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Sem permissão para alterar páginas de inscrição.' using errcode = '42501';
  end if;

  perform public.lock_event_landing_page(p_landing_page_id);

  select * into v_old from public.event_landing_pages where id = p_landing_page_id;
  if not found then
    raise exception 'Página de inscrição não encontrada.' using errcode = 'P0002';
  end if;

  update public.event_landing_pages
  set success_image_path = p_success_image_path,
      success_image_mime = p_success_image_mime,
      success_image_size_bytes = p_success_image_size_bytes,
      updated_by = (select auth.uid())
  where id = p_landing_page_id
  returning * into v_new;

  if v_old.success_image_path is distinct from v_new.success_image_path then
    insert into public.event_audit_logs (event_id, action, metadata)
    values (
      v_new.event_id,
      'landing_page_updated',
      jsonb_build_object(
        'landingPageId', v_new.id,
        'changes', jsonb_build_array(
          jsonb_build_object(
            'field', 'successImage',
            'from', v_old.success_image_path,
            'to', v_new.success_image_path
          )
        )
      )
    );
  end if;

  return v_new;
end;
$$;

revoke execute on function
  public.set_event_landing_page_success_image(uuid, text, text, integer)
  from public, anon;
grant execute on function
  public.set_event_landing_page_success_image(uuid, text, text, integer)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 4. Criar e editar, sem os quatro textos
-- ----------------------------------------------------------------------------
-- ⚠️ DROP E RECRIA, E NÃO `create or replace`. Tirar parâmetros muda a
-- assinatura, e `create or replace` deixaria as DUAS versões no banco,
-- sobrecarregadas. Uma chamada por nome de argumento — que é como o supabase-js
-- chama — ficaria ambígua entre elas (42725). É a mesma decisão que
-- 20260924000000 documenta para `create_event_registration`.
--
-- ⚠️ O CORPO É O DE 20260922000100, com os quatro campos fora do INSERT/UPDATE
-- e fora do diff da auditoria. Nada mais muda: o slug continua sendo resolvido
-- pelo banco, a capacidade continua não podendo cair abaixo do número de
-- inscritos, e a trilha continua indo para `event_audit_logs`.
drop function if exists public.create_event_landing_page(
  uuid, text, text, jsonb, text, text, text, timestamptz, integer
);

create or replace function public.create_event_landing_page(
  p_event_id uuid,
  p_slug text default null,
  p_form_fields jsonb default null,
  p_closes_at timestamptz default null,
  p_max_participants integer default null
)
returns public.event_landing_pages
language plpgsql
set search_path = ''
as $$
declare
  v_event public.events;
  v_page public.event_landing_pages;
  v_fields jsonb := coalesce(
    p_form_fields,
    '["GRANJA_EMPRESA", "EMAIL", "NOME_PARTICIPANTE", "TELEFONE", "WHATSAPP"]'::jsonb
  );
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Sem permissão para criar páginas de inscrição.' using errcode = '42501';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- ⚠️ A MENSAGEM CERTA PARA O §3. O unique de `event_id` já impediria a
  -- segunda página, mas com 23505 — verdadeiro e inútil. Esta checagem é para o
  -- texto; a garantia continua sendo a constraint, que é quem vence a corrida
  -- entre duas abas.
  if exists (select 1 from public.event_landing_pages l where l.event_id = p_event_id) then
    raise exception 'Este evento já tem uma página de inscrição.' using errcode = 'LP005';
  end if;

  perform public.assert_event_landing_fields(v_fields);

  insert into public.event_landing_pages (
    event_id, slug, form_fields, closes_at, max_participants
  ) values (
    p_event_id,
    -- Nasce a partir do NOME DO EVENTO quando ninguém digitou um endereço (§6).
    public.event_landing_free_slug(coalesce(nullif(btrim(p_slug), ''), v_event.name)),
    v_fields,
    p_closes_at,
    p_max_participants
  )
  returning * into v_page;

  -- ⚠️ NA TRILHA DO EVENTO, e não numa trilha de landing pages: publicar a
  -- página de inscrição é decisão de quem responde pela agenda, e é na tela do
  -- evento que ela precisa ser lida.
  insert into public.event_audit_logs (event_id, action, metadata)
  values (
    p_event_id,
    'landing_page_created',
    jsonb_build_object('landingPageId', v_page.id, 'slug', v_page.slug)
  );

  return v_page;
end;
$$;

revoke execute on function
  public.create_event_landing_page(uuid, text, jsonb, timestamptz, integer)
  from public, anon;
grant execute on function
  public.create_event_landing_page(uuid, text, jsonb, timestamptz, integer)
  to authenticated;


drop function if exists public.update_event_landing_page(
  uuid, text, text, jsonb, text, text, text, timestamptz, integer
);

create or replace function public.update_event_landing_page(
  p_landing_page_id uuid,
  p_slug text,
  p_form_fields jsonb,
  p_closes_at timestamptz,
  p_max_participants integer
)
returns public.event_landing_pages
language plpgsql
set search_path = ''
as $$
declare
  v_old public.event_landing_pages;
  v_new public.event_landing_pages;
  v_changes jsonb := '[]'::jsonb;
  v_slug text;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Sem permissão para alterar páginas de inscrição.' using errcode = '42501';
  end if;

  perform public.lock_event_landing_page(p_landing_page_id);

  select * into v_old from public.event_landing_pages where id = p_landing_page_id;
  if not found then
    raise exception 'Página de inscrição não encontrada.' using errcode = 'P0002';
  end if;

  perform public.assert_event_landing_fields(p_form_fields);

  -- Slug vazio significa MANTER o atual. Passar o atual de volta também mantém:
  -- `event_landing_free_slug` recebe o id da própria página e não colide
  -- consigo mesma.
  v_slug := public.event_landing_free_slug(
    coalesce(nullif(btrim(p_slug), ''), v_old.slug),
    p_landing_page_id
  );

  -- ⚠️ REDUZIR A CAPACIDADE ABAIXO DE QUEM JÁ ESTÁ INSCRITO É RECUSADO. Aceitar
  -- deixaria a página num estado em que a contagem ultrapassa o limite — e
  -- ninguém saberia dizer se aquelas pessoas têm vaga ou não.
  if p_max_participants is not null
     and p_max_participants < public.event_landing_participant_count(p_landing_page_id) then
    raise exception 'A capacidade não pode ser menor que o número de participantes já inscritos.'
      using errcode = 'LP004';
  end if;

  update public.event_landing_pages
  set slug = v_slug,
      form_fields = p_form_fields,
      closes_at = p_closes_at,
      max_participants = p_max_participants,
      updated_by = (select auth.uid())
  where id = p_landing_page_id
  returning * into v_new;

  -- `is distinct from` e não `<>`: com NULL dos dois lados, `<>` devolve NULL e
  -- a mudança passaria despercebida.
  if v_old.slug is distinct from v_new.slug then
    v_changes := v_changes || jsonb_build_object('field', 'slug', 'from', v_old.slug, 'to', v_new.slug);
  end if;
  if v_old.form_fields is distinct from v_new.form_fields then
    v_changes := v_changes || jsonb_build_object('field', 'formFields', 'from', v_old.form_fields, 'to', v_new.form_fields);
  end if;
  if v_old.closes_at is distinct from v_new.closes_at then
    v_changes := v_changes || jsonb_build_object('field', 'closesAt', 'from', v_old.closes_at, 'to', v_new.closes_at);
  end if;
  if v_old.max_participants is distinct from v_new.max_participants then
    v_changes := v_changes || jsonb_build_object('field', 'maxParticipants', 'from', v_old.max_participants, 'to', v_new.max_participants);
  end if;

  if jsonb_array_length(v_changes) > 0 then
    insert into public.event_audit_logs (event_id, action, metadata)
    values (
      v_new.event_id,
      'landing_page_updated',
      jsonb_build_object('landingPageId', v_new.id, 'changes', v_changes)
    );
  end if;

  return v_new;
end;
$$;

revoke execute on function
  public.update_event_landing_page(uuid, text, jsonb, timestamptz, integer)
  from public, anon;
grant execute on function
  public.update_event_landing_page(uuid, text, jsonb, timestamptz, integer)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 5. A leitura pública
-- ----------------------------------------------------------------------------
-- ⚠️ O QUE ESTA FUNÇÃO NÃO DEVOLVE CONTINUA SENDO O PONTO. Ver o cabeçalho de
-- 20260924000000: ficam de fora `event_id`, os autores, a URL de divulgação, a
-- segmentação, a trilha e tudo de `event_registrations`/`event_participants`.
-- Saem agora, também, os quatro textos que a página não desenha mais.
--
-- `imagePath` e `successImagePath` são CAMINHOS NO BUCKET, e param no servidor:
-- quem chama assina a URL e manda para o navegador só a URL assinada.
create or replace function public.get_public_event_landing_page(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'landingPageId', l.id,
    'slug', l.slug,
    'status', l.status,
    -- A arte própria da página, ou o cartaz do evento quando ela não tem uma.
    -- A escolha acontece AQUI para as duas pontas não discordarem sobre qual
    -- imagem é "a da página".
    'imagePath', coalesce(l.image_path, e.image_path),
    -- ⚠️ SEM COALESCE COM O CARTAZ DO EVENTO. O banner de confirmação é uma
    -- arte diferente, com outra frase; cair no cartaz do evento mostraria a
    -- peça de divulgação como se fosse o comprovante. Sem banner próprio, a
    -- confirmação usa o TEXTO padrão — que é o que `successDefaults` carrega.
    'successImagePath', l.success_image_path,
    'formFields', l.form_fields,
    'closesAt', l.closes_at,
    'maxParticipants', l.max_participants,
    'participantCount', public.event_landing_participant_count(l.id),
    'event', jsonb_build_object(
      'name', e.name,
      'eventDate', e.event_date,
      'startTime', e.start_time,
      'endTime', e.end_time,
      'location', e.location
    ),
    -- ⚠️ O TEXTO PADRÃO DA PLATAFORMA VIAJA JUNTO (§25) e agora é o ÚNICO texto
    -- de confirmação que existe: a Landing Page não sobrescreve mais nada. Ele
    -- é o que aparece quando não há banner, e o que um leitor de tela recebe
    -- quando há. A substituição das variáveis continua em `resolveSuccessMessage`,
    -- a MESMA função que a prévia do Builder chama.
    'successDefaults', jsonb_build_object(
      'title', (select s.value from public.app_settings s
                 where s.key = 'events.registration_success_title'),
      'message', (select s.value from public.app_settings s
                   where s.key = 'events.registration_success_message'),
      'footer', (select s.value from public.app_settings s
                  where s.key = 'events.registration_success_footer')
    ),
    -- O texto de consentimento vigente (§35), lido da MESMA tabela que a
    -- landing de associação usa. Vem daqui, e não de uma segunda consulta, para
    -- a página inteira ser uma ida ao banco só (§33).
    'consent', (
      select jsonb_build_object('version', c.version, 'body', c.body)
      from public.consent_texts c
      order by c.created_at desc, c.version desc
      limit 1
    )
  )
  from public.event_landing_pages l
  join public.events e on e.id = l.event_id
  -- Rascunho e inativa não existem para o mundo. `closed` passa.
  where l.slug = lower(btrim(p_slug))
    and l.status in ('published', 'closed');
$$;

comment on function public.get_public_event_landing_page is
  'Landing Page publicada, pelo slug, com os campos publicos e nada mais. Chamada com service_role pela pagina /eventos/[slug].';

revoke execute on function public.get_public_event_landing_page(text)
  from public, anon, authenticated;
grant execute on function public.get_public_event_landing_page(text) to service_role;


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   drop function if exists public.set_event_landing_page_success_image(uuid, text, text, integer);
--   drop function if exists public.create_event_landing_page(uuid, text, jsonb, timestamptz, integer);
--   drop function if exists public.update_event_landing_page(uuid, text, jsonb, timestamptz, integer);
--   -- e recriar as versões de 9 parâmetros de 20260922000100_event_landing.sql
--   -- e a versão de get_public_event_landing_page de 20260924000000.
--   grant update (description, success_title, success_message, success_footer)
--     on public.event_landing_pages to authenticated;
--   alter table public.event_landing_pages
--     drop constraint if exists event_landing_pages_success_image,
--     drop constraint if exists event_landing_pages_success_image_path_key,
--     drop column if exists success_image_size_bytes,
--     drop column if exists success_image_mime,
--     drop column if exists success_image_path;
--
-- ⚠️ Derrubar `success_image_path` deixa os arquivos ÓRFÃOS no bucket `events`,
-- na pasta `<event_id>/landing/success/`. Eles não são apagados por cascata —
-- o Storage não sabe desta tabela. Limpe a pasta antes.
--
-- ⚠️ NENHUM TEXTO É APAGADO por esta migration. `description`, `success_title`,
-- `success_message` e `success_footer` continuam com o conteúdo que tinham; o
-- que saiu foi a permissão de escrever neles. Ver a decisão 1.
-- ============================================================================
