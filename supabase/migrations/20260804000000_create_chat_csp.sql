-- ============================================================================
-- Chat de atendimento + fluxo CSP (compras coletivas)
-- ----------------------------------------------------------------------------
-- Primeiro fluxo da Plataforma de Atendimento Inteligente APCS (ver
-- docs/ROADMAP.md). Cria a base conversacional (contatos, conversas, mensagens)
-- e a tabela de leads qualificados do CSP.
--
-- MODELO DE ACESSO — leia antes de mexer:
--   O chat é PÚBLICO e ANÔNIMO (/chat). Por isso estas tabelas NÃO têm nenhuma
--   policy de escrita para `anon`/`authenticated`: toda escrita passa pelo
--   servidor Next.js usando a `service_role` (que ignora RLS), com a conversa
--   amarrada a um cookie httpOnly. A superfície pública do banco é ZERO.
--   As policies abaixo servem apenas para o BACKOFFICE ler/gerenciar os dados.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
-- Fluxos de atendimento. Novos fluxos entram com `alter type ... add value`.
create type public.chat_flow_key as enum ('csp');

create type public.chat_message_role as enum ('user', 'bot');

create type public.chat_conversation_status as enum (
  'active', -- em andamento
  'completed', -- triagem concluída, lead gerado
  'handoff', -- encaminhada para atendimento humano
  'declined', -- pessoa recusou o consentimento LGPD
  'abandoned' -- sem interação há muito tempo
);

-- Perfil de quem fala com a APCS (transversal aos fluxos).
create type public.chat_contact_profile as enum ('producer', 'member', 'supplier');

create type public.chat_contact_channel as enum ('whatsapp', 'phone', 'email');

create type public.chat_contact_time as enum ('morning', 'afternoon', 'evening', 'any');

-- Interesse específico do fluxo CSP.
create type public.csp_interest as enum ('input', 'feed', 'logistics', 'information');

-- TODO(APCS): confirmar as faixas oficiais de porte da granja com o time.
create type public.csp_volume_range as enum (
  'up_to_50',
  'from_50_to_200',
  'from_200_to_1000',
  'above_1000',
  'not_applicable'
);

create type public.lead_status as enum ('new', 'in_contact', 'qualified', 'discarded');

-- ----------------------------------------------------------------------------
-- 2. Contatos
-- ----------------------------------------------------------------------------
create table public.chat_contacts (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  city text,
  state text,
  contact_profile public.chat_contact_profile,
  phone text,
  email text,
  preferred_channel public.chat_contact_channel,
  preferred_time public.chat_contact_time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_contacts_state_len check (state is null or char_length(state) = 2)
);

comment on table public.chat_contacts is
  'Pessoa que conversou com o bot. Preenchido automaticamente pela triagem.';

-- ----------------------------------------------------------------------------
-- 3. Conversas
-- ----------------------------------------------------------------------------
create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.chat_contacts on delete set null,
  flow_key public.chat_flow_key not null default 'csp',
  status public.chat_conversation_status not null default 'active',
  -- SHA-256 do token de sessão que fica no cookie httpOnly. O token cru NUNCA
  -- é persistido: um vazamento do banco não permite sequestrar conversas.
  session_token_hash text not null unique,
  consent_given_at timestamptz,
  consent_policy_version text,
  -- Campos de triagem já preenchidos, no formato do domínio (camelCase).
  collected jsonb not null default '{}'::jsonb,
  -- SHA-256 do IP (rate limit sem guardar o IP em claro — LGPD).
  ip_hash text,
  user_agent text,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.chat_conversations is
  'Uma conversa do chat público, identificada por um token de sessão (hash).';

create index chat_conversations_status_idx
  on public.chat_conversations (status, last_message_at desc);

-- Suporta o limite de conversas por IP/hora do chat público.
create index chat_conversations_ip_idx
  on public.chat_conversations (ip_hash, created_at desc);

-- ----------------------------------------------------------------------------
-- 4. Mensagens
-- ----------------------------------------------------------------------------
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  -- ORDEM DA CONVERSA. Não use `created_at` para ordenar: `now()` é o timestamp
  -- da TRANSAÇÃO, então as várias mensagens que o bot grava num único insert
  -- ficam todas com o mesmo valor e a ordem sai indefinida. `seq` é monotônico.
  seq bigint generated always as identity,
  conversation_id uuid not null references public.chat_conversations on delete cascade,
  role public.chat_message_role not null,
  content text not null,
  -- Chave do texto aprovado usado na resposta (só em mensagens do bot). É a
  -- prova auditável de que o bot não improvisou: todo texto sai de um catálogo
  -- versionado em src/modules/chat/flows/.
  content_key text,
  -- Telemetria do LLM (modelo, tokens, intenção detectada, latência).
  llm_meta jsonb,
  created_at timestamptz not null default now(),
  constraint chat_messages_bot_has_key check (role <> 'bot' or content_key is not null)
);

comment on table public.chat_messages is
  'Histórico completo das mensagens. `content_key` audita a origem do texto do bot.';

create index chat_messages_conversation_idx
  on public.chat_messages (conversation_id, seq);

-- ----------------------------------------------------------------------------
-- 5. Leads do CSP
-- ----------------------------------------------------------------------------
create table public.csp_leads (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references public.chat_conversations on delete cascade,
  contact_id uuid references public.chat_contacts on delete set null,
  full_name text not null,
  city text not null,
  state text not null,
  contact_profile public.chat_contact_profile not null,
  interest public.csp_interest not null,
  volume_range public.csp_volume_range,
  preferred_channel public.chat_contact_channel not null,
  preferred_time public.chat_contact_time,
  phone text,
  email text,
  status public.lead_status not null default 'new',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint csp_leads_state_len check (char_length(state) = 2)
);

comment on table public.csp_leads is
  'Lead qualificado gerado ao final da triagem do fluxo CSP.';

create index csp_leads_status_idx on public.csp_leads (status, created_at desc);

-- ----------------------------------------------------------------------------
-- 6. Row Level Security
-- ----------------------------------------------------------------------------
-- Deny-by-default: habilitar RLS sem policy de escrita já barra `anon` e
-- `authenticated`. As policies abaixo liberam apenas LEITURA para o backoffice
-- (e escrita de gestão em `csp_leads`). A `service_role` do servidor ignora RLS.
alter table public.chat_contacts enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.csp_leads enable row level security;

create policy "chat_contacts_select"
  on public.chat_contacts for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

create policy "chat_conversations_select"
  on public.chat_conversations for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

create policy "chat_messages_select"
  on public.chat_messages for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

create policy "csp_leads_select"
  on public.csp_leads for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

-- Gestão do lead (status/observações) — espelha a permissão `leads.write`
-- em src/lib/rbac/rbac.config.ts. As duas devem contar a mesma história.
create policy "csp_leads_update"
  on public.csp_leads for update
  using (public.current_app_role() in ('admin', 'comercial'))
  with check (public.current_app_role() in ('admin', 'comercial'));

-- RLS filtra LINHA, não COLUNA. Sem o grant abaixo, um usuário `comercial`
-- poderia chamar o PostgREST direto com o próprio JWT e reescrever nome,
-- telefone ou `conversation_id` do lead — a policy deixaria passar. O app só
-- edita `status` e `notes` (src/lib/actions/leads.ts); o banco passa a impor
-- exatamente isso.
revoke update on public.csp_leads from authenticated;
grant update (status, notes) on public.csp_leads to authenticated;

-- Direito de eliminação (LGPD art. 18). Sem policy de DELETE, nem o admin
-- consegue atender um pedido do titular pelo app — só direto no banco, sem
-- trilha. A exclusão em `chat_conversations` cascateia para mensagens e lead.
create policy "chat_conversations_delete_admin"
  on public.chat_conversations for delete
  using (public.is_admin());

create policy "chat_contacts_delete_admin"
  on public.chat_contacts for delete
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 7. updated_at automático
-- ----------------------------------------------------------------------------
create trigger on_chat_contacts_updated
  before update on public.chat_contacts
  for each row execute procedure public.handle_updated_at();

create trigger on_chat_conversations_updated
  before update on public.chat_conversations
  for each row execute procedure public.handle_updated_at();

create trigger on_csp_leads_updated
  before update on public.csp_leads
  for each row execute procedure public.handle_updated_at();
