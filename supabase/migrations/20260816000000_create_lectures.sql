-- ============================================================================
-- Palestras — solicitação, análise, planejamento, agenda e trilha
-- ----------------------------------------------------------------------------
-- Quarto módulo de conteúdo do CRM. Guarda as palestras da APCS, venham elas do
-- chatbot (alguém pediu) ou do time interno (a APCS decidiu fazer), e responde
-- à pergunta que a operação faz todo dia: O QUE ESTÁ PEDIDO, O QUE ESTÁ
-- MARCADO, E QUEM CUIDA DE CADA UMA?
--
-- ⚠️ AS TRÊS DECISÕES CENTRAIS
--
-- 1. UMA SOLICITAÇÃO NÃO VIRA OUTRA PALESTRA — ela EVOLUI.
--    Aprovar um pedido do chatbot não cria registro novo: muda o `status` da
--    mesma linha. O protocolo, a data do pedido e o solicitante seguem os
--    mesmos do primeiro minuto até a realização. É o que torna possível
--    responder "o que houve com a SOL-000042?" com uma linha só.
--
-- 2. O GRAFO DE STATUS É DADO, NÃO CÓDIGO.
--    As transições permitidas moram em `lecture_status_transitions` — uma
--    tabela. Um trigger recusa qualquer passo que não esteja lá, em QUALQUER
--    caminho de escrita (função, PostgREST, psql). Mudar o fluxo vira um insert
--    numa migration; e o frontend pode LER o grafo para saber quais botões
--    mostrar, em vez de repetir a regra em TypeScript.
--
-- 3. A REALIZAÇÃO É UM ATO, NÃO UMA DATA QUE PASSOU.
--    Nenhuma rotina marca palestra como realizada porque o calendário virou —
--    o escopo (§56) proíbe. O que existe é uma LEITURA derivada: uma palestra
--    marcada cuja data já passou e que ninguém fechou aparece como "aguardando
--    registro". É o mesmo desenho da expiração de Eventos, pelo mesmo motivo
--    (o projeto não tem infraestrutura de job, e rotina que não roda mente em
--    silêncio).
--
-- O QUE ESTE MÓDULO NÃO CRIA, de propósito:
--   • Nenhuma tabela de pessoas. Responsável e palestrante são `profiles`
--     (usuários do CRM); o solicitante é `chat_contacts` (quem falou com o bot).
--   • Nenhum "hoje" no banco. Eventos precisa de um (`public.event_today()`)
--     porque lá a data de corte DECIDE o que o banco aceita; aqui o §53 manda
--     aceitar data passada, então não existe corte a impor. A leitura derivada
--     ("marcada, a data passou, ninguém fechou") acontece no TypeScript, com o
--     mesmo `todayInSaoPaulo()` que as outras telas já usam.
--   • Nenhum Storage. Palestra não tem arquivo.
--
-- CÓDIGOS DE ERRO — classe `PL`, mapeada em src/lib/actions/errors.ts.
-- A classe é PRÓPRIA porque a `P0` é RESERVADA pelo PL/pgSQL (P0004 é
-- `assert_failure`); ver 20260813000200_fix_event_error_codes.sql.
--   42501  sem permissão
--   P0002  palestra não encontrada (no_data_found, já mapeado pelo projeto)
--   PL001  transição de status não permitida
--   PL002  campo imutável (protocolo, origem, data da solicitação)
--   PL003  o status atual não permite esta operação
--   PL004  motivo obrigatório ausente (rejeição / cancelamento)
--   PL005  falta horário para confirmar
--   PL006  usuário informado não existe
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
-- Enum, e não tabela, para os VALORES — é o padrão do projeto (`event_status`,
-- `lead_status`, `app_role`) e é o que dá checagem em tempo de compilação no
-- TypeScript via `pnpm db:types`. Valor novo entra com `alter type ... add
-- value`, como já documentado em `chat_flow_key`.
--
-- O que é tabela é o GRAFO de transições (seção 4) — porque ali o que muda com
-- a regra de negócio são as ARESTAS, não os nós.
create type public.lecture_status as enum (
  'requested',    -- SOLICITADA   — chegou, ninguém olhou ainda
  'under_review', -- EM_ANALISE   — alguém está avaliando
  'approved',     -- APROVADA     — vamos fazer; falta marcar
  'rejected',     -- REJEITADA    — não vamos fazer (terminal, exige motivo)
  'planned',      -- PLANEJADA    — data e responsável definidos
  'confirmed',    -- CONFIRMADA   — acordado com o solicitante (exige horário)
  'held',         -- REALIZADA    — aconteceu (terminal)
  'cancelled'     -- CANCELADA    — não vai acontecer (terminal, exige motivo)
);

comment on type public.lecture_status is
  'Situação da palestra. As transições permitidas estão em lecture_status_transitions.';

-- §8. `other` obriga `type_other` — o CHECK `lectures_type_other` impõe.
create type public.lecture_type as enum ('company', 'associate', 'university', 'other');

create type public.lecture_format as enum ('in_person', 'online', 'hybrid');

create type public.lecture_priority as enum ('low', 'normal', 'high', 'urgent');

-- §23. Imutável depois da criação — o trigger `lectures_guard` impõe.
create type public.lecture_origin as enum ('chatbot', 'internal');

-- §36. Os nomes seguem o padrão já usado por Eventos e Bolsa
-- (`<entidade>_<verbo no particípio>`), e não os rótulos do escopo em caixa
-- alta, exatamente como o próprio §36 autoriza.
--
-- ⚠️ Cancelar e rejeitar SÃO mudanças de status, mas registram a ação PRÓPRIA
-- (`lecture_cancelled` / `lecture_rejected`) em vez de `lecture_status_changed`.
-- Uma ação por acontecimento: gravar as duas duplicaria a trilha e faria a
-- contagem de "quantas foram canceladas" depender de qual das duas linhas se
-- conta.
create type public.lecture_audit_action as enum (
  'lecture_created',
  'lecture_updated',
  'lecture_status_changed',
  'lecture_rescheduled',
  'lecture_responsible_assigned',
  'lecture_speaker_assigned',
  'lecture_cancelled',
  'lecture_rejected',
  'lecture_outcome_registered'
);

-- ----------------------------------------------------------------------------
-- 2. Protocolo (§10)
-- ----------------------------------------------------------------------------
-- SOL-000001, SOL-000002, ... Único, imutável, e gerado SEMPRE pelo servidor:
-- o valor vem do DEFAULT da coluna, e o `grant insert` da seção 8 não inclui
-- `protocol` — quem tentar enviá-lo pelo PostgREST leva 42501 em vez de ter o
-- valor aceito. É a diferença entre "a aplicação não manda" e "não dá para
-- mandar".
--
-- Sequence (e não `max(protocol) + 1`): duas solicitações simultâneas do
-- chatbot receberiam o mesmo número com um `max`, e a segunda quebraria no
-- índice único. `nextval` não colide nem sob concorrência.
--
-- Passado SOL-999999 o número simplesmente ganha um dígito (SOL-1000000). Sem
-- reinício, sem colisão — o `lpad` é piso, não teto.
create sequence public.lecture_protocol_seq as bigint start 1 minvalue 1;

create or replace function public.next_lecture_protocol()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'SOL-' || lpad(nextval('public.lecture_protocol_seq')::text, 6, '0');
$$;

comment on function public.next_lecture_protocol() is
  'Próximo protocolo de palestra (SOL-000001). Só o DEFAULT da coluna deve chamá-la.';

-- O DEFAULT da coluna é avaliado com os privilégios de quem insere, então a
-- sequence precisa ser usável por eles. `service_role` está na lista porque a
-- solicitação do chatbot é anônima e entra por ali (ver seção 10).
grant usage on sequence public.lecture_protocol_seq to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Palestras
-- ----------------------------------------------------------------------------
create table public.lectures (
  id uuid primary key default gen_random_uuid(),

  -- §10/§69. Sem `grant insert` e sem `grant update` nesta coluna.
  protocol text not null unique default public.next_lecture_protocol(),

  -- §23/§68. Sem `grant update`; o trigger recusa a alteração por qualquer via.
  origin public.lecture_origin not null,

  -- §29. `name` identifica a PALESTRA; `requester_name` (lá embaixo) é o
  -- snapshot de quem pediu. Ver o GAP registrado em docs/PALESTRAS.md: o §7 do
  -- escopo coleta um único "Nome" no chatbot, e enquanto isso não for
  -- esclarecido a solicitação nasce com os dois iguais.
  name text not null,
  -- §17. O assunto: "Mercado de Suínos", "Custo de Produção".
  theme text not null,
  -- §16. Cidade e local são coisas diferentes: a cidade é o município, o local
  -- é o endereço/espaço dentro dele. Cidade é obrigatória, local não.
  city text not null,
  -- §14. "Centro de Convenções APCS".
  location text,

  -- §8
  type public.lecture_type not null,
  type_other text,

  -- §15. Nulo enquanto ninguém definiu — o §7 não marca Formato como
  -- obrigatório na coleta do chatbot.
  format public.lecture_format,

  -- §12/§13. `date` e `time` separados, sem fuso, pelo mesmo motivo de Eventos:
  -- o que se marca é "dia 20, às 14h", não um instante absoluto na linha do
  -- tempo. Um `timestamptz` viraria o dia anterior para quem lesse de outro
  -- fuso.
  --
  -- A data é obrigatória desde o primeiro minuto porque o §7 coleta "Data
  -- desejada *" já no chatbot — e sem ela não há calendário nem conflito.
  event_date date not null,
  start_time time,
  end_time time,

  -- §18/§52. O escopo diz "inteiro positivo" no §18 e ">= 0" no §52; os dois
  -- estão certos sobre coisas diferentes. ESTIMAR zero participantes não quer
  -- dizer nada (a ausência de estimativa é NULL), mas REALIZAR com zero
  -- presentes é um resultado real e precisa caber.
  attendees_estimated integer,
  attendees_actual integer,

  -- §20/§21. `profiles`, e não uma tabela nova de pessoas: o §72 manda reusar.
  -- ⚠️ GAP registrado: palestrante EXTERNO (especialista convidado sem conta no
  -- CRM) não tem onde ser cadastrado hoje. Ver docs/PALESTRAS.md.
  --
  -- `on delete set null` nos dois: a palestra sobrevive à saída da pessoa, e a
  -- trilha guarda quem era.
  speaker_id uuid references public.profiles on delete set null,
  responsible_id uuid references public.profiles on delete set null,

  -- §22. O chatbot não define prioridade — a função dele (seção 10) nem tem o
  -- parâmetro. Toda solicitação nasce NORMAL e o time interno reclassifica.
  priority public.lecture_priority not null default 'normal',

  -- §4. Sem DEFAULT de propósito: quem cria diz explicitamente onde entra, e o
  -- trigger confere que aquele ponto de entrada é legítimo.
  status public.lecture_status not null,

  -- §19. Texto livre. A sanitização que importa é o TAMANHO (abaixo) e o
  -- escape na renderização, que o React faz por padrão — guardar HTML "limpo"
  -- no banco seria confiar num sanitizador para sempre.
  notes text,

  -- §24/§25. Existem exatamente quando o status os exige (CHECKs abaixo).
  rejection_reason text,
  cancellation_reason text,

  -- §11. Gerada pelo servidor; o trigger recusa qualquer alteração posterior.
  requested_at timestamptz not null default now(),

  -- §26. Só existem depois de realizada (CHECK abaixo).
  held_at date,
  outcome_notes text,

  -- §9. O vínculo com quem pediu + o SNAPSHOT dos dados no momento do pedido.
  --
  -- ⚠️ Os dois, e não só o vínculo: `chat_contacts` é editável e apagável (LGPD
  -- art. 18 — há policy de delete para admin). Sem o snapshot, atender um
  -- pedido de eliminação apagaria também a resposta para "quem pediu a
  -- SOL-000042?", que é registro operacional da APCS, não dado de marketing.
  requester_contact_id uuid references public.chat_contacts on delete set null,
  requester_name text,
  requester_email text,
  requester_phone text,
  requester_organization text,

  -- Busca SEM ACENTO, resolvida no banco.
  --
  -- Por que existe: a listagem é paginada no servidor (§48), então o filtro tem
  -- de ser SQL — e `ilike '%camara%'` não acha "Câmara". Este banco não tem
  -- `unaccent` nem `pg_trgm` (conferido), e `unaccent` não seria usável numa
  -- coluna gerada de qualquer forma, porque não é IMMUTABLE. `translate` é.
  --
  -- Espelha `normalizeForSearch` (src/lib/utils.ts), que faz o mesmo em NFD do
  -- lado do TypeScript. As duas pontas precisam concordar: uma normaliza o que
  -- se guarda, a outra normaliza o que se digita.
  search_text text generated always as (
    translate(
      lower(
        coalesce(name, '') || ' ' ||
        coalesce(theme, '') || ' ' ||
        coalesce(city, '') || ' ' ||
        coalesce(protocol, '') || ' ' ||
        coalesce(requester_name, '') || ' ' ||
        coalesce(requester_organization, '')
      ),
      'áàâãäåéèêëíìîïóòôõöúùûüçñ',
      'aaaaaaeeeeiiiiooooouuuucn'
    )
  ) stored,

  -- `default auth.uid()` + o `with check` da policy: a autoria não pode ser
  -- forjada nem precisa ser enviada pela aplicação. Nulo quando quem cria é o
  -- chatbot (anônimo) — e é justamente `origin` que distingue os dois casos.
  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),

  -- §52 — validações que o banco impõe, independente de qual camada chamou.
  constraint lectures_name_len check (char_length(name) between 2 and 160),
  constraint lectures_theme_len check (char_length(theme) between 2 and 200),
  constraint lectures_city_len check (char_length(city) between 2 and 120),
  constraint lectures_location_len
    check (location is null or char_length(location) between 2 and 200),

  -- §8. Biconditional: `other` EXIGE o detalhe, e qualquer outro tipo o PROÍBE
  -- (senão sobraria "Evento técnico" grudado numa palestra de universidade
  -- depois de alguém trocar o tipo).
  constraint lectures_type_other check ((type = 'other') = (type_other is not null)),
  constraint lectures_type_other_len
    check (type_other is null or char_length(type_other) between 2 and 120),

  -- §13. ESTRITAMENTE maior, como o escopo pede — e término sem início não
  -- existe. (Eventos aceita `>=`; ali um evento pode ser um marco pontual, aqui
  -- uma palestra que termina quando começa não é uma palestra.)
  constraint lectures_time_order
    check (end_time is null or (start_time is not null and end_time > start_time)),

  constraint lectures_attendees_estimated
    check (attendees_estimated is null or attendees_estimated > 0),
  constraint lectures_attendees_actual
    check (attendees_actual is null or attendees_actual >= 0),

  constraint lectures_notes_len check (notes is null or char_length(notes) <= 2000),
  constraint lectures_outcome_notes_len
    check (outcome_notes is null or char_length(outcome_notes) <= 2000),

  -- §24/§25. Biconditional de novo, e pela mesma razão: `rejected` e
  -- `cancelled` são TERMINAIS, então "tem motivo" e "está nesse status" são a
  -- mesma afirmação para sempre. Um motivo sobrando num registro que voltou
  -- atrás contaria uma história falsa.
  constraint lectures_rejection_reason
    check ((status = 'rejected') = (rejection_reason is not null)),
  constraint lectures_cancellation_reason
    check ((status = 'cancelled') = (cancellation_reason is not null)),
  constraint lectures_rejection_reason_len
    check (rejection_reason is null or char_length(rejection_reason) between 3 and 1000),
  constraint lectures_cancellation_reason_len
    check (cancellation_reason is null or char_length(cancellation_reason) between 3 and 1000),

  -- §26/§56. Dado de realização só existe em palestra realizada. É esta linha
  -- que impede "participantes_realizados = 300" numa palestra ainda planejada.
  constraint lectures_outcome_requires_held check (
    status = 'held'
    or (held_at is null and attendees_actual is null and outcome_notes is null)
  ),

  -- §13. Confirmar exige horário. Realizada também: uma palestra que aconteceu
  -- aconteceu a alguma hora.
  constraint lectures_scheduled_needs_time
    check (status not in ('confirmed', 'held') or start_time is not null),

  -- §9. Solicitação sempre tem solicitante nomeado. Cadastro interno não
  -- precisa — muitas vezes ninguém pediu, a APCS decidiu fazer.
  constraint lectures_chatbot_requester
    check (origin <> 'chatbot' or requester_name is not null),

  constraint lectures_requester_name_len
    check (requester_name is null or char_length(requester_name) between 2 and 160),
  -- Formato mínimo, não validação de existência: o objetivo é impedir lixo
  -- ("asdf") de virar o único contato de um pedido, não provar que a caixa
  -- recebe mensagem.
  constraint lectures_requester_email check (
    requester_email is null
    or requester_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint lectures_requester_phone
    check (requester_phone is null or requester_phone ~ '^[0-9()+ .-]{8,20}$'),
  constraint lectures_requester_org_len
    check (requester_organization is null or char_length(requester_organization) between 2 and 160)
);

comment on table public.lectures is
  'Palestras da APCS. A solicitação do chatbot e o cadastro interno são a MESMA linha, distinguidos por `origin`; aprovar não duplica, muda o status.';

comment on column public.lectures.protocol is
  'SOL-000001. Gerado pelo DEFAULT, sem grant de insert/update — não há como enviá-lo de fora.';

comment on column public.lectures.status is
  'Situação atual. Só muda por transição presente em lecture_status_transitions (trigger lectures_guard).';

comment on column public.lectures.search_text is
  'Coluna gerada, minúscula e sem acento, para a busca da listagem paginada. Espelha normalizeForSearch() no TypeScript.';

-- ----------------------------------------------------------------------------
-- 3.1 Índices (§50)
-- ----------------------------------------------------------------------------
-- O `unique` de `protocol` já cria o índice que o §47 (consulta por protocolo)
-- precisa — um segundo seria redundante.

-- Calendário (§31) e a busca de conflito (§33): as duas filtram por data e
-- ordenam por hora dentro do dia.
create index lectures_event_date_idx on public.lectures (event_date, start_time);

-- A caixa de entrada: "o que chegou e ainda não foi tratado, mais recente
-- primeiro".
create index lectures_status_idx on public.lectures (status, requested_at desc);

create index lectures_city_idx on public.lectures (city);

-- Parciais: "as palestras sob minha responsabilidade" só olha linhas
-- atribuídas, e a maioria das linhas não é. O índice parcial é uma fração do
-- tamanho e responde a mesma pergunta.
create index lectures_responsible_idx
  on public.lectures (responsible_id) where responsible_id is not null;
create index lectures_speaker_idx
  on public.lectures (speaker_id) where speaker_id is not null;
create index lectures_requester_idx
  on public.lectures (requester_contact_id) where requester_contact_id is not null;

-- ⚠️ `origin` NÃO tem índice, e é decisão, não esquecimento. São dois valores:
-- qualquer filtro por origem seleciona perto de metade da tabela, e o planner
-- prefere varredura sequencial a um índice nesse caso. Criá-lo custaria escrita
-- em toda inserção sem economizar leitura nenhuma — exatamente o "índice
-- redundante" que o §50 manda evitar. O mesmo vale para `type`, `format` e
-- `priority`.
--
-- ⚠️ `search_text` também não tem índice: `ilike '%termo%'` só é indexável com
-- `pg_trgm`, que não está instalado neste banco. No volume esperado a varredura
-- é barata; o caminho de crescimento está em docs/PALESTRAS.md.

-- ----------------------------------------------------------------------------
-- 4. O grafo de status (§4, §5, §62)
-- ----------------------------------------------------------------------------
-- TABELA, e não `if` dentro de uma função. Três ganhos concretos:
--
--   1. Mudar o fluxo é um insert numa migration — sem reescrever PL/pgSQL.
--   2. O frontend LÊ o grafo para decidir quais botões mostrar, em vez de
--      repetir a regra em TypeScript e as duas saírem de sincronia.
--   3. A regra vale em TODO caminho de escrita, porque quem a aplica é um
--      trigger — inclusive um PATCH direto no PostgREST.
--
-- `from_status` NULO significa PONTO DE ENTRADA (o status com que uma palestra
-- pode nascer). Por isso a chave é feita de dois índices parciais em vez de uma
-- primary key: PK não aceita nulo.
create table public.lecture_status_transitions (
  from_status public.lecture_status,
  to_status public.lecture_status not null,
  created_at timestamptz not null default now()
);

comment on table public.lecture_status_transitions is
  'Transições de status permitidas. from_status NULO = ponto de entrada (status com que uma palestra pode ser criada).';

create unique index lecture_status_transitions_pair_idx
  on public.lecture_status_transitions (from_status, to_status)
  where from_status is not null;

create unique index lecture_status_transitions_entry_idx
  on public.lecture_status_transitions (to_status)
  where from_status is null;

-- Pontos de ENTRADA. Os quatro momentos reais em que uma palestra passa a
-- existir no sistema:
--
--   requested  o pedido — do chatbot, ou anotado por quem atendeu no telefone
--   planned    a APCS decidiu fazer e já está marcando (ninguém pediu)
--   confirmed  já estava acordado quando o registro foi criado
--   held       registro HISTÓRICO de algo que já aconteceu (§53)
--
-- `under_review` e `approved` não entram: analisar e aprovar pressupõem um
-- pedido que já existia. `rejected` e `cancelled` também não: não se cadastra
-- uma palestra já negada.
insert into public.lecture_status_transitions (from_status, to_status) values
  (null, 'requested'),
  (null, 'planned'),
  (null, 'confirmed'),
  (null, 'held');

-- O fluxo principal do §5, na ordem em que o escopo o desenha.
insert into public.lecture_status_transitions (from_status, to_status) values
  ('requested',    'under_review'),
  ('under_review', 'approved'),
  ('under_review', 'rejected'),
  ('approved',     'planned'),
  ('planned',      'confirmed'),
  ('confirmed',    'held');

-- Cancelamento (§54). Sai de qualquer status NÃO TERMINAL.
--
-- Terminais (`held`, `rejected`, `cancelled`) ficam de fora com motivo: uma
-- palestra que já aconteceu não pode ser cancelada sem que o registro passe a
-- mentir, e uma já recusada não precisa ser recusada de novo.
insert into public.lecture_status_transitions (from_status, to_status) values
  ('requested',    'cancelled'),
  ('under_review', 'cancelled'),
  ('approved',     'cancelled'),
  ('planned',      'cancelled'),
  ('confirmed',    'cancelled');

-- ⚠️ NÃO EXISTE VOLTA (confirmed → planned, approved → under_review, ...), e
-- isso é uma LACUNA CONHECIDA, não um esquecimento: o §5 desenha o fluxo só
-- para a frente e o §102-equivalente manda não inventar regra de negócio. O
-- caso concreto que isso deixa sem saída — a palestra confirmada cujo
-- palestrante desiste, e que hoje só pode ser cancelada — está registrado em
-- docs/PALESTRAS.md para decisão. Liberar a volta é um insert nesta tabela.

-- ----------------------------------------------------------------------------
-- 5. Trilha de auditoria (§36, §37)
-- ----------------------------------------------------------------------------
-- Espelha `event_audit_logs` e `market_bulletin_audit_logs`. Tabela própria, e
-- não uma delas, porque cada uma tem FK e enum próprios — só o PADRÃO é
-- reutilizável. A unificação numa auditoria de plataforma continua sendo o
-- módulo #8 do roadmap, agora com três casos na mão em vez de dois.
create table public.lecture_audit_logs (
  id bigint generated always as identity primary key,
  -- `set null` (e não cascade): a trilha tem de sobreviver ao que ela audita.
  lecture_id uuid references public.lectures on delete set null,
  action public.lecture_audit_action not null,
  actor_id uuid references public.profiles on delete set null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.lecture_audit_logs is
  'Trilha imutável das operações sobre palestras. Só aceita INSERT — nunca update nem delete.';

create index lecture_audit_logs_lecture_idx
  on public.lecture_audit_logs (lecture_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 6. Diretório interno de perfis
-- ----------------------------------------------------------------------------
-- ⚠️ ESTA SEÇÃO ALTERA UMA TABELA EXISTENTE (`profiles`). Está aqui, e não
-- escondida, porque é uma mudança de segurança de outro módulo e merece ser
-- vista.
--
-- O PROBLEMA: a policy `profiles_select_own_or_admin` deixa cada um ver APENAS
-- o próprio perfil (admin vê todos). O §21 e o §45 exigem que o GESTOR atribua
-- um responsável — e sem ler `profiles` ele não tem lista para escolher. Pior:
-- o nome do responsável e do palestrante apareceria VAZIO na grid para todo
-- mundo que não fosse admin. O mesmo já acontece hoje, em silêncio, com o
-- "cadastrado por" de Eventos e o "publicado por" da Bolsa.
--
-- A CORREÇÃO: quem opera o CRM pode ver o diretório de quem opera o CRM. Não é
-- dado de terceiro — são colegas de uma empresa só, que é o que este produto é.
--
-- `viewer` fica DE FORA de propósito: é o papel de entrada (todo usuário novo
-- nasce nele) e continua vendo só o próprio perfil, mantendo o
-- deny-by-default para quem ainda não foi promovido.
create policy "profiles_select_directory"
  on public.profiles for select
  using (
    public.current_app_role() in ('admin', 'ceo', 'comercial', 'pm', 'tech_lead', 'financeiro')
  );

comment on policy "profiles_select_directory" on public.profiles is
  'Diretório interno: quem tem papel operacional vê os colegas, para atribuir responsáveis e exibir autorias.';

-- ----------------------------------------------------------------------------
-- 7. Row Level Security
-- ----------------------------------------------------------------------------
-- Espelha PERMISSION_MATRIX em src/lib/rbac/rbac.config.ts:
--   lectures.read  → admin, ceo, comercial   (Administrador, Gestor, Atendente)
--   lectures.write → admin, ceo              (Administrador, Gestor)
-- É o mesmo recorte de Eventos e Bolsa, e pelo §39: o Atendente VISUALIZA;
-- planejar, atribuir e decidir status é de quem responde pela agenda.
alter table public.lectures enable row level security;
alter table public.lecture_status_transitions enable row level security;
alter table public.lecture_audit_logs enable row level security;

create policy "lectures_select"
  on public.lectures for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

-- ⚠️ `origin = 'internal'` no WITH CHECK é o que impede um admin de FORJAR uma
-- solicitação de chatbot. A origem chatbot só existe por um caminho: a função
-- da seção 10, chamada pelo servidor com `service_role` (que não passa por
-- policy). Uma linha de policy fazendo o trabalho de uma regra inteira.
create policy "lectures_insert"
  on public.lectures for insert
  with check (
    public.current_app_role() in ('admin', 'ceo')
    and created_by = auth.uid()
    and origin = 'internal'
  );

-- `updated_by = auth.uid()` no WITH CHECK impede assinar a alteração com o nome
-- de outra pessoa E impede alteração anônima: quem não preencher a autoria não
-- atualiza linha nenhuma.
create policy "lectures_update"
  on public.lectures for update
  using (public.current_app_role() in ('admin', 'ceo'))
  with check (
    public.current_app_role() in ('admin', 'ceo')
    and updated_by = auth.uid()
  );

-- Todo mundo que lê palestra lê o grafo — é o que permite a tela mostrar só os
-- botões que existem, inclusive para o Atendente (que vê a tela sem poder agir).
create policy "lecture_status_transitions_select"
  on public.lecture_status_transitions for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

-- Sem policy de insert/update/delete: o grafo só muda por migration.

-- A trilha é mais estreita que a leitura, como em Eventos e na Bolsa: o
-- Atendente consulta palestras, não o histórico de quem mexeu nelas.
create policy "lecture_audit_logs_select"
  on public.lecture_audit_logs for select
  using (public.current_app_role() in ('admin', 'ceo'));

create policy "lecture_audit_logs_insert"
  on public.lecture_audit_logs for insert
  with check (
    public.current_app_role() in ('admin', 'ceo')
    and actor_id = auth.uid()
  );

-- ----------------------------------------------------------------------------
-- 8. Grants de coluna (RLS filtra LINHA, não COLUNA)
-- ----------------------------------------------------------------------------
-- Sem isto, um `ceo` chamando o PostgREST direto com o próprio JWT reescreveria
-- `protocol`, `origin` ou `requested_at` — a policy de update deixaria passar,
-- porque ela olha a linha, não as colunas tocadas.
--
-- ⚠️ As funções da seção 10 são SECURITY INVOKER, então estes grants valem
-- DENTRO delas também. É de propósito: uma função que pudesse mais que quem a
-- chama seria um jeito de contornar exatamente esta seção.

-- INSERT: tudo menos `protocol` (§10 — nunca aceitar do cliente), `search_text`
-- (gerada) e os carimbos automáticos.
--
-- ⚠️ `rejection_reason` e `cancellation_reason` também estão FORA, e é
-- proposital: nenhum ponto de entrada é `rejected` ou `cancelled`, então não
-- existe criação legítima que precise deles. Uma tentativa de nascer cancelada
-- para em 42501 aqui, antes mesmo de o trigger olhar o grafo.
revoke insert on public.lectures from authenticated, anon;
grant insert (
  id, origin, name, theme, city, location, type, type_other, format,
  event_date, start_time, end_time, attendees_estimated,
  speaker_id, responsible_id, priority, status, notes,
  held_at, outcome_notes, attendees_actual,
  requester_contact_id, requester_name, requester_email, requester_phone,
  requester_organization, created_by
) on public.lectures to authenticated;

-- UPDATE: fora da lista ficam `protocol` (§69), `origin` (§68), `requested_at`
-- (§11), `created_by`, `created_at` e `id`. O trigger da seção 9 repete a
-- proibição dos três primeiros — cinto e suspensório, porque um grant esquecido
-- numa migration futura é mais fácil de acontecer que um trigger removido.
revoke update on public.lectures from authenticated, anon;
grant update (
  name, theme, city, location, type, type_other, format,
  event_date, start_time, end_time, attendees_estimated, attendees_actual,
  speaker_id, responsible_id, priority, status, notes,
  rejection_reason, cancellation_reason,
  held_at, outcome_notes,
  requester_name, requester_email, requester_phone, requester_organization,
  updated_by, updated_at
) on public.lectures to authenticated;

-- §30. Não existe exclusão física: uma palestra pode já ter sido comunicada ao
-- solicitante e responde por um protocolo que alguém tem anotado. O controle é
-- CANCELADA, e é por isso que não há soft delete — seria um segundo conceito de
-- "não vale mais" competindo com o status.
revoke delete on public.lectures from authenticated, anon;

-- O grafo não se edita pela aplicação.
revoke insert, update, delete on public.lecture_status_transitions from authenticated, anon;

-- A trilha não se reescreve nem se apaga.
revoke update, delete on public.lecture_audit_logs from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 9. Triggers
-- ----------------------------------------------------------------------------
create trigger on_lectures_updated
  before update on public.lectures
  for each row execute procedure public.handle_updated_at();

-- O GUARDA DO MÓDULO. Impõe, em qualquer caminho de escrita:
--   • o status inicial é um ponto de entrada declarado (§4)
--   • toda mudança de status é uma aresta declarada (§5)
--   • protocolo, origem e data da solicitação nunca mudam (§68, §69, §11)
--
-- ⚠️ SECURITY DEFINER, e o motivo é sutil: a função LÊ
-- `lecture_status_transitions`, que tem RLS. Como INVOKER, um chamador sem
-- SELECT naquela tabela — o `service_role` passa, mas um papel novo amanhã pode
-- não passar — leria ZERO linhas, o `not exists` daria verdadeiro e TODA
-- transição seria recusada. Um trigger de segurança que falha fechado por
-- motivo errado é um trigger que ninguém consegue depurar.
--
-- O risco de DEFINER aqui é nulo: a função não recebe entrada dinâmica, não
-- monta SQL, tem `search_path = ''` e só lê um catálogo estático.
create or replace function public.enforce_lecture_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.lecture_status_transitions
      where from_status is null and to_status = new.status
    ) then
      raise exception 'Uma palestra não pode ser criada com a situação "%".', new.status
        using errcode = 'PL001';
    end if;

    return new;
  end if;

  -- §69, §68, §11 — os três imutáveis.
  if new.protocol is distinct from old.protocol then
    raise exception 'O protocolo não pode ser alterado.' using errcode = 'PL002';
  end if;
  if new.origin is distinct from old.origin then
    raise exception 'A origem da palestra não pode ser alterada.' using errcode = 'PL002';
  end if;
  if new.requested_at is distinct from old.requested_at then
    raise exception 'A data da solicitação não pode ser alterada.' using errcode = 'PL002';
  end if;

  -- Edição que não mexe no status passa direto: a checagem do grafo custa uma
  -- leitura e não teria o que checar.
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not exists (
    select 1 from public.lecture_status_transitions
    where from_status = old.status and to_status = new.status
  ) then
    raise exception 'Não é possível mudar a situação de "%" para "%".', old.status, new.status
      using errcode = 'PL001';
  end if;

  return new;
end;
$$;

comment on function public.enforce_lecture_rules() is
  'Guarda do módulo: valida o ponto de entrada, o grafo de transições e os campos imutáveis, em qualquer caminho de escrita.';

create trigger lectures_guard
  before insert or update on public.lectures
  for each row execute procedure public.enforce_lecture_rules();

-- ----------------------------------------------------------------------------
-- 10. Operações transacionais
-- ----------------------------------------------------------------------------
-- Criar, editar ou mudar o status de uma palestra são SEMPRE duas escritas que
-- precisam acontecer juntas ou não acontecer: a linha e a auditoria. O
-- supabase-js não faz transação de várias chamadas, então isso vive no banco.
--
-- SECURITY INVOKER (padrão do plpgsql) em todas, menos onde está dito: a RLS e
-- os grants de coluna continuam valendo DENTRO delas. A checagem de papel no
-- topo existe só para devolver um erro limpo (42501 → "forbidden") em vez de um
-- "permission denied for table" cru.

-- Serializa operações concorrentes sobre a MESMA palestra (A aprova, B cancela,
-- C arrasta no calendário).
--
-- Por que lock consultivo e não `select ... for update`: em tabela com RLS,
-- `for update` também exige policy e privilégio de UPDATE, e aqui o Atendente
-- tem SELECT mas não UPDATE — um `for update` numa leitura dele quebraria.
create or replace function public.lock_lecture(p_lecture_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if public.current_app_role() not in ('admin', 'ceo') then
    raise exception 'Sem permissão para alterar palestras.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_lecture_id::text));
end;
$$;

revoke execute on function public.lock_lecture(uuid) from public;
grant execute on function public.lock_lecture(uuid) to authenticated;

-- Confere que um id de perfil informado existe.
--
-- Existe para dar a MENSAGEM CERTA: sem ela, a FK dispararia 23503, que o
-- projeto traduz como "há registros vinculados" — o oposto do que aconteceu.
-- Nulo é válido: é como se DESATRIBUI um responsável ou palestrante.
create or replace function public.assert_lecture_profile(p_profile_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_profile_id is null then
    return;
  end if;

  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'Usuário não encontrado.' using errcode = 'PL006';
  end if;
end;
$$;

revoke execute on function public.assert_lecture_profile(uuid) from public;
grant execute on function public.assert_lecture_profile(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 10.1 Solicitação via chatbot (§6, §7, §40)
-- ----------------------------------------------------------------------------
-- ⚠️ A GARANTIA DO §6 ESTÁ NA ASSINATURA, NÃO NUMA CHECAGEM.
--
-- O §6 diz que o chatbot não pode aprovar, rejeitar, planejar, confirmar,
-- realizar, cancelar, nem definir responsável, prioridade ou palestrante. Esta
-- função NÃO TEM PARÂMETRO para nada disso. Não há o que validar, não há o que
-- esquecer de validar, e nenhuma versão futura vai "só passar o status junto"
-- por descuido: teria que mudar a assinatura, o que aparece no diff.
--
-- `origin` e `status` são literais no corpo. `priority` fica no default
-- ('normal'). O protocolo sai do DEFAULT da coluna.
--
-- SECURITY DEFINER + grant só para `service_role`: o chat é ANÔNIMO, não há
-- `auth.uid()` nem papel, então nenhuma policy de insert autorizaria a escrita.
-- O caminho é o mesmo já usado por `csp_leads` (ver o cabeçalho de
-- 20260804000000_create_chat_csp.sql): a superfície pública do banco é zero, e
-- toda escrita anônima passa pelo servidor Next.
create or replace function public.create_lecture_request(
  p_requester_name text,
  p_city text,
  p_type public.lecture_type,
  p_type_other text,
  p_theme text,
  p_event_date date,
  p_start_time time,
  p_location text,
  p_format public.lecture_format,
  p_attendees_estimated integer,
  p_notes text,
  p_requester_contact_id uuid,
  p_requester_email text,
  p_requester_phone text,
  p_requester_organization text,
  -- §7 coleta um único "Nome". Enquanto o negócio não disser se o chatbot deve
  -- perguntar também um TÍTULO para a palestra, a solicitação nasce com os dois
  -- iguais — e este parâmetro é o lugar pronto para a resposta. Ver o GAP em
  -- docs/PALESTRAS.md.
  p_name text default null
)
returns public.lectures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lecture public.lectures;
begin
  insert into public.lectures (
    origin, status,
    name, theme, city, location, type, type_other, format,
    event_date, start_time,
    attendees_estimated, notes,
    requester_contact_id, requester_name, requester_email, requester_phone,
    requester_organization
  )
  values (
    'chatbot', 'requested',
    coalesce(nullif(btrim(p_name), ''), btrim(p_requester_name)),
    btrim(p_theme),
    btrim(p_city),
    nullif(btrim(p_location), ''),
    p_type,
    case when p_type = 'other' then nullif(btrim(p_type_other), '') end,
    p_format,
    p_event_date,
    p_start_time,
    p_attendees_estimated,
    nullif(btrim(p_notes), ''),
    p_requester_contact_id,
    btrim(p_requester_name),
    nullif(btrim(p_requester_email), ''),
    nullif(btrim(p_requester_phone), ''),
    nullif(btrim(p_requester_organization), '')
  )
  returning * into v_lecture;

  -- §57. Não existe central de notificações neste projeto (conferido: nenhuma
  -- tabela, nenhum job, nenhum canal). O que existe é ISTO: uma linha de
  -- trilha, imediata e transacional, que o contador da caixa de entrada lê. O
  -- caminho para badge e central está em docs/PALESTRAS.md.
  insert into public.lecture_audit_logs (lecture_id, action, actor_id, metadata)
  values (
    v_lecture.id,
    'lecture_created',
    null,
    jsonb_build_object(
      'origin', 'chatbot',
      'protocol', v_lecture.protocol,
      'status', v_lecture.status,
      'theme', v_lecture.theme,
      'city', v_lecture.city,
      'eventDate', v_lecture.event_date,
      'requesterName', v_lecture.requester_name
    )
  );

  return v_lecture;
end;
$$;

comment on function public.create_lecture_request is
  'A ÚNICA porta de entrada do chatbot. Sem parâmetro de status, prioridade, responsável ou palestrante — o §6 vira impossibilidade, não checagem.';

-- Só o servidor. `authenticated` e `anon` não chamam: um usuário logado que
-- quisesse registrar um pedido usa `create_lecture` (origem interna), e o
-- anônimo não fala com o banco direto.
revoke execute on function public.create_lecture_request(
  text, text, public.lecture_type, text, text, date, time, text,
  public.lecture_format, integer, text, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_lecture_request(
  text, text, public.lecture_type, text, text, date, time, text,
  public.lecture_format, integer, text, uuid, text, text, text, text
) to service_role;

-- ----------------------------------------------------------------------------
-- 10.2 Cadastro interno (§28, §53)
-- ----------------------------------------------------------------------------
-- Diferente do chatbot em três pontos que importam:
--   • escolhe o ponto de entrada (o trigger confere que é legítimo);
--   • já pode definir responsável, palestrante e prioridade;
--   • aceita DATA NO PASSADO — §53. Um evento é um convite e não pode ser
--     emitido para ontem; uma palestra é também um REGISTRO, e a APCS precisa
--     poder lançar a que aconteceu semana passada.
create or replace function public.create_lecture(
  p_name text,
  p_theme text,
  p_city text,
  p_location text,
  p_type public.lecture_type,
  p_type_other text,
  p_format public.lecture_format,
  p_event_date date,
  p_start_time time,
  p_end_time time,
  p_attendees_estimated integer,
  p_speaker_id uuid,
  p_responsible_id uuid,
  p_priority public.lecture_priority,
  p_status public.lecture_status,
  p_notes text,
  p_requester_name text default null,
  p_requester_email text default null,
  p_requester_phone text default null,
  p_requester_organization text default null
)
returns public.lectures
language plpgsql
set search_path = ''
as $$
declare
  v_lecture public.lectures;
begin
  if public.current_app_role() not in ('admin', 'ceo') then
    raise exception 'Sem permissão para cadastrar palestras.' using errcode = '42501';
  end if;

  perform public.assert_lecture_profile(p_speaker_id);
  perform public.assert_lecture_profile(p_responsible_id);

  -- §13. A mensagem precisa dizer O QUE FAZER; deixar o CHECK
  -- `lectures_scheduled_needs_time` estourar diria só "dados inválidos".
  if p_status in ('confirmed', 'held') and p_start_time is null then
    raise exception 'Informe o horário de início para confirmar a palestra.'
      using errcode = 'PL005';
  end if;

  insert into public.lectures (
    origin, status,
    name, theme, city, location, type, type_other, format,
    event_date, start_time, end_time, attendees_estimated,
    speaker_id, responsible_id, priority, notes,
    -- §26 + §53. Nascer REALIZADA é o registro histórico, e nele a data de
    -- realização é a data da palestra — que é o que a pessoa acabou de digitar.
    -- Deixar nulo obrigaria um segundo passo para gravar o que já se sabe.
    -- Participantes e observações da realização entram depois, por
    -- `register_lecture_outcome`.
    held_at,
    requester_name, requester_email, requester_phone, requester_organization
  )
  values (
    'internal', p_status,
    btrim(p_name), btrim(p_theme), btrim(p_city), nullif(btrim(p_location), ''),
    p_type,
    case when p_type = 'other' then nullif(btrim(p_type_other), '') end,
    p_format,
    p_event_date, p_start_time, p_end_time, p_attendees_estimated,
    p_speaker_id, p_responsible_id, coalesce(p_priority, 'normal'),
    nullif(btrim(p_notes), ''),
    case when p_status = 'held' then p_event_date end,
    nullif(btrim(p_requester_name), ''),
    nullif(btrim(p_requester_email), ''),
    nullif(btrim(p_requester_phone), ''),
    nullif(btrim(p_requester_organization), '')
  )
  returning * into v_lecture;

  insert into public.lecture_audit_logs (lecture_id, action, metadata)
  values (
    v_lecture.id,
    'lecture_created',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'origin', 'internal',
      'protocol', v_lecture.protocol,
      'status', v_lecture.status,
      'theme', v_lecture.theme,
      'city', v_lecture.city,
      'eventDate', v_lecture.event_date
    )
  );

  return v_lecture;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10.3 Edição (§42)
-- ----------------------------------------------------------------------------
-- Só os campos DESCRITIVOS. Agenda, status, responsável, palestrante e dados de
-- realização têm cada um a sua função — é o que o §43, o §44, o §45 e o §46
-- pedem, e é o que permite auditar cada mudança com a ação certa em vez de um
-- `lecture_updated` genérico que esconde uma troca de responsável no meio de um
-- diff de 12 campos.
--
-- O DIFF é o motivo de isto ser função e não update na aplicação: ele precisa da
-- linha antiga e da nova na MESMA transação. Lido antes e escrito depois pela
-- aplicação, duas edições simultâneas registrariam "de A para C" e "de A para
-- B" — e o histórico contaria uma mentira.
create or replace function public.update_lecture(
  p_lecture_id uuid,
  p_name text,
  p_theme text,
  p_city text,
  p_location text,
  p_type public.lecture_type,
  p_type_other text,
  p_format public.lecture_format,
  p_attendees_estimated integer,
  p_priority public.lecture_priority,
  p_notes text
)
returns public.lectures
language plpgsql
set search_path = ''
as $$
declare
  v_old public.lectures;
  v_new public.lectures;
  v_changes jsonb := '[]'::jsonb;
begin
  -- ⚠️ A PERMISSÃO VEM ANTES DA PERGUNTA. Travar primeiro (o lock checa o
  -- papel) faz quem não pode escrever receber 42501 sem descobrir, pelo tipo do
  -- erro, se aquele id existe.
  perform public.lock_lecture(p_lecture_id);

  select * into v_old from public.lectures where id = p_lecture_id;
  if not found then
    raise exception 'Palestra não encontrada.' using errcode = 'P0002';
  end if;

  update public.lectures
  set name = btrim(p_name),
      theme = btrim(p_theme),
      city = btrim(p_city),
      location = nullif(btrim(p_location), ''),
      type = p_type,
      type_other = case when p_type = 'other' then nullif(btrim(p_type_other), '') end,
      format = p_format,
      attendees_estimated = p_attendees_estimated,
      priority = coalesce(p_priority, v_old.priority),
      notes = nullif(btrim(p_notes), ''),
      updated_by = auth.uid()
  where id = p_lecture_id
  returning * into v_new;

  -- `is distinct from` e não `<>`: com NULL dos dois lados, `<>` devolve NULL e
  -- a mudança (ou a não-mudança) passaria despercebida.
  if v_old.name is distinct from v_new.name then
    v_changes := v_changes || jsonb_build_object('field', 'name', 'from', v_old.name, 'to', v_new.name);
  end if;
  if v_old.theme is distinct from v_new.theme then
    v_changes := v_changes || jsonb_build_object('field', 'theme', 'from', v_old.theme, 'to', v_new.theme);
  end if;
  if v_old.city is distinct from v_new.city then
    v_changes := v_changes || jsonb_build_object('field', 'city', 'from', v_old.city, 'to', v_new.city);
  end if;
  if v_old.location is distinct from v_new.location then
    v_changes := v_changes || jsonb_build_object('field', 'location', 'from', v_old.location, 'to', v_new.location);
  end if;
  if v_old.type is distinct from v_new.type then
    v_changes := v_changes || jsonb_build_object('field', 'type', 'from', v_old.type, 'to', v_new.type);
  end if;
  if v_old.type_other is distinct from v_new.type_other then
    v_changes := v_changes || jsonb_build_object('field', 'typeOther', 'from', v_old.type_other, 'to', v_new.type_other);
  end if;
  if v_old.format is distinct from v_new.format then
    v_changes := v_changes || jsonb_build_object('field', 'format', 'from', v_old.format, 'to', v_new.format);
  end if;
  if v_old.attendees_estimated is distinct from v_new.attendees_estimated then
    v_changes := v_changes || jsonb_build_object('field', 'attendeesEstimated', 'from', v_old.attendees_estimated, 'to', v_new.attendees_estimated);
  end if;
  if v_old.priority is distinct from v_new.priority then
    v_changes := v_changes || jsonb_build_object('field', 'priority', 'from', v_old.priority, 'to', v_new.priority);
  end if;
  if v_old.notes is distinct from v_new.notes then
    v_changes := v_changes || jsonb_build_object('field', 'notes', 'from', v_old.notes, 'to', v_new.notes);
  end if;

  -- §70. Edição que não mudou nada não vira linha de trilha — senão a trilha
  -- vira ruído e a mudança de verdade se perde no meio.
  if jsonb_array_length(v_changes) > 0 then
    insert into public.lecture_audit_logs (lecture_id, action, metadata)
    values (
      p_lecture_id,
      'lecture_updated',
      jsonb_build_object('actor_name', public.current_actor_name(), 'changes', v_changes)
    );
  end if;

  return v_new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10.4 Mudança de status (§43)
-- ----------------------------------------------------------------------------
-- O grafo já é imposto pelo trigger. O que esta função acrescenta é o que o
-- trigger não sabe: a MENSAGEM certa, os motivos obrigatórios (§24/§25), a data
-- de realização (§26) e a linha de trilha com a ação específica (§36).
create or replace function public.set_lecture_status(
  p_lecture_id uuid,
  p_status public.lecture_status,
  p_reason text default null
)
returns public.lectures
language plpgsql
set search_path = ''
as $$
declare
  v_old public.lectures;
  v_new public.lectures;
  v_reason text := nullif(btrim(p_reason), '');
  v_action public.lecture_audit_action;
begin
  perform public.lock_lecture(p_lecture_id);

  select * into v_old from public.lectures where id = p_lecture_id;
  if not found then
    raise exception 'Palestra não encontrada.' using errcode = 'P0002';
  end if;

  if v_old.status = p_status then
    -- Idempotente: pedir de novo o que já vale não é erro e não vira trilha.
    return v_old;
  end if;

  -- §24/§25. Antes do update, para a mensagem falar de motivo e não de CHECK.
  if p_status = 'rejected' and v_reason is null then
    raise exception 'Informe o motivo da rejeição.' using errcode = 'PL004';
  end if;
  if p_status = 'cancelled' and v_reason is null then
    raise exception 'Informe o motivo do cancelamento.' using errcode = 'PL004';
  end if;

  -- §13. Confirmar (e realizar) exige horário.
  if p_status in ('confirmed', 'held') and v_old.start_time is null then
    raise exception 'Informe o horário de início antes de confirmar a palestra.'
      using errcode = 'PL005';
  end if;

  update public.lectures
  set status = p_status,
      rejection_reason = case when p_status = 'rejected' then v_reason end,
      cancellation_reason = case when p_status = 'cancelled' then v_reason end,
      -- §26/§56. Realizar é um ATO — e o ato acontece na data da palestra. Os
      -- números da realização entram depois, por `register_lecture_outcome`.
      held_at = case when p_status = 'held' then v_old.event_date end,
      updated_by = auth.uid()
  where id = p_lecture_id
  returning * into v_new;

  -- §36. Cancelar e rejeitar têm ação própria; o resto é mudança de situação.
  v_action := case p_status
    when 'cancelled' then 'lecture_cancelled'
    when 'rejected' then 'lecture_rejected'
    else 'lecture_status_changed'
  end;

  insert into public.lecture_audit_logs (lecture_id, action, metadata)
  values (
    p_lecture_id,
    v_action,
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'from', v_old.status,
      'to', v_new.status,
      'reason', v_reason
    )
  );

  return v_new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10.5 Reagendamento (§34, §35, §44)
-- ----------------------------------------------------------------------------
-- §35: NÃO cria palestra nova. Mesma linha, mesmo protocolo, data nova, e a
-- mudança na trilha.
--
-- Serve tanto ao formulário quanto ao arrastar-e-soltar do calendário (§34), e
-- é por isso que ela é uma função à parte: os dois caminhos precisam da mesma
-- validação, da mesma auditoria e da mesma resposta.
--
-- ⚠️ NÃO detecta conflito aqui, de propósito. O §33 é explícito: conflito é
-- ALERTA, não bloqueio (pode haver mais de um palestrante disponível). Quem
-- pergunta "isto conflita?" é `find_lecture_conflicts`, e quem decide o que
-- fazer com a resposta é a tela.
create or replace function public.reschedule_lecture(
  p_lecture_id uuid,
  p_event_date date,
  p_start_time time,
  p_end_time time
)
returns public.lectures
language plpgsql
set search_path = ''
as $$
declare
  v_old public.lectures;
  v_new public.lectures;
begin
  perform public.lock_lecture(p_lecture_id);

  select * into v_old from public.lectures where id = p_lecture_id;
  if not found then
    raise exception 'Palestra não encontrada.' using errcode = 'P0002';
  end if;

  -- Remarcar o que não vai mais acontecer não faz sentido, e mexer numa
  -- realizada reescreveria história.
  if v_old.status in ('held', 'rejected', 'cancelled') then
    raise exception 'Uma palestra realizada, rejeitada ou cancelada não pode ser reagendada.'
      using errcode = 'PL003';
  end if;

  -- §13. Tirar o horário de uma palestra já confirmada a deixaria confirmada
  -- sem hora. O CHECK barraria; a mensagem aqui explica.
  if v_old.status = 'confirmed' and p_start_time is null then
    raise exception 'Uma palestra confirmada precisa ter horário de início.'
      using errcode = 'PL005';
  end if;

  update public.lectures
  set event_date = p_event_date,
      start_time = p_start_time,
      end_time = p_end_time,
      updated_by = auth.uid()
  where id = p_lecture_id
  returning * into v_new;

  insert into public.lecture_audit_logs (lecture_id, action, metadata)
  values (
    p_lecture_id,
    'lecture_rescheduled',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'changes', jsonb_build_array(
        jsonb_build_object('field', 'eventDate', 'from', v_old.event_date, 'to', v_new.event_date),
        jsonb_build_object('field', 'startTime', 'from', v_old.start_time, 'to', v_new.start_time),
        jsonb_build_object('field', 'endTime', 'from', v_old.end_time, 'to', v_new.end_time)
      )
    )
  );

  return v_new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10.6 Atribuições (§45, §46)
-- ----------------------------------------------------------------------------
-- Duas funções e não uma com um parâmetro "campo": a ação da trilha é
-- diferente, a pergunta que a tela faz é diferente, e um dia a permissão pode
-- ser diferente (definir palestrante é decisão de agenda; definir responsável é
-- decisão de time).
--
-- `p_profile_id` nulo DESATRIBUI, e isso está na trilha como qualquer outra
-- mudança — "tiraram o responsável" é exatamente o tipo de coisa que alguém
-- precisa conseguir descobrir depois.
create or replace function public.assign_lecture_responsible(
  p_lecture_id uuid,
  p_profile_id uuid
)
returns public.lectures
language plpgsql
set search_path = ''
as $$
declare
  v_old public.lectures;
  v_new public.lectures;
begin
  perform public.lock_lecture(p_lecture_id);
  perform public.assert_lecture_profile(p_profile_id);

  select * into v_old from public.lectures where id = p_lecture_id;
  if not found then
    raise exception 'Palestra não encontrada.' using errcode = 'P0002';
  end if;

  if v_old.responsible_id is not distinct from p_profile_id then
    return v_old;
  end if;

  update public.lectures
  set responsible_id = p_profile_id,
      updated_by = auth.uid()
  where id = p_lecture_id
  returning * into v_new;

  insert into public.lecture_audit_logs (lecture_id, action, metadata)
  values (
    p_lecture_id,
    'lecture_responsible_assigned',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'from', v_old.responsible_id,
      'to', v_new.responsible_id
    )
  );

  return v_new;
end;
$$;

create or replace function public.assign_lecture_speaker(
  p_lecture_id uuid,
  p_profile_id uuid
)
returns public.lectures
language plpgsql
set search_path = ''
as $$
declare
  v_old public.lectures;
  v_new public.lectures;
begin
  perform public.lock_lecture(p_lecture_id);
  perform public.assert_lecture_profile(p_profile_id);

  select * into v_old from public.lectures where id = p_lecture_id;
  if not found then
    raise exception 'Palestra não encontrada.' using errcode = 'P0002';
  end if;

  if v_old.speaker_id is not distinct from p_profile_id then
    return v_old;
  end if;

  update public.lectures
  set speaker_id = p_profile_id,
      updated_by = auth.uid()
  where id = p_lecture_id
  returning * into v_new;

  insert into public.lecture_audit_logs (lecture_id, action, metadata)
  values (
    p_lecture_id,
    'lecture_speaker_assigned',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'from', v_old.speaker_id,
      'to', v_new.speaker_id
    )
  );

  return v_new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10.7 Registro da realização (§26)
-- ----------------------------------------------------------------------------
-- Separado da mudança de status porque o §26 é explícito: "esses campos podem
-- ser preenchidos posteriormente". Marcar como realizada e contar quantos
-- vieram são dois momentos — às vezes dois dias.
--
-- Exige que a palestra JÁ esteja realizada. É a mesma regra do CHECK
-- `lectures_outcome_requires_held`, com mensagem em vez de código.
create or replace function public.register_lecture_outcome(
  p_lecture_id uuid,
  p_held_at date,
  p_attendees_actual integer,
  p_outcome_notes text
)
returns public.lectures
language plpgsql
set search_path = ''
as $$
declare
  v_old public.lectures;
  v_new public.lectures;
begin
  perform public.lock_lecture(p_lecture_id);

  select * into v_old from public.lectures where id = p_lecture_id;
  if not found then
    raise exception 'Palestra não encontrada.' using errcode = 'P0002';
  end if;

  if v_old.status <> 'held' then
    raise exception 'Marque a palestra como realizada antes de registrar o resultado.'
      using errcode = 'PL003';
  end if;

  update public.lectures
  set held_at = coalesce(p_held_at, v_old.held_at, v_old.event_date),
      attendees_actual = p_attendees_actual,
      outcome_notes = nullif(btrim(p_outcome_notes), ''),
      updated_by = auth.uid()
  where id = p_lecture_id
  returning * into v_new;

  insert into public.lecture_audit_logs (lecture_id, action, metadata)
  values (
    p_lecture_id,
    'lecture_outcome_registered',
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'changes', jsonb_build_array(
        jsonb_build_object('field', 'heldAt', 'from', v_old.held_at, 'to', v_new.held_at),
        jsonb_build_object('field', 'attendeesActual', 'from', v_old.attendees_actual, 'to', v_new.attendees_actual),
        jsonb_build_object('field', 'outcomeNotes', 'from', v_old.outcome_notes, 'to', v_new.outcome_notes)
      )
    )
  );

  return v_new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10.8 Conflito de horário (§33)
-- ----------------------------------------------------------------------------
-- ALERTA, NUNCA BLOQUEIO. Devolve as palestras que disputam o mesmo espaço de
-- tempo; quem decide o que fazer com isso é quem está olhando a tela — pode
-- haver mais de um palestrante disponível, e o escopo é explícito nisso.
--
-- ⚠️ A SOBREPOSIÇÃO USA `OVERLAPS`, e não uma comparação escrita à mão. Foi
-- conferido contra este banco, caso a caso:
--
--   10:00–11:00 × 10:30–11:30   conflita
--   10:00–11:00 × 11:00–12:00   NÃO conflita  (encostar não é sobrepor —
--                                              palestras em sequência são
--                                              normais)
--   10:00–11:00 × 10:00–11:00   conflita
--   10:00       × 09:00–11:00   conflita      (sem hora de término, a palestra
--                                              ocupa o instante do início)
--   10:00       × 10:00         conflita
--   11:00       × 10:00–11:00   NÃO conflita  (o instante final é aberto)
--
-- Uma versão escrita à mão erraria pelo menos um desses, e o que ela errasse
-- seria descoberto por um alerta que não apareceu.
--
-- QUAIS STATUS OCUPAM A AGENDA: `planned`, `confirmed` e `held` — os três em
-- que a APCS assumiu um compromisso naquele horário. Pedido, análise e
-- aprovação ainda são data DESEJADA; rejeitada e cancelada não ocupam nada.
--
-- SECURITY INVOKER: a RLS decide quais palestras a pessoa pode ver, e quem não
-- pode ver a agenda não descobre por aqui que ela está cheia.
create or replace function public.find_lecture_conflicts(
  p_event_date date,
  p_start_time time,
  p_end_time time,
  p_exclude_id uuid default null
)
returns setof public.lectures
language sql
stable
set search_path = ''
as $$
  select l.*
  from public.lectures l
  where l.event_date = p_event_date
    and l.status in ('planned', 'confirmed', 'held')
    and l.start_time is not null
    and p_start_time is not null
    and (l.id is distinct from p_exclude_id)
    and (l.start_time, coalesce(l.end_time, l.start_time))
        overlaps (p_start_time, coalesce(p_end_time, p_start_time))
  order by l.start_time, l.name;
$$;

comment on function public.find_lecture_conflicts is
  'Palestras que disputam o mesmo horário. ALERTA — nunca bloqueia (§33).';

-- ----------------------------------------------------------------------------
-- 11. Grants de execução
-- ----------------------------------------------------------------------------
-- `revoke from public` antes de cada grant: sem isso, toda função nasce
-- executável por qualquer papel, inclusive `anon`.
revoke execute on function public.next_lecture_protocol() from public;
grant execute on function public.next_lecture_protocol() to authenticated, service_role;

revoke execute on function public.create_lecture(
  text, text, text, text, public.lecture_type, text, public.lecture_format,
  date, time, time, integer, uuid, uuid, public.lecture_priority,
  public.lecture_status, text, text, text, text, text
) from public;
grant execute on function public.create_lecture(
  text, text, text, text, public.lecture_type, text, public.lecture_format,
  date, time, time, integer, uuid, uuid, public.lecture_priority,
  public.lecture_status, text, text, text, text, text
) to authenticated;

revoke execute on function public.update_lecture(
  uuid, text, text, text, text, public.lecture_type, text,
  public.lecture_format, integer, public.lecture_priority, text
) from public;
grant execute on function public.update_lecture(
  uuid, text, text, text, text, public.lecture_type, text,
  public.lecture_format, integer, public.lecture_priority, text
) to authenticated;

revoke execute on function public.set_lecture_status(uuid, public.lecture_status, text) from public;
grant execute on function public.set_lecture_status(uuid, public.lecture_status, text) to authenticated;

revoke execute on function public.reschedule_lecture(uuid, date, time, time) from public;
grant execute on function public.reschedule_lecture(uuid, date, time, time) to authenticated;

revoke execute on function public.assign_lecture_responsible(uuid, uuid) from public;
grant execute on function public.assign_lecture_responsible(uuid, uuid) to authenticated;

revoke execute on function public.assign_lecture_speaker(uuid, uuid) from public;
grant execute on function public.assign_lecture_speaker(uuid, uuid) to authenticated;

revoke execute on function public.register_lecture_outcome(uuid, date, integer, text) from public;
grant execute on function public.register_lecture_outcome(uuid, date, integer, text) to authenticated;

-- Leitura: quem pode ver a agenda pode perguntar se ela conflita.
revoke execute on function public.find_lecture_conflicts(date, time, time, uuid) from public;
grant execute on function public.find_lecture_conflicts(date, time, time, uuid) to authenticated;

-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- O CLI do Supabase não tem down-migration; o desfazimento é manual, na ordem
-- (dependências primeiro):
--
--   drop function if exists public.find_lecture_conflicts(date, time, time, uuid);
--   drop function if exists public.register_lecture_outcome(uuid, date, integer, text);
--   drop function if exists public.assign_lecture_speaker(uuid, uuid);
--   drop function if exists public.assign_lecture_responsible(uuid, uuid);
--   drop function if exists public.reschedule_lecture(uuid, date, time, time);
--   drop function if exists public.set_lecture_status(uuid, public.lecture_status, text);
--   drop function if exists public.update_lecture(uuid, text, text, text, text, public.lecture_type, text, public.lecture_format, integer, public.lecture_priority, text);
--   drop function if exists public.create_lecture(text, text, text, text, public.lecture_type, text, public.lecture_format, date, time, time, integer, uuid, uuid, public.lecture_priority, public.lecture_status, text, text, text, text, text);
--   drop function if exists public.create_lecture_request(text, text, public.lecture_type, text, text, date, time, text, public.lecture_format, integer, text, uuid, text, text, text, text);
--   drop function if exists public.assert_lecture_profile(uuid);
--   drop function if exists public.lock_lecture(uuid);
--   drop trigger if exists lectures_guard on public.lectures;
--   drop function if exists public.enforce_lecture_rules();
--   drop policy if exists "profiles_select_directory" on public.profiles;
--   drop table if exists public.lecture_audit_logs;
--   drop table if exists public.lecture_status_transitions;
--   drop table if exists public.lectures;
--   drop function if exists public.next_lecture_protocol();
--   drop sequence if exists public.lecture_protocol_seq;
--   drop type if exists public.lecture_audit_action;
--   drop type if exists public.lecture_origin;
--   drop type if exists public.lecture_priority;
--   drop type if exists public.lecture_format;
--   drop type if exists public.lecture_type;
--   drop type if exists public.lecture_status;
--
-- ⚠️ ESTA MIGRATION ALTERA UMA TABELA EXISTENTE: acrescenta a policy
-- `profiles_select_directory` em `public.profiles` (seção 6). O rollback acima
-- a remove, e nada mais de outro módulo é tocado.
-- ============================================================================
