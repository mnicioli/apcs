-- ============================================================================
-- EDITAR ASSOCIADO E EDITAR USUÁRIO ERAM IMPOSSÍVEIS
-- ============================================================================
-- Defeito encontrado em produção: qualquer alteração no cadastro de um
-- associado devolvia "Dados inválidos. Verifique os campos e tente novamente."
-- O log do banco dizia o que a tela não sabia dizer:
--
--     code:    22P02
--     message: malformed array literal: "profileType"
--     details: Array value must start with "{" or dimension information.
--
-- ----------------------------------------------------------------------------
-- A CAUSA: `text[] || 'literal'` NÃO ACRESCENTA UM ITEM
-- ----------------------------------------------------------------------------
-- As duas funções montavam a lista de campos alterados assim:
--
--     v_changed text[] := '{}';
--     ...
--     v_changed := v_changed || 'profileType';
--
-- A intenção é óbvia para quem lê: acrescente este nome à lista. O Postgres
-- entende outra coisa. O operador `||` tem duas formas aplicáveis —
-- `anyarray || anyelement` e `anyarray || anyarray` — e o literal `'profileType'`
-- chega com tipo `unknown`, sem nada que diga qual das duas escolher. A
-- resolução recai sobre `anyarray || anyarray`, e o Postgres tenta ler
-- `profileType` COMO UM ARRAY. Não é: falta a chave, e vem 22P02.
--
-- `array['profileType']` tira a ambiguidade da jogada. `'profileType'::text`
-- também resolveria; a forma de array foi escolhida por dizer na própria
-- sintaxe o que a operação faz.
--
-- ----------------------------------------------------------------------------
-- ⚠️ POR QUE ISSO SOBREVIVEU DESDE AGOSTO SEM NINGUÉM VER
-- ----------------------------------------------------------------------------
-- Três coisas se somaram, e cada uma sozinha teria sido inofensiva.
--
-- 1. O ERRO SÓ EXISTE QUANDO ALGO MUDA. A concatenação está dentro de um
--    `if ... is distinct from`. Salvar sem alterar nada não entra em nenhum
--    ramo, a função conclui, `updated_at` avança — e a tela diz que salvou.
--    Quem testou "abrir e salvar" viu tudo funcionando.
--
-- 2. O PL/PGSQL SÓ PLANEJA CADA COMANDO NA PRIMEIRA VEZ QUE ELE EXECUTA. A
--    função foi criada sem uma palavra de reclamação, o deploy passou, os
--    testes passaram — porque nenhum deles fala com o Postgres.
--
-- 3. A MENSAGEM APONTAVA PARA O LADO ERRADO. 22P02 é traduzido como
--    "Dados inválidos", exatamente a mesma frase que o Zod produz quando o
--    formulário está mal preenchido. Quem viu a tela foi conferir os campos —
--    e os campos estavam certos. Ver o commit que fez esta action logar o erro
--    do banco em vez de engoli-lo: sem ele, este defeito não teria nome.
--
-- ⚠️ E ERA MAIS AMPLO DO QUE O RELATO. A busca pelo padrão achou o mesmo erro
-- em `update_user_profile` (/users): trocar o NOME ou o E-MAIL de um usuário
-- falhava do mesmo jeito, pelo mesmo motivo, e ninguém tinha reclamado ainda.
--
-- `src/test/sql-array-append.test.ts` passou a recusar a forma crua em
-- qualquer migration.
--
-- ⚠️ OS CORPOS ABAIXO SÃO OS DE 20260829140100 E 20260831000100, palavra por
-- palavra, com as 24 concatenações trocadas e mais nada. `create or replace`
-- porque as assinaturas não mudam.
-- ============================================================================


create or replace function public.update_member(
  p_member_id uuid,
  p_full_name text,
  p_status public.member_status,
  p_profile_type public.membership_profile_type default null,
  p_code text default null,
  p_whatsapp text default null,
  p_email text default null,
  p_city text default null,
  p_state text default null,
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
  p_interests text[] default null,
  p_other_interest text default null,
  p_joined_at date default null,
  p_notes text default null
)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.members%rowtype;
  v_after public.members%rowtype;
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
  v_name text := btrim(coalesce(p_full_name, ''));
  -- Mesma normalização de `submit_membership_application`: o banco guarda
  -- telefone e CNPJ como DÍGITOS, e-mail em minúsculas, UF em maiúsculas. Se as
  -- duas portas normalizassem diferente, a busca por telefone da lista
  -- encontraria quem entrou pela landing e não quem foi corrigido aqui.
  v_whatsapp text := nullif(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), '');
  v_cnpj text := nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_state text := nullif(upper(btrim(coalesce(p_state, ''))), '');
  v_changed text[] := '{}'::text[];
begin
  if not public.membership_is_writer() then
    raise exception 'Sem permissão para alterar o cadastro de associados.' using errcode = '42501';
  end if;

  -- ⚠️ O LOCK VEM ANTES DA LEITURA. Sem ele, dois gestores editando o mesmo
  -- associado leriam a mesma linha "antes", e a trilha registraria duas
  -- alterações partindo do mesmo estado — quando a segunda, na verdade, partiu
  -- do resultado da primeira. Lock consultivo pelo mesmo motivo de
  -- `lock_membership_application`: `for update` exigiria privilégio de UPDATE,
  -- e ninguém tem UPDATE nesta tabela (seção 8 da migration original).
  perform pg_advisory_xact_lock(hashtext('member:' || p_member_id::text));

  select * into v_before from public.members m where m.id = p_member_id;
  if v_before.id is null then
    raise exception 'Associado não encontrado.' using errcode = 'P0002';
  end if;

  -- Nome vazio NÃO tem código próprio: o CHECK `members_full_name_len` já
  -- recusa (23514 → "dados inválidos"), e o Zod recusa antes, no cliente e na
  -- action. Um terceiro `raise` aqui só criaria uma quarta mensagem para o
  -- mesmo erro — e as três que existem já dizem a mesma coisa.

  -- `lower()` nos dois lados porque o índice único é sobre `lower(email)`:
  -- comparar cru deixaria "Maria@x.com" passar por aqui e quebrar no índice.
  if v_email is not null and exists (
    select 1 from public.members m
    where lower(m.email) = v_email and m.id <> p_member_id
  ) then
    raise exception 'Este e-mail já pertence a outro associado.' using errcode = 'MA006';
  end if;

  if v_code is not null and exists (
    select 1 from public.members m
    where m.code = v_code and m.id <> p_member_id
  ) then
    raise exception 'Esta matrícula já pertence a outro associado.' using errcode = 'MA007';
  end if;

  update public.members
  set code = v_code,
      status = p_status,
      profile_type = p_profile_type,
      full_name = v_name,
      whatsapp = v_whatsapp,
      email = v_email,
      city = nullif(btrim(coalesce(p_city, '')), ''),
      state = v_state,
      organization = nullif(btrim(coalesce(p_organization, '')), ''),
      farm_name = nullif(btrim(coalesce(p_farm_name, '')), ''),
      production_city = nullif(btrim(coalesce(p_production_city, '')), ''),
      sow_count = p_sow_count,
      cnpj = v_cnpj,
      state_registration = nullif(btrim(coalesce(p_state_registration, '')), ''),
      activity_area = nullif(btrim(coalesce(p_activity_area, '')), ''),
      job_title = nullif(btrim(coalesce(p_job_title, '')), ''),
      legal_name = nullif(btrim(coalesce(p_legal_name, '')), ''),
      trade_name = nullif(btrim(coalesce(p_trade_name, '')), ''),
      interests = coalesce(p_interests, '{}'::text[]),
      other_interest = nullif(btrim(coalesce(p_other_interest, '')), ''),
      joined_at = p_joined_at,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_by = (select auth.uid())
  where id = p_member_id
  returning * into v_after;

  -- ⚠️ A TRILHA GUARDA QUAIS CAMPOS MUDARAM, NÃO OS VALORES.
  --
  -- Guardar os valores antigos faria de `membership_audit_logs` uma segunda
  -- cópia do cadastro — com telefone, e-mail e CNPJ de cada versão de cada
  -- associado, para sempre, numa tabela que ninguém pensa como base de dados
  -- pessoais. Sob a LGPD isso é o oposto de minimização, e o benefício prático
  -- ("qual era o telefone antes?") não justifica manter um histórico completo
  -- de dado pessoal.
  --
  -- `is distinct from` e não `<>`: com nulo, `<>` devolve nulo, e um campo que
  -- foi PREENCHIDO (nulo → valor) não apareceria na lista.
  if v_after.code is distinct from v_before.code then v_changed := v_changed || array['code']; end if;
  if v_after.status is distinct from v_before.status then v_changed := v_changed || array['status']; end if;
  if v_after.profile_type is distinct from v_before.profile_type then v_changed := v_changed || array['profileType']; end if;
  if v_after.full_name is distinct from v_before.full_name then v_changed := v_changed || array['fullName']; end if;
  if v_after.whatsapp is distinct from v_before.whatsapp then v_changed := v_changed || array['whatsapp']; end if;
  if v_after.email is distinct from v_before.email then v_changed := v_changed || array['email']; end if;
  if v_after.city is distinct from v_before.city then v_changed := v_changed || array['city']; end if;
  if v_after.state is distinct from v_before.state then v_changed := v_changed || array['state']; end if;
  if v_after.organization is distinct from v_before.organization then v_changed := v_changed || array['organization']; end if;
  if v_after.farm_name is distinct from v_before.farm_name then v_changed := v_changed || array['farmName']; end if;
  if v_after.production_city is distinct from v_before.production_city then v_changed := v_changed || array['productionCity']; end if;
  if v_after.sow_count is distinct from v_before.sow_count then v_changed := v_changed || array['sowCount']; end if;
  if v_after.cnpj is distinct from v_before.cnpj then v_changed := v_changed || array['cnpj']; end if;
  if v_after.state_registration is distinct from v_before.state_registration then v_changed := v_changed || array['stateRegistration']; end if;
  if v_after.activity_area is distinct from v_before.activity_area then v_changed := v_changed || array['activityArea']; end if;
  if v_after.job_title is distinct from v_before.job_title then v_changed := v_changed || array['jobTitle']; end if;
  if v_after.legal_name is distinct from v_before.legal_name then v_changed := v_changed || array['legalName']; end if;
  if v_after.trade_name is distinct from v_before.trade_name then v_changed := v_changed || array['tradeName']; end if;
  if v_after.interests is distinct from v_before.interests then v_changed := v_changed || array['interests']; end if;
  if v_after.other_interest is distinct from v_before.other_interest then v_changed := v_changed || array['otherInterest']; end if;
  if v_after.joined_at is distinct from v_before.joined_at then v_changed := v_changed || array['joinedAt']; end if;
  if v_after.notes is distinct from v_before.notes then v_changed := v_changed || array['notes']; end if;

  -- Salvar sem ter mudado nada NÃO vira linha de histórico: um "alterou o
  -- cadastro" que não alterou nada só faz a trilha custar mais para ser lida.
  if cardinality(v_changed) > 0 then
    insert into public.membership_audit_logs (member_id, action, actor_id, actor_name, metadata)
    values (
      p_member_id,
      'member_updated',
      (select auth.uid()),
      public.current_actor_name(),
      jsonb_build_object('changed', to_jsonb(v_changed))
    );
  end if;

  return v_after;
end;
$$;


create or replace function public.update_user_profile(
  p_user_id uuid,
  p_full_name text,
  p_email text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before public.profiles%rowtype;
  v_after public.profiles%rowtype;
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_changed text[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores editam o cadastro de um usuario.' using errcode = '42501';
  end if;

  select * into v_before from public.profiles p where p.id = p_user_id;
  if v_before.id is null then
    raise exception 'Usuario nao encontrado.' using errcode = 'P0002';
  end if;

  -- E-mail em branco não apaga: `profiles.email` é `not null` e é a cópia da
  -- identidade de login. Ausente significa "não mexa nele".
  if v_email is null then
    v_email := v_before.email;
  end if;

  update public.profiles
  set full_name = v_name,
      email = v_email
  where id = p_user_id
  returning * into v_after;

  if v_after.full_name is distinct from v_before.full_name then
    v_changed := v_changed || array['full_name'];
  end if;
  if v_after.email is distinct from v_before.email then
    v_changed := v_changed || array['email'];
  end if;

  if cardinality(v_changed) > 0 then
    perform public.log_admin_action(
      'user_updated'::public.admin_audit_action,
      v_after.email,
      jsonb_build_object('changed', to_jsonb(v_changed))
    );
  end if;

  return v_after;
end;
$fn$;

-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- Recriar as duas funções como estão em 20260829140100_update_member.sql e
-- 20260831000100_admin_users.sql.
--
-- ⚠️ Isso devolve o defeito: editar associado e editar usuário voltam a
-- falhar em toda alteração. Não há dado a restaurar — nada foi gravado errado,
-- a gravação é que não acontecia.
-- ============================================================================
