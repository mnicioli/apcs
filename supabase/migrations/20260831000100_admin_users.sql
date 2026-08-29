-- ============================================================================
-- Administração de usuários: editar, inativar — e o conserto da lista de
-- bloqueios
-- ============================================================================
--
-- Quatro coisas, nesta ordem:
--
--   1. O CONSERTO. `list_notification_blocks` selecionava `c.name` de
--      `chat_contacts`, e a coluna é `full_name`. Nenhuma tela de Configurações
--      abria por causa disso.
--   2. `profiles.active` — a conta desligada sem apagar nada.
--   3. As TRÊS travas que fazem "inativo" significar alguma coisa.
--   4. As funções de escrita: inativar/reativar e editar o cadastro.
--
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. O CONSERTO: a coluna é `full_name`, não `name`
-- ----------------------------------------------------------------------------
-- `chat_contacts` (20260804000000_create_chat_csp.sql) tem `full_name`. O
-- `c.name` de 20260830100000_admin_module.sql derrubava a lista de bloqueios
-- com 42703 — e, como a mesma fronteira de erro serve as abas vizinhas, a tela
-- de Integração aparecia quebrada junto.
--
-- ⚠️ O ERRO NÃO APARECE AO CRIAR A FUNÇÃO: plpgsql só valida a consulta na
-- primeira execução. Uma migration que "passou" não prova que a função roda.
create or replace function public.list_notification_blocks(
  p_limit integer default 50,
  p_offset integer default 0,
  p_include_revoked boolean default false
)
returns table (
  id uuid,
  phone_key text,
  channel public.survey_channel,
  source text,
  note text,
  created_at timestamptz,
  revoked_at timestamptz,
  revoked_note text,
  member_id uuid,
  member_name text,
  contact_name text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores consultam a lista de bloqueios.' using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'O limite deve ficar entre 1 e 200.' using errcode = 'AD001';
  end if;

  return query
  with filtrado as (
    select o.*
    from public.notification_opt_outs o
    where p_include_revoked or o.revoked_at is null
  ),
  contado as (
    select count(*)::bigint as total from filtrado
  )
  select
    f.id,
    f.phone_key,
    f.channel,
    f.source,
    f.note,
    f.created_at,
    f.revoked_at,
    f.revoked_note,
    m.id,
    m.full_name,
    c.full_name,
    (select total from contado)
  from filtrado f
  left join public.chat_contacts c on c.id = f.contact_id
  -- ⚠️ `limit 1` no lado do associado: o bloqueio é do TELEFONE, e dois
  -- associados podem dividir um. Sem isto, um número compartilhado apareceria
  -- duas vezes na lista — como se fossem dois bloqueios.
  left join lateral (
    select m2.id, m2.full_name
    from public.members m2
    where public.notification_phone_key(m2.whatsapp) = f.phone_key
      and f.phone_key is not null
    order by m2.created_at, m2.id
    limit 1
  ) m on true
  order by f.created_at desc
  limit p_limit offset p_offset;
end;
$fn$;

revoke execute on function public.list_notification_blocks(integer, integer, boolean) from public, anon;
grant execute on function public.list_notification_blocks(integer, integer, boolean) to authenticated;


-- ----------------------------------------------------------------------------
-- 2. A conta desligada
-- ----------------------------------------------------------------------------
-- ⚠️ POR QUE INATIVAR E NÃO EXCLUIR. Apagar de `auth.users` leva o perfil junto
-- (cascade) e deixa a trilha de auditoria de TODOS os módulos apontando para
-- ninguém: "aprovado por [vazio]", "publicado por [vazio]". Quem saiu da APCS
-- precisa perder o acesso sem levar o histórico embora.
alter table public.profiles
  add column if not exists active boolean not null default true;

comment on column public.profiles.active is
  'Conta ligada. Falsa = a pessoa nao entra e nao le nada, mas o historico dela continua legivel.';


-- ----------------------------------------------------------------------------
-- 3. As travas que fazem "inativo" significar alguma coisa
-- ----------------------------------------------------------------------------
-- Uma coluna booleana sozinha é decoração: quem já tem sessão aberta continua
-- lendo tudo. O que desliga de verdade são os dois helpers que TODA policy do
-- sistema usa.

-- ⚠️⚠️ A FUNÇÃO DEVOLVE 'viewer' PARA O INATIVO, E NÃO `NULL`. ESTA É A LINHA
-- MAIS IMPORTANTE DO ARQUIVO.
--
-- `null` parece o valor natural para "sem papel", e ABRIRIA acesso em vez de
-- fechar. Espalhados pelo banco existem guardas em plpgsql desta forma:
--
--     if public.current_app_role() not in ('admin', 'ceo') then
--       raise exception ...;
--     end if;
--
-- Com `null`, `null not in (...)` é `null` — o `if` não é verdadeiro, a exceção
-- NÃO é levantada, e a função segue em frente. Ou seja: o usuário inativo
-- passaria justamente pelas travas escritas para barrá-lo. São doze guardas
-- nesse formato, em Documentos, Eventos, Bolsa, Palestras e Enquetes.
--
-- `'viewer'` fecha os dois formatos ao mesmo tempo: `'viewer' in ('admin',...)`
-- é falso (as policies negam) e `'viewer' not in ('admin',...)` é verdadeiro
-- (as guardas levantam a exceção). E `viewer` não recebe NADA em policy nenhuma
-- — conferido: a palavra só aparece no enum, no default da coluna e no trigger
-- de signup.
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.active then p.role else 'viewer'::public.app_role end
  from public.profiles p
  where p.id = (select auth.uid());
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role = 'admin' and p.active from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

-- ⚠️ A TERCEIRA TRAVA: NINGUÉM SE RELIGA SOZINHO.
--
-- A policy `profiles_update_own` deixa cada um editar o próprio perfil — é o
-- que faz a tela /profile funcionar. Sem este trigger, a pessoa recém-inativada
-- mandaria um PATCH em `profiles` com `active: true` e voltaria. É o mesmo
-- buraco que `prevent_role_escalation` fecha para o papel, e o mesmo remédio.
--
-- Um admin ATIVO passa (é ele quem inativa os outros); um admin inativado não,
-- porque `is_admin()` acabou de passar a exigir `active`.
create or replace function public.prevent_self_reactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active is distinct from old.active and not public.is_admin() then
    raise exception 'Apenas administradores ativam ou inativam uma conta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_self_reactivation on public.profiles;
create trigger prevent_self_reactivation
  before update on public.profiles
  for each row execute procedure public.prevent_self_reactivation();


-- ----------------------------------------------------------------------------
-- 4. Inativar e reativar
-- ----------------------------------------------------------------------------
-- As travas são irmãs das de `set_user_role`, e pelos mesmos motivos: ninguém
-- se tranca para fora sozinho, e o sistema não fica sem administrador.
--
-- ⚠️ A CONTAGEM DE ADMINS AGORA É DE ADMINS **ATIVOS**. Um sistema com dois
-- administradores, um deles inativo, tem UM administrador — inativar o que
-- sobrou deixaria a tela de Usuários visível para zero pessoas, e a saída seria
-- editar a linha direto no banco.
create or replace function public.set_user_active(
  p_user_id uuid,
  p_active boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before public.profiles%rowtype;
  v_after public.profiles%rowtype;
  v_admins integer;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores ativam ou inativam uma conta.' using errcode = '42501';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'Voce nao pode inativar a propria conta.' using errcode = 'AD004';
  end if;

  select * into v_before from public.profiles p where p.id = p_user_id;
  if v_before.id is null then
    raise exception 'Usuario nao encontrado.' using errcode = 'P0002';
  end if;

  if v_before.active = p_active then
    return v_before;
  end if;

  if v_before.role = 'admin' and not p_active then
    select count(*) into v_admins
    from public.profiles p
    where p.role = 'admin' and p.active;

    if v_admins <= 1 then
      raise exception 'O sistema precisa de pelo menos um administrador ativo.' using errcode = 'AD005';
    end if;
  end if;

  update public.profiles
  set active = p_active
  where id = p_user_id
  returning * into v_after;

  perform public.log_admin_action(
    case when p_active then 'user_reactivated'::public.admin_audit_action
         else 'user_deactivated'::public.admin_audit_action end,
    v_after.email,
    jsonb_build_object('role', v_after.role)
  );

  return v_after;
end;
$fn$;

comment on function public.set_user_active(uuid, boolean) is
  'Liga ou desliga uma conta. Recusa desligar a propria (AD004) e o ultimo admin ativo (AD005).';

revoke execute on function public.set_user_active(uuid, boolean) from public, anon;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;


-- ----------------------------------------------------------------------------
-- 5. Editar o cadastro
-- ----------------------------------------------------------------------------
-- ⚠️ ESTA FUNÇÃO NÃO TROCA O E-MAIL DE LOGIN, e não teria como. O e-mail que
-- autentica mora em `auth.users`, fora do alcance de uma função do `public`;
-- `profiles.email` é uma CÓPIA, para a tela não precisar de um join. Gravar só
-- a cópia produziria a pior falha possível: a lista mostrando um endereço e o
-- login exigindo outro, sem nada acusando a diferença.
--
-- Por isso a troca de e-mail acontece em `updateUserAction`, que fala com a API
-- de auth primeiro (com `service_role`) e SÓ ENTÃO chama esta função para
-- alinhar a cópia. A ordem importa: se o segundo passo falhar, a cópia fica
-- velha e a tela mostra o endereço antigo — chato, mas o login continua certo.
-- Na ordem inversa, o login é que quebraria.
--
-- ⚠️ A TRILHA GUARDA O QUE MUDOU, E NÃO OS VALORES. O nome de uma pessoa não
-- precisa ficar duplicado num log que outra pessoa lê — mesma decisão de
-- `update_member`.
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
    v_changed := v_changed || 'full_name';
  end if;
  if v_after.email is distinct from v_before.email then
    v_changed := v_changed || 'email';
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

comment on function public.update_user_profile(uuid, text, text) is
  'Edita o nome e a copia do e-mail em profiles. A identidade de login e trocada antes, pela API de auth.';

revoke execute on function public.update_user_profile(uuid, text, text) from public, anon;
grant execute on function public.update_user_profile(uuid, text, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 6. Registrar o envio de recuperação de senha
-- ----------------------------------------------------------------------------
-- O e-mail sai pela API de auth do Supabase; esta função só registra que um
-- administrador pediu. Fica na trilha porque "por que eu recebi um pedido de
-- troca de senha?" é uma pergunta que alguém vai fazer.
create or replace function public.log_password_reset(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores disparam recuperacao de senha.' using errcode = '42501';
  end if;

  perform public.log_admin_action(
    'user_password_reset'::public.admin_audit_action,
    lower(btrim(p_email)),
    '{}'::jsonb
  );
end;
$fn$;

revoke execute on function public.log_password_reset(text) from public, anon;
grant execute on function public.log_password_reset(text) to authenticated;
