-- ============================================================================
-- A PORTA PÚBLICA DAS INSCRIÇÕES (Prompt 3)
-- ============================================================================
-- O Prompt 1 deixou o caminho desenhado e deliberadamente fechado: não existia
-- forma de ler uma Landing Page sem sessão, e `create_event_registration` já
-- previa a origem `landing_page` para quando ela existisse. Esta migration abre
-- essa porta — e só ela.
--
-- ----------------------------------------------------------------------------
-- DECISÃO 1 — A LEITURA PÚBLICA É UMA FUNÇÃO, NÃO UMA POLICY PARA `anon`
-- ----------------------------------------------------------------------------
-- A alternativa óbvia seria uma policy de SELECT liberando a leitura anônima das
-- páginas publicadas. Ela abriria o PostgREST: qualquer um com a chave anônima —
-- que é pública por definição, está no bundle do navegador — poderia listar
-- TODAS as páginas publicadas, escolher colunas e seguir os embeds até `events`.
-- E `events` teria de ganhar a sua própria liberação equivalente, o que exporia
-- um módulo inteiro do CRM para fora.
--
-- (E o teste `sql-event-landing` exige que NENHUMA policy deste módulo cite o
-- papel anônimo — inclusive esta frase teve de ser reescrita para não parecer
-- uma. A guarda é grosseira de propósito: é isso que a mantém sem falso
-- negativo.)
--
-- `get_public_event_landing_page` devolve UM jsonb, de UMA página, escolhida
-- pelo slug, com os campos que a página mostra e mais nenhum. Não há como pedir
-- outra coluna, não há como listar, não há como paginar. É o mesmo desenho de
-- `submit_membership_application`: quem chama é o SERVIDOR, com `service_role`,
-- e a autorização é a estreiteza da assinatura.
--
-- ----------------------------------------------------------------------------
-- DECISÃO 2 — `draft` E `inactive` NÃO EXISTEM PARA O MUNDO
-- ----------------------------------------------------------------------------
-- A função devolve zero linhas para as duas, e a página responde 404 (§4, §5).
-- Zero linhas, e não uma linha com um sinalizador: uma resposta que diz "esta
-- página existe, mas está em rascunho" confirma a existência de um evento que
-- ninguém deveria saber que está sendo preparado.
--
-- `closed` PASSA, e isso é o §4 também: a página encerrada continua visível, e
-- é a aplicação que troca o formulário pelo aviso. O encerramento por PRAZO ou
-- por LOTAÇÃO nem chega aqui — ele é derivado (`landingEffectiveStatus`), a
-- partir de `closes_at`, `max_participants` e da contagem, que vão no retorno.
--
-- ----------------------------------------------------------------------------
-- DECISÃO 3 — O CONSENTIMENTO É O MECANISMO QUE JÁ EXISTE (§35)
-- ----------------------------------------------------------------------------
-- A plataforma já tem `consent_texts`: append-only, versionada, legível por
-- `anon` de propósito (ver 20260830100000_admin_module.sql). O formulário de
-- associação a usa desde agosto. Inventar um segundo texto para eventos seria
-- exatamente o que o §35 proíbe.
--
-- O que faltava era onde GUARDAR a versão que a pessoa leu. É a coluna nova
-- `event_registrations.consent_policy_version` — e ela guarda a versão que
-- VIAJOU COM O ENVIO, não a vigente no instante da gravação. A diferença é a
-- mesma que `submitMembershipApplicationAction` documenta: se alguém publicar
-- um texto novo enquanto a granja preenche o formulário, a autorização vale
-- para o texto que estava na tela.
--
-- ----------------------------------------------------------------------------
-- DECISÃO 4 — LIMITE DE TAXA IGUAL AO DE ASSOCIADOS, E DEPOIS DA IDEMPOTÊNCIA
-- ----------------------------------------------------------------------------
-- `event_registrations.source_ip_hash` foi criada no Prompt 1 dizendo, no
-- comentário, que serviria "ao limite de taxa do formulário público (Prompt 3)".
-- É agora. A conta é a mesma de `submit_membership_application`: envios da mesma
-- origem na última hora, contra um teto que é uma função — para mudá-lo bastar
-- uma migration de uma linha.
--
-- ⚠️ A ORDEM É O QUE FAZ ISSO NÃO ATRAPALHAR QUEM É LEGÍTIMO. O limite roda
-- DEPOIS da conferência de idempotência: um F5 no meio do envio, um duplo
-- clique ou um retry de rede caem na chave de deduplicação e recebem a inscrição
-- que já existe — sem consumir cota. Só um envio de verdade conta.
--
-- E ele só vale para `landing_page`. Uma pessoa do comercial cadastrando doze
-- granjas de uma lista de papel, todas do mesmo escritório, não é abuso.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Onde a autorização fica guardada
-- ----------------------------------------------------------------------------
alter table public.event_registrations
  add column if not exists consent_policy_version text;

comment on column public.event_registrations.consent_policy_version is
  'Versao de consent_texts que a pessoa leu ao se inscrever. Nula quando a inscricao veio do backoffice.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_registrations_consent_version_format'
  ) then
    alter table public.event_registrations
      add constraint event_registrations_consent_version_format
      check (
        consent_policy_version is null
        or consent_policy_version ~ '^[0-9a-zA-Z._-]{3,40}$'
      );
  end if;
end
$$;


-- ----------------------------------------------------------------------------
-- 2. O teto de envios por origem, por hora
-- ----------------------------------------------------------------------------
-- Uma função, e não um número solto no corpo: mudar o teto vira uma migration
-- de uma linha, e o valor fica auditável em um lugar. Mesma forma de
-- `membership_ip_hourly_limit`.
--
-- ⚠️ O NÚMERO É MAIOR QUE O DE ASSOCIADOS (8), e não por acaso. Uma pessoa se
-- associa uma vez na vida; uma granja inscreve gente em vários eventos, e um
-- escritório de cooperativa pode inscrever várias granjas do mesmo IP na mesma
-- tarde. Um teto apertado aqui barraria uso legítimo — e a defesa principal
-- contra envio repetido não é esta, é a chave de deduplicação.
create or replace function public.event_registration_ip_hourly_limit()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 20;
$$;

comment on function public.event_registration_ip_hourly_limit is
  'Teto de inscricoes publicas por hash de IP por hora. Ver a decisao 4 de 20260924000000.';


-- ----------------------------------------------------------------------------
-- 3. A leitura pública, estreita por construção
-- ----------------------------------------------------------------------------
-- ⚠️ O QUE ESTA FUNÇÃO NÃO DEVOLVE É TÃO IMPORTANTE QUANTO O QUE ELA DEVOLVE.
--
-- Ficam de fora: `event_id` (a página pública não precisa dele — ela envia o
-- SLUG, e o servidor deriva o resto), `created_by`/`updated_by`/`published_by`
-- (nomes de gente da APCS), `registration_url` e a segmentação do evento (a
-- operação interna de divulgação), a trilha de auditoria, e qualquer coisa de
-- `event_registrations` ou `event_participants` — que é dado pessoal de
-- terceiros e não tem por que atravessar esta fronteira (§33).
--
-- `participantCount` sai como NÚMERO, e é o único fato agregado que escapa: sem
-- ele não dá para dizer "vagas esgotadas" (§28). Ele não identifica ninguém.
--
-- `imagePath` é o CAMINHO NO BUCKET, e ele para no servidor: quem chama assina
-- a URL e manda para o navegador só a URL assinada. Mesma decisão de
-- `LandingPageSummary`, que não tem `imagePath` por isso.
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
    'description', l.description,
    -- A arte própria da página, ou o cartaz do evento quando ela não tem uma.
    -- A escolha acontece AQUI para as duas pontas não discordarem sobre qual
    -- imagem é "a da página".
    'imagePath', coalesce(l.image_path, e.image_path),
    'formFields', l.form_fields,
    'successTitle', l.success_title,
    'successMessage', l.success_message,
    'successFooter', l.success_footer,
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
    -- ⚠️ O TEXTO PADRÃO DA PLATAFORMA VIAJA JUNTO (§25). A resolução final —
    -- qual pedaço vem da página e qual vem do padrão — é feita por
    -- `resolveSuccessMessage`, a MESMA função que a prévia do Builder chama.
    -- Fazer a coalescência aqui no SQL criaria uma segunda regra, e as duas
    -- telas passariam a poder discordar sobre o que a pessoa vê.
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
  -- Decisão 2: rascunho e inativa não existem para o mundo. `closed` passa.
  where l.slug = lower(btrim(p_slug))
    and l.status in ('published', 'closed');
$$;

comment on function public.get_public_event_landing_page is
  'Landing Page publicada, pelo slug, com os campos publicos e nada mais. Chamada com service_role pela pagina /eventos/[slug].';

-- ⚠️ SÓ O SERVIDOR. `anon` não executa: se executasse, a chave anônima que vai
-- no bundle do navegador viraria uma API de consulta de eventos.
revoke execute on function public.get_public_event_landing_page(text)
  from public, anon, authenticated;
grant execute on function public.get_public_event_landing_page(text) to service_role;


-- ----------------------------------------------------------------------------
-- 4. A criação da inscrição, agora com consentimento e limite de taxa
-- ----------------------------------------------------------------------------
-- ⚠️ `drop` E RECRIA, E NÃO `create or replace`. Acrescentar um parâmetro muda a
-- assinatura: `create or replace` criaria uma SEGUNDA função sobrecarregada, e
-- uma chamada por nome com parâmetros omitidos ficaria ambígua entre as duas
-- (42725). Derrubar a antiga é o que garante que existe uma só.
--
-- ⚠️ O CORPO É O DO PROMPT 1, com dois trechos novos (o limite de taxa na etapa
-- 3 e o consentimento na etapa 4) e a coluna nova na gravação. As nove etapas
-- originais continuam na mesma ordem e pelos mesmos motivos — em especial a
-- idempotência ANTES de tudo e a capacidade sob o lock.
drop function if exists public.create_event_registration(uuid, text, jsonb, text, text, text);

create or replace function public.create_event_registration(
  p_landing_page_id uuid,
  p_company_name text,
  p_participants jsonb,
  p_dedupe_key text,
  p_source_ip_hash text default null,
  p_user_agent text default null,
  p_consent_policy_version text default null
)
returns table (registration_id uuid, participant_count integer, duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_writer boolean := public.registrations_is_writer();
  v_actor uuid := (select auth.uid());
  v_origin public.event_registration_origin;
  v_page public.event_landing_pages;
  v_existing public.event_registrations;
  v_new public.event_registrations;
  v_people jsonb;
  v_count integer;
  v_taken text;
  v_seats integer;
  v_recent integer;
begin
  -- 1. Quem está chamando. Administrador pela tela, ou o servidor pela página
  --    pública (sem sessão, com `service_role`). Não há terceira porta.
  if v_is_writer then
    v_origin := 'backoffice';
  elsif v_actor is null then
    v_origin := 'landing_page';
  else
    raise exception 'Sem permissão para criar inscrições.' using errcode = '42501';
  end if;

  -- 2. IDEMPOTÊNCIA — antes de tudo, INCLUSIVE antes do limite de taxa. Ver a
  --    decisão 4: um F5 não pode consumir cota de quem está só reenviando.
  select * into v_existing
  from public.event_registrations r
  where r.dedupe_key = p_dedupe_key;

  if found then
    return query
      select v_existing.id,
             (select count(*)::integer
              from public.event_participants p
              where p.registration_id = v_existing.id),
             true;
    return;
  end if;

  -- 3. Limite de taxa — só na porta pública, e só quando há hash de IP. Sem
  --    hash não há o que contar, e recusar por ausência de cabeçalho barraria
  --    gente atrás de proxy legítimo (ver `clientIpHashFromHeaders`).
  if v_origin = 'landing_page' and p_source_ip_hash is not null then
    select count(*) into v_recent
    from public.event_registrations r
    where r.source_ip_hash = p_source_ip_hash
      and r.origin = 'landing_page'
      and r.created_at > now() - interval '1 hour';

    if v_recent >= public.event_registration_ip_hourly_limit() then
      raise exception 'Muitos envios a partir deste acesso. Tente novamente mais tarde.'
        using errcode = 'RG007';
    end if;
  end if;

  -- 4. Consentimento (§35 do Prompt 3). Obrigatório pela porta PÚBLICA, onde a
  --    pessoa lê o texto e marca a caixa; dispensado no backoffice, onde quem
  --    digita é a APCS a partir de uma lista, e não o titular do dado.
  --
  --    ⚠️ A VERSÃO NÃO É LIDA AQUI DENTRO. Ela chega de fora porque é a que
  --    estava na tela — ler a vigente agora gravaria uma autorização para um
  --    texto que a pessoa nunca viu.
  if v_origin = 'landing_page' and coalesce(btrim(p_consent_policy_version), '') = '' then
    raise exception 'É preciso aceitar o tratamento dos dados para concluir a inscrição.'
      using errcode = 'RG008';
  end if;

  -- 5. A página existe e está aceitando (§17 do Prompt 1).
  perform public.lock_event_landing_page(p_landing_page_id);

  select * into v_page
  from public.event_landing_pages l
  where l.id = p_landing_page_id;

  if not found then
    raise exception 'Página de inscrição não encontrada.' using errcode = 'P0002';
  end if;

  if v_page.status <> 'published' then
    raise exception 'As inscrições para este evento não estão abertas.' using errcode = 'LP001';
  end if;

  if v_page.closes_at is not null and now() > v_page.closes_at then
    raise exception 'O prazo de inscrição para este evento já encerrou.' using errcode = 'RG001';
  end if;

  -- 6. Normaliza os participantes UMA VEZ, e todo o resto trabalha sobre o
  --    resultado. Normalizar em cada checagem é como duas delas passam a
  --    discordar sobre o que é "o mesmo e-mail".
  --
  --    ⚠️ O E-MAIL VAI PARA MINÚSCULAS AQUI. É disso que o índice único do §12
  --    depende: "Joao@x.com" e "joao@x.com" são a mesma pessoa, e um índice
  --    sobre a coluna crua deixaria as duas entrarem.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'fullName', btrim(coalesce(e.value ->> 'fullName', '')),
             'email', lower(btrim(coalesce(e.value ->> 'email', ''))),
             'phone', nullif(regexp_replace(coalesce(e.value ->> 'phone', ''), '[^0-9]', '', 'g'), ''),
             'whatsapp', nullif(regexp_replace(coalesce(e.value ->> 'whatsapp', ''), '[^0-9]', '', 'g'), '')
           )
         ), '[]'::jsonb)
    into v_people
  from jsonb_array_elements(
         case when jsonb_typeof(p_participants) = 'array' then p_participants else '[]'::jsonb end
       ) as e(value);

  v_count := jsonb_array_length(v_people);

  if v_count = 0 then
    raise exception 'Informe ao menos um participante.' using errcode = 'RG006';
  end if;

  -- 7. Cada participante tem nome, e-mail e ao menos um contato (§8, §17).
  if exists (
    select 1 from jsonb_array_elements(v_people) as e(value)
    where char_length(e.value ->> 'fullName') < 2
       or (e.value ->> 'email') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    raise exception 'Informe nome e e-mail válidos para cada participante.' using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_people) as e(value)
    where e.value ->> 'phone' is null and e.value ->> 'whatsapp' is null
  ) then
    raise exception 'Informe telefone ou WhatsApp para cada participante.' using errcode = 'RG005';
  end if;

  -- 8. Duplicidade DENTRO da própria requisição (§12, §19 do Prompt 3).
  select e.value ->> 'email' into v_taken
  from jsonb_array_elements(v_people) as e(value)
  group by e.value ->> 'email'
  having count(*) > 1
  limit 1;

  if v_taken is not null then
    raise exception 'O e-mail % aparece mais de uma vez nesta inscrição.', v_taken
      using errcode = 'RG004';
  end if;

  -- 9. Duplicidade contra o que JÁ EXISTE no evento (§12, §18 do Prompt 3).
  --
  --    ⚠️ ESTA CHECAGEM É PELA MENSAGEM, NÃO PELA GARANTIA. Duas requisições
  --    simultâneas com o mesmo e-mail passam as duas por aqui; quem recusa a
  --    segunda é o índice `event_participants_event_email_idx`, com 23505. O
  --    que se ganha aqui é poder DIZER QUAL e-mail é o problema — coisa que a
  --    violação de índice não sabe fazer.
  select p.email into v_taken
  from public.event_participants p
  join public.event_registrations r on r.id = p.registration_id
  where p.event_id = v_page.event_id
    and r.status = 'active'
    and p.email in (select e.value ->> 'email' from jsonb_array_elements(v_people) as e(value))
  limit 1;

  if v_taken is not null then
    raise exception 'O e-mail % já está inscrito neste evento.', v_taken
      using errcode = 'RG003';
  end if;

  -- 10. Capacidade (§14, §15 do Prompt 1; §12, §22 do Prompt 3). Sob o lock da
  --     etapa 5 — é o lock que impede duas inscrições simultâneas de lerem a
  --     mesma contagem e caberem as duas.
  if v_page.max_participants is not null then
    v_seats := v_page.max_participants
             - public.event_landing_participant_count(v_page.id);

    if v_count > v_seats then
      raise exception 'Não há vagas suficientes: restam % para este evento.', greatest(v_seats, 0)
        using errcode = 'RG002';
    end if;
  end if;

  -- 11. A gravação. `on conflict do nothing` fecha a corrida entre dois envios
  --     idênticos que passaram juntos pela etapa 2.
  insert into public.event_registrations (
    event_id, landing_page_id, company_name, origin, dedupe_key,
    source_ip_hash, user_agent, consent_policy_version, created_by, updated_by
  ) values (
    v_page.event_id,
    v_page.id,
    btrim(p_company_name),
    v_origin,
    p_dedupe_key,
    p_source_ip_hash,
    left(coalesce(p_user_agent, ''), 400),
    nullif(btrim(coalesce(p_consent_policy_version, '')), ''),
    v_actor,
    v_actor
  )
  on conflict (dedupe_key) do nothing
  returning * into v_new;

  if v_new.id is null then
    -- O outro envio ganhou a corrida. A inscrição dele é a resposta dos dois.
    select * into v_existing
    from public.event_registrations r
    where r.dedupe_key = p_dedupe_key;

    return query
      select v_existing.id,
             (select count(*)::integer
              from public.event_participants p
              where p.registration_id = v_existing.id),
             true;
    return;
  end if;

  insert into public.event_participants (
    registration_id, event_id, full_name, email, phone, whatsapp
  )
  select v_new.id,
         v_new.event_id,
         e.value ->> 'fullName',
         e.value ->> 'email',
         e.value ->> 'phone',
         e.value ->> 'whatsapp'
  from jsonb_array_elements(v_people) as e(value);

  -- ⚠️ SEM DADO PESSOAL NA TRILHA (§29 do Prompt 1, §37 do Prompt 3): quantos, e
  -- não quem. O "quem" está em `event_participants`, sob RLS, e é de lá que ele
  -- sai quando alguém pede exclusão. Copiá-lo aqui criaria uma segunda cópia
  -- que ninguém lembraria de apagar.
  --
  -- A versão do consentimento ENTRA: ela não identifica ninguém e é a prova de
  -- qual texto valia no instante da inscrição.
  insert into public.event_registration_audit_logs (
    registration_id, event_id, action, actor_id, metadata
  ) values (
    v_new.id,
    v_new.event_id,
    'registration_created',
    v_actor,
    jsonb_build_object(
      'landingPageId', v_page.id,
      'origin', v_origin,
      'participants', v_count,
      'consentPolicyVersion', v_new.consent_policy_version
    )
  );

  return query select v_new.id, v_count, false;
end;
$$;

-- ⚠️ EXECUTE REVOGADO DE `public` E `anon`, como na versão anterior. Quem chama
-- pelo caminho público é o SERVIDOR com `service_role` — que não passa por grant
-- —, e não o navegador de quem se inscreve. `authenticated` mantém o EXECUTE
-- porque o backoffice inscreve gente pela tela; a função confere o papel por
-- dentro.
--
-- Reaplicado aqui porque o `drop` acima levou os grants da função antiga junto.
revoke execute on function
  public.create_event_registration(uuid, text, jsonb, text, text, text, text)
  from public, anon;
grant execute on function
  public.create_event_registration(uuid, text, jsonb, text, text, text, text)
  to authenticated;


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   drop function if exists public.get_public_event_landing_page(text);
--   drop function if exists public.event_registration_ip_hourly_limit();
--   drop function if exists public.create_event_registration(uuid, text, jsonb, text, text, text, text);
--   -- e recriar a versão de 6 parâmetros de 20260922000100_event_landing.sql
--   alter table public.event_registrations
--     drop constraint if exists event_registrations_consent_version_format;
--   alter table public.event_registrations drop column if exists consent_policy_version;
--
-- ⚠️ Derrubar a coluna APAGA A PROVA de qual texto de consentimento cada granja
-- leu. Faça isso só se as inscrições públicas também forem embora.
-- ============================================================================
