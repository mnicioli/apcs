-- ============================================================================
-- CARGOS: a matriz de acesso sai do código e vira dado editável
-- ============================================================================
--
-- Até aqui, "quem pode o quê" morava em duas listas escritas à mão que
-- precisavam contar a mesma história: `PERMISSION_MATRIX` (TypeScript) e as
-- policies RLS de cada tabela. Mudar acesso era mexer nas duas e subir código.
--
-- Esta migration acrescenta uma TERCEIRA coisa — o CARGO —, e o desenho inteiro
-- existe para que ela não vire uma terceira verdade.
--
-- ----------------------------------------------------------------------------
-- ⚠️ A REGRA QUE SEGURA TUDO: UM CARGO SÓ TIRA, NUNCA ACRESCENTA
-- ----------------------------------------------------------------------------
-- Todo cargo nasce apoiado num PAPEL-BASE (`app_role`: admin, comercial,
-- financeiro ou viewer). O papel-base é o que continua gravado em
-- `profiles.role`, é o que `current_app_role()` devolve e é o que TODAS as 122
-- policies do banco já consultam — nada disso muda, e é por isso que esta
-- migration não reescreve policy nenhuma.
--
-- O cargo só pode conter permissões que o papel-base JÁ TEM (tabela
-- `app_role_ceilings`, o "teto"). Um trigger impõe isso em toda escrita.
--
-- A consequência, dita sem rodeio:
--
--   • TIRAR uma permissão do cargo ESCONDE a tela e faz a Server Action
--     recusar. Vale para todo mundo que usa o sistema pelo navegador.
--     NÃO é uma tranca no banco: quem tem o papel-base continua tendo aquele
--     acesso na RLS, e alguém tecnicamente capaz de chamar a API por fora
--     continuaria passando. Para trancar de verdade, é policy — ou seja,
--     migration.
--
--   • ACRESCENTAR é proibido, e essa é a metade que protege. Se a tela
--     pudesse dar `events.write` a um cargo baseado em `comercial`, o botão
--     apareceria e o Postgres recusaria o clique — a matriz mentindo sobre o
--     banco, que é o pior desfecho possível numa tela de permissão.
--
-- Em uma frase: a matriz pode ser MAIS ESTREITA que a RLS, nunca mais larga.
--
-- ----------------------------------------------------------------------------
-- O que entra
-- ----------------------------------------------------------------------------
--   1. `app_role_ceilings` — o teto de cada papel-base. Espelho do que a RLS
--      realmente entrega. Só muda por migration, como a RLS.
--   2. `app_roles` — os cargos. Quatro embutidos (que espelham os papéis) mais
--      os que a APCS criar.
--   3. `app_role_permissions` — o que cada cargo abre.
--   4. `profiles.role_key` — o cargo da pessoa, mantido em sincronia com
--      `profiles.role` por trigger.
--   5. As funções de escrita, todas `SECURITY DEFINER` com `is_admin()`.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. O TETO — o que a RLS de fato entrega para cada papel
-- ----------------------------------------------------------------------------
-- ⚠️ ESTA TABELA NÃO É EDITÁVEL PELA TELA, e é a razão de ela existir separada
-- de `app_role_permissions`. Ela é a cópia declarada do que as policies do banco
-- fazem — se alguém pudesse aumentá-la pela interface, a promessa "a matriz
-- nunca é mais larga que a RLS" viraria uma promessa que a própria tela desfaz.
--
-- Mudou policy? Mude aqui, na mesma migration. As duas contam a mesma história.
create table if not exists public.app_role_ceilings (
  base_role public.app_role not null,
  permission text not null,
  primary key (base_role, permission)
);

comment on table public.app_role_ceilings is
  'Teto de cada papel-base: o que a RLS realmente entrega. So muda por migration, junto com as policies.';

-- Seed espelhando `PERMISSION_MATRIX` de src/lib/rbac/rbac.config.ts.
-- `viewer` não aparece: ele não tem permissão nenhuma, e é assim de propósito
-- (é o papel de quem acabou de entrar, e o fallback de quem falhou).
insert into public.app_role_ceilings (base_role, permission) values
  ('admin', 'leads.read'),
  ('admin', 'leads.write'),
  ('admin', 'attendances.read'),
  ('admin', 'attendances.write'),
  ('admin', 'whatsapp.read'),
  ('admin', 'whatsapp.write'),
  ('admin', 'documents.read'),
  ('admin', 'documents.write'),
  ('admin', 'events.read'),
  ('admin', 'events.write'),
  ('admin', 'market.read'),
  ('admin', 'market.write'),
  ('admin', 'lectures.read'),
  ('admin', 'lectures.write'),
  ('admin', 'surveys.read'),
  ('admin', 'surveys.write'),
  ('admin', 'members.read'),
  ('admin', 'members.write'),
  ('admin', 'clients.read'),
  ('admin', 'clients.write'),
  ('admin', 'projects.read'),
  ('admin', 'projects.write'),
  ('admin', 'resources.read'),
  ('admin', 'resources.write'),
  ('admin', 'allocation.read'),
  ('admin', 'allocation.write'),
  ('admin', 'finance.read'),
  ('admin', 'finance.write'),
  ('admin', 'infrastructure.read'),
  ('admin', 'infrastructure.write'),
  ('admin', 'analytics.read'),
  ('admin', 'users.manage'),
  ('admin', 'settings.manage'),
  ('comercial', 'leads.read'),
  ('comercial', 'leads.write'),
  ('comercial', 'attendances.read'),
  ('comercial', 'attendances.write'),
  ('comercial', 'whatsapp.read'),
  ('comercial', 'whatsapp.write'),
  ('comercial', 'documents.read'),
  ('comercial', 'events.read'),
  ('comercial', 'market.read'),
  ('comercial', 'lectures.read'),
  ('comercial', 'surveys.read'),
  ('comercial', 'members.read'),
  ('comercial', 'clients.read'),
  ('comercial', 'clients.write'),
  ('comercial', 'projects.read'),
  ('comercial', 'analytics.read'),
  ('financeiro', 'projects.read'),
  ('financeiro', 'finance.read'),
  ('financeiro', 'finance.write'),
  ('financeiro', 'analytics.read')
on conflict do nothing;


-- ----------------------------------------------------------------------------
-- 2. OS CARGOS
-- ----------------------------------------------------------------------------
-- ⚠️ A CHAVE É TEXTO E NÃO O ENUM `app_role`, e essa é a diferença entre poder
-- criar um cargo novo pela tela e precisar de uma migration para cada um. O
-- enum continua existindo — como PAPEL-BASE, que é o que a RLS entende.
create table if not exists public.app_roles (
  key text primary key,
  label text not null,
  description text,
  -- O que a RLS vai ver. Imutável depois de criado: trocar a base de um cargo
  -- mudaria em silêncio o que TODAS as policies entregam a quem já o tem.
  base_role public.app_role not null,
  -- Embutido = espelha um papel do enum. Não pode ser excluído nem renomeado:
  -- é o destino de quem for criado pelo trigger de signup e o chão de todo o
  -- resto.
  is_builtin boolean not null default false,
  sort_order integer not null default 100,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Minúsculas, hífen, começando por letra: a chave aparece em URL, em log e na
  -- trilha. Um rótulo com acento e espaço é o `label`; a chave é o identificador.
  constraint app_roles_key_format check (key ~ '^[a-z][a-z0-9-]{1,30}$'),
  constraint app_roles_label_not_blank check (btrim(label) <> '')
);

comment on table public.app_roles is
  'Cargos do sistema. Cada um se apoia num papel-base do enum app_role, e so pode conter permissoes que a base ja tem (ver app_role_ceilings).';

create table if not exists public.app_role_permissions (
  role_key text not null references public.app_roles(key) on delete cascade,
  permission text not null,
  primary key (role_key, permission)
);

comment on table public.app_role_permissions is
  'O que cada cargo abre na interface. Subconjunto do teto do papel-base — imposto pelo trigger app_role_permission_guard.';

create index if not exists app_role_permissions_permission_idx
  on public.app_role_permissions (permission);

-- ⚠️ O TRIGGER É A GARANTIA, E A FUNÇÃO DE ESCRITA É SÓ A MENSAGEM BONITA.
-- Validar dentro de `create_app_role`/`update_app_role` cobriria os caminhos que
-- eu escrevi hoje. O trigger cobre também o `insert` que alguém rodar no SQL
-- Editor às duas da manhã — e é justamente esse que ninguém revisa.
create or replace function public.app_role_permission_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_base public.app_role;
begin
  select r.base_role into v_base from public.app_roles r where r.key = new.role_key;

  if v_base is null then
    raise exception 'Cargo % nao existe.', new.role_key using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.app_role_ceilings c
    where c.base_role = v_base and c.permission = new.permission
  ) then
    raise exception
      'A permissao % nao existe no papel-base %. Um cargo so pode TIRAR do papel-base, nunca acrescentar.',
      new.permission, v_base
      using errcode = 'AR003';
  end if;

  return new;
end;
$fn$;

drop trigger if exists app_role_permission_guard on public.app_role_permissions;
create trigger app_role_permission_guard
  before insert or update on public.app_role_permissions
  for each row execute procedure public.app_role_permission_guard();


-- Os quatro embutidos, espelhando o enum. Os rótulos e as descrições são os
-- mesmos que já estavam em rbac.types.ts e admin.labels.ts — daqui em diante o
-- banco é quem os guarda, e o código só tem a cópia de emergência.
insert into public.app_roles (key, label, description, base_role, is_builtin, sort_order) values
  ('admin', 'Administrador',
   'Faz tudo: publica, aprova, divulga, e gerencia usuários e configurações.',
   'admin', true, 10),
  ('comercial', 'Comercial',
   'Atende no WhatsApp e consulta os cadastros. Não publica nem aprova.',
   'comercial', true, 20),
  ('financeiro', 'Financeiro',
   'Reservado para quando o módulo Financeiro existir. Hoje não abre nenhuma tela.',
   'financeiro', true, 30),
  ('viewer', 'Visualização',
   'Entra no sistema e não vê quase nada. É como todo usuário novo nasce.',
   'viewer', true, 40)
on conflict (key) do nothing;

-- Cada embutido começa igual ao próprio teto.
insert into public.app_role_permissions (role_key, permission)
select r.key, c.permission
from public.app_roles r
join public.app_role_ceilings c on c.base_role = r.base_role
where r.is_builtin
on conflict do nothing;


-- ----------------------------------------------------------------------------
-- 3. O CARGO DA PESSOA
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists role_key text;

update public.profiles set role_key = role::text where role_key is null;

alter table public.profiles alter column role_key set default 'viewer';
alter table public.profiles alter column role_key set not null;

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_key_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_role_key_fkey
      foreign key (role_key) references public.app_roles(key);
  end if;
end
$constraint$;

comment on column public.profiles.role_key is
  'Cargo da pessoa. `role` continua sendo o papel-base que a RLS le, e o trigger profiles_sync_role_key mantem os dois de acordo.';

-- ⚠️ O TRIGGER EXISTE PARA QUE AS DUAS COLUNAS NUNCA DISCORDEM.
--
-- `role` é o que a RLS lê; `role_key` é o que a interface lê. Se elas
-- divergirem, o sistema passa a mostrar uma coisa e entregar outra — e ninguém
-- descobre, porque cada camada continua "funcionando".
--
-- Quem manda é sempre `role_key`: mudou o cargo, `role` vira a base dele.
-- Mudou só `role` (é o que `set_user_role` faz, e o que uma correção manual no
-- SQL Editor faria), `role_key` volta para o cargo embutido correspondente.
create or replace function public.profiles_sync_role_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_base public.app_role;
begin
  -- ⚠️ NA CRIAÇÃO, QUEM MANDA É `role`. O único caminho que insere em
  -- `profiles` é o trigger `handle_new_user`, que grava `role = 'viewer'` e não
  -- sabe nada sobre cargos. Derivar a chave do papel mantém esse caminho
  -- correto sem reescrevê-lo; dar um cargo a alguém é sempre um segundo passo,
  -- por `set_user_role_key`.
  if tg_op = 'INSERT' then
    new.role_key := new.role::text;
  elsif new.role_key is distinct from old.role_key then
    -- Trocou o cargo: `role` passa a ser a base dele (lookup abaixo).
    null;
  elsif new.role is distinct from old.role then
    -- Trocou só o papel — `set_user_role`, ou uma correção manual no SQL
    -- Editor. A pessoa volta para o cargo embutido correspondente.
    new.role_key := new.role::text;
  else
    return new;
  end if;

  select r.base_role into v_base from public.app_roles r where r.key = new.role_key;

  if v_base is null then
    raise exception 'Cargo % nao existe.', new.role_key using errcode = 'P0002';
  end if;

  new.role := v_base;
  return new;
end;
$fn$;

drop trigger if exists profiles_sync_role_key on public.profiles;
create trigger profiles_sync_role_key
  before insert or update on public.profiles
  for each row execute procedure public.profiles_sync_role_key();


-- ----------------------------------------------------------------------------
-- 4. RLS — todo mundo LÊ a matriz, ninguém a ESCREVE por fora
-- ----------------------------------------------------------------------------
-- ⚠️ A LEITURA É ABERTA A QUEM ESTÁ LOGADO de propósito. O aplicativo precisa
-- saber o que o próprio cargo abre para desenhar o menu, e a matriz de acesso
-- não é segredo: ela diz o que os papéis podem, não o que alguém fez.
--
-- Escrita não tem policy NENHUMA — nem para administrador. A única porta são as
-- funções abaixo, que checam `is_admin()`, respeitam o teto e registram na
-- trilha. Uma policy de update aqui seria uma segunda porta sem nada disso.
alter table public.app_roles enable row level security;
alter table public.app_role_permissions enable row level security;
alter table public.app_role_ceilings enable row level security;

drop policy if exists app_roles_select on public.app_roles;
create policy app_roles_select on public.app_roles
  for select to authenticated using (true);

drop policy if exists app_role_permissions_select on public.app_role_permissions;
create policy app_role_permissions_select on public.app_role_permissions
  for select to authenticated using (true);

drop policy if exists app_role_ceilings_select on public.app_role_ceilings;
create policy app_role_ceilings_select on public.app_role_ceilings
  for select to authenticated using (true);


-- ----------------------------------------------------------------------------
-- 5. QUANTOS AINDA CONSEGUEM ADMINISTRAR USUÁRIOS
-- ----------------------------------------------------------------------------
-- ⚠️ NÃO É A MESMA PERGUNTA QUE "quantos são admin", E AGORA A DIFERENÇA EXISTE.
--
-- As travas AD001/AD005 contam `profiles.role = 'admin'`, que é o que a RLS
-- entende. Um cargo baseado em `admin` mas SEM `users.manage` — que é
-- exatamente o caso de uso ("Editor de Conteúdo publica tudo e não mexe em
-- gente") — continua contando ali e não abre a tela de Usuários.
--
-- Sem esta função, dá para mover a última pessoa que administra usuários para um
-- cargo assim: a trava antiga não reclama (ela ainda é `role = 'admin'`), e a
-- tela de Usuários passa a ser visível para zero pessoas. A saída seria editar a
-- linha no SQL Editor.
create or replace function public.count_active_user_managers()
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select count(*)::integer
  from public.profiles p
  join public.app_role_permissions rp
    on rp.role_key = p.role_key and rp.permission = 'users.manage'
  where p.active;
$fn$;

comment on function public.count_active_user_managers() is
  'Quantas contas ATIVAS tem um cargo com users.manage. E o numero que impede o sistema de ficar sem quem administre usuarios.';


-- ----------------------------------------------------------------------------
-- 6. CRIAR, EDITAR E EXCLUIR CARGO
-- ----------------------------------------------------------------------------
create or replace function public.create_app_role(
  p_key text,
  p_label text,
  p_description text,
  p_base_role public.app_role,
  p_permissions text[]
)
returns public.app_roles
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.app_roles%rowtype;
  v_chave text := lower(btrim(coalesce(p_key, '')));
  v_rotulo text := btrim(coalesce(p_label, ''));
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores criam cargos.' using errcode = '42501';
  end if;

  if v_chave !~ '^[a-z][a-z0-9-]{1,30}$' then
    raise exception 'A identificacao do cargo deve ter de 2 a 31 caracteres, comecar por letra e usar apenas letras minusculas, numeros e hifen.'
      using errcode = 'AR001';
  end if;

  if v_rotulo = '' then
    raise exception 'Informe o nome do cargo.' using errcode = 'AR001';
  end if;

  if exists (select 1 from public.app_roles r where r.key = v_chave) then
    raise exception 'Ja existe um cargo com esta identificacao.' using errcode = 'AR002';
  end if;

  insert into public.app_roles (key, label, description, base_role, is_builtin, created_by)
  values (
    v_chave,
    v_rotulo,
    nullif(btrim(coalesce(p_description, '')), ''),
    p_base_role,
    false,
    (select auth.uid())
  )
  returning * into v_row;

  -- O trigger recusa qualquer permissão fora do teto (AR003).
  insert into public.app_role_permissions (role_key, permission)
  select v_chave, entrada.permission
  from unnest(coalesce(p_permissions, array[]::text[])) as entrada(permission)
  group by entrada.permission;

  perform public.log_admin_action(
    'role_created',
    v_row.label,
    jsonb_build_object(
      'key', v_chave,
      'base_role', p_base_role,
      'permissions', coalesce(array_length(p_permissions, 1), 0)
    )
  );

  return v_row;
end;
$fn$;

comment on function public.create_app_role(text, text, text, public.app_role, text[]) is
  'Cria um cargo. Recusa chave invalida (AR001), chave repetida (AR002) e permissao fora do teto do papel-base (AR003).';

revoke execute on function public.create_app_role(text, text, text, public.app_role, text[]) from public, anon;
grant execute on function public.create_app_role(text, text, text, public.app_role, text[]) to authenticated;


-- ⚠️ O CARGO `admin` NÃO É EDITÁVEL, E ISSO NÃO É EXCESSO DE ZELO.
--
-- Ele é o único cargo cujo conjunto de permissões o sistema pode assumir como
-- completo. Tirar `users.manage` dele fecharia a tela de Usuários para o
-- administrador que acabou de clicar — e a única saída seria o SQL Editor.
-- Quem quer um "administrador com menos coisas" cria um cargo NOVO apoiado em
-- `admin` e tira o que quiser: o original continua lá, intacto, como saída de
-- emergência.
create or replace function public.update_app_role(
  p_key text,
  p_label text,
  p_description text,
  p_permissions text[]
)
returns public.app_roles
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.app_roles%rowtype;
  v_rotulo text := btrim(coalesce(p_label, ''));
  v_tinha_gestao boolean;
  v_tera_gestao boolean;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores alteram cargos.' using errcode = '42501';
  end if;

  select * into v_row from public.app_roles r where r.key = p_key;
  if v_row.key is null then
    raise exception 'Cargo nao encontrado.' using errcode = 'P0002';
  end if;

  if v_row.key = 'admin' then
    raise exception 'O cargo Administrador nao pode ser alterado. Crie um cargo novo apoiado nele e retire o que nao deve abrir.'
      using errcode = 'AR004';
  end if;

  if v_rotulo = '' then
    raise exception 'Informe o nome do cargo.' using errcode = 'AR001';
  end if;

  v_tinha_gestao := exists (
    select 1 from public.app_role_permissions rp
    where rp.role_key = p_key and rp.permission = 'users.manage'
  );
  v_tera_gestao := 'users.manage' = any(coalesce(p_permissions, array[]::text[]));

  -- Tirar `users.manage` de um cargo que alguém tem pode ser o último caminho
  -- para a tela de Usuários. A conta é de pessoas ATIVAS, não de cargos.
  if v_tinha_gestao and not v_tera_gestao then
    if public.count_active_user_managers()
       - (select count(*) from public.profiles p where p.role_key = p_key and p.active) <= 0 then
      raise exception 'Isto deixaria o sistema sem ninguem capaz de administrar usuarios.'
        using errcode = 'AR006';
    end if;
  end if;

  update public.app_roles
  set
    -- Embutido não se renomeia: "Administrador" e "Visualização" aparecem em
    -- texto de tela e em trilha antiga. O que se edita nele é o que ele abre.
    label = case when v_row.is_builtin then v_row.label else v_rotulo end,
    description = case
      when v_row.is_builtin then v_row.description
      else nullif(btrim(coalesce(p_description, '')), '')
    end,
    updated_at = now()
  where key = p_key
  returning * into v_row;

  delete from public.app_role_permissions where role_key = p_key;

  insert into public.app_role_permissions (role_key, permission)
  select p_key, entrada.permission
  from unnest(coalesce(p_permissions, array[]::text[])) as entrada(permission)
  group by entrada.permission;

  perform public.log_admin_action(
    'role_updated',
    v_row.label,
    jsonb_build_object(
      'key', p_key,
      'permissions', coalesce(array_length(p_permissions, 1), 0)
    )
  );

  return v_row;
end;
$fn$;

comment on function public.update_app_role(text, text, text, text[]) is
  'Edita um cargo. Recusa mexer no Administrador (AR004), permissao fora do teto (AR003) e deixar o sistema sem quem administre usuarios (AR006).';

revoke execute on function public.update_app_role(text, text, text, text[]) from public, anon;
grant execute on function public.update_app_role(text, text, text, text[]) to authenticated;


-- ⚠️ NÃO EXCLUI CARGO COM GENTE DENTRO, e a recusa é melhor que a alternativa.
-- Excluir movendo todo mundo para `viewer` faria um clique tirar o acesso de
-- várias pessoas de uma vez, sem que quem clicou soubesse quantas eram.
create or replace function public.delete_app_role(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.app_roles%rowtype;
  v_pessoas integer;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores excluem cargos.' using errcode = '42501';
  end if;

  select * into v_row from public.app_roles r where r.key = p_key;
  if v_row.key is null then
    raise exception 'Cargo nao encontrado.' using errcode = 'P0002';
  end if;

  if v_row.is_builtin then
    raise exception 'Os cargos originais do sistema nao podem ser excluidos.' using errcode = 'AR004';
  end if;

  select count(*) into v_pessoas from public.profiles p where p.role_key = p_key;
  if v_pessoas > 0 then
    raise exception 'Ha % pessoa(s) com este cargo. Mova essas pessoas para outro cargo antes de excluir.', v_pessoas
      using errcode = 'AR005';
  end if;

  delete from public.app_roles where key = p_key;

  perform public.log_admin_action('role_deleted', v_row.label, jsonb_build_object('key', p_key));
end;
$fn$;

comment on function public.delete_app_role(text) is
  'Exclui um cargo criado pela APCS. Recusa cargo embutido (AR004) e cargo em uso (AR005).';

revoke execute on function public.delete_app_role(text) from public, anon;
grant execute on function public.delete_app_role(text) to authenticated;


-- ----------------------------------------------------------------------------
-- 7. DAR UM CARGO A ALGUÉM
-- ----------------------------------------------------------------------------
-- Irmã de `set_user_role`, com as mesmas travas — mais a que só existe porque
-- os cargos existem (AR006).
create or replace function public.set_user_role_key(
  p_user_id uuid,
  p_role_key text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before public.profiles%rowtype;
  v_after public.profiles%rowtype;
  v_cargo public.app_roles%rowtype;
  v_admins integer;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores alteram o cargo de um usuario.' using errcode = '42501';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'Voce nao pode alterar o proprio cargo.' using errcode = 'AD002';
  end if;

  select * into v_cargo from public.app_roles r where r.key = p_role_key;
  if v_cargo.key is null then
    raise exception 'Cargo nao encontrado.' using errcode = 'P0002';
  end if;

  select * into v_before from public.profiles p where p.id = p_user_id;
  if v_before.id is null then
    raise exception 'Usuario nao encontrado.' using errcode = 'P0002';
  end if;

  if v_before.role_key = p_role_key then
    return v_before;
  end if;

  -- Trava antiga (AD001): não deixar o banco sem `role = 'admin'`, que é o que
  -- as policies leem.
  if v_before.role = 'admin' and v_cargo.base_role <> 'admin' and v_before.active then
    select count(*) into v_admins
    from public.profiles p
    where p.role = 'admin' and p.active;

    if v_admins <= 1 then
      raise exception 'O sistema precisa de pelo menos um administrador.' using errcode = 'AD001';
    end if;
  end if;

  -- Trava nova (AR006): não deixar o sistema sem ninguém que ABRA a tela de
  -- Usuários. É diferente da anterior — ver `count_active_user_managers()`.
  if v_before.active
     and exists (
       select 1 from public.app_role_permissions rp
       where rp.role_key = v_before.role_key and rp.permission = 'users.manage'
     )
     and not exists (
       select 1 from public.app_role_permissions rp
       where rp.role_key = p_role_key and rp.permission = 'users.manage'
     )
     and public.count_active_user_managers() <= 1
  then
    raise exception 'Isto deixaria o sistema sem ninguem capaz de administrar usuarios.'
      using errcode = 'AR006';
  end if;

  update public.profiles
  set role_key = p_role_key
  where id = p_user_id
  returning * into v_after;

  perform public.log_admin_action(
    'user_role_changed',
    v_after.email,
    jsonb_build_object(
      'from', v_before.role_key,
      'to', p_role_key,
      'base_role', v_cargo.base_role
    )
  );

  return v_after;
end;
$fn$;

comment on function public.set_user_role_key(uuid, text) is
  'Troca o cargo de um usuario. Recusa trocar o proprio (AD002), deixar o banco sem admin (AD001) e deixar o sistema sem quem administre usuarios (AR006).';

revoke execute on function public.set_user_role_key(uuid, text) from public, anon;
grant execute on function public.set_user_role_key(uuid, text) to authenticated;


-- O convite escolhe cargo, e a trilha precisa registrar qual.
create or replace function public.log_user_invite_cargo(p_email text, p_role_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_cargo public.app_roles%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores convidam usuarios.' using errcode = '42501';
  end if;

  select * into v_cargo from public.app_roles r where r.key = p_role_key;
  if v_cargo.key is null then
    raise exception 'Cargo nao encontrado.' using errcode = 'P0002';
  end if;

  perform public.log_admin_action(
    'user_invited',
    lower(btrim(p_email)),
    jsonb_build_object('role', p_role_key, 'base_role', v_cargo.base_role)
  );
end;
$fn$;

revoke execute on function public.log_user_invite_cargo(text, text) from public, anon;
grant execute on function public.log_user_invite_cargo(text, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 8. A TRAVA DE INATIVAÇÃO APRENDE SOBRE CARGOS
-- ----------------------------------------------------------------------------
-- Igual à de 20260831000100_admin_users.sql, com uma checagem a mais. Sem ela,
-- desligar a última pessoa que tem `users.manage` passa batido sempre que
-- existir outra conta com papel-base `admin` — e essa outra conta pode ser
-- justamente um "Editor de Conteúdo", que não abre a tela de Usuários.
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

  if not p_active
     and exists (
       select 1 from public.app_role_permissions rp
       where rp.role_key = v_before.role_key and rp.permission = 'users.manage'
     )
     and public.count_active_user_managers() <= 1
  then
    raise exception 'Isto deixaria o sistema sem ninguem capaz de administrar usuarios.'
      using errcode = 'AR006';
  end if;

  update public.profiles
  set active = p_active
  where id = p_user_id
  returning * into v_after;

  perform public.log_admin_action(
    case when p_active then 'user_reactivated'::public.admin_audit_action
         else 'user_deactivated'::public.admin_audit_action end,
    v_after.email,
    jsonb_build_object('role', v_after.role_key)
  );

  return v_after;
end;
$fn$;

comment on function public.set_user_active(uuid, boolean) is
  'Liga ou desliga uma conta. Recusa desligar a propria (AD004), o ultimo admin ativo (AD005) e a ultima pessoa capaz de administrar usuarios (AR006).';

revoke execute on function public.set_user_active(uuid, boolean) from public, anon;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;


-- ============================================================================
-- Para desfazer (na ordem):
--   drop trigger if exists profiles_sync_role_key on public.profiles;
--   drop function if exists public.profiles_sync_role_key();
--   alter table public.profiles drop constraint if exists profiles_role_key_fkey;
--   alter table public.profiles drop column if exists role_key;
--   drop function if exists public.set_user_role_key(uuid, text);
--   drop function if exists public.log_user_invite_cargo(text, text);
--   drop function if exists public.delete_app_role(text);
--   drop function if exists public.update_app_role(text, text, text, text[]);
--   drop function if exists public.create_app_role(text, text, text, public.app_role, text[]);
--   drop function if exists public.count_active_user_managers();
--   drop table if exists public.app_role_permissions;
--   drop table if exists public.app_roles;
--   drop table if exists public.app_role_ceilings;
-- E recriar `set_user_active` na versão de 20260831000100_admin_users.sql.
-- ============================================================================
