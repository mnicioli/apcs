-- ============================================================================
-- FLUXOS DE ATENDIMENTO — a fundação (Prompt 1 de 5)
-- ============================================================================
--
-- O segundo componente do menu INTELIGÊNCIA. Ele responde a uma pergunta que
-- nenhum módulo existente responde:
--
--     "Quando alguém escreve para a APCS, o que acontece — e quem decidiu?"
--
-- Hoje a resposta está em TypeScript: `intent.registry.ts` diz o que cada
-- intenção faz, `router.ts` decide o caminho e `engine.ts` executa. Mudar a
-- triagem exige um programador, um deploy e um `pnpm db:types`. Este módulo é o
-- que tira essa decisão do código e a coloca numa tela.
--
-- ----------------------------------------------------------------------------
-- ⚠️ O QUE ELE **NÃO** É
-- ----------------------------------------------------------------------------
-- ELE NÃO SUBSTITUI O ROTEADOR DE INTENÇÕES, e nem desliga nada.
-- `20260914000200_intelligence.sql` continua sendo quem interpreta a mensagem;
-- este módulo é quem decide o que fazer com a interpretação. A ligação entre os
-- dois é o Prompt 2 em diante — nesta migration não existe caminho de execução
-- ligado ao WhatsApp, e é de propósito: uma fundação que já atendesse gente não
-- daria para homologar.
--
-- ELE TAMBÉM NÃO É UMA SEGUNDA ESTRUTURA DE CONVERSA. `whatsapp_chats` /
-- `whatsapp_messages` continuam sendo o livro-razão do que foi dito, e
-- `conversation_context` continua sendo o que o robô LEMBRA. `flow_runs`, aqui,
-- é uma terceira coisa: o que o MOTOR está executando. As três apontam para a
-- mesma conversa e nenhuma guarda o texto de uma mensagem.
--
-- ----------------------------------------------------------------------------
-- AS QUATRO REGRAS QUE MANDAM EM TUDO
-- ----------------------------------------------------------------------------
--   1. SÓ SE EDITA RASCUNHO.       Versão publicada é imutável (§22). Alterar
--                                  um fluxo no ar é criar a versão seguinte.
--   2. UMA PUBLICADA POR FLUXO.    Índice único parcial — não é convenção.
--   3. NADA SE APAGA.              Versão substituída vira `superseded` e fica.
--   4. QUEM DECIDE É O MOTOR.      A IA entrega intenção e confiança; a escolha
--                                  do caminho é determinística (§25).
--
-- As três primeiras estão nesta migration, em constraint e gatilho. A quarta é
-- de arquitetura e mora em `src/modules/flow/flow.engine.ts` — aqui ela aparece
-- como o que NÃO existe: nenhuma coluna deste arquivo guarda texto gerado.
--
-- DEPENDE DE: 20260917000000_flow_enums.sql,
--             20260830100000_admin_module.sql (log_admin_action),
--             20260822000000_create_whatsapp_inbox.sql (whatsapp_chats),
--             20260903000100_custom_roles.sql (app_role_ceilings),
--             20260603000000_init.sql (handle_updated_at, current_app_role)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Quem lê e quem escreve
-- ----------------------------------------------------------------------------
-- ⚠️ NÃO EXISTE "GESTOR" NESTE PROJETO, e o escopo pede um. O papel `ceo` foi
-- APOSENTADO em 20260902000000_retire_roles.sql: um CHECK em `profiles.role`
-- impede que qualquer conta o tenha. Ressuscitá-lo aqui traria junto 122
-- referências em policies velhas.
--
-- O recorte fica igual ao de Documentos, Eventos, Bolsa, Palestras e Enquetes:
-- o ADMINISTRADOR desenha, aprova e publica; o ATENDENTE (`comercial`) LÊ —
-- porque ele precisa saber por que a conversa dele chegou daquele jeito, e não
-- precisa poder mudar a triagem no meio do expediente.
--
-- Um "Gestor de Fluxos" continua possível SEM papel novo: a APCS cria um CARGO
-- em /permissions com base `admin` e só as permissões `flows.*`. É exatamente
-- para isso que 20260903000100 existe — um cargo TIRA do teto do papel-base.
create or replace function public.flow_is_writer()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select public.current_app_role()) = 'admin', false)
    -- A válvula para quem NÃO É USUÁRIO FINAL: sem `auth.uid()` não há perfil a
    -- consultar. Quem chega aqui assim é o servidor (`service_role`, que ignora
    -- RLS de qualquer forma) ou o dono do banco (migration, seed, operação).
    -- É a mesma válvula de `survey_is_writer`, e pelo mesmo motivo.
    or (select auth.uid()) is null;
$$;

comment on function public.flow_is_writer() is
  'Pode desenhar, aprovar e publicar fluxo. Somente Administrador — o papel Gestor foi aposentado em 20260902000000.';

create or replace function public.flow_is_reader()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- ⚠️ SEM a válvula de `auth.uid() is null` da escrita, e de propósito — é a
  -- mesma assimetria de `survey_is_reader`. Esta checagem guarda LEITURA de
  -- dado, e uma chamada sem sessão não pode passar por ela.
  select coalesce((select public.current_app_role()) in ('admin', 'comercial'), false);
$$;

comment on function public.flow_is_reader() is
  'Pode consultar fluxos publicados e o historico. Administrador e Atendente.';

revoke execute on function public.flow_is_writer() from public, anon;
grant execute on function public.flow_is_writer() to authenticated;
revoke execute on function public.flow_is_reader() from public, anon;
grant execute on function public.flow_is_reader() to authenticated;


-- ⚠️ UM SÓ GATILHO DE TOQUE PARA AS TRÊS TABELAS QUE TÊM AUTOR DE EDIÇÃO.
-- `handle_updated_at` não serve sozinho porque estas tabelas guardam também
-- QUEM editou, e o §17 pede o usuário em toda alteração relevante. Deixar isso
-- a cargo de cada `update` é garantir que um dia um caminho de escrita esqueça
-- — e a trilha desse dia diria "alterado por ninguém".
create or replace function public.flow_touch()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at = now();
  new.updated_by = (select auth.uid());
  return new;
end;
$fn$;

comment on function public.flow_touch() is
  'Carimba updated_at e updated_by. Gatilho, e nao chamada: nao existe caminho de escrita que esqueca.';


-- ----------------------------------------------------------------------------
-- 2. Os times de atendimento (§11)
-- ----------------------------------------------------------------------------
-- ⚠️ O FLUXO APONTA PARA O TIME, NUNCA PARA A PESSOA — e esta tabela é o que
-- torna isso verdade em vez de intenção. Se o fluxo guardasse `assigned_user_id`
-- direto, o dia em que a Maria saísse do marketing seria o dia em que alguém
-- teria de abrir CADA versão publicada e trocar o destino. Versão publicada é
-- imutável (§22): não daria. O fluxo apontaria para uma pessoa que não está
-- mais lá, para sempre.
--
-- Com o time no meio, trocar quem atende é `delete`/`insert` em
-- `attendance_team_members` — e o fluxo não fica sabendo.
create table if not exists public.attendance_teams (
  id uuid primary key default gen_random_uuid(),

  -- ⚠️ A CHAVE ESTÁVEL DO §10. É ela que o nó ATTENDANT guarda, e não o nome:
  -- "Time de Marketing" pode virar "Marketing e Comunicação" numa quinta-feira
  -- sem que nenhuma versão publicada precise ser reescrita.
  key text not null,
  name text not null,
  description text,

  status public.attendance_team_status not null default 'active',

  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),

  -- MAIÚSCULAS COM SUBLINHADO, como TIME_MARKETING. O formato é imposto aqui
  -- porque a chave viaja para dentro de um jsonb congelado no `publish` — e
  -- depois disso não há mais como corrigi-la.
  constraint attendance_teams_key_format check (key ~ '^[A-Z][A-Z0-9_]{2,39}$'),
  constraint attendance_teams_name_len check (char_length(btrim(name)) between 2 and 80),
  constraint attendance_teams_description_len
    check (description is null or char_length(description) <= 500)
);

comment on table public.attendance_teams is
  'Times de atendimento. O fluxo aponta para o TIME (§11): trocar quem atende nao mexe em versao publicada.';

comment on column public.attendance_teams.key is
  'Chave estavel (TIME_MARKETING). E o que a versao publicada guarda — o nome pode mudar sem quebrar o fluxo.';

create unique index if not exists attendance_teams_key_idx
  on public.attendance_teams (key);

create index if not exists attendance_teams_active_idx
  on public.attendance_teams (status, name);

create trigger on_attendance_teams_touch
  before update on public.attendance_teams
  for each row execute procedure public.flow_touch();


create table if not exists public.attendance_team_members (
  team_id uuid not null references public.attendance_teams on delete cascade,
  -- `cascade`: quem some do sistema some dos times. Não deixa membro fantasma,
  -- e não impede a remoção do usuário — que é o que um `restrict` faria.
  profile_id uuid not null references public.profiles on delete cascade,
  added_by uuid references public.profiles on delete set null default auth.uid(),
  added_at timestamptz not null default now(),
  primary key (team_id, profile_id)
);

comment on table public.attendance_team_members is
  'Quem esta em cada time. Alterar esta tabela NAO altera fluxo nenhum — e o ponto do §11.';

create index if not exists attendance_team_members_profile_idx
  on public.attendance_team_members (profile_id);


-- ----------------------------------------------------------------------------
-- 3. Os fluxos
-- ----------------------------------------------------------------------------
create table if not exists public.flows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  channel public.flow_channel not null default 'whatsapp',

  -- O interruptor. Ver a seção 2 do arquivo de enums para por que ele mora aqui
  -- e não na versão.
  status public.flow_status not null default 'inactive',

  -- ⚠️ ONDE A CONVERSA COMEÇA. Sem isto o motor precisaria de um nome mágico
  -- ("Triagem Inicial") escrito em algum lugar do código — que é exatamente o
  -- tipo de acoplamento que este módulo existe para desfazer.
  is_entry boolean not null default false,

  -- A FK é acrescentada na seção 4: `flow_versions` ainda não existe aqui.
  active_version_id uuid,

  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),

  constraint flows_name_len check (char_length(btrim(name)) between 2 and 120),
  constraint flows_description_len check (description is null or char_length(description) <= 1000),

  -- ⚠️ FLUXO ATIVO SEM VERSÃO PUBLICADA É UM ROBÔ MUDO COM O SINAL VERDE. A
  -- tela diria "ativo", o motor entraria, não acharia definição nenhuma e a
  -- pessoa do outro lado não receberia resposta — o pior desfecho possível,
  -- porque nada estaria quebrado o bastante para aparecer num log.
  constraint flows_active_needs_version
    check (status = 'inactive' or active_version_id is not null)
);

comment on table public.flows is
  'Um fluxo de atendimento. O desenho mora nas VERSOES; aqui ficam a identidade e o interruptor.';

comment on column public.flows.is_entry is
  'Onde a conversa comeca naquele canal. Indice unico parcial garante um por canal.';

-- ⚠️ UM PONTO DE ENTRADA POR CANAL. Dois fluxos marcados como entrada fariam a
-- escolha depender da ordem da consulta — ou seja, do acaso.
create unique index if not exists flows_entry_idx
  on public.flows (channel)
  where is_entry;

create index if not exists flows_channel_idx
  on public.flows (channel, status, name);

-- ⚠️ SEM ESTE GATILHO, `updated_at` FICARIA CONGELADO NA CRIAÇÃO — e a coluna
-- "Atualizado" da grid mostraria, para sempre, a data em que o fluxo nasceu.
-- É o tipo de erro que ninguém reporta: o número está lá, é plausível, e só
-- está errado.
create trigger on_flows_touch
  before update on public.flows
  for each row execute procedure public.flow_touch();


-- ----------------------------------------------------------------------------
-- 4. As versões (§6, §22)
-- ----------------------------------------------------------------------------
create table if not exists public.flow_versions (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows on delete cascade,

  -- 1, 2, 3… por fluxo. Calculado por `create_flow_version`, que serializa com
  -- lock consultivo — dois cliques simultâneos em "nova versão" produziriam
  -- duas v2 sem isso, e o índice único recusaria a segunda com 23505.
  version integer not null,

  status public.flow_version_status not null default 'draft',

  -- ⚠️ O RETRATO CONGELADO, E A DECISÃO MAIS DISPUTADA DESTE ARQUIVO.
  --
  -- O desenho existe em DOIS formatos: as linhas de `flow_nodes` /
  -- `flow_transitions` (editáveis, com posição, boas para uma tela de canvas) e
  -- este jsonb (um documento só, bom para o motor ler numa consulta).
  --
  -- Duas cópias do mesmo dado costumam ser um defeito esperando acontecer. Aqui
  -- não são, porque NUNCA AS DUAS SÃO AUTORIDADE AO MESMO TEMPO:
  --
  --     RASCUNHO   → as TABELAS mandam.  `definition` é NULL.
  --     PUBLICADA  → o JSONB manda.      As tabelas ficam congeladas (gatilho).
  --
  -- O CHECK abaixo torna isso estrutural, e não uma convenção. A travessia é
  -- `publish_flow_version`, que compila um no outro — um lugar só.
  --
  -- O ganho é o motor: ler um fluxo em produção é UM select por chave primária,
  -- sem join, sem N+1, e sem a possibilidade de alguém ter mexido num nó entre
  -- duas mensagens da mesma conversa.
  definition jsonb,

  -- Por que esta versão existe. É o que se lê no rollback, meses depois.
  notes text,

  published_at timestamptz,
  published_by uuid references public.profiles on delete set null,

  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),

  constraint flow_versions_number check (version >= 1),
  constraint flow_versions_notes_len check (notes is null or char_length(notes) <= 1000),

  -- As duas metades da regra acima, escritas para o Postgres.
  constraint flow_versions_definition_shape
    check (
      (status in ('draft', 'testing', 'pending_approval', 'approved') and definition is null)
      or (status in ('published', 'superseded') and jsonb_typeof(definition) = 'object')
    ),
  constraint flow_versions_published_stamp
    check ((status in ('published', 'superseded')) = (published_at is not null)),

  -- Chave composta para a FK de `flow_runs` da seção 8 — é ela que garante que
  -- a versão de uma execução pertence ao fluxo daquela execução.
  constraint flow_versions_identity unique (id, flow_id)
);

comment on table public.flow_versions is
  'Uma versao do desenho. Rascunho vive nas tabelas de nos; publicada vive no jsonb congelado (§22).';

comment on column public.flow_versions.definition is
  'Retrato congelado do grafo, montado por publish_flow_version. NULL enquanto rascunho — ver o CHECK.';

create unique index if not exists flow_versions_number_idx
  on public.flow_versions (flow_id, version);

-- ⚠️ A REGRA 2, E ELA É UM ÍNDICE, NÃO UM COMENTÁRIO. "Somente uma versão
-- publicada por vez" verificado em código seria verdade até a primeira corrida
-- entre duas abas abertas.
create unique index if not exists flow_versions_published_idx
  on public.flow_versions (flow_id)
  where status = 'published';

create index if not exists flow_versions_flow_idx
  on public.flow_versions (flow_id, version desc);

create trigger on_flow_versions_touch
  before update on public.flow_versions
  for each row execute procedure public.flow_touch();

-- A FK que faltava na seção 3, agora que o alvo existe.
-- `restrict`: apagar a versão que está no ar teria de passar por despublicar
-- primeiro. É a mesma proteção que `flows_active_needs_version` dá do outro
-- lado.
alter table public.flows
  drop constraint if exists flows_active_version_fk;
alter table public.flows
  add constraint flows_active_version_fk
  foreign key (active_version_id) references public.flow_versions (id) on delete restrict;


-- ----------------------------------------------------------------------------
-- 5. Os nós (§7, §8, §20, §21)
-- ----------------------------------------------------------------------------
create table if not exists public.flow_nodes (
  id uuid primary key default gen_random_uuid(),
  flow_version_id uuid not null references public.flow_versions on delete cascade,

  type public.flow_node_type not null,

  -- ⚠️ A CHAVE ESTÁVEL DO NÓ. O id serve à máquina; esta serve à pessoa que vai
  -- ler a trilha e o jsonb congelado seis meses depois. `PERGUNTA_ASSUNTO` diz
  -- o que aconteceu; `a3f1…-…` não diz nada.
  key text not null,
  name text not null,

  -- O que cada tipo de nó precisa saber. A FORMA depende do tipo e é validada
  -- em Zod (`flow.schema.ts`), não aqui: um CHECK por tipo de nó viraria uma
  -- migration a cada campo novo de configuração, que é o oposto do §6.
  --
  -- O que o banco garante é o esqueleto: que é um objeto.
  configuration jsonb not null default '{}'::jsonb,

  -- §7. Onde o nó aparece no canvas do Prompt 2. Guardar isto agora é o que
  -- evita que a tela visual tenha de inventar um layout na primeira abertura.
  position jsonb not null default '{"x": 0, "y": 0}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,

  -- §20. O ponto de entrada. Ver o enum `flow_node_type` para por que não é um
  -- tipo de nó.
  is_start boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint flow_nodes_key_format check (key ~ '^[A-Z][A-Z0-9_]{2,39}$'),
  constraint flow_nodes_name_len check (char_length(btrim(name)) between 1 and 120),
  constraint flow_nodes_configuration_object check (jsonb_typeof(configuration) = 'object'),
  constraint flow_nodes_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint flow_nodes_position_shape
    check (
      jsonb_typeof(position -> 'x') = 'number'
      and jsonb_typeof(position -> 'y') = 'number'
    ),

  -- ⚠️ UM NÓ FINAL NÃO PODE SER O INÍCIO. Parece óbvio, e é exatamente o tipo de
  -- coisa que um arrastar acidental no canvas produz — um fluxo que "publica
  -- normalmente" e encerra toda conversa na primeira mensagem.
  constraint flow_nodes_end_is_not_start check (not (is_start and type = 'end')),

  -- Chave composta para as FKs de `flow_transitions`.
  constraint flow_nodes_identity unique (id, flow_version_id)
);

comment on table public.flow_nodes is
  'Os nos de uma versao. Escrevveis somente enquanto a versao e rascunho — ver o gatilho da secao 7.';

create unique index if not exists flow_nodes_key_idx
  on public.flow_nodes (flow_version_id, key);

-- §20: exatamente um nó inicial. "Exatamente" tem duas metades — no máximo um
-- (este índice) e ao menos um (`validate_flow_version`, na publicação).
create unique index if not exists flow_nodes_start_idx
  on public.flow_nodes (flow_version_id)
  where is_start;

create trigger on_flow_nodes_updated
  before update on public.flow_nodes
  for each row execute procedure public.handle_updated_at();


-- ----------------------------------------------------------------------------
-- 6. As transições (§9, §19)
-- ----------------------------------------------------------------------------
create table if not exists public.flow_transitions (
  id uuid primary key default gen_random_uuid(),
  flow_version_id uuid not null references public.flow_versions on delete cascade,

  source_node_id uuid not null,
  target_node_id uuid not null,

  -- ⚠️ A CONDIÇÃO NUNCA É UM NÚMERO DE OPÇÃO (§9). `{"type":"answer","optionKey":"EVENTOS"}`
  -- continua valendo quando alguém reordenar as alternativas na tela; um
  -- `{"option": 1}` passaria a mandar para Filiação sem que nada acusasse.
  --
  -- O CHECK impõe as três formas que existem hoje. Uma quarta é um valor a mais
  -- nesta lista mais um ramo no avaliador do motor — não uma reestruturação.
  condition jsonb not null default '{"type": "always"}'::jsonb,

  -- O que o desenho mostra na seta. É rótulo, não regra (§10).
  label text,

  -- Desempate quando mais de uma condição casa. Menor primeiro.
  priority integer not null default 0,

  created_at timestamptz not null default now(),

  -- ⚠️ "TRANSITION APONTANDO PARA NODE INEXISTENTE" (§19) RESOLVIDO PELA FORMA,
  -- E NÃO POR VALIDAÇÃO. A FK é COMPOSTA — inclui `flow_version_id` —, então
  -- ela recusa também o caso sutil: apontar para um nó que existe, mas é de
  -- OUTRA versão. Uma checagem em código pegaria o primeiro caso e deixaria o
  -- segundo passar, e o segundo é o que acontece de verdade quando alguém
  -- duplica um fluxo.
  constraint flow_transitions_source_fk
    foreign key (source_node_id, flow_version_id)
    references public.flow_nodes (id, flow_version_id) on delete cascade,
  constraint flow_transitions_target_fk
    foreign key (target_node_id, flow_version_id)
    references public.flow_nodes (id, flow_version_id) on delete cascade,

  -- §19, "referências circulares inválidas". A auto-transição é o único ciclo
  -- que NUNCA é intencional: um nó que aponta para si mesmo é um laço infinito
  -- em tempo de execução. Ciclos maiores (voltar ao menu) são legítimos e
  -- continuam permitidos — quem os limita é o teto de saltos do motor.
  constraint flow_transitions_not_self check (source_node_id <> target_node_id),
  constraint flow_transitions_label_len check (label is null or char_length(label) <= 120),
  constraint flow_transitions_condition_kind
    check (condition ->> 'type' in ('always', 'answer', 'variable'))
);

comment on table public.flow_transitions is
  'As setas entre nos. A FK e COMPOSTA de proposito: recusa apontar para no de outra versao (§19).';

create index if not exists flow_transitions_source_idx
  on public.flow_transitions (flow_version_id, source_node_id, priority);


-- ----------------------------------------------------------------------------
-- 7. O congelamento — a regra 1, imposta por gatilho
-- ----------------------------------------------------------------------------
-- ⚠️ SEM ISTO, TODA A ARQUITETURA DE VERSÕES SERIA DECORATIVA. Editar um nó de
-- uma versão publicada mudaria o comportamento do robô sem criar versão, sem
-- trilha e sem ninguém aprovar — e o `definition` congelado continuaria dizendo
-- outra coisa. O sistema passaria a ter duas respostas para "o que está no ar".
--
-- ⚠️ O RAMO POR `tg_op` NÃO É ESTILO — É A ÚNICA FORMA QUE FUNCIONA. Num
-- gatilho de DELETE o PL/pgSQL não ATRIBUI `new`, e ler `new.flow_version_id`
-- ali não devolve nulo: levanta "record new is not assigned yet. The tuple
-- structure of a not-yet-assigned record is indeterminate".
--
-- Ou seja, um `coalesce(new.x, old.x)` — que é o reflexo natural de quem quer
-- cobrir os dois casos — transformaria TODA exclusão de nó num erro. E, fiel à
-- armadilha de sempre neste projeto, ele passaria na migration: o PL/pgSQL
-- planeja cada comando na primeira vez que ele executa, então o defeito só
-- apareceria no dia em que alguém apagasse um nó.
create or replace function public.flow_graph_draft_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_version_id uuid;
  v_status public.flow_version_status;
begin
  if tg_op = 'DELETE' then
    v_version_id := old.flow_version_id;
  else
    v_version_id := new.flow_version_id;
  end if;

  select v.status into v_status
  from public.flow_versions v
  where v.id = v_version_id;

  -- A versão sumindo junto (cascade de `flow_versions`) não é edição: é a
  -- limpeza de um rascunho descartado. Quando o Postgres propaga o cascade, a
  -- linha da versão JÁ FOI apagada nesta transação — a consulta acima devolve
  -- zero linhas. Sem esta saída, apagar um rascunho inteiro esbarraria no
  -- próprio gatilho.
  if v_status is not null and v_status <> 'draft' then
    raise exception
      'Esta versao nao e mais rascunho. Crie uma nova versao para alterar o fluxo.'
      using errcode = 'FL001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$fn$;

comment on function public.flow_graph_draft_only() is
  'Recusa escrita em no/transicao de versao que nao seja rascunho. E o que torna o §22 estrutural.';

create trigger on_flow_nodes_draft_only
  before insert or update or delete on public.flow_nodes
  for each row execute procedure public.flow_graph_draft_only();

create trigger on_flow_transitions_draft_only
  before insert or update or delete on public.flow_transitions
  for each row execute procedure public.flow_graph_draft_only();


-- ----------------------------------------------------------------------------
-- 8. As execuções (§12, §13, §16)
-- ----------------------------------------------------------------------------
create table if not exists public.flow_runs (
  id uuid primary key default gen_random_uuid(),

  flow_id uuid not null references public.flows on delete restrict,

  -- ⚠️ A EXECUÇÃO PRENDE A VERSÃO EM QUE COMEÇOU. Publicar a v3 no meio de uma
  -- conversa não pode fazer a pessoa saltar do nó 4 da v2 para um nó 4 da v3
  -- que pergunta outra coisa. Quem já está andando termina no desenho em que
  -- entrou; quem chegar depois entra na v3.
  --
  -- A FK é COMPOSTA (ver o fim da tabela): ela garante que a versão pertence ao
  -- fluxo desta execução. Duas FKs independentes deixariam passar uma execução
  -- apontando para o fluxo A e para uma versão do fluxo B — que não quebra nada
  -- na hora e produz um histórico que ninguém consegue explicar depois.
  flow_version_id uuid not null,

  -- Anulável porque o segundo canal ainda não existe (ver `flow_channel`).
  -- Quando existir, o desenho já está escrito em 20260914000200: coluna irmã
  -- mais um CHECK de "exatamente um dos dois".
  whatsapp_chat_id uuid references public.whatsapp_chats on delete cascade,

  current_node_id uuid,

  -- As DUAS dimensões do §13, e elas são independentes. Ver o arquivo de enums.
  status public.flow_run_status not null default 'running',
  conversation_status public.flow_conversation_status not null default 'new',

  -- ⚠️ UM JSONB, E NÃO UMA COLUNA POR VARIÁVEL (§12). "nome", "assunto",
  -- "sub_assunto", "cidade" são o que ESTE fluxo coleta; o fluxo seguinte
  -- coletará outras cinco. Uma coluna para cada transformaria "acrescentar uma
  -- pergunta" em migration, deploy e `pnpm db:types` — e a tabela chegaria a
  -- oitenta colunas quase sempre nulas.
  variables jsonb not null default '{}'::jsonb,

  -- §25. O que a IA ENTREGOU, não o que ela decidiu: quem decide é o motor.
  -- Mesmo formato de `intelligence_interactions`, de propósito — as duas
  -- trilhas precisam ser comparáveis.
  intent text,
  intent_confidence numeric(4, 3),

  -- §11. O time, e o usuário só quando alguém de fato assume.
  assigned_team_id uuid references public.attendance_teams on delete set null,
  assigned_user_id uuid references public.profiles on delete set null,

  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  constraint flow_runs_variables_object check (jsonb_typeof(variables) = 'object'),
  constraint flow_runs_intent_format check (intent is null or intent ~ '^[a-z_]{3,40}$'),
  constraint flow_runs_confidence_range
    check (intent_confidence is null or (intent_confidence >= 0 and intent_confidence <= 1)),

  -- §21. Encerrar é carimbar a hora. Os dois lados: nenhum desfecho sem
  -- carimbo, nenhum carimbo sem desfecho — o segundo é o que impede uma
  -- execução "em andamento desde ontem" que na verdade acabou.
  constraint flow_runs_closed_stamp
    check ((status in ('completed', 'failed', 'cancelled')) = (completed_at is not null)),

  -- A versão é DESTE fluxo. Ver o comentário de `flow_version_id`.
  constraint flow_runs_version_fk
    foreign key (flow_version_id, flow_id)
    references public.flow_versions (id, flow_id) on delete restrict,

  -- ⚠️ O NÓ ATUAL É DA VERSÃO DA EXECUÇÃO. FK composta, pelo mesmo motivo das
  -- transições. Com `current_node_id` nulo a constraint não se aplica (MATCH
  -- SIMPLE), que é o comportamento desejado para uma execução recém-criada.
  constraint flow_runs_current_node_fk
    foreign key (current_node_id, flow_version_id)
    references public.flow_nodes (id, flow_version_id) on delete restrict
);

comment on table public.flow_runs is
  'Uma execucao de fluxo numa conversa. NAO e uma segunda tabela de conversa: o texto vive em whatsapp_messages.';

comment on column public.flow_runs.flow_version_id is
  'A versao em que a execucao COMECOU. Publicar outra no meio da conversa nao muda o desenho de quem ja anda.';

comment on column public.flow_runs.conversation_status is
  'Situacao do ATENDIMENTO. Independente de `status`, que e a situacao do motor (§13).';

-- ⚠️ UMA EXECUÇÃO ABERTA POR CONVERSA. Duas fariam a mesma mensagem avançar
-- dois fluxos, e a pessoa receberia duas perguntas diferentes ao mesmo tempo.
-- O índice é parcial: execuções encerradas se acumulam à vontade, que é o
-- histórico.
create unique index if not exists flow_runs_open_idx
  on public.flow_runs (whatsapp_chat_id)
  where whatsapp_chat_id is not null and status in ('running', 'waiting_reply', 'handed_off');

create index if not exists flow_runs_queue_idx
  on public.flow_runs (assigned_team_id, conversation_status, started_at desc)
  where assigned_team_id is not null;

create index if not exists flow_runs_flow_idx
  on public.flow_runs (flow_id, started_at desc);

create trigger on_flow_runs_updated
  before update on public.flow_runs
  for each row execute procedure public.handle_updated_at();


-- ----------------------------------------------------------------------------
-- 9. Os passos — a idempotência do §27
-- ----------------------------------------------------------------------------
-- ⚠️ "UMA MENSAGEM DUPLICADA DO WHATSAPP NÃO DEVE FAZER O FLUXO AVANÇAR DUAS
-- VEZES." Essa frase do §27 não se cumpre com cuidado: cumpre-se com um índice
-- único. Webhook reentrega, e reentrega justamente quando a primeira resposta
-- demorou — ou seja, sob carga, que é quando a checagem em código perde a
-- corrida.
--
-- A chave é o id da mensagem que provocou o passo. Se a mesma mensagem chegar
-- de novo, o insert falha com 23505 e o motor sabe que aquele passo já foi
-- dado — não precisa adivinhar.
create table if not exists public.flow_run_steps (
  id bigint generated always as identity primary key,
  flow_run_id uuid not null references public.flow_runs on delete cascade,

  -- Anulável: o passo de ENCERRAMENTO não executa nó nenhum.
  node_id uuid,

  seq integer not null,

  -- Normalmente o id da mensagem recebida. Texto (e não uuid) porque nem todo
  -- gatilho de passo é mensagem: uma retomada por tempo tem chave própria.
  idempotency_key text not null,

  inbound_message_id uuid references public.whatsapp_messages on delete set null,

  -- O que entrou e o que saiu. Sem TEXTO da pessoa: o texto vive em
  -- `whatsapp_messages`, com a política de retenção de lá. Aqui ficam a opção
  -- escolhida, a variável gravada, o time para onde foi.
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint flow_run_steps_seq check (seq >= 1),
  constraint flow_run_steps_key_len check (char_length(idempotency_key) between 1 and 200),
  constraint flow_run_steps_input_object check (jsonb_typeof(input) = 'object'),
  constraint flow_run_steps_output_object check (jsonb_typeof(output) = 'object')
);

comment on table public.flow_run_steps is
  'Cada avanco de uma execucao. O indice unico de idempotency_key e o que cumpre o §27.';

create unique index if not exists flow_run_steps_idempotency_idx
  on public.flow_run_steps (flow_run_id, idempotency_key);

create unique index if not exists flow_run_steps_seq_idx
  on public.flow_run_steps (flow_run_id, seq);


-- ----------------------------------------------------------------------------
-- 10. A validação do §19 — no banco, que é onde ela vale
-- ----------------------------------------------------------------------------
-- ⚠️ ELA DEVOLVE A LISTA DO QUE ESTÁ ERRADO, e não um booleano. Um `false` faria
-- a tela dizer "fluxo inválido" diante de um desenho de quarenta nós, e a
-- pessoa teria de caçar. Cada linha aqui é uma frase que já diz onde olhar.
--
-- ⚠️ E ELA É A BARREIRA, NÃO O ESPELHO. Existe uma leitura das mesmas regras em
-- `src/modules/flow/flow.rules.ts`, para o botão de publicar poder ficar
-- desabilitado com um motivo à vista. Se as duas divergirem, quem está certo é
-- esta — é ela que `publish_flow_version` chama, e não há caminho de publicação
-- que a contorne.
create or replace function public.validate_flow_version(p_version_id uuid)
returns table (code text, detail text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_flow_id uuid;
  v_status public.flow_version_status;
begin
  select v.flow_id, v.status into v_flow_id, v_status
  from public.flow_versions v
  where v.id = p_version_id;

  if v_flow_id is null then
    return query select 'version_not_found'::text, 'A versao nao existe.'::text;
    return;
  end if;

  -- 1. Nó inicial. O índice único já garante "no máximo um"; aqui é o "ao
  --    menos um" — a metade que só dá para conferir na publicação.
  if not exists (
    select 1 from public.flow_nodes n where n.flow_version_id = p_version_id and n.is_start
  ) then
    return query select 'missing_start'::text, 'O fluxo precisa de um no inicial.'::text;
  end if;

  -- 2. §21. Sem nó final, toda conversa fica em aberto para sempre — e ninguém
  --    percebe, porque uma conversa parada é indistinguível de uma conversa
  --    demorada.
  if not exists (
    select 1 from public.flow_nodes n where n.flow_version_id = p_version_id and n.type = 'end'
  ) then
    return query select 'missing_end'::text, 'O fluxo precisa de ao menos um no de encerramento.'::text;
  end if;

  -- 3. Nó sem saída que não encerra nem transfere: o motor chegaria nele e
  --    pararia sem ter o que fazer. É o beco sem saída clássico.
  return query
    select 'dead_end'::text,
           format('O no "%s" nao tem saida e nao encerra o atendimento.', n.key)::text
    from public.flow_nodes n
    where n.flow_version_id = p_version_id
      and n.type not in ('end', 'attendant')
      and not exists (
        select 1 from public.flow_transitions t
        where t.flow_version_id = p_version_id and t.source_node_id = n.id
      );

  -- 4. Nó órfão: existe, não é o início e ninguém aponta para ele. Não quebra
  --    nada em execução — e é justamente por isso que passa despercebido até
  --    alguém perguntar por que aquela pergunta nunca aparece.
  return query
    select 'unreachable'::text,
           format('O no "%s" nao e alcancado por nenhuma transicao.', n.key)::text
    from public.flow_nodes n
    where n.flow_version_id = p_version_id
      and not n.is_start
      and not exists (
        select 1 from public.flow_transitions t
        where t.flow_version_id = p_version_id and t.target_node_id = n.id
      );

  -- 5. Pergunta sem alternativas. A configuração é jsonb livre (ver seção 5), e
  --    esta é a única forma que o banco confere — porque é a que produz um
  --    fluxo que trava: o motor pergunta e não tem para onde ir.
  return query
    select 'question_without_options'::text,
           format('A pergunta "%s" nao tem alternativas configuradas.', n.key)::text
    from public.flow_nodes n
    where n.flow_version_id = p_version_id
      and n.type = 'question'
      and coalesce(jsonb_array_length(
        case when jsonb_typeof(n.configuration -> 'options') = 'array'
             then n.configuration -> 'options' else '[]'::jsonb end
      ), 0) < 2;

  -- 6. §11. Transferir para um time que não existe (ou que foi desativado) é
  --    uma conversa que entra numa fila que ninguém abre.
  return query
    select 'attendant_without_team'::text,
           format('O no "%s" nao aponta para um time ativo.', n.key)::text
    from public.flow_nodes n
    where n.flow_version_id = p_version_id
      and n.type = 'attendant'
      and not exists (
        select 1 from public.attendance_teams tm
        where tm.key = (n.configuration ->> 'teamKey') and tm.status = 'active'
      );
end;
$fn$;

comment on function public.validate_flow_version(uuid) is
  'As regras do §19. Devolve uma linha por problema — lista vazia significa publicavel.';

revoke execute on function public.validate_flow_version(uuid) from public, anon;
grant execute on function public.validate_flow_version(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 11. A compilação — de tabelas para o retrato congelado (§24)
-- ----------------------------------------------------------------------------
-- ⚠️ UM LUGAR SÓ, e é o que impede as duas representações de divergirem. Se a
-- compilação acontecesse no TypeScript, um script, um psql ou uma segunda tela
-- poderiam publicar um jsonb montado de outro jeito — e o motor leria um fluxo
-- que ninguém desenhou.
create or replace function public.compile_flow_definition(p_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'schema', 1,
    'startNodeId', (
      select n.id from public.flow_nodes n
      where n.flow_version_id = p_version_id and n.is_start
    ),
    'nodes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'key', n.key,
          'type', n.type,
          'name', n.name,
          'isStart', n.is_start,
          'configuration', n.configuration,
          'position', n.position,
          'metadata', n.metadata
        )
        order by n.key
      )
      from public.flow_nodes n
      where n.flow_version_id = p_version_id
    ), '[]'::jsonb),
    'transitions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'sourceNodeId', t.source_node_id,
          'targetNodeId', t.target_node_id,
          'condition', t.condition,
          'label', t.label,
          'priority', t.priority
        )
        -- A ORDEM É PARTE DO CONTRATO: o motor percorre as saídas de um nó na
        -- ordem de prioridade, e quem lê o jsonb precisa ver o mesmo que ele.
        order by t.source_node_id, t.priority, t.id
      )
      from public.flow_transitions t
      where t.flow_version_id = p_version_id
    ), '[]'::jsonb)
  );
$fn$;

comment on function public.compile_flow_definition(uuid) is
  'Monta o retrato congelado da versao. Chamada so por publish_flow_version — um lugar so (§24).';

revoke execute on function public.compile_flow_definition(uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 12. A criação de versão (§4)
-- ----------------------------------------------------------------------------
-- ⚠️ NUNCA SE EDITA A VERSÃO ATIVA. Este é o caminho pelo qual isso deixa de ser
-- uma regra escrita e vira a única coisa possível: alterar um fluxo no ar é
-- chamar esta função, que COPIA o desenho para um rascunho novo.
--
-- Copiar (em vez de abrir a publicada para edição) é o que preserva o §22 e o
-- que torna o rollback do §23 possível — a v1 continua exatamente como era.
create or replace function public.create_flow_version(
  p_flow_id uuid,
  p_copy_from uuid default null,
  p_notes text default null
)
returns public.flow_versions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_version integer;
  v_source uuid;
  v_new public.flow_versions;
begin
  if not public.flow_is_writer() then
    raise exception 'Sem permissao para alterar fluxos.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.flows f where f.id = p_flow_id) then
    raise exception 'Fluxo nao encontrado.' using errcode = 'P0002';
  end if;

  -- ⚠️ SERIALIZA POR FLUXO. Dois cliques em "nova versão" na mesma tela
  -- calculariam `max(version) + 1` ao mesmo tempo e produziriam duas v2 — a
  -- segunda morreria com 23505, que a tela traduziria como "já existe um
  -- registro com esses dados" num botão que não pede dado nenhum.
  --
  -- Lock consultivo e não `select ... for update`: em tabela com RLS, `for
  -- update` também exige privilégio de UPDATE, e o Atendente tem SELECT sem
  -- UPDATE. É a mesma razão de `lock_survey`.
  perform pg_advisory_xact_lock(hashtext('flow:' || p_flow_id::text));

  select coalesce(max(v.version), 0) + 1 into v_version
  from public.flow_versions v
  where v.flow_id = p_flow_id;

  -- Sem origem declarada, copia a que está no ar. É o que a pessoa quer em
  -- nove de dez vezes: "mexer no fluxo" significa mexer no que está valendo.
  v_source := coalesce(
    p_copy_from,
    (select f.active_version_id from public.flows f where f.id = p_flow_id)
  );

  insert into public.flow_versions (flow_id, version, status, notes)
  values (p_flow_id, v_version, 'draft', nullif(btrim(coalesce(p_notes, '')), ''))
  returning * into v_new;

  if v_source is not null then
    -- ⚠️ OS IDS SÃO NOVOS E O MAPA É A CHAVE ESTÁVEL. Copiar os ids faria as
    -- duas versões compartilharem nó — e editar o rascunho mudaria a versão
    -- publicada. É a `key` (§10) que costura origem e cópia; ela é única por
    -- versão, então serve de junção sem ambiguidade.
    insert into public.flow_nodes
      (flow_version_id, type, key, name, configuration, position, metadata, is_start)
    select v_new.id, n.type, n.key, n.name, n.configuration, n.position, n.metadata, n.is_start
    from public.flow_nodes n
    where n.flow_version_id = v_source;

    insert into public.flow_transitions
      (flow_version_id, source_node_id, target_node_id, condition, label, priority)
    select
      v_new.id,
      origem.id,
      destino.id,
      t.condition,
      t.label,
      t.priority
    from public.flow_transitions t
    join public.flow_nodes fonte on fonte.id = t.source_node_id
    join public.flow_nodes alvo on alvo.id = t.target_node_id
    join public.flow_nodes origem
      on origem.flow_version_id = v_new.id and origem.key = fonte.key
    join public.flow_nodes destino
      on destino.flow_version_id = v_new.id and destino.key = alvo.key
    where t.flow_version_id = v_source;
  end if;

  perform public.log_admin_action(
    'flow_version_created',
    (select f.name from public.flows f where f.id = p_flow_id),
    jsonb_build_object(
      'flowId', p_flow_id,
      'versionId', v_new.id,
      'version', v_version,
      'copiadaDe', v_source
    )
  );

  return v_new;
end;
$fn$;

comment on function public.create_flow_version(uuid, uuid, text) is
  'Abre um rascunho novo copiando o desenho de outra versao. E o unico caminho para alterar um fluxo no ar (§4).';

revoke execute on function public.create_flow_version(uuid, uuid, text) from public, anon;
grant execute on function public.create_flow_version(uuid, uuid, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 13. O avanço no ciclo de vida (§4)
-- ----------------------------------------------------------------------------
-- ⚠️ UMA FUNÇÃO PARA AS TRÊS PROMOÇÕES, com a tabela de transições permitidas
-- escrita uma vez. Três funções quase idênticas divergiriam na primeira
-- manutenção — e a que ficasse para trás aceitaria um salto que as outras
-- recusam.
--
-- O que ela NÃO faz é publicar: publicar tem validação, compilação e troca de
-- versão ativa, e mora na função seguinte.
create or replace function public.advance_flow_version(
  p_version_id uuid,
  p_to public.flow_version_status
)
returns public.flow_versions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before public.flow_versions;
  v_after public.flow_versions;
  v_action public.admin_audit_action;
begin
  if not public.flow_is_writer() then
    raise exception 'Sem permissao para alterar fluxos.' using errcode = '42501';
  end if;

  select * into v_before from public.flow_versions v where v.id = p_version_id;
  if v_before.id is null then
    raise exception 'Versao nao encontrada.' using errcode = 'P0002';
  end if;

  -- ⚠️ A TABELA DE TRANSIÇÕES, E ELA PERMITE VOLTAR. `testing → draft` e
  -- `pending_approval → draft` existem porque o teste é justamente onde se
  -- descobre que o desenho está errado; sem o caminho de volta, a saída seria
  -- criar mais uma versão só para consertar uma vírgula.
  if not (
    (v_before.status = 'draft' and p_to = 'testing')
    or (v_before.status = 'testing' and p_to in ('draft', 'pending_approval'))
    or (v_before.status = 'pending_approval' and p_to in ('draft', 'approved'))
    or (v_before.status = 'approved' and p_to = 'draft')
  ) then
    raise exception 'Esta mudanca de situacao nao e permitida para a versao.'
      using errcode = 'FL002';
  end if;

  update public.flow_versions v
  set status = p_to
  where v.id = p_version_id
  returning * into v_after;

  v_action := case p_to
    when 'testing' then 'flow_version_tested'
    when 'pending_approval' then 'flow_version_submitted'
    when 'approved' then 'flow_version_approved'
    else 'flow_version_updated'
  end;

  perform public.log_admin_action(
    v_action,
    (select f.name from public.flows f where f.id = v_after.flow_id),
    jsonb_build_object(
      'flowId', v_after.flow_id,
      'versionId', v_after.id,
      'version', v_after.version,
      'de', v_before.status,
      'para', p_to
    )
  );

  return v_after;
end;
$fn$;

comment on function public.advance_flow_version(uuid, public.flow_version_status) is
  'Move a versao pelo ciclo do §4, menos publicar. Permite voltar para rascunho — e onde o teste serve para algo.';

revoke execute on function public.advance_flow_version(uuid, public.flow_version_status)
  from public, anon;
grant execute on function public.advance_flow_version(uuid, public.flow_version_status)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 14. A publicação e o rollback (§22, §23)
-- ----------------------------------------------------------------------------
-- ⚠️ A FUNÇÃO MAIS IMPORTANTE DESTE ARQUIVO. Ela é o único lugar em que:
--
--   • a validação do §19 é OBRIGATÓRIA (e não conselho de tela);
--   • o desenho vira retrato congelado;
--   • a versão anterior sai de cena SEM SER APAGADA;
--   • `flows.active_version_id` muda.
--
-- ⚠️ E ELA É TAMBÉM O ROLLBACK. O §23 pede que voltar para a v2 seja "uma nova
-- publicação/ativação controlada da versão existente, preservando o histórico"
-- — que é exatamente o que acontece ao chamá-la com uma versão `superseded`. A
-- alternativa seria uma função `rollback_flow_version` que fizesse o mesmo com
-- outro nome, e as duas divergiriam. O que muda é o VERBO da trilha, para que a
-- pergunta "isto foi um avanço ou uma volta?" continue respondível.
create or replace function public.publish_flow_version(p_version_id uuid)
returns public.flow_versions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before public.flow_versions;
  v_after public.flow_versions;
  v_problemas text;
  v_anterior uuid;
  v_rollback boolean;
begin
  if not public.flow_is_writer() then
    raise exception 'Sem permissao para publicar fluxos.' using errcode = '42501';
  end if;

  select * into v_before from public.flow_versions v where v.id = p_version_id;
  if v_before.id is null then
    raise exception 'Versao nao encontrada.' using errcode = 'P0002';
  end if;

  -- Serializa por fluxo: duas publicações simultâneas de versões diferentes
  -- disputariam o índice único parcial, e a perdedora morreria com 23505.
  perform pg_advisory_xact_lock(hashtext('flow:' || v_before.flow_id::text));

  if v_before.status = 'published' then
    raise exception 'Esta versao ja esta publicada.' using errcode = 'FL003';
  end if;

  -- Aprovada (o caminho normal) ou substituída (o rollback do §23). Rascunho e
  -- em teste não passam: publicar sem aprovação é o que o ciclo do §4 existe
  -- para impedir.
  if v_before.status not in ('approved', 'superseded') then
    raise exception 'A versao precisa estar aprovada para ser publicada.'
      using errcode = 'FL004';
  end if;

  v_rollback := v_before.status = 'superseded';

  -- ⚠️ A VALIDAÇÃO RODA TAMBÉM NO ROLLBACK, e não é zelo excessivo: um time
  -- desativado depois da publicação original faria a v2 voltar apontando para
  -- uma fila que ninguém abre. O desenho não mudou; o mundo em volta mudou.
  select string_agg(p.detail, ' ') into v_problemas
  from public.validate_flow_version(p_version_id) p;

  if v_problemas is not null then
    raise exception 'O fluxo nao pode ser publicado: %', v_problemas
      using errcode = 'FL005';
  end if;

  select f.active_version_id into v_anterior
  from public.flows f where f.id = v_before.flow_id;

  -- ⚠️ A ANTERIOR VIRA `superseded`, NUNCA SOME (regra 3). E o `definition`
  -- dela fica: é o que permite responder "o que o robô dizia em agosto?".
  if v_anterior is not null and v_anterior <> p_version_id then
    update public.flow_versions v
    set status = 'superseded'
    where v.id = v_anterior and v.status = 'published';
  end if;

  update public.flow_versions v
  set status = 'published',
      definition = public.compile_flow_definition(p_version_id),
      published_at = now(),
      published_by = (select auth.uid())
  where v.id = p_version_id
  returning * into v_after;

  update public.flows f
  set active_version_id = p_version_id
  where f.id = v_after.flow_id;

  perform public.log_admin_action(
    case when v_rollback then 'flow_version_rolled_back' else 'flow_version_published' end,
    (select f.name from public.flows f where f.id = v_after.flow_id),
    jsonb_build_object(
      'flowId', v_after.flow_id,
      'versionId', v_after.id,
      'version', v_after.version,
      'de', v_before.status,
      'versaoAnterior', v_anterior,
      'nos', jsonb_array_length(v_after.definition -> 'nodes')
    )
  );

  return v_after;
end;
$fn$;

comment on function public.publish_flow_version(uuid) is
  'Valida, congela o desenho e troca a versao ativa. Chamada com uma versao substituida, e o rollback do §23.';

revoke execute on function public.publish_flow_version(uuid) from public, anon;
grant execute on function public.publish_flow_version(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 15. O interruptor do fluxo (§4)
-- ----------------------------------------------------------------------------
create or replace function public.set_flow_status(
  p_flow_id uuid,
  p_status public.flow_status
)
returns public.flows
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before public.flows;
  v_after public.flows;
begin
  if not public.flow_is_writer() then
    raise exception 'Sem permissao para alterar fluxos.' using errcode = '42501';
  end if;

  select * into v_before from public.flows f where f.id = p_flow_id;
  if v_before.id is null then
    raise exception 'Fluxo nao encontrado.' using errcode = 'P0002';
  end if;

  -- Nada mudou: sai sem escrever e sem sujar a trilha. É a mesma cortesia de
  -- `set_user_role`.
  if v_before.status = p_status then
    return v_before;
  end if;

  -- O CHECK da tabela recusaria de qualquer forma; a mensagem é que muda. "Nova
  -- violacao de restricao" mandaria a pessoa procurar um campo; esta diz o que
  -- fazer.
  if p_status = 'active' and v_before.active_version_id is null then
    raise exception 'Publique uma versao antes de ativar o fluxo.' using errcode = 'FL006';
  end if;

  update public.flows f
  set status = p_status
  where f.id = p_flow_id
  returning * into v_after;

  perform public.log_admin_action(
    case when p_status = 'active' then 'flow_activated' else 'flow_deactivated' end,
    v_after.name,
    jsonb_build_object('flowId', p_flow_id, 'de', v_before.status, 'para', p_status)
  );

  return v_after;
end;
$fn$;

comment on function public.set_flow_status(uuid, public.flow_status) is
  'Liga e desliga o fluxo. NAO toca em versao nenhuma — e a razao de o interruptor morar no fluxo.';

revoke execute on function public.set_flow_status(uuid, public.flow_status) from public, anon;
grant execute on function public.set_flow_status(uuid, public.flow_status) to authenticated;


-- ----------------------------------------------------------------------------
-- 16. A exclusão de fluxo — só o que nunca esteve no ar (§19)
-- ----------------------------------------------------------------------------
-- ⚠️ APAGAR UM FLUXO QUE JÁ ATENDEU É APAGAR HISTÓRICO. As execuções apontam
-- para ele com `on delete restrict`, então o banco recusaria de qualquer jeito
-- — mas com uma mensagem sobre chave estrangeira. Esta função responde antes, e
-- em português.
create or replace function public.delete_flow(p_flow_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_flow public.flows;
begin
  if not public.flow_is_writer() then
    raise exception 'Sem permissao para excluir fluxos.' using errcode = '42501';
  end if;

  select * into v_flow from public.flows f where f.id = p_flow_id;
  if v_flow.id is null then
    raise exception 'Fluxo nao encontrado.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.flow_versions v
    where v.flow_id = p_flow_id and v.status in ('published', 'superseded')
  ) then
    raise exception 'Este fluxo ja teve versao publicada e nao pode ser excluido.'
      using errcode = 'FL007';
  end if;

  if exists (select 1 from public.flow_runs r where r.flow_id = p_flow_id) then
    raise exception 'Este fluxo ja atendeu conversas e nao pode ser excluido.'
      using errcode = 'FL007';
  end if;

  perform public.log_admin_action(
    'flow_deleted',
    v_flow.name,
    jsonb_build_object('flowId', p_flow_id, 'canal', v_flow.channel)
  );

  -- Os rascunhos (e seus nós e transições) caem por cascade.
  delete from public.flows f where f.id = p_flow_id;
end;
$fn$;

comment on function public.delete_flow(uuid) is
  'Exclui um fluxo que nunca foi publicado nem atendeu ninguem. Qualquer outro caso e historico (§22).';

revoke execute on function public.delete_flow(uuid) from public, anon;
grant execute on function public.delete_flow(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 17. A trilha de auditoria — por GATILHO, não por chamada (§17)
-- ----------------------------------------------------------------------------
-- ⚠️ MESMA DECISÃO DA BASE DE CONHECIMENTO, e pelo mesmo motivo: as funções
-- acima registram os verbos de CICLO DE VIDA (publicar, aprovar, ativar), que
-- só existem lá dentro. O que sobra — criar um fluxo, renomear, mexer num nó,
-- ligar uma seta — passa por PostgREST, e um `log_admin_action` na action
-- deixaria de fora o psql, o script e a segunda tela.
--
-- Aqui a auditoria mora na FORMA do dado. Não existe caminho de escrita que
-- escape.
-- ⚠️ E AQUI VALE A MESMA ARMADILHA DO GATILHO DA SEÇÃO 7: em DELETE, `new` não
-- está atribuído, e lê-lo levanta erro em vez de devolver nulo. Por isso cada
-- tabela que aceita DELETE tem os dois ramos escritos por extenso, e não um
-- `coalesce(new.x, old.x)` — que é mais curto, parece certo e quebraria toda
-- exclusão de nó, de transição e de membro de time.
create or replace function public.flow_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_action public.admin_audit_action;
  v_alvo text;
  v_meta jsonb;
  v_apagando boolean := tg_op = 'DELETE';
begin
  -- `flows` e `attendance_teams` só têm gatilho de INSERT/UPDATE: `new` sempre
  -- existe nas duas.
  if tg_table_name = 'flows' then
    v_action := case when tg_op = 'INSERT' then 'flow_created' else 'flow_updated' end;
    v_alvo := new.name;
    v_meta := jsonb_build_object(
      'flowId', new.id,
      'canal', new.channel,
      'entrada', new.is_entry
    );

  elsif tg_table_name = 'attendance_teams' then
    v_action := 'flow_team_changed';
    v_alvo := new.key;
    v_meta := jsonb_build_object('teamId', new.id, 'nome', new.name, 'status', new.status);

  elsif tg_table_name = 'attendance_team_members' then
    v_action := 'flow_team_changed';
    if v_apagando then
      v_alvo := (select t.key from public.attendance_teams t where t.id = old.team_id);
      v_meta := jsonb_build_object('membro', old.profile_id, 'operacao', 'delete');
    else
      v_alvo := (select t.key from public.attendance_teams t where t.id = new.team_id);
      v_meta := jsonb_build_object('membro', new.profile_id, 'operacao', lower(tg_op));
    end if;

  elsif tg_table_name = 'flow_nodes' then
    v_action := 'flow_node_changed';
    if v_apagando then
      v_alvo := old.key;
      v_meta := jsonb_build_object(
        'versionId', old.flow_version_id,
        'nodeId', old.id,
        'tipo', old.type,
        'operacao', 'delete'
      );
    else
      v_alvo := new.key;
      v_meta := jsonb_build_object(
        'versionId', new.flow_version_id,
        'nodeId', new.id,
        'tipo', new.type,
        'operacao', lower(tg_op)
      );
    end if;

  else
    v_action := 'flow_transition_changed';
    if v_apagando then
      v_alvo := coalesce(old.label, 'transicao');
      v_meta := jsonb_build_object(
        'versionId', old.flow_version_id,
        'de', old.source_node_id,
        'para', old.target_node_id,
        'operacao', 'delete'
      );
    else
      v_alvo := coalesce(new.label, 'transicao');
      v_meta := jsonb_build_object(
        'versionId', new.flow_version_id,
        'de', new.source_node_id,
        'para', new.target_node_id,
        'operacao', lower(tg_op)
      );
    end if;
  end if;

  perform public.log_admin_action(v_action, v_alvo, v_meta);
  return null;
end;
$fn$;

comment on function public.flow_audit() is
  'Escreve a trilha dos fluxos. Gatilho, e nao chamada: nao existe caminho de escrita que escape.';

create trigger on_flows_audit
  after insert or update on public.flows
  for each row execute procedure public.flow_audit();

create trigger on_attendance_teams_audit
  after insert or update on public.attendance_teams
  for each row execute procedure public.flow_audit();

create trigger on_attendance_team_members_audit
  after insert or delete on public.attendance_team_members
  for each row execute procedure public.flow_audit();

create trigger on_flow_nodes_audit
  after insert or update or delete on public.flow_nodes
  for each row execute procedure public.flow_audit();

create trigger on_flow_transitions_audit
  after insert or update or delete on public.flow_transitions
  for each row execute procedure public.flow_audit();


-- ----------------------------------------------------------------------------
-- 18. Row Level Security
-- ----------------------------------------------------------------------------
alter table public.attendance_teams enable row level security;
alter table public.attendance_team_members enable row level security;
alter table public.flows enable row level security;
alter table public.flow_versions enable row level security;
alter table public.flow_nodes enable row level security;
alter table public.flow_transitions enable row level security;
alter table public.flow_runs enable row level security;
alter table public.flow_run_steps enable row level security;

-- `(select ...)` em volta da chamada: sem isso o planejador reavalia a função
-- por LINHA em vez de uma vez por consulta. É a lição de
-- 20260818000000_lecture_rls_initplan.sql.
create policy "attendance_teams_select" on public.attendance_teams
  for select using ((select public.flow_is_reader()));
create policy "attendance_teams_write" on public.attendance_teams
  for all using ((select public.flow_is_writer()))
  with check ((select public.flow_is_writer()));

create policy "attendance_team_members_select" on public.attendance_team_members
  for select using ((select public.flow_is_reader()));
create policy "attendance_team_members_write" on public.attendance_team_members
  for all using ((select public.flow_is_writer()))
  with check ((select public.flow_is_writer()));

-- ⚠️ AQUI AS POLICIES SÃO POR VERBO, E NÃO `for all` COMO NAS OUTRAS TABELAS.
--
-- Um `for all` em `flows` deixaria um Administrador APAGAR pelo PostgREST um
-- fluxo que já esteve no ar — levando junto, por cascade, todas as versões
-- publicadas. Ou seja: `delete_flow`, com as três recusas que ela existe para
-- fazer, seria contornável por um `DELETE /rest/v1/flows?id=eq...`.
--
-- O mesmo vale para `flow_versions`: um INSERT direto criaria uma versão com o
-- número que o cliente quisesse, sem o lock que serializa dois cliques em "nova
-- versão", sem copiar o desenho e sem trilha.
--
-- Por isso INSERT e DELETE de versão, e DELETE de fluxo, não têm policy — e o
-- privilégio de tabela também é revogado logo abaixo, para que a recusa venha
-- do Postgres e não dependa de a policy estar escrita certa.
create policy "flows_select" on public.flows
  for select using ((select public.flow_is_reader()));
create policy "flows_insert" on public.flows
  for insert with check ((select public.flow_is_writer()));
create policy "flows_update" on public.flows
  for update using ((select public.flow_is_writer()))
  with check ((select public.flow_is_writer()));

create policy "flow_versions_select" on public.flow_versions
  for select using ((select public.flow_is_reader()));
-- Só o UPDATE, e o grant de coluna da seção 19 o reduz a `notes`.
create policy "flow_versions_update" on public.flow_versions
  for update using ((select public.flow_is_writer()))
  with check ((select public.flow_is_writer()));

create policy "flow_nodes_select" on public.flow_nodes
  for select using ((select public.flow_is_reader()));
create policy "flow_nodes_write" on public.flow_nodes
  for all using ((select public.flow_is_writer()))
  with check ((select public.flow_is_writer()));

create policy "flow_transitions_select" on public.flow_transitions
  for select using ((select public.flow_is_reader()));
create policy "flow_transitions_write" on public.flow_transitions
  for all using ((select public.flow_is_writer()))
  with check ((select public.flow_is_writer()));

-- ⚠️ AS EXECUÇÕES SÃO SÓ DE LEITURA PARA TODO MUNDO, e é de propósito. Quem as
-- escreve é o motor, no servidor, com `service_role` — que não passa por RLS. Uma
-- policy de insert aqui permitiria forjar um atendimento, e é a mesma decisão
-- que `intelligence_interactions` tomou.
create policy "flow_runs_select" on public.flow_runs
  for select using ((select public.flow_is_reader()));
create policy "flow_run_steps_select" on public.flow_run_steps
  for select using ((select public.flow_is_writer()));

revoke insert, update, delete on public.flow_runs from authenticated, anon;
revoke insert, update, delete on public.flow_run_steps from authenticated, anon;


-- ----------------------------------------------------------------------------
-- 19. Os grants de coluna — o que NEM O ADMINISTRADOR escreve direto
-- ----------------------------------------------------------------------------
-- ⚠️ ESTA SEÇÃO É O QUE IMPEDE UM `PATCH` DE CONTORNAR O CICLO DE VIDA INTEIRO.
--
-- Sem ela, `status`, `definition` e `active_version_id` seriam colunas comuns:
-- um update pelo PostgREST publicaria uma versão sem validar, sem compilar o
-- retrato e sem substituir a anterior. As funções das seções 12 a 16 viraria
-- sugestão — e a tela nova de outro programador não saberia disso.
--
-- Com o `revoke`, elas só mudam de dentro de uma função SECURITY DEFINER, que é
-- exatamente onde as regras estão escritas.
--
-- ⚠️ E ELA COBRA UM PREÇO QUE PRECISA SER LEMBRADO: coluna nova nestas tabelas
-- precisa entrar no `grant` junto. Foi exatamente isso que `events.description`
-- esqueceu, e um Administrador com 33 de 33 permissões passou a não conseguir
-- salvar um evento. `src/test/sql-column-grants.test.ts` guarda essa porta.
revoke update on public.flows from authenticated;
grant update (name, description, channel, is_entry, updated_by, updated_at)
  on public.flows to authenticated;

revoke update on public.flow_versions from authenticated;
grant update (notes, updated_by, updated_at)
  on public.flow_versions to authenticated;

-- ⚠️ E OS VERBOS INTEIROS QUE SÓ AS FUNÇÕES PODEM USAR. A seção 18 já não
-- escreveu policy para eles; este `revoke` é a segunda tranca, e é a que
-- continua valendo se alguém um dia acrescentar um `for all` "para simplificar".
--
--   • DELETE em `flows`        → `delete_flow`, que recusa fluxo com histórico
--   • INSERT em `flow_versions`→ `create_flow_version`, que serializa o número
--                                da versão e copia o desenho
--   • DELETE em `flow_versions`→ ninguém. Versão não se apaga (§22); ela só cai
--                                por cascade quando o fluxo inteiro é excluído,
--                                e isso só acontece se nunca houve publicação.
revoke delete on public.flows from authenticated;
revoke insert, delete on public.flow_versions from authenticated;


-- ----------------------------------------------------------------------------
-- 20. As permissões novas — nas DUAS tabelas, e a segunda é a que se esquece
-- ----------------------------------------------------------------------------
-- ⚠️ SÓ O TETO NÃO BASTA. `app_role_ceilings` declara o que a RLS entrega a cada
-- PAPEL-BASE, mas quem decide o que uma pessoa vê é o CARGO dela
-- (`app_role_permissions`), semeado em 20260903000100 com uma cópia do teto
-- DAQUELE momento. Uma permissão acrescentada depois entra no teto e não entra
-- em cargo nenhum — e o resultado seria o item "Fluxos de Atendimento"
-- invisível até para o Administrador, com a RLS liberada e a tela no ar.
--
-- É a mesma seção 10 de 20260913000100_knowledge.sql, e existe um teste que
-- recusa uma migration que mexa no teto sem semear
-- (`src/test/sql-role-ceilings.test.ts`).
insert into public.app_role_ceilings (base_role, permission) values
  ('admin', 'flows.read'),
  ('admin', 'flows.write'),
  ('comercial', 'flows.read')
on conflict do nothing;

insert into public.app_role_permissions (role_key, permission)
select r.key, c.permission
from public.app_roles r
join public.app_role_ceilings c on c.base_role = r.base_role
where r.is_builtin
  and c.permission in ('flows.read', 'flows.write')
on conflict do nothing;


-- ----------------------------------------------------------------------------
-- 21. Os times iniciais (§11)
-- ----------------------------------------------------------------------------
-- Os sete do escopo. Nascem ATIVOS e sem membros: quem está em cada time é
-- decisão da APCS, e semear pessoas aqui seria inventar um organograma.
--
-- `on conflict do nothing` pela chave: rodar a migration de novo não duplica e
-- não sobrescreve um nome que a APCS já tenha ajustado.
insert into public.attendance_teams (key, name, description) values
  ('TIME_SAC', 'SAC', 'Atendimento geral ao associado.'),
  ('TIME_COMERCIAL', 'Comercial', 'Filiacao, propostas e relacionamento comercial.'),
  ('TIME_EVENTOS', 'Eventos', 'Eventos, inscricoes e palestras.'),
  ('TIME_FINANCEIRO', 'Financeiro', 'Cobranca, boletos e questoes financeiras.'),
  ('TIME_MARKETING', 'Marketing', 'Comunicacao, parcerias e materiais.'),
  ('TIME_IMPRENSA', 'Imprensa', 'Contato de veiculos e assessoria.'),
  ('TIME_ADMINISTRATIVO', 'Administrativo', 'Documentos, normativas e assuntos internos.')
on conflict (key) do nothing;


-- ============================================================================
-- A CONFERÊNCIA
-- ----------------------------------------------------------------------------
-- ⚠️ ELA CONFERE O QUE JÁ QUEBROU NESTE PROJETO: um valor de enum que não existe
-- (a trilha de usuários, 20260910000000), um privilégio de função que falta (o
-- público das enquetes, 20260912000000) e um cargo sem a permissão nova (a
-- seção 10 da Base de Conhecimento).
--
-- O que ela NÃO faz é ler `whatsapp_chats` ou `profiles`: o papel que o
-- `supabase db push` usa não tem privilégio nessas tabelas, e foi assim que
-- 20260912000000 abortou duas vezes num relatório.
-- ============================================================================
do $conferencia$
declare
  v_faltando text[] := '{}';
  v_verbo text;
begin
  -- 1. Os quinze verbos existem no enum? Sem isto, cada gatilho da seção 17 só
  --    quebraria na primeira vez que alguém salvasse — porque o PL/pgSQL
  --    planeja cada comando na primeira execução, não no `create`.
  foreach v_verbo in array array[
    'flow_created', 'flow_updated', 'flow_deleted', 'flow_activated', 'flow_deactivated',
    'flow_version_created', 'flow_version_updated', 'flow_version_tested',
    'flow_version_submitted', 'flow_version_approved', 'flow_version_published',
    'flow_version_rolled_back', 'flow_node_changed', 'flow_transition_changed',
    'flow_team_changed'
  ] loop
    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'admin_audit_action' and e.enumlabel = v_verbo
    ) then
      v_faltando := v_faltando || v_verbo;
    end if;
  end loop;

  if cardinality(v_faltando) > 0 then
    raise exception
      'admin_audit_action nao tem: %. Aplique 20260917000000_flow_enums.sql antes desta.',
      array_to_string(v_faltando, ', ');
  end if;

  -- 2. As constraints que carregam as regras existem mesmo? Um
  --    `create table if not exists` que encontra a tabela já criada NÃO
  --    acrescenta constraint nenhuma — ele simplesmente não faz nada. Numa base
  --    onde uma versão anterior desta migration tenha rodado, as tabelas
  --    existiriam sem os CHECKs, e nada avisaria.
  foreach v_verbo in array array[
    'flows_active_needs_version',
    'flow_versions_definition_shape',
    'flow_versions_published_stamp',
    'flow_nodes_end_is_not_start',
    'flow_transitions_source_fk',
    'flow_transitions_target_fk',
    'flow_runs_closed_stamp'
  ] loop
    if not exists (select 1 from pg_constraint where conname = v_verbo) then
      v_faltando := v_faltando || v_verbo;
    end if;
  end loop;

  if cardinality(v_faltando) > 0 then
    raise exception
      'Constraints ausentes: %. A tabela existe de uma versao anterior desta migration.',
      array_to_string(v_faltando, ', ');
  end if;

  -- 3. Os índices únicos parciais — as regras 2 e 3 do cabeçalho. Sem eles a
  --    "única versão publicada" seria verdade até a primeira corrida.
  foreach v_verbo in array array[
    'flow_versions_published_idx', 'flow_nodes_start_idx', 'flow_runs_open_idx',
    'flow_run_steps_idempotency_idx', 'flows_entry_idx'
  ] loop
    if not exists (select 1 from pg_class where relname = v_verbo and relkind = 'i') then
      v_faltando := v_faltando || v_verbo;
    end if;
  end loop;

  if cardinality(v_faltando) > 0 then
    raise exception 'Indices unicos ausentes: %.', array_to_string(v_faltando, ', ');
  end if;

  -- 4. `authenticated` executa o que a tela chama? A armadilha de
  --    20260912000000: a função existe, compila, e o navegador leva 42501.
  if not has_function_privilege('authenticated', 'public.publish_flow_version(uuid)', 'EXECUTE') then
    raise exception 'authenticated nao pode executar publish_flow_version — publicar devolveria 42501.';
  end if;

  if not has_function_privilege('authenticated', 'public.validate_flow_version(uuid)', 'EXECUTE') then
    raise exception 'authenticated nao pode executar validate_flow_version — a tela nao mostraria os erros.';
  end if;

  -- 5. O cargo Administrador ENXERGA o módulo? É a pergunta da seção 20, e a
  --    única cuja falha seria silenciosa: RLS liberada, tabelas criadas, tela
  --    no ar e o item de menu invisível para todo mundo.
  if not exists (
    select 1 from public.app_role_permissions
    where role_key = 'admin' and permission = 'flows.write'
  ) then
    raise exception
      'O cargo admin nao recebeu flows.write — o item Fluxos de Atendimento ficaria invisivel. Ver secao 20.';
  end if;

  raise notice 'Fluxos de Atendimento: enum, constraints, indices, privilegios e cargos conferidos.';
end;
$conferencia$;


-- ============================================================================
-- ROLLBACK (manual)
-- ----------------------------------------------------------------------------
--   drop trigger if exists on_flow_transitions_audit on public.flow_transitions;
--   drop trigger if exists on_flow_nodes_audit on public.flow_nodes;
--   drop trigger if exists on_attendance_team_members_audit on public.attendance_team_members;
--   drop trigger if exists on_attendance_teams_audit on public.attendance_teams;
--   drop trigger if exists on_flows_audit on public.flows;
--   drop function if exists public.flow_audit();
--   drop function if exists public.delete_flow(uuid);
--   drop function if exists public.set_flow_status(uuid, public.flow_status);
--   drop function if exists public.publish_flow_version(uuid);
--   drop function if exists public.advance_flow_version(uuid, public.flow_version_status);
--   drop function if exists public.create_flow_version(uuid, uuid, text);
--   drop function if exists public.compile_flow_definition(uuid);
--   drop function if exists public.validate_flow_version(uuid);
--   drop function if exists public.flow_graph_draft_only();
--   drop function if exists public.flow_touch();
--   drop function if exists public.flow_is_reader();
--   drop function if exists public.flow_is_writer();
--   drop table if exists public.flow_run_steps;
--   drop table if exists public.flow_runs;
--   drop table if exists public.flow_transitions;
--   drop table if exists public.flow_nodes;
--   alter table public.flows drop constraint if exists flows_active_version_fk;
--   drop table if exists public.flow_versions;
--   drop table if exists public.flows;
--   drop table if exists public.attendance_team_members;
--   drop table if exists public.attendance_teams;
--   delete from public.app_role_permissions where permission in ('flows.read','flows.write');
--   delete from public.app_role_ceilings where permission in ('flows.read','flows.write');
-- ============================================================================
