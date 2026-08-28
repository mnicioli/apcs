-- ============================================================================
-- UNIFICA OS PERFIS — quatro, e os mesmos no sistema inteiro
-- ============================================================================
--
-- ANTES havia DUAS taxonomias que ninguém tinha mapeado uma na outra:
--
--   `membership_profile_type`  suinocultor · profissional · empresa
--   `event_segments`           Associados · Empresas · Produtores ·
--                              Universidades · Técnicos
--
-- Nada ligava as duas. Uma associada cadastrada como `suinocultor` não estava
-- em público-alvo nenhum, e "Associados" convivia com "Produtores" sem que
-- ninguém soubesse qual marcar para alcançar uma criadora — ela seria as duas
-- coisas ao mesmo tempo.
--
-- DEPOIS há UMA taxonomia, com quatro perfis:
--
--   Criadores      (associado)   ← era `suinocultor` / público "Produtores"
--   Empresas       (associado)
--   Técnicos       (associado)   ← era `profissional`
--   Universidades  (NÃO associado)
--
-- "Ser associado" deixa de ser uma coluna e passa a ser uma leitura do perfil:
-- é associado quem é Criador, Empresa ou Técnico. Uma coluna separada dizendo
-- a mesma coisa poderia contradizer o perfil, e duas verdades sobre o mesmo
-- fato é exatamente o problema que esta migration existe para acabar.
--
-- ----------------------------------------------------------------------------
-- ⚠️ POR QUE `rename value` E NÃO UM ENUM NOVO
-- ----------------------------------------------------------------------------
-- `alter type ... rename value` não reescreve uma linha sequer: o valor é o
-- mesmo, com outro nome. Trocar o tipo exigiria recriar todas as funções que o
-- citam na assinatura e um `using` de conversão em duas tabelas — muito mais
-- superfície para ganho nenhum.
--
-- ⚠️ O PREÇO: renomear NÃO atualiza corpo de função. `submit_membership_
-- application` compara `p_profile_type = 'suinocultor'` no corpo, e depois do
-- rename esse literal deixa de existir — a chamada quebraria em produção com
-- "invalid input value for enum". Por isso ela é recriada inteira na seção 2.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. O enum
-- ----------------------------------------------------------------------------
-- ⚠️ OS RENAMES SÃO GUARDADOS, E ISSO NÃO É ZELO EXCESSIVO.
--
-- `rename value` falha com 22023 ("is not an existing enum label") se o valor
-- antigo já tiver sido renomeado. Isso torna o script IRRECUPERÁVEL num cenário
-- que aconteceu de verdade: aplicado pelo SQL Editor do Dashboard, que confirma
-- statement a statement em vez de tudo numa transação. Uma falha no meio deixa
-- os renames gravados, e a segunda tentativa morre na primeira linha — sem que
-- o resto, que ainda faltava, chegue a rodar.
--
-- Com a guarda, rodar de novo é seguro em qualquer estado.
do $guard$
begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'membership_profile_type' and e.enumlabel = 'suinocultor'
  ) then
    alter type public.membership_profile_type rename value 'suinocultor' to 'criador';
  end if;

  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'membership_profile_type' and e.enumlabel = 'profissional'
  ) then
    alter type public.membership_profile_type rename value 'profissional' to 'tecnico';
  end if;
end
$guard$;

-- ⚠️ `add value` PODE rodar em transação (PG 12+), mas o valor novo NÃO PODE
-- ser usado antes do commit. Por isso nada abaixo cita 'universidade' — e é
-- também por isso que Universidades não ganhou campo obrigatório próprio: a
-- validação por perfil da seção 2 teria de citá-lo.
alter type public.membership_profile_type add value if not exists 'universidade';

comment on type public.membership_profile_type is
  'Perfil declarado por quem se cadastra. Criador, Empresa e Tecnico sao associados; Universidade nao e. Define quais campos sao obrigatorios.';

-- ----------------------------------------------------------------------------
-- 2. `submit_membership_application` — recriada só por causa dos literais
-- ----------------------------------------------------------------------------
-- Idêntica à da 20260821000000, com DUAS diferenças e nenhuma outra:
--   'suinocultor' → 'criador'   e   'profissional' → 'tecnico'.
--
-- Universidade não entra na validação: os campos dela (instituição, área e
-- cargo) são opcionais. Um cadastro de universidade que chega com pouco ainda
-- é um cadastro; um formulário que recusa é uma universidade a menos.
create or replace function public.submit_membership_application(
  p_profile_type public.membership_profile_type,
  p_full_name text,
  p_whatsapp text,
  p_email text,
  p_city text,
  p_state text,
  p_dedupe_key text,
  p_organization text default null,
  p_farm_name text default null,
  p_production_city text default null,
  p_sow_count integer default null,
  p_cnpj text default null,
  p_state_registration text default null,
  p_activity_area text default null,
  p_job_title text default null,
  p_legal_name text default null,
  p_trade_name text default null,
  p_interests text[] default '{}'::text[],
  p_other_interest text default null,
  p_consent_policy_version text default null,
  p_source_ip_hash text default null,
  p_user_agent text default null
)
returns table (application_id uuid, protocol text, duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(btrim(p_email));
  v_whatsapp text := regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g');
  v_cnpj text := nullif(regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g'), '');
  v_state text := upper(btrim(coalesce(p_state, '')));
  v_recent integer;
  v_row public.membership_applications%rowtype;
begin
  -- Regras de obrigatoriedade por perfil. Elas já existem no Zod, que roda no
  -- cliente E na action — mas o Zod não é a última linha: quem chama esta
  -- função é o servidor, e servidor tem bug. A regra vale aqui também.
  if p_profile_type = 'criador' and nullif(btrim(coalesce(p_production_city, '')), '') is null then
    raise exception 'Informe o municipio da producao.' using errcode = 'MA003';
  end if;

  if p_profile_type = 'tecnico' then
    if nullif(btrim(coalesce(p_activity_area, '')), '') is null then
      raise exception 'Informe a area de atuacao.' using errcode = 'MA003';
    end if;
    if nullif(btrim(coalesce(p_job_title, '')), '') is null then
      raise exception 'Informe o cargo ou funcao.' using errcode = 'MA003';
    end if;
  end if;

  if p_profile_type = 'empresa' then
    if nullif(btrim(coalesce(p_legal_name, '')), '') is null then
      raise exception 'Informe a razao social.' using errcode = 'MA003';
    end if;
    if nullif(btrim(coalesce(p_job_title, '')), '') is null then
      raise exception 'Informe o cargo ou funcao do contato.' using errcode = 'MA003';
    end if;
    if v_cnpj is null then
      raise exception 'Informe o CNPJ da empresa.' using errcode = 'MA003';
    end if;
  end if;

  -- Limite de taxa. Só quando há hash de IP: sem ele não há o que contar, e
  -- recusar por ausência de cabeçalho barraria gente atrás de proxy legítimo.
  if p_source_ip_hash is not null then
    select count(*) into v_recent
    from public.membership_applications a
    where a.source_ip_hash = p_source_ip_hash
      and a.created_at > now() - interval '1 hour';

    if v_recent >= public.membership_ip_hourly_limit() then
      raise exception 'Muitos envios a partir deste acesso. Tente novamente mais tarde.'
        using errcode = 'MA004';
    end if;
  end if;

  insert into public.membership_applications (
    profile_type, full_name, whatsapp, email, city, state, organization,
    farm_name, production_city, sow_count, cnpj, state_registration,
    activity_area, job_title, legal_name, trade_name,
    interests, other_interest,
    consent_accepted, consent_policy_version,
    dedupe_key, source_ip_hash, user_agent
  ) values (
    p_profile_type,
    btrim(p_full_name),
    v_whatsapp,
    v_email,
    btrim(p_city),
    v_state,
    nullif(btrim(coalesce(p_organization, '')), ''),
    nullif(btrim(coalesce(p_farm_name, '')), ''),
    nullif(btrim(coalesce(p_production_city, '')), ''),
    p_sow_count,
    v_cnpj,
    nullif(btrim(coalesce(p_state_registration, '')), ''),
    nullif(btrim(coalesce(p_activity_area, '')), ''),
    nullif(btrim(coalesce(p_job_title, '')), ''),
    nullif(btrim(coalesce(p_legal_name, '')), ''),
    nullif(btrim(coalesce(p_trade_name, '')), ''),
    coalesce(p_interests, '{}'::text[]),
    nullif(btrim(coalesce(p_other_interest, '')), ''),
    true,
    p_consent_policy_version,
    p_dedupe_key,
    p_source_ip_hash,
    left(coalesce(p_user_agent, ''), 400)
  )
  on conflict (dedupe_key) do nothing
  returning * into v_row;

  if v_row.id is not null then
    insert into public.membership_audit_logs (application_id, action, metadata)
    values (
      v_row.id,
      'application_submitted',
      jsonb_build_object('profileType', p_profile_type, 'protocol', v_row.protocol)
    );

    return query select v_row.id, v_row.protocol, false;
    return;
  end if;

  -- Caiu no conflito: devolve o protocolo da linha que já existe.
  select * into v_row
  from public.membership_applications a
  where a.dedupe_key = p_dedupe_key;

  if v_row.id is null then
    raise exception 'Nao foi possivel registrar a solicitacao.' using errcode = 'MA002';
  end if;

  return query select v_row.id, v_row.protocol, true;
end;
$fn$;

comment on function public.submit_membership_application is
  'Unica porta de entrada do formulario publico. Normaliza, limita taxa, deduplica e audita. So service_role executa.';

-- ----------------------------------------------------------------------------
-- 3. O catálogo de públicos-alvo
-- ----------------------------------------------------------------------------
-- ⚠️ O SLUG NÃO MUDA — é a regra que o próprio módulo de Eventos escreveu:
-- "`name` é rótulo de tela e alguém vai renomeá-lo; o slug é a chave que o
-- resto do sistema segura." `produtores` e `criadores` são a MESMA coisa com
-- outro nome, então isto é rename de rótulo, não público novo. Trocar o slug
-- quebraria os vínculos dos eventos já cadastrados sem ganho nenhum.
update public.event_segments
set name = 'Criadores',
    description = 'Quem atua diretamente na producao de suinos.'
where slug = 'produtores';

-- ----------------------------------------------------------------------------
-- 3.1 "Associados" sai — mas primeiro os eventos dele são remapeados
-- ----------------------------------------------------------------------------
-- ⚠️ APOSENTAR SEM REMAPEAR QUEBRARIA A EDIÇÃO. `assert_event_segments` exige
-- que TODO público selecionado esteja `active`; um evento ligado ao público
-- inativo passaria a recusar qualquer salvamento com "Público-alvo inválido",
-- e quem estivesse editando não teria como descobrir o motivo pela tela.
--
-- Um evento que dizia "para os Associados" passa a dizer "para Criadores,
-- Empresas e Técnicos" — mesmo alcance, agora escrito por extenso. É a mesma
-- decisão que "Toda a base" já tomou: o banco registra quem é alcançado, não o
-- atalho que alguém clicou.
insert into public.event_segment_links (event_id, segment_id)
select l.event_id, novo.id
from public.event_segment_links l
join public.event_segments antigo
  on antigo.id = l.segment_id and antigo.slug = 'associados'
join public.event_segments novo
  on novo.slug in ('produtores', 'empresas', 'tecnicos')
on conflict (event_id, segment_id) do nothing;

delete from public.event_segment_links
where segment_id in (select id from public.event_segments where slug = 'associados');

-- `active = false` e não `delete`: a FK é `on delete restrict` e a auditoria de
-- eventos cita ids de público. Inativo some da tela e da expansão de "Toda a
-- base" (que filtra por `active`), sem apagar o que já foi registrado.
update public.event_segments
set active = false
where slug = 'associados';

-- O catálogo ativo passa a ser exatamente os quatro perfis:
--   Criadores · Empresas · Técnicos · Universidades
-- e "Toda a base" continua sendo o atalho que expande nos quatro. Nada a fazer
-- em `expand_event_segments`: ela já lê `active` em vez de uma lista fixa.

-- ----------------------------------------------------------------------------
-- 4. Como desfazer
-- ----------------------------------------------------------------------------
--   update public.event_segments set active = true where slug = 'associados';
--   update public.event_segments set name = 'Produtores' where slug = 'produtores';
--   alter type public.membership_profile_type rename value 'criador' to 'suinocultor';
--   alter type public.membership_profile_type rename value 'tecnico' to 'profissional';
--   -- e recriar submit_membership_application com os literais antigos.
--
-- ⚠️ Não há como remover 'universidade' do enum (o Postgres não permite), nem
-- como recuperar os vínculos de "Associados" que a seção 3.1 apagou — os
-- eventos ficam com os três públicos por extenso, que é o mesmo alcance.
-- ----------------------------------------------------------------------------
