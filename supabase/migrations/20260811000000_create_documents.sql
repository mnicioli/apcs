-- ============================================================================
-- Gestão documental — Documentos e Normativas
-- ----------------------------------------------------------------------------
-- Primeiro módulo documental do CRM. Guarda as normativas da APCS (Câmara
-- Ambiental, Câmara Setorial, Selo Suíno Paulista) e responde à única pergunta
-- que o chatbot vai fazer: QUAL É O ARQUIVO OFICIAL DESTA NORMATIVA AGORA?
--
-- DOIS CONCEITOS, DUAS TABELAS — não confunda:
--   `documents`          o cadastro lógico ("Selo Suíno Paulista"). Um por
--                        normativa, para sempre.
--   `document_versions`  cada arquivo enviado (v1, v2, v3...). IMUTÁVEL depois
--                        de criado. Um novo upload NÃO duplica a normativa;
--                        cria uma versão nova.
--
-- A REGRA CRÍTICA DE NEGÓCIO — no máximo UMA versão ativa por normativa — é
-- garantida pelo índice único parcial `document_versions_one_active_idx`, não
-- pela aplicação. Duas telas concorrentes não conseguem furar isso.
--
-- POR QUE `documents` E NÃO `normatives`: a mesma estrutura vai receber
-- Procedimentos, Manuais e Políticas (a coluna `category` já existe para
-- isso). Renomear tabela, tipo gerado e rotas depois custa muito mais que uma
-- coluna hoje. A tela /documents/normatives filtra por categoria.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
-- Hoje só existe 'normative'. Novas categorias entram com `alter type ... add
-- value` — e cada uma ganha a sua tela, sem tabela nova.
create type public.document_category as enum ('normative');

create type public.document_version_status as enum ('active', 'inactive');

create type public.document_audit_action as enum (
  'document_created',
  'version_uploaded',
  'version_activated',
  'version_deactivated',
  'version_viewed',
  'version_downloaded'
);

-- ----------------------------------------------------------------------------
-- 2. Documentos (o cadastro lógico)
-- ----------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  category public.document_category not null default 'normative',
  name text not null,
  description text,
  -- `default auth.uid()` + o `with check` da policy de insert: a autoria não
  -- pode ser forjada nem precisa ser enviada pela aplicação.
  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_name_len check (char_length(name) between 2 and 160),
  constraint documents_description_len
    check (description is null or char_length(description) <= 2000)
);

comment on table public.documents is
  'Cadastro lógico de um documento (hoje, uma normativa). Os arquivos ficam em document_versions.';

-- `lower(name)` porque "Selo Suíno Paulista" e "SELO SUÍNO PAULISTA" são a
-- mesma normativa — e duas linhas para a mesma normativa quebram a promessa de
-- que existe UM arquivo oficial.
create unique index documents_category_name_key
  on public.documents (category, lower(name));

-- ----------------------------------------------------------------------------
-- 3. Versões (o arquivo)
-- ----------------------------------------------------------------------------
create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents on delete cascade,
  version integer not null,
  status public.document_version_status not null default 'inactive',
  available_for_chatbot boolean not null default false,

  -- Caminho no bucket privado `documents`. NUNCA contém o nome enviado pela
  -- pessoa (é `<document_id>/<uuid>.pdf`) — nome de arquivo vindo de fora não
  -- vira caminho, nunca.
  storage_path text not null unique,
  original_filename text not null,
  file_size_bytes integer not null,
  mime_type text not null default 'application/pdf',

  -- Vigência é informada por quem envia; upload é carimbado pelo banco. São
  -- coisas diferentes de propósito: um documento pode passar a valer depois de
  -- ser publicado no sistema.
  effective_date date not null,

  uploaded_by uuid references public.profiles on delete set null default auth.uid(),
  uploaded_at timestamptz not null default now(),
  activated_by uuid references public.profiles on delete set null,
  activated_at timestamptz,
  deactivated_by uuid references public.profiles on delete set null,
  deactivated_at timestamptz,

  constraint document_versions_version_positive check (version >= 1),
  constraint document_versions_filename_len
    check (char_length(original_filename) between 1 and 255),
  -- 5 MB exatos passam (5 * 1024 * 1024). É a última das quatro barreiras de
  -- tamanho: cliente, action, bucket e aqui.
  constraint document_versions_size
    check (file_size_bytes > 0 and file_size_bytes <= 5242880),
  constraint document_versions_mime check (mime_type = 'application/pdf'),
  -- MVP: "disponível para o chatbot" é ESPELHO do status, não um campo livre.
  -- Guardamos a coluna mesmo assim para o dia em que a decisão for manual —
  -- e ESTE CHECK é exatamente o que precisa cair naquele dia.
  constraint document_versions_chatbot_follows_status
    check (available_for_chatbot = (status = 'active'))
);

comment on table public.document_versions is
  'Cada arquivo enviado para uma normativa. Imutável: para corrigir, envie uma versão nova.';

-- Numeração histórica e crescente: nunca reutilizada, nem depois de reativar
-- uma versão antiga.
create unique index document_versions_document_version_key
  on public.document_versions (document_id, version);

-- ⚠️ A REGRA CRÍTICA. Sem este índice, "só uma versão ativa" seria uma promessa
-- da aplicação; com ele, é uma propriedade do banco.
create unique index document_versions_one_active_idx
  on public.document_versions (document_id)
  where status = 'active';

create index document_versions_document_idx
  on public.document_versions (document_id, version desc);

-- ----------------------------------------------------------------------------
-- 4. Trilha de auditoria
-- ----------------------------------------------------------------------------
-- Primeiro mecanismo de auditoria do CRM. Nasce genérico (document_id +
-- version_id + action + metadata) para as próximas categorias documentais
-- entrarem sem tabela nova.
create table public.document_audit_logs (
  id bigint generated always as identity primary key,
  -- `set null` (e não cascade): a trilha tem de sobreviver ao que ela audita.
  document_id uuid references public.documents on delete set null,
  version_id uuid references public.document_versions on delete set null,
  action public.document_audit_action not null,
  actor_id uuid references public.profiles on delete set null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.document_audit_logs is
  'Trilha imutável das operações sobre documentos. Só aceita INSERT — nunca update nem delete.';

create index document_audit_logs_document_idx
  on public.document_audit_logs (document_id, created_at desc);

create index document_audit_logs_version_idx
  on public.document_audit_logs (version_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 5. Row Level Security
-- ----------------------------------------------------------------------------
-- Espelha PERMISSION_MATRIX em src/lib/rbac/rbac.config.ts:
--   documents.read  → admin, ceo, comercial   (Administrador, Gestor, Atendente)
--   documents.write → admin, ceo              (Administrador, Gestor)
-- As duas camadas devem contar a mesma história.
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_audit_logs enable row level security;

create policy "documents_select"
  on public.documents for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

create policy "documents_insert"
  on public.documents for insert
  with check (
    public.current_app_role() in ('admin', 'ceo')
    and created_by = auth.uid()
  );

create policy "document_versions_select"
  on public.document_versions for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

create policy "document_versions_insert"
  on public.document_versions for insert
  with check (
    public.current_app_role() in ('admin', 'ceo')
    and uploaded_by = auth.uid()
  );

create policy "document_versions_update"
  on public.document_versions for update
  using (public.current_app_role() in ('admin', 'ceo'))
  with check (public.current_app_role() in ('admin', 'ceo'));

create policy "document_audit_logs_select"
  on public.document_audit_logs for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

-- Só INSERT, e só em nome de si mesmo: ninguém assina um evento com o nome de
-- outra pessoa. Sem policy de update/delete, a RLS já barra reescrever a trilha.
create policy "document_audit_logs_insert"
  on public.document_audit_logs for insert
  with check (
    public.current_app_role() in ('admin', 'ceo', 'comercial')
    and actor_id = auth.uid()
  );

-- ----------------------------------------------------------------------------
-- 6. Grants de coluna (RLS filtra LINHA, não COLUNA)
-- ----------------------------------------------------------------------------
-- Sem isto, um `ceo` chamando o PostgREST direto com o próprio JWT reescreveria
-- `storage_path` ou `version` de uma versão já publicada — a policy de update
-- deixaria passar. O app só muda status e carimbos de quem/quando; o banco
-- passa a impor exatamente isso, e a imutabilidade do item vira estrutural.
revoke update on public.document_versions from authenticated;
grant update (
  status,
  available_for_chatbot,
  activated_by,
  activated_at,
  deactivated_by,
  deactivated_at
) on public.document_versions to authenticated;

-- Versões e documentos não são apagados fisicamente: o histórico é o produto.
revoke delete on public.documents from authenticated, anon;
revoke delete on public.document_versions from authenticated, anon;

-- A trilha não se reescreve nem se apaga.
revoke update, delete on public.document_audit_logs from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 7. updated_at automático
-- ----------------------------------------------------------------------------
create trigger on_documents_updated
  before update on public.documents
  for each row execute procedure public.handle_updated_at();

-- `document_versions` NÃO tem `updated_at` de propósito: uma versão publicada
-- não é editada. Se o arquivo estiver errado, envie outro — vira v(n+1).

-- ----------------------------------------------------------------------------
-- 8. Storage
-- ----------------------------------------------------------------------------
-- Bucket PRIVADO. O acesso ao arquivo é sempre por signed URL de vida curta,
-- emitida por uma Server Action que já checou a permissão. Conhecer a URL do
-- bucket não dá acesso a nada.
--
-- `file_size_limit` e `allowed_mime_types` aqui são a barreira que sobra caso
-- alguém pule a aplicação e use o token de upload direto.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

create policy "documents_bucket_select"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and public.current_app_role() in ('admin', 'ceo', 'comercial')
  );

create policy "documents_bucket_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and public.current_app_role() in ('admin', 'ceo')
  );

-- DELETE existe para um caso só: o arquivo subiu, a validação de conteúdo
-- reprovou (PDF com senha, arquivo que só foi renomeado) e o objeto órfão
-- precisa sair. Nenhuma tela apaga arquivo publicado.
create policy "documents_bucket_delete"
  on storage.objects for delete
  using (
    bucket_id = 'documents'
    and public.current_app_role() in ('admin', 'ceo')
  );

-- ----------------------------------------------------------------------------
-- 9. Operações transacionais
-- ----------------------------------------------------------------------------
-- Publicar uma versão são três escritas que precisam acontecer juntas ou não
-- acontecer: inativar a atual, criar/ativar a nova e registrar a auditoria. O
-- supabase-js não faz transação de várias chamadas, então isso vive no banco.
--
-- SECURITY INVOKER (padrão do plpgsql): a RLS e os grants de coluna acima
-- continuam valendo DENTRO da função. A checagem de papel no topo existe só
-- para devolver um erro limpo (42501 → "forbidden" em mapPostgresError) em vez
-- de um "permission denied for table" cru.

-- Serializa operações concorrentes sobre a MESMA normativa.
--
-- Por que lock consultivo e não `select ... for update` na linha pai: em tabela
-- com RLS, `for update` também exige policy e privilégio de UPDATE em
-- `documents`, que este módulo não concede a ninguém. O lock consultivo faz
-- exatamente um trabalho — enfileirar — sem pedir permissão que não deveria
-- existir. Colisão de hash entre dois documentos só custa uma espera à toa.
create or replace function public.lock_document(p_document_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if public.current_app_role() not in ('admin', 'ceo') then
    raise exception 'Sem permissão para alterar documentos.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_document_id::text));
end;
$$;

-- Cria a nova versão JÁ ATIVA e inativa a anterior (RN06/RN07).
create or replace function public.create_document_version(
  p_document_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_file_size_bytes integer,
  p_effective_date date
)
returns public.document_versions
language plpgsql
set search_path = ''
as $$
declare
  v_next integer;
  v_previous public.document_versions;
  v_new public.document_versions;
begin
  perform public.lock_document(p_document_id);

  if not exists (select 1 from public.documents where id = p_document_id) then
    raise exception 'Normativa não encontrada.' using errcode = 'P0002';
  end if;

  -- Versões nunca são apagadas, então max+1 nunca reutiliza um número. É por
  -- isso que reativar a v1 com v1..v3 existentes ainda produz v4, e não v2.
  select coalesce(max(version), 0) + 1
    into v_next
    from public.document_versions
   where document_id = p_document_id;

  -- ⚠️ ORDEM OBRIGATÓRIA. O índice único parcial é verificado ao fim de CADA
  -- statement: se a nova entrasse como 'active' antes de a antiga sair, o
  -- insert abortaria com unique_violation.
  update public.document_versions
     set status = 'inactive',
         available_for_chatbot = false,
         deactivated_by = auth.uid(),
         deactivated_at = now()
   where document_id = p_document_id
     and status = 'active'
  returning * into v_previous;

  insert into public.document_versions (
    document_id, version, status, available_for_chatbot,
    storage_path, original_filename, file_size_bytes, effective_date
  )
  values (
    p_document_id, v_next, 'active', true,
    p_storage_path, p_original_filename, p_file_size_bytes, p_effective_date
  )
  returning * into v_new;

  insert into public.document_audit_logs (document_id, version_id, action, metadata)
  values (
    p_document_id, v_new.id, 'version_uploaded',
    jsonb_build_object(
      'version', v_next,
      'original_filename', p_original_filename,
      'file_size_bytes', p_file_size_bytes,
      'effective_date', p_effective_date
    )
  );

  if v_previous.id is not null then
    insert into public.document_audit_logs (document_id, version_id, action, metadata)
    values (
      p_document_id, v_previous.id, 'version_deactivated',
      jsonb_build_object('version', v_previous.version, 'reason', 'superseded')
    );
  end if;

  return v_new;
end;
$$;

-- Ativa (ou reativa) uma versão, inativando a que estiver ativa (RN26/RN27).
create or replace function public.activate_document_version(p_version_id uuid)
returns public.document_versions
language plpgsql
set search_path = ''
as $$
declare
  v_document_id uuid;
  v_previous public.document_versions;
  v_new public.document_versions;
begin
  select document_id into v_document_id
    from public.document_versions
   where id = p_version_id;

  if v_document_id is null then
    raise exception 'Versão não encontrada.' using errcode = 'P0002';
  end if;

  perform public.lock_document(v_document_id);

  -- `id <> p_version_id` deixa a operação idempotente: reativar o que já está
  -- ativo não gera um evento de inativação fantasma na trilha.
  update public.document_versions
     set status = 'inactive',
         available_for_chatbot = false,
         deactivated_by = auth.uid(),
         deactivated_at = now()
   where document_id = v_document_id
     and status = 'active'
     and id <> p_version_id
  returning * into v_previous;

  update public.document_versions
     set status = 'active',
         available_for_chatbot = true,
         activated_by = auth.uid(),
         activated_at = now()
   where id = p_version_id
  returning * into v_new;

  insert into public.document_audit_logs (document_id, version_id, action, metadata)
  values (
    v_document_id, v_new.id, 'version_activated',
    jsonb_build_object('version', v_new.version, 'deactivated_version', v_previous.version)
  );

  if v_previous.id is not null then
    insert into public.document_audit_logs (document_id, version_id, action, metadata)
    values (
      v_document_id, v_previous.id, 'version_deactivated',
      jsonb_build_object('version', v_previous.version, 'reason', 'superseded')
    );
  end if;

  return v_new;
end;
$$;

-- Inativa uma versão. A normativa pode ficar sem nenhuma versão ativa (RN25) —
-- é um estado válido, e o chatbot trata isso encaminhando para atendimento
-- humano em vez de citar um documento vencido.
create or replace function public.deactivate_document_version(p_version_id uuid)
returns public.document_versions
language plpgsql
set search_path = ''
as $$
declare
  v_document_id uuid;
  v_row public.document_versions;
begin
  select document_id into v_document_id
    from public.document_versions
   where id = p_version_id;

  if v_document_id is null then
    raise exception 'Versão não encontrada.' using errcode = 'P0002';
  end if;

  perform public.lock_document(v_document_id);

  update public.document_versions
     set status = 'inactive',
         available_for_chatbot = false,
         deactivated_by = auth.uid(),
         deactivated_at = now()
   where id = p_version_id
  returning * into v_row;

  insert into public.document_audit_logs (document_id, version_id, action, metadata)
  values (
    v_document_id, v_row.id, 'version_deactivated',
    jsonb_build_object('version', v_row.version, 'reason', 'manual')
  );

  return v_row;
end;
$$;

-- `lock_document` é auxiliar, mas as três funções acima são SECURITY INVOKER —
-- então quem as chama precisa poder executá-la. Tirar de PUBLIC (e portanto de
-- `anon`) e devolver só para quem está autenticado.
revoke execute on function public.lock_document(uuid) from public;
grant execute on function public.lock_document(uuid) to authenticated;

grant execute on function public.create_document_version(uuid, text, text, integer, date) to authenticated;
grant execute on function public.activate_document_version(uuid) to authenticated;
grant execute on function public.deactivate_document_version(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. Normativas iniciais
-- ----------------------------------------------------------------------------
-- Estas três são DADOS, não código: entram como linhas para o sistema já nascer
-- utilizável, e o botão "Nova Normativa" continua criando quantas mais forem
-- necessárias sem tocar em migration.
insert into public.documents (category, name, description)
values
  ('normative', 'Câmara Ambiental',
   'Normativa da Câmara Ambiental da APCS.'),
  ('normative', 'Câmara Setorial',
   'Normativa da Câmara Setorial da APCS.'),
  ('normative', 'Selo Suíno Paulista',
   'Normativa do programa Selo Suíno Paulista.')
on conflict do nothing;
