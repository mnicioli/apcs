-- ============================================================================
-- Landing Pages e Inscrições — a fundação
-- ----------------------------------------------------------------------------
-- Substitui a planilha de Excel em que hoje se controla quem vai a um evento.
--
--     EVENTO ──1:1── LANDING PAGE ──1:N── INSCRIÇÃO ──1:N── PARTICIPANTE
--
-- A INSCRIÇÃO é da GRANJA/EMPRESA, não da pessoa. Uma granja com quatro
-- funcionários é UMA inscrição com quatro participantes — e não quatro
-- inscrições. É a diferença que o escopo abre pedindo, e ela está no desenho:
-- `company_name` mora na inscrição, e não se repete em participante nenhum.
--
-- ----------------------------------------------------------------------------
-- ⚠️ DECISÃO 1 — O ENCERRAMENTO É DERIVADO, NÃO GRAVADO.
-- ----------------------------------------------------------------------------
-- `status` guarda só a decisão humana (rascunho/publicada/encerrada/inativa).
-- "Encerrou porque a data passou" e "encerrou porque lotou" nunca são escritos:
-- são calculados na leitura, comparando `closes_at` com agora e a contagem de
-- participantes com `max_participants`.
--
-- É o MESMO desenho da expiração de eventos (20260813000000), pelos mesmos três
-- motivos: o projeto não tem cron, uma rotina que não roda falha em silêncio
-- (e o formulário continuaria aceitando inscrição depois do prazo), e a
-- derivação só sabe REBAIXAR — uma landing tirada do ar à mão nunca volta ao ar
-- pela passagem do tempo.
--
-- ⚠️ O QUE ISSO EXIGE EM TROCA: a regra tem de valer de verdade na ESCRITA.
-- `create_event_registration` recusa fora do prazo e acima da capacidade, sob
-- lock. Derivação é para LER; a barreira é para ESCREVER. Se um dia as duas
-- discordarem, quem manda é o banco.
--
-- ----------------------------------------------------------------------------
-- ⚠️ DECISÃO 2 — A CAPACIDADE É CONTADA EM PARTICIPANTES, SOB LOCK.
-- ----------------------------------------------------------------------------
-- O §14 é explícito: capacidade 100 com inscrições de 5, 3 e 10 são 18 pessoas,
-- não 3. E o §15 pede que duas inscrições simultâneas não estourem o limite
-- juntas.
--
-- Um `select count(*)` seguido de `insert` perde essa corrida sempre: as duas
-- transações leem 95, as duas concluem que cabem 5, e o evento fecha com 105
-- pessoas. Por isso `create_event_registration` toma um lock consultivo pela
-- LANDING PAGE antes de contar — as duas se enfileiram, a segunda lê 100 e é
-- recusada. Lock consultivo, e não `select ... for update`, pelo mesmo motivo
-- de `lock_event`: em tabela com RLS o `for update` exige privilégio de UPDATE,
-- que quem se inscreve não tem.
--
-- ----------------------------------------------------------------------------
-- ⚠️ DECISÃO 3 — `event_id` É COPIADO PARA `event_participants`, E ISSO NÃO É
-- DESNORMALIZAÇÃO POR DESCUIDO.
-- ----------------------------------------------------------------------------
-- O §12 exige `EVENTO + E-MAIL` único, com proteção no BANCO (não só no código)
-- para não perder a corrida entre dois envios simultâneos. Um índice único não
-- atravessa join: para o Postgres impor a regra, as duas colunas precisam estar
-- na mesma linha.
--
-- O que impede a cópia de virar mentira é a FK COMPOSTA
-- `(registration_id, event_id)` apontando para `event_registrations (id, event_id)`:
-- gravar um participante com o evento errado é impossível, não improvável.
--
-- ----------------------------------------------------------------------------
-- ⚠️ DECISÃO 4 — NADA SE APAGA.
-- ----------------------------------------------------------------------------
-- O §13 proíbe exclusão física de inscrição e participante. Este projeto não
-- tem soft delete em módulo nenhum — o controle é sempre uma SITUAÇÃO (ver o
-- comentário de Palestras sobre por que não há `deleted_at`). Aqui é
-- `event_registrations.status = 'cancelled'`, e o DELETE é revogado no banco.
--
-- ----------------------------------------------------------------------------
-- ⚠️ DECISÃO 5 — A IDENTIDADE VISUAL NÃO TEM COLUNA, E A AUSÊNCIA É O §19.
-- ----------------------------------------------------------------------------
-- O escopo pede que a Landing Page pertença ao contexto institucional
-- APCS + CSPI e que o usuário NÃO possa trocar logo, cores ou identidade. A
-- forma mais confiável de garantir isso é não existir onde guardar: não há
-- `logo_url`, não há `primary_color`, não há `theme`. O que a Landing configura
-- é o CONTEÚDO (imagem do evento, descrição, campos, mensagem de sucesso).
--
-- Códigos de erro desta migration, mapeados em src/lib/actions/errors.ts:
--   LP001  a landing não está aceitando inscrição (rascunho/encerrada/inativa)
--   LP002  transição de situação não permitida
--   LP003  o slug já está em uso
--   LP004  configuração de campos inválida
--   LP005  este evento já tem uma Landing Page
--   RG001  prazo de inscrição encerrado
--   RG002  capacidade esgotada
--   RG003  e-mail já inscrito neste evento
--   RG004  e-mail repetido dentro da própria inscrição
--   RG005  participante sem telefone nem WhatsApp
--   RG006  inscrição sem participante
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Landing Page
-- ----------------------------------------------------------------------------
create table public.event_landing_pages (
  id uuid primary key default gen_random_uuid(),

  -- ⚠️ `unique` É O §3 INTEIRO: "um evento possui no máximo uma Landing Page".
  -- Escrito como constraint, e não como checagem na aplicação, porque duas abas
  -- abertas na tela de criação empatariam a checagem e criariam as duas.
  --
  -- `cascade`: a Landing Page não tem vida própria — ela é a fachada do evento.
  -- (Evento não se apaga: o DELETE é revogado em `events`. O cascade existe
  -- para o rollback do banco, não para o dia a dia.)
  event_id uuid not null unique references public.events on delete cascade,

  status public.event_landing_page_status not null default 'draft',

  -- A URL pública: /eventos/<slug>. Único no catálogo inteiro, e não por
  -- evento — dois eventos com o mesmo slug seriam dois endereços iguais.
  slug text not null unique,

  -- ⚠️ A IMAGEM É OPCIONAL AQUI, e é a única do módulo Eventos que é. O evento
  -- já tem cartaz obrigatório (`events.image_path`); esta serve para quando a
  -- página quiser uma arte diferente da que vai para o WhatsApp. Nulo = usa a
  -- do evento. As três colunas andam juntas — ver o CHECK abaixo.
  image_path text unique,
  image_mime text,
  image_size_bytes integer,

  -- Texto da página. Separado de `events.description` de propósito: aquela é a
  -- legenda que vai no WhatsApp, com teto de 600 caracteres por causa da
  -- imagem; esta é o texto de uma página, que pode ser bem maior.
  description text,

  -- ⚠️ A ORDEM DOS CAMPOS DO FORMULÁRIO, e é um ARRAY porque a ordem é o dado.
  -- O Builder do Prompt 2 vai arrastar e soltar isto. O default é a ordem
  -- exigida pelo §7.
  --
  -- Um jsonb, e não uma tabela de campos, porque nesta versão o conjunto é
  -- FECHADO (§7: "Não implementar ainda campos customizados"). O dia em que
  -- campos livres entrarem, cada item vira um objeto em vez de uma string — sem
  -- migração de tabela e sem mudar nenhuma FK.
  form_fields jsonb not null default
    '["GRANJA_EMPRESA", "EMAIL", "NOME_PARTICIPANTE", "TELEFONE", "WHATSAPP"]'::jsonb,

  -- A mensagem de sucesso. NULO significa "usa o texto padrão da plataforma",
  -- que mora em `app_settings` (§18) — ver a seção 9. Não há texto embutido em
  -- service nem em controller.
  success_title text,
  success_message text,
  success_footer text,

  -- ⚠️ `timestamptz`, e não `date` + `time` como em `events`. Ali a separação
  -- existe porque um evento é "dia 20, às 14h" no calendário da APCS, e não um
  -- instante. Aqui é o contrário: "as inscrições fecham" É um instante, e ele é
  -- comparado com `now()` para decidir se um envio entra ou não.
  closes_at timestamptz,

  -- Nulo = sem limite (§14).
  max_participants integer,

  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references public.profiles on delete set null,

  -- O mesmo formato do slug de `event_segments`, e o mesmo CHECK: minúsculas,
  -- dígitos e hífen simples. É o que torna o valor seguro num caminho de URL.
  constraint event_landing_pages_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint event_landing_pages_slug_len check (char_length(slug) between 3 and 120),

  constraint event_landing_pages_description_len
    check (description is null or char_length(description) <= 4000),

  constraint event_landing_pages_success_title_len
    check (success_title is null or char_length(success_title) between 2 and 160),
  constraint event_landing_pages_success_message_len
    check (success_message is null or char_length(success_message) between 2 and 1000),
  constraint event_landing_pages_success_footer_len
    check (success_footer is null or char_length(success_footer) between 2 and 300),

  -- Capacidade zero seria uma página publicada que recusa todo mundo. Quem quer
  -- isso encerra a página, que é a operação que diz o que está acontecendo.
  constraint event_landing_pages_capacity
    check (max_participants is null or max_participants > 0),

  -- As três colunas de imagem andam juntas ou nenhuma vem. Meia imagem — um
  -- caminho sem MIME — é o estado que faria a página tentar exibir um arquivo
  -- que ninguém sabe ler.
  constraint event_landing_pages_image_shape
    check (
      (image_path is null and image_mime is null and image_size_bytes is null)
      or (image_path is not null and image_mime is not null and image_size_bytes is not null)
    ),
  constraint event_landing_pages_image_mime
    check (image_mime is null or image_mime in ('image/jpeg', 'image/png', 'image/webp')),
  constraint event_landing_pages_image_size
    check (image_size_bytes is null or (image_size_bytes > 0 and image_size_bytes <= 5242880)),

  -- `form_fields` é uma LISTA. O conteúdo dela é conferido por
  -- `assert_event_landing_fields`, que sabe quais chaves existem; o CHECK
  -- garante só a forma, que é o que uma constraint consegue garantir barato.
  constraint event_landing_pages_fields_shape
    check (
      jsonb_typeof(form_fields) = 'array'
      and jsonb_array_length(form_fields) between 1 and 20
    ),

  -- Publicada e sem carimbo de publicação seria um histórico que não sabe
  -- quando a página foi ao ar. Espelha `flow_versions_published_stamp`.
  --
  -- ⚠️ A DIREÇÃO É SÓ UMA: publicada exige carimbo. O contrário não vale —
  -- uma página encerrada ou tirada do ar CONSERVA o `published_at` de quando
  -- esteve no ar, que é justamente o que se quer saber depois.
  constraint event_landing_pages_published_stamp
    check (status <> 'published' or published_at is not null),

  -- A chave composta que a FK de `event_registrations` usa para garantir que a
  -- landing de uma inscrição pertence ao evento daquela inscrição. Mesmo
  -- desenho de `flow_versions_identity`.
  constraint event_landing_pages_identity unique (id, event_id)
);

comment on table public.event_landing_pages is
  'A pagina publica de inscricao de um evento. Uma por evento. "Encerrada por data/lotacao" e derivado, nunca gravado.';

comment on column public.event_landing_pages.status is
  'Decisao HUMANA apenas. Encerramento por prazo ou lotacao e derivado na leitura — ver o cabecalho da migration.';

comment on column public.event_landing_pages.form_fields is
  'Ordem dos campos do formulario. Array de chaves; o Builder do Prompt 2 reordena. Conteudo validado por assert_event_landing_fields.';

comment on column public.event_landing_pages.max_participants is
  'Teto de PARTICIPANTES (nao de inscricoes). Nulo = sem limite.';

-- A consulta da grid do backoffice: as páginas por situação, mais recentes
-- primeiro. `event_id` já tem índice pelo `unique`.
create index event_landing_pages_status_idx
  on public.event_landing_pages (status, created_at desc);

-- ⚠️ SEM ÍNDICE SEPARADO PARA `slug`: o `unique` da coluna já cria um, e é por
-- ele que a página pública do Prompt 3 vai buscar. Um segundo seria o mesmo
-- índice pago duas vezes.


-- ----------------------------------------------------------------------------
-- 2. Inscrição — a linha da GRANJA/EMPRESA
-- ----------------------------------------------------------------------------
create table public.event_registrations (
  id uuid primary key default gen_random_uuid(),

  -- ⚠️ `restrict` NAS DUAS FKs, e é a decisão 4 escrita para o Postgres. Uma
  -- inscrição é o registro de que uma granja disse que vem; ela não pode sumir
  -- porque alguém mexeu no evento ou na página.
  event_id uuid not null references public.events on delete restrict,
  landing_page_id uuid not null references public.event_landing_pages on delete restrict,

  -- A granja/empresa. UMA VEZ POR INSCRIÇÃO — o §10 é explícito em não repetir
  -- isto em cada participante.
  company_name text not null,

  status public.event_registration_status not null default 'active',
  origin public.event_registration_origin not null default 'landing_page',

  registered_at timestamptz not null default now(),

  -- ⚠️ IDEMPOTÊNCIA (§27). Mesma chave, mesma inscrição — o duplo clique, o F5 e
  -- o retry de rede recebem a inscrição que já existe em vez de criar a segunda.
  -- O `on conflict (dedupe_key) do nothing` de `create_event_registration` faz
  -- isso ATOMICAMENTE; um "consulta, e se não achar insere" perderia a corrida.
  -- Mesmo desenho de `membership_applications.dedupe_key`.
  dedupe_key text not null unique,

  -- LGPD: hash, nunca o IP. Serve ao limite de taxa do formulário público
  -- (Prompt 3) e a nada mais — o mesmo que `membership_applications`.
  source_ip_hash text,
  user_agent text,

  -- Nulos quando a inscrição vem da página PÚBLICA: ali não há usuário. É o
  -- `origin` que diz qual dos dois casos é.
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),

  constraint event_registrations_company_len
    check (char_length(btrim(company_name)) between 2 and 200),
  constraint event_registrations_user_agent_len
    check (user_agent is null or char_length(user_agent) <= 400),

  -- A FK COMPOSTA da decisão 3: a landing desta inscrição pertence ao evento
  -- desta inscrição. Sem ela, `event_id` seria uma cópia que alguém pode
  -- contradizer.
  constraint event_registrations_landing_matches_event
    foreign key (landing_page_id, event_id)
    references public.event_landing_pages (id, event_id) on delete restrict,

  -- A chave composta que `event_participants` usa. Mesmo motivo de cima.
  constraint event_registrations_identity unique (id, event_id)
);

comment on table public.event_registrations is
  'Inscricao de uma granja/empresa num evento. Uma inscricao, N participantes. Nunca se apaga: cancela-se.';

comment on column public.event_registrations.dedupe_key is
  'Chave de idempotencia. Mesma chave devolve a inscricao existente em vez de criar a segunda.';

-- A consulta da tela de Inscrições (§23): as de um evento, mais recentes
-- primeiro. Composto porque o filtro por evento vem sempre junto da ordenação.
create index event_registrations_event_idx
  on public.event_registrations (event_id, registered_at desc);

create index event_registrations_landing_idx
  on public.event_registrations (landing_page_id, registered_at desc);

-- Busca por granja/empresa (§23). Sem `gin_trgm_ops`: exigiria a extensão
-- `pg_trgm`, que o projeto não usa em lugar nenhum. Um btree comum já serve ao
-- prefixo e à ordenação alfabética, que é o que a tela faz.
create index event_registrations_company_idx
  on public.event_registrations (event_id, company_name);


-- ----------------------------------------------------------------------------
-- 3. Participante
-- ----------------------------------------------------------------------------
create table public.event_participants (
  id uuid primary key default gen_random_uuid(),

  registration_id uuid not null references public.event_registrations on delete cascade,

  -- A cópia da decisão 3, guardada pela FK composta logo abaixo.
  event_id uuid not null,

  full_name text not null,
  -- ⚠️ GUARDADO EM MINÚSCULAS, sempre. `create_event_registration` normaliza
  -- antes de gravar, e o índice único conta com isso: "Joao@x.com" e
  -- "joao@x.com" são a mesma pessoa para o §12, e um índice sobre a coluna crua
  -- deixaria as duas passarem. O CHECK abaixo impede a coluna de guardar
  -- qualquer outra coisa, inclusive por uma chamada direta ao PostgREST.
  email text not null,
  phone text,
  whatsapp text,

  -- O §11 manda o estado inicial ser definido "conforme a regra funcional".
  -- Ele é `confirmed`: quem preencheu o formulário de inscrição de um evento
  -- está dizendo que vai. Nascer `not_confirmed` obrigaria a APCS a confirmar
  -- manualmente 300 pessoas que já se confirmaram sozinhas.
  confirmation public.event_participant_confirmation not null default 'confirmed',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,

  constraint event_participants_name_len
    check (char_length(btrim(full_name)) between 2 and 160),

  -- O formato do e-mail no BANCO também, e não só no Zod. Quem chamar o
  -- PostgREST direto passa por aqui. Deliberadamente frouxo — validar e-mail
  -- por expressão regular estrita rejeita endereços válidos —, o bastante para
  -- barrar o que claramente não é um endereço.
  constraint event_participants_email_format
    check (email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  constraint event_participants_email_len check (char_length(email) <= 254),
  constraint event_participants_email_lower check (email = lower(email)),

  -- Só dígitos, já normalizados. O mesmo tratamento que `members.whatsapp`.
  constraint event_participants_phone_digits
    check (phone is null or phone ~ '^[0-9]{10,15}$'),
  constraint event_participants_whatsapp_digits
    check (whatsapp is null or whatsapp ~ '^[0-9]{10,15}$'),

  -- ⚠️ O §8 INTEIRO, EM UMA LINHA. Telefone e WhatsApp são opcionais um a um,
  -- mas pelo menos um tem de existir. No banco porque o escopo é explícito:
  -- "Essa regra deve existir no backend. Não confiar somente na validação do
  -- frontend."
  constraint event_participants_needs_a_phone
    check (phone is not null or whatsapp is not null),

  -- A FK composta da decisão 3.
  constraint event_participants_registration_matches_event
    foreign key (registration_id, event_id)
    references public.event_registrations (id, event_id) on delete cascade
);

comment on table public.event_participants is
  'Pessoa de uma inscricao. event_id e copiado da inscricao (FK composta garante) para o indice unico do §12.';

comment on column public.event_participants.event_id is
  'Copia guardada por FK composta. Existe porque indice unico nao atravessa join — ver a decisao 3 da migration.';

-- ============================================================================
-- ⚠️ O §12, E É ESTA LINHA QUE O IMPÕE.
-- ============================================================================
-- "Um mesmo participante não pode possuir duas inscrições para o mesmo evento
-- utilizando o mesmo e-mail." A checagem equivalente também existe em
-- `create_event_registration` — mas só para dar a mensagem certa. Quem GARANTE
-- é o índice: duas requisições simultâneas com o mesmo e-mail passam as duas
-- pela checagem e a segunda morre aqui, com 23505.
--
-- ⚠️ INCONDICIONAL, E A CONSEQUÊNCIA VALE SER DITA: cancelar uma inscrição NÃO
-- libera o e-mail. Quem cancelou e quer voltar tem a inscrição REATIVADA pelo
-- backoffice — que é a operação certa, porque preserva o histórico (§13) em vez
-- de criar uma segunda linha para a mesma pessoa no mesmo evento.
--
-- Um índice parcial (`where status = 'active'`) liberaria o e-mail no
-- cancelamento e parece mais gentil, mas exigiria que o participante conhecesse
-- a situação da inscrição — uma segunda cópia do mesmo fato, que é exatamente o
-- que a decisão 3 evitou com a FK composta.
create unique index event_participants_event_email_idx
  on public.event_participants (event_id, email);

create index event_participants_registration_idx
  on public.event_participants (registration_id);

-- Filtro por confirmação (§23), dentro de um evento.
create index event_participants_event_confirmation_idx
  on public.event_participants (event_id, confirmation);


-- ----------------------------------------------------------------------------
-- 4. Trilha das inscrições
-- ----------------------------------------------------------------------------
-- ⚠️ TABELA PRÓPRIA, E O §20 NÃO ESTÁ SENDO CONTRARIADO — está sendo seguido.
-- "Não criar uma solução paralela de auditoria" quer dizer não inventar um
-- segundo MECANISMO; e o mecanismo desta plataforma é uma trilha por domínio
-- (`document_audit_logs`, `event_audit_logs`, `membership_audit_logs`,
-- `lecture_audit_logs`, `market_bulletin_audit_logs`, `survey_audit_logs`,
-- `flow_audit_logs`). Esta é a oitava, com a mesma forma das sete.
--
-- ⚠️ POR QUE NÃO EMPILHAR EM `event_audit_logs`, que já existe e já tem
-- `event_id`: porque `listEventAuditLogs` lê a trilha do evento SEM LIMITE, e
-- ela aparece inteira na tela de detalhe. Um evento com 400 inscrições
-- afogaria as cinco linhas que interessam ali ("fulano publicou", "fulano
-- trocou a data") em 400 linhas de inscrição — e a página levaria essas 400
-- linhas junto a cada abertura.
--
-- O CICLO DA LANDING PAGE, esse sim, vai para `event_audit_logs`: é decisão de
-- quem responde pela agenda, é baixo volume, e é exatamente o que aquela tela
-- deve mostrar. Por isso os cinco valores novos no enum daquela trilha.
create table public.event_registration_audit_logs (
  id bigint generated always as identity primary key,

  -- `set null` (e não cascade): a trilha tem de sobreviver ao que ela audita.
  -- Mesmo desenho de `event_audit_logs`.
  registration_id uuid references public.event_registrations on delete set null,
  -- Guardado à parte porque `registration_id` pode virar nulo, e "de que evento
  -- era esta trilha?" continua sendo a primeira pergunta depois disso.
  event_id uuid references public.events on delete set null,

  action public.event_registration_audit_action not null,

  -- ⚠️ NULO QUANDO A INSCRIÇÃO VEIO DA PÁGINA PÚBLICA. Não há usuário ali, e
  -- inventar um seria mentir sobre quem fez. `origin` na inscrição diz o resto.
  actor_id uuid references public.profiles on delete set null,

  -- ⚠️ NUNCA DADO PESSOAL AQUI (§29). Nome, e-mail, telefone e WhatsApp ficam
  -- nas tabelas, sob RLS. O que entra são ids, contagens e nomes de campo — o
  -- bastante para responder "o que mudou", sem duplicar dado pessoal numa
  -- tabela que ninguém pensa em varrer quando alguém pede exclusão.
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

comment on table public.event_registration_audit_logs is
  'Trilha imutavel das inscricoes. So aceita INSERT. Nunca guarda dado pessoal — ver o §29.';

create index event_registration_audit_logs_registration_idx
  on public.event_registration_audit_logs (registration_id, created_at desc);

create index event_registration_audit_logs_event_idx
  on public.event_registration_audit_logs (event_id, created_at desc);


-- ----------------------------------------------------------------------------
-- 5. Quem pode o quê
-- ----------------------------------------------------------------------------
-- ⚠️ DUAS PERMISSÕES, E A SEGUNDA EXISTE POR CAUSA DE DADO PESSOAL.
--
-- A LANDING PAGE usa `events.*`: ela é a fachada do evento, editada na mesma
-- tela, pela mesma pessoa, e não guarda dado de ninguém. Criar uma chave
-- própria para ela seria inventar uma decisão de negócio que não existe.
--
-- As INSCRIÇÕES usam `registrations.*`, chave nova, porque ali a decisão é
-- outra: são nome, e-mail, telefone e WhatsApp de centenas de terceiros. Um
-- Atendente que precisa consultar a agenda não precisa, pelo mesmo ato, da
-- lista de contatos de quem vai. Hoje as duas listas de papéis coincidem — o
-- que a chave separada compra é poder deixarem de coincidir sem mexer em
-- Eventos.
--
-- O recorte é o dos outros módulos de conteúdo:
--   registrations.read   → admin, comercial   (Administrador e Atendente)
--   registrations.write  → admin              (só o Administrador)
--
-- ⚠️ O GESTOR NÃO EXISTE MAIS. O §21 do escopo pede Admin, Gestor e Atendente;
-- `ceo` foi APOSENTADO em 20260902000000 (um CHECK em `profiles.role` impede
-- qualquer conta de tê-lo). Um "Gestor de Inscrições" continua possível sem
-- papel novo: é um CARGO criado em /permissions com base `admin` e só as
-- chaves `registrations.*` — que é exatamente a forma desenhada em
-- 20260903000100 para o caso "precisa disto e mais nada".

create or replace function public.registrations_is_reader()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Sem a válvula de `auth.uid() is null`: esta guarda LEITURA de dado pessoal,
  -- e chamada sem sessão não passa. Mesma assimetria de `flow_is_reader`.
  select coalesce((select public.current_app_role()) in ('admin', 'comercial'), false);
$$;

comment on function public.registrations_is_reader() is
  'Pode consultar inscricoes e participantes. Administrador e Atendente.';

create or replace function public.registrations_is_writer()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select public.current_app_role()) = 'admin', false);
$$;

comment on function public.registrations_is_writer() is
  'Pode criar, editar e cancelar inscricoes. Somente o Administrador.';

revoke execute on function public.registrations_is_reader() from public, anon;
grant execute on function public.registrations_is_reader() to authenticated;
revoke execute on function public.registrations_is_writer() from public, anon;
grant execute on function public.registrations_is_writer() to authenticated;


-- ----------------------------------------------------------------------------
-- 6. Row Level Security
-- ----------------------------------------------------------------------------
-- ⚠️ NÃO HÁ POLICY PARA `anon` EM LUGAR NENHUM DESTE ARQUIVO, e isso é o §28
-- sendo respeitado sem antecipar o Prompt 3.
--
-- A página pública precisará LER a landing publicada e CRIAR inscrição sem
-- sessão. O caminho para isso já está desenhado neste projeto e não é abrir a
-- tabela para `anon`: é uma função SECURITY DEFINER estreita, chamada pelo
-- servidor com `service_role` — exatamente como `submit_membership_application`
-- e `register_survey_response`. `create_event_registration` (seção 8) já é essa
-- função.
--
-- A diferença prática entre os dois desenhos: uma policy de `anon` libera a
-- TABELA e depende de a cláusula estar certa para sempre; a função libera UMA
-- OPERAÇÃO, e o que ela não faz é impossível de pedir. Abrir a tabela agora,
-- "já que vai precisar", é deixar dado pessoal de terceiros exposto durante os
-- dois prompts em que ninguém ainda olha para essa página.
alter table public.event_landing_pages enable row level security;
alter table public.event_registrations enable row level security;
alter table public.event_participants enable row level security;
alter table public.event_registration_audit_logs enable row level security;

-- A Landing Page acompanha o evento: quem lê a agenda lê a página dela.
create policy "event_landing_pages_select"
  on public.event_landing_pages for select
  using (public.current_app_role() in ('admin', 'comercial'));

create policy "event_landing_pages_insert"
  on public.event_landing_pages for insert
  with check (
    public.current_app_role() = 'admin'
    and created_by = auth.uid()
  );

-- `updated_by = auth.uid()` no `with check` faz duas coisas, como em `events`:
-- impede assinar a edição com o nome de outra pessoa E impede uma alteração
-- anônima.
create policy "event_landing_pages_update"
  on public.event_landing_pages for update
  using (public.current_app_role() = 'admin')
  with check (
    public.current_app_role() = 'admin'
    and updated_by = auth.uid()
  );

-- Sem policy de delete: uma landing não se apaga, inativa-se (decisão 4).

create policy "event_registrations_select"
  on public.event_registrations for select
  using ((select public.registrations_is_reader()));

-- ⚠️ SEM `created_by = auth.uid()` AQUI, ao contrário da landing. Uma inscrição
-- pode nascer SEM AUTOR — é o caso da página pública, em que não há usuário —,
-- e exigir a assinatura tornaria esse caminho impossível. Quem diz de onde veio
-- é `origin`, e a autoria é conferida na função, que é quem sabe qual dos dois
-- caminhos está sendo percorrido.
create policy "event_registrations_insert"
  on public.event_registrations for insert
  with check ((select public.registrations_is_writer()));

create policy "event_registrations_update"
  on public.event_registrations for update
  using ((select public.registrations_is_writer()))
  with check ((select public.registrations_is_writer()));

create policy "event_participants_select"
  on public.event_participants for select
  using ((select public.registrations_is_reader()));

create policy "event_participants_insert"
  on public.event_participants for insert
  with check ((select public.registrations_is_writer()));

create policy "event_participants_update"
  on public.event_participants for update
  using ((select public.registrations_is_writer()))
  with check ((select public.registrations_is_writer()));

-- A trilha é mais estreita que a leitura, como em todos os módulos: só o
-- Administrador a lê. O Atendente consulta quem se inscreveu, não o histórico
-- de quem mexeu nas inscrições.
create policy "event_registration_audit_logs_select"
  on public.event_registration_audit_logs for select
  using (public.is_admin());

-- ⚠️ SEM POLICY DE INSERT, e é deliberado. Quem escreve na trilha é
-- `create_event_registration` / `update_event_registration` /
-- `set_participant_confirmation`, todas SECURITY DEFINER — e o dono da tabela
-- não passa por RLS. Uma policy de insert aqui só serviria para alguém gravar
-- uma linha de trilha à mão pelo PostgREST, que é o oposto do que uma trilha é.


-- ----------------------------------------------------------------------------
-- 7. Grants de coluna (RLS filtra LINHA, não COLUNA)
-- ----------------------------------------------------------------------------
-- ⚠️ ESTA SEÇÃO EXISTE POR CAUSA DE UM DEFEITO REAL. `events.description` nasceu
-- sem grant de coluna, e um ADMINISTRADOR com todas as permissões via "Você não
-- tem permissão para esta ação" ao salvar um evento — porque a policy olha a
-- LINHA, não as colunas tocadas. Ver `src/test/sql-column-grants.test.ts`, que
-- passou a recusar coluna nova sem grant.
--
-- Coluna nova nestas tabelas: acrescente à lista abaixo NA MESMA MIGRATION.
revoke update on public.event_landing_pages from authenticated;
grant update (
  status,
  slug,
  image_path,
  image_mime,
  image_size_bytes,
  description,
  form_fields,
  success_title,
  success_message,
  success_footer,
  closes_at,
  max_participants,
  updated_by,
  updated_at,
  published_at,
  published_by
) on public.event_landing_pages to authenticated;

revoke update on public.event_registrations from authenticated;
grant update (
  company_name,
  status,
  updated_by,
  updated_at
) on public.event_registrations to authenticated;

revoke update on public.event_participants from authenticated;
grant update (
  full_name,
  email,
  phone,
  whatsapp,
  confirmation,
  updated_at,
  updated_by
) on public.event_participants to authenticated;

-- Nada se apaga (decisão 4).
revoke delete on public.event_landing_pages from authenticated, anon;
revoke delete on public.event_registrations from authenticated, anon;
revoke delete on public.event_participants from authenticated, anon;

-- A trilha não se reescreve, não se apaga e não se insere de fora.
revoke insert, update, delete on public.event_registration_audit_logs from authenticated, anon;

-- ⚠️ E NADA DISSO É VISÍVEL PARA `anon`. As tabelas guardam dado pessoal de
-- terceiros; a página pública do Prompt 3 chega por função, não por tabela.
revoke all on public.event_landing_pages from anon;
revoke all on public.event_registrations from anon;
revoke all on public.event_participants from anon;
revoke all on public.event_registration_audit_logs from anon;


-- ----------------------------------------------------------------------------
-- 8. updated_at automático
-- ----------------------------------------------------------------------------
create trigger on_event_landing_pages_updated
  before update on public.event_landing_pages
  for each row execute procedure public.handle_updated_at();

create trigger on_event_registrations_updated
  before update on public.event_registrations
  for each row execute procedure public.handle_updated_at();

create trigger on_event_participants_updated
  before update on public.event_participants
  for each row execute procedure public.handle_updated_at();


-- ----------------------------------------------------------------------------
-- 9. Os textos padrão da confirmação (§18)
-- ----------------------------------------------------------------------------
-- ⚠️ O §18 PROÍBE HARDCODE EM SERVICE OU CONTROLLER e manda usar o mecanismo de
-- Textos que já existe. Ele é `app_settings` (20260830100000): chave e valor,
-- editável em /settings/texts, lido pelo formulário público e pelo disparo.
--
-- A Landing Page pode SOBRESCREVER cada um dos três (as colunas `success_*`).
-- Nulo ali significa "usa o padrão da plataforma", que é o que está abaixo. Uma
-- pergunta, duas respostas possíveis, nunca duas fontes — o padrão só é
-- consultado quando a específica não existe.
--
-- `<EVENTO>` e `<DATA>` são substituídos na renderização (Prompt 3). Ficam como
-- marcador, e não concatenados no SQL, porque quem edita o texto em
-- /settings/texts precisa poder mover o nome do evento de lugar na frase.
insert into public.app_settings (key, value) values
  (
    'events.registration_success_title',
    'INSCRIÇÃO CONFIRMADA!'
  ),
  (
    'events.registration_success_message',
    'Seu cadastro para o <EVENTO> foi realizado com sucesso.'
  ),
  (
    'events.registration_success_footer',
    'Esperamos você! Nos vemos no evento.'
  )
on conflict (key) do nothing;


-- ----------------------------------------------------------------------------
-- 10. Slug (§6)
-- ----------------------------------------------------------------------------
-- ⚠️ A NORMALIZAÇÃO MORA AQUI, E SÓ AQUI. Existe uma função equivalente em
-- TypeScript (`slugPreview` em event-landing.rules.ts), e ela é declaradamente
-- uma PRÉVIA: serve para a tela mostrar o endereço enquanto a pessoa digita. A
-- autoridade é esta, porque só ela consegue conferir a unicidade — e uma
-- normalização que não decide unicidade não é a fonte de nada.
--
-- ⚠️ SEM A EXTENSÃO `unaccent`, de propósito. Ela não está instalada neste banco
-- e instalá-la para uma função só é uma dependência nova em toda cópia do
-- projeto. `translate` com o mapa explícito resolve o português inteiro e é
-- `immutable` de verdade — `unaccent` não é, o que a impediria de entrar num
-- índice funcional se um dia isso for preciso.
create or replace function public.event_landing_slugify(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    -- 4. Sobra: hífens das pontas e hífens repetidos no meio.
    btrim(
      regexp_replace(
        -- 3. Tudo que não é letra, dígito ou hífen vira hífen.
        regexp_replace(
          -- 2. Minúsculas.
          lower(
            -- 1. Acento fora. O mapa cobre o português; o que sobrar cai na
            --    regra 3 e vira hífen, que é a degradação certa.
            translate(
              coalesce(p_text, ''),
              'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
              'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
            )
          ),
          '[^a-z0-9-]+', '-', 'g'
        ),
        '-{2,}', '-', 'g'
      ),
      '-'
    ),
    ''
  );
$$;

comment on function public.event_landing_slugify(text) is
  'Normaliza texto para slug de URL. Autoridade unica — a versao TypeScript e previa de tela.';

-- Devolve um slug LIVRE a partir do desejado, diferenciando de forma
-- determinística quando já existe.
--
-- ⚠️ A DIFERENCIAÇÃO É `-2`, `-3`, `-4`..., e não um sufixo aleatório. O §6 pede
-- "estratégia determinística": com sufixo sorteado, republicar a mesma página
-- depois de um erro produziria um endereço diferente a cada tentativa, e o link
-- que a APCS já mandou por WhatsApp deixaria de valer.
--
-- `p_landing_page_id` é a própria página quando ela já existe: sem isso, salvar
-- uma edição sem mexer no slug faria a página colidir consigo mesma e virar
-- `encontro-tecnico-2`.
create or replace function public.event_landing_free_slug(
  p_desired text,
  p_landing_page_id uuid default null
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_base text := public.event_landing_slugify(p_desired);
  v_try text;
  v_n integer := 1;
begin
  if v_base is null then
    raise exception 'Não foi possível gerar um endereço para esta página.'
      using errcode = 'LP003';
  end if;

  -- O CHECK da coluna exige no mínimo 3 caracteres. Um evento chamado "X" cairia
  -- nele DEPOIS de a função ter devolvido um slug — e o erro apareceria como
  -- violação de constraint, que não diz o que fazer.
  if char_length(v_base) < 3 then
    v_base := v_base || '-evento';
  end if;

  -- 120 é o teto do CHECK. Sobra para o sufixo de diferenciação.
  v_base := left(v_base, 110);
  v_try := v_base;

  loop
    exit when not exists (
      select 1 from public.event_landing_pages l
      where l.slug = v_try
        and (p_landing_page_id is null or l.id <> p_landing_page_id)
    );

    v_n := v_n + 1;

    -- Um evento não gera mil páginas homônimas. Se gerar, algo está errado a
    -- montante e um erro claro é melhor que um laço que não termina.
    if v_n > 999 then
      raise exception 'Não foi possível gerar um endereço único para esta página.'
        using errcode = 'LP003';
    end if;

    v_try := v_base || '-' || v_n::text;
  end loop;

  return v_try;
end;
$$;

comment on function public.event_landing_free_slug(text, uuid) is
  'Slug livre a partir do desejado. Diferenciacao deterministica (-2, -3...), nunca aleatoria.';

revoke execute on function public.event_landing_slugify(text) from public, anon;
grant execute on function public.event_landing_slugify(text) to authenticated;
revoke execute on function public.event_landing_free_slug(text, uuid) from public, anon;
grant execute on function public.event_landing_free_slug(text, uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 11. Configuração dos campos (§7 e §8)
-- ----------------------------------------------------------------------------
-- ⚠️ AS CHAVES VÁLIDAS VIVEM AQUI, E NÃO NUM CHECK DA COLUNA. Um CHECK que
-- listasse as cinco chaves impediria a próxima página de ser salva no dia em que
-- uma sexta entrasse — e recusaria QUALQUER update das linhas antigas, inclusive
-- os que não mexem em campo nenhum. É o mesmo motivo pelo qual o passo de
-- horário de Eventos não virou CHECK.
create or replace function public.event_landing_field_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['GRANJA_EMPRESA', 'EMAIL', 'NOME_PARTICIPANTE', 'TELEFONE', 'WHATSAPP'];
$$;

comment on function public.event_landing_field_keys() is
  'Campos que o formulario aceita nesta versao. Campo customizado e evolucao futura (§7).';

-- Confere a lista de campos de uma Landing Page.
--
-- Três regras, e cada uma vem de uma linha do escopo:
--   1. toda chave existe               (§7 — o conjunto é fechado nesta versão)
--   2. sem repetição                   (a ordem é o dado; repetir não significa nada)
--   3. os três obrigatórios estão lá   (§8 — granja, e-mail e nome)
--   4. telefone OU whatsapp está lá    (§8 — "pelo menos um dos dois por
--                                       participante"; sem nenhum dos dois no
--                                       formulário, NENHUMA inscrição poderia
--                                       ser aceita, e a página nasceria morta)
create or replace function public.assert_event_landing_fields(p_fields jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_keys text[];
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception 'Configuração de campos inválida.' using errcode = 'LP004';
  end if;

  select coalesce(array_agg(value), '{}') into v_keys
  from jsonb_array_elements_text(p_fields) as t(value);

  if exists (select 1 from unnest(v_keys) as k where k <> all (public.event_landing_field_keys())) then
    raise exception 'Configuração de campos inválida: campo desconhecido.' using errcode = 'LP004';
  end if;

  if array_length(v_keys, 1) is distinct from (select count(distinct k) from unnest(v_keys) as k) then
    raise exception 'Configuração de campos inválida: campo repetido.' using errcode = 'LP004';
  end if;

  if not ('GRANJA_EMPRESA' = any (v_keys)
          and 'EMAIL' = any (v_keys)
          and 'NOME_PARTICIPANTE' = any (v_keys)) then
    raise exception 'Granja/Empresa, E-mail e Nome do Participante são obrigatórios no formulário.'
      using errcode = 'LP004';
  end if;

  if not ('TELEFONE' = any (v_keys) or 'WHATSAPP' = any (v_keys)) then
    raise exception 'O formulário precisa de Telefone ou WhatsApp: cada participante tem de informar um dos dois.'
      using errcode = 'LP004';
  end if;
end;
$$;

revoke execute on function public.event_landing_field_keys() from public, anon;
grant execute on function public.event_landing_field_keys() to authenticated;
revoke execute on function public.assert_event_landing_fields(jsonb) from public, anon;
grant execute on function public.assert_event_landing_fields(jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- 12. Contagem e disponibilidade
-- ----------------------------------------------------------------------------
-- Quantas PESSOAS já estão inscritas nesta página (§14: participantes, não
-- inscrições). Só as inscrições ativas contam — uma cancelada devolve a vaga.
create or replace function public.event_landing_participant_count(p_landing_page_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.event_participants p
  join public.event_registrations r on r.id = p.registration_id
  where r.landing_page_id = p_landing_page_id
    and r.status = 'active';
$$;

comment on function public.event_landing_participant_count(uuid) is
  'Pessoas ja inscritas nesta pagina. Inscricao cancelada devolve a vaga.';

-- Quantas vagas sobram. `null` = sem limite (§14).
create or replace function public.event_landing_seats_left(p_landing_page_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select case
    when l.max_participants is null then null
    else greatest(l.max_participants - public.event_landing_participant_count(l.id), 0)
  end
  from public.event_landing_pages l
  where l.id = p_landing_page_id;
$$;

revoke execute on function public.event_landing_participant_count(uuid) from public, anon;
grant execute on function public.event_landing_participant_count(uuid) to authenticated;
revoke execute on function public.event_landing_seats_left(uuid) from public, anon;
grant execute on function public.event_landing_seats_left(uuid) to authenticated;

-- Serializa operações concorrentes sobre a MESMA Landing Page.
--
-- ⚠️ É O QUE FAZ A CAPACIDADE FUNCIONAR (decisão 2). Sem ele, duas inscrições
-- simultâneas leem a mesma contagem e as duas concluem que cabem.
--
-- Lock consultivo e não `select ... for update`, pelo mesmo motivo de
-- `lock_event`: em tabela com RLS, `for update` exige policy e privilégio de
-- UPDATE — e quem se inscreve pela página pública não tem nenhum dos dois.
--
-- ⚠️ E SEM CHECAGEM DE PAPEL AQUI, ao contrário de `lock_event`. Aquele guarda
-- edição de evento, que é sempre de administrador; este é atravessado também
-- pelo caminho público, onde não há papel nenhum. Quem autoriza é a função que
-- chama; este só enfileira.
create or replace function public.lock_event_landing_page(p_landing_page_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- Prefixo próprio no hash: `lock_event` usa `hashtext(event_id)`, e uma
  -- landing e um evento com ids diferentes ainda podem colidir no mesmo bucket
  -- de 32 bits. Colisão aqui só custaria espera desnecessária, mas o prefixo é
  -- de graça.
  perform pg_advisory_xact_lock(hashtext('event_landing:' || p_landing_page_id::text));
end;
$$;

revoke execute on function public.lock_event_landing_page(uuid) from public, anon;
grant execute on function public.lock_event_landing_page(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 13. Landing Page — operações transacionais
-- ----------------------------------------------------------------------------
-- SECURITY INVOKER (padrão do plpgsql), como `create_event`: a RLS e os grants
-- de coluna continuam valendo DENTRO da função. A checagem de papel no topo
-- existe para devolver um erro limpo em vez de "permission denied for table".
--
-- Está no banco, e não na action, pelo mesmo motivo de Eventos: criar uma
-- Landing Page são duas escritas que precisam acontecer juntas (a linha e a
-- auditoria), e editar exige comparar a linha antiga com a nova na MESMA
-- transação para o diff não contar mentira quando duas edições se cruzam.

create or replace function public.create_event_landing_page(
  p_event_id uuid,
  p_slug text default null,
  p_description text default null,
  p_form_fields jsonb default null,
  p_success_title text default null,
  p_success_message text default null,
  p_success_footer text default null,
  p_closes_at timestamptz default null,
  p_max_participants integer default null
)
returns public.event_landing_pages
language plpgsql
set search_path = ''
as $$
declare
  v_event public.events;
  v_page public.event_landing_pages;
  v_fields jsonb := coalesce(
    p_form_fields,
    '["GRANJA_EMPRESA", "EMAIL", "NOME_PARTICIPANTE", "TELEFONE", "WHATSAPP"]'::jsonb
  );
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Sem permissão para criar páginas de inscrição.' using errcode = '42501';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- ⚠️ A MENSAGEM CERTA PARA O §3. O `unique` de `event_id` já impediria a
  -- segunda página, mas com 23505, que a aplicação traduz como "Já existe um
  -- registro com esses dados" — verdadeiro e inútil. Esta checagem é para o
  -- texto; a garantia continua sendo a constraint, que é quem vence a corrida
  -- entre duas abas.
  if exists (select 1 from public.event_landing_pages l where l.event_id = p_event_id) then
    raise exception 'Este evento já tem uma página de inscrição.' using errcode = 'LP005';
  end if;

  perform public.assert_event_landing_fields(v_fields);

  insert into public.event_landing_pages (
    event_id, slug, description, form_fields,
    success_title, success_message, success_footer,
    closes_at, max_participants
  ) values (
    p_event_id,
    -- Nasce a partir do NOME DO EVENTO quando ninguém digitou um endereço (§6).
    public.event_landing_free_slug(coalesce(nullif(btrim(p_slug), ''), v_event.name)),
    nullif(btrim(coalesce(p_description, '')), ''),
    v_fields,
    nullif(btrim(coalesce(p_success_title, '')), ''),
    nullif(btrim(coalesce(p_success_message, '')), ''),
    nullif(btrim(coalesce(p_success_footer, '')), ''),
    p_closes_at,
    p_max_participants
  )
  returning * into v_page;

  -- ⚠️ NA TRILHA DO EVENTO, e não numa trilha de landing pages. Ver a seção 4:
  -- publicar a página de inscrição é decisão de quem responde pela agenda, e é
  -- na tela do evento que ela precisa ser lida.
  insert into public.event_audit_logs (event_id, action, metadata)
  values (
    p_event_id,
    'landing_page_created',
    jsonb_build_object('landingPageId', v_page.id, 'slug', v_page.slug)
  );

  return v_page;
end;
$$;


-- Edita a Landing Page e grava o DIFF campo a campo, como `update_event`.
--
-- ⚠️ NÃO MUDA `status`: publicar, encerrar e inativar são
-- `set_event_landing_page_status`. Misturar as duas coisas faria uma edição de
-- texto poder tirar a página do ar por descuido de quem montou o formulário.
create or replace function public.update_event_landing_page(
  p_landing_page_id uuid,
  p_slug text,
  p_description text,
  p_form_fields jsonb,
  p_success_title text,
  p_success_message text,
  p_success_footer text,
  p_closes_at timestamptz,
  p_max_participants integer
)
returns public.event_landing_pages
language plpgsql
set search_path = ''
as $$
declare
  v_old public.event_landing_pages;
  v_new public.event_landing_pages;
  v_changes jsonb := '[]'::jsonb;
  v_slug text;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Sem permissão para alterar páginas de inscrição.' using errcode = '42501';
  end if;

  perform public.lock_event_landing_page(p_landing_page_id);

  select * into v_old from public.event_landing_pages where id = p_landing_page_id;
  if not found then
    raise exception 'Página de inscrição não encontrada.' using errcode = 'P0002';
  end if;

  perform public.assert_event_landing_fields(p_form_fields);

  -- Slug vazio significa MANTER o atual. Passar o atual de volta também mantém:
  -- `event_landing_free_slug` recebe o id da própria página e não colide
  -- consigo mesma.
  v_slug := public.event_landing_free_slug(
    coalesce(nullif(btrim(p_slug), ''), v_old.slug),
    p_landing_page_id
  );

  -- ⚠️ REDUZIR A CAPACIDADE ABAIXO DE QUEM JÁ ESTÁ INSCRITO É RECUSADO. Aceitar
  -- deixaria a página num estado em que a contagem de inscritos ultrapassa o
  -- limite — e ninguém saberia dizer se aquelas pessoas têm vaga ou não. Quem
  -- precisa mesmo diminuir o evento encerra a página e trata os casos a dedo.
  if p_max_participants is not null
     and p_max_participants < public.event_landing_participant_count(p_landing_page_id) then
    raise exception 'A capacidade não pode ser menor que o número de participantes já inscritos.'
      using errcode = 'LP004';
  end if;

  update public.event_landing_pages
  set slug = v_slug,
      description = nullif(btrim(coalesce(p_description, '')), ''),
      form_fields = p_form_fields,
      success_title = nullif(btrim(coalesce(p_success_title, '')), ''),
      success_message = nullif(btrim(coalesce(p_success_message, '')), ''),
      success_footer = nullif(btrim(coalesce(p_success_footer, '')), ''),
      closes_at = p_closes_at,
      max_participants = p_max_participants,
      updated_by = (select auth.uid())
  where id = p_landing_page_id
  returning * into v_new;

  -- `is distinct from` e não `<>`: com NULL dos dois lados, `<>` devolve NULL e
  -- a mudança passaria despercebida.
  if v_old.slug is distinct from v_new.slug then
    v_changes := v_changes || jsonb_build_object('field', 'slug', 'from', v_old.slug, 'to', v_new.slug);
  end if;
  if v_old.description is distinct from v_new.description then
    -- ⚠️ SÓ O TAMANHO, não o texto. A descrição pode ter 4000 caracteres, e
    -- copiá-la a cada edição faria a trilha crescer sem responder nada que a
    -- tabela já não responda. Mesma decisão de `set_app_setting`.
    v_changes := v_changes || jsonb_build_object(
      'field', 'description',
      'from', char_length(coalesce(v_old.description, '')),
      'to', char_length(coalesce(v_new.description, ''))
    );
  end if;
  if v_old.form_fields is distinct from v_new.form_fields then
    v_changes := v_changes || jsonb_build_object('field', 'formFields', 'from', v_old.form_fields, 'to', v_new.form_fields);
  end if;
  if v_old.closes_at is distinct from v_new.closes_at then
    v_changes := v_changes || jsonb_build_object('field', 'closesAt', 'from', v_old.closes_at, 'to', v_new.closes_at);
  end if;
  if v_old.max_participants is distinct from v_new.max_participants then
    v_changes := v_changes || jsonb_build_object('field', 'maxParticipants', 'from', v_old.max_participants, 'to', v_new.max_participants);
  end if;
  if (v_old.success_title, v_old.success_message, v_old.success_footer)
     is distinct from (v_new.success_title, v_new.success_message, v_new.success_footer) then
    v_changes := v_changes || jsonb_build_object('field', 'successMessage', 'from', null, 'to', null);
  end if;

  if jsonb_array_length(v_changes) > 0 then
    insert into public.event_audit_logs (event_id, action, metadata)
    values (
      v_new.event_id,
      'landing_page_updated',
      jsonb_build_object('landingPageId', v_new.id, 'changes', v_changes)
    );
  end if;

  return v_new;
end;
$$;


-- Troca a imagem da página, ou a remove.
--
-- ⚠️ FUNÇÃO SEPARADA DA EDIÇÃO, ao contrário de `update_event`. Ali a imagem é
-- OBRIGATÓRIA, então `p_image_path` nulo só pode significar "mantém a atual".
-- Aqui ela é opcional, e "nulo" é ambíguo: mantém ou remove? Duas operações com
-- nomes diferentes não têm essa dúvida.
create or replace function public.set_event_landing_page_image(
  p_landing_page_id uuid,
  p_image_path text,
  p_image_mime text,
  p_image_size_bytes integer
)
returns public.event_landing_pages
language plpgsql
set search_path = ''
as $$
declare
  v_old public.event_landing_pages;
  v_new public.event_landing_pages;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Sem permissão para alterar páginas de inscrição.' using errcode = '42501';
  end if;

  perform public.lock_event_landing_page(p_landing_page_id);

  select * into v_old from public.event_landing_pages where id = p_landing_page_id;
  if not found then
    raise exception 'Página de inscrição não encontrada.' using errcode = 'P0002';
  end if;

  update public.event_landing_pages
  set image_path = p_image_path,
      image_mime = p_image_mime,
      image_size_bytes = p_image_size_bytes,
      updated_by = (select auth.uid())
  where id = p_landing_page_id
  returning * into v_new;

  if v_old.image_path is distinct from v_new.image_path then
    insert into public.event_audit_logs (event_id, action, metadata)
    values (
      v_new.event_id,
      'landing_page_updated',
      jsonb_build_object(
        'landingPageId', v_new.id,
        'changes', jsonb_build_array(
          jsonb_build_object('field', 'image', 'from', v_old.image_path, 'to', v_new.image_path)
        )
      )
    );
  end if;

  return v_new;
end;
$$;


-- Publica, encerra ou tira do ar (§5).
--
-- ⚠️ AS TRANSIÇÕES SÃO DECLARADAS, E O QUE NÃO ESTÁ DECLARADO É RECUSADO:
--
--     rascunho   → publicada | inativa
--     publicada  → encerrada | inativa
--     encerrada  → publicada | inativa      (reabre quando o prazo é estendido)
--     inativa    → publicada
--
-- "Publicada → publicada" é recusado de propósito: republicar uma página que já
-- está no ar não é nada, e aceitar em silêncio esconderia um botão apertado no
-- lugar errado. Vale para todas as repetições.
create or replace function public.set_event_landing_page_status(
  p_landing_page_id uuid,
  p_command text
)
returns public.event_landing_pages
language plpgsql
set search_path = ''
as $$
declare
  v_old public.event_landing_pages;
  v_new public.event_landing_pages;
  v_event public.events;
  v_target public.event_landing_page_status;
  v_action public.event_audit_action;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Sem permissão para alterar páginas de inscrição.' using errcode = '42501';
  end if;

  if p_command not in ('publish', 'close', 'deactivate') then
    raise exception 'Comando inválido.' using errcode = '22023';
  end if;

  perform public.lock_event_landing_page(p_landing_page_id);

  select * into v_old from public.event_landing_pages where id = p_landing_page_id;
  if not found then
    raise exception 'Página de inscrição não encontrada.' using errcode = 'P0002';
  end if;

  v_target := (case p_command
    when 'publish' then 'published'
    when 'close' then 'closed'
    else 'inactive'
  end)::public.event_landing_page_status;

  if v_old.status = v_target then
    raise exception 'A página já está nesta situação.' using errcode = 'LP002';
  end if;

  -- `close` só faz sentido a partir do ar: encerrar um rascunho seria encerrar
  -- inscrições que nunca foram abertas.
  if p_command = 'close' and v_old.status <> 'published' then
    raise exception 'Só é possível encerrar uma página que está publicada.' using errcode = 'LP002';
  end if;

  if p_command = 'publish' then
    select * into v_event from public.events where id = v_old.event_id;
    if not found then
      raise exception 'Evento não encontrado.' using errcode = 'P0002';
    end if;

    -- ⚠️ A MESMA REGRA QUE `set_event_status` IMPÕE, e pelo mesmo motivo: abrir
    -- inscrição para um evento que já aconteceu é pior do que não abrir. Note
    -- que ela olha o EVENTO, não a landing — uma página pode ter prazo de
    -- inscrição vencido e ser republicada com prazo novo; o que não volta é o
    -- evento.
    if v_event.event_date < public.event_today() then
      raise exception 'Não é possível publicar a página de um evento cuja data já passou.'
        using errcode = 'EV001';
    end if;

    -- Publicar é o momento em que o formulário passa a valer para o público.
    -- Uma configuração que ficou inválida por edição manual do jsonb para aqui.
    perform public.assert_event_landing_fields(v_old.form_fields);
  end if;

  update public.event_landing_pages
  set status = v_target,
      -- ⚠️ O CARIMBO É O DA PRIMEIRA PUBLICAÇÃO. `coalesce` mantém o original
      -- quando a página é reaberta: "no ar desde" é a pergunta que essa coluna
      -- responde, e reabrir depois de um encerramento não apaga o histórico.
      published_at = case
        when p_command = 'publish' then coalesce(v_old.published_at, now())
        else v_old.published_at
      end,
      published_by = case
        when p_command = 'publish' then coalesce(v_old.published_by, (select auth.uid()))
        else v_old.published_by
      end,
      updated_by = (select auth.uid())
  where id = p_landing_page_id
  returning * into v_new;

  v_action := (case p_command
    when 'publish' then 'landing_page_published'
    when 'close' then 'landing_page_closed'
    else 'landing_page_deactivated'
  end)::public.event_audit_action;

  insert into public.event_audit_logs (event_id, action, metadata)
  values (
    v_new.event_id,
    v_action,
    jsonb_build_object(
      'landingPageId', v_new.id,
      'slug', v_new.slug,
      'from', v_old.status,
      'to', v_new.status
    )
  );

  return v_new;
end;
$$;


-- ----------------------------------------------------------------------------
-- 14. A inscrição (§9, §12, §14, §15, §17, §26, §27)
-- ----------------------------------------------------------------------------
-- ⚠️ É A FUNÇÃO CENTRAL DO MÓDULO. Ela é a transação inteira do §26 — inscrição
-- e participantes juntos, ou nada — e é onde vivem as regras que o §17 manda
-- não confiar ao frontend.
--
-- ⚠️ SECURITY DEFINER, e é o mesmo desenho de `submit_membership_application` e
-- `register_survey_response`. Quem chama pelo caminho público é o servidor com
-- `service_role`, porque não há sessão para a RLS avaliar. O que substitui a
-- permissão nesse caso é a ESTREITEZA da função: ela não tem parâmetro capaz de
-- mexer em nada além de criar uma inscrição numa página que está PUBLICADA.
--
-- ⚠️ AS DUAS PORTAS SÃO DISTINGUIDAS AQUI DENTRO, e o chamador não escolhe qual
-- é a dele. `origin` é DERIVADO de quem está chamando, e não recebido: um
-- parâmetro `p_origin` deixaria a página pública gravar 'backoffice' e mentir
-- sobre a procedência de toda inscrição.
--
-- ⚠️ AS REGRAS SÃO AS MESMAS NOS DOIS CAMINHOS. O administrador NÃO fura o prazo
-- nem a capacidade. Quem precisa inscrever alguém depois do prazo estende
-- `closes_at` — que é um ato explícito, com trilha, em vez de uma exceção
-- invisível dentro de uma função.
--
-- ⚠️ A ORDEM DAS CHECAGENS NÃO É ARBITRÁRIA: a IDEMPOTÊNCIA VEM PRIMEIRO.
-- Um retry (F5, rede ruim, duplo clique) chega com o mesmo `dedupe_key` depois
-- de a primeira tentativa TER GRAVADO os participantes. Se as validações
-- rodassem antes, esse retry morreria em "e-mail já inscrito neste evento" —
-- acusando a pessoa de duplicidade contra ela mesma, e escondendo o fato de que
-- a inscrição dela deu certo.
create or replace function public.create_event_registration(
  p_landing_page_id uuid,
  p_company_name text,
  p_participants jsonb,
  p_dedupe_key text,
  p_source_ip_hash text default null,
  p_user_agent text default null
)
returns table (registration_id uuid, participant_count integer, duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_writer boolean := public.registrations_is_writer();
  v_actor uuid := (select auth.uid());
  v_origin public.event_registration_origin;
  v_page public.event_landing_pages;
  v_existing public.event_registrations;
  v_new public.event_registrations;
  v_people jsonb;
  v_count integer;
  v_taken text;
  v_seats integer;
begin
  -- 1. Quem está chamando. Administrador pela tela, ou o servidor pela página
  --    pública (sem sessão, com `service_role`). Não há terceira porta.
  if v_is_writer then
    v_origin := 'backoffice';
  elsif v_actor is null then
    v_origin := 'landing_page';
  else
    raise exception 'Sem permissão para criar inscrições.' using errcode = '42501';
  end if;

  -- 2. IDEMPOTÊNCIA — antes de tudo. Ver o aviso do cabeçalho.
  select * into v_existing
  from public.event_registrations r
  where r.dedupe_key = p_dedupe_key;

  if found then
    return query
      select v_existing.id,
             (select count(*)::integer
              from public.event_participants p
              where p.registration_id = v_existing.id),
             true;
    return;
  end if;

  -- 3. A página existe e está aceitando (§17).
  perform public.lock_event_landing_page(p_landing_page_id);

  select * into v_page
  from public.event_landing_pages l
  where l.id = p_landing_page_id;

  if not found then
    raise exception 'Página de inscrição não encontrada.' using errcode = 'P0002';
  end if;

  if v_page.status <> 'published' then
    raise exception 'As inscrições para este evento não estão abertas.' using errcode = 'LP001';
  end if;

  if v_page.closes_at is not null and now() > v_page.closes_at then
    raise exception 'O prazo de inscrição para este evento já encerrou.' using errcode = 'RG001';
  end if;

  -- 4. Normaliza os participantes UMA VEZ, e todo o resto trabalha sobre o
  --    resultado. Normalizar em cada checagem é como duas delas passam a
  --    discordar sobre o que é "o mesmo e-mail".
  --
  --    ⚠️ O E-MAIL VAI PARA MINÚSCULAS AQUI. É disso que o índice único do §12
  --    depende: "Joao@x.com" e "joao@x.com" são a mesma pessoa, e um índice
  --    sobre a coluna crua deixaria as duas entrarem.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'fullName', btrim(coalesce(e.value ->> 'fullName', '')),
             'email', lower(btrim(coalesce(e.value ->> 'email', ''))),
             'phone', nullif(regexp_replace(coalesce(e.value ->> 'phone', ''), '[^0-9]', '', 'g'), ''),
             'whatsapp', nullif(regexp_replace(coalesce(e.value ->> 'whatsapp', ''), '[^0-9]', '', 'g'), '')
           )
         ), '[]'::jsonb)
    into v_people
  from jsonb_array_elements(
         case when jsonb_typeof(p_participants) = 'array' then p_participants else '[]'::jsonb end
       ) as e(value);

  v_count := jsonb_array_length(v_people);

  if v_count = 0 then
    raise exception 'Informe ao menos um participante.' using errcode = 'RG006';
  end if;

  -- 5. Cada participante tem nome, e-mail e ao menos um contato (§8, §17).
  if exists (
    select 1 from jsonb_array_elements(v_people) as e(value)
    where char_length(e.value ->> 'fullName') < 2
       or (e.value ->> 'email') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    raise exception 'Informe nome e e-mail válidos para cada participante.' using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_people) as e(value)
    where e.value ->> 'phone' is null and e.value ->> 'whatsapp' is null
  ) then
    raise exception 'Informe telefone ou WhatsApp para cada participante.' using errcode = 'RG005';
  end if;

  -- 6. Duplicidade DENTRO da própria requisição (§12). O escopo é explícito:
  --    "João - joao@email.com / Maria - joao@email.com" é inválido.
  select e.value ->> 'email' into v_taken
  from jsonb_array_elements(v_people) as e(value)
  group by e.value ->> 'email'
  having count(*) > 1
  limit 1;

  if v_taken is not null then
    raise exception 'O e-mail % aparece mais de uma vez nesta inscrição.', v_taken
      using errcode = 'RG004';
  end if;

  -- 7. Duplicidade contra o que JÁ EXISTE no evento (§12).
  --
  --    ⚠️ ESTA CHECAGEM É PELA MENSAGEM, NÃO PELA GARANTIA. Duas requisições
  --    simultâneas com o mesmo e-mail passam as duas por aqui; quem recusa a
  --    segunda é o índice `event_participants_event_email_idx`, com 23505. O
  --    que se ganha aqui é poder DIZER QUAL e-mail é o problema — coisa que a
  --    violação de índice não sabe fazer.
  select p.email into v_taken
  from public.event_participants p
  join public.event_registrations r on r.id = p.registration_id
  where p.event_id = v_page.event_id
    and r.status = 'active'
    and p.email in (select e.value ->> 'email' from jsonb_array_elements(v_people) as e(value))
  limit 1;

  if v_taken is not null then
    raise exception 'O e-mail % já está inscrito neste evento.', v_taken
      using errcode = 'RG003';
  end if;

  -- 8. Capacidade (§14, §15). Sob o lock da etapa 3 — é o lock que impede duas
  --    inscrições simultâneas de lerem a mesma contagem e caberem as duas.
  if v_page.max_participants is not null then
    v_seats := v_page.max_participants
             - public.event_landing_participant_count(v_page.id);

    if v_count > v_seats then
      raise exception 'Não há vagas suficientes: restam % para este evento.', greatest(v_seats, 0)
        using errcode = 'RG002';
    end if;
  end if;

  -- 9. A gravação. `on conflict do nothing` fecha a corrida entre dois envios
  --    idênticos que passaram juntos pela etapa 2.
  insert into public.event_registrations (
    event_id, landing_page_id, company_name, origin, dedupe_key,
    source_ip_hash, user_agent, created_by, updated_by
  ) values (
    v_page.event_id,
    v_page.id,
    btrim(p_company_name),
    v_origin,
    p_dedupe_key,
    p_source_ip_hash,
    left(coalesce(p_user_agent, ''), 400),
    v_actor,
    v_actor
  )
  on conflict (dedupe_key) do nothing
  returning * into v_new;

  if v_new.id is null then
    -- O outro envio ganhou a corrida. A inscrição dele é a resposta dos dois.
    select * into v_existing
    from public.event_registrations r
    where r.dedupe_key = p_dedupe_key;

    return query
      select v_existing.id,
             (select count(*)::integer
              from public.event_participants p
              where p.registration_id = v_existing.id),
             true;
    return;
  end if;

  insert into public.event_participants (
    registration_id, event_id, full_name, email, phone, whatsapp
  )
  select v_new.id,
         v_new.event_id,
         e.value ->> 'fullName',
         e.value ->> 'email',
         e.value ->> 'phone',
         e.value ->> 'whatsapp'
  from jsonb_array_elements(v_people) as e(value);

  -- ⚠️ SEM DADO PESSOAL NA TRILHA (§29): quantos, e não quem. O "quem" está em
  -- `event_participants`, sob RLS, e é de lá que ele sai quando alguém pede
  -- exclusão. Copiá-lo aqui criaria uma segunda cópia que ninguém lembraria de
  -- apagar.
  insert into public.event_registration_audit_logs (
    registration_id, event_id, action, actor_id, metadata
  ) values (
    v_new.id,
    v_new.event_id,
    'registration_created',
    v_actor,
    jsonb_build_object(
      'landingPageId', v_page.id,
      'origin', v_origin,
      'participants', v_count
    )
  );

  return query select v_new.id, v_count, false;
end;
$$;

-- ⚠️ EXECUTE REVOGADO DE `public` E `anon`. Quem chama pelo caminho público é o
-- SERVIDOR com `service_role` — que não passa por grant —, e não o navegador de
-- quem se inscreve. `authenticated` mantém o EXECUTE porque o backoffice
-- (Prompt 2) inscreve gente pela tela; a função confere o papel por dentro.
revoke execute on function public.create_event_registration(uuid, text, jsonb, text, text, text)
  from public, anon;
grant execute on function public.create_event_registration(uuid, text, jsonb, text, text, text)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 15. Manutenção da inscrição pelo backoffice (§13, §22)
-- ----------------------------------------------------------------------------
-- ⚠️ SECURITY INVOKER, ao contrário da criação. Aqui não existe caminho público:
-- ninguém edita ou cancela inscrição de fora. Deixar a RLS e os grants de coluna
-- valendo é a defesa que se ganha de graça por não precisar do DEFINER.
--
-- `p_status` nulo mantém a situação; `p_company_name` nulo mantém o nome. O
-- cancelamento é o que substitui a exclusão (decisão 4) — e ele DEVOLVE AS
-- VAGAS, porque `event_landing_participant_count` só conta inscrição ativa.
create or replace function public.update_event_registration(
  p_registration_id uuid,
  p_company_name text default null,
  p_status public.event_registration_status default null
)
returns public.event_registrations
language plpgsql
set search_path = ''
as $$
declare
  v_old public.event_registrations;
  v_new public.event_registrations;
  v_page public.event_landing_pages;
  v_changes jsonb := '[]'::jsonb;
  v_action public.event_registration_audit_action := 'registration_updated';
  v_target public.event_registration_status;
  v_livres integer;
  v_pessoas integer;
begin
  if not public.registrations_is_writer() then
    raise exception 'Sem permissão para alterar inscrições.' using errcode = '42501';
  end if;

  select * into v_old from public.event_registrations r where r.id = p_registration_id;
  if not found then
    raise exception 'Inscrição não encontrada.' using errcode = 'P0002';
  end if;

  -- O lock é da PÁGINA, não da inscrição: reativar consome vaga, e vaga é um
  -- recurso da página. Sem ele, duas reativações simultâneas passariam juntas
  -- pela conferência de capacidade logo abaixo.
  perform public.lock_event_landing_page(v_old.landing_page_id);

  v_target := coalesce(p_status, v_old.status);

  -- ⚠️ REATIVAR CONFERE A CAPACIDADE DE NOVO. Uma inscrição cancelada devolveu
  -- as vagas dela ao evento; entre o cancelamento e a reativação, outras
  -- pessoas podem tê-las tomado. Reativar sem conferir estouraria o limite
  -- silenciosamente — e por um caminho que ninguém pensa em olhar.
  if v_target = 'active' and v_old.status = 'cancelled' then
    select * into v_page
    from public.event_landing_pages l
    where l.id = v_old.landing_page_id;

    if v_page.max_participants is not null then
      select count(*)::integer into v_pessoas
      from public.event_participants p
      where p.registration_id = v_old.id;

      v_livres := v_page.max_participants
                - public.event_landing_participant_count(v_page.id);

      if v_pessoas > v_livres then
        raise exception 'Não há vagas suficientes para reativar esta inscrição: restam %.',
          greatest(v_livres, 0) using errcode = 'RG002';
      end if;
    end if;
  end if;

  update public.event_registrations
  set company_name = coalesce(nullif(btrim(coalesce(p_company_name, '')), ''), v_old.company_name),
      status = v_target,
      updated_by = (select auth.uid())
  where id = p_registration_id
  returning * into v_new;

  if v_old.company_name is distinct from v_new.company_name then
    v_changes := v_changes || jsonb_build_object(
      'field', 'companyName', 'from', v_old.company_name, 'to', v_new.company_name
    );
  end if;

  if v_old.status is distinct from v_new.status then
    v_action := (case
      when v_new.status = 'cancelled' then 'registration_cancelled'
      else 'registration_reactivated'
    end)::public.event_registration_audit_action;
    v_changes := v_changes || jsonb_build_object(
      'field', 'status', 'from', v_old.status, 'to', v_new.status
    );
  end if;

  if jsonb_array_length(v_changes) > 0 then
    insert into public.event_registration_audit_logs (
      registration_id, event_id, action, actor_id, metadata
    ) values (
      v_new.id,
      v_new.event_id,
      v_action,
      (select auth.uid()),
      jsonb_build_object('changes', v_changes)
    );
  end if;

  return v_new;
end;
$$;


-- Troca a confirmação de um participante (§11).
--
-- ⚠️ NÃO EDITA NOME, E-MAIL NEM TELEFONE. Só a confirmação. Editar o e-mail
-- mexeria na chave do §12 e precisaria refazer a conferência de duplicidade
-- inteira; é operação para quando existir tela que a peça, e não uma porta
-- aberta agora "porque é parecido".
create or replace function public.set_participant_confirmation(
  p_participant_id uuid,
  p_confirmation public.event_participant_confirmation
)
returns public.event_participants
language plpgsql
set search_path = ''
as $$
declare
  v_old public.event_participants;
  v_new public.event_participants;
begin
  if not public.registrations_is_writer() then
    raise exception 'Sem permissão para alterar participantes.' using errcode = '42501';
  end if;

  select * into v_old from public.event_participants p where p.id = p_participant_id;
  if not found then
    raise exception 'Participante não encontrado.' using errcode = 'P0002';
  end if;

  if v_old.confirmation = p_confirmation then
    return v_old;
  end if;

  update public.event_participants
  set confirmation = p_confirmation,
      updated_by = (select auth.uid())
  where id = p_participant_id
  returning * into v_new;

  -- ⚠️ O ID DO PARTICIPANTE, NUNCA O NOME OU O E-MAIL (§29). Quem precisa saber
  -- de quem se trata consulta a tabela, que está sob RLS.
  insert into public.event_registration_audit_logs (
    registration_id, event_id, action, actor_id, metadata
  ) values (
    v_new.registration_id,
    v_new.event_id,
    'participant_confirmation_changed',
    (select auth.uid()),
    jsonb_build_object(
      'participantId', v_new.id,
      'from', v_old.confirmation,
      'to', v_new.confirmation
    )
  );

  return v_new;
end;
$$;


-- ----------------------------------------------------------------------------
-- 16. As permissões novas — nas DUAS tabelas, e a segunda é a que se esquece
-- ----------------------------------------------------------------------------
-- ⚠️ SÓ O TETO NÃO BASTA. `app_role_ceilings` declara o que a RLS entrega a cada
-- PAPEL-BASE, mas quem decide o que uma pessoa vê é o CARGO dela
-- (`app_role_permissions`), semeado em 20260903000100 com uma cópia do teto
-- DAQUELE momento. Uma permissão acrescentada depois entra no teto e não entra
-- em cargo nenhum — e o resultado seria a tela de Inscrições invisível até para
-- o Administrador, com a RLS liberada.
--
-- É a mesma seção 20 de 20260917000100_flows.sql, e existe um teste que recusa
-- migration que mexa no teto sem semear (`src/test/sql-role-ceilings.test.ts`).
insert into public.app_role_ceilings (base_role, permission) values
  ('admin', 'registrations.read'),
  ('admin', 'registrations.write'),
  ('comercial', 'registrations.read')
on conflict do nothing;

insert into public.app_role_permissions (role_key, permission)
select r.key, c.permission
from public.app_roles r
join public.app_role_ceilings c on c.base_role = r.base_role
where r.is_builtin
  and c.permission in ('registrations.read', 'registrations.write')
on conflict do nothing;


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- O CLI do Supabase não tem down-migration; o desfazimento é manual, na ordem
-- (dependências primeiro):
--
--   delete from public.app_role_permissions where permission like 'registrations.%';
--   delete from public.app_role_ceilings where permission like 'registrations.%';
--   drop function if exists public.set_participant_confirmation(uuid, public.event_participant_confirmation);
--   drop function if exists public.update_event_registration(uuid, text, public.event_registration_status);
--   drop function if exists public.create_event_registration(uuid, text, jsonb, text, text, text);
--   drop function if exists public.set_event_landing_page_status(uuid, text);
--   drop function if exists public.set_event_landing_page_image(uuid, text, text, integer);
--   drop function if exists public.update_event_landing_page(uuid, text, text, jsonb, text, text, text, timestamptz, integer);
--   drop function if exists public.create_event_landing_page(uuid, text, text, jsonb, text, text, text, timestamptz, integer);
--   drop function if exists public.lock_event_landing_page(uuid);
--   drop function if exists public.event_landing_seats_left(uuid);
--   drop function if exists public.event_landing_participant_count(uuid);
--   drop function if exists public.assert_event_landing_fields(jsonb);
--   drop function if exists public.event_landing_field_keys();
--   drop function if exists public.event_landing_free_slug(text, uuid);
--   drop function if exists public.event_landing_slugify(text);
--   drop function if exists public.registrations_is_writer();
--   drop function if exists public.registrations_is_reader();
--   drop table if exists public.event_registration_audit_logs;
--   drop table if exists public.event_participants;
--   drop table if exists public.event_registrations;
--   drop table if exists public.event_landing_pages;
--   delete from public.app_settings where key like 'events.registration_success_%';
--
-- E, depois, os tipos de 20260922000000.
--
-- ⚠️ NENHUMA TABELA EXISTENTE É ALTERADA por esta migration. `events` ganha
-- vizinhos, não colunas; `event_audit_logs` ganha valores de enum, que não têm
-- desfazimento e são inofensivos. O rollback não toca em dado de outro módulo.
-- ============================================================================
