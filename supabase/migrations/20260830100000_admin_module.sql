-- ============================================================================
-- ADMINISTRAÇÃO — Usuários e Configurações
-- ----------------------------------------------------------------------------
-- Liga os dois últimos itens da navegação que estavam como "Em breve". O que
-- eles resolvem é concreto: hoje um usuário novo só nasce pelo painel do
-- Supabase, o catálogo de públicos-alvo só muda por migration, e os textos que
-- saem no WhatsApp só mudam por deploy.
--
-- ----------------------------------------------------------------------------
-- ⚠️ AS CINCO DECISÕES
-- ----------------------------------------------------------------------------
--
-- 1. TROCAR PAPEL É FUNÇÃO, NÃO UPDATE DIRETO.
--    A policy `profiles_admin_all` já deixaria um admin escrever `role` pelo
--    PostgREST. O problema não é permissão: são as duas travas que uma policy
--    não sabe fazer — não deixar o sistema ficar SEM administrador, e não
--    deixar alguém se rebaixar sozinho e perder a própria chave. As duas viram
--    linha de SQL dentro da função; nenhuma delas cabe num `with check`.
--
-- 2. O TEXTO DE CONSENTIMENTO NÃO É UMA CONFIGURAÇÃO — É UM HISTÓRICO.
--    `app_settings` guarda chave e valor, e sobrescreve. Isso está certo para
--    a confirmação de opt-out e errado para a LGPD: a migration original
--    escreveu "ao alterar o texto, INCREMENTE a versão — não reescreva a
--    antiga", porque uma autorização só vale para o que a pessoa LEU. Então o
--    consentimento tem tabela própria, `consent_texts`, e ela é APPEND-ONLY:
--    publicar um texto novo insere uma linha, e as solicitações de 2026
--    continuam apontando para o texto de 2026.
--
-- 3. O SLUG DO PÚBLICO-ALVO CONTINUA IMUTÁVEL.
--    `update_event_segment` recebe nome, descrição e ativo — e não o slug. Ele
--    é a chave que prende os eventos já cadastrados e o mapeamento
--    perfil ↔ público (`profile_for_event_segment`); renomeá-lo pela tela
--    quebraria os dois em silêncio. Renomear o RÓTULO é seguro e é o que as
--    pessoas realmente querem.
--
-- 4. NENHUM SEGREDO ENTRA NO BANCO.
--    A tela de integração do WhatsApp é SÓ LEITURA e não tem onde gravar
--    token: as credenciais da Z-API continuam em variável de ambiente. Uma
--    caixa de texto para colar o token no banco transformaria uma tabela
--    comum na coisa mais sensível do sistema.
--
-- 5. A TRILHA É PRÓPRIA, E O ENUM NASCE AQUI.
--    `admin_audit_logs` não reaproveita `membership_audit_logs`: trocar o papel
--    de um usuário não é um fato sobre um associado. E o enum é CRIADO nesta
--    migration, então pode ser usado nela mesma — a separação em dois arquivos
--    só é obrigatória para `alter type ... add value` sobre enum que já existe.
--
-- ----------------------------------------------------------------------------
-- CÓDIGOS DE ERRO — classe `AD`. Não colide com EV, MB, PL, SV, MA, WA, NO.
--   42501  sem permissão
--   P0002  registro não encontrado
--   AD001  o sistema ficaria sem administrador
--   AD002  ninguém troca o próprio papel
--   AD003  esta versão de consentimento já existe
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A trilha da administração
-- ----------------------------------------------------------------------------
do $enum$
begin
  if not exists (select 1 from pg_type where typname = 'admin_audit_action') then
    create type public.admin_audit_action as enum (
      'user_role_changed',
      'user_invited',
      'segment_updated',
      'consent_text_published',
      'setting_updated',
      'notification_block_revoked'
    );
  end if;
end
$enum$;

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  action public.admin_audit_action not null,
  -- Sobre QUEM ou o QUÊ. Texto livre porque o alvo muda de natureza conforme a
  -- ação (um usuário, um público-alvo, uma chave de configuração) e uma FK só
  -- serviria para um dos casos.
  target text,
  actor_id uuid references public.profiles on delete set null,
  -- Snapshot do nome: se o usuário for removido, a trilha continua legível.
  actor_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.admin_audit_logs is
  'Trilha imutavel da Administracao: troca de papel, convite, catalogo, textos e configuracoes.';

create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs (created_at desc);

alter table public.admin_audit_logs enable row level security;

create policy "admin_audit_logs_select"
  on public.admin_audit_logs for select
  using ((select public.is_admin()));

revoke insert, update, delete on public.admin_audit_logs from authenticated, anon;

-- Registra na trilha. Interna: só as funções desta migration chamam.
create or replace function public.log_admin_action(
  p_action public.admin_audit_action,
  p_target text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $fn$
  insert into public.admin_audit_logs (action, target, actor_id, actor_name, metadata)
  values (p_action, p_target, (select auth.uid()), public.current_actor_name(), coalesce(p_metadata, '{}'::jsonb));
$fn$;

revoke execute on function public.log_admin_action(public.admin_audit_action, text, jsonb)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Usuários — quem tem acesso ao CRM
-- ----------------------------------------------------------------------------
-- ⚠️ AS DUAS TRAVAS QUE JUSTIFICAM ESTA FUNÇÃO EXISTIR (decisão 1).
--
-- Sem elas, dois cliques comuns quebram o sistema de um jeito que só o suporte
-- do Supabase desfaz:
--
--   • O ÚLTIMO ADMINISTRADOR VIRA ATENDENTE. A partir daí ninguém consegue
--     promover ninguém — a tela de Usuários fica visível para zero pessoas, e a
--     saída é editar a linha direto no banco.
--   • ALGUÉM SE REBAIXA SOZINHO. Mesmo com outro admin existindo, é sempre um
--     acidente: ninguém abre a tela de usuários para tirar o próprio acesso. O
--     custo de recusar é uma frase; o de aceitar é uma pessoa travada.
create or replace function public.set_user_role(
  p_user_id uuid,
  p_role public.app_role
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
    raise exception 'Apenas administradores alteram o papel de um usuario.' using errcode = '42501';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'Voce nao pode alterar o proprio papel.' using errcode = 'AD002';
  end if;

  select * into v_before from public.profiles p where p.id = p_user_id;
  if v_before.id is null then
    raise exception 'Usuario nao encontrado.' using errcode = 'P0002';
  end if;

  -- Nada mudou: sai sem escrever e sem sujar a trilha.
  if v_before.role = p_role then
    return v_before;
  end if;

  -- ⚠️ CONTA OS ADMINS ANTES DE REBAIXAR UM. `count(*) = 1` combinado com
  -- "este é admin e vai deixar de ser" é exatamente o caso em que o sistema
  -- fica órfão.
  if v_before.role = 'admin' and p_role <> 'admin' then
    select count(*) into v_admins from public.profiles p where p.role = 'admin';
    if v_admins <= 1 then
      raise exception 'O sistema precisa de pelo menos um administrador.' using errcode = 'AD001';
    end if;
  end if;

  update public.profiles
  set role = p_role
  where id = p_user_id
  returning * into v_after;

  perform public.log_admin_action(
    'user_role_changed',
    v_after.email,
    jsonb_build_object('from', v_before.role, 'to', p_role)
  );

  return v_after;
end;
$fn$;

comment on function public.set_user_role(uuid, public.app_role) is
  'Troca o papel de um usuario. Recusa deixar o sistema sem admin (AD001) e recusa trocar o proprio papel (AD002).';

revoke execute on function public.set_user_role(uuid, public.app_role) from public, anon;
grant execute on function public.set_user_role(uuid, public.app_role) to authenticated;

-- O convite em si acontece na API de auth do Supabase (o servidor chama com a
-- chave de service_role); esta função só registra que aconteceu.
create or replace function public.log_user_invite(p_email text, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores convidam usuarios.' using errcode = '42501';
  end if;

  perform public.log_admin_action(
    'user_invited',
    lower(btrim(p_email)),
    jsonb_build_object('role', p_role)
  );
end;
$fn$;

revoke execute on function public.log_user_invite(text, public.app_role) from public, anon;
grant execute on function public.log_user_invite(text, public.app_role) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Configurações simples — chave e valor
-- ----------------------------------------------------------------------------
-- ⚠️ O QUE PODE ENTRAR AQUI: texto que o sistema mostra ou envia. O que NÃO
-- pode: segredo (decisão 4) e qualquer coisa que precise de histórico
-- (decisão 2 — essa vai para `consent_texts`).
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),
  constraint app_settings_key_format check (key ~ '^[a-z0-9]+(\.[a-z0-9_]+)*$'),
  constraint app_settings_value_len check (char_length(value) between 1 and 2000)
);

comment on table public.app_settings is
  'Textos configuraveis da plataforma. NUNCA segredo: credenciais ficam em variavel de ambiente.';

alter table public.app_settings enable row level security;

-- ⚠️ A LEITURA É DE QUALQUER USUÁRIO LOGADO, e não só do admin. Estes textos
-- saem em mensagem de WhatsApp e no formulário público: o worker de disparo e a
-- landing precisam deles. (O worker usa `service_role`, que ignora RLS; a
-- policy aberta é para as telas do CRM que mostram o texto vigente.)
create policy "app_settings_select"
  on public.app_settings for select
  using (auth.uid() is not null);

revoke insert, update, delete on public.app_settings from authenticated, anon;

create or replace function public.set_app_setting(p_key text, p_value text)
returns public.app_settings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before text;
  v_row public.app_settings%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores alteram configuracoes.' using errcode = '42501';
  end if;

  select s.value into v_before from public.app_settings s where s.key = p_key;

  insert into public.app_settings (key, value, updated_by)
  values (p_key, btrim(p_value), (select auth.uid()))
  on conflict (key) do update
    set value = excluded.value,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning * into v_row;

  -- ⚠️ A TRILHA NÃO GUARDA O TEXTO, só o tamanho e se havia algo antes. O valor
  -- vive na própria tabela, e copiá-lo a cada edição faria a auditoria crescer
  -- sem responder nenhuma pergunta que a tabela já não responda.
  if v_before is distinct from v_row.value then
    perform public.log_admin_action(
      'setting_updated',
      p_key,
      jsonb_build_object('hadPrevious', v_before is not null, 'length', char_length(v_row.value))
    );
  end if;

  return v_row;
end;
$fn$;

revoke execute on function public.set_app_setting(text, text) from public, anon;
grant execute on function public.set_app_setting(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Consentimento (LGPD) — append-only
-- ----------------------------------------------------------------------------
-- Ver decisão 2. Esta tabela NÃO tem update nem delete, para ninguém e por
-- nenhum caminho: reescrever o texto de uma versão já usada apagaria a única
-- prova do que quem se cadastrou em 2026 leu antes de dizer sim.
create table if not exists public.consent_texts (
  version text primary key,
  body text not null,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  constraint consent_texts_version_format check (version ~ '^[0-9a-zA-Z._-]{3,40}$'),
  constraint consent_texts_body_len check (char_length(body) between 20 and 2000)
);

comment on table public.consent_texts is
  'Historico dos textos de consentimento. APPEND-ONLY: uma autorizacao so vale para o texto que a pessoa leu.';

create index if not exists consent_texts_created_idx
  on public.consent_texts (created_at desc);

alter table public.consent_texts enable row level security;

-- ⚠️ ABERTA A `anon`, E ISSO NÃO É UM VAZAMENTO — É O PONTO.
--
-- O texto de consentimento é exibido na landing PÚBLICA, para quem não tem
-- sessão nenhuma: é conteúdo jurídico feito para ser lido antes de alguém dizer
-- sim. Uma policy que exigisse login faria a única página do sistema que
-- precisa deste texto ser a única que não consegue lê-lo — e a saída seria
-- buscá-lo com `service_role` numa página aberta na internet, o que é bem pior.
--
-- Historico incluso: as versões antigas também são públicas. Elas são o texto
-- que alguém leu um dia, não um segredo.
create policy "consent_texts_select"
  on public.consent_texts for select
  using (true);

revoke insert, update, delete on public.consent_texts from authenticated, anon;

/**
 * A versão vigente é a MAIS RECENTE por data — não há coluna "ativa".
 *
 * Uma coluna de flag permitiria duas linhas ativas ao mesmo tempo, ou nenhuma,
 * e as duas situações são silenciosas. "A última publicada" não tem como
 * contradizer a si mesma.
 */
create or replace function public.current_consent_text()
returns public.consent_texts
language sql
stable
set search_path = ''
as $fn$
  select * from public.consent_texts order by created_at desc, version desc limit 1;
$fn$;

revoke execute on function public.current_consent_text() from public, anon;
grant execute on function public.current_consent_text() to authenticated, service_role;

create or replace function public.publish_consent_text(p_version text, p_body text)
returns public.consent_texts
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.consent_texts%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores publicam o texto de consentimento.' using errcode = '42501';
  end if;

  if exists (select 1 from public.consent_texts c where c.version = btrim(p_version)) then
    raise exception 'Esta versao ja existe. Publique com uma versao nova.' using errcode = 'AD003';
  end if;

  insert into public.consent_texts (version, body, created_by)
  values (btrim(p_version), btrim(p_body), (select auth.uid()))
  returning * into v_row;

  perform public.log_admin_action('consent_text_published', v_row.version, '{}'::jsonb);

  return v_row;
end;
$fn$;

comment on function public.publish_consent_text(text, text) is
  'Publica uma NOVA versao do texto de consentimento. Nunca reescreve uma existente (AD003).';

revoke execute on function public.publish_consent_text(text, text) from public, anon;
grant execute on function public.publish_consent_text(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Catálogo de públicos-alvo
-- ----------------------------------------------------------------------------
-- ⚠️ SEM `p_slug` NA ASSINATURA (decisão 3). O slug prende os eventos já
-- cadastrados e o mapeamento perfil ↔ público em `profile_for_event_segment`;
-- trocá-lo pela tela quebraria os dois sem erro nenhum aparecer.
create or replace function public.update_event_segment(
  p_segment_id uuid,
  p_name text,
  p_description text,
  p_active boolean
)
returns public.event_segments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before public.event_segments%rowtype;
  v_after public.event_segments%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores alteram o catalogo de publicos.' using errcode = '42501';
  end if;

  select * into v_before from public.event_segments s where s.id = p_segment_id;
  if v_before.id is null then
    raise exception 'Publico-alvo nao encontrado.' using errcode = 'P0002';
  end if;

  update public.event_segments
  set name = btrim(p_name),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      active = coalesce(p_active, true)
  where id = p_segment_id
  returning * into v_after;

  if v_after is distinct from v_before then
    perform public.log_admin_action(
      'segment_updated',
      v_after.slug,
      jsonb_build_object(
        'renamed', v_after.name is distinct from v_before.name,
        'activeFrom', v_before.active,
        'activeTo', v_after.active
      )
    );
  end if;

  return v_after;
end;
$fn$;

revoke execute on function public.update_event_segment(uuid, text, text, boolean) from public, anon;
grant execute on function public.update_event_segment(uuid, text, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Bloqueios de notificação — a lista
-- ----------------------------------------------------------------------------
-- ⚠️ FUNÇÃO E NÃO CONSULTA DIRETA, porque a lista precisa DIZER DE QUEM É o
-- telefone — e o vínculo com `members` é por chave de telefone, não por FK. O
-- PostgREST não sabe juntar por função; o Postgres sabe.
--
-- ⚠️ DEVOLVE OS REVOGADOS TAMBÉM, marcados. Uma lista que escondesse quem
-- voltou a receber não teria como responder "quem foi reativado, e a pedido de
-- quem?" — que é justamente a pergunta que a nota de reativação existe para
-- responder.
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
    c.name,
    (select total from contado)
  from filtrado f
  left join public.chat_contacts c on c.id = f.contact_id
  -- ⚠️ `distinct on` no lado do associado: o bloqueio é do TELEFONE, e dois
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

-- Desfaz UM bloqueio, pelo id da linha. Irmã de `resume_member_notifications`,
-- que parte do associado; esta parte da lista, onde nem todo telefone tem
-- associado (pode ser um contato do chatbot, ou um número que ninguém
-- reconhece).
create or replace function public.resume_notification_block(
  p_opt_out_id uuid,
  p_note text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.notification_opt_outs%rowtype;
  v_member_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores desfazem bloqueios por aqui.' using errcode = '42501';
  end if;

  -- A mesma exigência de `resume_member_notifications`, e pela mesma razão:
  -- reativar é a APCS voltar a mandar mensagem para quem mandou parar, e o que
  -- torna isso legítimo é a pessoa ter pedido.
  if v_note is null or char_length(v_note) < 5 then
    raise exception 'Registre quem pediu para voltar a receber.' using errcode = 'MA008';
  end if;

  select * into v_row from public.notification_opt_outs o where o.id = p_opt_out_id;
  if v_row.id is null then
    raise exception 'Bloqueio nao encontrado.' using errcode = 'P0002';
  end if;
  if v_row.revoked_at is not null then
    return false; -- já estava desfeito; nada a fazer e nada a registrar
  end if;

  update public.notification_opt_outs
  set revoked_at = now(),
      revoked_by = (select auth.uid()),
      revoked_note = left(v_note, 300)
  where id = p_opt_out_id;

  -- O associado, quando existe, para a trilha de Associados também registrar.
  select m.id into v_member_id
  from public.members m
  where public.notification_phone_key(m.whatsapp) = v_row.phone_key
    and v_row.phone_key is not null
  order by m.created_at, m.id
  limit 1;

  if v_member_id is not null then
    insert into public.membership_audit_logs (member_id, action, actor_id, actor_name, metadata)
    values (
      v_member_id,
      'member_notifications_resumed',
      (select auth.uid()),
      public.current_actor_name(),
      jsonb_build_object('note', left(v_note, 300), 'unblocked', 1, 'from', 'settings')
    );
  end if;

  perform public.log_admin_action(
    'notification_block_revoked',
    -- ⚠️ SÓ OS QUATRO ÚLTIMOS DÍGITOS. A trilha da administração é lida para
    -- saber O QUE foi feito; guardar o telefone inteiro faria dela mais uma
    -- lista de dados pessoais, num lugar que ninguém trata como tal.
    coalesce('***' || right(v_row.phone_key, 4), 'sem telefone'),
    jsonb_build_object('hadMember', v_member_id is not null)
  );

  return true;
end;
$fn$;

revoke execute on function public.resume_notification_block(uuid, text) from public, anon;
grant execute on function public.resume_notification_block(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Semente — o que já existe no código passa a existir no banco
-- ----------------------------------------------------------------------------
-- ⚠️ Os valores abaixo são CÓPIA do que hoje é constante em TypeScript. A
-- semente é o que faz a tela abrir mostrando o texto que está no ar, em vez de
-- uma caixa vazia que faria alguém concluir que a mensagem não existe.
insert into public.app_settings (key, value)
values (
  'whatsapp.opt_out_confirmed',
  'Pronto. Você não receberá mais mensagens da APCS. Se mudar de ideia, é só falar com a associação.'
)
on conflict (key) do nothing;

insert into public.consent_texts (version, body)
values (
  '2026-08-v1',
  'Autorizo a APCS a tratar meus dados para análise do cadastro e comunicação institucional, conforme a Lei Geral de Proteção de Dados.'
)
on conflict (version) do nothing;

-- ----------------------------------------------------------------------------
-- 8. Como desfazer
-- ----------------------------------------------------------------------------
--   drop function if exists public.resume_notification_block(uuid, text);
--   drop function if exists public.list_notification_blocks(integer, integer, boolean);
--   drop function if exists public.update_event_segment(uuid, text, text, boolean);
--   drop function if exists public.publish_consent_text(text, text);
--   drop function if exists public.current_consent_text();
--   drop function if exists public.set_app_setting(text, text);
--   drop function if exists public.log_user_invite(text, public.app_role);
--   drop function if exists public.set_user_role(uuid, public.app_role);
--   drop function if exists public.log_admin_action(public.admin_audit_action, text, jsonb);
--   -- ⚠️ `consent_texts` guarda a prova do que cada pessoa autorizou. Derrubá-la
--   -- apaga isso para sempre; exporte antes.
--   drop table if exists public.consent_texts;
--   drop table if exists public.app_settings;
--   drop table if exists public.admin_audit_logs;
--   drop type if exists public.admin_audit_action;
-- ----------------------------------------------------------------------------
