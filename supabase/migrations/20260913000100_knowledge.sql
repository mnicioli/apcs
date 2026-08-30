-- ============================================================================
-- BASE DE CONHECIMENTO — as respostas escritas que o chatbot pode dar
-- ============================================================================
--
-- O primeiro componente do menu INTELIGÊNCIA. Ele responde a uma pergunta que
-- nenhum módulo existente responde:
--
--     "Qual é o horário de atendimento da APCS?"
--     "Como solicitar uma palestra?"
--     "Como entrar em contato?"
--
-- ⚠️ POR QUE NÃO É UMA CATEGORIA DE `documents`. Documentos guarda ARQUIVO: um
-- PDF, com versão, vigência e bucket privado. A resposta acima não é um
-- arquivo — é um parágrafo. Enfiá-la em `documents` obrigaria `storage_path`,
-- `original_filename`, `file_size_bytes` e `mime_type` a virarem anuláveis, e
-- aí as colunas que hoje IDENTIFICAM uma versão publicada deixariam de
-- identificar coisa nenhuma. É a mesma decisão que a caixa do WhatsApp tomou ao
-- não reusar `chat_conversations` (ver 20260822000000, decisão 1).
--
-- ----------------------------------------------------------------------------
-- O QUE ESTE MÓDULO **NÃO** É
-- ----------------------------------------------------------------------------
-- ⚠️ ELE NÃO É FONTE DE CONTEÚDO OFICIAL. Bolsa, Normativas e Comunicação
-- continuam sendo a fonte da verdade delas — e as portas do chatbot para elas
-- já existem (`market-chatbot.ts`, `documents.ts::getActiveChatbotVersion`).
-- Nada aqui duplica um boletim ou uma normativa; se alguém escrever "a Bolsa de
-- hoje está em R$ X" num item de conhecimento, isso é um defeito de operação, e
-- é por isso que a tela diz, em cima do campo, que preço e normativa vêm dos
-- módulos próprios.
--
-- Este módulo é para o que NÃO tem dono em lugar nenhum: horário, endereço,
-- como funciona um processo, o que a associação faz.
--
-- ----------------------------------------------------------------------------
-- A REGRA QUE MANDA EM TUDO (§43 do escopo)
-- ----------------------------------------------------------------------------
--     ATIVO  +  DISPONÍVEL PARA CHATBOT  +  DENTRO DA VIGÊNCIA  =  ELEGÍVEL
--
-- E ela mora em UM lugar: o `where` de `search_knowledge()`. O chatbot não tem
-- outra porta para cá — não existe policy de select para `anon`, e a busca é
-- `security definer` justamente para que a regra seja executada por quem a
-- escreveu, e não remontada por quem chama.
--
-- DEPENDE DE: 20260913000000_knowledge_enums.sql, 20260830100000_admin_module.sql
--             (log_admin_action), 20260905000000_lecture_speakers.sql
--             (speaker_name_key), 20260813000000_create_events.sql (event_today)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. As categorias — um catálogo, não um enum
-- ----------------------------------------------------------------------------
-- ⚠️ TABELA, E NÃO `create type ... as enum`. Categoria de conhecimento é
-- taxonomia de NEGÓCIO: ela muda quando a APCS decide que muda, e o §5 do
-- escopo pede estrutura parametrizável, não estrutura fixa para os exemplos.
-- Um enum transformaria "quero uma categoria nova" em migration, deploy e
-- `pnpm db:types` — o que na prática significa que ninguém cria categoria e
-- todo mundo escreve tudo dentro de "Atendimento".
--
-- É o mesmo desenho de `lecture_cities` e `lecture_speakers`, e pelo mesmo
-- motivo.
create table if not exists public.knowledge_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,

  -- Minúsculas, sem acento, sem espaço nas pontas. É o que impede "Atendimento"
  -- e "atendimento" de virarem duas categorias — e, com elas, dois lugares para
  -- procurar a mesma resposta.
  --
  -- Coluna GERADA: ninguém precisa lembrar de calcular a chave, e não existe
  -- caminho de escrita que a deixe fora de sincronia com `name`.
  name_key text generated always as (public.speaker_name_key(name)) stored,

  -- Desativar tira do formulário sem mexer no que já foi escrito. Ver o §7:
  -- não há delete nesta tabela.
  active boolean not null default true,

  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),

  constraint knowledge_categories_name_len check (char_length(btrim(name)) between 2 and 60)
);

comment on table public.knowledge_categories is
  'Catalogo de categorias da Base de Conhecimento. Editavel pela tela: nao e enum de proposito.';

create unique index if not exists knowledge_categories_name_key_idx
  on public.knowledge_categories (name_key);

-- O dropdown do formulário: só as ativas, em ordem alfabética.
create index if not exists knowledge_categories_active_idx
  on public.knowledge_categories (active, name);


-- ----------------------------------------------------------------------------
-- 2. Os itens de conhecimento
-- ----------------------------------------------------------------------------
create table if not exists public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.knowledge_categories on delete restrict,

  -- Como a equipe encontra o item na lista. NÃO é o que o associado lê.
  title text not null,

  -- ⚠️ ISTO É O QUE O ASSOCIADO LÊ, PALAVRA POR PALAVRA. Não é insumo para um
  -- modelo reescrever: o §2 do escopo é que a IA interpreta e o CRM responde.
  -- O texto sai daqui para o WhatsApp sem passar por geração — é o mesmo
  -- contrato do catálogo aprovado do chat web (`csp.content.ts`).
  --
  -- 4000 caracteres é generoso para uma resposta de WhatsApp (que na prática
  -- cabe em 1000) e apertado o bastante para impedir que alguém cole um
  -- documento inteiro aqui em vez de publicá-lo em Documentos.
  content text not null,

  -- ⚠️ É O QUE FAZ O ITEM SER ENCONTRADO, e por isso o CHECK lá embaixo o
  -- torna obrigatório para quem liga o chatbot.
  --
  -- A busca compara estas palavras com a MENSAGEM da pessoa. Um item sem
  -- palavra-chave é invisível para o bot: o título "Horário de atendimento"
  -- não aparece dentro de "vocês abrem que horas?", mas a palavra "horas" sim.
  keywords text[] not null default '{}',

  status public.knowledge_status not null default 'inactive',

  -- ⚠️ INDEPENDENTE DO STATUS, e aqui este módulo DIVERGE de Documentos de
  -- propósito. Lá existe o CHECK `available_for_chatbot = (status = 'active')`,
  -- porque uma normativa publicada é, por definição, a que vale.
  --
  -- Conhecimento não é assim. "Nosso telefone é X" pode estar ATIVO como
  -- referência interna do atendimento e ainda NÃO liberado para o bot dizer
  -- sozinho — que é exatamente a distinção que o §19 do escopo pede. Um
  -- espelho aqui apagaria essa decisão.
  available_for_chatbot boolean not null default false,

  -- Vigência opcional dos dois lados (§5). Nulo = sem limite naquela ponta.
  -- Serve para o que nasce com prazo: "atendimento em horário de feira",
  -- "recesso de fim de ano".
  starts_at date,
  ends_at date,

  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),

  constraint knowledge_entries_title_len check (char_length(btrim(title)) between 3 and 160),
  constraint knowledge_entries_content_len check (char_length(btrim(content)) between 10 and 4000),
  constraint knowledge_entries_keywords_max check (cardinality(keywords) <= 20),

  -- ⚠️ A TRAVA QUE FAZ A BUSCA FUNCIONAR. Sem palavra-chave nenhuma, o item
  -- nunca seria encontrado — e o sintoma seria o pior possível: a equipe vê o
  -- item escrito, ativo e "disponível para o chatbot", e o bot responde "não
  -- encontrei". Estrutural, e não uma validação de formulário que alguém pode
  -- contornar chamando o PostgREST direto.
  constraint knowledge_entries_chatbot_needs_keywords
    check (not available_for_chatbot or cardinality(keywords) >= 1),

  -- Uma janela que termina antes de começar não é um erro de digitação
  -- inofensivo: é um item que nunca vai aparecer, e ninguém descobre por quê.
  constraint knowledge_entries_window
    check (starts_at is null or ends_at is null or ends_at >= starts_at)
);

comment on table public.knowledge_entries is
  'Respostas escritas da APCS. O conteudo sai daqui para o associado sem passar por geracao de texto.';

comment on column public.knowledge_entries.content is
  'O texto EXATO que o associado le. Nao e insumo para o modelo reescrever.';

comment on column public.knowledge_entries.available_for_chatbot is
  'Liberado para o bot responder sozinho. Independente do status de proposito — ver o comentario na coluna.';

-- Dois itens com o mesmo título dentro da mesma categoria são a mesma pergunta
-- escrita duas vezes: a segunda versão nunca é encontrada, porque a busca já
-- devolveu a primeira. `title_key` normaliza caixa e acento pelo mesmo motivo
-- que `knowledge_categories`.
create unique index if not exists knowledge_entries_category_title_idx
  on public.knowledge_entries (category_id, public.speaker_name_key(title));

-- A grid: por categoria, alfabético.
create index if not exists knowledge_entries_category_idx
  on public.knowledge_entries (category_id, title);

-- ⚠️ ÍNDICE PARCIAL, e é o índice da BUSCA DO BOT. Ele indexa só as linhas que
-- o chatbot pode considerar — que são a minoria — em vez de varrer a tabela
-- inteira a cada mensagem recebida.
create index if not exists knowledge_entries_chatbot_idx
  on public.knowledge_entries (status, available_for_chatbot)
  where status = 'active' and available_for_chatbot;


-- ----------------------------------------------------------------------------
-- 3. Row Level Security
-- ----------------------------------------------------------------------------
-- Espelha PERMISSION_MATRIX em src/lib/rbac/rbac.config.ts:
--   knowledge.read  → admin, comercial   (Administrador, Atendente)
--   knowledge.write → admin              (Administrador)
--
-- ⚠️ 'ceo' APARECE E ESTÁ INERTE. Nenhuma linha de `profiles` pode ter esse
-- papel desde 20260902000000_retire_roles.sql — o CHECK de lá é a tranca. Ele
-- continua escrito aqui pela mesma razão das outras 122 referências: manter o
-- padrão para quem lê, sem uma exceção que faça alguém procurar o motivo.
--
-- ⚠️ NENHUMA POLICY PARA `anon`. O chatbot é anônimo e NÃO lê estas tabelas
-- direto: ele entra por `search_knowledge()`, que é `security definer` e aplica
-- a regra do §43 por conta própria. A superfície pública do banco continua
-- sendo zero, como em todo o resto do projeto.
alter table public.knowledge_categories enable row level security;
alter table public.knowledge_entries enable row level security;

create policy "knowledge_categories_select"
  on public.knowledge_categories for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

create policy "knowledge_categories_insert"
  on public.knowledge_categories for insert
  with check (
    public.current_app_role() in ('admin', 'ceo')
    and created_by = auth.uid()
  );

create policy "knowledge_categories_update"
  on public.knowledge_categories for update
  using (public.current_app_role() in ('admin', 'ceo'))
  with check (public.current_app_role() in ('admin', 'ceo'));

create policy "knowledge_entries_select"
  on public.knowledge_entries for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

create policy "knowledge_entries_insert"
  on public.knowledge_entries for insert
  with check (
    public.current_app_role() in ('admin', 'ceo')
    and created_by = auth.uid()
  );

create policy "knowledge_entries_update"
  on public.knowledge_entries for update
  using (public.current_app_role() in ('admin', 'ceo'))
  with check (public.current_app_role() in ('admin', 'ceo'));


-- ----------------------------------------------------------------------------
-- 4. Grants de coluna — a RLS filtra LINHA, não COLUNA
-- ----------------------------------------------------------------------------
-- Sem isto, quem tem `knowledge.write` e chama o PostgREST com o próprio JWT
-- reescreveria `created_by` e `created_at` — a policy de update deixaria
-- passar, porque ela olha o papel, não a coluna. A autoria de quem escreveu uma
-- resposta que a associação dá em nome dela não é campo de formulário.
--
-- `updated_by` e `updated_at` também ficam de fora: quem os carimba é o gatilho
-- da seção 5, que roda como dono da função. Privilégio de coluna vale para as
-- colunas nomeadas no UPDATE, não para o que um gatilho altera depois.
revoke update on public.knowledge_entries from authenticated;
grant update (
  category_id,
  title,
  content,
  keywords,
  status,
  available_for_chatbot,
  starts_at,
  ends_at
) on public.knowledge_entries to authenticated;

revoke update on public.knowledge_categories from authenticated;
grant update (active) on public.knowledge_categories to authenticated;

-- ⚠️ NADA É APAGADO, e é a mesma decisão de Documentos, Eventos, Palestras e
-- Enquetes: a trilha de auditoria aponta para a linha, e uma trilha que aponta
-- para o vazio não audita nada. Item errado vira `status = 'inactive'`;
-- categoria errada vira `active = false`. Some da tela, continua no histórico.
revoke delete on public.knowledge_entries from authenticated, anon;
revoke delete on public.knowledge_categories from authenticated, anon;


-- ----------------------------------------------------------------------------
-- 5. Carimbos automáticos
-- ----------------------------------------------------------------------------
create trigger on_knowledge_entries_updated
  before update on public.knowledge_entries
  for each row execute procedure public.handle_updated_at();

-- `updated_by` precisa de função própria: `handle_updated_at` é compartilhada
-- por sete módulos e não sabe (nem deve saber) que esta tabela tem autoria de
-- edição.
-- ⚠️ INVOKER (o padrão), E ISSO BASTA MESMO COM O GRANT DA SEÇÃO 4 NÃO
-- INCLUINDO `updated_by`. O Postgres confere privilégio de coluna contra o que
-- o UPDATE nomeia no `set`, não contra o que um gatilho BEFORE altera depois —
-- é exatamente por isso que `handle_updated_at`, que é INVOKER e compartilhada,
-- funciona em tabelas com grant de coluna desde a migration inicial.
--
-- O efeito combinado é o que se queria: ninguém escreve `updated_by` de fora, e
-- ele nunca fica em branco.
create or replace function public.knowledge_stamp_editor()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_by := (select auth.uid());
  return new;
end;
$fn$;

comment on function public.knowledge_stamp_editor() is
  'Carimba quem editou o item. O grant de coluna nao concede updated_by a ninguem — so este gatilho escreve.';

create trigger on_knowledge_entries_editor
  before update on public.knowledge_entries
  for each row execute procedure public.knowledge_stamp_editor();


-- ----------------------------------------------------------------------------
-- 6. A trilha de auditoria — por GATILHO, não por chamada
-- ----------------------------------------------------------------------------
-- ⚠️ ISTO É UMA DECISÃO, E O CONTRÁRIO É O PADRÃO DO RESTO DO PROJETO. Em
-- Administração, cada função de escrita chama `log_admin_action` no fim
-- (`set_user_role`, `set_app_setting`, ...). Aqui não há função de escrita: a
-- tela grava pelo PostgREST, com RLS e grants de coluna fazendo a segurança.
--
-- Restavam duas saídas. Criar RPCs só para ter onde chamar a auditoria — três
-- funções, cem linhas, e uma camada a mais entre a tela e a tabela para não
-- fazer mais nada. Ou pendurar a auditoria no GATILHO, que é onde ela não pode
-- ser esquecida: não existe caminho de escrita — tela, script, psql, correção
-- manual — que grave sem passar por aqui.
--
-- A segunda ganha, e ganha pelo motivo de sempre neste projeto: uma garantia
-- que sai da FORMA do dado não depende de ninguém lembrar de invocá-la.
--
-- `security definer` porque `log_admin_action` é revogada de `authenticated`
-- (20260830100000, linha 118) — a trilha da Administração não se escreve de
-- fora. O gatilho roda como dono e pode; quem clicou, não.
create or replace function public.knowledge_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_action public.admin_audit_action;
  v_categoria text;
begin
  select c.name into v_categoria
  from public.knowledge_categories c
  where c.id = new.category_id;

  if tg_op = 'INSERT' then
    v_action := 'knowledge_created';
  elsif new.status is distinct from old.status then
    -- ⚠️ O VERBO DE STATUS GANHA DE `knowledge_updated` quando os dois
    -- acontecem no mesmo UPDATE. Quem lê a trilha pergunta "desde quando o bot
    -- passou a dizer isso?" — e a resposta não pode estar escondida atrás de
    -- uma linha que diz apenas "editado".
    v_action := case
      when new.status = 'active' then 'knowledge_activated'
      else 'knowledge_deactivated'
    end;
  else
    v_action := 'knowledge_updated';
  end if;

  perform public.log_admin_action(
    v_action,
    new.title,
    jsonb_build_object(
      'entryId', new.id,
      'categoria', coalesce(v_categoria, '(sem categoria)'),
      'status', new.status,
      'disponivelParaChatbot', new.available_for_chatbot
    )
  );

  return null;
end;
$fn$;

comment on function public.knowledge_audit() is
  'Escreve a trilha da Base de Conhecimento. Gatilho, e nao chamada: nao existe caminho de escrita que escape.';

create trigger on_knowledge_entries_audit
  after insert or update on public.knowledge_entries
  for each row execute procedure public.knowledge_audit();


-- ----------------------------------------------------------------------------
-- 7. A PORTA DO CHATBOT — a única
-- ----------------------------------------------------------------------------
-- ⚠️ `security definer`, E ISSO PRECISA DE JUSTIFICATIVA. A regra deste projeto
-- é que INVOKER é o padrão: quem não pode ler a tabela não descobre o conteúdo
-- dela por uma função (foi por isso que `resolve_audience_criteria` recusou
-- virar DEFINER em 20260912000000).
--
-- Aqui a decisão é a oposta, e o motivo é o consumidor: o chatbot é ANÔNIMO.
-- Não há `auth.uid()`, não há papel, e `knowledge_entries` não tem — nem vai
-- ter — policy de select para `anon`. Uma função INVOKER devolveria zero linhas
-- para quem ela existe para atender.
--
-- O que ela expõe é exatamente o que a APCS decidiu publicar: linhas ATIVAS,
-- marcadas como disponíveis para o chatbot e dentro da vigência. Nada mais
-- atravessa — não há parâmetro que relaxe o filtro, e é por isso que ele está
-- no corpo da função e não numa cláusula que o chamador monta.
--
-- ⚠️ E É AQUI QUE O §43 MORA, EM UM LUGAR SÓ. Se um dia a regra mudar, muda
-- aqui. O badge da tela é uma LEITURA dessa regra (knowledge.rules.ts), não uma
-- segunda implementação dela — a mesma divisão que `document.rules.ts` já
-- documenta: negócio no banco, exibição no TypeScript.
create or replace function public.search_knowledge(
  p_query text,
  p_limit integer default 3
)
returns table (
  id uuid,
  title text,
  content text,
  category text,
  score integer
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with pergunta as (
    select
      public.speaker_name_key(coalesce(p_query, '')) as texto,
      public.event_today() as hoje
  )
  select
    e.id,
    e.title,
    e.content,
    c.name as category,
    -- ⚠️ A PALAVRA-CHAVE VALE MAIS QUE O TÍTULO, E MUITO MAIS QUE O CORPO, e a
    -- razão é o formato da pergunta real. Ninguém escreve "Horário de
    -- atendimento" no WhatsApp; escreve "vocês abrem que horas?". O título
    -- quase nunca aparece dentro da mensagem — a palavra-chave é o que aparece.
    (
      case when exists (
        select 1 from unnest(e.keywords) k
        where length(btrim(k)) > 0
          and position(public.speaker_name_key(k) in p.texto) > 0
      ) then 3 else 0 end
      +
      case when position(public.speaker_name_key(e.title) in p.texto) > 0
        then 2 else 0 end
      +
      -- Só pega quando a pergunta é curta e literal ("horário de atendimento").
      -- Vale o pouco que custa: é o caso de quem digita o assunto, não a frase.
      case when length(p.texto) >= 4
             and position(p.texto in public.speaker_name_key(e.content)) > 0
        then 1 else 0 end
    ) as score
  from public.knowledge_entries e
  join public.knowledge_categories c on c.id = e.category_id
  cross join pergunta p
  where e.status = 'active'
    and e.available_for_chatbot
    and (e.starts_at is null or e.starts_at <= p.hoje)
    and (e.ends_at is null or e.ends_at >= p.hoje)
    and (
      exists (
        select 1 from unnest(e.keywords) k
        where length(btrim(k)) > 0
          and position(public.speaker_name_key(k) in p.texto) > 0
      )
      or position(public.speaker_name_key(e.title) in p.texto) > 0
      or (length(p.texto) >= 4
          and position(p.texto in public.speaker_name_key(e.content)) > 0)
    )
  order by score desc, e.title
  limit greatest(1, least(coalesce(p_limit, 3), 10));
$fn$;

comment on function public.search_knowledge(text, integer) is
  'A unica porta do chatbot para a Base de Conhecimento. Impoe ATIVO + disponivel + vigencia (§43 do escopo).';

-- ⚠️ SEM `grant ... to anon`. O chat público entra pelo servidor Next com o
-- cliente `service_role`, exatamente como Palestras e Enquetes já fazem — a
-- superfície pública do banco continua sendo zero. `authenticated` recebe
-- porque a tela do CRM oferece um "testar o que o bot encontraria".
revoke execute on function public.search_knowledge(text, integer) from public, anon;
grant execute on function public.search_knowledge(text, integer) to authenticated;


-- ----------------------------------------------------------------------------
-- 8. As mensagens do chatbot (§7 e §8) — configuração, não código
-- ----------------------------------------------------------------------------
-- Entram em `app_settings`, que já existe, já tem RLS, já tem `set_app_setting`
-- com auditoria e já tem tela. Uma tabela nova de "configurações do chatbot"
-- seria uma segunda verdade sobre a mesma coisa.
--
-- ⚠️ ESTES SÃO OS VALORES DE PARTIDA, NÃO O TEXTO FINAL. Eles existem para o
-- sistema nunca ficar sem resposta — `SETTING_FALLBACKS` no TypeScript repete
-- os mesmos, para o caso de a linha ser apagada. Quem escreve a versão que vai
-- ao ar é a APCS, na tela de Configurações.
--
-- `on conflict do nothing`: rodar a migration de novo não desfaz o que a
-- associação escreveu.
insert into public.app_settings (key, value) values
  (
    'chatbot.welcome',
    'Olá! 👋 Sou o assistente virtual da APCS.' || chr(10) || chr(10) ||
    'Posso ajudar com Bolsa de Suínos, normativas, comunicados, eventos e palestras. O que você precisa?'
  ),
  (
    'chatbot.fallback',
    'Não consegui entender sua solicitação. Posso ajudar com informações sobre Bolsa, Normativas, Comunicação, Eventos ou Palestras.' || chr(10) || chr(10) ||
    'Se preferir, posso encaminhar você para um atendente.'
  ),
  (
    'chatbot.no_result',
    'No momento, não encontramos uma publicação disponível para consulta. Posso encaminhar você para um atendente?'
  ),
  (
    'chatbot.error',
    'Não consegui consultar essa informação agora. Posso encaminhar você para um atendente?'
  ),
  (
    'chatbot.human_handoff',
    'Certo! Já avisei a equipe da APCS. Alguém vai falar com você por aqui mesmo, no horário de atendimento.'
  )
on conflict (key) do nothing;


-- ----------------------------------------------------------------------------
-- 9. Categorias de partida
-- ----------------------------------------------------------------------------
-- Tiradas dos exemplos do próprio escopo (§4). Não são fixas: a tela cria,
-- renomeia não, desativa sim. Existem para o primeiro item de conhecimento não
-- começar com um dropdown vazio.
insert into public.knowledge_categories (name)
select v.name
from (values
  ('Atendimento'),
  ('Institucional'),
  ('Serviços'),
  ('Associação')
) as v(name)
where not exists (
  select 1 from public.knowledge_categories c
  where c.name_key = public.speaker_name_key(v.name)
);


-- ----------------------------------------------------------------------------
-- 10. As permissões novas — nas DUAS tabelas, e a segunda é a que se esquece
-- ----------------------------------------------------------------------------
-- ⚠️ SÓ O TETO NÃO BASTA, E ESSE É O ERRO QUE ESTA SEÇÃO EXISTE PARA EVITAR.
--
-- `app_role_ceilings` declara o que a RLS entrega a cada PAPEL-BASE. Mas quem
-- decide o que uma pessoa vê é o CARGO dela (`app_role_permissions`), e os
-- cargos embutidos foram semeados em 20260903000100 com uma cópia do teto
-- DAQUELE momento. Uma permissão acrescentada depois entra no teto e não entra
-- em cargo nenhum — e o resultado seria o menu Inteligência invisível até para
-- o Administrador, com a RLS liberada e ninguém conseguindo chegar na tela.
--
-- ⚠️ SÓ OS EMBUTIDOS RECEBEM. Um cargo que a APCS criou é uma restrição
-- deliberada — alguém sentou e decidiu o que aquele cargo abre. Alargá-lo
-- sozinho por causa de um módulo novo desfaria essa decisão sem avisar. Quem
-- quiser dar a Base de Conhecimento a um cargo próprio marca a caixa em
-- /permissions, que é onde essa decisão mora.
insert into public.app_role_ceilings (base_role, permission) values
  ('admin', 'knowledge.read'),
  ('admin', 'knowledge.write'),
  ('comercial', 'knowledge.read')
on conflict do nothing;

insert into public.app_role_permissions (role_key, permission)
select r.key, c.permission
from public.app_roles r
join public.app_role_ceilings c on c.base_role = r.base_role
where r.is_builtin
  and c.permission in ('knowledge.read', 'knowledge.write')
on conflict do nothing;


-- ============================================================================
-- A CONFERÊNCIA
-- ----------------------------------------------------------------------------
-- ⚠️ O QUE ELA **NÃO** FAZ: trocar de papel. Duas tentativas de fazer isso numa
-- migration falharam em 20260912000000 — `set local role` dentro de PL/pgSQL
-- não volta, e em primeiro nível o `supabase db push` roda em AUTOCOMMIT, onde
-- o Postgres avisa `25P01` e IGNORA o comando. O que sobrou lá, e vale aqui: a
-- migration pergunta ao CATÁLOGO, e quem testa execução com o papel certo é o
-- CI (`src/test/sql-*.test.ts`).
--
-- O que ela confere é o que já causou defeito neste projeto: um valor de enum
-- que não existe (a trilha de usuários, 20260910000000) e um privilégio de
-- função que falta (o público das enquetes, 20260912000000).
-- ============================================================================
do $conferencia$
declare
  v_faltando text[] := '{}';
  v_verbo text;
begin
  -- 1. Os quatro verbos existem no enum? Sem isto, o gatilho da seção 6 só
  --    quebraria na primeira vez que alguém salvasse um item — porque o
  --    PL/pgSQL planeja cada comando na primeira execução, não no `create`.
  foreach v_verbo in array array[
    'knowledge_created', 'knowledge_updated',
    'knowledge_activated', 'knowledge_deactivated'
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
      'admin_audit_action nao tem: %. Aplique 20260913000000_knowledge_enums.sql antes desta.',
      array_to_string(v_faltando, ', ');
  end if;

  -- 2. `authenticated` executa a busca e as auxiliares que ela usa? A função é
  --    DEFINER, então as auxiliares rodam como dono — mas CHAMAR exige EXECUTE
  --    na própria função chamada, que foi exatamente a armadilha de
  --    20260912000000.
  if not has_function_privilege('authenticated', 'public.search_knowledge(text, integer)', 'EXECUTE') then
    raise exception 'authenticated nao pode executar search_knowledge — a tela de teste devolveria 42501.';
  end if;

  -- 3. O cargo Administrador ENXERGA o módulo? É a pergunta da seção 10, e a
  --    única cuja falha seria silenciosa: RLS liberada, tabela criada, tela no
  --    ar e o item de menu invisível para todo mundo.
  if not exists (
    select 1 from public.app_role_permissions
    where role_key = 'admin' and permission = 'knowledge.write'
  ) then
    raise exception
      'O cargo admin nao recebeu knowledge.write — o menu Inteligencia ficaria invisivel. Ver secao 10.';
  end if;

  raise notice 'Base de Conhecimento: enum, privilegios, cargos e estrutura conferidos.';
end;
$conferencia$;


-- ============================================================================
-- ROLLBACK (manual)
-- ----------------------------------------------------------------------------
--   drop trigger if exists on_knowledge_entries_audit on public.knowledge_entries;
--   drop trigger if exists on_knowledge_entries_editor on public.knowledge_entries;
--   drop trigger if exists on_knowledge_entries_updated on public.knowledge_entries;
--   drop function if exists public.search_knowledge(text, integer);
--   drop function if exists public.knowledge_audit();
--   drop function if exists public.knowledge_stamp_editor();
--   drop table if exists public.knowledge_entries;
--   drop table if exists public.knowledge_categories;
--   delete from public.app_settings where key like 'chatbot.%';
--   -- (a trilha ja gravada em admin_audit_logs permanece, e deve mesmo)
-- ============================================================================
