-- ============================================================================
-- Enquetes — criação, segmentação, disparo, resposta e resultados
-- ----------------------------------------------------------------------------
-- Quinto módulo de conteúdo do CRM. Permite à APCS perguntar algo à sua base e
-- consolidar o que voltou. A primeira enquete (o valor da @ do suíno) é SEED,
-- não estrutura: nada aqui sabe o que é suíno.
--
-- ⚠️ AS QUATRO DECISÕES CENTRAIS
--
-- 1. O PORTÃO DA RESPOSTA É CALCULADO, NUNCA CONFIADO AO RELÓGIO DE NINGUÉM.
--    `can_survey_accept_responses()` confere status E janela de datas a cada
--    resposta. O §16 é explícito ("não depender apenas de cron/frontend"), e
--    aqui isso não é uma recomendação seguida: é a única porta. Se a rotina de
--    encerramento nunca rodar, uma enquete vencida continua RECUSANDO resposta
--    — ela só não muda de status sozinha. É o mesmo desenho da expiração de
--    Eventos, pelo mesmo motivo (rotina que não roda mente em silêncio).
--
-- 2. A TABELA DE RESPOSTAS NÃO TEM POLICY DE SELECT. NENHUMA.
--    O §54 manda esconder QUEM respondeu numa enquete anônima. RLS filtra
--    LINHA, não COLUNA, e não existe policy que diga "esconda `contact_id` se a
--    enquete for anônima". Então `survey_responses` é ilegível pelo PostgREST,
--    ponto — e toda leitura passa por três funções SECURITY DEFINER que aplicam
--    a regra de anonimato antes de devolver qualquer coisa. O anonimato deixa
--    de ser disciplina da aplicação e vira propriedade do banco.
--
-- 3. O GRAFO DE STATUS É DADO, NÃO CÓDIGO.
--    Igual a Palestras: as transições moram em `survey_status_transitions` e um
--    trigger recusa qualquer passo fora do grafo, em QUALQUER caminho de escrita
--    (função, PostgREST, psql). O frontend LÊ o grafo para saber quais botões
--    mostrar, em vez de repetir a regra em TypeScript.
--
-- 4. O PÚBLICO É FOTOGRAFADO NO AGENDAMENTO (§33).
--    `schedule_survey()` materializa `survey_recipients`. Depois disso, mexer
--    nos cadastros não muda mais quem recebe uma campanha já planejada — e é
--    essa mesma tabela que dá idempotência ao disparo (§38) e estado por pessoa
--    (§39, §40).
--
-- ============================================================================
-- ⚠️ O QUE ESTE MÓDULO NÃO CONSEGUE FAZER — leia antes de prometer ao cliente
-- ============================================================================
--
-- GAP 1 — NÃO EXISTE CADASTRO DE ASSOCIADOS NESTE BANCO.
--   As tabelas de pessoas são `profiles` (usuários do CRM) e `chat_contacts`
--   (quem falou com o bot). Nenhuma é um registro de associados da APCS.
--   Consequências diretas:
--     • O "associado" do §19 é, aqui, um `chat_contact`. É a única entidade com
--       telefone, que é o que o WhatsApp precisa.
--     • Das seis dimensões de segmentação do §23, TRÊS não têm onde se apoiar:
--       SEGMENTO (o catálogo `event_segments` existe, mas nada liga um contato a
--       um segmento), CATEGORIA e CARTEIRA (não existem em lugar nenhum).
--       Elas estão no enum e são RECUSADAS na escrita, com mensagem dizendo o
--       que falta — ver `assert_survey_audience`. Aceitá-las em silêncio faria a
--       enquete alcançar o público errado sem ninguém perceber, que é
--       exatamente o erro que o seed de públicos de Eventos documentou.
--     • REGIÃO, PERFIL e GRUPO ESPECÍFICO funcionam: saem de
--       `chat_contacts.state`, `chat_contacts.contact_profile` e do id do
--       contato.
--
-- GAP 2 — NÃO EXISTE ENVIO DE WHATSAPP.
--   Conferido no projeto inteiro: "whatsapp" aparece como valor de enum
--   (canal preferido de contato) e como rótulo de tela. Não há cliente de API,
--   credencial, webhook nem fornecedor. O §34 manda usar "a integração
--   existente" — ela não existe.
--   O que ESTE módulo entrega, então, é tudo o que existe em volta do envio: o
--   público fotografado, o estado por destinatário, a idempotência, a contagem
--   de tentativas e o último erro. `mark_survey_recipient()` é o ponto exato
--   onde um adaptador de fornecedor se pluga, sem tocar em mais nada.
--
-- GAP 3 — NÃO EXISTE AGENDADOR.
--   Sem cron, sem pg_cron (conferido: extensões instaladas são pg_stat_statements,
--   pgcrypto, plpgsql, supabase_vault e uuid-ossp), sem worker, e `vercel.json`
--   não declara `crons`.
--   `process_scheduled_surveys()` existe, é idempotente e faz o trabalho —
--   falta apenas QUEM a chame de tempos em tempos. Enquanto isso: a ativação
--   também é manual (`activate_survey`, que o §3 já prevê como permissão), e o
--   portão da decisão 1 garante que a ausência do agendador nunca deixe uma
--   enquete vencida aceitar resposta.
--
-- ============================================================================
-- CÓDIGOS DE ERRO — classe `SV`, mapeada em src/lib/actions/errors.ts.
-- A classe é PRÓPRIA porque a `P0` é RESERVADA pelo PL/pgSQL (P0004 é
-- `assert_failure`, que `exception when others` não captura); ver
-- 20260813000200_fix_event_error_codes.sql.
--   42501  sem permissão
--   P0002  enquete não encontrada (no_data_found, já mapeado pelo projeto)
--   SV001  transição de situação não permitida
--   SV002  há respostas — a estrutura não pode mais mudar
--   SV003  a situação atual não permite esta operação
--   SV004  janela de datas inválida
--   SV005  a enquete precisa de pergunta e alternativas
--   SV006  a segmentação não alcança nenhum contato
--   SV007  dimensão de segmentação sem cadastro de apoio (ver GAP 1)
--   SV008  enquete anônima — participantes não podem ser identificados
--   SV009  alternativa inválida para esta pergunta
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
-- §9. RASCUNHO · AGENDADA · ATIVA · ENCERRADA · CANCELADA.
create type public.survey_status as enum (
  'draft',     -- RASCUNHO   — em construção, não recebe resposta, não é enviada
  'scheduled', -- AGENDADA   — público fotografado, aguardando o disparo
  'active',    -- ATIVA      — recebe resposta
  'closed',    -- ENCERRADA  — terminal; mantém resultados
  'cancelled'  -- CANCELADA  — terminal; mantém histórico
);

comment on type public.survey_status is
  'Situação da enquete. As transições permitidas estão em survey_status_transitions.';

-- §5. Os seis tipos ficam no enum porque o §5 manda preservar o CONCEITO. O que
-- limita o MVP a SINGLE_CHOICE é o CHECK `survey_questions_mvp_type` — uma
-- linha, removível quando o tipo seguinte for implementado de ponta a ponta.
--
-- Enum e não tabela, pelo padrão do projeto: é o que dá checagem em tempo de
-- compilação no TypeScript via `pnpm db:types`.
create type public.survey_answer_type as enum (
  'single_choice',
  'multiple_choice',
  'yes_no',
  'scale',
  'text',
  'rating'
);

-- §23. As seis dimensões do escopo, mais `all` (§24).
--
-- ⚠️ `segment`, `category` e `portfolio` existem aqui mas são RECUSADAS na
-- escrita — ver GAP 1 no cabeçalho e `assert_survey_audience`. Estão no enum
-- para que ligá-las, quando o cadastro de associados existir, seja um `delete`
-- de três linhas de validação e não um `alter type` (que não roda dentro de
-- transação e obriga migration própria).
create type public.survey_audience_dimension as enum (
  'all',       -- §24 TODOS OS ASSOCIADOS
  'segment',   -- §25 (sem cadastro de apoio)
  'category',  -- §26 (sem cadastro de apoio)
  'region',    -- §27 → chat_contacts.state
  'profile',   -- §28 → chat_contacts.contact_profile
  'portfolio', -- §29 (sem cadastro de apoio)
  'contact'    -- §30 GRUPO ESPECÍFICO → chat_contacts.id
);

-- §39. Progressão, não conjunto solto: quem RESPONDEU necessariamente recebeu.
-- A ordem importa para a taxa de participação (§52) — ver `survey_metrics`.
create type public.survey_recipient_status as enum (
  'pending',
  'sent',
  'delivered',
  'read',
  'responded',
  'error'
);

-- §37/§38. O estado de uma EXECUÇÃO de disparo (a corrida), distinto do estado
-- de cada destinatário (a pessoa).
create type public.survey_dispatch_status as enum (
  'pending',
  'running',
  'completed',
  'failed'
);

-- §43/§44/§47/§48/§49/§50. O bot precisa de uma resposta que ele saiba
-- transformar em frase. Um enum (e não um booleano com exceção) porque são seis
-- desfechos com seis textos diferentes, e colapsar dois deles faria o bot pedir
-- à pessoa que refizesse algo que já estava certo.
create type public.survey_response_outcome as enum (
  'registered',       -- §46 registrada agora
  'already_answered', -- §47 esta pessoa já participou
  'invalid_option',   -- §44 a opção escolhida não existe
  'not_active',       -- §50 rascunho ou agendada
  'closed',           -- §48 encerrada (por status ou por data)
  'cancelled',        -- §49 cancelada
  'not_found'         -- a enquete não existe
);

-- §62. Uma ação por acontecimento. Cancelar e encerrar registram a ação PRÓPRIA
-- em vez de um `survey_updated` genérico: sem isso, "quantas foram canceladas?"
-- viraria uma consulta ao conteúdo do jsonb.
create type public.survey_audit_action as enum (
  'survey_created',
  'survey_updated',
  'survey_question_updated',
  'survey_audience_updated',
  'survey_scheduled',
  'survey_activated',
  'survey_dispatched',
  'survey_closed',
  'survey_cancelled',
  'survey_response_registered'
);

-- ----------------------------------------------------------------------------
-- 2. Enquetes (§4)
-- ----------------------------------------------------------------------------
create table public.surveys (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  description text,

  -- §4 sem DEFAULT: quem cria diz onde entra, e o trigger confere que aquele
  -- ponto de entrada é legítimo. (Na prática só existe um: `draft`.)
  status public.survey_status not null,

  -- §15/§16/§35. `timestamptz`, e aqui a escolha é DIFERENTE da de Eventos e
  -- Palestras — que guardam `date` + `time` separados de propósito.
  --
  -- O motivo da diferença: lá o que se marca é "dia 20, às 14h" (um compromisso
  -- no calendário de quem vai). Aqui o que se marca é O INSTANTE EM QUE A URNA
  -- FECHA — uma fronteira absoluta na linha do tempo, que precisa valer igual
  -- para o servidor em UTC, para o associado e para quem lê o resultado. Um
  -- `date`+`time` sem fuso teria de ser interpretado por alguém, e "alguém" é
  -- onde nasce a resposta aceita um minuto depois do fim.
  starts_at timestamptz,
  ends_at timestamptz,

  -- §35. Distinto de `starts_at` de propósito: o §15 diz que `data_inicio`
  -- ativa a enquete e o §35 pede "data e horário de ENVIO". São dois instantes
  -- que costumam coincidir mas não precisam — abrir a urna à meia-noite e
  -- mandar o WhatsApp às 9h é exatamente o que se quer fazer. O CHECK abaixo
  -- impede o contrário (enviar antes de abrir), que geraria resposta recusada.
  scheduled_at timestamptz,

  -- §21. A apresentação dos resultados respeita isto; o vínculo técnico em
  -- `survey_responses.contact_id` continua existindo para garantir uma resposta
  -- por pessoa, como o próprio §21 autoriza.
  is_anonymous boolean not null default false,

  -- §20. Por padrão NÃO. Existe como coluna, e não como constante, porque o §20
  -- já antecipa que a APCS pode querer o contrário um dia.
  allows_response_change boolean not null default false,

  -- §22. No MVP sempre habilitada; o CHECK abaixo impõe enquanto for assim.
  single_response_only boolean not null default true,

  -- §4 "Imagem opcional". Bucket privado `surveys`, mesmo desenho de `events`.
  -- Os três andam juntos — o CHECK impede meia imagem.
  image_path text unique,
  image_mime text,
  image_size_bytes integer,

  -- §68. Busca SEM ACENTO resolvida no banco, porque a listagem é paginada no
  -- servidor (§67) e `ilike '%valor da a%'` não acha "Valor da @". Espelha
  -- `normalizeForSearch` (src/lib/utils.ts). Este banco não tem `unaccent` nem
  -- `pg_trgm` (conferido), e `unaccent` não seria usável numa coluna gerada de
  -- qualquer forma, porque não é IMMUTABLE. `translate` é.
  search_text text generated always as (
    translate(
      lower(coalesce(title, '') || ' ' || coalesce(description, '')),
      'áàâãäåéèêëíìîïóòôõöúùûüçñ',
      'aaaaaaeeeeiiiiooooouuuucn'
    )
  ) stored,

  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),

  constraint surveys_title_len check (char_length(title) between 3 and 200),
  constraint surveys_description_len
    check (description is null or char_length(description) <= 2000),

  -- §17. ESTRITAMENTE maior: o escopo recusa igual e recusa menor, e diz os dois
  -- em frases separadas justamente porque `>=` seria o erro fácil de cometer.
  constraint surveys_window_order
    check (starts_at is null or ends_at is null or ends_at > starts_at),

  -- Enviar antes de abrir produziria resposta recusada em massa — a pessoa
  -- recebe o convite e leva "esta enquete ainda não está ativa".
  constraint surveys_dispatch_after_start
    check (scheduled_at is null or starts_at is null or scheduled_at >= starts_at),

  -- §22. Some quando a configuração for de verdade.
  constraint surveys_mvp_single_response check (single_response_only),

  constraint surveys_image_trio check (
    (image_path is null and image_mime is null and image_size_bytes is null)
    or (image_path is not null and image_mime is not null and image_size_bytes is not null)
  ),
  constraint surveys_image_mime
    check (image_mime is null or image_mime in ('image/jpeg', 'image/png', 'image/webp')),
  constraint surveys_image_size
    check (image_size_bytes is null or (image_size_bytes > 0 and image_size_bytes <= 5242880))
);

comment on table public.surveys is
  'Enquetes da APCS. Genérica e parametrizável: nada aqui conhece o assunto de nenhuma enquete específica.';

comment on column public.surveys.is_anonymous is
  '§21. Esconde QUEM respondeu O QUÊ. O vínculo técnico continua existindo para garantir uma resposta por pessoa.';

comment on column public.surveys.scheduled_at is
  '§35. Instante do ENVIO. Distinto de starts_at (§15), que é o instante em que a urna abre.';

-- §66. A listagem filtra por situação e ordena por criação.
create index surveys_status_idx on public.surveys (status, created_at desc);

-- §37. A varredura do agendador: "o que está agendado e já venceu". Parcial,
-- porque é sempre sobre o mesmo recorte e o índice fica uma fração do tamanho.
create index surveys_scheduled_idx
  on public.surveys (scheduled_at)
  where status = 'scheduled';

-- §57. A varredura do encerramento automático, pelo mesmo raciocínio.
create index surveys_ends_at_idx
  on public.surveys (ends_at)
  where status = 'active';

-- §68 filtro por período.
create index surveys_window_idx on public.surveys (starts_at, ends_at);

-- ⚠️ `search_text` NÃO tem índice: `ilike '%termo%'` só é indexável com
-- `pg_trgm`, que não está instalado neste banco. No volume esperado (dezenas de
-- enquetes) a varredura é barata. Mesma decisão, e mesmo caminho de
-- crescimento, de Palestras.

-- ----------------------------------------------------------------------------
-- 3. Perguntas (§6)
-- ----------------------------------------------------------------------------
-- Tabela separada, com `position`, embora o MVP tenha UMA pergunta por enquete.
-- É o §6 pedindo que a modelagem permita várias sem mudança estrutural — e o
-- custo de fazer isso agora é uma tabela; o custo de fazer depois é migrar
-- respostas já gravadas.
--
-- ⚠️ `answer_type` mora AQUI, e não em `surveys` como a lista do §4 sugere. É
-- desvio consciente e o §64 o autoriza ("criar modelagem normalizada"): com o
-- tipo na enquete, o dia em que existirem várias perguntas todas seriam
-- obrigadas a ter o mesmo tipo — e uma enquete com uma escolha única seguida de
-- um comentário livre é o caso mais banal que existe.
create table public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys on delete cascade,

  position integer not null default 1,
  text text not null,
  answer_type public.survey_answer_type not null default 'single_choice',
  required boolean not null default true,

  created_at timestamptz not null default now(),

  constraint survey_questions_text_len check (char_length(text) between 3 and 500),
  constraint survey_questions_position check (position > 0),

  -- §5. O único tipo habilitado no MVP. Remover esta linha é o passo 1 de
  -- habilitar o próximo — os demais valores já existem no enum.
  constraint survey_questions_mvp_type check (answer_type = 'single_choice')
);

comment on table public.survey_questions is
  'Perguntas da enquete. O MVP grava uma; a modelagem já comporta várias (§6).';

create unique index survey_questions_position_idx
  on public.survey_questions (survey_id, position);

-- ----------------------------------------------------------------------------
-- 4. Alternativas (§7)
-- ----------------------------------------------------------------------------
create table public.survey_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.survey_questions on delete cascade,

  -- §7. A ordem é PERSISTIDA, e não derivada da inserção: é ela que vira o
  -- número que a pessoa digita no WhatsApp (§41), então tem de ser estável.
  position integer not null,
  text text not null,

  -- §61. Alternativa com resposta NUNCA é apagada — vira inativa. Sem isto, um
  -- resultado histórico perderia o rótulo do que foi votado.
  active boolean not null default true,

  created_at timestamptz not null default now(),

  constraint survey_options_text_len check (char_length(text) between 1 and 200),
  constraint survey_options_position check (position > 0)
);

comment on table public.survey_options is
  'Alternativas de uma pergunta. `position` é o número que a pessoa digita no chat (§41). Alternativa respondida vira inativa, nunca é apagada (§61).';

create unique index survey_options_position_idx
  on public.survey_options (question_id, position);

create index survey_options_question_idx on public.survey_options (question_id);

-- ----------------------------------------------------------------------------
-- 5. Segmentação (§23 a §31)
-- ----------------------------------------------------------------------------
-- Uma LINHA POR CRITÉRIO, e não colunas por dimensão. É o que permite "Região =
-- SP ou PR" e "Perfil = produtor" convivendo na mesma enquete sem que a tabela
-- ganhe uma coluna a cada dimensão nova.
--
-- ⚠️ A REGRA DE COMBINAÇÃO (§31), escrita uma vez e imposta em
-- `resolve_survey_audience`:
--
--     OR dentro da mesma dimensão   ·   AND entre dimensões diferentes
--
--     Região ∈ {SP, PR}  E  Perfil ∈ {produtor}
--
-- É a leitura que o §31 recomenda e a única que corresponde ao que uma pessoa
-- quer dizer ao marcar duas regiões: "de São Paulo OU do Paraná", nunca "de São
-- Paulo E do Paraná ao mesmo tempo", que não alcançaria ninguém.
create table public.survey_audience_criteria (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys on delete cascade,

  dimension public.survey_audience_dimension not null,

  -- Exatamente UM destes três é preenchido, conforme a dimensão. FKs de verdade
  -- onde há para onde apontar: um id de contato guardado como texto viraria
  -- órfão silencioso no dia em que o contato exercesse o direito de eliminação.
  segment_id uuid references public.event_segments on delete restrict,
  contact_id uuid references public.chat_contacts on delete cascade,
  -- Dimensões escalares: a UF (§27) ou o perfil (§28).
  value text,

  created_at timestamptz not null default now(),

  -- O CHECK que impede um critério meio preenchido — "dimensão = região" sem
  -- dizer qual região seria um filtro que não filtra.
  constraint survey_audience_shape check (
    case dimension
      when 'all' then segment_id is null and contact_id is null and value is null
      when 'segment' then segment_id is not null and contact_id is null and value is null
      when 'contact' then contact_id is not null and segment_id is null and value is null
      else segment_id is null and contact_id is null and value is not null
    end
  ),
  constraint survey_audience_value_len
    check (value is null or char_length(value) between 1 and 120)
);

comment on table public.survey_audience_criteria is
  'Critérios de segmentação. OR dentro da dimensão, AND entre dimensões (§31).';

-- Sem duplicata: marcar "SP" duas vezes não muda o público e sujaria a
-- auditoria. `coalesce` porque índice único trata NULL como distinto de NULL, e
-- sem ele dois critérios `all` conviveriam.
create unique index survey_audience_unique_idx
  on public.survey_audience_criteria (
    survey_id,
    dimension,
    coalesce(segment_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(contact_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(value, '')
  );

create index survey_audience_survey_idx on public.survey_audience_criteria (survey_id);

-- ----------------------------------------------------------------------------
-- 6. Destinatários — a fotografia do público (§32, §33, §39, §40)
-- ----------------------------------------------------------------------------
create table public.survey_recipients (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys on delete cascade,

  -- `set null` + snapshot, exatamente como `lectures.requester_*`:
  -- `chat_contacts` tem policy de DELETE para admin (LGPD art. 18), e sem o
  -- snapshot atender um pedido de eliminação apagaria também a resposta para
  -- "para quantas pessoas esta campanha foi?", que é registro operacional.
  contact_id uuid references public.chat_contacts on delete set null,
  contact_name text,
  contact_phone text,

  status public.survey_recipient_status not null default 'pending',

  -- §40. Contagem de tentativas, última tentativa e último erro. O teto do
  -- retry é política de quem dispara — a coluna existe para que exista teto.
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  last_error text,

  -- §42/§73. O id que o fornecedor devolve. É por ele que um webhook de
  -- "entregue"/"lido" encontra a linha sem precisar adivinhar pelo telefone.
  provider_message_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint survey_recipients_attempts check (attempts >= 0),
  constraint survey_recipients_error_len
    check (last_error is null or char_length(last_error) <= 1000)
);

comment on table public.survey_recipients is
  'Fotografia do público no agendamento (§33) + estado de envio por pessoa (§39). A unicidade (survey_id, contact_id) é a idempotência do disparo (§38).';

-- §38. A GARANTIA DE NÃO ENVIAR DUAS VEZES. Não é uma checagem que o job faz —
-- é uma impossibilidade: rodar o disparo duas vezes esbarra aqui.
create unique index survey_recipients_unique_idx
  on public.survey_recipients (survey_id, contact_id)
  where contact_id is not null;

-- A fila do disparo: "desta enquete, quem ainda está pendente".
create index survey_recipients_status_idx on public.survey_recipients (survey_id, status);

create unique index survey_recipients_provider_idx
  on public.survey_recipients (provider_message_id)
  where provider_message_id is not null;

-- ----------------------------------------------------------------------------
-- 7. Execuções de disparo (§37, §38)
-- ----------------------------------------------------------------------------
-- A CORRIDA, distinta da PESSOA (que é `survey_recipients`). Guarda quando o
-- disparo rodou, quantos ele tocou e como terminou — sem isto, "por que 12
-- pessoas ficaram em erro na terça?" não tem onde ser respondido.
create table public.survey_dispatches (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys on delete cascade,

  status public.survey_dispatch_status not null default 'pending',

  total_recipients integer not null default 0,
  total_sent integer not null default 0,
  total_errors integer not null default 0,

  started_at timestamptz not null default now(),
  finished_at timestamptz,
  last_error text,

  -- Nulo quando quem disparou foi a rotina, e não uma pessoa.
  created_by uuid references public.profiles on delete set null default auth.uid(),

  constraint survey_dispatches_counts check (
    total_recipients >= 0 and total_sent >= 0 and total_errors >= 0
  )
);

comment on table public.survey_dispatches is
  'Uma linha por EXECUÇÃO de disparo. O estado por pessoa fica em survey_recipients.';

create index survey_dispatches_survey_idx
  on public.survey_dispatches (survey_id, started_at desc);

-- ----------------------------------------------------------------------------
-- 8. Respostas (§18, §19, §63, §65, §81)
-- ----------------------------------------------------------------------------
create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),

  survey_id uuid not null references public.surveys on delete cascade,
  question_id uuid not null references public.survey_questions on delete cascade,

  -- §61. `restrict`: uma alternativa votada não pode sumir por baixo do
  -- resultado. A FK é a garantia; `active = false` é o caminho legítimo.
  option_id uuid not null references public.survey_options on delete restrict,

  -- §19. O "associado" possível neste banco — ver GAP 1 no cabeçalho.
  --
  -- `restrict` (e não `set null`): sem o contato, a unicidade de §18 deixaria de
  -- valer e a mesma pessoa poderia responder de novo. Um pedido de eliminação
  -- LGPD sobre alguém que respondeu enquete precisa de decisão explícita
  -- (anonimizar o contato, ou apagar a resposta junto) — e é melhor que ele
  -- FALHE pedindo essa decisão do que silenciosamente abra uma segunda urna.
  contact_id uuid not null references public.chat_contacts on delete restrict,

  answered_at timestamptz not null default now(),

  -- §73. O id da mensagem que originou a resposta. É a idempotência: o mesmo
  -- webhook reentregue não vira segunda resposta nem "você já participou".
  source_message_id text,

  created_at timestamptz not null default now(),

  constraint survey_responses_source_len
    check (source_message_id is null or char_length(source_message_id) between 1 and 200)
);

comment on table public.survey_responses is
  'Respostas. SEM POLICY DE SELECT — toda leitura passa pelas funções de resultado, que aplicam o anonimato (§54).';

-- §18/§65. UMA resposta por pessoa por enquete, imposta pelo banco. É esta linha
-- que faz a regra valer mesmo sob duas requisições simultâneas (§81).
create unique index survey_responses_unique_idx
  on public.survey_responses (survey_id, contact_id);

-- §73. Retry técnico não vira segunda resposta.
create unique index survey_responses_message_idx
  on public.survey_responses (source_message_id)
  where source_message_id is not null;

-- §53. A consolidação por alternativa.
create index survey_responses_option_idx on public.survey_responses (option_id);
create index survey_responses_survey_idx on public.survey_responses (survey_id, answered_at desc);

-- ----------------------------------------------------------------------------
-- 9. Trilha de auditoria (§62, §63)
-- ----------------------------------------------------------------------------
-- Espelha `event_audit_logs`, `market_bulletin_audit_logs` e
-- `lecture_audit_logs`. Tabela própria, e não uma delas, porque cada uma tem FK
-- e enum próprios — só o PADRÃO é reutilizável. A unificação numa auditoria de
-- plataforma segue sendo o módulo #8 do roadmap, agora com quatro casos na mão.
create table public.survey_audit_logs (
  id bigint generated always as identity primary key,
  survey_id uuid references public.surveys on delete set null,
  action public.survey_audit_action not null,
  actor_id uuid references public.profiles on delete set null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.survey_audit_logs is
  'Trilha imutável. ⚠️ Em enquete anônima, a linha de resposta NÃO grava quem respondeu — ver register_survey_response.';

create index survey_audit_logs_survey_idx
  on public.survey_audit_logs (survey_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 10. O grafo de situações (§9)
-- ----------------------------------------------------------------------------
-- TABELA, e não `if` dentro de função — mesma decisão de Palestras, pelos mesmos
-- três ganhos: mudar o fluxo é um insert numa migration; o frontend LÊ o grafo
-- para decidir os botões; e a regra vale em TODO caminho de escrita, porque quem
-- a aplica é um trigger.
--
-- `from_status` NULO = ponto de entrada. Por isso a chave são dois índices
-- parciais e não uma primary key: PK não aceita nulo.
create table public.survey_status_transitions (
  from_status public.survey_status,
  to_status public.survey_status not null,
  created_at timestamptz not null default now()
);

comment on table public.survey_status_transitions is
  'Transições permitidas. from_status NULO = ponto de entrada (situação com que uma enquete pode nascer).';

create unique index survey_status_transitions_pair_idx
  on public.survey_status_transitions (from_status, to_status)
  where from_status is not null;

create unique index survey_status_transitions_entry_idx
  on public.survey_status_transitions (to_status)
  where from_status is null;

-- ENTRADA: só rascunho. O §9 desenha o fluxo começando em RASCUNHO, e nascer
-- ATIVA puloria a fotografia do público (§33) — a enquete receberia resposta sem
-- nunca ter tido destinatário.
insert into public.survey_status_transitions (from_status, to_status) values
  (null, 'draft');

-- O fluxo principal do §9.
insert into public.survey_status_transitions (from_status, to_status) values
  ('draft',     'scheduled'),
  ('scheduled', 'active'),
  ('active',    'closed');

-- §14/§59. Cancelamento sai de qualquer situação não terminal.
insert into public.survey_status_transitions (from_status, to_status) values
  ('draft',     'cancelled'),
  ('scheduled', 'cancelled'),
  ('active',    'cancelled');

-- §11. Desagendar: volta ao rascunho para corrigir algo antes do disparo. É a
-- ÚNICA volta do grafo, e ela existe porque o §11 diz que uma AGENDADA "pode ser
-- editada conforme regras" — sem ela, um erro de data só teria saída pelo
-- cancelamento, e cancelar é terminal.
--
-- ⚠️ `unschedule_survey` descarta a fotografia do público junto. Tem de ser
-- assim: a lista foi tirada com a segmentação antiga, e reagendar depois de
-- mudar o público precisa tirar foto nova.
insert into public.survey_status_transitions (from_status, to_status) values
  ('scheduled', 'draft');

-- ⚠️ NÃO EXISTE `closed → active` (§13, explícito) nem volta de `cancelled`
-- (§14: mantém histórico). Os dois são terminais de verdade.

-- ----------------------------------------------------------------------------
-- 11. Row Level Security
-- ----------------------------------------------------------------------------
-- Espelha PERMISSION_MATRIX em src/lib/rbac/rbac.config.ts:
--   surveys.read  → admin, ceo, comercial   (Administrador, Gestor, Atendente)
--   surveys.write → admin, ceo              (Administrador, Gestor)
-- É o §3 do escopo: ADMINISTRADOR e GESTOR fazem tudo; o ATENDENTE VISUALIZA.
--
-- ⚠️ TODA policy usa `(select public.current_app_role())`, com o subselect.
-- Não é estilo: sem ele o Postgres avalia a função UMA VEZ POR LINHA em vez de
-- uma vez por consulta. Medido neste projeto, em Palestras, com 20 mil linhas:
-- 376 ms → 6,4 ms. Ver 20260818000000_lecture_rls_initplan.sql.
alter table public.surveys enable row level security;
alter table public.survey_questions enable row level security;
alter table public.survey_options enable row level security;
alter table public.survey_audience_criteria enable row level security;
alter table public.survey_recipients enable row level security;
alter table public.survey_dispatches enable row level security;
alter table public.survey_responses enable row level security;
alter table public.survey_status_transitions enable row level security;
alter table public.survey_audit_logs enable row level security;

create policy "surveys_select"
  on public.surveys for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

create policy "surveys_insert"
  on public.surveys for insert
  with check (
    (select public.current_app_role()) in ('admin', 'ceo')
    and created_by = (select auth.uid())
  );

-- `updated_by = auth.uid()` no WITH CHECK impede assinar a alteração com o nome
-- de outra pessoa E impede alteração anônima.
create policy "surveys_update"
  on public.surveys for update
  using ((select public.current_app_role()) in ('admin', 'ceo'))
  with check (
    (select public.current_app_role()) in ('admin', 'ceo')
    and updated_by = (select auth.uid())
  );

-- Pergunta e alternativas: leitura para quem lê enquete; escrita para quem
-- escreve. As REGRAS de quando a estrutura pode mudar (§60/§61) não estão aqui —
-- estão em `assert_survey_structure_editable`, porque dependem de haver
-- respostas, o que uma policy não sabe expressar sem uma subconsulta por linha.
create policy "survey_questions_select"
  on public.survey_questions for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

create policy "survey_questions_write"
  on public.survey_questions for all
  using ((select public.current_app_role()) in ('admin', 'ceo'))
  with check ((select public.current_app_role()) in ('admin', 'ceo'));

create policy "survey_options_select"
  on public.survey_options for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

create policy "survey_options_write"
  on public.survey_options for all
  using ((select public.current_app_role()) in ('admin', 'ceo'))
  with check ((select public.current_app_role()) in ('admin', 'ceo'));

create policy "survey_audience_criteria_select"
  on public.survey_audience_criteria for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

create policy "survey_audience_criteria_write"
  on public.survey_audience_criteria for all
  using ((select public.current_app_role()) in ('admin', 'ceo'))
  with check ((select public.current_app_role()) in ('admin', 'ceo'));

-- §21 autoriza "controle de participação" mesmo em enquete anônima: saber QUEM
-- participou é diferente de saber QUEM RESPONDEU O QUÊ. O primeiro é gestão de
-- campanha; o segundo é o que o §54 protege — e só a segunda informação está em
-- `survey_responses`, que ninguém lê.
create policy "survey_recipients_select"
  on public.survey_recipients for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

-- Sem policy de escrita: destinatário nasce da fotografia (`schedule_survey`) e
-- muda de estado por `mark_survey_recipient`. Editar a lista à mão desfaria a
-- garantia do §33.

create policy "survey_dispatches_select"
  on public.survey_dispatches for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

-- ⚠️ `survey_responses` NÃO TEM POLICY DE SELECT, e é a decisão 2 do cabeçalho.
-- Com RLS ligada e nenhuma policy, a tabela é ilegível pelo PostgREST para
-- `authenticated` e `anon` — inclusive para o admin. As três funções de
-- resultado são a única porta, e elas aplicam o §54 antes de devolver linha.
--
-- Sem policy de escrita também: resposta entra por `register_survey_response`,
-- que é SECURITY DEFINER e só o servidor chama.

create policy "survey_status_transitions_select"
  on public.survey_status_transitions for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

-- A trilha é mais estreita que a leitura, como nos outros módulos: o Atendente
-- consulta enquetes, não o histórico de quem mexeu nelas.
create policy "survey_audit_logs_select"
  on public.survey_audit_logs for select
  using ((select public.current_app_role()) in ('admin', 'ceo'));

create policy "survey_audit_logs_insert"
  on public.survey_audit_logs for insert
  with check (
    (select public.current_app_role()) in ('admin', 'ceo')
    and actor_id = (select auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 12. Grants de coluna (RLS filtra LINHA, não COLUNA)
-- ----------------------------------------------------------------------------
-- Sem isto, um `ceo` chamando o PostgREST direto com o próprio JWT reescreveria
-- `created_by`, `created_at` ou `status` de uma enquete alheia — a policy de
-- update deixaria passar, porque ela olha a linha, não as colunas tocadas.
--
-- ⚠️ As funções da seção 15 são SECURITY INVOKER (menos onde está dito), então
-- estes grants valem DENTRO delas também. É de propósito: uma função que
-- pudesse mais que quem a chama seria o jeito de contornar esta seção.
revoke insert on public.surveys from authenticated, anon;
grant insert (
  id, title, description, status, starts_at, ends_at, scheduled_at,
  is_anonymous, allows_response_change, single_response_only,
  image_path, image_mime, image_size_bytes, created_by
) on public.surveys to authenticated;

revoke update on public.surveys from authenticated, anon;
grant update (
  title, description, status, starts_at, ends_at, scheduled_at,
  is_anonymous, allows_response_change,
  image_path, image_mime, image_size_bytes, updated_by, updated_at
) on public.surveys to authenticated;

-- §10. Rascunho pode ser descartado. Depois de agendada, não: já existe
-- fotografia de público, e depois de ativa existe resposta. O controle é
-- CANCELADA. A regra de "só rascunho" está em `delete_survey`; o revoke aqui
-- impede o atalho pelo PostgREST.
revoke delete on public.surveys from authenticated, anon;

-- O grafo não se edita pela aplicação.
revoke insert, update, delete on public.survey_status_transitions from authenticated, anon;

-- A fotografia do público e as corridas de disparo não se editam à mão.
revoke insert, update, delete on public.survey_recipients from authenticated, anon;
revoke insert, update, delete on public.survey_dispatches from authenticated, anon;

-- A resposta não se escreve nem se reescreve por fora.
revoke insert, update, delete on public.survey_responses from authenticated, anon;

-- A trilha não se reescreve nem se apaga.
revoke update, delete on public.survey_audit_logs from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 13. updated_at automático
-- ----------------------------------------------------------------------------
create trigger on_surveys_updated
  before update on public.surveys
  for each row execute procedure public.handle_updated_at();

create trigger on_survey_recipients_updated
  before update on public.survey_recipients
  for each row execute procedure public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 14. O guarda do módulo
-- ----------------------------------------------------------------------------
-- Impõe, em QUALQUER caminho de escrita:
--   • a situação inicial é um ponto de entrada declarado (§9)
--   • toda mudança de situação é uma aresta declarada (§9, §13, §14)
--
-- ⚠️ SECURITY DEFINER, e o motivo é sutil (o mesmo de Palestras): a função LÊ
-- `survey_status_transitions`, que tem RLS. Como INVOKER, um chamador sem SELECT
-- naquela tabela leria ZERO linhas, o `not exists` daria verdadeiro e TODA
-- transição seria recusada. Um trigger de segurança que falha fechado pelo
-- motivo errado é um trigger que ninguém consegue depurar.
--
-- O risco de DEFINER aqui é nulo: não recebe entrada dinâmica, não monta SQL,
-- tem `search_path = ''` e só lê um catálogo estático.
create or replace function public.enforce_survey_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.survey_status_transitions
      where from_status is null and to_status = new.status
    ) then
      raise exception 'Uma enquete não pode ser criada na situação "%".', new.status
        using errcode = 'SV001';
    end if;

    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if not exists (
    select 1 from public.survey_status_transitions
    where from_status = old.status and to_status = new.status
  ) then
    raise exception 'Não é possível mudar a situação de "%" para "%".', old.status, new.status
      using errcode = 'SV001';
  end if;

  return new;
end;
$$;

comment on function public.enforce_survey_rules() is
  'Guarda do módulo: valida o ponto de entrada e o grafo de transições, em qualquer caminho de escrita.';

create trigger surveys_guard
  before insert or update on public.surveys
  for each row execute procedure public.enforce_survey_rules();

-- ----------------------------------------------------------------------------
-- 15. Operações transacionais
-- ----------------------------------------------------------------------------
-- Criar, editar, agendar ou responder são sempre VÁRIAS escritas que precisam
-- acontecer juntas ou não acontecer. O supabase-js não faz transação de várias
-- chamadas, então isso vive no banco (§80).

-- ----------------------------------------------------------------------------
-- 15.0 Quem pode escrever, quem pode ler — e por que não basta `not in (...)`
-- ----------------------------------------------------------------------------
-- ⚠️ ESTAS DUAS FUNÇÕES CORRIGEM UM FURO REAL, ENCONTRADO NA BATERIA DE
-- PERMISSÕES DESTE MÓDULO. Vale escrever o mecanismo por inteiro, porque o
-- mesmo descuido cabe em qualquer módulo futuro.
--
-- `current_app_role()` devolve NULL para quem não tem perfil — o chat anônimo, o
-- `service_role`, uma sessão de psql. E em SQL:
--
--     NULL in ('admin', 'ceo')      →  NULL
--     NULL not in ('admin', 'ceo')  →  NULL
--
-- Um `if <NULL> then raise` NÃO dispara: `if` trata NULL como falso. Ou seja, a
-- escrita `if role not in ('admin','ceo') then raise` deixa passar EXATAMENTE
-- quem não tem papel nenhum — em silêncio, sem erro, sem log.
--
-- Nas funções SECURITY INVOKER isso é inofensivo: a RLS barra em seguida. Nas
-- SECURITY DEFINER, a checagem é a ÚNICA barreira — e as três funções de
-- resultado (seção 16) são DEFINER por necessidade, porque `survey_responses`
-- não tem policy de SELECT. Medido contra este banco antes da correção:
--
--     set role anon;
--     select * from public.survey_participants('<id>');
--     →  devolveu a lista de quem respondeu, COM NOME.
--
-- O `coalesce(..., false)` abaixo fecha isso, e a seção 17 fecha a outra ponta
-- (o `anon` não tem mais EXECUTE em função nenhuma deste módulo).
create or replace function public.survey_is_writer()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select public.current_app_role()) in ('admin', 'ceo'), false)
    -- A válvula para quem NÃO É USUÁRIO FINAL: sem `auth.uid()` não há perfil a
    -- consultar. Quem chega aqui assim é o servidor (`service_role`, que ignora
    -- RLS de qualquer forma) ou o dono do banco (migration, seed, operação) —
    -- recusá-los não fecharia porta nenhuma e quebraria a rotina e o seed.
    -- O chat anônimo NÃO chega: `anon` não tem EXECUTE (seção 17).
    or (select auth.uid()) is null;
$$;

comment on function public.survey_is_writer() is
  'Pode escrever enquete (§3: Administrador e Gestor). O coalesce é a correção do furo de NULL — ver o comentário da seção 15.0.';

create or replace function public.survey_is_reader()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- ⚠️ SEM a válvula de `auth.uid() is null` da escrita, e de propósito: as três
  -- funções que usam esta checagem são SECURITY DEFINER e DEVOLVEM DADO. Aqui
  -- quem não tem papel de leitura é recusado, ponto — inclusive uma chamada sem
  -- sessão. É esta assimetria que fecha o vazamento descrito acima.
  select coalesce((select public.current_app_role()) in ('admin', 'ceo', 'comercial'), false);
$$;

comment on function public.survey_is_reader() is
  'Pode ler resultado (§3: Administrador, Gestor e Atendente). Sem válvula para chamada sem sessão — estas funções expõem dado.';

revoke execute on function public.survey_is_writer() from public, anon;
grant execute on function public.survey_is_writer() to authenticated;
revoke execute on function public.survey_is_reader() from public, anon;
grant execute on function public.survey_is_reader() to authenticated;

-- Serializa operações concorrentes sobre a MESMA enquete.
--
-- Lock consultivo e não `select ... for update`: em tabela com RLS, `for update`
-- também exige policy e privilégio de UPDATE, e o Atendente tem SELECT mas não
-- UPDATE — um `for update` numa leitura dele quebraria.
create or replace function public.lock_survey(p_survey_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.survey_is_writer() then
    raise exception 'Sem permissão para alterar enquetes.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('survey:' || p_survey_id::text));
end;
$$;

revoke execute on function public.lock_survey(uuid) from public, anon;
grant execute on function public.lock_survey(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 15.1 O portão da resposta (§12, §16, §48, §49, §50, §57)
-- ----------------------------------------------------------------------------
-- ⚠️ A FUNÇÃO MAIS IMPORTANTE DESTE ARQUIVO.
--
-- Devolve POR QUE a enquete não aceita resposta, ou 'registered' se aceita — o
-- desfecho vira frase no chat sem que o bot precise reimplementar a regra.
--
-- A ordem das checagens é a ordem em que a pessoa precisa saber:
--   não existe → cancelada → encerrada (por status OU por data) → ainda não
--   ativa → aceita.
--
-- `stable`, não `volatile`: só lê. E SECURITY DEFINER porque o chamador é o
-- servidor com `service_role` (que ignora RLS de qualquer forma) mas também as
-- funções de escrita — e uma delas rodando como um papel sem SELECT em
-- `surveys` leria zero linhas e concluiria "não existe".
create or replace function public.survey_response_gate(p_survey_id uuid)
returns public.survey_response_outcome
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.surveys;
begin
  select * into v from public.surveys where id = p_survey_id;
  if not found then
    return 'not_found';
  end if;

  if v.status = 'cancelled' then
    return 'cancelled';
  end if;

  if v.status = 'closed' then
    return 'closed';
  end if;

  if v.status <> 'active' then
    return 'not_active';
  end if;

  -- ⚠️ AQUI mora o §16. Mesmo ATIVA, uma enquete cuja janela fechou não aceita
  -- resposta. Se o encerramento automático nunca rodar, a urna já está fechada;
  -- só o rótulo é que continua dizendo "ativa" até alguém (ou a rotina) mudar.
  if v.ends_at is not null and now() >= v.ends_at then
    return 'closed';
  end if;

  -- E o simétrico: ativada antes da hora não abre a urna antes da hora.
  if v.starts_at is not null and now() < v.starts_at then
    return 'not_active';
  end if;

  return 'registered';
end;
$$;

comment on function public.survey_response_gate(uuid) is
  '§16. A urna fecha por DATA, não por rotina. Devolve o desfecho que o bot transforma em frase.';

revoke execute on function public.survey_response_gate(uuid) from public;
grant execute on function public.survey_response_gate(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 15.2 Validação da segmentação (§23 a §31)
-- ----------------------------------------------------------------------------
-- ⚠️ ONDE O GAP 1 É RECUSADO EM VOZ ALTA.
--
-- Três das seis dimensões do §23 não têm cadastro que as sustente. A alternativa
-- a recusá-las seria aceitá-las e deixá-las não filtrar nada (a enquete
-- alcançaria gente demais) ou filtrar tudo (alcançaria ninguém). As duas falham
-- em SILÊNCIO, e é exatamente o erro que o seed de públicos de Eventos já
-- documentou neste projeto. A mensagem abaixo diz o que falta e o que usar
-- enquanto isso.
create or replace function public.assert_survey_audience(p_survey_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_blocked text;
begin
  if not exists (
    select 1 from public.survey_audience_criteria where survey_id = p_survey_id
  ) then
    raise exception 'Defina o público-alvo da enquete antes de agendá-la.'
      using errcode = 'SV006';
  end if;

  select string_agg(distinct
    case dimension
      when 'segment' then 'Segmento'
      when 'category' then 'Categoria'
      when 'portfolio' then 'Carteira'
    end, ', ' order by
    case dimension
      when 'segment' then 'Segmento'
      when 'category' then 'Categoria'
      when 'portfolio' then 'Carteira'
    end)
  into v_blocked
  from public.survey_audience_criteria
  where survey_id = p_survey_id
    and dimension in ('segment', 'category', 'portfolio');

  if v_blocked is not null then
    raise exception
      'A segmentação por % depende do cadastro de associados, que ainda não existe neste sistema. Use Região, Perfil, contatos específicos ou Toda a base.',
      v_blocked
      using errcode = 'SV007';
  end if;
end;
$$;

revoke execute on function public.assert_survey_audience(uuid) from public;
grant execute on function public.assert_survey_audience(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 15.3 Resolução do público (§31, §32)
-- ----------------------------------------------------------------------------
-- A REGRA DO §31, IMPOSTA NUMA CONSULTA SÓ:
--     OR dentro da mesma dimensão   ·   AND entre dimensões diferentes
--
-- Cada bloco `(não há critério desta dimensão) OR (casa com algum dela)` é um
-- AND com os outros. Uma dimensão não usada não restringe nada; uma dimensão
-- usada exige que o contato case com pelo menos um de seus valores.
--
-- QUEM É ELEGÍVEL (§24): contato COM TELEFONE. Sem telefone não há WhatsApp para
-- receber, e contá-lo no público inflaria a taxa de participação com gente que
-- nunca teve chance de responder.
--
-- ⚠️ `profiles` não é consultada em lugar nenhum desta função. É o §24 sendo
-- cumprido por construção: usuários internos não entram no público porque a
-- tabela deles nem é olhada.
--
-- SECURITY INVOKER: quem não pode ler `chat_contacts` não descobre por aqui
-- quantas pessoas a APCS tem cadastradas.
create or replace function public.resolve_survey_audience(p_survey_id uuid)
returns table (contact_id uuid, full_name text, phone text)
language sql
stable
set search_path = ''
as $$
  select c.id, c.full_name, c.phone
  from public.chat_contacts c
  where c.phone is not null
    and (
      -- §24. O atalho "toda a base" dispensa os demais critérios.
      exists (
        select 1 from public.survey_audience_criteria k
        where k.survey_id = p_survey_id and k.dimension = 'all'
      )
      or (
        -- §27 REGIÃO → a UF do contato.
        (
          not exists (
            select 1 from public.survey_audience_criteria k
            where k.survey_id = p_survey_id and k.dimension = 'region'
          )
          or exists (
            select 1 from public.survey_audience_criteria k
            where k.survey_id = p_survey_id and k.dimension = 'region'
              and upper(k.value) = upper(c.state)
          )
        )
        -- §28 PERFIL → o perfil declarado na triagem.
        and (
          not exists (
            select 1 from public.survey_audience_criteria k
            where k.survey_id = p_survey_id and k.dimension = 'profile'
          )
          or exists (
            select 1 from public.survey_audience_criteria k
            where k.survey_id = p_survey_id and k.dimension = 'profile'
              and k.value = c.contact_profile::text
          )
        )
        -- §30 GRUPO ESPECÍFICO → contatos escolhidos a dedo.
        and (
          not exists (
            select 1 from public.survey_audience_criteria k
            where k.survey_id = p_survey_id and k.dimension = 'contact'
          )
          or exists (
            select 1 from public.survey_audience_criteria k
            where k.survey_id = p_survey_id and k.dimension = 'contact'
              and k.contact_id = c.id
          )
        )
        -- Sem nenhum critério resolvível, o público é vazio — e não "todos".
        -- Sem esta linha, uma enquete cujos únicos critérios fossem os
        -- irresolvíveis alcançaria a base inteira por omissão.
        and exists (
          select 1 from public.survey_audience_criteria k
          where k.survey_id = p_survey_id
            and k.dimension in ('region', 'profile', 'contact')
        )
      )
    )
  order by c.full_name nulls last, c.id;
$$;

comment on function public.resolve_survey_audience(uuid) is
  '§31: OR dentro da dimensão, AND entre dimensões. Elegível = contato com telefone (§24).';

revoke execute on function public.resolve_survey_audience(uuid) from public;
grant execute on function public.resolve_survey_audience(uuid) to authenticated, service_role;

-- §32. O número que a tela mostra antes de agendar ("esta segmentação alcança N
-- pessoas"). Função à parte para que a tela não precise trazer a lista inteira
-- só para contá-la.
create or replace function public.count_survey_audience(p_survey_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer from public.resolve_survey_audience(p_survey_id);
$$;

revoke execute on function public.count_survey_audience(uuid) from public;
grant execute on function public.count_survey_audience(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 15.4 Guarda da estrutura (§60, §61)
-- ----------------------------------------------------------------------------
-- Pergunta e alternativas podem mudar enquanto NINGUÉM respondeu. Depois da
-- primeira resposta, mudar o texto de uma alternativa reescreveria o que as
-- pessoas escolheram — o resultado passaria a dizer que 40% votaram numa frase
-- que não existia quando votaram.
create or replace function public.assert_survey_structure_editable(p_survey_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_status public.survey_status;
begin
  select status into v_status from public.surveys where id = p_survey_id;
  if not found then
    raise exception 'Enquete não encontrada.' using errcode = 'P0002';
  end if;

  -- §60. Encerrada e cancelada não têm edição estrutural, com ou sem resposta.
  if v_status in ('closed', 'cancelled') then
    raise exception 'Uma enquete encerrada ou cancelada não pode ter a pergunta ou as alternativas alteradas.'
      using errcode = 'SV003';
  end if;

  -- §60. ATIVA sem resposta ainda pode ser corrigida — é o próprio §60 que
  -- condiciona a proibição a "se já existirem respostas".
  if exists (select 1 from public.survey_responses where survey_id = p_survey_id) then
    raise exception 'Esta enquete já recebeu respostas: a pergunta e as alternativas não podem mais ser alteradas.'
      using errcode = 'SV002';
  end if;
end;
$$;

revoke execute on function public.assert_survey_structure_editable(uuid) from public;
grant execute on function public.assert_survey_structure_editable(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 15.5 Criação (§4, §7, §8)
-- ----------------------------------------------------------------------------
-- Cria a enquete, a pergunta e as alternativas de uma vez. São três escritas
-- que não fazem sentido separadas: uma enquete sem pergunta não é uma enquete,
-- e uma pergunta de escolha única sem alternativa não é respondível.
--
-- `p_options` é um array de texto na ORDEM em que devem aparecer — a posição
-- (§7) é o índice, e é ela que vira o número que a pessoa digita no chat (§41).
create or replace function public.create_survey(
  p_title text,
  p_description text,
  p_question text,
  p_options text[],
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_scheduled_at timestamptz default null,
  p_is_anonymous boolean default false,
  p_allows_response_change boolean default false
)
returns public.surveys
language plpgsql
set search_path = ''
as $$
declare
  v_survey public.surveys;
  v_question_id uuid;
  v_count integer;
begin
  if not public.survey_is_writer() then
    raise exception 'Sem permissão para criar enquetes.' using errcode = '42501';
  end if;

  -- §7. Duas alternativas é o mínimo para haver escolha; uma "escolha" com uma
  -- opção só é um aviso, não uma enquete.
  select count(*) into v_count
  from unnest(coalesce(p_options, '{}'::text[])) as o
  where btrim(o) <> '';

  if v_count < 2 then
    raise exception 'Informe a pergunta e ao menos duas alternativas.' using errcode = 'SV005';
  end if;

  -- §17. Antes do insert, para a mensagem falar de datas e não de CHECK.
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'A data de encerramento deve ser posterior à data de início.'
      using errcode = 'SV004';
  end if;

  insert into public.surveys (
    title, description, status, starts_at, ends_at, scheduled_at,
    is_anonymous, allows_response_change
  )
  values (
    btrim(p_title), nullif(btrim(p_description), ''), 'draft',
    p_starts_at, p_ends_at, p_scheduled_at,
    coalesce(p_is_anonymous, false), coalesce(p_allows_response_change, false)
  )
  returning * into v_survey;

  insert into public.survey_questions (survey_id, position, text, answer_type)
  values (v_survey.id, 1, btrim(p_question), 'single_choice')
  returning id into v_question_id;

  -- `with ordinality` dá a posição na ordem recebida. Vazios são descartados
  -- ANTES de numerar, senão uma linha em branco no meio deixaria buraco na
  -- numeração que a pessoa vê no WhatsApp.
  insert into public.survey_options (question_id, position, text)
  select v_question_id, row_number() over (order by o.ord), btrim(o.value)
  from unnest(p_options) with ordinality as o(value, ord)
  where btrim(o.value) <> '';

  insert into public.survey_audit_logs (survey_id, action, metadata)
  values (
    v_survey.id,
    'survey_created',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'title', v_survey.title,
      'question', btrim(p_question),
      'optionCount', v_count,
      'isAnonymous', v_survey.is_anonymous
    )
  );

  return v_survey;
end;
$$;

-- ----------------------------------------------------------------------------
-- 15.6 Edição descritiva (§60)
-- ----------------------------------------------------------------------------
-- Título, descrição, janela e configurações. A pergunta e as alternativas têm
-- função própria (15.7) porque as regras que as protegem são outras.
--
-- O DIFF é o motivo de isto ser função e não update na aplicação: ele precisa da
-- linha antiga e da nova na MESMA transação. Lido antes e escrito depois pela
-- aplicação, duas edições simultâneas registrariam "de A para C" e "de A para
-- B" — e o histórico contaria uma mentira.
create or replace function public.update_survey(
  p_survey_id uuid,
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_scheduled_at timestamptz,
  p_is_anonymous boolean,
  p_allows_response_change boolean
)
returns public.surveys
language plpgsql
set search_path = ''
as $$
declare
  v_old public.surveys;
  v_new public.surveys;
  v_changes jsonb := '[]'::jsonb;
  v_has_responses boolean;
begin
  -- A PERMISSÃO VEM ANTES DA PERGUNTA: travar primeiro (o lock checa o papel)
  -- faz quem não pode escrever receber 42501 sem descobrir, pelo tipo do erro,
  -- se aquele id existe.
  perform public.lock_survey(p_survey_id);

  select * into v_old from public.surveys where id = p_survey_id;
  if not found then
    raise exception 'Enquete não encontrada.' using errcode = 'P0002';
  end if;

  -- §60. Encerrada e cancelada não se editam.
  if v_old.status in ('closed', 'cancelled') then
    raise exception 'Uma enquete encerrada ou cancelada não pode ser editada.'
      using errcode = 'SV003';
  end if;

  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'A data de encerramento deve ser posterior à data de início.'
      using errcode = 'SV004';
  end if;

  -- O CHECK `surveys_dispatch_after_start` barraria de qualquer forma, mas com
  -- código 23514 — que a aplicação traduz como "dados inválidos" e manda a
  -- pessoa procurar o campo errado num formulário de sete campos.
  if p_scheduled_at is not null and p_starts_at is not null and p_scheduled_at < p_starts_at then
    raise exception 'O envio não pode ser anterior ao início da enquete.' using errcode = 'SV004';
  end if;

  select exists (select 1 from public.survey_responses where survey_id = p_survey_id)
    into v_has_responses;

  -- ⚠️ §21 + §54. Trocar o anonimato depois de alguém responder quebra a
  -- promessa feita a quem respondeu — nos dois sentidos. Ligar exporia quem
  -- respondeu achando que seria identificado (irrelevante), mas DESLIGAR
  -- exporia quem respondeu porque era anônimo. Só o segundo caso é grave, e
  -- distinguir os dois faria a regra depender da direção; recusar os dois é
  -- mais simples de explicar e não tem exceção para alguém esquecer.
  if v_has_responses and coalesce(p_is_anonymous, false) is distinct from v_old.is_anonymous then
    raise exception 'Esta enquete já recebeu respostas: a configuração de anonimato não pode mais ser alterada.'
      using errcode = 'SV002';
  end if;

  update public.surveys
  set title = btrim(p_title),
      description = nullif(btrim(p_description), ''),
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      scheduled_at = p_scheduled_at,
      is_anonymous = coalesce(p_is_anonymous, v_old.is_anonymous),
      allows_response_change = coalesce(p_allows_response_change, v_old.allows_response_change),
      updated_by = auth.uid()
  where id = p_survey_id
  returning * into v_new;

  -- `is distinct from` e não `<>`: com NULL dos dois lados, `<>` devolve NULL e
  -- a mudança (ou a não-mudança) passaria despercebida.
  if v_old.title is distinct from v_new.title then
    v_changes := v_changes || jsonb_build_object('field', 'title', 'from', v_old.title, 'to', v_new.title);
  end if;
  if v_old.description is distinct from v_new.description then
    v_changes := v_changes || jsonb_build_object('field', 'description', 'from', v_old.description, 'to', v_new.description);
  end if;
  if v_old.starts_at is distinct from v_new.starts_at then
    v_changes := v_changes || jsonb_build_object('field', 'startsAt', 'from', v_old.starts_at, 'to', v_new.starts_at);
  end if;
  if v_old.ends_at is distinct from v_new.ends_at then
    v_changes := v_changes || jsonb_build_object('field', 'endsAt', 'from', v_old.ends_at, 'to', v_new.ends_at);
  end if;
  if v_old.scheduled_at is distinct from v_new.scheduled_at then
    v_changes := v_changes || jsonb_build_object('field', 'scheduledAt', 'from', v_old.scheduled_at, 'to', v_new.scheduled_at);
  end if;
  if v_old.is_anonymous is distinct from v_new.is_anonymous then
    v_changes := v_changes || jsonb_build_object('field', 'isAnonymous', 'from', v_old.is_anonymous, 'to', v_new.is_anonymous);
  end if;
  if v_old.allows_response_change is distinct from v_new.allows_response_change then
    v_changes := v_changes || jsonb_build_object('field', 'allowsResponseChange', 'from', v_old.allows_response_change, 'to', v_new.allows_response_change);
  end if;

  -- Edição que não mudou nada não vira linha de trilha — senão a trilha vira
  -- ruído e a mudança de verdade se perde no meio.
  if jsonb_array_length(v_changes) > 0 then
    insert into public.survey_audit_logs (survey_id, action, metadata)
    values (
      p_survey_id,
      'survey_updated',
      jsonb_build_object('actor_name', public.current_actor_name(), 'changes', v_changes)
    );
  end if;

  return v_new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 15.7 Edição da pergunta e das alternativas (§60, §61)
-- ----------------------------------------------------------------------------
-- ⚠️ A REGRA DO §61 EM AÇÃO: alternativa que sumiu da lista e JÁ TEM RESPOSTA
-- não é apagada — vira inativa. Só as intocadas somem de verdade.
--
-- Na prática `assert_survey_structure_editable` já barra qualquer edição depois
-- da primeira resposta, então o caminho de inativação nunca dispara hoje. Ele
-- existe mesmo assim porque a regra do §61 é sobre a ALTERNATIVA, não sobre o
-- momento: no dia em que o §60 for afrouxado (a APCS decidir que dá para
-- acrescentar uma opção numa enquete em curso), a integridade do histórico já
-- está garantida aqui, e não vira algo a lembrar de implementar depois.
create or replace function public.update_survey_question(
  p_survey_id uuid,
  p_question text,
  p_options text[]
)
returns public.surveys
language plpgsql
set search_path = ''
as $$
declare
  v_survey public.surveys;
  v_question_id uuid;
  v_old_question text;
  v_old_options text[];
  v_new_options text[];
  v_count integer;
begin
  perform public.lock_survey(p_survey_id);
  perform public.assert_survey_structure_editable(p_survey_id);

  select count(*) into v_count
  from unnest(coalesce(p_options, '{}'::text[])) as o
  where btrim(o) <> '';

  if v_count < 2 then
    raise exception 'Informe a pergunta e ao menos duas alternativas.' using errcode = 'SV005';
  end if;

  select id, text into v_question_id, v_old_question
  from public.survey_questions
  where survey_id = p_survey_id
  order by position
  limit 1;

  if v_question_id is null then
    raise exception 'Esta enquete não tem pergunta cadastrada.' using errcode = 'SV005';
  end if;

  select coalesce(array_agg(text order by position), '{}')
    into v_old_options
  from public.survey_options
  where question_id = v_question_id and active;

  select coalesce(array_agg(btrim(o.value) order by o.ord), '{}')
    into v_new_options
  from unnest(p_options) with ordinality as o(value, ord)
  where btrim(o.value) <> '';

  update public.survey_questions
  set text = btrim(p_question)
  where id = v_question_id;

  -- §61. As que têm resposta viram inativas; as demais saem.
  update public.survey_options o
  set active = false
  where o.question_id = v_question_id
    and exists (select 1 from public.survey_responses r where r.option_id = o.id);

  delete from public.survey_options o
  where o.question_id = v_question_id
    and not exists (select 1 from public.survey_responses r where r.option_id = o.id);

  -- As novas entram depois de a numeração antiga ter saído, senão o índice
  -- único de posição colidiria com as inativas que ficaram.
  update public.survey_options
  set position = position + 1000
  where question_id = v_question_id and not active;

  insert into public.survey_options (question_id, position, text)
  select v_question_id, row_number() over (order by o.ord), btrim(o.value)
  from unnest(p_options) with ordinality as o(value, ord)
  where btrim(o.value) <> '';

  if v_old_question is distinct from btrim(p_question) or v_old_options is distinct from v_new_options then
    insert into public.survey_audit_logs (survey_id, action, metadata)
    values (
      p_survey_id,
      'survey_question_updated',
      jsonb_build_object(
        'actor_name', public.current_actor_name(),
        'question', jsonb_build_object('from', v_old_question, 'to', btrim(p_question)),
        'options', jsonb_build_object('from', to_jsonb(v_old_options), 'to', to_jsonb(v_new_options))
      )
    );
  end if;

  select * into v_survey from public.surveys where id = p_survey_id;
  return v_survey;
end;
$$;

-- ----------------------------------------------------------------------------
-- 15.8 Segmentação (§23 a §31, §71)
-- ----------------------------------------------------------------------------
-- Substitui o conjunto inteiro de critérios. Substituir, e não acrescentar,
-- porque é assim que uma tela de seleção se comporta: o que está marcado é o
-- que vale.
--
-- `p_criteria` é um array de objetos: {dimension, segmentId?, contactId?, value?}
create or replace function public.set_survey_audience(
  p_survey_id uuid,
  p_criteria jsonb
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_status public.survey_status;
  v_old jsonb;
  v_new jsonb;
  v_total integer;
begin
  perform public.lock_survey(p_survey_id);

  select status into v_status from public.surveys where id = p_survey_id;
  if not found then
    raise exception 'Enquete não encontrada.' using errcode = 'P0002';
  end if;

  -- Depois de agendada o público já foi fotografado (§33). Mudar a segmentação
  -- não mudaria mais quem recebe — e deixar mexer daria a impressão contrária.
  -- O caminho é desagendar, ajustar e agendar de novo.
  if v_status <> 'draft' then
    raise exception 'O público-alvo só pode ser alterado enquanto a enquete está em rascunho.'
      using errcode = 'SV003';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'dimension', dimension,
           'segmentId', segment_id,
           'contactId', contact_id,
           'value', value
         ) order by dimension, value, segment_id, contact_id), '[]'::jsonb)
    into v_old
  from public.survey_audience_criteria
  where survey_id = p_survey_id;

  delete from public.survey_audience_criteria where survey_id = p_survey_id;

  insert into public.survey_audience_criteria (survey_id, dimension, segment_id, contact_id, value)
  select distinct
    p_survey_id,
    (c->>'dimension')::public.survey_audience_dimension,
    nullif(c->>'segmentId', '')::uuid,
    nullif(c->>'contactId', '')::uuid,
    nullif(btrim(c->>'value'), '')
  from jsonb_array_elements(coalesce(p_criteria, '[]'::jsonb)) as c;

  -- Depois de gravar: a validação enxerga o conjunto final, e a transação
  -- desfaz tudo se ele for inválido.
  perform public.assert_survey_audience(p_survey_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'dimension', dimension,
           'segmentId', segment_id,
           'contactId', contact_id,
           'value', value
         ) order by dimension, value, segment_id, contact_id), '[]'::jsonb)
    into v_new
  from public.survey_audience_criteria
  where survey_id = p_survey_id;

  v_total := public.count_survey_audience(p_survey_id);

  if v_old is distinct from v_new then
    insert into public.survey_audit_logs (survey_id, action, metadata)
    values (
      p_survey_id,
      'survey_audience_updated',
      jsonb_build_object(
        'actor_name', public.current_actor_name(),
        'from', v_old,
        'to', v_new,
        'eligible', v_total
      )
    );
  end if;

  return v_total;
end;
$$;

-- ----------------------------------------------------------------------------
-- 15.9 Agendamento — e a fotografia do público (§33, §35)
-- ----------------------------------------------------------------------------
-- ⚠️ É AQUI QUE A DECISÃO 4 ACONTECE. Agendar não é só marcar uma data: é
-- CONGELAR quem vai receber. Depois disto, mexer nos cadastros não muda mais o
-- público de uma campanha já planejada.
create or replace function public.schedule_survey(
  p_survey_id uuid,
  p_scheduled_at timestamptz,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns public.surveys
language plpgsql
-- ⚠️ SECURITY DEFINER porque esta função grava `survey_recipients` (a fotografia do §33), cuja escrita direta é revogada.
-- Como INVOKER ela falhava com 42501 para todo mundo menos o superusuário
-- — foi o `ceo` sem conseguir agendar que revelou isso na bateria de
-- permissões. A barreira de papel é `lock_survey` (que roda antes de
-- qualquer escrita e checa `survey_is_writer`), e não a RLS.
security definer
set search_path = ''
as $$
declare
  v_old public.surveys;
  v_new public.surveys;
  v_starts timestamptz;
  v_ends timestamptz;
  v_total integer;
begin
  perform public.lock_survey(p_survey_id);

  select * into v_old from public.surveys where id = p_survey_id;
  if not found then
    raise exception 'Enquete não encontrada.' using errcode = 'P0002';
  end if;

  if v_old.status <> 'draft' then
    raise exception 'Só uma enquete em rascunho pode ser agendada.' using errcode = 'SV003';
  end if;

  v_starts := coalesce(p_starts_at, v_old.starts_at, p_scheduled_at);
  v_ends := coalesce(p_ends_at, v_old.ends_at);

  if p_scheduled_at is null then
    raise exception 'Informe a data e o horário do envio.' using errcode = 'SV004';
  end if;

  -- §16/§57 pressupõem que existe um fim. Sem ele, a enquete nunca fecharia
  -- sozinha e o §57 viraria letra morta.
  if v_ends is null then
    raise exception 'Informe a data de encerramento da enquete.' using errcode = 'SV004';
  end if;

  if v_ends <= v_starts then
    raise exception 'A data de encerramento deve ser posterior à data de início.'
      using errcode = 'SV004';
  end if;

  if p_scheduled_at < v_starts then
    raise exception 'O envio não pode ser anterior ao início da enquete.' using errcode = 'SV004';
  end if;

  -- §5/§7. Agendar uma enquete sem pergunta respondível mandaria à base uma
  -- mensagem que ninguém consegue responder.
  if not exists (
    select 1
    from public.survey_questions q
    join public.survey_options o on o.question_id = q.id and o.active
    where q.survey_id = p_survey_id
    group by q.id
    having count(o.id) >= 2
  ) then
    raise exception 'Informe a pergunta e ao menos duas alternativas.' using errcode = 'SV005';
  end if;

  perform public.assert_survey_audience(p_survey_id);

  update public.surveys
  set status = 'scheduled',
      scheduled_at = p_scheduled_at,
      starts_at = v_starts,
      ends_at = v_ends,
      updated_by = auth.uid()
  where id = p_survey_id
  returning * into v_new;

  -- §33. A FOTOGRAFIA. `on conflict do nothing` porque a unicidade
  -- (survey_id, contact_id) é o que dá idempotência ao disparo (§38): agendar
  -- de novo depois de desagendar não duplica ninguém.
  insert into public.survey_recipients (survey_id, contact_id, contact_name, contact_phone)
  select p_survey_id, a.contact_id, a.full_name, a.phone
  from public.resolve_survey_audience(p_survey_id) a
  on conflict do nothing;

  select count(*)::integer into v_total
  from public.survey_recipients where survey_id = p_survey_id;

  -- Agendar uma campanha que alcança ninguém é quase sempre erro de
  -- segmentação, e descobrir isso no dia do envio é tarde demais.
  if v_total = 0 then
    raise exception 'A segmentação escolhida não alcança nenhum contato com telefone cadastrado.'
      using errcode = 'SV006';
  end if;

  insert into public.survey_audit_logs (survey_id, action, metadata)
  values (
    p_survey_id,
    'survey_scheduled',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'scheduledAt', v_new.scheduled_at,
      'startsAt', v_new.starts_at,
      'endsAt', v_new.ends_at,
      'recipients', v_total
    )
  );

  return v_new;
end;
$$;

-- §11. Desagendar para corrigir antes do disparo. Descarta a fotografia junto —
-- ver o comentário no grafo (seção 10).
create or replace function public.unschedule_survey(p_survey_id uuid)
returns public.surveys
language plpgsql
-- ⚠️ SECURITY DEFINER porque esta função apaga `survey_recipients`, cuja escrita direta é revogada.
-- Como INVOKER ela falhava com 42501 para todo mundo menos o superusuário
-- — foi o `ceo` sem conseguir agendar que revelou isso na bateria de
-- permissões. A barreira de papel é `lock_survey` (que roda antes de
-- qualquer escrita e checa `survey_is_writer`), e não a RLS.
security definer
set search_path = ''
as $$
declare
  v_old public.surveys;
  v_new public.surveys;
begin
  perform public.lock_survey(p_survey_id);

  select * into v_old from public.surveys where id = p_survey_id;
  if not found then
    raise exception 'Enquete não encontrada.' using errcode = 'P0002';
  end if;

  if v_old.status <> 'scheduled' then
    raise exception 'Só uma enquete agendada pode voltar para rascunho.' using errcode = 'SV003';
  end if;

  -- Se já houve disparo, voltar atrás é impossível: as mensagens saíram.
  if exists (
    select 1 from public.survey_recipients
    where survey_id = p_survey_id and status <> 'pending'
  ) then
    raise exception 'Esta enquete já teve mensagens enviadas e não pode voltar para rascunho.'
      using errcode = 'SV003';
  end if;

  delete from public.survey_recipients where survey_id = p_survey_id;

  update public.surveys
  set status = 'draft',
      updated_by = auth.uid()
  where id = p_survey_id
  returning * into v_new;

  insert into public.survey_audit_logs (survey_id, action, metadata)
  values (
    p_survey_id,
    'survey_updated',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'changes', jsonb_build_array(
        jsonb_build_object('field', 'status', 'from', 'scheduled', 'to', 'draft')
      )
    )
  );

  return v_new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 15.10 Ativação, encerramento e cancelamento (§3, §12, §58, §59)
-- ----------------------------------------------------------------------------
-- ⚠️ ATIVAÇÃO MANUAL EXISTE, e não é um contorno do GAP 3: o §3 lista "ativar"
-- como permissão do ADMINISTRADOR e do GESTOR, ao lado de "agendar". A rotina
-- (15.12) chama esta mesma função — não há dois caminhos com duas regras.
create or replace function public.activate_survey(p_survey_id uuid)
returns public.surveys
language plpgsql
set search_path = ''
as $$
declare
  v_old public.surveys;
  v_new public.surveys;
begin
  perform public.lock_survey(p_survey_id);

  select * into v_old from public.surveys where id = p_survey_id;
  if not found then
    raise exception 'Enquete não encontrada.' using errcode = 'P0002';
  end if;

  if v_old.status = 'active' then
    -- Idempotente: pedir de novo o que já vale não é erro e não vira trilha.
    return v_old;
  end if;

  if v_old.status <> 'scheduled' then
    raise exception 'Só uma enquete agendada pode ser ativada.' using errcode = 'SV003';
  end if;

  -- Ativar algo cuja janela já fechou criaria uma enquete que nasce recusando
  -- resposta — o portão (15.1) a fecharia no mesmo instante.
  if v_old.ends_at is not null and now() >= v_old.ends_at then
    raise exception 'A data de encerramento desta enquete já passou.' using errcode = 'SV004';
  end if;

  update public.surveys
  set status = 'active',
      -- Ativar antes da hora marcada ANTECIPA a abertura da urna, em vez de
      -- deixar a enquete "ativa" recusando resposta até o horário previsto.
      starts_at = least(coalesce(v_old.starts_at, now()), now()),
      updated_by = auth.uid()
  where id = p_survey_id
  returning * into v_new;

  insert into public.survey_audit_logs (survey_id, action, metadata)
  values (
    p_survey_id,
    'survey_activated',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'from', v_old.status,
      'to', v_new.status,
      'startsAt', v_new.starts_at,
      'endsAt', v_new.ends_at
    )
  );

  return v_new;
end;
$$;

-- §58. Encerramento manual, antes da data prevista. O texto de confirmação que
-- o §58 pede é da tela; o que o banco garante é que depois disto não entra mais
-- resposta.
create or replace function public.close_survey(p_survey_id uuid)
returns public.surveys
language plpgsql
set search_path = ''
as $$
declare
  v_old public.surveys;
  v_new public.surveys;
begin
  perform public.lock_survey(p_survey_id);

  select * into v_old from public.surveys where id = p_survey_id;
  if not found then
    raise exception 'Enquete não encontrada.' using errcode = 'P0002';
  end if;

  if v_old.status = 'closed' then
    return v_old;
  end if;

  if v_old.status <> 'active' then
    raise exception 'Só uma enquete ativa pode ser encerrada.' using errcode = 'SV003';
  end if;

  update public.surveys
  set status = 'closed',
      -- O fim passa a ser AGORA: sem isto, a enquete ficaria encerrada com uma
      -- data de encerramento no futuro, e todo relatório que usasse `ends_at`
      -- para dizer "até quando esteve aberta" mentiria.
      ends_at = least(coalesce(v_old.ends_at, now()), now()),
      updated_by = auth.uid()
  where id = p_survey_id
  returning * into v_new;

  insert into public.survey_audit_logs (survey_id, action, metadata)
  values (
    p_survey_id,
    'survey_closed',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'from', v_old.status,
      'reason', 'manual',
      'endsAt', v_new.ends_at
    )
  );

  return v_new;
end;
$$;

-- §14/§59. Cancelamento a partir de rascunho, agendada ou ativa.
create or replace function public.cancel_survey(
  p_survey_id uuid,
  p_reason text default null
)
returns public.surveys
language plpgsql
-- ⚠️ SECURITY DEFINER porque esta função tira os pendentes da fila em `survey_recipients`, cuja escrita direta é revogada.
-- Como INVOKER ela falhava com 42501 para todo mundo menos o superusuário
-- — foi o `ceo` sem conseguir agendar que revelou isso na bateria de
-- permissões. A barreira de papel é `lock_survey` (que roda antes de
-- qualquer escrita e checa `survey_is_writer`), e não a RLS.
security definer
set search_path = ''
as $$
declare
  v_old public.surveys;
  v_new public.surveys;
begin
  perform public.lock_survey(p_survey_id);

  select * into v_old from public.surveys where id = p_survey_id;
  if not found then
    raise exception 'Enquete não encontrada.' using errcode = 'P0002';
  end if;

  if v_old.status = 'cancelled' then
    return v_old;
  end if;

  if v_old.status in ('closed') then
    raise exception 'Uma enquete encerrada não pode ser cancelada.' using errcode = 'SV003';
  end if;

  update public.surveys
  set status = 'cancelled',
      updated_by = auth.uid()
  where id = p_survey_id
  returning * into v_new;

  -- §59. Nenhum disparo novo sai depois disto: o que estava pendente sai da
  -- fila. Quem já recebeu continua registrado como tendo recebido — a mensagem
  -- saiu de verdade, e apagar isso reescreveria história.
  update public.survey_recipients
  set status = 'error',
      last_error = 'Enquete cancelada antes do envio.'
  where survey_id = p_survey_id and status = 'pending';

  insert into public.survey_audit_logs (survey_id, action, metadata)
  values (
    p_survey_id,
    'survey_cancelled',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'from', v_old.status,
      'reason', nullif(btrim(p_reason), '')
    )
  );

  return v_new;
end;
$$;

-- §10. Rascunho pode ser descartado de verdade — não há resposta, não há
-- destinatário, não há nada a preservar. Depois disso o caminho é CANCELADA.
create or replace function public.delete_survey(p_survey_id uuid)
returns void
language plpgsql
-- ⚠️ SECURITY DEFINER porque esta função apaga em `public.surveys`, e `delete` é revogado para `authenticated`.
-- Como INVOKER ela falhava com 42501 para todo mundo menos o superusuário
-- — foi o `ceo` sem conseguir agendar que revelou isso na bateria de
-- permissões. A barreira de papel é `lock_survey` (que roda antes de
-- qualquer escrita e checa `survey_is_writer`), e não a RLS.
security definer
set search_path = ''
as $$
declare
  v_status public.survey_status;
begin
  perform public.lock_survey(p_survey_id);

  select status into v_status from public.surveys where id = p_survey_id;
  if not found then
    raise exception 'Enquete não encontrada.' using errcode = 'P0002';
  end if;

  if v_status <> 'draft' then
    raise exception 'Só uma enquete em rascunho pode ser excluída. Use o cancelamento.'
      using errcode = 'SV003';
  end if;

  -- A trilha sobrevive: `survey_audit_logs.survey_id` é `on delete set null`, e
  -- os metadados guardam o título. "Alguém criou e apagou uma enquete" continua
  -- respondível depois que a linha some.
  delete from public.surveys where id = p_survey_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 15.11 Disparo (§34, §37, §38, §39, §40)
-- ----------------------------------------------------------------------------
-- ⚠️ AQUI É ONDE O GAP 2 FICA VISÍVEL. Esta função abre a corrida e devolve a
-- lista de quem deve receber; ela NÃO manda mensagem, porque não há para onde
-- mandar (ver o cabeçalho). Quem chamar recebe os destinatários pendentes e
-- reporta o resultado de cada um por `mark_survey_recipient`.
--
-- IDEMPOTÊNCIA (§38): a corrida só entrega quem está `pending`. Rodar duas vezes
-- não devolve ninguém na segunda, porque a primeira já os tirou desse estado.
-- E, mesmo que dois processos rodem juntos, a unicidade
-- (survey_id, contact_id) impede o segundo destinatário duplicado.
create or replace function public.start_survey_dispatch(p_survey_id uuid)
returns public.survey_dispatches
language plpgsql
-- ⚠️ SECURITY DEFINER porque esta função grava `survey_dispatches`, cuja escrita direta é revogada.
-- Como INVOKER ela falhava com 42501 para todo mundo menos o superusuário
-- — foi o `ceo` sem conseguir agendar que revelou isso na bateria de
-- permissões. A barreira de papel é `lock_survey` (que roda antes de
-- qualquer escrita e checa `survey_is_writer`), e não a RLS.
security definer
set search_path = ''
as $$
declare
  v_survey public.surveys;
  v_dispatch public.survey_dispatches;
  v_pending integer;
begin
  perform public.lock_survey(p_survey_id);

  select * into v_survey from public.surveys where id = p_survey_id;
  if not found then
    raise exception 'Enquete não encontrada.' using errcode = 'P0002';
  end if;

  -- §14/§49. Cancelada não dispara. Rascunho não tem público fotografado.
  if v_survey.status not in ('scheduled', 'active') then
    raise exception 'Só uma enquete agendada ou ativa pode ser disparada.' using errcode = 'SV003';
  end if;

  select count(*)::integer into v_pending
  from public.survey_recipients
  where survey_id = p_survey_id and status = 'pending';

  insert into public.survey_dispatches (survey_id, status, total_recipients)
  values (p_survey_id, 'running', v_pending)
  returning * into v_dispatch;

  insert into public.survey_audit_logs (survey_id, action, metadata)
  values (
    p_survey_id,
    'survey_dispatched',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'dispatchId', v_dispatch.id,
      'pending', v_pending
    )
  );

  return v_dispatch;
end;
$$;

-- §39/§40. O ponto exato onde um adaptador de fornecedor se pluga.
--
-- A progressão é MONOTÔNICA: um webhook de "entregue" que chega depois do de
-- "lido" (a ordem não é garantida em nenhuma API de mensageria) não rebaixa o
-- estado. Sem isto, a taxa de participação oscilaria conforme a ordem de
-- chegada dos avisos.
create or replace function public.mark_survey_recipient(
  p_recipient_id uuid,
  p_status public.survey_recipient_status,
  p_provider_message_id text default null,
  p_error text default null
)
returns public.survey_recipients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.survey_recipients;
  v_new public.survey_recipients;
  v_rank integer;
  v_old_rank integer;
begin
  select * into v_old from public.survey_recipients where id = p_recipient_id;
  if not found then
    raise exception 'Destinatário não encontrado.' using errcode = 'P0002';
  end if;

  v_rank := array_position(
    array['pending', 'sent', 'delivered', 'read', 'responded']::text[], p_status::text
  );
  v_old_rank := array_position(
    array['pending', 'sent', 'delivered', 'read', 'responded']::text[], v_old.status::text
  );

  -- 'error' está fora da escala e sempre pode ser gravado: uma falha é notícia
  -- nova, mesmo depois de um "enviado".
  if p_status <> 'error' and v_old.status <> 'error'
     and v_rank is not null and v_old_rank is not null and v_rank <= v_old_rank then
    return v_old;
  end if;

  update public.survey_recipients
  set status = p_status,
      attempts = case when p_status in ('sent', 'error') then attempts + 1 else attempts end,
      last_attempt_at = case when p_status in ('sent', 'error') then now() else last_attempt_at end,
      last_error = case when p_status = 'error' then left(coalesce(p_error, 'Falha no envio.'), 1000) else last_error end,
      provider_message_id = coalesce(nullif(btrim(p_provider_message_id), ''), provider_message_id)
  where id = p_recipient_id
  returning * into v_new;

  return v_new;
end;
$$;

comment on function public.mark_survey_recipient is
  'Onde um adaptador de WhatsApp se pluga. A progressão é monotônica: webhook fora de ordem não rebaixa o estado.';

-- Só o servidor: quem opera o CRM não muda estado de entrega à mão.
revoke execute on function public.mark_survey_recipient(
  uuid, public.survey_recipient_status, text, text
) from public, anon, authenticated;
grant execute on function public.mark_survey_recipient(
  uuid, public.survey_recipient_status, text, text
) to service_role;

-- ----------------------------------------------------------------------------
-- 15.12 A rotina (§37, §57)
-- ----------------------------------------------------------------------------
-- Faz as duas coisas que o tempo deveria fazer sozinho: ativar o que venceu o
-- agendamento (§37) e encerrar o que passou da data de fim (§57).
--
-- ⚠️ IDEMPOTENTE POR CONSTRUÇÃO: as duas varreduras filtram por status, então
-- rodar dez vezes seguidas tem o mesmo efeito de rodar uma. Não há "já rodei
-- hoje" a controlar — é o que torna seguro chamá-la de qualquer gatilho, e o
-- que faz a ausência do agendador (GAP 3) ser uma pendência de infraestrutura,
-- não um risco de dado.
--
-- SECURITY DEFINER: quem a chama é o servidor, sem sessão de usuário. As
-- transições continuam passando pelo trigger — o grafo vale para a rotina
-- também.
create or replace function public.process_scheduled_surveys()
returns table (activated integer, closed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activated integer := 0;
  v_closed integer := 0;
begin
  -- ⚠️ A TRILHA VIVE DENTRO DO MESMO COMANDO do update, num CTE que escreve.
  -- Não é estilo: um `insert ... select from surveys where status = 'closed'`
  -- num comando SEPARATED pegaria TODAS as encerradas, não as que ESTA rodada
  -- encerrou — e a rodada seguinte auditaria as mesmas de novo. O `returning`
  -- do CTE é a única lista que corresponde ao que acabou de mudar.
  --
  -- CTE que modifica dados roda sempre, mesmo sem ser referenciado pela
  -- consulta principal; é o que permite o `select count(*)` ler só `fechadas`.

  -- §57 PRIMEIRO. Se uma enquete estivesse agendada e já vencida ao mesmo
  -- tempo, ativá-la antes de encerrar a deixaria ativa por um instante — e o
  -- portão (15.1) já a trataria como fechada, o que é confuso de auditar.
  with fechadas as (
    update public.surveys
    set status = 'closed'
    where status = 'active'
      and ends_at is not null
      and now() >= ends_at
    returning id, ends_at
  ),
  trilha_fechadas as (
    insert into public.survey_audit_logs (survey_id, action, actor_id, metadata)
    select id, 'survey_closed', null,
           jsonb_build_object('reason', 'automatic', 'endsAt', ends_at)
    from fechadas
    returning 1
  )
  select count(*)::integer into v_closed from fechadas;

  with ativadas as (
    update public.surveys
    set status = 'active'
    where status = 'scheduled'
      and scheduled_at is not null
      and now() >= scheduled_at
      -- Nunca ativar algo que já nasceria fechado.
      and (ends_at is null or now() < ends_at)
    returning id, starts_at, ends_at
  ),
  trilha_ativadas as (
    insert into public.survey_audit_logs (survey_id, action, actor_id, metadata)
    select id, 'survey_activated', null,
           jsonb_build_object('reason', 'automatic', 'startsAt', starts_at, 'endsAt', ends_at)
    from ativadas
    returning 1
  )
  select count(*)::integer into v_activated from ativadas;

  return query select v_activated, v_closed;
end;
$$;

comment on function public.process_scheduled_surveys() is
  '§37/§57. Ativa o que venceu e encerra o que passou. Idempotente — pode ser chamada por qualquer gatilho.';

revoke execute on function public.process_scheduled_surveys() from public, anon, authenticated;
grant execute on function public.process_scheduled_surveys() to service_role;

-- ----------------------------------------------------------------------------
-- 15.13 Registro da resposta (§43 a §50, §73, §80, §81)
-- ----------------------------------------------------------------------------
-- ⚠️ NÃO LANÇA EXCEÇÃO PARA DESFECHO DE NEGÓCIO. "Já respondeu", "encerrada" e
-- "opção inválida" são conversas normais, não falhas — o bot precisa de uma
-- frase, não de um stack trace. O que lança é o que é erro de verdade
-- (enquete inexistente já vira 'not_found', então sobra pouco).
--
-- SECURITY DEFINER + grant só para `service_role`, exatamente como
-- `create_lecture_request`: o chat é ANÔNIMO, não há `auth.uid()` nem papel, e
-- `survey_responses` não tem policy de escrita para ninguém. A superfície
-- pública do banco continua sendo zero.
--
-- TRANSAÇÃO (§80): resposta + estado do destinatário + trilha, ou nada.
create or replace function public.register_survey_response(
  p_survey_id uuid,
  p_option_id uuid,
  p_contact_id uuid,
  p_source_message_id text default null
)
returns public.survey_response_outcome
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate public.survey_response_outcome;
  v_survey public.surveys;
  v_question_id uuid;
  v_existing uuid;
begin
  -- §73. A idempotência vem ANTES de tudo: a mesma mensagem reentregue tem de
  -- devolver o mesmo desfecho de sucesso, e não "você já participou" — que
  -- faria o bot repreender alguém por um retry técnico do próprio sistema.
  if nullif(btrim(p_source_message_id), '') is not null then
    select id into v_existing
    from public.survey_responses
    where source_message_id = btrim(p_source_message_id);

    if v_existing is not null then
      return 'registered';
    end if;
  end if;

  v_gate := public.survey_response_gate(p_survey_id);
  if v_gate <> 'registered' then
    return v_gate;
  end if;

  select * into v_survey from public.surveys where id = p_survey_id;

  -- §44. A alternativa tem de existir, estar ATIVA e pertencer a esta enquete.
  -- A última condição é a que impede responder a enquete A com a opção da B.
  select q.id into v_question_id
  from public.survey_questions q
  join public.survey_options o on o.question_id = q.id
  where q.survey_id = p_survey_id
    and o.id = p_option_id
    and o.active;

  if v_question_id is null then
    return 'invalid_option';
  end if;

  -- §81. Serializa duas respostas simultâneas da MESMA pessoa na MESMA enquete.
  -- O índice único já as impediria; o lock evita que a segunda chegue até lá e
  -- volte como erro em vez de como 'already_answered'.
  perform pg_advisory_xact_lock(
    hashtext('survey_response:' || p_survey_id::text || ':' || p_contact_id::text)
  );

  -- §18/§47.
  if exists (
    select 1 from public.survey_responses
    where survey_id = p_survey_id and contact_id = p_contact_id
  ) then
    return 'already_answered';
  end if;

  insert into public.survey_responses (
    survey_id, question_id, option_id, contact_id, source_message_id
  )
  values (
    p_survey_id, v_question_id, p_option_id, p_contact_id,
    nullif(btrim(p_source_message_id), '')
  );

  -- §39. Quem respondeu recebeu — mesmo que o aviso de entrega nunca tenha
  -- chegado. Sem isto, a taxa de participação (§52) teria numerador sem
  -- denominador em toda campanha cujo fornecedor não mande webhook.
  update public.survey_recipients
  set status = 'responded'
  where survey_id = p_survey_id and contact_id = p_contact_id;

  -- ⚠️ §21 + §54 + §63. A trilha registra QUEM respondeu apenas quando a
  -- enquete NÃO é anônima. Numa anônima ela registra que houve resposta e qual
  -- alternativa — o suficiente para auditar o volume, insuficiente para
  -- desanonimizar alguém a partir do log. O vínculo técnico continua existindo,
  -- em `survey_responses`, que ninguém lê pelo PostgREST.
  insert into public.survey_audit_logs (survey_id, action, actor_id, metadata)
  values (
    p_survey_id,
    'survey_response_registered',
    null,
    case
      when v_survey.is_anonymous then
        jsonb_build_object('anonymous', true, 'optionId', p_option_id)
      else
        jsonb_build_object('anonymous', false, 'optionId', p_option_id, 'contactId', p_contact_id)
    end
  );

  return 'registered';

exception
  -- Cinto e suspensório do §81: se duas transações passarem pelo lock (o que
  -- não deveria acontecer), a unicidade decide, e a perdedora recebe o mesmo
  -- desfecho que teria recebido pelo caminho normal.
  when unique_violation then
    return 'already_answered';
end;
$$;

comment on function public.register_survey_response is
  'A ÚNICA porta de escrita de resposta. Devolve desfecho, nunca exceção de negócio (§43 a §50).';

revoke execute on function public.register_survey_response(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.register_survey_response(uuid, uuid, uuid, text)
  to service_role;

-- ----------------------------------------------------------------------------
-- 15.14 O que o bot precisa para montar a mensagem (§41, §42)
-- ----------------------------------------------------------------------------
-- Devolve a pergunta e as alternativas ATIVAS na ordem. É por `position` que a
-- pessoa responde "3" e o bot sabe qual opção é.
--
-- ⚠️ Não devolve nada sobre público, resultados ou quem respondeu. É o mesmo
-- princípio do recorte reduzido de `lecture-chatbot`: um campo que nunca é lido
-- não pode vazar por um erro de mapeamento mais adiante.
create or replace function public.get_survey_for_chatbot(p_survey_id uuid)
returns table (
  survey_id uuid,
  title text,
  question_id uuid,
  question text,
  option_id uuid,
  option_position integer,
  option_text text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.title, q.id, q.text, o.id, o.position, o.text
  from public.surveys s
  join public.survey_questions q on q.survey_id = s.id
  join public.survey_options o on o.question_id = q.id and o.active
  where s.id = p_survey_id
  order by q.position, o.position;
$$;

revoke execute on function public.get_survey_for_chatbot(uuid) from public, anon;
grant execute on function public.get_survey_for_chatbot(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 16. Resultados e métricas (§51 a §55, §72)
-- ----------------------------------------------------------------------------
-- ⚠️ AS TRÊS FUNÇÕES ABAIXO SÃO A ÚNICA PORTA DE LEITURA DE `survey_responses`.
-- Todas SECURITY DEFINER — obrigatório, porque a tabela não tem policy de SELECT
-- e uma função INVOKER leria zero linhas. E, porque são DEFINER, TODAS checam a
-- permissão no topo: sem isso, o `viewer` (papel de entrada) leria resultado.

-- §53. Contagem e percentual por alternativa.
--
-- ⚠️ `left join`: alternativas com ZERO resposta aparecem com 0. Sem isso, um
-- gráfico montado a partir daqui esconderia as opções que ninguém escolheu — e
-- "ninguém votou em Reduzir muito" é um resultado, não uma ausência de dado.
--
-- INATIVAS TAMBÉM APARECEM, se tiverem resposta: é o §61 do lado da leitura.
create or replace function public.survey_results(p_survey_id uuid)
returns table (
  option_id uuid,
  option_position integer,
  option_text text,
  option_active boolean,
  total integer,
  percentage numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.survey_is_reader() then
    raise exception 'Sem permissão para consultar resultados.' using errcode = '42501';
  end if;

  -- ⚠️ As colunas internas NÃO se chamam `total` nem `option_id`: esses nomes
  -- são parâmetros OUT desta função e, dentro de PL/pgSQL, viram variáveis. Uma
  -- referência não qualificada a `total` fica ambígua e o Postgres recusa a
  -- consulta inteira (42702). Daí `qtd` e `opt`.
  return query
  with respostas as (
    select r.option_id as opt, count(*)::integer as qtd
    from public.survey_responses r
    where r.survey_id = p_survey_id
    group by r.option_id
  ),
  geral as (
    select coalesce(sum(a.qtd), 0)::integer as qtd from respostas a
  )
  select
    o.id,
    o.position,
    o.text,
    o.active,
    coalesce(a.qtd, 0)::integer,
    -- §53. Sem respostas, o percentual é 0 — e não uma divisão por zero nem um
    -- nulo que a tela teria de tratar.
    case
      when g.qtd = 0 then 0::numeric
      else round(coalesce(a.qtd, 0)::numeric * 100 / g.qtd, 2)
    end
  from public.survey_questions q
  join public.survey_options o on o.question_id = q.id
  left join respostas a on a.opt = o.id
  cross join geral g
  where q.survey_id = p_survey_id
    and (o.active or coalesce(a.qtd, 0) > 0)
  order by o.position;
end;
$$;

-- §51/§52. Os números da campanha.
create or replace function public.survey_metrics(p_survey_id uuid)
returns table (
  total_audience integer,
  total_sent integer,
  total_delivered integer,
  total_read integer,
  total_responses integer,
  total_errors integer,
  participation_rate numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.survey_is_reader() then
    raise exception 'Sem permissão para consultar resultados.' using errcode = '42501';
  end if;

  return query
  with r as (
    select status from public.survey_recipients where survey_id = p_survey_id
  ),
  n as (
    select
      count(*)::integer as audience,
      -- ⚠️ OS ESTADOS SÃO UMA PROGRESSÃO, e a contagem respeita isso: quem foi
      -- ENTREGUE também foi ENVIADO; quem RESPONDEU também foi entregue.
      -- Contar só `status = 'delivered'` ao pé da letra faria o denominador
      -- ENCOLHER a cada resposta, e a taxa de participação passaria de 100%.
      count(*) filter (where status in ('sent', 'delivered', 'read', 'responded'))::integer as sent,
      count(*) filter (where status in ('delivered', 'read', 'responded'))::integer as delivered,
      count(*) filter (where status in ('read', 'responded'))::integer as lidos,
      count(*) filter (where status = 'error')::integer as erros
    from r
  ),
  resp as (
    select count(*)::integer as total from public.survey_responses where survey_id = p_survey_id
  )
  select
    n.audience,
    n.sent,
    n.delivered,
    n.lidos,
    resp.total,
    n.erros,
    -- §52. Divisor zero devolve 0%, não erro nem nulo.
    case when n.delivered = 0 then 0::numeric
         else round(resp.total::numeric * 100 / n.delivered, 2) end
  from n cross join resp;
end;
$$;

-- §55. Quem respondeu o quê — SOMENTE em enquete não anônima.
--
-- ⚠️ ESTA FUNÇÃO É O §54 INTEIRO. Ela é a única maneira de ligar uma pessoa a
-- uma alternativa, e a primeira coisa que faz é recusar-se a existir para
-- enquete anônima. Não há caminho alternativo: a tabela não tem policy de
-- SELECT, então nem o admin chega lá por fora.
create or replace function public.survey_participants(p_survey_id uuid)
returns table (
  contact_id uuid,
  contact_name text,
  option_id uuid,
  option_text text,
  answered_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_anonymous boolean;
begin
  if not public.survey_is_reader() then
    raise exception 'Sem permissão para consultar resultados.' using errcode = '42501';
  end if;

  select is_anonymous into v_anonymous from public.surveys where id = p_survey_id;
  if not found then
    raise exception 'Enquete não encontrada.' using errcode = 'P0002';
  end if;

  if v_anonymous then
    raise exception 'Esta enquete é anônima: os participantes não podem ser identificados.'
      using errcode = 'SV008';
  end if;

  return query
  select r.contact_id, c.full_name, r.option_id, o.text, r.answered_at
  from public.survey_responses r
  join public.survey_options o on o.id = r.option_id
  left join public.chat_contacts c on c.id = r.contact_id
  where r.survey_id = p_survey_id
  order by r.answered_at;
end;
$$;

comment on function public.survey_participants(uuid) is
  '§54/§55. Recusa-se a responder para enquete anônima. É a única forma de ligar pessoa a alternativa.';

-- ----------------------------------------------------------------------------
-- 17. Grants de execução
-- ----------------------------------------------------------------------------
-- `revoke from public` antes de cada grant: sem isso, toda função nasce
-- executável por qualquer papel, inclusive `anon`.
revoke execute on function public.create_survey(
  text, text, text, text[], timestamptz, timestamptz, timestamptz, boolean, boolean
) from public;
grant execute on function public.create_survey(
  text, text, text, text[], timestamptz, timestamptz, timestamptz, boolean, boolean
) to authenticated;

revoke execute on function public.update_survey(
  uuid, text, text, timestamptz, timestamptz, timestamptz, boolean, boolean
) from public;
grant execute on function public.update_survey(
  uuid, text, text, timestamptz, timestamptz, timestamptz, boolean, boolean
) to authenticated;

revoke execute on function public.update_survey_question(uuid, text, text[]) from public;
grant execute on function public.update_survey_question(uuid, text, text[]) to authenticated;

revoke execute on function public.set_survey_audience(uuid, jsonb) from public;
grant execute on function public.set_survey_audience(uuid, jsonb) to authenticated;

revoke execute on function public.schedule_survey(uuid, timestamptz, timestamptz, timestamptz) from public;
grant execute on function public.schedule_survey(uuid, timestamptz, timestamptz, timestamptz) to authenticated;

revoke execute on function public.unschedule_survey(uuid) from public;
grant execute on function public.unschedule_survey(uuid) to authenticated;

revoke execute on function public.activate_survey(uuid) from public;
grant execute on function public.activate_survey(uuid) to authenticated;

revoke execute on function public.close_survey(uuid) from public;
grant execute on function public.close_survey(uuid) to authenticated;

revoke execute on function public.cancel_survey(uuid, text) from public;
grant execute on function public.cancel_survey(uuid, text) to authenticated;

revoke execute on function public.delete_survey(uuid) from public;
grant execute on function public.delete_survey(uuid) to authenticated;

revoke execute on function public.start_survey_dispatch(uuid) from public;
grant execute on function public.start_survey_dispatch(uuid) to authenticated, service_role;

revoke execute on function public.enforce_survey_rules() from public;

-- Leitura de resultado: quem lê enquete pergunta; as funções checam de novo por
-- dentro, porque são SECURITY DEFINER e o grant sozinho não distingue papéis.
revoke execute on function public.survey_results(uuid) from public;
grant execute on function public.survey_results(uuid) to authenticated;

revoke execute on function public.survey_metrics(uuid) from public;
grant execute on function public.survey_metrics(uuid) to authenticated;

revoke execute on function public.survey_participants(uuid) from public;
grant execute on function public.survey_participants(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 17.1 ⚠️ O `anon` NÃO EXECUTA NADA DESTE MÓDULO
-- ----------------------------------------------------------------------------
-- ISTO NÃO É REDUNDANTE COM OS `revoke ... from public` ACIMA, e a diferença
-- custou um vazamento real neste módulo.
--
-- O Supabase configura ALTER DEFAULT PRIVILEGES concedendo EXECUTE a `anon`,
-- `authenticated` e `service_role` em TODA função nova criada em `public`.
-- `revoke execute ... from public` remove a concessão ao PSEUDO-PAPEL `public` —
-- e não tem efeito nenhum sobre a concessão SEPARADA E EXPLÍCITA feita a `anon`.
--
-- O que isso significava, medido contra este banco antes desta seção existir:
-- com a chave anônima do navegador (a que vai para o cliente, por definição
-- pública), uma chamada a `/rest/v1/rpc/survey_participants` devolvia a lista de
-- quem respondeu à enquete, com nome. As funções de resultado são SECURITY
-- DEFINER, então a RLS não as protegia; a checagem de papel era a única
-- barreira, e ela tinha o furo de NULL descrito na seção 15.0. Os dois defeitos
-- juntos abriam a porta inteira.
--
-- O laço é preferível a uma lista escrita à mão por um motivo simples: uma
-- função nova acrescentada a este módulo amanhã já nasce coberta, enquanto uma
-- lista manual depende de alguém lembrar de acrescentá-la.
do $revoke_anon$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like '%survey%'
  loop
    execute pg_catalog.format('revoke execute on function %s from anon', f.assinatura);
  end loop;
end $revoke_anon$;

-- ----------------------------------------------------------------------------
-- 18. Storage (§4 — imagem opcional)
-- ----------------------------------------------------------------------------
-- Bucket PRIVADO, mesmo desenho de `events`. Bucket separado, e não o de
-- eventos, porque as permissões são de módulos diferentes e um dia vão divergir.
--
-- `file_size_limit` e `allowed_mime_types` aqui são a barreira que sobra caso
-- alguém pule a aplicação e use o token de upload direto.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'surveys',
  'surveys',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy "surveys_bucket_select"
  on storage.objects for select
  using (
    bucket_id = 'surveys'
    and (select public.current_app_role()) in ('admin', 'ceo', 'comercial')
  );

create policy "surveys_bucket_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'surveys'
    and (select public.current_app_role()) in ('admin', 'ceo')
  );

-- DELETE existe para dois casos, e só eles: apagar o órfão de um upload que a
-- validação de conteúdo recusou, e descartar a imagem antiga DEPOIS que a
-- substituição já foi gravada com sucesso.
create policy "surveys_bucket_delete"
  on storage.objects for delete
  using (
    bucket_id = 'surveys'
    and (select public.current_app_role()) in ('admin', 'ceo')
  );

-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- O CLI do Supabase não tem down-migration; o desfazimento é manual, na ordem
-- (dependências primeiro), e esvaziando o bucket antes, senão o delete falha:
--
--   drop function if exists public.survey_participants(uuid);
--   drop function if exists public.survey_metrics(uuid);
--   drop function if exists public.survey_results(uuid);
--   drop function if exists public.get_survey_for_chatbot(uuid);
--   drop function if exists public.register_survey_response(uuid, uuid, uuid, text);
--   drop function if exists public.process_scheduled_surveys();
--   drop function if exists public.mark_survey_recipient(uuid, public.survey_recipient_status, text, text);
--   drop function if exists public.start_survey_dispatch(uuid);
--   drop function if exists public.delete_survey(uuid);
--   drop function if exists public.cancel_survey(uuid, text);
--   drop function if exists public.close_survey(uuid);
--   drop function if exists public.activate_survey(uuid);
--   drop function if exists public.unschedule_survey(uuid);
--   drop function if exists public.schedule_survey(uuid, timestamptz, timestamptz, timestamptz);
--   drop function if exists public.set_survey_audience(uuid, jsonb);
--   drop function if exists public.update_survey_question(uuid, text, text[]);
--   drop function if exists public.update_survey(uuid, text, text, timestamptz, timestamptz, timestamptz, boolean, boolean);
--   drop function if exists public.create_survey(text, text, text, text[], timestamptz, timestamptz, timestamptz, boolean, boolean);
--   drop function if exists public.assert_survey_structure_editable(uuid);
--   drop function if exists public.count_survey_audience(uuid);
--   drop function if exists public.resolve_survey_audience(uuid);
--   drop function if exists public.assert_survey_audience(uuid);
--   drop function if exists public.survey_response_gate(uuid);
--   drop function if exists public.lock_survey(uuid);
--   drop trigger if exists surveys_guard on public.surveys;
--   drop function if exists public.enforce_survey_rules();
--   drop policy if exists "surveys_bucket_select" on storage.objects;
--   drop policy if exists "surveys_bucket_insert" on storage.objects;
--   drop policy if exists "surveys_bucket_delete" on storage.objects;
--   delete from storage.objects where bucket_id = 'surveys';
--   delete from storage.buckets where id = 'surveys';
--   drop table if exists public.survey_audit_logs;
--   drop table if exists public.survey_responses;
--   drop table if exists public.survey_dispatches;
--   drop table if exists public.survey_recipients;
--   drop table if exists public.survey_audience_criteria;
--   drop table if exists public.survey_options;
--   drop table if exists public.survey_questions;
--   drop table if exists public.survey_status_transitions;
--   drop table if exists public.surveys;
--   drop type if exists public.survey_audit_action;
--   drop type if exists public.survey_response_outcome;
--   drop type if exists public.survey_dispatch_status;
--   drop type if exists public.survey_recipient_status;
--   drop type if exists public.survey_audience_dimension;
--   drop type if exists public.survey_answer_type;
--   drop type if exists public.survey_status;
--
-- ⚠️ NENHUMA TABELA EXISTENTE É ALTERADA por esta migration. `event_segments` e
-- `chat_contacts` são apenas REFERENCIADAS (FK), e o rollback acima remove as
-- referências junto com as tabelas novas — nada de outro módulo é tocado.
-- ============================================================================
