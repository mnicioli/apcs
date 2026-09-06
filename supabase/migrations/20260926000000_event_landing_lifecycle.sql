-- ============================================================================
-- HOMOLOGAÇÃO: DUAS REGRAS QUE FALTAVAM (Prompt 5)
-- ============================================================================
-- Nenhuma funcionalidade nova. As duas correções abaixo fecham buracos que a
-- auditoria de ponta a ponta encontrou.
--
-- ----------------------------------------------------------------------------
-- CORREÇÃO 1 (ALTO) — EVENTO QUE JÁ PASSOU NÃO ACEITA INSCRIÇÃO
-- ----------------------------------------------------------------------------
-- ⚠️ O BURACO: `closes_at` É OPCIONAL.
--
-- O Builder oferece o prazo com o início do evento como padrão, e a pessoa pode
-- LIMPAR o campo. Uma página publicada, sem prazo e sem capacidade, aceitava
-- inscrição para um evento de 2024 — indefinidamente. Nem a tela nem o banco
-- olhavam a data do evento: `landingEffectiveStatus` derivava o encerramento de
-- prazo e lotação, e `create_event_registration` nem chegava a ler `events`.
--
-- O resultado seria dado sujo que ninguém percebe até alguém exportar a
-- planilha: gente inscrita, meses depois, num encontro que já aconteceu.
--
-- ⚠️ A REGRA É A DATA, E NÃO O HORÁRIO, e a escolha é deliberada. "O evento
-- começou às 8h e agora são 9h" é trabalho do PRAZO — que por padrão é
-- exatamente o início do evento, e que quem organiza pode estender de propósito
-- (inscrição na portaria acontece). O que não pode existir é inscrição para um
-- DIA que já passou.
--
-- É a mesma régua de `event_today()`, que decide expiração em Eventos desde o
-- primeiro módulo. Uma segunda definição de "passou" seria uma segunda verdade.
--
-- ----------------------------------------------------------------------------
-- CORREÇÃO 2 (MÉDIO) — O TETO DE PARTICIPANTES POR INSCRIÇÃO É 20
-- ----------------------------------------------------------------------------
-- O Prompt 1 escreveu 200 como limite de TAMANHO DE PAYLOAD, e o §7 do Prompt 5
-- é explícito: são 20 por inscrição, e o sistema não pode deixar passar 21.
--
-- ⚠️ E A REGRA PASSA A EXISTIR NO BANCO, não só no Zod. Até agora o teto morava
-- só no schema — que roda dentro da Server Action, ou seja, no servidor, mas é
-- a única barreira. O §25 do Prompt 4 e o §24 do Prompt 5 dizem a mesma coisa:
-- regra crítica não fica só na aplicação. Um administrador chamando o RPC
-- direto pelo PostgREST passava com 500 pessoas numa inscrição só.
--
-- `event_registration_max_participants()` é uma função, e não um número solto,
-- pelo mesmo motivo do teto de taxa: mudar vira uma migration de uma linha, e o
-- §7 pede a arquitetura preparada para configurar isso depois.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. O teto de participantes por inscrição
-- ----------------------------------------------------------------------------
create or replace function public.event_registration_max_participants()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 20;
$$;

comment on function public.event_registration_max_participants is
  'Teto de participantes numa unica inscricao (§7 do Prompt 5). Espelhado por MAX_PARTICIPANTS_PER_REGISTRATION.';


-- ----------------------------------------------------------------------------
-- 2. A criação da inscrição, com as duas regras novas
-- ----------------------------------------------------------------------------
-- O corpo é o de 20260924000000, com dois trechos acrescentados (a data do
-- evento na etapa 5 e o teto na etapa 6). Tudo o mais continua na mesma ordem e
-- pelos mesmos motivos — em especial a idempotência ANTES de tudo e a
-- capacidade sob o lock.
drop function if exists public.create_event_registration(
  uuid, text, jsonb, text, text, text, text
);

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
  v_event_date date;
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

  -- 2. IDEMPOTÊNCIA — antes de tudo, INCLUSIVE antes do limite de taxa. Um F5
  --    não pode consumir cota de quem está só reenviando.
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

  -- 3. Limite de taxa — só na porta pública, e só quando há hash de IP.
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

  -- 4. Consentimento (§35 do Prompt 3). Obrigatório pela porta PÚBLICA; a
  --    versão chega de fora porque é a que estava na tela.
  if v_origin = 'landing_page' and coalesce(btrim(p_consent_policy_version), '') = '' then
    raise exception 'É preciso aceitar o tratamento dos dados para concluir a inscrição.'
      using errcode = 'RG008';
  end if;

  -- 5. A página existe e está aceitando.
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

  -- ⚠️ CORREÇÃO 1 — O DIA DO EVENTO. Ver o cabeçalho: `closes_at` é opcional, e
  -- sem esta cláusula uma página sem prazo aceitaria inscrição para um evento
  -- que já aconteceu. `event_today()` é a mesma régua de expiração que Eventos
  -- usa desde o primeiro módulo.
  select e.event_date into v_event_date
  from public.events e
  where e.id = v_page.event_id;

  if v_event_date is not null and v_event_date < public.event_today() then
    raise exception 'Este evento já aconteceu e não aceita mais inscrições.'
      using errcode = 'RG009';
  end if;

  if v_page.closes_at is not null and now() > v_page.closes_at then
    raise exception 'O prazo de inscrição para este evento já encerrou.' using errcode = 'RG001';
  end if;

  -- 6. Normaliza os participantes UMA VEZ, e todo o resto trabalha sobre o
  --    resultado. Normalizar em cada checagem é como duas delas passam a
  --    discordar sobre o que é "o mesmo e-mail".
  --
  --    ⚠️ O E-MAIL VAI PARA MINÚSCULAS AQUI. É disso que o índice único do §12
  --    depende: "Joao@x.com" e "joao@x.com" são a mesma pessoa.
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

  -- ⚠️ CORREÇÃO 2 — O TETO POR INSCRIÇÃO, no banco. Vale para as duas portas: o
  -- limite é da INSCRIÇÃO, não de quem a cria.
  if v_count > public.event_registration_max_participants() then
    raise exception 'O limite de % participantes por inscrição foi atingido.',
      public.event_registration_max_participants() using errcode = 'RG010';
  end if;

  -- 7. Cada participante tem nome, e-mail e ao menos um contato.
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

  -- 8. Duplicidade DENTRO da própria requisição.
  select e.value ->> 'email' into v_taken
  from jsonb_array_elements(v_people) as e(value)
  group by e.value ->> 'email'
  having count(*) > 1
  limit 1;

  if v_taken is not null then
    raise exception 'O e-mail % aparece mais de uma vez nesta inscrição.', v_taken
      using errcode = 'RG004';
  end if;

  -- 9. Duplicidade contra o que JÁ EXISTE no evento.
  --
  --    ⚠️ ESTA CHECAGEM É PELA MENSAGEM, NÃO PELA GARANTIA. Duas requisições
  --    simultâneas com o mesmo e-mail passam as duas por aqui; quem recusa a
  --    segunda é o índice `event_participants_event_email_idx`, com 23505.
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

  -- 10. Capacidade. Sob o lock da etapa 5 — é o lock que impede duas inscrições
  --     simultâneas de lerem a mesma contagem e caberem as duas.
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

  -- ⚠️ SEM DADO PESSOAL NA TRILHA: quantos, e não quem. O "quem" está em
  -- `event_participants`, sob RLS, e é de lá que ele sai quando alguém pede
  -- exclusão. A versão do consentimento entra: não identifica ninguém e é a
  -- prova de qual texto valia no instante da inscrição.
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

-- ⚠️ EXECUTE REVOGADO DE `public` E `anon`. Quem chama pelo caminho público é o
-- SERVIDOR com `service_role` — que não passa por grant. `authenticated` mantém
-- o EXECUTE porque o backoffice inscreve gente pela tela; a função confere o
-- papel por dentro. Reaplicado porque o `drop` levou os grants junto.
revoke execute on function
  public.create_event_registration(uuid, text, jsonb, text, text, text, text)
  from public, anon;
grant execute on function
  public.create_event_registration(uuid, text, jsonb, text, text, text, text)
  to authenticated;


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   drop function if exists public.event_registration_max_participants();
--   drop function if exists public.create_event_registration(uuid, text, jsonb, text, text, text, text);
--   -- e recriar a versão de 20260924000000_event_landing_public.sql.
--
-- ⚠️ Voltar atrás reabre as duas portas: inscrição em evento que já passou, e
-- inscrição com mais de 20 pessoas por uma chamada direta ao PostgREST.
-- ============================================================================
