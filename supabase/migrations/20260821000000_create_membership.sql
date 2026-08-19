-- ============================================================================
-- Associados — cadastro público (landing) e registro definitivo
-- ----------------------------------------------------------------------------
-- Este módulo fecha o GAP 1 registrado no cabeçalho de Enquetes
-- (20260819000000_create_surveys.sql): até aqui, o banco não tinha um cadastro
-- de ASSOCIADOS. Tinha `profiles` (usuários do CRM) e `chat_contacts` (quem
-- falou com o bot) — nenhuma das duas é o registro de quem é associado da APCS.
--
-- ⚠️ AS QUATRO DECISÕES CENTRAIS
--
-- 1. SÃO DUAS TABELAS, E ELAS NÃO SÃO A MESMA COISA.
--    `membership_applications` é a CAIXA DE ENTRADA: o que uma pessoa digitou
--    num formulário público, sem ninguém ter conferido nada. Qualquer um na
--    internet escreve ali.
--    `members` é o REGISTRO: quem a APCS reconhece como associado. Só entra por
--    aprovação de alguém do CRM — ou pela carga dos associados que já existem.
--    Misturar as duas faria o formulário público escrever direto na fonte da
--    verdade da entidade, que é exatamente o que não pode acontecer.
--
-- 2. O FORMULÁRIO PÚBLICO NÃO TEM POLICY DE INSERT — NEM PARA `anon`.
--    `membership_applications` é ilegível e inescrevível pelo PostgREST. A
--    única porta de entrada é `submit_membership_application()`, que é
--    SECURITY DEFINER, tem EXECUTE revogado de `public`, `anon` e
--    `authenticated`, e só o servidor (service_role) chama — do mesmo jeito que
--    `register_survey_response` no módulo de Enquetes.
--    Motivo: um endpoint público que escreve no banco precisa de limite de
--    taxa, deduplicação e normalização ANTES da linha existir. Policy de RLS
--    não faz nada disso; uma função faz as três em uma transação.
--
-- 3. A CARGA DOS ASSOCIADOS EXISTENTES AINDA NÃO FOI FEITA — E ESTÁ DITO.
--    `members` nasce com `origin`, `external_id` e `joined_at` justamente para
--    recebê-la: dá para saber de onde cada associado veio, casar com o id do
--    sistema de origem e preservar a data real de associação (que é histórica,
--    não a data do insert). O índice único parcial de e-mail é o contrato que
--    essa carga vai ter de cumprir — ver o bloco "SOBRE A CARGA" abaixo.
--    NÃO existe função de importação neste arquivo. Não fingir que existe é
--    parte do desenho.
--
-- 4. O GRAFO DE SITUAÇÕES É DADO, NÃO CÓDIGO.
--    Igual a Palestras e Enquetes: as transições moram em
--    `membership_application_status_transitions` e um trigger recusa qualquer
--    passo fora do grafo, em QUALQUER caminho de escrita.
--
-- ============================================================================
-- SOBRE A CARGA DOS ASSOCIADOS QUE JÁ EXISTEM (a fazer, num segundo momento)
-- ============================================================================
-- O que já está pronto para ela:
--   • `members.origin = 'import'` distingue quem veio da carga de quem se
--     cadastrou pela landing ou foi criado à mão.
--   • `members.external_id` guarda o identificador do sistema de origem, com
--     índice único parcial — reimportar o mesmo arquivo não duplica ninguém.
--   • `members.joined_at` é a data REAL de associação; `created_at` é a data em
--     que a linha entrou neste banco. São coisas diferentes e a carga precisa
--     das duas.
--   • Quase toda coluna é anulável, porque cadastro legado é incompleto por
--     natureza. As exceções são `full_name`, `status` e `origin`.
--
-- O que a carga vai ter de resolver ANTES de rodar:
--   • `members_email_unique_idx` recusa dois associados com o mesmo e-mail. É
--     de propósito: sem isso o registro deixa de ser fonte única da verdade no
--     primeiro arquivo com duplicata, e o vínculo com a solicitação (decisão 1)
--     passa a apontar para qualquer um dos dois. E-mail nulo é aceito, então
--     associado antigo sem e-mail entra sem problema — o que não entra é o
--     MESMO e-mail duas vezes.
--
-- ============================================================================
-- CÓDIGOS DE ERRO — classe `MA`, mapeada em src/lib/actions/errors.ts.
-- Classe própria porque a `P0` é RESERVADA pelo PL/pgSQL; ver
-- 20260813000200_fix_event_error_codes.sql. `MA` não colide com `EV`
-- (Eventos), `MB` (Bolsa), `PL` (Palestras) nem `SV` (Enquetes).
--   42501  sem permissão
--   P0002  solicitação/associado não encontrado (no_data_found)
--   MA001  transição de situação não permitida
--   MA002  a situação atual não permite esta operação
--   MA003  dados inválidos para o perfil escolhido
--   MA004  limite de envios do formulário público atingido
--   MA005  é preciso justificar a recusa
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
-- Os três perfis do formulário validado. Enum e não tabela, pelo padrão do
-- projeto: é o que dá checagem em tempo de compilação via `pnpm db:types`.
create type public.membership_profile_type as enum (
  'suinocultor',  -- atua diretamente na produção
  'profissional', -- técnico, comercial ou institucional da cadeia
  'empresa'       -- fornece, compra ou presta serviço para o setor
);

comment on type public.membership_profile_type is
  'Perfil declarado por quem se cadastra. Define quais campos são obrigatórios.';

create type public.membership_application_status as enum (
  'pending',   -- AGUARDANDO — acabou de chegar, ninguém olhou
  'in_review', -- EM ANÁLISE  — alguém do CRM assumiu
  'approved',  -- APROVADA    — terminal; gerou (ou vinculou) um associado
  'rejected'   -- RECUSADA    — não terminal: dá para reabrir
);

comment on type public.membership_application_status is
  'Situação da solicitação. As transições permitidas estão em membership_application_status_transitions.';

create type public.member_status as enum (
  'active',    -- ATIVO
  'inactive',  -- INATIVO — desligou-se ou não renovou
  'suspended'  -- SUSPENSO — vínculo temporariamente interrompido
);

comment on type public.member_status is
  'Situação do associado no registro da APCS.';

-- ⚠️ `import` existe desde já e NÃO é usado por nada neste arquivo. É o rótulo
-- reservado para a carga dos associados existentes (ver o bloco SOBRE A CARGA).
create type public.member_origin as enum (
  'application', -- nasceu de uma solicitação aprovada
  'import',      -- veio da carga do cadastro legado (a fazer)
  'manual'       -- criado à mão por alguém do CRM
);

comment on type public.member_origin is
  'De onde veio o associado. "import" está reservado para a carga do cadastro legado.';

create type public.membership_audit_action as enum (
  'application_submitted',
  'application_review_started',
  'application_approved',
  'application_rejected',
  'application_reopened',
  'member_created',
  'member_linked'
);

comment on type public.membership_audit_action is
  'Ações registradas na trilha de auditoria do módulo de Associados.';

-- ----------------------------------------------------------------------------
-- 2. Protocolo da solicitação
-- ----------------------------------------------------------------------------
-- Mesma decisão de Palestras: o protocolo sai de uma SEQUENCE, não de um
-- pedaço do uuid. Oito caracteres de um uuid colidem com probabilidade real
-- (~1% em 10 mil linhas), e um protocolo que colide é um protocolo que manda a
-- pessoa do suporte abrir a solicitação errada.
create sequence public.membership_protocol_seq;

create or replace function public.next_membership_protocol()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'ASC-' || lpad(nextval('public.membership_protocol_seq')::text, 6, '0');
$$;

comment on function public.next_membership_protocol() is
  'Próximo protocolo de solicitação (ASC-000001). Só o DEFAULT da coluna deve chamá-la.';

-- O DEFAULT da coluna é avaliado com os privilégios de quem insere.
-- `service_role` está na lista porque o formulário é público e entra por ali.
grant usage on sequence public.membership_protocol_seq to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Associados — o registro definitivo
-- ----------------------------------------------------------------------------
-- Vem ANTES de `membership_applications` porque a solicitação referencia o
-- associado que ela gerou, e não o contrário. Uma seta só: para saber qual
-- solicitação originou um associado, consulta-se a solicitação pelo `member_id`.
-- Duas setas seriam um ciclo de FK, e ciclo de FK é dívida.
create table public.members (
  id uuid primary key default gen_random_uuid(),

  -- Matrícula/código do associado. Nulo hoje: quem atribui é a APCS, e a carga
  -- do cadastro legado provavelmente traz o código de lá.
  code text,

  status public.member_status not null default 'active',
  origin public.member_origin not null,

  -- Identificador no sistema de origem da carga. Nulo para quem nasceu aqui.
  external_id text,

  profile_type public.membership_profile_type,

  -- ⚠️ A ÚNICA coluna de conteúdo obrigatória. Cadastro legado é incompleto por
  -- natureza; exigir e-mail ou telefone travaria a carga logo na primeira
  -- linha antiga. Um associado sem nome, porém, não é um registro — é ruído.
  full_name text not null,

  -- Sempre só dígitos (DDD + número). A validação de forma vive no
  -- `membership.schema.ts`; aqui fica só o formato bruto, para a carga não
  -- esbarrar em regra de negócio de 2026 ao subir um cadastro de 2011.
  whatsapp text,
  email text,
  city text,
  state text,
  organization text,

  -- Suinocultor
  farm_name text,
  production_city text,
  sow_count integer,
  cnpj text,
  state_registration text,

  -- Profissional do setor
  activity_area text,
  job_title text,

  -- Empresa
  legal_name text,
  trade_name text,

  interests text[] not null default '{}'::text[],
  other_interest text,

  -- Data REAL de associação. Diferente de `created_at`, que é quando a linha
  -- entrou neste banco — e para a carga elas nunca serão iguais.
  joined_at date,
  notes text,

  -- Ponte com o WhatsApp. `chat_contacts` é a única entidade do banco que tem
  -- telefone usável pelo disparo de Enquetes; ligar o associado a ela é o que
  -- vai permitir, um dia, segmentar campanha por "é associado".
  contact_id uuid references public.chat_contacts on delete set null,

  created_by uuid references public.profiles on delete set null,
  updated_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint members_full_name_len check (char_length(full_name) between 3 and 160),
  constraint members_state_format check (state is null or state ~ '^[A-Z]{2}$'),
  constraint members_whatsapp_digits check (whatsapp is null or whatsapp ~ '^[0-9]{10,11}$'),
  constraint members_cnpj_digits check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  constraint members_sow_count_range check (sow_count is null or sow_count between 0 and 9999999),
  constraint members_interests_max check (cardinality(interests) <= 10)
);

comment on table public.members is
  'Registro de associados da APCS. Destino da carga do cadastro legado (origin = import) e das solicitações aprovadas.';
comment on column public.members.external_id is
  'Identificador no sistema de origem da carga. Índice único parcial: reimportar o mesmo arquivo não duplica.';
comment on column public.members.joined_at is
  'Data real de associação (histórica). NÃO confundir com created_at, que é quando a linha entrou neste banco.';
comment on column public.members.contact_id is
  'Vínculo com chat_contacts — a entidade que tem telefone. É por aqui que Enquetes vai poder segmentar por "é associado".';

-- ⚠️ O contrato que a carga vai ter de cumprir. Ver o bloco SOBRE A CARGA.
create unique index members_email_unique_idx
  on public.members (lower(email))
  where email is not null;

create unique index members_code_unique_idx
  on public.members (code)
  where code is not null;

create unique index members_external_id_unique_idx
  on public.members (external_id)
  where external_id is not null;

create index members_status_idx on public.members (status, created_at desc);
create index members_whatsapp_idx on public.members (whatsapp) where whatsapp is not null;
create index members_name_idx on public.members (lower(full_name));

-- ----------------------------------------------------------------------------
-- 4. Solicitações de associação — a caixa de entrada pública
-- ----------------------------------------------------------------------------
create table public.membership_applications (
  id uuid primary key default gen_random_uuid(),

  -- Sem `grant insert` e sem `grant update`: o protocolo é do sistema.
  protocol text not null unique default public.next_membership_protocol(),

  status public.membership_application_status not null default 'pending',

  -- ⚠️ Daqui para baixo é TUDO texto que veio da internet. Nada aqui foi
  -- conferido por ninguém; a normalização (dígitos, minúsculas, maiúsculas de
  -- UF) acontece em `submit_membership_application`, e a validação de forma no
  -- `membership.schema.ts`, que roda no cliente E na action.
  profile_type public.membership_profile_type not null,
  full_name text not null,
  whatsapp text not null,
  email text not null,
  city text not null,
  state text not null,
  organization text,

  farm_name text,
  production_city text,
  sow_count integer,
  cnpj text,
  state_registration text,

  activity_area text,
  job_title text,

  legal_name text,
  trade_name text,

  interests text[] not null default '{}'::text[],
  other_interest text,

  -- LGPD. O aceite é o que autoriza a APCS a tratar o resto desta linha, então
  -- ele é obrigatório NO BANCO — não só no formulário.
  consent_accepted boolean not null,
  consent_at timestamptz not null default now(),
  consent_policy_version text,

  -- Deduplicação do envio duplo (duplo clique, F5, rede instável). A chave
  -- inclui uma janela de tempo, montada na action: o mesmo e-mail pode se
  -- candidatar de novo semanas depois, mas não três vezes em cinco minutos.
  dedupe_key text not null unique,

  -- SHA-256 do IP, nunca o IP em claro — mesmo desenho de `chat_conversations`.
  -- Serve ao limite de taxa e a nada mais.
  source_ip_hash text,
  user_agent text,

  -- Preenchido na aprovação. A seta única da decisão 1.
  member_id uuid references public.members on delete set null,

  reviewed_by uuid references public.profiles on delete set null,
  reviewed_at timestamptz,
  review_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint membership_applications_consent check (consent_accepted),
  constraint membership_applications_full_name_len check (char_length(full_name) between 3 and 120),
  constraint membership_applications_email_len check (char_length(email) between 5 and 255),
  constraint membership_applications_email_shape check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint membership_applications_state_format check (state ~ '^[A-Z]{2}$'),
  constraint membership_applications_whatsapp_digits check (whatsapp ~ '^[0-9]{10,11}$'),
  constraint membership_applications_cnpj_digits check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  constraint membership_applications_sow_count_range check (sow_count is null or sow_count between 0 and 9999999),
  constraint membership_applications_interests_max check (cardinality(interests) <= 10),
  constraint membership_applications_review_note_len check (review_note is null or char_length(review_note) <= 1000),
  -- Situação terminal de aprovação SEMPRE aponta para um associado. Sem isto,
  -- uma aprovação que falhasse no meio deixaria a solicitação verde e o
  -- registro vazio — o pior desfecho possível para quem se cadastrou.
  constraint membership_applications_approved_has_member
    check (status <> 'approved' or member_id is not null)
);

comment on table public.membership_applications is
  'Caixa de entrada do formulário público. Escrita SÓ por submit_membership_application (service_role); nunca pelo PostgREST.';
comment on column public.membership_applications.dedupe_key is
  'Chave de deduplicação por janela de tempo. Montada na action, única no banco — o duplo clique vira "duplicate", não linha nova.';
comment on column public.membership_applications.source_ip_hash is
  'SHA-256 do IP. Existe para o limite de taxa do formulário público e para mais nada.';

create index membership_applications_status_idx
  on public.membership_applications (status, created_at desc);
create index membership_applications_email_idx
  on public.membership_applications (lower(email));
create index membership_applications_ip_idx
  on public.membership_applications (source_ip_hash, created_at desc)
  where source_ip_hash is not null;
create index membership_applications_member_idx
  on public.membership_applications (member_id)
  where member_id is not null;

-- ----------------------------------------------------------------------------
-- 5. Trilha de auditoria
-- ----------------------------------------------------------------------------
create table public.membership_audit_logs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.membership_applications on delete cascade,
  member_id uuid references public.members on delete cascade,
  action public.membership_audit_action not null,
  actor_id uuid references public.profiles on delete set null,
  -- Snapshot do nome: se o usuário for removido, a trilha continua legível.
  actor_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.membership_audit_logs is
  'Trilha imutável do módulo de Associados. actor_id nulo = escrita do próprio sistema (formulário público).';

create index membership_audit_logs_application_idx
  on public.membership_audit_logs (application_id, created_at desc);
create index membership_audit_logs_member_idx
  on public.membership_audit_logs (member_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 6. O grafo de situações da solicitação
-- ----------------------------------------------------------------------------
create table public.membership_application_status_transitions (
  from_status public.membership_application_status,
  to_status public.membership_application_status not null,
  created_at timestamptz not null default now()
);

comment on table public.membership_application_status_transitions is
  'Transições permitidas. from_status NULO = ponto de entrada.';

create unique index membership_application_transitions_pair_idx
  on public.membership_application_status_transitions (from_status, to_status)
  where from_status is not null;

create unique index membership_application_transitions_entry_idx
  on public.membership_application_status_transitions (to_status)
  where from_status is null;

-- ENTRADA: só AGUARDANDO. Nascer aprovada puloria a conferência humana, que é
-- a razão de a caixa de entrada existir separada do registro (decisão 1).
insert into public.membership_application_status_transitions (from_status, to_status) values
  (null, 'pending');

-- O fluxo: alguém assume, depois decide.
insert into public.membership_application_status_transitions (from_status, to_status) values
  ('pending',   'in_review'),
  ('in_review', 'approved'),
  ('in_review', 'rejected');

-- Atalhos: dá para decidir sem passar por "em análise" — a maioria das
-- solicitações se resolve numa olhada só, e obrigar dois cliques faria o time
-- deixar tudo em "aguardando" para sempre.
insert into public.membership_application_status_transitions (from_status, to_status) values
  ('pending', 'approved'),
  ('pending', 'rejected');

-- Devolver para a fila: quem assumiu por engano solta.
insert into public.membership_application_status_transitions (from_status, to_status) values
  ('in_review', 'pending');

-- Reabrir uma recusa. Existe porque recusa costuma ser por dado faltando, e a
-- pessoa liga depois com o dado. Sem isso, a saída seria pedir um segundo
-- cadastro — e aí o histórico da primeira decisão se perde.
insert into public.membership_application_status_transitions (from_status, to_status) values
  ('rejected', 'pending'),
  ('rejected', 'in_review');

-- ⚠️ NÃO EXISTE saída de 'approved'. Aprovar cria (ou vincula) um associado no
-- registro; desfazer isso pelo grafo deixaria a solicitação livre e o associado
-- de pé. Quem precisa reverter mexe no ASSOCIADO (status inactive), que é onde
-- a informação de verdade mora.

-- ----------------------------------------------------------------------------
-- 7. Row Level Security
-- ----------------------------------------------------------------------------
-- Espelha PERMISSION_MATRIX em src/lib/rbac/rbac.config.ts:
--   members.read  → admin, ceo, comercial   (Administrador, Gestor, Atendente)
--   members.write → admin, ceo              (Administrador, Gestor)
--
-- ⚠️ TODA policy usa `(select public.current_app_role())`, com o subselect. Sem
-- ele o Postgres avalia a função uma vez POR LINHA; medido neste projeto, em
-- Palestras, com 20 mil linhas: 376 ms → 6,4 ms. Ver
-- 20260818000000_lecture_rls_initplan.sql.
alter table public.members enable row level security;
alter table public.membership_applications enable row level security;
alter table public.membership_audit_logs enable row level security;
alter table public.membership_application_status_transitions enable row level security;

create policy "members_select"
  on public.members for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

create policy "membership_applications_select"
  on public.membership_applications for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

create policy "membership_application_transitions_select"
  on public.membership_application_status_transitions for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

-- A trilha é mais estreita que a leitura, como nos outros módulos: o Atendente
-- consulta solicitações, não o histórico de quem decidiu o quê.
create policy "membership_audit_logs_select"
  on public.membership_audit_logs for select
  using ((select public.current_app_role()) in ('admin', 'ceo'));

-- ----------------------------------------------------------------------------
-- 8. Grants
-- ----------------------------------------------------------------------------
-- ⚠️ NENHUMA policy de escrita, em NENHUMA das quatro tabelas — e nenhum grant
-- de escrita. Toda mudança passa pelas funções da seção 11, que são SECURITY
-- DEFINER e checam o papel na entrada.
--
-- É diferente de Enquetes (que usa policies + grants de coluna) e a diferença
-- tem motivo: aqui existe um caminho de escrita PÚBLICO. Uma policy que
-- deixasse `anon` inserir teria de confiar no cliente para deduplicar e limitar
-- taxa, e não existe policy que saiba fazer isso. Com uma porta só, o limite
-- de taxa é uma linha de SQL dentro dela.
revoke insert, update, delete on public.members from authenticated, anon;
revoke insert, update, delete on public.membership_applications from authenticated, anon;
revoke insert, update, delete on public.membership_audit_logs from authenticated, anon;
revoke insert, update, delete on public.membership_application_status_transitions from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 9. updated_at automático
-- ----------------------------------------------------------------------------
create trigger on_members_updated
  before update on public.members
  for each row execute procedure public.handle_updated_at();

create trigger on_membership_applications_updated
  before update on public.membership_applications
  for each row execute procedure public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 10. O guarda do módulo
-- ----------------------------------------------------------------------------
-- ⚠️ SECURITY DEFINER pelo mesmo motivo sutil de Palestras e Enquetes: a função
-- LÊ a tabela de transições, que tem RLS. Como INVOKER, um chamador sem SELECT
-- naquela tabela leria ZERO linhas, o `not exists` daria verdadeiro e TODA
-- transição seria recusada — um trigger de segurança falhando fechado pelo
-- motivo errado é um trigger que ninguém consegue depurar.
create or replace function public.enforce_membership_application_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.membership_application_status_transitions
      where from_status is null and to_status = new.status
    ) then
      raise exception 'Uma solicitação não pode ser criada na situação "%".', new.status
        using errcode = 'MA001';
    end if;

    return new;
  end if;

  -- O protocolo é do sistema, em qualquer caminho de escrita.
  if new.protocol is distinct from old.protocol then
    raise exception 'O protocolo da solicitação não pode ser alterado.'
      using errcode = 'MA002';
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if not exists (
    select 1 from public.membership_application_status_transitions
    where from_status = old.status and to_status = new.status
  ) then
    raise exception 'Não é possível mudar a situação de "%" para "%".', old.status, new.status
      using errcode = 'MA001';
  end if;

  return new;
end;
$$;

comment on function public.enforce_membership_application_rules() is
  'Guarda do módulo: valida o ponto de entrada, o grafo de transições e a imutabilidade do protocolo.';

create trigger membership_applications_guard
  before insert or update on public.membership_applications
  for each row execute procedure public.enforce_membership_application_rules();

-- ----------------------------------------------------------------------------
-- 11. Quem pode o quê
-- ----------------------------------------------------------------------------
-- ⚠️ O `coalesce(..., false)` NÃO é decoração. `current_app_role()` devolve NULL
-- para quem não tem perfil, e em SQL `NULL not in ('admin','ceo')` é NULL — que
-- um `if` trata como falso. Ou seja, `if role not in (...) then raise` deixa
-- passar exatamente quem não tem papel nenhum, em silêncio. O furo foi
-- encontrado de verdade na bateria de Enquetes; ver a seção 15.0 de
-- 20260819000000_create_surveys.sql.
create or replace function public.membership_is_writer()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select public.current_app_role()) in ('admin', 'ceo'), false)
    -- A válvula para quem NÃO É USUÁRIO FINAL: sem `auth.uid()` não há perfil a
    -- consultar. Quem chega assim é o servidor (service_role) ou o dono do
    -- banco (migration, seed, a carga do cadastro legado quando ela vier).
    -- O visitante do formulário NÃO chega: `anon` não tem EXECUTE (seção 12).
    or (select auth.uid()) is null;
$$;

comment on function public.membership_is_writer() is
  'Pode decidir solicitação e mexer no registro de associados (Administrador e Gestor).';

create or replace function public.membership_is_reader()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Sem a válvula de `auth.uid() is null`, e de propósito: funções DEFINER que
  -- DEVOLVEM DADO recusam chamada sem sessão. É a assimetria de Enquetes.
  select coalesce((select public.current_app_role()) in ('admin', 'ceo', 'comercial'), false);
$$;

comment on function public.membership_is_reader() is
  'Pode ler solicitações e associados (Administrador, Gestor e Atendente).';

-- Serializa operações concorrentes sobre a MESMA solicitação — dois gestores
-- clicando "Aprovar" ao mesmo tempo criariam dois associados.
--
-- Lock consultivo e não `select ... for update`: em tabela com RLS, `for update`
-- também exige privilégio de UPDATE, e ninguém tem UPDATE aqui (seção 8).
create or replace function public.lock_membership_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.membership_is_writer() then
    raise exception 'Sem permissão para alterar solicitações de associação.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('membership_application:' || p_application_id::text));
end;
$$;

-- ----------------------------------------------------------------------------
-- 12. A porta do formulário público
-- ----------------------------------------------------------------------------
-- Envios do mesmo IP aceitos por hora. Alto o bastante para uma família toda se
-- cadastrar do mesmo escritório, baixo o bastante para um script não encher a
-- caixa de entrada. O fusível de verdade é este número somado ao `dedupe_key`.
create or replace function public.membership_ip_hourly_limit()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 8;
$$;

-- ⚠️ SECURITY DEFINER e EXECUTE revogado de `public`, `anon` e `authenticated`.
-- Só o servidor chama, com a chave de service_role — o mesmo desenho de
-- `register_survey_response`. Ver a decisão 2 do cabeçalho.
--
-- Devolve `duplicate = true` quando o `dedupe_key` já existia: o duplo clique
-- recebe o MESMO protocolo em vez de uma segunda linha ou de um erro. O
-- `on conflict do nothing` faz isso ATOMICAMENTE — um "consulta, e se não achar
-- insere" perderia a corrida entre duas requisições simultâneas.
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
as $$
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
  if p_profile_type = 'suinocultor' and nullif(btrim(coalesce(p_production_city, '')), '') is null then
    raise exception 'Informe o município da produção.' using errcode = 'MA003';
  end if;

  if p_profile_type = 'profissional' then
    if nullif(btrim(coalesce(p_activity_area, '')), '') is null then
      raise exception 'Informe a área de atuação.' using errcode = 'MA003';
    end if;
    if nullif(btrim(coalesce(p_job_title, '')), '') is null then
      raise exception 'Informe o cargo ou função.' using errcode = 'MA003';
    end if;
  end if;

  if p_profile_type = 'empresa' then
    if nullif(btrim(coalesce(p_legal_name, '')), '') is null then
      raise exception 'Informe a razão social.' using errcode = 'MA003';
    end if;
    if nullif(btrim(coalesce(p_job_title, '')), '') is null then
      raise exception 'Informe o cargo ou função do contato.' using errcode = 'MA003';
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
    raise exception 'Não foi possível registrar a solicitação.' using errcode = 'MA002';
  end if;

  return query select v_row.id, v_row.protocol, true;
end;
$$;

comment on function public.submit_membership_application is
  'Única porta de entrada do formulário público. Normaliza, limita taxa, deduplica e audita. Só service_role executa.';

-- ----------------------------------------------------------------------------
-- 13. As decisões do CRM
-- ----------------------------------------------------------------------------
-- Assumir a análise. Existe separado de aprovar/recusar porque o §do produto é
-- simples: enquanto ninguém assumiu, a solicitação é de todo mundo — e "de todo
-- mundo" é de ninguém.
create or replace function public.start_membership_review(p_application_id uuid)
returns public.membership_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.membership_applications%rowtype;
begin
  perform public.lock_membership_application(p_application_id);

  select * into v_row from public.membership_applications a where a.id = p_application_id;
  if v_row.id is null then
    raise exception 'Solicitação não encontrada.' using errcode = 'P0002';
  end if;

  update public.membership_applications
  set status = 'in_review',
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = p_application_id
  returning * into v_row;

  insert into public.membership_audit_logs (application_id, action, actor_id, actor_name)
  values (p_application_id, 'application_review_started', (select auth.uid()), public.current_actor_name());

  return v_row;
end;
$$;

-- Recusar. A justificativa é OBRIGATÓRIA: uma recusa sem motivo é uma recusa
-- que ninguém consegue explicar para a pessoa que ligou perguntando.
create or replace function public.reject_membership_application(
  p_application_id uuid,
  p_reason text
)
returns public.membership_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.membership_applications%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.lock_membership_application(p_application_id);

  select * into v_row from public.membership_applications a where a.id = p_application_id;
  if v_row.id is null then
    raise exception 'Solicitação não encontrada.' using errcode = 'P0002';
  end if;

  -- Depois da existência, e não antes: "informe o motivo" para uma solicitação
  -- que não existe manda a pessoa preencher um campo que não vai adiantar.
  if v_reason is null then
    raise exception 'Informe o motivo da recusa.' using errcode = 'MA005';
  end if;

  update public.membership_applications
  set status = 'rejected',
      review_note = v_reason,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = p_application_id
  returning * into v_row;

  insert into public.membership_audit_logs (application_id, action, actor_id, actor_name, metadata)
  values (
    p_application_id, 'application_rejected', (select auth.uid()), public.current_actor_name(),
    jsonb_build_object('reason', v_reason)
  );

  return v_row;
end;
$$;

-- Devolver para a fila (quem assumiu por engano) ou reabrir uma recusa.
create or replace function public.reopen_membership_application(
  p_application_id uuid,
  p_reason text default null
)
returns public.membership_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.membership_applications%rowtype;
  v_was public.membership_application_status;
begin
  perform public.lock_membership_application(p_application_id);

  select * into v_row from public.membership_applications a where a.id = p_application_id;
  if v_row.id is null then
    raise exception 'Solicitação não encontrada.' using errcode = 'P0002';
  end if;

  v_was := v_row.status;

  update public.membership_applications
  set status = 'pending',
      review_note = null,
      reviewed_by = null,
      reviewed_at = null
  where id = p_application_id
  returning * into v_row;

  insert into public.membership_audit_logs (application_id, action, actor_id, actor_name, metadata)
  values (
    p_application_id, 'application_reopened', (select auth.uid()), public.current_actor_name(),
    jsonb_build_object('from', v_was)
  );

  return v_row;
end;
$$;

-- ⚠️ A OPERAÇÃO MAIS IMPORTANTE DO ARQUIVO: aprovar cria o associado.
--
-- Se já existir um associado com o mesmo e-mail, VINCULA em vez de criar. Sem
-- isso, o índice único de e-mail transformaria "essa pessoa já é associada e
-- se cadastrou de novo" — o caso mais comum de todos — num erro de banco na
-- cara do gestor.
create or replace function public.approve_membership_application(
  p_application_id uuid,
  p_note text default null
)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.membership_applications%rowtype;
  v_member public.members%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_linked boolean := false;
begin
  perform public.lock_membership_application(p_application_id);

  select * into v_app from public.membership_applications a where a.id = p_application_id;
  if v_app.id is null then
    raise exception 'Solicitação não encontrada.' using errcode = 'P0002';
  end if;

  if v_app.status = 'approved' then
    raise exception 'Esta solicitação já foi aprovada.' using errcode = 'MA002';
  end if;

  select * into v_member from public.members m where lower(m.email) = lower(v_app.email);

  if v_member.id is null then
    insert into public.members (
      status, origin, profile_type, full_name, whatsapp, email, city, state,
      organization, farm_name, production_city, sow_count, cnpj, state_registration,
      activity_area, job_title, legal_name, trade_name, interests, other_interest,
      joined_at, created_by, updated_by
    ) values (
      'active', 'application', v_app.profile_type, v_app.full_name, v_app.whatsapp,
      v_app.email, v_app.city, v_app.state, v_app.organization, v_app.farm_name,
      v_app.production_city, v_app.sow_count, v_app.cnpj, v_app.state_registration,
      v_app.activity_area, v_app.job_title, v_app.legal_name, v_app.trade_name,
      v_app.interests, v_app.other_interest,
      -- A data de associação é HOJE para quem entra pela landing. Para quem
      -- vier da carga, é a data histórica — por isso a coluna existe.
      current_date, (select auth.uid()), (select auth.uid())
    )
    returning * into v_member;

    insert into public.membership_audit_logs (application_id, member_id, action, actor_id, actor_name)
    values (p_application_id, v_member.id, 'member_created', (select auth.uid()), public.current_actor_name());
  else
    v_linked := true;

    insert into public.membership_audit_logs (application_id, member_id, action, actor_id, actor_name, metadata)
    values (
      p_application_id, v_member.id, 'member_linked', (select auth.uid()), public.current_actor_name(),
      jsonb_build_object('reason', 'e-mail já existente no registro de associados')
    );
  end if;

  update public.membership_applications
  set status = 'approved',
      member_id = v_member.id,
      review_note = v_note,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = p_application_id;

  insert into public.membership_audit_logs (application_id, member_id, action, actor_id, actor_name, metadata)
  values (
    p_application_id, v_member.id, 'application_approved', (select auth.uid()), public.current_actor_name(),
    jsonb_build_object('linkedToExisting', v_linked)
  );

  return v_member;
end;
$$;

comment on function public.approve_membership_application is
  'Aprova a solicitação e cria (ou vincula) o associado, em uma transação. Vincula quando o e-mail já existe no registro.';

-- ----------------------------------------------------------------------------
-- 14. EXECUTE — quem pode chamar o quê
-- ----------------------------------------------------------------------------
-- ⚠️ O `revoke ... from public` é INDISPENSÁVEL: o Supabase tem
-- `alter default privileges` concedendo EXECUTE a `anon` em toda função nova
-- do schema `public`. Sem a linha abaixo, o visitante anônimo poderia chamar
-- estas funções direto pelo PostgREST.
-- O guarda é função de trigger: chamá-la direto sempre erra ("trigger functions
-- can only be called as triggers"). O revoke entra mesmo assim, porque a
-- checagem "o anon não executa NADA deste módulo" só vale se não tiver exceção.
revoke execute on function public.enforce_membership_application_rules() from public, anon, authenticated;

revoke execute on function public.next_membership_protocol() from public, anon;
grant execute on function public.next_membership_protocol() to authenticated, service_role;

revoke execute on function public.membership_ip_hourly_limit() from public, anon, authenticated;

revoke execute on function public.membership_is_writer() from public, anon;
grant execute on function public.membership_is_writer() to authenticated;

revoke execute on function public.membership_is_reader() from public, anon;
grant execute on function public.membership_is_reader() to authenticated;

revoke execute on function public.lock_membership_application(uuid) from public, anon;
grant execute on function public.lock_membership_application(uuid) to authenticated;

-- A porta pública: NEM `anon` NEM `authenticated`. Só service_role, que é quem
-- o servidor usa — ver a decisão 2 do cabeçalho.
revoke execute on function public.submit_membership_application(
  public.membership_profile_type, text, text, text, text, text, text,
  text, text, text, integer, text, text, text, text, text, text,
  text[], text, text, text, text
) from public, anon, authenticated;

revoke execute on function public.start_membership_review(uuid) from public, anon;
grant execute on function public.start_membership_review(uuid) to authenticated;

revoke execute on function public.reject_membership_application(uuid, text) from public, anon;
grant execute on function public.reject_membership_application(uuid, text) to authenticated;

revoke execute on function public.reopen_membership_application(uuid, text) from public, anon;
grant execute on function public.reopen_membership_application(uuid, text) to authenticated;

revoke execute on function public.approve_membership_application(uuid, text) from public, anon;
grant execute on function public.approve_membership_application(uuid, text) to authenticated;
