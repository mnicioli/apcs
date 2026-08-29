-- ============================================================================
-- Edição do cadastro do associado — `update_member()`
-- ----------------------------------------------------------------------------
-- FECHA A PENDÊNCIA ANUNCIADA NA TELA. O cabeçalho de
-- 20260821000000_create_membership.sql e o aviso em src/app/(app)/members/page.tsx
-- dizem que "edição de cadastro pelo CRM" ficou para depois, porque a carga do
-- cadastro legado ainda ia mexer no formato do registro. Depois disso a carga
-- não chegou e o registro passou a receber gente pela landing — e um cadastro
-- que ninguém consegue corrigir é um cadastro que envelhece errado: telefone
-- trocado, e-mail digitado errado, associado que saiu e continua "ativo".
--
-- ----------------------------------------------------------------------------
-- ⚠️ AS QUATRO DECISÕES
-- ----------------------------------------------------------------------------
--
-- 1. É UMA FUNÇÃO, NÃO UMA POLICY DE UPDATE.
--    A seção 8 da migration original revogou `insert, update, delete` de
--    `authenticated` e `anon` nas quatro tabelas do módulo, de propósito: com
--    UMA porta de escrita, a normalização e a trilha de auditoria não têm como
--    ser puladas. Abrir uma policy de UPDATE agora criaria uma segunda porta
--    que não normaliza telefone, não confere e-mail duplicado e não audita —
--    e o PostgREST a exporia direto ao navegador.
--
-- 2. NULO SIGNIFICA APAGAR, E NÃO "NÃO MEXER".
--    A função recebe o registro INTEIRO e escreve o registro inteiro, porque
--    quem a chama é um formulário que mostra todos os campos. Se nulo fosse
--    "não mexer", apagar um dado errado seria impossível pela tela — a pessoa
--    limparia a caixa, salvaria, e o valor antigo continuaria lá, em silêncio.
--    Consequência que precisa estar dita: NÃO use esta função para atualização
--    parcial; ela sobrescreve o que não for enviado.
--
-- 3. O QUE NÃO SE EDITA AQUI, E POR QUÊ.
--      • `origin`     — é um fato histórico ("veio da landing", "veio da
--                       carga"). Editável, viraria opinião.
--      • `external_id`— chave da carga do cadastro legado. Quem a edita
--                       à mão quebra a deduplicação da próxima reimportação.
--      • `contact_id` — vínculo com o WhatsApp, mantido pelo próprio módulo.
--      • `created_at` — quando a linha entrou NESTE banco. `joined_at`, que é
--                       a data real de associação, ESTÁ editável: é ela que a
--                       carga histórica precisa corrigir.
--    Não estão na assinatura, então nem uma chamada direta ao PostgREST os
--    alcança.
--
-- 4. O REGISTRO NÃO REPETE AS OBRIGATORIEDADES POR PERFIL DA LANDING.
--    `submit_membership_application` exige município da produção do criador,
--    CNPJ da empresa e assim por diante — ali é um formulário público, e o
--    momento de cobrar é na entrada. Aqui não: a migration original deixou
--    quase toda coluna anulável exatamente porque "cadastro legado é incompleto
--    por natureza". Exigir os mesmos campos na edição tornaria impossível
--    salvar a correção de um telefone num cadastro antigo sem inventar um CNPJ.
--    Só `full_name` continua obrigatório — um associado sem nome não é
--    registro, é ruído.
--
-- ----------------------------------------------------------------------------
-- CÓDIGOS DE ERRO — classe `MA`, mapeada em src/lib/actions/errors.ts.
--   42501  sem permissão
--   P0002  associado não encontrado
--   MA006  e-mail já pertence a OUTRO associado
--   MA007  matrícula já pertence a OUTRO associado
--
-- ⚠️ MA006/MA007 EXISTEM PARA NÃO CAIR NO 23505 GENÉRICO. `members_email_unique_idx`
-- e `members_code_unique_idx` já barrariam a gravação, mas a mensagem que chega
-- à tela seria "já existe um registro com esses dados" — sem dizer QUAL campo,
-- num formulário de vinte campos. A checagem explícita custa uma consulta e
-- devolve a frase que diz onde está o problema.
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
  if v_after.code is distinct from v_before.code then v_changed := v_changed || 'code'; end if;
  if v_after.status is distinct from v_before.status then v_changed := v_changed || 'status'; end if;
  if v_after.profile_type is distinct from v_before.profile_type then v_changed := v_changed || 'profileType'; end if;
  if v_after.full_name is distinct from v_before.full_name then v_changed := v_changed || 'fullName'; end if;
  if v_after.whatsapp is distinct from v_before.whatsapp then v_changed := v_changed || 'whatsapp'; end if;
  if v_after.email is distinct from v_before.email then v_changed := v_changed || 'email'; end if;
  if v_after.city is distinct from v_before.city then v_changed := v_changed || 'city'; end if;
  if v_after.state is distinct from v_before.state then v_changed := v_changed || 'state'; end if;
  if v_after.organization is distinct from v_before.organization then v_changed := v_changed || 'organization'; end if;
  if v_after.farm_name is distinct from v_before.farm_name then v_changed := v_changed || 'farmName'; end if;
  if v_after.production_city is distinct from v_before.production_city then v_changed := v_changed || 'productionCity'; end if;
  if v_after.sow_count is distinct from v_before.sow_count then v_changed := v_changed || 'sowCount'; end if;
  if v_after.cnpj is distinct from v_before.cnpj then v_changed := v_changed || 'cnpj'; end if;
  if v_after.state_registration is distinct from v_before.state_registration then v_changed := v_changed || 'stateRegistration'; end if;
  if v_after.activity_area is distinct from v_before.activity_area then v_changed := v_changed || 'activityArea'; end if;
  if v_after.job_title is distinct from v_before.job_title then v_changed := v_changed || 'jobTitle'; end if;
  if v_after.legal_name is distinct from v_before.legal_name then v_changed := v_changed || 'legalName'; end if;
  if v_after.trade_name is distinct from v_before.trade_name then v_changed := v_changed || 'tradeName'; end if;
  if v_after.interests is distinct from v_before.interests then v_changed := v_changed || 'interests'; end if;
  if v_after.other_interest is distinct from v_before.other_interest then v_changed := v_changed || 'otherInterest'; end if;
  if v_after.joined_at is distinct from v_before.joined_at then v_changed := v_changed || 'joinedAt'; end if;
  if v_after.notes is distinct from v_before.notes then v_changed := v_changed || 'notes'; end if;

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

comment on function public.update_member is
  'Edita o cadastro do associado pelo CRM (Administrador e Gestor). Recebe o registro inteiro: campo nulo APAGA o valor. Não toca em origin, external_id, contact_id nem created_at.';

-- ----------------------------------------------------------------------------
-- EXECUTE
-- ----------------------------------------------------------------------------
-- ⚠️ O `revoke ... from public` é INDISPENSÁVEL: o Supabase concede EXECUTE a
-- `anon` em toda função nova do schema `public` via `alter default privileges`.
-- Sem esta linha, um visitante anônimo editaria o cadastro de qualquer
-- associado pelo PostgREST — a checagem de papel lá dentro barraria, mas
-- depender só dela é depender de uma linha; aqui são duas.
revoke execute on function public.update_member(
  uuid, text, public.member_status, public.membership_profile_type, text, text, text,
  text, text, text, text, text, integer, text, text, text, text, text, text,
  text[], text, date, text
) from public, anon;

grant execute on function public.update_member(
  uuid, text, public.member_status, public.membership_profile_type, text, text, text,
  text, text, text, text, text, integer, text, text, text, text, text, text,
  text[], text, date, text
) to authenticated;
