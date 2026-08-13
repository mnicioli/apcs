-- ============================================================================
-- Bolsa — o boletim de mercado da APCS (submenu de Documentos)
-- ----------------------------------------------------------------------------
-- Hoje existe UMA: a Bolsa de Suínos. A estrutura não sabe disso — "Bolsa de
-- Aves" e "Bolsa de Grãos" entram como LINHA, nunca como migration. Nenhuma
-- regra deste arquivo cita suínos.
--
-- NOME DAS TABELAS: o negócio diz "Bolsa"; o código diz `market_bulletin`.
-- É a mesma tradução que `documents` faz de "normativa" e que o roadmap já
-- registrou ao chamar este fluxo de `/flows/market` (ROADMAP #27). A regra do
-- CLAUDE.md é código em inglês, tela em PT-BR — os rótulos de tela vivem em
-- `src/modules/market/market.labels.ts` e dizem "Bolsa".
--
-- DOIS CONCEITOS, DUAS TABELAS:
--   `market_bulletins`          o cadastro lógico ("Bolsa de Suínos"). Um por
--                               bolsa, para sempre.
--   `market_bulletin_versions`  cada publicação (Bolsa_01Jul26, Bolsa_12Ago26).
--                               IMUTÁVEL depois de criada.
--
-- ⚠️ POR QUE NÃO VIROU UMA CATEGORIA DE `documents`
-- A gestão documental já tem categoria, versão, status, vigência, bucket e
-- trilha — e a tentação de acrescentar 'bolsa' ao enum é grande. O que impede é
-- uma limitação concreta do Postgres: uma versão de Bolsa exige DOIS arquivos
-- (imagem + PDF), e um CHECK não consegue consultar outra tabela. Dentro de
-- `document_versions` a regra "Bolsa tem imagem obrigatória" precisaria ler a
-- categoria em `documents` — só daria com trigger ou com a categoria
-- desnormalizada na filha. Em tabela própria a mesma regra é `not null`.
--
-- Estrutural x procedural foi o critério. Este projeto já escolheu esse lado
-- quando pôs "só uma versão ativa" num índice único parcial em vez de na
-- aplicação. O que É compartilhado continua compartilhado: o validador de PDF
-- (`src/lib/documents/pdf.ts`), o de imagem (`src/lib/files/image.ts`), o
-- padrão service/action e o "hoje" oficial do sistema.
--
-- ATIVA ≠ VIGENTE — a distinção que mais confunde neste módulo:
--   `status = 'active'`      a versão OFICIALMENTE escolhida. Uma por bolsa.
--   vigente                  `effective_date <= hoje`. NÃO é coluna: é conta.
-- Uma versão publicada hoje para valer dia 15 fica ATIVA e AINDA NÃO VIGENTE.
-- O chatbot exige as duas coisas. Ver `market.rules.ts` e docs/BOLSA.md.
--
-- CÓDIGOS DE ERRO desta migration, mapeados em src/lib/actions/errors.ts:
--   42501  sem permissão
--   P0002  bolsa ou versão não encontrada (no_data_found)
--   MB001  inativar deixaria a Bolsa sem versão ativa
--   MB002  a versão não pertence à Bolsa informada
-- A classe `MB` é própria pelo mesmo motivo da classe `EV` de Eventos: a classe
-- `P0` é RESERVADA pelo PL/pgSQL (P0004 é `assert_failure`, que
-- `exception when others` não captura). Ver 20260813000200.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
create type public.market_bulletin_version_status as enum ('active', 'inactive');

-- POR QUE a versão inativa guarda o MOTIVO: "saiu do ar porque veio outra" e
-- "saiu do ar porque alguém tirou" contam histórias diferentes para quem lê o
-- histórico seis meses depois. O motivo fica na LINHA, e não só na trilha,
-- porque a grid precisa dele sem varrer a auditoria.
create type public.market_bulletin_status_reason as enum ('manual', 'superseded');

-- `version_activated` cobre ativar e REATIVAR: no dado são a mesma transição
-- (uma versão inativa vira ativa), e inventar uma ação só para dizer que a
-- versão já tinha estado ativa antes obrigaria a trilha a manter uma memória
-- que ela não tem. O escopo pede as duas; elas são a mesma.
create type public.market_bulletin_audit_action as enum (
  'bulletin_created',
  'bulletin_updated',
  'version_uploaded',
  'version_activated',
  'version_deactivated',
  'version_viewed',
  'version_downloaded'
);

-- ----------------------------------------------------------------------------
-- 2. A Bolsa (o cadastro lógico)
-- ----------------------------------------------------------------------------
create table public.market_bulletins (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,

  -- A CHAVE DO CHATBOT, e ela mora AQUI, não na versão. A decisão "esta Bolsa
  -- pode ser citada por robô" é sobre a Bolsa, não sobre o arquivo do mês — na
  -- versão, cada upload obrigaria alguém a reafirmar a mesma escolha, e o dia
  -- em que esquecessem o chatbot mudaria de comportamento sozinho.
  chatbot_enabled boolean not null default true,

  -- `default auth.uid()` + o `with check` da policy de insert: a autoria não
  -- pode ser forjada nem precisa ser enviada pela aplicação.
  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),

  constraint market_bulletins_name_len check (char_length(name) between 2 and 160),
  -- Nome só com espaços não passa: `btrim` derruba para 0 caracteres, e 0 não
  -- está entre 2 e 160. O CHECK abaixo garante que o que ficou GRAVADO também
  -- está aparado — sem ele, "  Bolsa  " entraria por quem chamasse o PostgREST
  -- direto e a busca por "Bolsa" não acharia.
  constraint market_bulletins_name_trimmed check (name = btrim(name)),
  constraint market_bulletins_description_len
    check (description is null or char_length(description) <= 2000)
);

comment on table public.market_bulletins is
  'Cadastro lógico de uma Bolsa (hoje, a Bolsa de Suínos). Os arquivos ficam em market_bulletin_versions.';

-- `lower(name)` porque "Bolsa de Suínos" e "BOLSA DE SUÍNOS" são a mesma bolsa,
-- e duas linhas para a mesma bolsa quebram a promessa de que existe UM boletim
-- oficial.
create unique index market_bulletins_name_key
  on public.market_bulletins (lower(name));

-- ----------------------------------------------------------------------------
-- 3. As versões (imagem + PDF, sempre o par)
-- ----------------------------------------------------------------------------
create table public.market_bulletin_versions (
  -- SEM `default`: o id é sorteado pela APLICAÇÃO antes do upload, porque os
  -- dois arquivos precisam subir para a pasta da própria versão e o caminho é
  -- decidido antes de existir linha. É o mesmo desenho de `create_event`.
  id uuid primary key,
  bulletin_id uuid not null references public.market_bulletins on delete cascade,

  -- DUAS IDENTIDADES, de propósito:
  --   `version`       a sequência técnica (1, 2, 3…). Nunca reusada, nem
  --                   depois de reativar uma versão antiga. É o que ordena.
  --   `version_name`  a identidade FUNCIONAL que a APCS lê: "Bolsa_12Ago26".
  -- O escopo é explícito em não deixar a data ser a chave — dois envios no
  -- mesmo dia existem, e viram Bolsa_12Ago26 e Bolsa_12Ago26-2.
  version integer not null,
  version_name text not null,

  -- SEM `default`: toda versão nasce ativa (a função transacional é quem
  -- insere), e um default aqui só serviria para alguém errar em silêncio.
  status public.market_bulletin_version_status not null,
  status_reason public.market_bulletin_status_reason,

  -- Imagem e PDF são UMA VERSÃO. Ambos `not null` — é isto que a tabela
  -- própria compra, e é por isto que ela existe. Não há caminho no schema que
  -- produza uma versão com o PDF de agosto e a imagem de julho.
  image_path text not null unique,
  image_filename text not null,
  image_mime_type text not null,
  image_size_bytes integer not null,

  pdf_path text not null unique,
  pdf_filename text not null,
  pdf_mime_type text not null default 'application/pdf',
  pdf_size_bytes integer not null,

  -- Vigência é DIGITADA por quem publica; upload é CARIMBADO pelo banco. São
  -- coisas diferentes de propósito: a Bolsa do dia 12 pode passar a valer no
  -- dia 15. Passado, hoje e futuro são todos válidos — uma republicação pode
  -- precisar registrar uma vigência que já correu.
  effective_date date not null,

  uploaded_by uuid references public.profiles on delete set null default auth.uid(),
  uploaded_at timestamptz not null default now(),
  activated_by uuid references public.profiles on delete set null,
  activated_at timestamptz,
  deactivated_by uuid references public.profiles on delete set null,
  deactivated_at timestamptz,

  constraint mb_versions_version_positive check (version >= 1),

  -- O formato do nome funcional é conferido pelo BANCO, e não só por quem
  -- gera: assim ninguém publica "Bolsa_qualquercoisa" chamando o PostgREST
  -- direto, e a grid pode confiar no que lê. Os meses são os três dígitos do
  -- português — a função que monta o nome usa a MESMA lista.
  constraint mb_versions_name_format check (
    version_name ~ '^Bolsa_[0-3][0-9](Jan|Fev|Mar|Abr|Mai|Jun|Jul|Ago|Set|Out|Nov|Dez)[0-9]{2}(-[1-9][0-9]*)?$'
  ),

  constraint mb_versions_image_filename_len
    check (char_length(image_filename) between 1 and 255),
  constraint mb_versions_pdf_filename_len
    check (char_length(pdf_filename) between 1 and 255),

  -- 5 MB exatos passam (5 * 1024 * 1024) — o escopo é explícito. É a última de
  -- quatro barreiras por arquivo: cliente, action, bucket e aqui.
  constraint mb_versions_image_size
    check (image_size_bytes > 0 and image_size_bytes <= 5242880),
  constraint mb_versions_pdf_size
    check (pdf_size_bytes > 0 and pdf_size_bytes <= 5242880),

  constraint mb_versions_image_mime
    check (image_mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint mb_versions_pdf_mime check (pdf_mime_type = 'application/pdf'),

  -- OS ARQUIVOS MORAM NA PASTA DA PRÓPRIA VERSÃO — conferido pelo banco.
  -- O caminho volta pelo cliente entre o upload e a confirmação; sem este
  -- CHECK, uma versão poderia apontar para o arquivo de outra bolsa. A
  -- aplicação confere o mesmo, e o banco é quem garante.
  constraint mb_versions_image_path_scope
    check (image_path like bulletin_id::text || '/' || id::text || '/image/%'),
  constraint mb_versions_pdf_path_scope
    check (pdf_path like bulletin_id::text || '/' || id::text || '/pdf/%'),

  -- Ativa NÃO tem motivo; inativa SEMPRE tem. Escrito como igualdade de
  -- booleanos para não sobrar terceiro caso: os dois lados mudam juntos.
  constraint mb_versions_status_reason
    check ((status = 'active') = (status_reason is null))
);

comment on table public.market_bulletin_versions is
  'Cada publicação da Bolsa: um par imagem+PDF. Imutável — para corrigir, publique outra.';

-- Numeração histórica e crescente: nunca reutilizada.
create unique index mb_versions_bulletin_version_key
  on public.market_bulletin_versions (bulletin_id, version);

-- A identidade funcional é única DENTRO da bolsa. É isto que torna o sufixo
-- "-2" do segundo envio do dia uma propriedade do banco, e não um torcer para
-- que a aplicação tenha lembrado.
create unique index mb_versions_bulletin_name_key
  on public.market_bulletin_versions (bulletin_id, version_name);

-- ⚠️ A REGRA CRÍTICA: no máximo UMA versão ativa por Bolsa. Com este índice,
-- duas telas concorrentes não conseguem furar — não é promessa da aplicação, é
-- propriedade do banco. É também o que dispensa uma coluna `active_version_id`
-- no cadastro: com no máximo uma linha ativa, "a versão oficial" é uma consulta
-- sem ambiguidade, e não uma cópia que pode sair de sincronia.
create unique index mb_versions_one_active_idx
  on public.market_bulletin_versions (bulletin_id)
  where status = 'active';

-- A leitura do histórico: da mais nova para a mais antiga.
create index mb_versions_bulletin_idx
  on public.market_bulletin_versions (bulletin_id, version desc);

-- NÃO existe índice por `effective_date` nem por `chatbot_enabled`, e isso é
-- deliberado: a consulta do chatbot é `bulletin_id = ? and status = 'active'`,
-- que o índice único parcial acima resolve em UMA linha — a vigência é testada
-- sobre essa linha só. `chatbot_enabled` está numa tabela de unidades de
-- linhas. Índice que nenhuma consulta usa é custo de escrita sem retorno.

-- ----------------------------------------------------------------------------
-- 4. Trilha de auditoria
-- ----------------------------------------------------------------------------
create table public.market_bulletin_audit_logs (
  id bigint generated always as identity primary key,
  -- `set null` (e não cascade): a trilha tem de sobreviver ao que ela audita.
  bulletin_id uuid references public.market_bulletins on delete set null,
  version_id uuid references public.market_bulletin_versions on delete set null,
  action public.market_bulletin_audit_action not null,
  actor_id uuid references public.profiles on delete set null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.market_bulletin_audit_logs is
  'Trilha imutável das operações sobre a Bolsa. Só aceita INSERT — nunca update nem delete.';

create index mb_audit_logs_bulletin_idx
  on public.market_bulletin_audit_logs (bulletin_id, created_at desc);

create index mb_audit_logs_version_idx
  on public.market_bulletin_audit_logs (version_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 5. Row Level Security
-- ----------------------------------------------------------------------------
-- Espelha PERMISSION_MATRIX em src/lib/rbac/rbac.config.ts:
--   market.read  → admin, ceo, comercial   (Administrador, Gestor, Atendente)
--   market.write → admin, ceo              (Administrador, Gestor)
-- As duas camadas devem contar a mesma história.
alter table public.market_bulletins enable row level security;
alter table public.market_bulletin_versions enable row level security;
alter table public.market_bulletin_audit_logs enable row level security;

create policy "market_bulletins_select"
  on public.market_bulletins for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

create policy "market_bulletins_insert"
  on public.market_bulletins for insert
  with check (
    public.current_app_role() in ('admin', 'ceo')
    and created_by = auth.uid()
  );

create policy "market_bulletins_update"
  on public.market_bulletins for update
  using (public.current_app_role() in ('admin', 'ceo'))
  with check (
    public.current_app_role() in ('admin', 'ceo')
    -- Quem edita ASSINA. Sem isto, dava para alterar a Bolsa deixando o nome de
    -- outra pessoa no registro.
    and updated_by = auth.uid()
  );

create policy "mb_versions_select"
  on public.market_bulletin_versions for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

create policy "mb_versions_insert"
  on public.market_bulletin_versions for insert
  with check (
    public.current_app_role() in ('admin', 'ceo')
    and uploaded_by = auth.uid()
  );

create policy "mb_versions_update"
  on public.market_bulletin_versions for update
  using (public.current_app_role() in ('admin', 'ceo'))
  with check (public.current_app_role() in ('admin', 'ceo'));

-- A trilha é MAIS ESTREITA que a leitura: o Atendente consulta e baixa a
-- Bolsa, mas o histórico de quem publicou o quê é de Administrador e Gestor.
create policy "mb_audit_logs_select"
  on public.market_bulletin_audit_logs for select
  using (public.current_app_role() in ('admin', 'ceo'));

-- O INSERT é mais largo que o SELECT de propósito: o Atendente PRECISA gravar
-- "abri" e "baixei" sem poder ler a trilha dos outros. E só em nome de si
-- mesmo — ninguém assina um evento com o nome de outra pessoa.
create policy "mb_audit_logs_insert"
  on public.market_bulletin_audit_logs for insert
  with check (
    public.current_app_role() in ('admin', 'ceo', 'comercial')
    and actor_id = auth.uid()
  );

-- ----------------------------------------------------------------------------
-- 6. Grants de coluna (RLS filtra LINHA, não COLUNA)
-- ----------------------------------------------------------------------------
-- Sem isto, um `ceo` chamando o PostgREST direto com o próprio JWT reescreveria
-- `image_path`, `version_name` ou `effective_date` de uma versão publicada — a
-- policy de update deixaria passar. O app só muda status, motivo e carimbos;
-- o banco passa a impor exatamente isso, e a imutabilidade vira estrutural.
revoke update on public.market_bulletin_versions from authenticated;
grant update (
  status,
  status_reason,
  activated_by,
  activated_at,
  deactivated_by,
  deactivated_at
) on public.market_bulletin_versions to authenticated;

-- No cadastro só o que a tela edita. `created_by`, `created_at` e `id` ficam
-- fora: autoria e identidade não se corrigem.
revoke update on public.market_bulletins from authenticated;
grant update (
  name,
  description,
  chatbot_enabled,
  updated_by
) on public.market_bulletins to authenticated;

-- Bolsas e versões não são apagadas: o histórico é o produto. Uma publicação
-- errada é substituída por outra, nunca removida.
revoke delete on public.market_bulletins from authenticated, anon;
revoke delete on public.market_bulletin_versions from authenticated, anon;

-- A trilha não se reescreve nem se apaga.
revoke update, delete on public.market_bulletin_audit_logs from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 7. updated_at automático
-- ----------------------------------------------------------------------------
create trigger on_market_bulletins_updated
  before update on public.market_bulletins
  for each row execute procedure public.handle_updated_at();

-- `market_bulletin_versions` NÃO tem `updated_at` de propósito: uma versão
-- publicada não é editada. Se o arquivo estiver errado, publique outro.

-- ----------------------------------------------------------------------------
-- 8. Storage
-- ----------------------------------------------------------------------------
-- Bucket PRIVADO e SEPARADO do de normativas. A separação não é organização: o
-- bucket `documents` declara `allowed_mime_types = ['application/pdf']`, e
-- acrescentar imagens lá afrouxaria uma garantia das normativas para atender a
-- Bolsa. Cada módulo com o seu bucket mantém cada garantia no seu lugar — é o
-- mesmo motivo pelo qual Eventos tem o dele.
--
-- Estrutura: `<bulletin_id>/<version_id>/image/<uuid>.<ext>`
--            `<bulletin_id>/<version_id>/pdf/<uuid>.pdf`
-- O par fica fisicamente junto, e os CHECKs de escopo acima provam isso no banco.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'market-bulletins',
  'market-bulletins',
  false,
  5242880,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy "market_bulletins_bucket_select"
  on storage.objects for select
  using (
    bucket_id = 'market-bulletins'
    and public.current_app_role() in ('admin', 'ceo', 'comercial')
  );

create policy "market_bulletins_bucket_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'market-bulletins'
    and public.current_app_role() in ('admin', 'ceo')
  );

-- DELETE existe para um caso só: o arquivo subiu, a validação de conteúdo
-- reprovou (PDF com senha, imagem que só foi renomeada) e o objeto órfão
-- precisa sair. Nenhuma tela apaga arquivo publicado.
create policy "market_bulletins_bucket_delete"
  on storage.objects for delete
  using (
    bucket_id = 'market-bulletins'
    and public.current_app_role() in ('admin', 'ceo')
  );

-- ----------------------------------------------------------------------------
-- 9. Auxiliares
-- ----------------------------------------------------------------------------

-- O nome de quem está agindo, CONGELADO na trilha.
--
-- A trilha já guarda `actor_id`, mas a FK é `on delete set null`: no dia em que
-- um perfil sair, o histórico perderia o autor. Gravar o nome junto custa uma
-- leitura por chave primária e responde "quem fez isso?" para sempre. O id
-- continua lá para quando o perfil existir.
create or replace function public.current_actor_name()
returns text
language sql
stable
set search_path = ''
as $$
  select full_name from public.profiles where id = (select auth.uid());
$$;

comment on function public.current_actor_name() is
  'Nome de quem está autenticado, para congelar na trilha de auditoria.';

-- A identidade funcional de uma publicação: "Bolsa_12Ago26".
--
-- Os meses vêm de uma LISTA EXPLÍCITA, e não de `to_char(..., 'Mon')`: o
-- `to_char` respeita o `lc_time` do servidor, que na Supabase é C — produziria
-- "Aug", não "Ago", e mudaria de resultado se a configuração mudasse. Uma
-- lista no código não tem essa dependência.
--
-- ⚠️ A data é a de HOJE, não a vigência: uma Bolsa publicada dia 12 para valer
-- dia 15 é a Bolsa_12Ago26. O escopo é explícito em não deixar o usuário
-- escolher esta data, e é por isso que a função recebe a data e quem chama
-- passa `public.event_today()`.
create or replace function public.market_bulletin_version_name(p_date date)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'Bolsa_'
      || to_char(p_date, 'DD')
      || (array['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'])[
           extract(month from p_date)::int
         ]
      || to_char(p_date, 'YY');
$$;

comment on function public.market_bulletin_version_name(date) is
  'Monta a identidade funcional de uma publicação: Bolsa_12Ago26.';

-- Serializa operações concorrentes sobre a MESMA Bolsa (usuário A ativa a v2,
-- usuário B publica a v4).
--
-- Por que lock consultivo e não `select ... for update`: em tabela com RLS,
-- `for update` também exige policy e privilégio de UPDATE na tabela travada, e
-- o Atendente tem SELECT mas não UPDATE — um `for update` numa leitura dele
-- quebraria. O lock consultivo faz exatamente um trabalho, enfileirar, sem
-- pedir permissão que não deveria existir.
create or replace function public.lock_market_bulletin(p_bulletin_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if public.current_app_role() not in ('admin', 'ceo') then
    raise exception 'Sem permissão para alterar a Bolsa.' using errcode = '42501';
  end if;

  -- O prefixo separa este espaço de chaves do de `lock_document` e
  -- `lock_event`: hashes diferentes para módulos diferentes, mesmo que um dia
  -- dois ids coincidam.
  perform pg_advisory_xact_lock(hashtext('market_bulletin:' || p_bulletin_id::text));
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. Operações transacionais
-- ----------------------------------------------------------------------------
-- Publicar uma versão são três escritas que precisam acontecer juntas ou não
-- acontecer: inativar a atual, criar/ativar a nova e registrar a auditoria. O
-- supabase-js não faz transação de várias chamadas, então isso vive no banco.
--
-- SECURITY INVOKER (padrão do plpgsql): a RLS e os grants de coluna acima
-- continuam valendo DENTRO da função. A checagem de papel no topo existe só
-- para devolver um erro limpo (42501 → "forbidden") em vez de um
-- "permission denied for table" cru.

-- Cadastra uma Bolsa. Ela nasce sem versão nenhuma, esperando a primeira
-- publicação — o mesmo desenho do cadastro de normativa.
create or replace function public.create_market_bulletin(
  p_name text,
  p_description text,
  p_chatbot_enabled boolean
)
returns public.market_bulletins
language plpgsql
set search_path = ''
as $$
declare
  v_row public.market_bulletins;
begin
  if public.current_app_role() not in ('admin', 'ceo') then
    raise exception 'Sem permissão para cadastrar Bolsa.' using errcode = '42501';
  end if;

  insert into public.market_bulletins (name, description, chatbot_enabled)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_chatbot_enabled)
  returning * into v_row;

  insert into public.market_bulletin_audit_logs (bulletin_id, action, metadata)
  values (
    v_row.id,
    'bulletin_created',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'name', v_row.name,
      'chatbot_enabled', v_row.chatbot_enabled
    )
  );

  return v_row;
end;
$$;

-- Edita o cadastro. A trilha guarda o ANTES e o DEPOIS de cada campo que mudou.
create or replace function public.update_market_bulletin(
  p_bulletin_id uuid,
  p_name text,
  p_description text,
  p_chatbot_enabled boolean
)
returns public.market_bulletins
language plpgsql
set search_path = ''
as $$
declare
  v_old public.market_bulletins;
  v_new public.market_bulletins;
  v_changes jsonb := '[]'::jsonb;
begin
  perform public.lock_market_bulletin(p_bulletin_id);

  select * into v_old from public.market_bulletins where id = p_bulletin_id;
  if v_old.id is null then
    raise exception 'Bolsa não encontrada.' using errcode = 'P0002';
  end if;

  update public.market_bulletins
     set name = btrim(p_name),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         chatbot_enabled = p_chatbot_enabled,
         updated_by = (select auth.uid())
   where id = p_bulletin_id
  returning * into v_new;

  -- Só o que MUDOU vai para a trilha. Um "salvar" sem alteração não produz
  -- linha nenhuma — histórico cheio de eventos vazios é histórico que ninguém
  -- lê.
  if v_new.name is distinct from v_old.name then
    v_changes := v_changes || jsonb_build_object('field', 'name', 'from', v_old.name, 'to', v_new.name);
  end if;
  if v_new.description is distinct from v_old.description then
    v_changes := v_changes || jsonb_build_object('field', 'description', 'from', v_old.description, 'to', v_new.description);
  end if;
  if v_new.chatbot_enabled is distinct from v_old.chatbot_enabled then
    v_changes := v_changes || jsonb_build_object('field', 'chatbot_enabled', 'from', v_old.chatbot_enabled::text, 'to', v_new.chatbot_enabled::text);
  end if;

  if jsonb_array_length(v_changes) > 0 then
    insert into public.market_bulletin_audit_logs (bulletin_id, action, metadata)
    values (
      p_bulletin_id,
      'bulletin_updated',
      jsonb_build_object('actor_name', public.current_actor_name(), 'changes', v_changes)
    );
  end if;

  return v_new;
end;
$$;

-- Publica uma versão nova: ela nasce ATIVA e a anterior sai por SUCESSÃO.
--
-- O id da versão vem de FORA porque os dois arquivos já subiram para a pasta
-- dela antes de a linha existir — os CHECKs de escopo conferem que os caminhos
-- correspondem a este id.
create or replace function public.create_market_bulletin_version(
  p_version_id uuid,
  p_bulletin_id uuid,
  p_effective_date date,
  p_image_path text,
  p_image_filename text,
  p_image_mime_type text,
  p_image_size_bytes integer,
  p_pdf_path text,
  p_pdf_filename text,
  p_pdf_size_bytes integer
)
returns public.market_bulletin_versions
language plpgsql
set search_path = ''
as $$
declare
  v_next integer;
  v_base text;
  v_name text;
  v_suffix integer := 1;
  v_previous public.market_bulletin_versions;
  v_new public.market_bulletin_versions;
begin
  perform public.lock_market_bulletin(p_bulletin_id);

  if not exists (select 1 from public.market_bulletins where id = p_bulletin_id) then
    raise exception 'Bolsa não encontrada.' using errcode = 'P0002';
  end if;

  -- Versões nunca são apagadas, então max+1 nunca reutiliza um número. É por
  -- isso que reativar a v1 com v1..v3 existentes NÃO devolve o número 2 ao
  -- estoque: a próxima publicação ainda é a v4.
  select coalesce(max(version), 0) + 1
    into v_next
    from public.market_bulletin_versions
   where bulletin_id = p_bulletin_id;

  -- DOIS ENVIOS NO MESMO DIA não se sobrescrevem: o segundo vira
  -- "Bolsa_12Ago26-2", o terceiro "-3". O laço roda sob o lock consultivo, e o
  -- índice único `(bulletin_id, version_name)` é a garantia final.
  v_base := public.market_bulletin_version_name(public.event_today());
  v_name := v_base;
  while exists (
    select 1 from public.market_bulletin_versions
     where bulletin_id = p_bulletin_id and version_name = v_name
  ) loop
    v_suffix := v_suffix + 1;
    v_name := v_base || '-' || v_suffix;
  end loop;

  -- ⚠️ ORDEM OBRIGATÓRIA. O índice único parcial é verificado ao fim de CADA
  -- statement: se a nova entrasse como 'active' antes de a antiga sair, o
  -- insert abortaria com unique_violation.
  update public.market_bulletin_versions
     set status = 'inactive',
         status_reason = 'superseded',
         deactivated_by = (select auth.uid()),
         deactivated_at = now()
   where bulletin_id = p_bulletin_id
     and status = 'active'
  returning * into v_previous;

  insert into public.market_bulletin_versions (
    id, bulletin_id, version, version_name, status, status_reason,
    image_path, image_filename, image_mime_type, image_size_bytes,
    pdf_path, pdf_filename, pdf_size_bytes,
    effective_date, activated_by, activated_at
  )
  values (
    p_version_id, p_bulletin_id, v_next, v_name, 'active', null,
    p_image_path, p_image_filename, p_image_mime_type, p_image_size_bytes,
    p_pdf_path, p_pdf_filename, p_pdf_size_bytes,
    p_effective_date, (select auth.uid()), now()
  )
  returning * into v_new;

  insert into public.market_bulletin_audit_logs (bulletin_id, version_id, action, metadata)
  values (
    p_bulletin_id, v_new.id, 'version_uploaded',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'version', v_next,
      'version_name', v_name,
      'effective_date', p_effective_date,
      -- Metadado do arquivo, nunca o conteúdo. O que interessa à auditoria é
      -- o que a pessoa enviou e quanto pesava.
      'image', jsonb_build_object(
        'original_filename', p_image_filename,
        'mime_type', p_image_mime_type,
        'size_bytes', p_image_size_bytes
      ),
      'pdf', jsonb_build_object(
        'original_filename', p_pdf_filename,
        'mime_type', 'application/pdf',
        'size_bytes', p_pdf_size_bytes
      )
    )
  );

  if v_previous.id is not null then
    insert into public.market_bulletin_audit_logs (bulletin_id, version_id, action, metadata)
    values (
      p_bulletin_id, v_previous.id, 'version_deactivated',
      jsonb_build_object(
        'actor_name', public.current_actor_name(),
        'version', v_previous.version,
        'version_name', v_previous.version_name,
        'reason', 'superseded'
      )
    );
  end if;

  return v_new;
end;
$$;

-- Ativa (ou REATIVA) uma versão, inativando a que estiver ativa.
--
-- `p_bulletin_id` não é redundante: é o que permite recusar "ativar a versão da
-- Bolsa de Aves dentro da tela da Bolsa de Suínos" com um erro que diz isso, em
-- vez de trocar silenciosamente a versão ativa da outra bolsa.
create or replace function public.activate_market_bulletin_version(
  p_version_id uuid,
  p_bulletin_id uuid
)
returns public.market_bulletin_versions
language plpgsql
set search_path = ''
as $$
declare
  v_row public.market_bulletin_versions;
  v_previous public.market_bulletin_versions;
  v_new public.market_bulletin_versions;
begin
  -- ⚠️ A PERMISSÃO VEM ANTES DA PERGUNTA. Travar primeiro (o lock checa o
  -- papel) faz quem não pode escrever receber 42501 sem descobrir, pelo tipo do
  -- erro, se aquele id existe ou a que Bolsa pertence. E a leitura abaixo já
  -- nasce sob o lock — não há janela entre ler o estado e agir sobre ele.
  perform public.lock_market_bulletin(p_bulletin_id);

  select * into v_row
    from public.market_bulletin_versions
   where id = p_version_id;

  if v_row.id is null then
    raise exception 'Versão não encontrada.' using errcode = 'P0002';
  end if;

  if v_row.bulletin_id <> p_bulletin_id then
    raise exception 'A versão não pertence a esta Bolsa.' using errcode = 'MB002';
  end if;

  -- IDEMPOTENTE: ativar o que já está ativo não mexe em nada e não inventa um
  -- evento na trilha. Chamar duas vezes tem o mesmo efeito de chamar uma.
  if v_row.status = 'active' then
    return v_row;
  end if;

  update public.market_bulletin_versions
     set status = 'inactive',
         status_reason = 'superseded',
         deactivated_by = (select auth.uid()),
         deactivated_at = now()
   where bulletin_id = v_row.bulletin_id
     and status = 'active'
  returning * into v_previous;

  update public.market_bulletin_versions
     set status = 'active',
         status_reason = null,
         activated_by = (select auth.uid()),
         activated_at = now()
   where id = p_version_id
  returning * into v_new;

  insert into public.market_bulletin_audit_logs (bulletin_id, version_id, action, metadata)
  values (
    v_new.bulletin_id, v_new.id, 'version_activated',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'version', v_new.version,
      'version_name', v_new.version_name,
      'deactivated_version_name', v_previous.version_name
    )
  );

  if v_previous.id is not null then
    insert into public.market_bulletin_audit_logs (bulletin_id, version_id, action, metadata)
    values (
      v_new.bulletin_id, v_previous.id, 'version_deactivated',
      jsonb_build_object(
        'actor_name', public.current_actor_name(),
        'version', v_previous.version,
        'version_name', v_previous.version_name,
        'reason', 'superseded'
      )
    );
  end if;

  return v_new;
end;
$$;

-- Inativa uma versão — e é aqui que a Bolsa se separa das normativas.
--
-- ⚠️ REGRA: a Bolsa NUNCA pode ficar sem versão ativa. Uma normativa pode (e o
-- chatbot trata isso encaminhando para atendimento humano); a Bolsa, não. Como
-- só existe uma versão ativa por vez, inativar "a ativa" é exatamente o que
-- deixaria a Bolsa vazia — então essa chamada é RECUSADA, sempre.
--
-- Consequência prática, e ela é intencional: trocar a versão oficial se faz
-- ATIVANDO a outra, não inativando a atual. Ativar já inativa a anterior na
-- mesma transação.
create or replace function public.deactivate_market_bulletin_version(
  p_version_id uuid,
  p_bulletin_id uuid
)
returns public.market_bulletin_versions
language plpgsql
set search_path = ''
as $$
declare
  v_row public.market_bulletin_versions;
begin
  -- Permissão antes da pergunta, e a leitura já sob o lock. Mesmo raciocínio
  -- de `activate_market_bulletin_version`.
  perform public.lock_market_bulletin(p_bulletin_id);

  select * into v_row
    from public.market_bulletin_versions
   where id = p_version_id;

  if v_row.id is null then
    raise exception 'Versão não encontrada.' using errcode = 'P0002';
  end if;

  if v_row.bulletin_id <> p_bulletin_id then
    raise exception 'A versão não pertence a esta Bolsa.' using errcode = 'MB002';
  end if;

  if v_row.status = 'active' then
    raise exception 'A Bolsa não pode ficar sem uma versão ativa.' using errcode = 'MB001';
  end if;

  -- Já estava inativa: idempotente, nada muda e nada vai para a trilha.
  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 11. Grants de execução
-- ----------------------------------------------------------------------------
-- As funções são SECURITY INVOKER, então quem as chama precisa poder executá-las.
-- Tirar de PUBLIC (e portanto de `anon`) e devolver só para quem está autenticado.
revoke execute on function public.current_actor_name() from public;
grant execute on function public.current_actor_name() to authenticated;

revoke execute on function public.market_bulletin_version_name(date) from public;
grant execute on function public.market_bulletin_version_name(date) to authenticated;

revoke execute on function public.lock_market_bulletin(uuid) from public;
grant execute on function public.lock_market_bulletin(uuid) to authenticated;

revoke execute on function public.create_market_bulletin(text, text, boolean) from public;
grant execute on function public.create_market_bulletin(text, text, boolean) to authenticated;

revoke execute on function public.update_market_bulletin(uuid, text, text, boolean) from public;
grant execute on function public.update_market_bulletin(uuid, text, text, boolean) to authenticated;

revoke execute on function public.create_market_bulletin_version(
  uuid, uuid, date, text, text, text, integer, text, text, integer
) from public;
grant execute on function public.create_market_bulletin_version(
  uuid, uuid, date, text, text, text, integer, text, text, integer
) to authenticated;

revoke execute on function public.activate_market_bulletin_version(uuid, uuid) from public;
grant execute on function public.activate_market_bulletin_version(uuid, uuid) to authenticated;

revoke execute on function public.deactivate_market_bulletin_version(uuid, uuid) from public;
grant execute on function public.deactivate_market_bulletin_version(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 12. A Bolsa inicial
-- ----------------------------------------------------------------------------
-- Isto é DADO, não código: entra como linha para o sistema já nascer utilizável,
-- e o cadastro continua criando quantas outras bolsas forem necessárias sem
-- tocar em migration. Nenhuma regra acima menciona suínos.
insert into public.market_bulletins (name, description, chatbot_enabled)
values (
  'Bolsa de Suínos',
  'Boletim de preços da suinocultura publicado pela APCS.',
  true
)
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- ROLLBACK (se precisar desfazer)
-- ----------------------------------------------------------------------------
--   drop function if exists public.deactivate_market_bulletin_version(uuid, uuid);
--   drop function if exists public.activate_market_bulletin_version(uuid, uuid);
--   drop function if exists public.create_market_bulletin_version(uuid, uuid, date, text, text, text, integer, text, text, integer);
--   drop function if exists public.update_market_bulletin(uuid, text, text, boolean);
--   drop function if exists public.create_market_bulletin(text, text, boolean);
--   drop function if exists public.lock_market_bulletin(uuid);
--   drop function if exists public.market_bulletin_version_name(date);
--   drop function if exists public.current_actor_name();
--   drop policy if exists "market_bulletins_bucket_delete" on storage.objects;
--   drop policy if exists "market_bulletins_bucket_insert" on storage.objects;
--   drop policy if exists "market_bulletins_bucket_select" on storage.objects;
--   -- ⚠️ o bucket só sai depois de esvaziado; apagar arquivo publicado é
--   -- decisão de negócio, não de rollback técnico.
--   delete from storage.buckets where id = 'market-bulletins';
--   drop table if exists public.market_bulletin_audit_logs;
--   drop table if exists public.market_bulletin_versions;
--   drop table if exists public.market_bulletins;
--   drop type if exists public.market_bulletin_audit_action;
--   drop type if exists public.market_bulletin_status_reason;
--   drop type if exists public.market_bulletin_version_status;
