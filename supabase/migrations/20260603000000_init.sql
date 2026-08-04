-- ============================================================================
-- Migration inicial — FAST Operation Cockpit
-- ----------------------------------------------------------------------------
-- Cria a base de autenticação por PAPÉIS (roles) da empresa.
--
-- Este arquivo é, de propósito, a REFERÊNCIA de como fazer RLS por papel no
-- projeto. Ao criar uma tabela nova (clients, projects, resources, ...), copie
-- o padrão daqui: habilitar RLS + policies usando os helpers `is_admin()` /
-- `current_app_role()`. Veja docs/SUPABASE.md e docs/HOW-TO-CREATE-A-MODULE.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enum de papéis da aplicação
-- ----------------------------------------------------------------------------
-- Papéis derivados do escopo do produto (CEO, PMs, Tech Leads, Comercial,
-- Financeiro) + 'admin' (quem administra o sistema) + 'viewer' (fallback
-- deny-by-default: vê pouco até um admin promover).
create type public.app_role as enum (
  'admin',
  'ceo',
  'pm',
  'tech_lead',
  'comercial',
  'financeiro',
  'viewer'
);

-- ----------------------------------------------------------------------------
-- 2. Tabela de perfis (1:1 com auth.users)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text not null,
  full_name text,
  avatar_url text,
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Perfil de cada usuário autenticado, incluindo seu papel (role) na empresa.';

-- ----------------------------------------------------------------------------
-- 3. Helpers de papel (SECURITY DEFINER)
-- ----------------------------------------------------------------------------
-- IMPORTANTE: estes helpers são SECURITY DEFINER de propósito. Eles leem
-- `profiles` ignorando RLS — o que EVITA a recursão infinita que aconteceria
-- se uma policy de `profiles` consultasse `profiles` por um caminho sujeito a
-- RLS. Use sempre estes helpers dentro das policies, nunca um subselect cru.
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- ----------------------------------------------------------------------------
-- 4. Row Level Security
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- Leitura: cada um vê o próprio perfil; admin vê todos (gestão de usuários).
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

-- Atualização do próprio perfil (nome/avatar). A troca de `role` é barrada
-- pelo trigger `prevent_role_escalation` abaixo — esta policy sozinha não basta.
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Admin pode tudo (inclusive definir o `role` de qualquer usuário).
create policy "profiles_admin_all"
  on public.profiles for all
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- 5. Prevenção de escalada de privilégio
-- ----------------------------------------------------------------------------
-- A policy `profiles_update_own` deixa o usuário editar o próprio perfil — mas
-- sem este guard ele poderia se autopromover a 'admin' num UPDATE. O trigger
-- bloqueia qualquer mudança de `role` que NÃO venha de um admin.
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Apenas administradores podem alterar o papel (role) de um usuário.';
  end if;
  return new;
end;
$$;

create trigger prevent_role_escalation
  before update on public.profiles
  for each row execute procedure public.prevent_role_escalation();

-- ----------------------------------------------------------------------------
-- 6. Criação automática de perfil no signup
-- ----------------------------------------------------------------------------
-- Todo novo usuário entra como 'viewer' (deny-by-default). O papel real é
-- atribuído depois por um admin — NUNCA confie em metadata do signup para
-- definir role (seria um vetor de escalada de privilégio).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    'viewer'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 7. updated_at automático
-- ----------------------------------------------------------------------------
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger on_profiles_updated
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();
