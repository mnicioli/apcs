-- ============================================================================
-- AVALIAÇÃO DE EVENTO (Prompt 2 de 5)
-- ============================================================================
-- A etapa seguinte à Lista de Presença:
--
--   EVENTO → INSCRIÇÕES → PARTICIPANTES → PRESENÇA → (fim + X) → AVALIAÇÃO
--
-- ----------------------------------------------------------------------------
-- AS DECISÕES DE MODELAGEM, E POR QUE CADA UMA
-- ----------------------------------------------------------------------------
--
-- DECISÃO 1 — O MODELO DE AVALIAÇÃO É UMA TABELA, E O TEMPLATE PADRÃO É UMA
-- LINHA DELA COM `event_id` NULO.
--
--   O §2 pede que cada evento possa ter perguntas próprias; o §3 pede um modelo
--   padrão da APCS reutilizável. Duas tabelas ("templates" e "avaliações de
--   evento") dariam duas cópias de seção, pergunta e opção — e o construtor do
--   §24 teria de existir duas vezes, ou funcionar só numa delas.
--
--   Uma tabela só, com `event_id` nulo significando "modelo da casa", faz
--   habilitar a avaliação de um evento ser um CLONE: a estrutura do modelo vira
--   uma avaliação daquele evento, que a partir dali é editável sem que ninguém
--   corra o risco de reescrever o padrão da APCS para todo mundo.
--
-- DECISÃO 2 — A ESTRUTURA É VERSIONADA, E A VERSÃO NOVA NASCE SOZINHA.
--
--   O §23 manda respostas antigas continuarem ligadas à estrutura que a pessoa
--   realmente leu. Quem garante isso não é disciplina de quem edita: é
--   `save_event_evaluation_structure`, que olha se a versão corrente já tem
--   resposta e, se tiver, constrói uma v+1 em vez de mexer na que está sendo
--   usada. As perguntas da v1 continuam existindo, intocadas, com as respostas
--   apontando para elas.
--
--   ⚠️ E O `on delete restrict` DE `event_participant_evaluations.version_id`
--   é o que fecha a porta: uma versão com resposta não pode ser apagada nem por
--   engano.
--
-- DECISÃO 3 — O CONSTRUTOR SALVA A ESTRUTURA INTEIRA, E NÃO UMA PEÇA POR VEZ.
--
--   `save_event_evaluation_structure(p_event_id, p_sections jsonb)` recebe o
--   formulário completo. Não existe "adicionar bloco", "mover pergunta",
--   "remover opção" como operações do banco.
--
--   Isso é uma escolha, e ela se paga em três lugares: reordenar não precisa de
--   índice único em `position` (que transforma trocar duas linhas de lugar num
--   problema de deadlock); remover uma pergunta e acrescentar outra é UMA
--   transação, e não duas que podem falhar pela metade; e a decisão 2 tem um
--   ponto só para consultar antes de decidir entre editar e versionar.
--
--   O custo: um salvamento reescreve as linhas da versão corrente quando ela
--   ainda não tem resposta. Os ids das perguntas mudam — o que é irrelevante,
--   porque ninguém aponta para eles enquanto não há resposta.
--
-- DECISÃO 4 — A ESCALA É UMA LISTA DE OPÇÕES COM `numeric_value`, E NÃO UM
-- NÚMERO SOLTO NA RESPOSTA.
--
--   O §5 pede `value = 5, label = "Excelente"` guardados como dado estruturado,
--   e o §32 pede que o rating guarde valor numérico. A resposta guarda o
--   `option_id` E o `numeric_value` copiado da opção no instante do envio.
--
--   ⚠️ A CÓPIA É DELIBERADA, e é o §5 pedindo que a escala possa mudar sem
--   quebrar resposta existente. Sem ela, trocar "3 — Regular" por "3 — Neutro"
--   com peso 2 reescreveria em silêncio a média de todos os eventos passados.
--   Com ela, o que foi respondido continua valendo o que valia.
--
-- DECISÃO 5 — O TOKEN É GUARDADO CRU, NUMA COLUNA SEM GRANT.
--
--   O §34 manda tratar o token como credencial. Havia duas saídas:
--
--     (a) guardar só o SHA-256, como `chat_sessions.session_token_hash`;
--     (b) guardar o token, com a coluna fechada e só função DEFINER lendo.
--
--   Escolhida a (b), e o motivo é o §17. Guardando só o hash, REENVIAR exigiria
--   gerar um token novo — e um reenvio acontece justamente quando o primeiro
--   envio ficou em dúvida. Se a primeira mensagem tiver chegado (o caso
--   `unsettled`, que este projeto já conhece de Enquetes e de Eventos), rodar o
--   token deixaria a pessoa com um link morto na mão e nenhuma explicação.
--
--   O que a (b) perde: quem conseguir LER a tabela vê os tokens. Mas quem
--   consegue ler esta tabela já lê `event_participants` ao lado, com nome,
--   e-mail e telefone de todo mundo — o token não é o elo mais fraco desse
--   cenário. E a coluna não tem grant nenhum: nem `authenticated`, nem `anon`.
--
-- DECISÃO 6 — TODA ESCRITA PASSA POR FUNÇÃO `SECURITY DEFINER`; AS TABELAS SÃO
-- FECHADAS PARA `authenticated`.
--
--   `revoke insert, update, delete ... from authenticated, anon` em todas elas.
--   Não há grant de coluna nenhum, e por isso não há a armadilha de
--   `sql-column-grants.test.ts` (uma coluna nova esquecida fora da lista).
--
--   ⚠️ E É POR ISSO QUE CADA FUNÇÃO DE ESCRITA CONFERE A PERMISSÃO POR DENTRO.
--   `SECURITY DEFINER` desliga a RLS: sem a checagem no corpo, a função seria a
--   porta destrancada dos fundos. É a mesma disciplina de
--   `set_participant_presence`, e `src/test/sql-audit-writes.test.ts` guarda o
--   outro lado (função INVOKER escrevendo em tabela fechada).
--
-- ----------------------------------------------------------------------------
-- CÓDIGOS DE ERRO — classe `AV`, mapeada em src/lib/actions/errors.ts.
-- ----------------------------------------------------------------------------
--   AV001  o evento não tem horário de término — não dá para agendar (§10)
--   AV002  a avaliação não está habilitada para este evento
--   AV003  a estrutura enviada é inválida (bloco vazio, tipo sem opção, ...)
--   AV004  esta avaliação já foi respondida (§18)
--   AV005  o prazo de resposta terminou (§20)
--   AV006  falta responder uma pergunta obrigatória (§25)
--   AV007  a avaliação foi cancelada
--
-- ⚠️ CLASSE PRÓPRIA, e não `P0`: a classe `P0` é RESERVADA pelo PL/pgSQL (o
-- P0004 é `assert_failure`, que `exception when others` não captura). É a mesma
-- razão das classes `EV`, `LP` e `RG`. Ver 20260813000200.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. A chave composta que faltava em `event_participants`
-- ----------------------------------------------------------------------------
-- ⚠️ ELA EXISTE PARA A FK COMPOSTA DE `event_participant_evaluations`, e a FK
-- composta existe pelo §28 (IDOR). `event_registrations` já fez isso na
-- 20260922000100, e o raciocínio é o mesmo: guardar `event_id` ao lado de
-- `participant_id` só é seguro se o BANCO garantir que os dois combinam. Sem
-- esta unicidade, o Postgres recusa a FK composta — e sem a FK composta, o par
-- (evento, participante) poderia ficar inconsistente por uma escrita direta.
create unique index if not exists event_participants_id_event_idx
  on public.event_participants (id, event_id);


-- ----------------------------------------------------------------------------
-- 2. O modelo de avaliação (§2, §3, §31)
-- ----------------------------------------------------------------------------
create table if not exists public.event_evaluations (
  id uuid primary key default gen_random_uuid(),

  -- ⚠️ NULO = MODELO REUTILIZÁVEL DA CASA (decisão 1). Preenchido = a avaliação
  -- DAQUELE evento, clonada de um modelo e livre para ser editada.
  event_id uuid unique references public.events on delete cascade,

  name text not null,
  description text,

  -- O modelo padrão da APCS (§3). Só um por vez — ver o índice logo abaixo.
  is_default boolean not null default false,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,

  constraint event_evaluations_name_len
    check (char_length(btrim(name)) between 2 and 160),

  -- ⚠️ MODELO DA CASA NÃO PERTENCE A EVENTO NENHUM. Sem este CHECK, alguém
  -- marcaria a avaliação de um evento como padrão e o clone seguinte copiaria
  -- as perguntas específicas daquele evento para todos os outros.
  constraint event_evaluations_default_is_global
    check (not is_default or event_id is null)
);

comment on table public.event_evaluations is
  'Modelo de avaliacao. event_id nulo = template reutilizavel da APCS; preenchido = avaliacao daquele evento (§2, §3).';

-- Um padrão de cada vez. Índice parcial: as demais linhas não competem.
create unique index if not exists event_evaluations_single_default_idx
  on public.event_evaluations (is_default)
  where is_default;


create table if not exists public.event_evaluation_versions (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.event_evaluations on delete cascade,

  version integer not null,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles on delete set null,

  constraint event_evaluation_versions_number check (version >= 1),
  constraint event_evaluation_versions_unique unique (evaluation_id, version)
);

comment on table public.event_evaluation_versions is
  'Versao da estrutura (§23). Uma v+1 nasce quando a corrente ja tem resposta — ver save_event_evaluation_structure.';


create table if not exists public.event_evaluation_sections (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.event_evaluation_versions on delete cascade,

  -- ⚠️ SEM ÍNDICE ÚNICO (decisão 3). A ordem é reescrita inteira a cada
  -- salvamento, então não há troca de duas linhas de lugar para dar errado — e
  -- um único em (version_id, position) faria exatamente esse caso precisar de
  -- constraint adiável, que é complexidade sem cliente.
  position integer not null,
  title text not null,
  description text,

  constraint event_evaluation_sections_position check (position >= 0),
  constraint event_evaluation_sections_title_len
    check (char_length(btrim(title)) between 1 and 200)
);

comment on table public.event_evaluation_sections is
  'Bloco de perguntas (§24). "1 - AVALIE O EVENTO - EMPRESA X", "3 - INFRAESTRUTURA".';

create index if not exists event_evaluation_sections_version_idx
  on public.event_evaluation_sections (version_id, position);


create table if not exists public.event_evaluation_questions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.event_evaluation_sections on delete cascade,

  position integer not null,
  prompt text not null,
  question_type public.event_evaluation_question_type not null,

  -- §25. Conferida no banco também — ver `submit_event_evaluation`.
  required boolean not null default false,

  constraint event_evaluation_questions_position check (position >= 0),
  constraint event_evaluation_questions_prompt_len
    check (char_length(btrim(prompt)) between 1 and 500)
);

comment on table public.event_evaluation_questions is
  'Pergunta de um bloco (§4, §25). required e conferido no backend, nao so na tela.';

create index if not exists event_evaluation_questions_section_idx
  on public.event_evaluation_questions (section_id, position);


create table if not exists public.event_evaluation_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.event_evaluation_questions on delete cascade,

  position integer not null,
  label text not null,

  -- ⚠️ O NÚMERO DA ESCALA (§5, decisão 4). Obrigatório em `rating`, opcional no
  -- resto: "Excelente" vale 5 e isso vai virar média no Prompt 3; "Palestra da
  -- manhã" não vale número nenhum e somá-la seria inventar dado.
  numeric_value integer,

  constraint event_evaluation_options_position check (position >= 0),
  constraint event_evaluation_options_label_len
    check (char_length(btrim(label)) between 1 and 200)
);

comment on table public.event_evaluation_options is
  'Alternativa. numeric_value e o valor estruturado da escala (§5) — obrigatorio em rating.';

create index if not exists event_evaluation_options_question_idx
  on public.event_evaluation_options (question_id, position);


-- ----------------------------------------------------------------------------
-- 3. A configuração de envio, por evento (§9, §10)
-- ----------------------------------------------------------------------------
create table if not exists public.event_evaluation_settings (
  event_id uuid primary key references public.events on delete cascade,

  enabled boolean not null default false,
  evaluation_id uuid references public.event_evaluations on delete set null,

  -- §9/§10. O atraso DEPOIS DO TÉRMINO DO EVENTO, sempre em minutos.
  --
  -- ⚠️ MINUTOS, E A TELA É QUEM OFERECE "HORAS". O §9 fala em "unidade do
  -- atraso: minutos/horas", e guardar a unidade ao lado do número obrigaria
  -- toda conta do banco a multiplicar condicionalmente — inclusive a que decide
  -- quem recebe agora. Uma unidade só no armazenamento, duas na apresentação.
  delay_minutes integer not null default 30,

  -- §9/§20. Nulo = sem prazo; a avaliação fica disponível conforme a política do
  -- evento, que é o que o §20 manda quando não há prazo configurado.
  response_window_days integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,

  -- Sete dias de atraso é o teto. Acima disso não é "logo após o evento": é
  -- outra coisa, e provavelmente um erro de digitação.
  constraint event_evaluation_settings_delay
    check (delay_minutes between 0 and 10080),
  constraint event_evaluation_settings_window
    check (response_window_days is null or response_window_days between 1 and 365),

  -- ⚠️ HABILITADA SEM AVALIAÇÃO É UM ESTADO IMPOSSÍVEL, e não um estado
  -- intermediário. Sem este CHECK a rotina de disparo encontraria eventos
  -- "habilitados" sem nada para enviar, e o silêncio pareceria falha de envio.
  constraint event_evaluation_settings_enabled_needs_evaluation
    check (not enabled or evaluation_id is not null)
);

comment on table public.event_evaluation_settings is
  'Config de envio por evento (§9). delay_minutes conta do TERMINO do evento, nunca do check-in (§10).';


-- ----------------------------------------------------------------------------
-- 4. A avaliação de UM participante (§6, §7, §8, §31)
-- ----------------------------------------------------------------------------
create table if not exists public.event_participant_evaluations (
  id uuid primary key default gen_random_uuid(),

  event_id uuid not null references public.events on delete cascade,
  participant_id uuid not null,

  -- `restrict` (e não cascade): apagar um modelo que já foi respondido levaria
  -- as respostas junto. O banco recusa, e recusar é a resposta certa.
  evaluation_id uuid not null references public.event_evaluations on delete restrict,
  version_id uuid not null references public.event_evaluation_versions on delete restrict,

  -- Decisão 5. Sem grant — nem `authenticated`, nem `anon`.
  token text not null,

  status public.event_evaluation_status not null default 'scheduled',

  -- ==========================================================================
  -- ⚠️ §19 — A RODADA, E É ELA QUE FAZ "REABRIR" NÃO SER "APAGAR".
  -- ==========================================================================
  -- O §19 pede a modelagem de uma reabertura excepcional e proíbe exclusão
  -- física da resposta. As duas coisas juntas são um problema concreto: sem um
  -- discriminador, a resposta nova bateria no índice único da resposta antiga —
  -- a mesma pessoa, a mesma pergunta, a mesma opção.
  --
  -- Reabrir INCREMENTA esta contagem. As respostas da rodada 1 ficam onde
  -- estão, intocadas e legíveis; a rodada 2 grava ao lado. A tabulação do
  -- Prompt 3 lê a rodada corrente e continua tendo a anterior para explicar
  -- por que o número mudou.
  answer_round integer not null default 1,

  -- §10. O instante calculado a partir do TÉRMINO DO EVENTO + atraso.
  scheduled_for timestamptz,
  sent_at timestamptz,
  answered_at timestamptz,
  expires_at timestamptz,

  -- §16. Tentativa, quando e por quê. `attempts` existe para que exista teto.
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  -- §16. O id que o fornecedor devolveu. Sem ele ninguém escreve "enviada".
  provider_message_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_participant_evaluations_attempts check (attempts >= 0),
  constraint event_participant_evaluations_round check (answer_round >= 1),
  constraint event_participant_evaluations_error_len
    check (last_error is null or char_length(last_error) <= 1000),
  constraint event_participant_evaluations_token_len
    check (char_length(token) >= 24),

  -- ⚠️ "ENVIADA" EXIGE CARIMBO, e o par contrário também vale. É o mesmo
  -- desenho do CHECK de presença: o estado impossível não fica dependendo de
  -- todo caminho de escrita lembrar de preencher os dois campos.
  constraint event_participant_evaluations_sent_shape check (
    (status in ('sent', 'answered') and sent_at is not null)
    or (status in ('pending', 'scheduled', 'expired', 'cancelled'))
  ),
  constraint event_participant_evaluations_answered_shape check (
    (status = 'answered') = (answered_at is not null)
  ),

  -- §28. A cadeia participante↔evento garantida pelo banco, e não conferida por
  -- quem chama. Ver a seção 1.
  constraint event_participant_evaluations_participant_matches_event
    foreign key (participant_id, event_id)
    references public.event_participants (id, event_id) on delete cascade
);

comment on table public.event_participant_evaluations is
  'A avaliacao de UMA pessoa num evento (§31). O unico (event_id, participant_id) e o §18.';

-- ⚠️ O §18 INTEIRO, NESTA LINHA. "1 participante + 1 evento = 1 resposta." Não
-- é uma checagem que o job faz: é uma impossibilidade. Duas execuções
-- simultâneas do agendador esbarram aqui, e a segunda perde.
create unique index if not exists event_participant_evaluations_unique_idx
  on public.event_participant_evaluations (event_id, participant_id);

create unique index if not exists event_participant_evaluations_token_idx
  on public.event_participant_evaluations (token);

-- A fila do disparo: "quem já venceu a hora e ainda não foi".
create index if not exists event_participant_evaluations_queue_idx
  on public.event_participant_evaluations (status, scheduled_for);

create index if not exists event_participant_evaluations_event_idx
  on public.event_participant_evaluations (event_id, status);


-- ----------------------------------------------------------------------------
-- 5. As respostas (§30, §31, §32)
-- ----------------------------------------------------------------------------
create table if not exists public.event_evaluation_answers (
  id bigint generated always as identity primary key,

  participant_evaluation_id uuid not null
    references public.event_participant_evaluations on delete cascade,

  question_id uuid not null
    references public.event_evaluation_questions on delete restrict,

  -- §19. A rodada em que esta resposta foi dada — ver o comentário longo em
  -- `event_participant_evaluations.answer_round`. Uma reabertura grava ao lado
  -- da resposta anterior, e nunca por cima dela.
  round integer not null default 1,

  -- Preenchido em rating, single_choice, yes_no e multiple_choice.
  option_id uuid references public.event_evaluation_options on delete restrict,

  -- §32. A CÓPIA do `numeric_value` da opção no instante da resposta — ver a
  -- decisão 4. Nulo em free_text e em escolha sem peso.
  numeric_value integer,

  -- §26. O comentário. Continua ligado ao participante pela linha acima: a APCS
  -- optou por identificação, e a tabulação do Prompt 3 depende disso.
  text_value text,

  created_at timestamptz not null default now(),

  constraint event_evaluation_answers_round check (round >= 1),
  constraint event_evaluation_answers_text_len
    check (text_value is null or char_length(text_value) <= 4000),

  -- ⚠️ RESPOSTA VAZIA NÃO É RESPOSTA. Sem este CHECK, uma pergunta obrigatória
  -- passaria com uma linha de três nulos — e a contagem do §25 acharia que foi
  -- respondida.
  constraint event_evaluation_answers_has_content check (
    option_id is not null
    or numeric_value is not null
    or (text_value is not null and char_length(btrim(text_value)) > 0)
  )
);

comment on table public.event_evaluation_answers is
  'Uma linha por resposta. Multipla escolha gera varias linhas da mesma pergunta (§32).';

-- ⚠️ `nulls not distinct` É O QUE FAZ ESTE ÍNDICE VALER PARA TEXTO LIVRE.
-- Por padrão o Postgres considera dois nulos DIFERENTES, então (avaliação,
-- pergunta, null) não colidiria com ela mesma e um comentário poderia ser
-- gravado duas vezes. Com `nulls not distinct`, uma pergunta de texto aceita uma
-- linha só — e a múltipla escolha continua aceitando uma por opção, porque ali
-- `option_id` não é nulo.
create unique index if not exists event_evaluation_answers_unique_idx
  on public.event_evaluation_answers (participant_evaluation_id, round, question_id, option_id)
  nulls not distinct;

create index if not exists event_evaluation_answers_question_idx
  on public.event_evaluation_answers (question_id);


-- ----------------------------------------------------------------------------
-- 6. A trilha (§36)
-- ----------------------------------------------------------------------------
-- ⚠️ NONA TRILHA DO PROJETO, e o §36 não está sendo contrariado ao criar mais
-- uma: o MECANISMO de auditoria desta plataforma é uma trilha por domínio
-- (`document_audit_logs`, `event_audit_logs`, `membership_audit_logs`,
-- `lecture_audit_logs`, `market_bulletin_audit_logs`, `survey_audit_logs`,
-- `flow_audit_logs`, `event_registration_audit_logs`). Esta é a nona, com a
-- mesma forma das oito.
--
-- Empilhar em `event_registration_audit_logs` custaria a mesma coisa que ela
-- própria evitou ao não empilhar em `event_audit_logs`: um evento com 300
-- presentes produz 300 linhas de "convite enviado", e elas afogariam as linhas
-- de inscrição na tela que as mostra.
create table if not exists public.event_evaluation_audit_logs (
  id bigint generated always as identity primary key,

  event_id uuid references public.events on delete set null,
  evaluation_id uuid references public.event_evaluations on delete set null,

  action public.event_evaluation_audit_action not null,

  -- Nulo quando quem agiu foi a rotina, e não uma pessoa. Inventar um ator
  -- seria mentir sobre quem fez.
  actor_id uuid references public.profiles on delete set null,

  -- ⚠️ NUNCA DADO PESSOAL AQUI, e nunca o TOKEN (§33, §34). Ids, contagens e
  -- nomes de campo. O token é credencial: numa tabela que ninguém varre quando
  -- alguém pede exclusão, ele viraria um link permanente esquecido.
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

comment on table public.event_evaluation_audit_logs is
  'Trilha imutavel da avaliacao. So aceita INSERT. Nunca guarda dado pessoal nem token (§33, §34).';

create index if not exists event_evaluation_audit_logs_event_idx
  on public.event_evaluation_audit_logs (event_id, created_at desc);


-- ----------------------------------------------------------------------------
-- 7. Quem pode o quê (§35)
-- ----------------------------------------------------------------------------
-- ⚠️ TRÊS PERMISSÕES, E NÃO DUAS. O §35 sugere ver/gerenciar/enviar, e as três
-- sobrevivem à pergunta "isto muda quem pode o quê?":
--
--   evaluations.read   abrir a tela, ver o formulário e o andamento
--   evaluations.write  mexer nas perguntas e na configuração de envio
--   evaluations.send   reenviar um convite, cancelar, reabrir
--
-- `send` é separada de `write` porque ela é a única que SAI DO SISTEMA: um
-- reenvio é uma mensagem de WhatsApp que chega no celular de uma pessoa e custa
-- dinheiro por conversa iniciada. `write` é grave de outro jeito — reescrever a
-- pergunta muda o que a APCS está perguntando —, e por isso é a mais estreita.
--
--   Administrador  read  write  send
--   Atendente      read   —     send
--
-- O Atendente opera o evento (é ele quem marca a presença — ver a matriz de
-- `presence.write`) e é quem percebe que fulano não recebeu. Configurar o
-- formulário é outra conversa, e é de quem responde pela agenda.
create or replace function public.evaluations_is_reader()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Sem válvula para sessão ausente: a tela mostra nome e telefone de terceiros
  -- ao lado do andamento. Mesma assimetria de `presence_is_reader`.
  select coalesce((select public.current_app_role()) in ('admin', 'comercial'), false);
$$;

comment on function public.evaluations_is_reader() is
  'Pode abrir a gestao de avaliacoes. Administrador e Atendente.';

create or replace function public.evaluations_is_writer()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select public.current_app_role()) = 'admin', false);
$$;

comment on function public.evaluations_is_writer() is
  'Pode editar perguntas e configuracao de envio. So Administrador — ver a secao 7.';

create or replace function public.evaluations_is_sender()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select public.current_app_role()) in ('admin', 'comercial'), false);
$$;

comment on function public.evaluations_is_sender() is
  'Pode reenviar, cancelar e reabrir convite. Administrador e Atendente.';

revoke execute on function public.evaluations_is_reader() from public, anon;
grant execute on function public.evaluations_is_reader() to authenticated;
revoke execute on function public.evaluations_is_writer() from public, anon;
grant execute on function public.evaluations_is_writer() to authenticated;
revoke execute on function public.evaluations_is_sender() from public, anon;
grant execute on function public.evaluations_is_sender() to authenticated;


-- ----------------------------------------------------------------------------
-- 8. RLS: leitura pela função, escrita por ninguém (decisão 6)
-- ----------------------------------------------------------------------------
alter table public.event_evaluations enable row level security;
alter table public.event_evaluation_versions enable row level security;
alter table public.event_evaluation_sections enable row level security;
alter table public.event_evaluation_questions enable row level security;
alter table public.event_evaluation_options enable row level security;
alter table public.event_evaluation_settings enable row level security;
alter table public.event_participant_evaluations enable row level security;
alter table public.event_evaluation_answers enable row level security;
alter table public.event_evaluation_audit_logs enable row level security;

drop policy if exists event_evaluations_select on public.event_evaluations;
create policy event_evaluations_select on public.event_evaluations
  for select to authenticated using (public.evaluations_is_reader());

drop policy if exists event_evaluation_versions_select on public.event_evaluation_versions;
create policy event_evaluation_versions_select on public.event_evaluation_versions
  for select to authenticated using (public.evaluations_is_reader());

drop policy if exists event_evaluation_sections_select on public.event_evaluation_sections;
create policy event_evaluation_sections_select on public.event_evaluation_sections
  for select to authenticated using (public.evaluations_is_reader());

drop policy if exists event_evaluation_questions_select on public.event_evaluation_questions;
create policy event_evaluation_questions_select on public.event_evaluation_questions
  for select to authenticated using (public.evaluations_is_reader());

drop policy if exists event_evaluation_options_select on public.event_evaluation_options;
create policy event_evaluation_options_select on public.event_evaluation_options
  for select to authenticated using (public.evaluations_is_reader());

drop policy if exists event_evaluation_settings_select on public.event_evaluation_settings;
create policy event_evaluation_settings_select on public.event_evaluation_settings
  for select to authenticated using (public.evaluations_is_reader());

drop policy if exists event_participant_evaluations_select on public.event_participant_evaluations;
create policy event_participant_evaluations_select on public.event_participant_evaluations
  for select to authenticated using (public.evaluations_is_reader());

drop policy if exists event_evaluation_answers_select on public.event_evaluation_answers;
create policy event_evaluation_answers_select on public.event_evaluation_answers
  for select to authenticated using (public.evaluations_is_reader());

drop policy if exists event_evaluation_audit_logs_select on public.event_evaluation_audit_logs;
create policy event_evaluation_audit_logs_select on public.event_evaluation_audit_logs
  for select to authenticated using (public.evaluations_is_reader());

-- ⚠️ NENHUMA POLICY DE INSERT/UPDATE/DELETE, e os privilégios também saem.
-- As duas coisas: sem policy a RLS recusa, e sem privilégio o Postgres recusa
-- antes ainda. Quem escreve são as funções DEFINER desta migration.
--
-- ⚠️ A FORMA `revoke insert, update, delete` É DELIBERADA e não é estilo. Um
-- `revoke update on public.<t> from ...` sozinho marcaria a tabela como
-- "fechada por coluna" para `src/test/sql-column-grants.test.ts`, que então
-- passaria a exigir um `grant update (col, ...)` para cada coluna nova — uma
-- lista que ninguém aqui quer manter, porque a resposta certa neste módulo é
-- que `authenticated` não escreve em coluna nenhuma.
revoke insert, update, delete on public.event_evaluations from authenticated, anon;
revoke insert, update, delete on public.event_evaluation_versions from authenticated, anon;
revoke insert, update, delete on public.event_evaluation_sections from authenticated, anon;
revoke insert, update, delete on public.event_evaluation_questions from authenticated, anon;
revoke insert, update, delete on public.event_evaluation_options from authenticated, anon;
revoke insert, update, delete on public.event_evaluation_settings from authenticated, anon;
revoke insert, update, delete on public.event_participant_evaluations from authenticated, anon;
revoke insert, update, delete on public.event_evaluation_answers from authenticated, anon;
revoke insert, update, delete on public.event_evaluation_audit_logs from authenticated, anon;

-- ⚠️ O TOKEN NÃO É LEGÍVEL NEM POR QUEM PODE LER A TABELA (§34, decisão 5).
-- A tela de gestão mostra situação, data e tentativas — nunca o link. Quem
-- precisa dele é a rotina de envio, que roda como `service_role`, e a página
-- pública, que o recebe pela URL.
revoke select (token) on public.event_participant_evaluations from authenticated, anon;


-- ----------------------------------------------------------------------------
-- 9. Duas contas que o resto do arquivo repete (§10, §23)
-- ----------------------------------------------------------------------------
-- ⚠️ O TÉRMINO DO EVENTO, EM UM LUGAR SÓ. Ele aparece na tela (para dizer
-- quando o convite sai), no agendador (para decidir se já saiu) e no resumo. Um
-- cálculo copiado três vezes é um fuso horário errado esperando a vez.
--
-- ⚠️ E O FUSO É EXPLÍCITO. `event_date` é `date` e `end_time` é `time`; juntá-los
-- dá um `timestamp` SEM fuso, que o Postgres interpretaria no fuso do SERVIDOR
-- (UTC, na Supabase). "Termina às 18:00" viraria 15:00 em São Paulo — três horas
-- de erro, exatamente o defeito que 20260925000200 já custou a este projeto.
--
-- ⚠️ NULO QUANDO O EVENTO NÃO TEM HORÁRIO DE TÉRMINO (§10). `events.end_time` é
-- opcional neste sistema, e inventar um fim ("meia-noite", "mais quatro horas")
-- mandaria o convite numa hora que ninguém combinou. Nulo é a resposta honesta,
-- e quem chama decide o que fazer com ela — a tela avisa, o agendador pula.
create or replace function public.event_evaluation_send_at(
  p_event_id uuid,
  p_delay_minutes integer
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when e.end_time is null then null
    else ((e.event_date + e.end_time) at time zone 'America/Sao_Paulo')
         + make_interval(mins => coalesce(p_delay_minutes, 0))
  end
  from public.events e
  where e.id = p_event_id;
$$;

comment on function public.event_evaluation_send_at is
  'Termino do evento (fuso America/Sao_Paulo) + atraso. Nulo quando o evento nao tem end_time (§10).';

-- A versão corrente é a de maior número (§23).
create or replace function public.current_evaluation_version_id(p_evaluation_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select v.id
  from public.event_evaluation_versions v
  where v.evaluation_id = p_evaluation_id
  order by v.version desc
  limit 1;
$$;

comment on function public.current_evaluation_version_id is
  'A versao de maior numero da avaliacao (§23).';

revoke execute on function public.event_evaluation_send_at(uuid, integer) from public, anon;
grant execute on function public.event_evaluation_send_at(uuid, integer) to authenticated, service_role;
revoke execute on function public.current_evaluation_version_id(uuid) from public, anon;
grant execute on function public.current_evaluation_version_id(uuid) to authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 10. A estrutura de uma versão, em jsonb (§22, §24, §27)
-- ----------------------------------------------------------------------------
-- Serve a três chamadores muito diferentes: a tela de configuração (que mostra
-- as perguntas), o construtor (que as carrega para editar) e a PÁGINA PÚBLICA
-- (que as apresenta para responder). Uma montagem só — três consultas
-- parecidas divergiriam no dia em que um campo novo entrasse.
create or replace function public.evaluation_version_structure(p_version_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'description', s.description,
        'position', s.position,
        'questions', coalesce(q.perguntas, '[]'::jsonb)
      )
      order by s.position, s.id
    ),
    '[]'::jsonb
  )
  from public.event_evaluation_sections s
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', qq.id,
        'prompt', qq.prompt,
        'type', qq.question_type,
        'required', qq.required,
        'position', qq.position,
        'options', coalesce(o.opcoes, '[]'::jsonb)
      )
      order by qq.position, qq.id
    ) as perguntas
    from public.event_evaluation_questions qq
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id', oo.id,
          'label', oo.label,
          'value', oo.numeric_value,
          'position', oo.position
        )
        order by oo.position, oo.id
      ) as opcoes
      from public.event_evaluation_options oo
      where oo.question_id = qq.id
    ) o on true
    where qq.section_id = s.id
  ) q on true
  where s.version_id = p_version_id;
$$;

comment on function public.evaluation_version_structure is
  'A estrutura de uma versao em jsonb. Usada pela tela, pelo construtor e pela pagina publica.';

revoke execute on function public.evaluation_version_structure(uuid) from public, anon;
grant execute on function public.evaluation_version_structure(uuid) to authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 11. A lista de eventos da tela de Avaliações (§21)
-- ----------------------------------------------------------------------------
-- ⚠️ MÉTRICAS E LINHAS NA MESMA CONSULTA, pelo mesmo motivo de
-- `event_registrations_board`: um contador que roda numa consulta e uma lista
-- que roda em outra divergem no dia em que um filtro entrar só numa delas.
--
-- ⚠️ SÓ EVENTOS COM PARTICIPANTE. Um evento sem inscrição nenhuma não tem o que
-- avaliar, e listá-lo empurraria para baixo os que interessam. É o mesmo
-- recorte da tela de seleção da Lista de Presença.
--
-- ⚠️ `SECURITY INVOKER` — a RLS continua valendo. Quem não passa em
-- `evaluations_is_reader()` recebe zero linhas mesmo que a checagem de permissão
-- da aplicação falhe.
create or replace function public.event_evaluation_summaries(
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with base as (
    select
      e.id,
      e.name,
      e.event_date,
      e.start_time,
      e.end_time,
      s.enabled,
      s.evaluation_id,
      s.delay_minutes,
      s.response_window_days,
      public.event_evaluation_send_at(e.id, coalesce(s.delay_minutes, 0)) as send_at,
      (select count(*) from public.event_participants p
        where p.event_id = e.id) as participants,
      (select count(*) from public.event_participants p
        where p.event_id = e.id and p.present) as present,
      (select count(*) from public.event_participant_evaluations pe
        where pe.event_id = e.id and pe.status in ('sent', 'answered')) as sent,
      (select count(*) from public.event_participant_evaluations pe
        where pe.event_id = e.id and pe.status = 'answered') as answered,
      (select count(*) from public.event_participant_evaluations pe
        where pe.event_id = e.id and pe.status in ('pending', 'scheduled')) as queued
    from public.events e
    left join public.event_evaluation_settings s on s.event_id = e.id
    where exists (select 1 from public.event_participants p where p.event_id = e.id)
      and (
        p_query is null
        or btrim(p_query) = ''
        -- `unaccent` não está instalado neste banco; `ilike` é o que a grid de
        -- eventos já usa, e o nome do evento é curto o bastante para bastar.
        or e.name ilike '%' || btrim(p_query) || '%'
      )
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce(
      (
        select jsonb_agg(linha order by linha_date desc, linha_name)
        from (
          select
            b.event_date as linha_date,
            b.name as linha_name,
            jsonb_build_object(
              'eventId', b.id,
              'eventName', b.name,
              'eventDate', b.event_date,
              'startTime', b.start_time,
              'endTime', b.end_time,
              'configured', b.evaluation_id is not null,
              'enabled', coalesce(b.enabled, false),
              'delayMinutes', b.delay_minutes,
              'responseWindowDays', b.response_window_days,
              'sendAt', b.send_at,
              'participants', b.participants,
              'present', b.present,
              'sent', b.sent,
              'answered', b.answered,
              'queued', b.queued
            ) as linha
          from base b
          order by b.event_date desc, b.name
          limit greatest(coalesce(p_limit, 20), 1)
          offset greatest(coalesce(p_offset, 0), 0)
        ) pagina
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.event_evaluation_summaries is
  'A grid da tela de Avaliacoes (§21). So eventos com participante. SECURITY INVOKER — a RLS vale.';

revoke execute on function public.event_evaluation_summaries(text, integer, integer)
  from public, anon;
grant execute on function public.event_evaluation_summaries(text, integer, integer)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 12. A gestão de UM evento (§21, §22)
-- ----------------------------------------------------------------------------
create or replace function public.event_evaluation_detail(p_event_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'eventId', e.id,
    'eventName', e.name,
    'eventDate', e.event_date,
    'startTime', e.start_time,
    'endTime', e.end_time,
    'enabled', coalesce(s.enabled, false),
    'delayMinutes', coalesce(s.delay_minutes, 30),
    'responseWindowDays', s.response_window_days,
    'sendAt', public.event_evaluation_send_at(e.id, coalesce(s.delay_minutes, 30)),
    'evaluationId', s.evaluation_id,
    'evaluationName', ev.name,
    'versionId', v.id,
    'version', v.version,
    -- ⚠️ A ESTRUTURA JÁ TEM RESPOSTA? É o que decide se editar reescreve ou cria
    -- uma v+1 (§23), e a tela precisa dizer isso ANTES de a pessoa salvar.
    'versionHasAnswers', coalesce(
      (
        select exists (
          select 1
          from public.event_participant_evaluations pe
          where pe.version_id = v.id and pe.status = 'answered'
        )
      ),
      false
    ),
    'sections', case when v.id is null then '[]'::jsonb
                     else public.evaluation_version_structure(v.id) end,
    'present', (select count(*) from public.event_participants p
                 where p.event_id = e.id and p.present),
    'sent', (select count(*) from public.event_participant_evaluations pe
              where pe.event_id = e.id and pe.status in ('sent', 'answered')),
    'answered', (select count(*) from public.event_participant_evaluations pe
                  where pe.event_id = e.id and pe.status = 'answered'),
    'templates', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', t.id, 'name', t.name, 'isDefault', t.is_default)
          order by t.is_default desc, t.name
        )
        from public.event_evaluations t
        where t.event_id is null
      ),
      '[]'::jsonb
    )
  )
  from public.events e
  left join public.event_evaluation_settings s on s.event_id = e.id
  left join public.event_evaluations ev on ev.id = s.evaluation_id
  left join public.event_evaluation_versions v
    on v.id = public.current_evaluation_version_id(s.evaluation_id)
  where e.id = p_event_id;
$$;

comment on function public.event_evaluation_detail is
  'Config + estrutura + numeros de UM evento (§21, §22). SECURITY INVOKER.';

revoke execute on function public.event_evaluation_detail(uuid) from public, anon;
grant execute on function public.event_evaluation_detail(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 13. O andamento por participante (§17, §21)
-- ----------------------------------------------------------------------------
create or replace function public.event_evaluation_participants(
  p_event_id uuid,
  p_query text default null,
  p_status text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with base as (
    select
      p.id as participant_id,
      p.full_name,
      p.email,
      p.confirmation,
      p.present,
      r.company_name,
      pe.id as participant_evaluation_id,
      pe.status,
      pe.scheduled_for,
      pe.sent_at,
      pe.answered_at,
      pe.expires_at,
      pe.attempts,
      pe.last_error
    from public.event_participants p
    join public.event_registrations r on r.id = p.registration_id
    left join public.event_participant_evaluations pe
      on pe.participant_id = p.id and pe.event_id = p.event_id
    where p.event_id = p_event_id
      -- ⚠️ SÓ PRESENTES (§11). Esta tela é o andamento da AVALIAÇÃO, e quem não
      -- apareceu não é elegível — listá-lo com "—" em toda coluna faria a taxa
      -- de resposta parecer pior do que é.
      and p.present
      and (
        p_query is null or btrim(p_query) = ''
        or p.full_name ilike '%' || btrim(p_query) || '%'
        or p.email ilike '%' || btrim(p_query) || '%'
        or r.company_name ilike '%' || btrim(p_query) || '%'
      )
      and (
        p_status is null or btrim(p_status) = '' or p_status = 'all'
        or (p_status = 'not_created' and pe.id is null)
        or (pe.id is not null and pe.status::text = p_status)
      )
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'metrics', jsonb_build_object(
      'present', (select count(*) from base),
      'sent', (select count(*) from base where status in ('sent', 'answered')),
      'answered', (select count(*) from base where status = 'answered'),
      'failed', (select count(*) from base where last_error is not null and status <> 'answered')
    ),
    'rows', coalesce(
      (
        select jsonb_agg(linha order by ordem_nome)
        from (
          select
            b.full_name as ordem_nome,
            jsonb_build_object(
              'participantId', b.participant_id,
              'participantEvaluationId', b.participant_evaluation_id,
              'fullName', b.full_name,
              'email', b.email,
              'companyName', b.company_name,
              'confirmation', b.confirmation,
              'present', b.present,
              'status', b.status,
              'scheduledFor', b.scheduled_for,
              'sentAt', b.sent_at,
              'answeredAt', b.answered_at,
              'expiresAt', b.expires_at,
              'attempts', coalesce(b.attempts, 0),
              'lastError', b.last_error
            ) as linha
          from base b
          order by b.full_name
          limit greatest(coalesce(p_limit, 20), 1)
          offset greatest(coalesce(p_offset, 0), 0)
        ) pagina
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.event_evaluation_participants is
  'Andamento por participante presente (§11, §21). SECURITY INVOKER — a RLS vale.';

revoke execute on function public.event_evaluation_participants(uuid, text, text, integer, integer)
  from public, anon;
grant execute on function public.event_evaluation_participants(uuid, text, text, integer, integer)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 14. `updated_at` — o gatilho que já existe desde a migration inicial
-- ----------------------------------------------------------------------------
drop trigger if exists set_updated_at on public.event_evaluations;
create trigger set_updated_at before update on public.event_evaluations
  for each row execute procedure public.handle_updated_at();

drop trigger if exists set_updated_at on public.event_evaluation_settings;
create trigger set_updated_at before update on public.event_evaluation_settings
  for each row execute procedure public.handle_updated_at();

drop trigger if exists set_updated_at on public.event_participant_evaluations;
create trigger set_updated_at before update on public.event_participant_evaluations
  for each row execute procedure public.handle_updated_at();


-- ----------------------------------------------------------------------------
-- 15. Copiar a estrutura de uma versão para outra (§3, §22)
-- ----------------------------------------------------------------------------
-- ⚠️ LAÇOS EXPLÍCITOS, E NÃO UM ENCADEAMENTO DE CTEs COM `returning`. A versão
-- em CTE existia e era mais curta; ela parear origem e destino por `position`,
-- que é o tipo de correspondência que funciona até o dia em que duas linhas
-- empatam. O laço carrega o id novo na mão, e não há pareamento nenhum para dar
-- errado.
--
-- O custo — três consultas por bloco em vez de três no total — é irrelevante:
-- isto roda quando alguém habilita a avaliação de um evento, sobre um
-- formulário de cinco blocos.
--
-- ⚠️ ELA NÃO CONFERE PERMISSÃO, e isso é deliberado: é uma peça interna,
-- chamada apenas por funções que já conferiram. Por isso `authenticated` não
-- pode executá-la — ver o `revoke` logo abaixo. Chamá-la de fora não é um
-- caminho previsto.
create or replace function public.clone_evaluation_version(
  p_source_version_id uuid,
  p_target_version_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secao record;
  v_pergunta record;
  v_secao_nova uuid;
  v_pergunta_nova uuid;
begin
  for v_secao in
    select s.id, s.position, s.title, s.description
    from public.event_evaluation_sections s
    where s.version_id = p_source_version_id
    order by s.position, s.id
  loop
    insert into public.event_evaluation_sections (version_id, position, title, description)
    values (p_target_version_id, v_secao.position, v_secao.title, v_secao.description)
    returning id into v_secao_nova;

    for v_pergunta in
      select q.id, q.position, q.prompt, q.question_type, q.required
      from public.event_evaluation_questions q
      where q.section_id = v_secao.id
      order by q.position, q.id
    loop
      insert into public.event_evaluation_questions
        (section_id, position, prompt, question_type, required)
      values (
        v_secao_nova, v_pergunta.position, v_pergunta.prompt,
        v_pergunta.question_type, v_pergunta.required
      )
      returning id into v_pergunta_nova;

      insert into public.event_evaluation_options (question_id, position, label, numeric_value)
      select v_pergunta_nova, o.position, o.label, o.numeric_value
      from public.event_evaluation_options o
      where o.question_id = v_pergunta.id;
    end loop;
  end loop;
end;
$$;

comment on function public.clone_evaluation_version is
  'Copia blocos, perguntas e opcoes de uma versao para outra. Peca interna — authenticated nao executa.';

revoke execute on function public.clone_evaluation_version(uuid, uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 16. Garantir que o evento tenha uma avaliação própria (§2, §3, decisão 1)
-- ----------------------------------------------------------------------------
-- Clona o modelo escolhido (ou o padrão da APCS) para uma avaliação DAQUELE
-- evento, e devolve o id dela. Se o evento já tiver uma, devolve a que existe
-- sem tocar em nada.
--
-- ⚠️ O EVENTO NUNCA APONTA PARA O MODELO DA CASA. Apontar seria mais barato —
-- uma linha a menos — e editaria as perguntas de todos os eventos ao mesmo
-- tempo, inclusive os já respondidos. O clone é o que torna o §2 ("cada evento
-- poderá possuir uma avaliação") verdadeiro sem prejudicar o §3.
create or replace function public.ensure_event_evaluation(
  p_event_id uuid,
  p_template_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_existing uuid;
  v_template uuid;
  v_template_version uuid;
  v_evaluation uuid;
  v_version uuid;
begin
  select * into v_event from public.events e where e.id = p_event_id;
  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  select s.evaluation_id into v_existing
  from public.event_evaluation_settings s
  where s.event_id = p_event_id;

  if v_existing is not null then
    return v_existing;
  end if;

  -- Sem modelo indicado, o padrão da casa (§3).
  v_template := coalesce(
    p_template_id,
    (select t.id from public.event_evaluations t where t.is_default limit 1)
  );

  if v_template is null then
    raise exception 'Não há modelo de avaliação disponível para copiar.' using errcode = 'AV003';
  end if;

  -- ⚠️ O MODELO PRECISA SER UM MODELO. Aceitar aqui o id da avaliação de OUTRO
  -- evento copiaria as perguntas específicas dele — inclusive nomes de empresa
  -- que não têm nada a ver com este.
  if not exists (
    select 1 from public.event_evaluations t
    where t.id = v_template and t.event_id is null
  ) then
    raise exception 'Modelo de avaliação inválido.' using errcode = 'AV003';
  end if;

  insert into public.event_evaluations (event_id, name, description, created_by, updated_by)
  select p_event_id,
         left('Avaliação — ' || v_event.name, 160),
         t.description,
         (select auth.uid()),
         (select auth.uid())
  from public.event_evaluations t
  where t.id = v_template
  returning id into v_evaluation;

  insert into public.event_evaluation_versions (evaluation_id, version, created_by)
  values (v_evaluation, 1, (select auth.uid()))
  returning id into v_version;

  v_template_version := public.current_evaluation_version_id(v_template);
  if v_template_version is not null then
    perform public.clone_evaluation_version(v_template_version, v_version);
  end if;

  insert into public.event_evaluation_audit_logs (event_id, evaluation_id, action, actor_id, metadata)
  values (
    p_event_id, v_evaluation, 'evaluation_created', (select auth.uid()),
    jsonb_build_object('templateId', v_template, 'version', 1)
  );

  return v_evaluation;
end;
$$;

comment on function public.ensure_event_evaluation is
  'Clona um modelo para uma avaliacao do evento (decisao 1). Idempotente: ja existindo, devolve a que existe.';

revoke execute on function public.ensure_event_evaluation(uuid, uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 17. Salvar a configuração de envio (§9, §22)
-- ----------------------------------------------------------------------------
create or replace function public.save_event_evaluation_settings(
  p_event_id uuid,
  p_enabled boolean,
  p_delay_minutes integer,
  p_response_window_days integer default null,
  p_template_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_evaluation uuid;
  v_before public.event_evaluation_settings;
begin
  if not public.evaluations_is_writer() then
    raise exception 'Sem permissão para configurar a avaliação.' using errcode = '42501';
  end if;

  select * into v_event from public.events e where e.id = p_event_id;
  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- ==========================================================================
  -- ⚠️ §10 — SEM HORÁRIO DE TÉRMINO NÃO HÁ QUANDO ENVIAR.
  -- ==========================================================================
  -- `events.end_time` é opcional neste sistema (ver `event.schema.ts`), e o §10
  -- manda o disparo ser "término do evento + atraso". Sem o término, a conta não
  -- existe.
  --
  -- Recusar AQUI, no momento de habilitar, é a diferença entre um aviso que a
  -- pessoa lê enquanto configura e um silêncio que ela descobre no dia seguinte
  -- ao evento, quando ninguém recebeu nada. A alternativa — inventar um fim —
  -- mandaria trezentas mensagens numa hora que ninguém combinou.
  if coalesce(p_enabled, false) and v_event.end_time is null then
    raise exception 'Este evento não tem horário de término. Informe o término do evento antes de habilitar a avaliação.'
      using errcode = 'AV001';
  end if;

  select * into v_before
  from public.event_evaluation_settings s where s.event_id = p_event_id;

  -- Habilitar exige uma avaliação; o CHECK da tabela impõe, e aqui a gente
  -- providencia em vez de recusar.
  if coalesce(p_enabled, false) then
    v_evaluation := public.ensure_event_evaluation(p_event_id, p_template_id);
  else
    v_evaluation := v_before.evaluation_id;
  end if;

  insert into public.event_evaluation_settings as s
    (event_id, enabled, evaluation_id, delay_minutes, response_window_days, updated_by)
  values (
    p_event_id,
    coalesce(p_enabled, false),
    v_evaluation,
    coalesce(p_delay_minutes, 30),
    p_response_window_days,
    (select auth.uid())
  )
  on conflict (event_id) do update
  set enabled = excluded.enabled,
      evaluation_id = coalesce(excluded.evaluation_id, s.evaluation_id),
      delay_minutes = excluded.delay_minutes,
      response_window_days = excluded.response_window_days,
      updated_by = excluded.updated_by;

  insert into public.event_evaluation_audit_logs (event_id, evaluation_id, action, actor_id, metadata)
  values (
    p_event_id, v_evaluation, 'settings_changed', (select auth.uid()),
    jsonb_build_object(
      'enabledFrom', v_before.enabled,
      'enabledTo', coalesce(p_enabled, false),
      'delayMinutesFrom', v_before.delay_minutes,
      'delayMinutesTo', coalesce(p_delay_minutes, 30),
      'responseWindowDaysFrom', v_before.response_window_days,
      'responseWindowDaysTo', p_response_window_days
    )
  );

  return public.event_evaluation_detail(p_event_id);
end;
$$;

comment on function public.save_event_evaluation_settings is
  'Habilita/desabilita e configura atraso e prazo (§9). Recusa habilitar evento sem end_time (AV001, §10).';

revoke execute on function
  public.save_event_evaluation_settings(uuid, boolean, integer, integer, uuid)
  from public, anon;
grant execute on function
  public.save_event_evaluation_settings(uuid, boolean, integer, integer, uuid)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 18. Recomeçar a partir de um modelo (§22)
-- ----------------------------------------------------------------------------
-- ⚠️ FUNÇÃO SEPARADA DA CONFIGURAÇÃO, e a razão é que ela DESTRÓI trabalho:
-- trocar o modelo joga fora as perguntas que alguém escreveu. Enfiada dentro de
-- "salvar configuração", ela seria disparada por quem só queria mudar o atraso
-- de 30 para 60 minutos.
--
-- ⚠️ E ELA RECUSA QUANDO JÁ HÁ RESPOSTA (§22: "não permitir editar uma avaliação
-- já respondida de forma que altere o significado das respostas históricas").
-- Aqui não há a saída do §23 — versionar —, porque trocar o modelo inteiro não
-- é uma alteração da estrutura: é outra pesquisa.
create or replace function public.apply_evaluation_template(
  p_event_id uuid,
  p_template_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation uuid;
  v_version uuid;
  v_template_version uuid;
begin
  if not public.evaluations_is_writer() then
    raise exception 'Sem permissão para configurar a avaliação.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.event_evaluations t
    where t.id = p_template_id and t.event_id is null
  ) then
    raise exception 'Modelo de avaliação inválido.' using errcode = 'AV003';
  end if;

  v_evaluation := public.ensure_event_evaluation(p_event_id, p_template_id);
  v_version := public.current_evaluation_version_id(v_evaluation);

  if exists (
    select 1 from public.event_participant_evaluations pe
    where pe.version_id = v_version and pe.status = 'answered'
  ) then
    raise exception 'Esta avaliação já tem respostas. Edite as perguntas em vez de trocar o modelo.'
      using errcode = 'AV004';
  end if;

  -- O cascade das FKs leva perguntas e opções junto.
  delete from public.event_evaluation_sections s where s.version_id = v_version;

  v_template_version := public.current_evaluation_version_id(p_template_id);
  if v_template_version is not null then
    perform public.clone_evaluation_version(v_template_version, v_version);
  end if;

  insert into public.event_evaluation_audit_logs (event_id, evaluation_id, action, actor_id, metadata)
  values (
    p_event_id, v_evaluation, 'structure_changed', (select auth.uid()),
    jsonb_build_object('source', 'template', 'templateId', p_template_id)
  );

  return public.event_evaluation_detail(p_event_id);
end;
$$;

comment on function public.apply_evaluation_template is
  'Substitui a estrutura do evento pela do modelo (§22). Recusa quando ja ha resposta (AV004).';

revoke execute on function public.apply_evaluation_template(uuid, uuid) from public, anon;
grant execute on function public.apply_evaluation_template(uuid, uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 19. O construtor: salvar a estrutura inteira (§23, §24, §25, decisões 2 e 3)
-- ----------------------------------------------------------------------------
-- Formato de `p_sections`:
--
--   [ { "title": "...", "description": null,
--       "questions": [ { "prompt": "...", "type": "rating", "required": true,
--                        "options": [ { "label": "Excelente", "value": 5 } ] } ] } ]
--
-- ⚠️ `yes_no` TEM AS OPÇÕES GERADAS AQUI, e o que vier no payload é ignorado.
-- Sim vale 1, Não vale 0, sempre. Sem isso, cada avaliação teria a sua própria
-- grafia de "Sim"/"sim"/"SIM" e a tabulação do Prompt 3 teria de adivinhar quais
-- são a mesma resposta. É o mesmo motivo de a escala de rating carregar
-- `numeric_value`.
create or replace function public.save_event_evaluation_structure(
  p_event_id uuid,
  p_sections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation uuid;
  v_current uuid;
  v_target uuid;
  v_next_version integer;
  v_versionou boolean := false;

  v_secao jsonb;
  v_secao_pos integer;
  v_secao_id uuid;

  v_pergunta jsonb;
  v_pergunta_pos integer;
  v_pergunta_id uuid;
  v_tipo text;

  v_opcao jsonb;
  v_opcao_pos integer;
  v_qtd_opcoes integer;
begin
  if not public.evaluations_is_writer() then
    raise exception 'Sem permissão para editar as perguntas.' using errcode = '42501';
  end if;

  select s.evaluation_id into v_evaluation
  from public.event_evaluation_settings s
  where s.event_id = p_event_id;

  if v_evaluation is null then
    raise exception 'Configure a avaliação deste evento antes de editar as perguntas.'
      using errcode = 'AV002';
  end if;

  if jsonb_typeof(p_sections) is distinct from 'array' or jsonb_array_length(p_sections) = 0 then
    raise exception 'A avaliação precisa de pelo menos um bloco de perguntas.' using errcode = 'AV003';
  end if;

  v_current := public.current_evaluation_version_id(v_evaluation);

  -- ==========================================================================
  -- ⚠️ §23 — A VERSÃO NOVA NASCE AQUI, E NÃO POR DECISÃO DE QUEM EDITA.
  -- ==========================================================================
  -- "Nunca alterar silenciosamente a estrutura de uma avaliação que já possui
  -- respostas." Quem confere é o banco, uma linha antes de escrever. Deixar essa
  -- decisão para a tela significaria que uma segunda tela — ou uma chamada
  -- direta ao PostgREST — a tomaria diferente.
  if v_current is not null and exists (
    select 1 from public.event_participant_evaluations pe
    where pe.version_id = v_current and pe.status = 'answered'
  ) then
    select coalesce(max(v.version), 0) + 1 into v_next_version
    from public.event_evaluation_versions v where v.evaluation_id = v_evaluation;

    insert into public.event_evaluation_versions (evaluation_id, version, created_by)
    values (v_evaluation, v_next_version, (select auth.uid()))
    returning id into v_target;

    v_versionou := true;
  else
    if v_current is null then
      insert into public.event_evaluation_versions (evaluation_id, version, created_by)
      values (v_evaluation, 1, (select auth.uid()))
      returning id into v_target;
    else
      v_target := v_current;
      -- Cascade leva perguntas e opções. Só acontece em versão sem resposta.
      delete from public.event_evaluation_sections s where s.version_id = v_target;
    end if;
  end if;

  -- ==========================================================================
  -- A montagem, bloco a bloco.
  -- ==========================================================================
  -- ⚠️ `with ordinality` DÁ A NUMERAÇÃO, e não um contador da própria função. É
  -- o que garante que `position` nunca empate — de que `clone_evaluation_version`
  -- depende para parear origem e destino.
  for v_secao, v_secao_pos in
    select valor, ordem
    from jsonb_array_elements(p_sections) with ordinality as t(valor, ordem)
  loop
    if coalesce(btrim(v_secao ->> 'title'), '') = '' then
      raise exception 'Todo bloco precisa de um título.' using errcode = 'AV003';
    end if;

    if jsonb_typeof(v_secao -> 'questions') is distinct from 'array'
       or jsonb_array_length(v_secao -> 'questions') = 0 then
      raise exception 'O bloco "%" está sem perguntas.', btrim(v_secao ->> 'title')
        using errcode = 'AV003';
    end if;

    insert into public.event_evaluation_sections (version_id, position, title, description)
    values (
      v_target,
      v_secao_pos,
      left(btrim(v_secao ->> 'title'), 200),
      nullif(btrim(coalesce(v_secao ->> 'description', '')), '')
    )
    returning id into v_secao_id;

    for v_pergunta, v_pergunta_pos in
      select valor, ordem
      from jsonb_array_elements(v_secao -> 'questions') with ordinality as t(valor, ordem)
    loop
      if coalesce(btrim(v_pergunta ->> 'prompt'), '') = '' then
        raise exception 'Toda pergunta precisa de um enunciado.' using errcode = 'AV003';
      end if;

      v_tipo := coalesce(btrim(v_pergunta ->> 'type'), '');
      if v_tipo not in ('rating', 'single_choice', 'multiple_choice', 'yes_no', 'free_text') then
        raise exception 'Tipo de pergunta desconhecido: %.', v_tipo using errcode = 'AV003';
      end if;

      insert into public.event_evaluation_questions
        (section_id, position, prompt, question_type, required)
      values (
        v_secao_id,
        v_pergunta_pos,
        left(btrim(v_pergunta ->> 'prompt'), 500),
        v_tipo::public.event_evaluation_question_type,
        coalesce((v_pergunta ->> 'required')::boolean, false)
      )
      returning id into v_pergunta_id;

      if v_tipo = 'yes_no' then
        -- Geradas, nunca recebidas — ver o cabeçalho desta seção.
        insert into public.event_evaluation_options (question_id, position, label, numeric_value)
        values (v_pergunta_id, 1, 'Sim', 1), (v_pergunta_id, 2, 'Não', 0);

      elsif v_tipo = 'free_text' then
        -- Texto livre não tem alternativa. Um payload que traga opções aqui está
        -- confuso sobre o próprio tipo, e aceitá-lo em silêncio esconderia isso.
        if jsonb_typeof(v_pergunta -> 'options') = 'array'
           and jsonb_array_length(v_pergunta -> 'options') > 0 then
          raise exception 'Pergunta de texto livre não tem alternativas.' using errcode = 'AV003';
        end if;

      else
        if jsonb_typeof(v_pergunta -> 'options') is distinct from 'array' then
          raise exception 'A pergunta "%" precisa de alternativas.',
            btrim(v_pergunta ->> 'prompt') using errcode = 'AV003';
        end if;

        v_qtd_opcoes := jsonb_array_length(v_pergunta -> 'options');
        if v_qtd_opcoes < 2 then
          raise exception 'A pergunta "%" precisa de pelo menos duas alternativas.',
            btrim(v_pergunta ->> 'prompt') using errcode = 'AV003';
        end if;

        for v_opcao, v_opcao_pos in
          select valor, ordem
          from jsonb_array_elements(v_pergunta -> 'options') with ordinality as t(valor, ordem)
        loop
          if coalesce(btrim(v_opcao ->> 'label'), '') = '' then
            raise exception 'Toda alternativa precisa de um texto.' using errcode = 'AV003';
          end if;

          -- ⚠️ `rating` EXIGE O NÚMERO (§5, decisão 4). Sem ele a opção entra na
          -- escala sem peso, e a média do Prompt 3 a trataria como ausência de
          -- resposta — um "Regular" sumindo da conta em silêncio.
          if v_tipo = 'rating' and (v_opcao ->> 'value') is null then
            raise exception 'Toda alternativa de uma pergunta de nota precisa de um valor.'
              using errcode = 'AV003';
          end if;

          insert into public.event_evaluation_options (question_id, position, label, numeric_value)
          values (
            v_pergunta_id,
            v_opcao_pos,
            left(btrim(v_opcao ->> 'label'), 200),
            (v_opcao ->> 'value')::integer
          );
        end loop;
      end if;
    end loop;
  end loop;

  insert into public.event_evaluation_audit_logs (event_id, evaluation_id, action, actor_id, metadata)
  values (
    p_event_id, v_evaluation,
    case when v_versionou then 'version_published' else 'structure_changed' end,
    (select auth.uid()),
    jsonb_build_object(
      'versionId', v_target,
      'sections', jsonb_array_length(p_sections),
      'newVersion', v_versionou
    )
  );

  return public.event_evaluation_detail(p_event_id);
end;
$$;

comment on function public.save_event_evaluation_structure is
  'Salva a estrutura inteira (decisao 3). Versiona sozinha quando a versao corrente ja tem resposta (§23).';

revoke execute on function public.save_event_evaluation_structure(uuid, jsonb) from public, anon;
grant execute on function public.save_event_evaluation_structure(uuid, jsonb) to authenticated;


-- ============================================================================
-- O ENVIO AUTOMÁTICO (§14, §15, §16)
-- ============================================================================
-- As quatro funções abaixo rodam como `service_role`, chamadas pela rotina em
-- `/api/jobs/event-evaluations`. Nenhuma delas é executável por `authenticated`
-- — quem opera o sistema não agenda nem marca envio à mão.
--
-- ⚠️ CHAMAR DUAS VEZES SEGUIDAS É SEGURO, e é o §15. Nenhuma delas depende de
-- ter rodado antes: o agendamento esbarra num índice único, a reivindicação usa
-- `skip locked` com arrendamento, e a marcação só sai de um estado que ainda
-- não foi marcado. É o mesmo desenho de `/api/jobs/surveys`.
-- ----------------------------------------------------------------------------


-- ----------------------------------------------------------------------------
-- 20. Agendar quem tem direito (§11, §14)
-- ----------------------------------------------------------------------------
create or replace function public.schedule_event_evaluations(p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evento record;
  v_version uuid;
  v_send_at timestamptz;
  v_expires timestamptz;
  v_criadas integer;
  v_total integer := 0;
  v_eventos integer := 0;
begin
  for v_evento in
    select s.event_id, s.evaluation_id, s.delay_minutes, s.response_window_days
    from public.event_evaluation_settings s
    join public.events e on e.id = s.event_id
    where s.enabled
      and s.evaluation_id is not null
      -- §10. Sem término não há conta a fazer. `save_event_evaluation_settings`
      -- já recusa habilitar assim, mas o término pode ser APAGADO depois — e
      -- este `where` é o que impede a rotina de tropeçar nesse caso.
      and e.end_time is not null
      and public.event_evaluation_send_at(s.event_id, s.delay_minutes) <= now()
      -- Ainda falta alguém? Sem isto a rotina varreria todo evento passado a
      -- cada passada, para não criar nada.
      and exists (
        select 1 from public.event_participants p
        where p.event_id = s.event_id
          and p.present
          and not exists (
            select 1 from public.event_participant_evaluations pe
            where pe.event_id = p.event_id and pe.participant_id = p.id
          )
      )
    order by public.event_evaluation_send_at(s.event_id, s.delay_minutes)
    limit greatest(coalesce(p_limit, 5), 1)
  loop
    v_version := public.current_evaluation_version_id(v_evento.evaluation_id);

    -- ⚠️ FORMULÁRIO VAZIO NÃO SAI. Um link para uma avaliação sem pergunta
    -- nenhuma gasta uma conversa de WhatsApp para mostrar uma página em branco
    -- — e a pessoa conclui que o sistema da APCS está quebrado.
    if v_version is null or not exists (
      select 1 from public.event_evaluation_sections s where s.version_id = v_version
    ) then
      continue;
    end if;

    v_send_at := public.event_evaluation_send_at(v_evento.event_id, v_evento.delay_minutes);
    v_expires := case
      when v_evento.response_window_days is null then null
      else v_send_at + make_interval(days => v_evento.response_window_days)
    end;

    -- ==========================================================================
    -- ⚠️ §11 — `p.present` É O ÚNICO CRITÉRIO, E `confirmation` NÃO APARECE AQUI.
    -- ==========================================================================
    -- "Confirmado NÃO é critério para envio. Presença é o critério."
    --
    --   Confirmado ON  + Presente ON   → recebe
    --   Confirmado ON  + Presente OFF  → NÃO recebe
    --   Confirmado OFF + Presente ON   → RECEBE
    --
    -- A terceira linha é a que costuma ser implementada errado, e ela sai de
    -- graça: a coluna `confirmation` simplesmente não é lida por esta função.
    --
    -- ⚠️ O TOKEN NASCE AQUI, UM POR LINHA (§7). `gen_random_uuid()` é volátil,
    -- então o `select` a avalia por linha — 122 bits de um gerador
    -- criptográfico, sem id sequencial e sem nada derivado do participante.
    -- Um token derivado do e-mail ou do id seria adivinhável por quem conhece
    -- os dois, que é exatamente quem não deveria conseguir responder no lugar
    -- de outra pessoa.
    insert into public.event_participant_evaluations
      (event_id, participant_id, evaluation_id, version_id, token,
       status, scheduled_for, expires_at)
    select
      p.event_id,
      p.id,
      v_evento.evaluation_id,
      v_version,
      replace(gen_random_uuid()::text, '-', ''),
      'scheduled',
      v_send_at,
      v_expires
    from public.event_participants p
    where p.event_id = v_evento.event_id
      and p.present
    -- §15/§18. A idempotência não é uma checagem: é o índice único.
    on conflict (event_id, participant_id) do nothing;

    get diagnostics v_criadas = row_count;
    v_total := v_total + v_criadas;
    if v_criadas > 0 then
      v_eventos := v_eventos + 1;
    end if;
  end loop;

  return jsonb_build_object('events', v_eventos, 'created', v_total);
end;
$$;

comment on function public.schedule_event_evaluations is
  'Cria a avaliacao dos PRESENTES de eventos ja terminados + atraso (§11, §14). Idempotente pelo indice unico.';

revoke execute on function public.schedule_event_evaluations(integer)
  from public, anon, authenticated;
grant execute on function public.schedule_event_evaluations(integer) to service_role;


-- ----------------------------------------------------------------------------
-- 21. Expirar o que passou do prazo (§20)
-- ----------------------------------------------------------------------------
-- ⚠️ ESTA FUNÇÃO NÃO É O PORTÃO. Quem recusa uma resposta fora do prazo é
-- `submit_event_evaluation`, que compara `expires_at` com `now()` na hora. Aqui
-- só se ATUALIZA a situação para a tela dizer a verdade — e é por isso que
-- atrasar esta rotina, ou nunca rodá-la, não abre buraco nenhum.
--
-- É o mesmo desenho do portão de Enquetes (`survey_response_gate`), e pelo
-- mesmo motivo: uma regra que depende de um cron ter rodado é uma regra que
-- falha em silêncio quando o cron para.
create or replace function public.expire_event_evaluations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  update public.event_participant_evaluations pe
  set status = 'expired'
  where pe.expires_at is not null
    and pe.expires_at < now()
    and pe.status in ('pending', 'scheduled', 'sent');

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

comment on function public.expire_event_evaluations is
  'Marca como expirada quem passou do prazo (§20). Nao e o portao — submit_event_evaluation confere na hora.';

revoke execute on function public.expire_event_evaluations() from public, anon, authenticated;
grant execute on function public.expire_event_evaluations() to service_role;


-- ----------------------------------------------------------------------------
-- 22. Reivindicar um lote para enviar (§15, §16)
-- ----------------------------------------------------------------------------
-- ⚠️ O ARRENDAMENTO DE DEZ MINUTOS SUBSTITUI UM ESTADO "ENVIANDO".
--
-- Enquetes tem `sending` no enum e uma rotina (`requeue_stuck_survey_recipients`)
-- para devolver à fila quem ficou preso nele. Aqui a mesma coisa é feita com
-- `last_attempt_at`: reivindicar carimba a hora, e a consulta ignora quem foi
-- carimbado nos últimos dez minutos.
--
-- O que se ganha: não existe estado do qual seja possível ficar preso, então não
-- existe rotina de destravamento para esquecer de chamar. O que se perde: a tela
-- não distingue "está saindo agora" de "vai sair na próxima passada" — e essa
-- distinção não interessa a ninguém aqui, porque a passada seguinte é em
-- minutos.
--
-- ⚠️ `skip locked` É O QUE PERMITE DUAS EXECUÇÕES SIMULTÂNEAS. Sem ele, a
-- segunda esperaria a primeira soltar o lock e depois mandaria as mesmas
-- mensagens. Com ele, ela pega outro lote.
create or replace function public.claim_event_evaluations(p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  -- ⚠️ O ARRAY VEM DA CTE, e não de um `returning ... into` no UPDATE. Um
  -- `returning` para dentro de variável escalar guarda UMA linha — e este UPDATE
  -- toca até 25. A CTE devolve todas, e o `array_agg` é quem monta o lote.
  with alvo as (
    select pe.id
    from public.event_participant_evaluations pe
    where pe.status = 'scheduled'
      and pe.scheduled_for is not null
      and pe.scheduled_for <= now()
      -- §16. O teto de tentativas. Quem estourou sai da fila e espera um
      -- reenvio manual, que zera a contagem.
      and pe.attempts < 5
      and (pe.last_attempt_at is null or pe.last_attempt_at < now() - interval '10 minutes')
      and (pe.expires_at is null or pe.expires_at > now())
    order by pe.scheduled_for
    limit greatest(coalesce(p_limit, 25), 1)
    for update skip locked
  ),
  atualizadas as (
    update public.event_participant_evaluations pe
    set attempts = pe.attempts + 1,
        last_attempt_at = now()
    from alvo
    where pe.id = alvo.id
    returning pe.id
  )
  select array_agg(id) into v_ids from atualizadas;

  if v_ids is null then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', pe.id,
          'token', pe.token,
          'eventId', pe.event_id,
          'eventName', e.name,
          'eventDate', e.event_date,
          'participantId', p.id,
          'fullName', p.full_name,
          'whatsapp', p.whatsapp,
          'phone', p.phone,
          'attempts', pe.attempts
        )
        order by pe.scheduled_for
      )
      from public.event_participant_evaluations pe
      join public.events e on e.id = pe.event_id
      join public.event_participants p on p.id = pe.participant_id
      where pe.id = any(v_ids)
    ),
    '[]'::jsonb
  );
end;
$$;

comment on function public.claim_event_evaluations is
  'Reivindica um lote com skip locked e arrendamento de 10 min (§15). So service_role.';

revoke execute on function public.claim_event_evaluations(integer)
  from public, anon, authenticated;
grant execute on function public.claim_event_evaluations(integer) to service_role;


-- ----------------------------------------------------------------------------
-- 23. Marcar o resultado do envio (§16)
-- ----------------------------------------------------------------------------
-- ⚠️ "ENVIADA" EXIGE O ID DO FORNECEDOR, e o parâmetro é `not null` na prática:
-- sem ele não há como um webhook de entrega encontrar esta linha depois. É o
-- §16 ("não marcar como ENVIADA se o provider não confirmar") escrito no lugar
-- onde ele não pode ser esquecido.
--
-- ⚠️ E O `where` NÃO INCLUI `answered`. Uma pessoa pode abrir o link e responder
-- ANTES de a rotina conseguir gravar o resultado do envio — a mensagem chegou,
-- ela clicou, e a gravação vem depois. Sem esta condição, o carimbo de envio
-- reverteria a resposta dela para "enviada" e a taxa do §21 diria que ninguém
-- respondeu.
create or replace function public.mark_event_evaluation_sent(
  p_id uuid,
  p_provider_message_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
begin
  update public.event_participant_evaluations pe
  set status = 'sent',
      sent_at = coalesce(pe.sent_at, now()),
      provider_message_id = nullif(btrim(coalesce(p_provider_message_id, '')), ''),
      last_error = null
  where pe.id = p_id
    and pe.status in ('pending', 'scheduled')
  returning pe.event_id into v_event;

  if v_event is null then
    return;
  end if;

  insert into public.event_evaluation_audit_logs (event_id, action, actor_id, metadata)
  values (
    v_event, 'invitation_sent', null,
    -- ⚠️ SEM O TOKEN E SEM O TELEFONE (§33, §34). O id da linha é o bastante
    -- para cruzar com a tabela, e a tabela está sob RLS.
    jsonb_build_object('participantEvaluationId', p_id)
  );
end;
$$;

comment on function public.mark_event_evaluation_sent is
  'Grava o envio confirmado pelo fornecedor (§16). Nao sobrescreve quem ja respondeu.';

revoke execute on function public.mark_event_evaluation_sent(uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_event_evaluation_sent(uuid, text) to service_role;


create or replace function public.mark_event_evaluation_failed(
  p_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_attempts integer;
begin
  -- ⚠️ A SITUAÇÃO NÃO MUDA. Falha é TENTATIVA, e não destino: a linha continua
  -- `scheduled` e a próxima passada a pega de novo, respeitando o arrendamento
  -- e o teto de `attempts`. Um estado terminal de falha exigiria alguém para
  -- tirá-la de lá — e é exatamente o tipo de fila que ninguém olha.
  update public.event_participant_evaluations pe
  set last_error = left(coalesce(p_error, 'falha desconhecida'), 1000)
  where pe.id = p_id
    and pe.status in ('pending', 'scheduled')
  returning pe.event_id, pe.attempts into v_event, v_attempts;

  if v_event is null then
    return;
  end if;

  insert into public.event_evaluation_audit_logs (event_id, action, actor_id, metadata)
  values (
    v_event, 'invitation_failed', null,
    jsonb_build_object(
      'participantEvaluationId', p_id,
      'attempts', v_attempts,
      -- O motivo é do FORNECEDOR (um código HTTP, "número sem WhatsApp"), e não
      -- um dado da pessoa. Truncado para a trilha não virar depósito de log.
      'reason', left(coalesce(p_error, ''), 200)
    )
  );
end;
$$;

comment on function public.mark_event_evaluation_failed is
  'Registra a falha sem mudar a situacao (§16) — a linha continua na fila.';

revoke execute on function public.mark_event_evaluation_failed(uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_event_evaluation_failed(uuid, text) to service_role;


-- ============================================================================
-- AS AÇÕES MANUAIS (§17, §19)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 24. Reenviar (§17)
-- ----------------------------------------------------------------------------
-- ⚠️ O TOKEN NÃO É TROCADO (decisão 5). Um reenvio acontece justamente quando o
-- primeiro envio ficou em dúvida — e se a primeira mensagem tiver chegado,
-- rodar o token deixaria a pessoa com um link morto na mão.
--
-- ⚠️ E ELE NÃO CRIA RESPOSTA NENHUMA (§17: "Não criar uma nova resposta"). A
-- linha é a mesma, com a mesma chave (evento, participante). Só a situação e o
-- contador de tentativas voltam ao começo.
create or replace function public.resend_event_evaluation(
  p_event_id uuid,
  p_participant_evaluation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.event_participant_evaluations;
begin
  if not public.evaluations_is_sender() then
    raise exception 'Sem permissão para reenviar a avaliação.' using errcode = '42501';
  end if;

  -- ⚠️ §28 — A CADEIA, COMO EM `set_participant_presence`. `p_participant_evaluation_id`
  -- vem do navegador; sem o `and pe.event_id = p_event_id`, um id trocado na
  -- requisição reenviaria o convite de OUTRO evento. A mensagem não distingue
  -- "não existe" de "é de outro evento", de propósito: a diferença entre as duas
  -- respostas é um oráculo que confirma a existência de ids alheios.
  select * into v_row
  from public.event_participant_evaluations pe
  where pe.id = p_participant_evaluation_id
    and pe.event_id = p_event_id;

  if not found then
    raise exception 'Avaliação não encontrada.' using errcode = 'P0002';
  end if;

  -- §17. "Se já respondeu: não permitir novo envio normal."
  if v_row.status = 'answered' then
    raise exception 'Esta pessoa já respondeu a avaliação.' using errcode = 'AV004';
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    raise exception 'O prazo de resposta desta avaliação já terminou.' using errcode = 'AV005';
  end if;

  update public.event_participant_evaluations pe
  set status = 'scheduled',
      scheduled_for = now(),
      attempts = 0,
      last_attempt_at = null,
      last_error = null
  where pe.id = p_participant_evaluation_id;

  insert into public.event_evaluation_audit_logs
    (event_id, evaluation_id, action, actor_id, metadata)
  values (
    p_event_id, v_row.evaluation_id, 'invitation_resent', (select auth.uid()),
    jsonb_build_object(
      'participantEvaluationId', p_participant_evaluation_id,
      'previousStatus', v_row.status,
      'previousAttempts', v_row.attempts
    )
  );

  return jsonb_build_object('id', p_participant_evaluation_id, 'status', 'scheduled');
end;
$$;

comment on function public.resend_event_evaluation is
  'Devolve o convite a fila (§17). Mesmo token, mesma linha — nunca cria resposta nova.';

revoke execute on function public.resend_event_evaluation(uuid, uuid) from public, anon;
grant execute on function public.resend_event_evaluation(uuid, uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 25. Cancelar (§8)
-- ----------------------------------------------------------------------------
create or replace function public.cancel_event_evaluation(
  p_event_id uuid,
  p_participant_evaluation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.event_participant_evaluations;
begin
  if not public.evaluations_is_sender() then
    raise exception 'Sem permissão para cancelar a avaliação.' using errcode = '42501';
  end if;

  select * into v_row
  from public.event_participant_evaluations pe
  where pe.id = p_participant_evaluation_id
    and pe.event_id = p_event_id;

  if not found then
    raise exception 'Avaliação não encontrada.' using errcode = 'P0002';
  end if;

  -- Cancelar depois de respondida não tem significado nenhum, e apagaria da
  -- tela uma resposta que continua no banco.
  if v_row.status = 'answered' then
    raise exception 'Esta pessoa já respondeu a avaliação.' using errcode = 'AV004';
  end if;

  update public.event_participant_evaluations pe
  set status = 'cancelled'
  where pe.id = p_participant_evaluation_id;

  insert into public.event_evaluation_audit_logs
    (event_id, evaluation_id, action, actor_id, metadata)
  values (
    p_event_id, v_row.evaluation_id, 'invitation_cancelled', (select auth.uid()),
    jsonb_build_object(
      'participantEvaluationId', p_participant_evaluation_id,
      'previousStatus', v_row.status
    )
  );

  return jsonb_build_object('id', p_participant_evaluation_id, 'status', 'cancelled');
end;
$$;

comment on function public.cancel_event_evaluation is
  'Tira o convite da fila (§8). Recusa depois de respondida.';

revoke execute on function public.cancel_event_evaluation(uuid, uuid) from public, anon;
grant execute on function public.cancel_event_evaluation(uuid, uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 26. Reabrir — a exceção do §19
-- ----------------------------------------------------------------------------
-- ⚠️ ELA NÃO APAGA NADA, e o §19 é explícito ("não apagar histórico", "não
-- implementar exclusão física da resposta"). O que ela faz é INCREMENTAR
-- `answer_round`: as respostas da rodada anterior continuam onde estão, e a
-- pessoa pode responder de novo ao lado delas. Ver o comentário longo na coluna.
--
-- ⚠️ EXIGE `evaluations.write`, e não `evaluations.send` como reenviar e
-- cancelar. Reenviar é operação; reabrir MEXE NO DADO JÁ COLETADO, e quem
-- responde pelo que a APCS vai concluir da pesquisa é quem configura a pesquisa.
create or replace function public.reopen_event_evaluation(
  p_event_id uuid,
  p_participant_evaluation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.event_participant_evaluations;
begin
  if not public.evaluations_is_writer() then
    raise exception 'Sem permissão para reabrir a avaliação.' using errcode = '42501';
  end if;

  select * into v_row
  from public.event_participant_evaluations pe
  where pe.id = p_participant_evaluation_id
    and pe.event_id = p_event_id;

  if not found then
    raise exception 'Avaliação não encontrada.' using errcode = 'P0002';
  end if;

  if v_row.status <> 'answered' then
    raise exception 'Só uma avaliação já respondida pode ser reaberta.' using errcode = 'AV003';
  end if;

  update public.event_participant_evaluations pe
  set status = 'sent',
      answered_at = null,
      answer_round = pe.answer_round + 1
  where pe.id = p_participant_evaluation_id;

  insert into public.event_evaluation_audit_logs
    (event_id, evaluation_id, action, actor_id, metadata)
  values (
    p_event_id, v_row.evaluation_id, 'evaluation_reopened', (select auth.uid()),
    jsonb_build_object(
      'participantEvaluationId', p_participant_evaluation_id,
      'roundFrom', v_row.answer_round,
      'roundTo', v_row.answer_round + 1,
      'answeredAt', v_row.answered_at
    )
  );

  return jsonb_build_object('id', p_participant_evaluation_id, 'status', 'sent');
end;
$$;

comment on function public.reopen_event_evaluation is
  'Excecao do §19: incrementa answer_round e permite nova resposta SEM apagar a anterior.';

revoke execute on function public.reopen_event_evaluation(uuid, uuid) from public, anon;
grant execute on function public.reopen_event_evaluation(uuid, uuid) to authenticated;


-- ============================================================================
-- A PORTA PÚBLICA (§6, §7, §27, §29, §30, §33, §34)
-- ============================================================================
-- ⚠️ AS DUAS FUNÇÕES ABAIXO SÃO LIBERADAS SÓ PARA `service_role`, e NÃO para
-- `anon`. É o mesmo desenho de `get_public_event_landing_page` e de
-- `create_event_registration`: o navegador nunca fala com o Postgres: ele fala
-- com um Server Component ou uma Server Action, que usa a chave de serviço no
-- servidor.
--
-- O que isso compra: a superfície pública do banco continua sendo zero função.
-- Não há como alguém apontar um cliente PostgREST para o projeto e varrer
-- tokens, porque `anon` não pode executar nada disto.
-- ----------------------------------------------------------------------------


-- ----------------------------------------------------------------------------
-- 27. Ler a avaliação pelo token (§27, §29, §34)
-- ----------------------------------------------------------------------------
-- ⚠️ ELA NUNCA LEVANTA EXCEÇÃO PARA TOKEN DESCONHECIDO. Devolve
-- `{"state":"not_found"}`, e a página mostra a mesma frase neutra que mostra
-- para uma avaliação cancelada. Um erro distinto seria um oráculo: quem estiver
-- tentando adivinhar saberia quando acertou o formato e errou só o valor.
--
-- ⚠️ E NADA DE PESSOAL SAI ANTES DA VALIDAÇÃO (§34). Nome e evento só entram no
-- retorno depois de a linha ter sido encontrada pelo token.
--
-- ⚠️ O PRIMEIRO NOME, E NÃO O NOME INTEIRO (§29: "Olá, João da Silva."). O §33
-- pede minimização — e a página é aberta por um link que pode ser reencaminhado.
-- "Olá, João" cumpre o §29 (a pessoa reconhece que a avaliação é dela) sem
-- entregar o nome completo a quem receber o link de segunda mão.
create or replace function public.get_public_event_evaluation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.event_participant_evaluations;
  v_event public.events;
  v_participant public.event_participants;
  v_estado text;
begin
  if coalesce(btrim(p_token), '') = '' then
    return jsonb_build_object('state', 'not_found');
  end if;

  select * into v_row
  from public.event_participant_evaluations pe
  where pe.token = btrim(p_token);

  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;

  select * into v_event from public.events e where e.id = v_row.event_id;
  select * into v_participant
  from public.event_participants p where p.id = v_row.participant_id;

  -- ⚠️ O PRAZO É CONFERIDO AQUI E AGORA, e não pela situação gravada (§20). A
  -- rotina de expiração pode não ter rodado ainda; `expires_at < now()` não
  -- depende de ninguém.
  v_estado := case
    when v_row.status = 'answered' then 'answered'
    when v_row.status = 'cancelled' then 'cancelled'
    when v_row.status = 'expired' then 'expired'
    when v_row.expires_at is not null and v_row.expires_at <= now() then 'expired'
    -- §11 conferido de novo na leitura: a presença pode ter sido desmarcada
    -- depois do envio, e o §11 é sobre quem PODE avaliar, não sobre quem já
    -- recebeu link.
    when not coalesce(v_participant.present, false) then 'cancelled'
    else 'ok'
  end;

  return jsonb_build_object(
    'state', v_estado,
    'eventName', v_event.name,
    'eventDate', v_event.event_date,
    'eventLocation', v_event.location,
    'firstName', split_part(btrim(v_participant.full_name), ' ', 1),
    'expiresAt', v_row.expires_at,
    'sections', case
      when v_estado = 'ok' then public.evaluation_version_structure(v_row.version_id)
      else '[]'::jsonb
    end
  );
end;
$$;

comment on function public.get_public_event_evaluation is
  'A avaliacao pelo token, para a pagina publica (§27). Token desconhecido devolve state=not_found, nunca excecao.';

revoke execute on function public.get_public_event_evaluation(text)
  from public, anon, authenticated;
grant execute on function public.get_public_event_evaluation(text) to service_role;


-- ----------------------------------------------------------------------------
-- 28. Gravar a resposta (§18, §25, §30, §32)
-- ----------------------------------------------------------------------------
-- Formato de `p_answers`:
--
--   [ { "questionId": "...", "optionIds": ["..."], "text": "..." } ]
--
-- ⚠️ UMA FUNÇÃO É UMA TRANSAÇÃO, e é isso que o §30 pede ("não deixar resposta
-- parcialmente gravada"). Qualquer `raise` daqui de dentro desfaz tudo o que já
-- tinha sido escrito nesta chamada, inclusive a mudança de situação.
--
-- ⚠️ O `numeric_value` VEM DA OPÇÃO, E NUNCA DO PAYLOAD (§32, decisão 4). O
-- navegador manda QUAL alternativa foi marcada; quanto ela vale é o banco quem
-- diz. Aceitar o número de fora deixaria qualquer pessoa mandar "10" numa escala
-- de 5 e envenenar a média do Prompt 3 sem precisar de nenhuma permissão.
create or replace function public.submit_event_evaluation(
  p_token text,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.event_participant_evaluations;
  v_participant public.event_participants;
  v_resposta jsonb;
  v_question record;
  v_option_id uuid;
  v_texto text;
  v_opcoes jsonb;
  v_faltando text;
  v_reivindicada uuid;
begin
  if coalesce(btrim(p_token), '') = '' then
    raise exception 'Avaliação não encontrada.' using errcode = 'P0002';
  end if;

  -- ==========================================================================
  -- ⚠️ `for update` — O §30 ("concorrência em submissão") COMEÇA AQUI.
  -- ==========================================================================
  -- Dois envios simultâneos (duplo clique, dois separadores abertos) chegam os
  -- dois. O primeiro tranca a linha; o segundo espera aqui, e quando entra
  -- encontra `answered` e sai pelo AV004. Sem o lock, os dois passariam pela
  -- checagem de situação antes de qualquer um gravar.
  select * into v_row
  from public.event_participant_evaluations pe
  where pe.token = btrim(p_token)
  for update;

  if not found then
    raise exception 'Avaliação não encontrada.' using errcode = 'P0002';
  end if;

  -- §18. "Não sobrescrever a resposta anterior."
  if v_row.status = 'answered' then
    raise exception 'Esta avaliação já foi respondida.' using errcode = 'AV004';
  end if;

  if v_row.status = 'cancelled' then
    raise exception 'Esta avaliação não está mais disponível.' using errcode = 'AV007';
  end if;

  -- §20. O portão de verdade — não depende de a rotina de expiração ter rodado.
  if v_row.status = 'expired'
     or (v_row.expires_at is not null and v_row.expires_at <= now()) then
    raise exception 'Esta avaliação não está mais disponível.' using errcode = 'AV005';
  end if;

  -- §11/§30. A presença é reconferida na gravação.
  select * into v_participant
  from public.event_participants p
  where p.id = v_row.participant_id and p.event_id = v_row.event_id;

  if not found or not v_participant.present then
    raise exception 'Esta avaliação não está mais disponível.' using errcode = 'AV007';
  end if;

  if jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception 'Respostas inválidas.' using errcode = 'AV003';
  end if;

  -- ==========================================================================
  -- As respostas, uma a uma.
  -- ==========================================================================
  for v_resposta in select valor from jsonb_array_elements(p_answers) as t(valor)
  loop
    -- ⚠️ §28/§29 — A PERGUNTA TEM DE SER DESTA VERSÃO. Sem este `where`, um
    -- `questionId` trocado gravaria a resposta desta pessoa contra a pergunta de
    -- OUTRA avaliação — e a tabulação do Prompt 3 somaria as duas.
    select q.id, q.question_type, q.required, q.prompt into v_question
    from public.event_evaluation_questions q
    join public.event_evaluation_sections s on s.id = q.section_id
    where s.version_id = v_row.version_id
      and q.id = (v_resposta ->> 'questionId')::uuid;

    if not found then
      raise exception 'Resposta enviada para uma pergunta que não é desta avaliação.'
        using errcode = 'AV003';
    end if;

    if v_question.question_type = 'free_text' then
      v_texto := nullif(btrim(coalesce(v_resposta ->> 'text', '')), '');
      if v_texto is null then
        continue;
      end if;

      insert into public.event_evaluation_answers
        (participant_evaluation_id, round, question_id, text_value)
      values (v_row.id, v_row.answer_round, v_question.id, left(v_texto, 4000));

    else
      v_opcoes := v_resposta -> 'optionIds';
      if jsonb_typeof(v_opcoes) is distinct from 'array' or jsonb_array_length(v_opcoes) = 0 then
        continue;
      end if;

      -- ⚠️ ESCOLHA ÚNICA ACEITA UMA, E RECUSA DUAS. Uma tela quebrada mandando
      -- duas gravaria as duas em silêncio, e a apuração contaria a pessoa duas
      -- vezes na mesma pergunta.
      if v_question.question_type <> 'multiple_choice' and jsonb_array_length(v_opcoes) > 1 then
        raise exception 'A pergunta "%" aceita uma alternativa só.', v_question.prompt
          using errcode = 'AV003';
      end if;

      for v_option_id in
        select (valor #>> '{}')::uuid from jsonb_array_elements(v_opcoes) as t(valor)
      loop
        -- A opção também tem de ser DESTA pergunta.
        if not exists (
          select 1 from public.event_evaluation_options o
          where o.id = v_option_id and o.question_id = v_question.id
        ) then
          raise exception 'Alternativa inválida para a pergunta "%".', v_question.prompt
            using errcode = 'AV003';
        end if;

        insert into public.event_evaluation_answers
          (participant_evaluation_id, round, question_id, option_id, numeric_value)
        select v_row.id, v_row.answer_round, v_question.id, o.id, o.numeric_value
        from public.event_evaluation_options o
        where o.id = v_option_id;
      end loop;
    end if;
  end loop;

  -- ==========================================================================
  -- ⚠️ §25 — AS OBRIGATÓRIAS, CONFERIDAS DEPOIS E CONTRA O QUE FOI GRAVADO.
  -- ==========================================================================
  -- "Nunca confiar somente no frontend." A conferência é sobre as LINHAS que
  -- acabaram de entrar, e não sobre o payload: é o que a torna imune a um
  -- payload que mande a chave certa com conteúdo vazio, e a um tipo de pergunta
  -- novo que alguém esqueça de tratar no laço acima.
  select string_agg(q.prompt, '; ') into v_faltando
  from public.event_evaluation_questions q
  join public.event_evaluation_sections s on s.id = q.section_id
  where s.version_id = v_row.version_id
    and q.required
    and not exists (
      select 1 from public.event_evaluation_answers a
      where a.participant_evaluation_id = v_row.id
        and a.round = v_row.answer_round
        and a.question_id = q.id
    );

  if v_faltando is not null then
    raise exception 'Falta responder: %', left(v_faltando, 300) using errcode = 'AV006';
  end if;

  -- ==========================================================================
  -- ⚠️ A RECLAMAÇÃO DA SITUAÇÃO, com o `where` como segunda barreira do §18.
  -- ==========================================================================
  -- O `for update` lá em cima já serializou; este `and pe.status <> 'answered'`
  -- é a rede embaixo dele. Se `v_reivindicada` voltar nulo, alguém respondeu no
  -- intervalo — e o `raise` desfaz as linhas de resposta gravadas acima.
  update public.event_participant_evaluations pe
  set status = 'answered',
      answered_at = now(),
      sent_at = coalesce(pe.sent_at, now())
  where pe.id = v_row.id
    and pe.status <> 'answered'
  returning pe.id into v_reivindicada;

  if v_reivindicada is null then
    raise exception 'Esta avaliação já foi respondida.' using errcode = 'AV004';
  end if;

  insert into public.event_evaluation_audit_logs
    (event_id, evaluation_id, action, actor_id, metadata)
  values (
    v_row.event_id, v_row.evaluation_id, 'evaluation_answered',
    -- Nulo: quem respondeu não tem sessão. `origin` da linha diz o resto, e
    -- inventar um ator seria mentir sobre quem fez.
    null,
    jsonb_build_object(
      'participantEvaluationId', v_row.id,
      'versionId', v_row.version_id,
      'round', v_row.answer_round
    )
  );

  return jsonb_build_object('state', 'answered');
end;
$$;

comment on function public.submit_event_evaluation is
  'Grava a resposta inteira numa transacao (§30). numeric_value vem da opcao, nunca do payload (§32).';

revoke execute on function public.submit_event_evaluation(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_event_evaluation(text, jsonb) to service_role;


-- ----------------------------------------------------------------------------
-- 29. O MODELO PADRÃO DA APCS (§3, §5)
-- ----------------------------------------------------------------------------
-- ⚠️ "EMPRESA 1" E "EMPRESA 2", E NÃO "DNA" E "ALIVIRA". O §3 é explícito: a
-- estrutura do formulário atual é a REFERÊNCIA, mas "não deixar DNA/Alivira
-- como empresas fixas na arquitetura".
--
-- O que fica fixo é a FORMA — dois blocos de palestra com as mesmas três
-- perguntas, um de infraestrutura, um de avaliação geral e um de comentários.
-- Quem organiza o próximo evento renomeia os dois primeiros para as empresas
-- daquele encontro, e o construtor do §24 é onde isso acontece.
--
-- ⚠️ E É UM SEED IDEMPOTENTE. O `if not exists` no começo faz esta migration
-- poder ser reaplicada sem duplicar o modelo — e faz um `db reset` reconstruir
-- exatamente o mesmo padrão.
do $seed$
declare
  v_evaluation uuid;
  v_version uuid;
  v_secao uuid;
  v_pergunta uuid;

  -- §5. A escala, uma vez só. Ela é a mesma nas onze perguntas de nota, e
  -- repetir onze vezes a mesma lista seria onze lugares para divergirem.
  v_escala constant jsonb := jsonb_build_array(
    jsonb_build_object('label', 'Excelente', 'value', 5),
    jsonb_build_object('label', 'Bom', 'value', 4),
    jsonb_build_object('label', 'Regular', 'value', 3),
    jsonb_build_object('label', 'Ruim', 'value', 2),
    jsonb_build_object('label', 'Péssimo', 'value', 1)
  );

  v_bloco record;
  -- ⚠️ `FOREACH ... IN ARRAY` PRECISA DE UM ARRAY TIPADO. Um campo de `record`
  -- chega sem tipo resolvido, e o PL/pgSQL recusa — daí a variável intermediária.
  v_perguntas text[];
  v_texto text;
  v_pos_pergunta integer;
  v_opcao jsonb;
  v_pos_opcao integer;
begin
  if exists (select 1 from public.event_evaluations where is_default) then
    return;
  end if;

  insert into public.event_evaluations (event_id, name, description, is_default)
  values (
    null,
    'Pesquisa de opinião — modelo APCS',
    'Modelo padrão da APCS. Ao habilitar a avaliação de um evento, ele é copiado — renomeie os blocos das palestras para as empresas daquele encontro.',
    true
  )
  returning id into v_evaluation;

  insert into public.event_evaluation_versions (evaluation_id, version)
  values (v_evaluation, 1)
  returning id into v_version;

  -- Os cinco blocos, na ordem do formulário que a APCS usa hoje.
  for v_bloco in
    select *
    from (
      values
        (1, 'Avalie o evento — Empresa 1', 'Renomeie este bloco com o nome da empresa que palestrou.',
         array[
           'Tema e conteúdo da(s) palestra(s)',
           'Desempenho do(s) palestrante(s)',
           'Seu ganho de conhecimento'
         ]),
        (2, 'Avalie o evento — Empresa 2', 'Renomeie este bloco com o nome da empresa que palestrou.',
         array[
           'Tema e conteúdo da(s) palestra(s)',
           'Desempenho do(s) palestrante(s)',
           'Seu ganho de conhecimento'
         ]),
        (3, 'Infraestrutura', null,
         array[
           'Serviço de informação e atendimento anterior ao evento',
           'Recepção durante o evento',
           'Instalações, material de apoio e recursos audiovisuais',
           'Café e almoço (quando oferecidos)',
           'Organização de um modo geral'
         ]),
        (4, 'Avaliação geral', null,
         array['Como você avalia o evento de um modo geral?'])
    ) as t(posicao, titulo, descricao, perguntas)
  loop
    insert into public.event_evaluation_sections (version_id, position, title, description)
    values (v_version, v_bloco.posicao, v_bloco.titulo, v_bloco.descricao)
    returning id into v_secao;

    v_pos_pergunta := 0;
    v_perguntas := v_bloco.perguntas;
    foreach v_texto in array v_perguntas
    loop
      v_pos_pergunta := v_pos_pergunta + 1;

      insert into public.event_evaluation_questions
        (section_id, position, prompt, question_type, required)
      values (v_secao, v_pos_pergunta, v_texto, 'rating', true)
      returning id into v_pergunta;

      v_pos_opcao := 0;
      for v_opcao in select valor from jsonb_array_elements(v_escala) as t(valor)
      loop
        v_pos_opcao := v_pos_opcao + 1;
        insert into public.event_evaluation_options
          (question_id, position, label, numeric_value)
        values (
          v_pergunta, v_pos_opcao,
          v_opcao ->> 'label',
          (v_opcao ->> 'value')::integer
        );
      end loop;
    end loop;
  end loop;

  -- ⚠️ O BLOCO 5 É DE TEXTO E NÃO É OBRIGATÓRIO. Uma pergunta aberta obrigatória
  -- no fim de um formulário de onze notas é a linha em que a pessoa desiste — e
  -- a APCS perde as onze notas junto com o comentário que ela não quis dar.
  insert into public.event_evaluation_sections (version_id, position, title, description)
  values (
    v_version, 5,
    'Comentários adicionais',
    'Espaço livre para quem quiser escrever.'
  )
  returning id into v_secao;

  insert into public.event_evaluation_questions
    (section_id, position, prompt, question_type, required)
  values (
    v_secao, 1,
    'Use este espaço para comentários adicionais ou sugira novos temas para o próximo evento.',
    'free_text', false
  );
end;
$seed$;


-- ----------------------------------------------------------------------------
-- 30. As duas camadas de permissão, semeadas (§35)
-- ----------------------------------------------------------------------------
-- ⚠️ SÓ O TETO NÃO BASTA. `app_role_ceilings` declara o que a RLS entrega a cada
-- PAPEL-BASE, mas quem decide o que uma pessoa vê é o CARGO dela
-- (`app_role_permissions`), semeado em 20260903000100 com uma cópia do teto
-- DAQUELE momento. Uma permissão acrescentada depois entra no teto e não entra
-- em cargo nenhum — e o resultado seria o item "Avaliações" invisível até para o
-- Administrador, com a RLS liberada e a tela no ar.
--
-- É a mesma seção da migration de presença, e existe um teste que recusa uma
-- migration que mexa no teto sem semear (`src/test/sql-role-ceilings.test.ts`).
insert into public.app_role_ceilings (base_role, permission) values
  ('admin', 'evaluations.read'),
  ('admin', 'evaluations.write'),
  ('admin', 'evaluations.send'),
  ('comercial', 'evaluations.read'),
  ('comercial', 'evaluations.send')
on conflict do nothing;

insert into public.app_role_permissions (role_key, permission)
select r.key, c.permission
from public.app_roles r
join public.app_role_ceilings c on c.base_role = r.base_role
where r.is_builtin
  and c.permission in ('evaluations.read', 'evaluations.write', 'evaluations.send')
on conflict do nothing;


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   delete from public.app_role_permissions
--     where permission in ('evaluations.read', 'evaluations.write', 'evaluations.send');
--   delete from public.app_role_ceilings
--     where permission in ('evaluations.read', 'evaluations.write', 'evaluations.send');
--
--   drop function if exists public.submit_event_evaluation(text, jsonb);
--   drop function if exists public.get_public_event_evaluation(text);
--   drop function if exists public.reopen_event_evaluation(uuid, uuid);
--   drop function if exists public.cancel_event_evaluation(uuid, uuid);
--   drop function if exists public.resend_event_evaluation(uuid, uuid);
--   drop function if exists public.mark_event_evaluation_failed(uuid, text);
--   drop function if exists public.mark_event_evaluation_sent(uuid, text);
--   drop function if exists public.claim_event_evaluations(integer);
--   drop function if exists public.expire_event_evaluations();
--   drop function if exists public.schedule_event_evaluations(integer);
--   drop function if exists public.save_event_evaluation_structure(uuid, jsonb);
--   drop function if exists public.apply_evaluation_template(uuid, uuid);
--   drop function if exists public.save_event_evaluation_settings(uuid, boolean, integer, integer, uuid);
--   drop function if exists public.ensure_event_evaluation(uuid, uuid);
--   drop function if exists public.clone_evaluation_version(uuid, uuid);
--   drop function if exists public.event_evaluation_participants(uuid, text, text, integer, integer);
--   drop function if exists public.event_evaluation_detail(uuid);
--   drop function if exists public.event_evaluation_summaries(text, integer, integer);
--   drop function if exists public.evaluation_version_structure(uuid);
--   drop function if exists public.current_evaluation_version_id(uuid);
--   drop function if exists public.event_evaluation_send_at(uuid, integer);
--   drop function if exists public.evaluations_is_sender();
--   drop function if exists public.evaluations_is_writer();
--   drop function if exists public.evaluations_is_reader();
--
--   drop table if exists public.event_evaluation_audit_logs;
--   drop table if exists public.event_evaluation_answers;
--   drop table if exists public.event_participant_evaluations;
--   drop table if exists public.event_evaluation_settings;
--   drop table if exists public.event_evaluation_options;
--   drop table if exists public.event_evaluation_questions;
--   drop table if exists public.event_evaluation_sections;
--   drop table if exists public.event_evaluation_versions;
--   drop table if exists public.event_evaluations;
--
--   drop index if exists public.event_participants_id_event_idx;
--
--   -- E depois 20261002000000, que é quem cria os três enums.
--
-- ⚠️ ISTO APAGA AS RESPOSTAS. `event_evaluation_answers` é o dado coletado —
-- comentários de participantes identificados, notas de eventos que já
-- aconteceram — e não há de onde reconstruí-lo. Não é uma operação para
-- "desfazer e refazer depois": exporte antes.
-- ============================================================================
