-- ============================================================================
-- WHATSAPP — a caixa de entrada do Atendimento
-- ============================================================================
--
-- O que este módulo acrescenta: a conversa de WhatsApp do número da APCS passa
-- a EXISTIR no CRM. Hoje ela só existe no celular de quem tem o aparelho na
-- mão — e por isso ninguém consegue ver o que foi respondido a um associado,
-- nem responder de outro lugar, nem saber quantas conversas estão em aberto.
--
-- ----------------------------------------------------------------------------
-- DECISÕES CENTRAIS
-- ----------------------------------------------------------------------------
--
-- 1. TABELAS PRÓPRIAS, E NÃO REUSO DE `chat_conversations`/`chat_messages`.
--    Aquelas são do CHAT PÚBLICO da web: identificadas por um token de sessão
--    guardado num cookie httpOnly, com consentimento LGPD aceito num botão,
--    com `flow_key` dizendo qual roteiro do bot está rodando. Um chat de
--    WhatsApp não tem sessão, não tem cookie, não teve botão de aceite e não
--    tem roteiro — a pessoa simplesmente mandou mensagem para um número.
--    Enfiar os dois na mesma tabela obrigaria `session_token_hash` a virar
--    anulável, e aí a coluna que hoje IDENTIFICA uma conversa da web deixaria
--    de identificar coisa nenhuma.
--
-- 2. A CAIXA É UM LIVRO-RAZÃO, NÃO UM FILTRO.
--    TUDO que entra e sai do número é gravado aqui: o que a pessoa escreveu, o
--    que o atendente respondeu pelo CRM, o que o bot de enquete respondeu
--    sozinho e o que alguém digitou direto no celular. Um atendente que vê
--    metade da conversa responde a pergunta errada — e a metade que faltaria é
--    justamente a automática, que ele não tem como adivinhar.
--
--    A consequência de desenho: a ingestão do webhook grava PRIMEIRO aqui e só
--    depois entrega o evento a quem quiser consumi-lo (hoje, as Enquetes). O
--    livro-razão não depende de nenhum consumidor achar a mensagem
--    interessante.
--
-- 3. IDEMPOTÊNCIA SEM TABELA DE EVENTOS.
--    O fornecedor reentrega o mesmo webhook sempre que não recebe 200 a tempo —
--    é o caminho normal, não uma anomalia. Enquetes resolveu isso com uma
--    tabela-diário (`survey_inbound_events`); aqui não é preciso, e uma tabela
--    a menos é uma verdade a menos para manter em sincronia:
--
--      • mensagem que chega → `unique (provider, provider_message_id)` recusa a
--        segunda gravação no próprio índice;
--      • aviso de entrega/leitura → é um UPDATE que SÓ AVANÇA na escala
--        (pendente < enviada < entregue < lida), então aplicá-lo duas vezes dá
--        exatamente o mesmo resultado que aplicá-lo uma.
--
--    Idempotência que sai da FORMA do dado não precisa de ninguém lembrando de
--    consultá-la antes.
--
-- 4. ⚠️ A Z-API NÃO ASSINA OS WEBHOOKS.
--    A Meta manda `X-Hub-Signature-256` e o §18 de Enquetes confere o HMAC do
--    corpo. A Z-API não manda assinatura nenhuma — não há HMAC, não há header
--    secreto, não há nada no corpo que prove a origem. Conferido na
--    documentação oficial (developer.z-api.io/webhooks/introduction e
--    /security/introduction) antes de escrever este arquivo.
--
--    Então a autenticação é OUTRA, e ela mora fora do banco: o segredo está no
--    CAMINHO da URL do webhook (`/api/webhooks/zapi/<segredo>`), comparado em
--    tempo constante. Está registrado aqui, e não só no código, porque quem for
--    revisar a segurança deste módulo vai procurar pela assinatura e precisa
--    encontrar a explicação de por que ela não existe. Ver docs/WHATSAPP.md §4.
--
-- 5. NENHUMA POLICY DE ESCRITA. EM NENHUMA DAS DUAS TABELAS.
--    Como em Associados: quem escreve é função `security definer`, e só. Uma
--    caixa de entrada é o lugar mais fácil de forjar — uma linha em
--    `whatsapp_messages` com `direction = 'inbound'` é uma frase que um
--    associado nunca disse, indistinguível da verdadeira.
--
-- 6. MÍDIA RECEBIDA VIRA ARQUIVO NOSSO.
--    A Z-API devolve a imagem/áudio/documento numa URL hospedada por ela, que
--    EXPIRA. Guardar só a URL produziria uma caixa de entrada que apodrece: as
--    conversas de dois meses atrás viram uma parede de anexos quebrados. O
--    servidor baixa o arquivo e o guarda no bucket privado `whatsapp-media`; a
--    URL do fornecedor fica registrada só como procedência.
--
-- 7. QUEM CASA O TELEFONE COM O CADASTRO É O SERVIDOR, NÃO ESTE ARQUIVO.
--    `find_contact_by_whatsapp` (migration 20260820000300) diz isso na primeira
--    linha: ela ESTREITA por 8 dígitos, não decide. A regra de número válido
--    mora em `src/lib/messaging/phone.ts` e não pode ter uma segunda cópia aqui
--    — dois números diferentes terminados nos mesmos 8 dígitos vinculariam a
--    conversa ao associado errado. Por isso `p_contact_id` chega PRONTO.
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Vocabulário
-- ----------------------------------------------------------------------------

-- De quem para quem. `outbound` é tudo que SAIU do número da APCS,
-- independentemente de quem apertou enviar (ver `whatsapp_message_origin`).
create type public.whatsapp_direction as enum ('inbound', 'outbound');

-- O que a mensagem é. `unsupported` é honesto de propósito: o WhatsApp inventa
-- tipo novo (enquete, evento, figurinha animada) sem avisar ninguém, e a caixa
-- precisa mostrar "chegou algo que não sei exibir" em vez de engolir a linha.
create type public.whatsapp_message_kind as enum (
  'text',
  'image',
  'audio',
  'video',
  'document',
  'sticker',
  'location',
  'contact',
  'unsupported'
);

-- A escala de entrega. É ORDENADA, e a ordem é o que torna o webhook de status
-- idempotente (ver a decisão 3).
create type public.whatsapp_delivery_status as enum (
  'pending',
  'sent',
  'delivered',
  'read',
  'failed'
);

-- QUEM produziu a mensagem. Distingue as três origens de uma mensagem que sai:
-- o atendente clicando na tela, o bot respondendo sozinho e alguém digitando no
-- celular. Sem isso, "o sistema mandou" e "a Ana mandou" viram a mesma linha.
create type public.whatsapp_message_origin as enum (
  'contact', -- a pessoa do outro lado
  'agent',   -- alguém do time, pelo CRM
  'bot',     -- automação (enquete, chatbot)
  'phone'    -- digitado direto no aparelho, fora do CRM
);

-- O ciclo do anexo. Nulo = a mensagem não tem anexo nenhum.
create type public.whatsapp_media_status as enum (
  'pending',     -- chegou, ainda não baixamos
  'stored',      -- está no nosso bucket
  'failed',      -- o download falhou; a URL de origem fica registrada
  'too_large',   -- acima do teto; recusado de propósito
  'unsupported'  -- tipo que este módulo não guarda
);

-- ----------------------------------------------------------------------------
-- 2. Quem pode o quê
-- ----------------------------------------------------------------------------
-- Definidas ANTES das tabelas porque as policies da seção 5 as chamam, e uma
-- policy só é criada se a função já existir.
--
-- ⚠️ As duas listas são IGUAIS hoje, e são duas funções assim mesmo.
-- Em Documentos, Eventos, Bolsa, Palestras e Associados quem atende só LÊ,
-- porque publicar uma normativa é decisão de quem responde pela norma. Aqui
-- não: responder a mensagem de um associado É o trabalho do Atendente. Separar
-- as funções é o que permite, um dia, restringir quem responde sem mexer em
-- quem lê — e o contrário.
--
-- Devem bater com `whatsapp.read` / `whatsapp.write` em rbac.config.ts.

create or replace function public.whatsapp_is_reader()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Sem a válvula de `auth.uid() is null`, e de propósito: a assimetria de
  -- Enquetes e Associados — função DEFINER que DEVOLVE DADO recusa chamada sem
  -- sessão. O `coalesce` fecha o buraco do papel nulo (perfil recém-criado):
  -- `null in (...)` é NULL, e NULL numa policy `using` não é `false` por acaso,
  -- é `false` por sorte.
  select coalesce((select public.current_app_role()) in ('admin', 'ceo', 'comercial'), false);
$$;

comment on function public.whatsapp_is_reader() is
  'Pode ler a caixa de entrada do WhatsApp (Administrador, Gestor e Atendente).';

create or replace function public.whatsapp_is_writer()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select public.current_app_role()) in ('admin', 'ceo', 'comercial'), false)
    -- A válvula: sem `auth.uid()` não há perfil a consultar, e quem chega assim
    -- é o servidor (service_role, pelo webhook) ou o dono do banco. O visitante
    -- não chega — `anon` não tem EXECUTE em nada deste módulo (seção 13).
    or (select auth.uid()) is null;
$$;

comment on function public.whatsapp_is_writer() is
  'Pode responder e arquivar conversas (Administrador, Gestor e Atendente).';

-- ⚠️ ISTO É A IDEMPOTÊNCIA DO WEBHOOK DE STATUS (decisão 3).
--
-- O fornecedor manda `SENT`, depois `RECEIVED`, depois `READ` — e reentrega
-- qualquer um deles quantas vezes quiser, em qualquer ordem, porque a rede não
-- garante ordem nenhuma. Sem a escala, um `SENT` reentregue DEPOIS do `READ`
-- faria a mensagem lida voltar a "enviada" na tela do atendente.
create or replace function public.whatsapp_status_rank(p_status public.whatsapp_delivery_status)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'pending' then 0
    when 'sent' then 1
    when 'delivered' then 2
    when 'read' then 3
    -- 'failed' NÃO está na escala: ele não "avança", ele interrompe. O rank 0
    -- garante que nenhuma comparação de avanço o deixe passar por cima de uma
    -- entrega já confirmada — a regra dele é outra, na seção 9.
    when 'failed' then 0
  end;
$$;

-- O rótulo de uma mensagem sem texto, usado na prévia da lista. No banco porque
-- é a prévia que o banco monta — deixá-lo só na UI faria a lista mostrar linha
-- em branco para toda foto recebida.
create or replace function public.whatsapp_kind_label(p_kind public.whatsapp_message_kind)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'image' then 'Imagem'
    when 'audio' then 'Áudio'
    when 'video' then 'Vídeo'
    when 'document' then 'Documento'
    when 'sticker' then 'Figurinha'
    when 'location' then 'Localização'
    when 'contact' then 'Contato'
    when 'unsupported' then 'Mensagem não suportada'
    else ''
  end;
$$;

-- ----------------------------------------------------------------------------
-- 3. As conversas
-- ----------------------------------------------------------------------------
-- Uma linha por conversa do WhatsApp: um telefone, ou um grupo.
create table public.whatsapp_chats (
  id uuid primary key default gen_random_uuid(),

  -- Qual adaptador trouxe esta conversa. Fica na chave única junto com
  -- `chat_key` para que trocar de fornecedor não misture dois históricos
  -- (os ids de mensagem de fornecedores diferentes não se conversam).
  provider text not null,

  -- O identificador da conversa NO FORNECEDOR: o telefone em E.164 para uma
  -- conversa individual, o id do grupo para um grupo.
  chat_key text not null,

  -- Só dígitos, E.164. Nulo em grupo.
  phone text,
  is_group boolean not null default false,

  -- Como o WhatsApp chama esta conversa. É o que a pessoa configurou no perfil
  -- dela, não um cadastro nosso — pode mudar sozinho e pode ser inútil.
  name text,
  photo_url text,

  -- ⚠️ O VÍNCULO É OPCIONAL, e vai continuar sendo.
  -- Quem manda mensagem para a APCS na maioria das vezes não está em cadastro
  -- nenhum. Exigir contato conhecido faria a caixa recusar exatamente as
  -- conversas que mais precisam aparecer: as de quem ainda não é ninguém aqui.
  contact_id uuid references public.chat_contacts on delete set null,
  member_id uuid references public.members on delete set null,

  -- Quantas mensagens da PESSOA ninguém leu ainda no CRM. Denormalizado porque
  -- a lista mostra o número em toda linha, e contá-lo por conversa a cada
  -- carregamento é uma varredura da tabela de mensagens inteira por tela.
  unread_count integer not null default 0,
  archived boolean not null default false,

  -- A prévia da lista. Mesma razão: sem ela, desenhar a lista exigiria buscar a
  -- última mensagem de cada conversa — o problema de N+1 mais clássico que
  -- existe, e numa tela que se atualiza sozinha.
  last_message_at timestamptz,
  last_message_preview text,
  last_message_from_me boolean,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint whatsapp_chats_key_unique unique (provider, chat_key),
  constraint whatsapp_chats_unread_non_negative check (unread_count >= 0)
);

comment on table public.whatsapp_chats is
  'Uma conversa de WhatsApp do número da APCS. O vínculo com contato/associado é opcional de propósito.';

comment on column public.whatsapp_chats.unread_count is
  'Mensagens da pessoa ainda não lidas NO CRM. Não tem relação com o "lido" do aparelho.';

-- A lista da tela: não arquivadas, mais recentes primeiro.
create index whatsapp_chats_inbox_idx
  on public.whatsapp_chats (archived, last_message_at desc nulls last);

-- O contador do menu, que roda em TODA tela do sistema. Índice parcial: ele
-- indexa só as conversas que têm o que contar, que são a minoria.
create index whatsapp_chats_unread_idx
  on public.whatsapp_chats (unread_count)
  where unread_count > 0;

create index whatsapp_chats_contact_idx
  on public.whatsapp_chats (contact_id)
  where contact_id is not null;

-- ----------------------------------------------------------------------------
-- 4. As mensagens
-- ----------------------------------------------------------------------------
create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),

  -- ORDEM DA CONVERSA. Pelo mesmo motivo de `chat_messages.seq`: `occurred_at`
  -- vem do fornecedor e chega com granularidade de segundo, então duas
  -- mensagens seguidas empatam e a ordem sai indefinida. `seq` é monotônico.
  seq bigint generated always as identity,

  chat_id uuid not null references public.whatsapp_chats on delete cascade,

  provider text not null,
  -- O id da mensagem NO WHATSAPP. Nulo enquanto a mensagem que estamos mandando
  -- ainda não foi aceita pelo fornecedor — é justamente o estado `pending`.
  provider_message_id text,

  direction public.whatsapp_direction not null,
  origin public.whatsapp_message_origin not null,
  kind public.whatsapp_message_kind not null default 'text',

  -- O texto. Em anexo com legenda, é a legenda; em localização, o endereço; em
  -- contato, o nome. Vazio quando não há nada a escrever.
  body text not null default '',

  -- Quem falou, como o WhatsApp informou. Em grupo é indispensável: sem ele a
  -- conversa vira um monólogo de doze pessoas.
  sender_name text,
  participant_phone text,

  -- §6 de Enquetes: o id da mensagem CITADA quando alguém usa "responder".
  reply_to_provider_message_id text,

  media_status public.whatsapp_media_status,
  -- A URL do fornecedor. EFÊMERA — fica como procedência, nunca como fonte.
  media_url text,
  -- O caminho no bucket privado. É daqui que a tela lê.
  media_path text,
  media_mime text,
  media_file_name text,
  media_size_bytes bigint,
  media_duration_seconds integer,

  status public.whatsapp_delivery_status not null default 'pending',
  error_message text,

  -- Quem clicou em enviar, quando saiu do CRM. Nulo no resto.
  sent_by uuid references public.profiles on delete set null,

  -- Quando aconteceu SEGUNDO O WHATSAPP. Diferente de `created_at`, que é
  -- quando nós soubemos: o webhook pode chegar minutos depois.
  occurred_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,

  created_at timestamptz not null default now(),

  -- Uma mensagem de texto sem texto é uma linha fantasma na conversa: aparece,
  -- ocupa espaço e não diz nada. As de anexo podem ter corpo vazio.
  constraint whatsapp_messages_text_has_body check (kind <> 'text' or body <> ''),
  -- Coerência entre o anexo e o tipo: `stored` sem caminho seria uma tela
  -- tentando exibir um arquivo que não existe.
  constraint whatsapp_messages_stored_has_path
    check (media_status is distinct from 'stored' or media_path is not null)
);

comment on table public.whatsapp_messages is
  'Livro-razão do número: toda mensagem que entrou ou saiu, inclusive as automáticas e as digitadas no aparelho.';

comment on column public.whatsapp_messages.occurred_at is
  'Quando o WhatsApp diz que aconteceu. `created_at` é quando NÓS soubemos — o webhook atrasa.';

-- ⚠️ A IDEMPOTÊNCIA DO WEBHOOK, e ela é este índice.
-- Parcial porque a mensagem que ESTAMOS mandando ainda não tem id: sem o
-- `where`, duas mensagens saindo ao mesmo tempo colidiriam em `null`.
create unique index whatsapp_messages_provider_id_idx
  on public.whatsapp_messages (provider, provider_message_id)
  where provider_message_id is not null;

create index whatsapp_messages_chat_idx
  on public.whatsapp_messages (chat_id, seq desc);

-- Reconciliação: achar as que saíram e nunca receberam confirmação.
create index whatsapp_messages_pending_idx
  on public.whatsapp_messages (status, created_at)
  where direction = 'outbound' and status in ('pending', 'sent');

-- Fila de download de anexo, para quem for reprocessar o que falhou.
create index whatsapp_messages_media_idx
  on public.whatsapp_messages (media_status)
  where media_status in ('pending', 'failed');

-- ----------------------------------------------------------------------------
-- 5. Row Level Security
-- ----------------------------------------------------------------------------
-- Deny-by-default + LEITURA para quem atende. Escrita: nenhuma policy, nunca
-- (decisão 5). O `revoke` depois das policies é a segunda tranca — sem ele, um
-- `grant` amplo criado no futuro reabriria a porta em silêncio.

alter table public.whatsapp_chats enable row level security;
alter table public.whatsapp_messages enable row level security;

-- Envolvido em `(select ...)` para o Postgres tratar a chamada como InitPlan e
-- avaliá-la UMA vez por consulta, e não uma vez por linha. Mesma correção da
-- migration 20260818000000.
create policy "whatsapp_chats_select"
  on public.whatsapp_chats for select
  using ((select public.whatsapp_is_reader()));

create policy "whatsapp_messages_select"
  on public.whatsapp_messages for select
  using ((select public.whatsapp_is_reader()));

revoke insert, update, delete on public.whatsapp_chats from authenticated, anon;
revoke insert, update, delete on public.whatsapp_messages from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 6. Ingestão: a mensagem que chega
-- ----------------------------------------------------------------------------
-- ⚠️ SEM BLOCO `exception` EM VOLTA DO INSERT.
--
-- Um handler de exceção no PL/pgSQL desfaz a subtransação do bloco INTEIRO — e
-- o `insert` na conversa, feito linhas antes, sumiria junto. Duplicata se
-- resolve com `on conflict do nothing` + um `select` depois, que é uma decisão
-- do índice e não um desvio de fluxo.
--
-- Chamada pelo webhook, com `service_role`. Ver a seção 13: `authenticated` e
-- `anon` não têm EXECUTE aqui.
create or replace function public.whatsapp_record_inbound_message(
  p_provider text,
  p_chat_key text,
  p_from_me boolean,
  p_provider_message_id text,
  p_body text,
  p_kind public.whatsapp_message_kind default 'text',
  p_phone text default null,
  p_is_group boolean default false,
  p_chat_name text default null,
  p_photo_url text default null,
  p_sender_name text default null,
  p_participant_phone text default null,
  p_reply_to text default null,
  p_contact_id uuid default null,
  p_media_status public.whatsapp_media_status default null,
  p_media_url text default null,
  p_media_mime text default null,
  p_media_file_name text default null,
  p_media_duration_seconds integer default null,
  p_occurred_at timestamptz default null
)
returns table (message_id uuid, chat_id uuid, duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chat_id uuid;
  v_message_id uuid;
  v_from_me boolean := coalesce(p_from_me, false);
  v_occurred timestamptz := coalesce(p_occurred_at, pg_catalog.now());
  v_provider_message_id text :=
    nullif(pg_catalog.btrim(coalesce(p_provider_message_id, '')), '');
  v_preview text;
begin
  if not public.whatsapp_is_writer() then
    raise exception 'Sem permissão para gravar mensagens de WhatsApp.' using errcode = '42501';
  end if;

  if coalesce(pg_catalog.btrim(coalesce(p_chat_key, '')), '') = '' then
    raise exception 'Mensagem sem identificação de conversa.' using errcode = 'WA003';
  end if;

  -- A conversa. `on conflict` porque a primeira mensagem de um número novo e a
  -- décima do mesmo número entram pelo mesmo caminho — e duas mensagens
  -- chegando juntas de um número novo entrariam em corrida sem isto.
  --
  -- `coalesce(excluded.x, whatsapp_chats.x)`: o fornecedor às vezes manda o
  -- nome e às vezes não. Sobrescrever com nulo apagaria o que já sabíamos.
  --
  -- ⚠️ `contact_id` é o INVERSO: `coalesce(whatsapp_chats.contact_id, ...)`.
  -- O vínculo já existente vence o que o servidor sugeriu agora. Alguém pode
  -- tê-lo corrigido à mão, e uma heurística não desfaz uma correção humana.
  insert into public.whatsapp_chats (
    provider, chat_key, phone, is_group, name, photo_url, contact_id
  )
  values (
    p_provider,
    pg_catalog.btrim(p_chat_key),
    nullif(pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), ''),
    coalesce(p_is_group, false),
    nullif(pg_catalog.btrim(coalesce(p_chat_name, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_photo_url, '')), ''),
    p_contact_id
  )
  on conflict (provider, chat_key) do update
    set name = coalesce(excluded.name, whatsapp_chats.name),
        photo_url = coalesce(excluded.photo_url, whatsapp_chats.photo_url),
        phone = coalesce(excluded.phone, whatsapp_chats.phone),
        contact_id = coalesce(whatsapp_chats.contact_id, excluded.contact_id),
        updated_at = pg_catalog.now()
  returning id into v_chat_id;

  -- A mensagem. O índice único parcial é quem recusa a reentrega.
  insert into public.whatsapp_messages (
    chat_id, provider, provider_message_id, direction, origin, kind, body,
    sender_name, participant_phone, reply_to_provider_message_id,
    media_status, media_url, media_mime, media_file_name, media_duration_seconds,
    status, occurred_at
  )
  values (
    v_chat_id,
    p_provider,
    v_provider_message_id,
    case when v_from_me then 'outbound' else 'inbound' end::public.whatsapp_direction,
    -- ⚠️ `phone`, e não `bot`, para tudo que sai sem passar por aqui.
    -- Uma mensagem que o fornecedor nos conta que saiu pode ter vindo do
    -- aparelho OU de uma automação nossa; do lado de fora elas são idênticas.
    -- As nossas já entraram por `whatsapp_start_outbound_message` com a origem
    -- certa e voltam aqui como duplicata, que esta função descarta. Sobra o que
    -- realmente veio do aparelho.
    case when v_from_me then 'phone' else 'contact' end::public.whatsapp_message_origin,
    coalesce(p_kind, 'text'::public.whatsapp_message_kind),
    coalesce(p_body, ''),
    nullif(pg_catalog.btrim(coalesce(p_sender_name, '')), ''),
    nullif(
      pg_catalog.regexp_replace(coalesce(p_participant_phone, ''), '[^0-9]', '', 'g'), ''
    ),
    nullif(pg_catalog.btrim(coalesce(p_reply_to, '')), ''),
    p_media_status,
    nullif(pg_catalog.btrim(coalesce(p_media_url, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_media_mime, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_media_file_name, '')), ''),
    p_media_duration_seconds,
    -- Quem MANDOU para nós já entregou; quem SAIU daqui sem nosso registro já
    -- saiu. Nos dois casos `pending` seria mentira.
    case when v_from_me then 'sent' else 'delivered' end::public.whatsapp_delivery_status,
    v_occurred
  )
  on conflict (provider, provider_message_id) where provider_message_id is not null
  do nothing
  returning id into v_message_id;

  if v_message_id is null then
    -- Reentrega. Devolve o id de quem já está gravado para que o chamador
    -- consiga, por exemplo, achar o anexo que ficou pendente na primeira volta.
    select m.id into v_message_id
    from public.whatsapp_messages m
    where m.provider = p_provider
      and m.provider_message_id = v_provider_message_id;

    return query select v_message_id, v_chat_id, true;
    return;
  end if;

  -- A prévia da lista. Cortada aqui, e não na tela: a lista lê dezenas de
  -- conversas por vez e não tem por que trazer o texto inteiro de cada uma.
  v_preview := pg_catalog.left(
    pg_catalog.btrim(
      coalesce(
        nullif(pg_catalog.btrim(coalesce(p_body, '')), ''),
        public.whatsapp_kind_label(coalesce(p_kind, 'text'::public.whatsapp_message_kind))
      )
    ),
    140
  );

  update public.whatsapp_chats
  set last_message_at = v_occurred,
      last_message_preview = v_preview,
      last_message_from_me = v_from_me,
      -- Só o que a PESSOA manda conta como não lido. O que sai do aparelho não
      -- é trabalho de ninguém no CRM — pelo contrário, é trabalho já feito.
      unread_count = case when v_from_me then 0 else unread_count + 1 end,
      -- Mensagem nova desarquiva: alguém escrevendo de novo é exatamente o
      -- motivo pelo qual a conversa volta a precisar de atenção.
      archived = case when v_from_me then archived else false end,
      updated_at = pg_catalog.now()
  where id = v_chat_id;

  return query select v_message_id, v_chat_id, false;
end;
$$;

comment on function public.whatsapp_record_inbound_message is
  'Grava no livro-razão o que o webhook trouxe. Reentrega vira `duplicate = true` pelo índice único.';

-- ----------------------------------------------------------------------------
-- 7. Ingestão: o aviso de entrega e leitura
-- ----------------------------------------------------------------------------
create or replace function public.whatsapp_mark_message_status(
  p_provider text,
  p_provider_message_id text,
  p_status public.whatsapp_delivery_status,
  p_error text default null,
  p_occurred_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_occurred_at, pg_catalog.now());
  v_id uuid;
begin
  if not public.whatsapp_is_writer() then
    raise exception 'Sem permissão para atualizar mensagens de WhatsApp.' using errcode = '42501';
  end if;

  update public.whatsapp_messages m
  set status = p_status,
      delivered_at = case
        when p_status in ('delivered', 'read') then coalesce(m.delivered_at, v_at)
        else m.delivered_at
      end,
      read_at = case when p_status = 'read' then coalesce(m.read_at, v_at) else m.read_at end,
      error_message = case when p_status = 'failed' then p_error else m.error_message end
  where m.provider = p_provider
    and m.provider_message_id = p_provider_message_id
    and (
      -- Só AVANÇA. Ver a decisão 3 e `whatsapp_status_rank`.
      (p_status <> 'failed'
        and public.whatsapp_status_rank(p_status) > public.whatsapp_status_rank(m.status))
      -- Falha só entra enquanto ninguém confirmou entrega: um "falhou"
      -- atrasado não pode apagar um "entregue" que já é fato.
      or (p_status = 'failed' and m.status in ('pending', 'sent'))
    )
  returning m.id into v_id;

  -- `false` NÃO é erro: é o caso normal de reentrega, e é o caso de um aviso
  -- sobre uma mensagem que não é nossa (a Z-API notifica o número inteiro).
  return v_id is not null;
end;
$$;

comment on function public.whatsapp_mark_message_status is
  'Sobe a mensagem na escala de entrega. Reentrega e aviso de mensagem alheia devolvem false, não erro.';

-- ----------------------------------------------------------------------------
-- 8. O anexo baixado
-- ----------------------------------------------------------------------------
create or replace function public.whatsapp_set_media(
  p_message_id uuid,
  p_status public.whatsapp_media_status,
  p_path text default null,
  p_mime text default null,
  p_size_bytes bigint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.whatsapp_is_writer() then
    raise exception 'Sem permissão para atualizar anexos de WhatsApp.' using errcode = '42501';
  end if;

  update public.whatsapp_messages
  set media_status = p_status,
      media_path = coalesce(nullif(pg_catalog.btrim(coalesce(p_path, '')), ''), media_path),
      media_mime = coalesce(nullif(pg_catalog.btrim(coalesce(p_mime, '')), ''), media_mime),
      media_size_bytes = coalesce(p_size_bytes, media_size_bytes)
  where id = p_message_id;
end;
$$;

comment on function public.whatsapp_set_media is
  'Registra o desfecho do download do anexo. Chamada pelo servidor depois de gravar no bucket.';

-- ----------------------------------------------------------------------------
-- 9. A resposta do atendente
-- ----------------------------------------------------------------------------
-- ⚠️ DUAS FUNÇÕES, E NÃO UMA, E O MOTIVO É O QUE ACONTECE NO MEIO.
--
-- Entre "o atendente clicou enviar" e "o fornecedor aceitou" existe uma chamada
-- HTTP que pode demorar 15 segundos, falhar, ou ter sucesso sem que a resposta
-- chegue de volta. Se a linha só fosse gravada DEPOIS, uma mensagem entregue
-- numa chamada cuja resposta se perdeu sumiria do CRM — e o atendente a
-- mandaria de novo, para um associado que já a recebeu. A linha nasce ANTES,
-- em `pending`, e é liquidada depois.
create or replace function public.whatsapp_start_outbound_message(
  p_chat_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_texto text := pg_catalog.btrim(coalesce(p_body, ''));
  v_provider text;
begin
  if not public.whatsapp_is_writer() then
    raise exception 'Sem permissão para responder no WhatsApp.' using errcode = '42501';
  end if;

  if v_texto = '' then
    raise exception 'Escreva a mensagem antes de enviar.' using errcode = 'WA002';
  end if;

  select c.provider into v_provider from public.whatsapp_chats c where c.id = p_chat_id;
  if v_provider is null then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;

  insert into public.whatsapp_messages (
    chat_id, provider, direction, origin, kind, body, status, sent_by, occurred_at
  )
  values (
    p_chat_id, v_provider, 'outbound'::public.whatsapp_direction,
    'agent'::public.whatsapp_message_origin, 'text'::public.whatsapp_message_kind, v_texto,
    'pending'::public.whatsapp_delivery_status,
    (select auth.uid()), pg_catalog.now()
  )
  returning id into v_id;

  update public.whatsapp_chats
  set last_message_at = pg_catalog.now(),
      last_message_preview = pg_catalog.left(v_texto, 140),
      last_message_from_me = true,
      -- Responder é ler. Sem isto o contador do menu ficaria aceso depois de o
      -- atendente ter respondido — que é o momento em que ele mais claramente
      -- não tem mais nada a fazer ali.
      unread_count = 0,
      updated_at = pg_catalog.now()
  where id = p_chat_id;

  return v_id;
end;
$$;

comment on function public.whatsapp_start_outbound_message is
  'Cria a mensagem em `pending` ANTES da chamada ao fornecedor. Ver o comentário da seção 9.';

create or replace function public.whatsapp_settle_outbound_message(
  p_message_id uuid,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_message_id text :=
    nullif(pg_catalog.btrim(coalesce(p_provider_message_id, '')), '');
begin
  if not public.whatsapp_is_writer() then
    raise exception 'Sem permissão para responder no WhatsApp.' using errcode = '42501';
  end if;

  update public.whatsapp_messages
  set provider_message_id = coalesce(v_provider_message_id, provider_message_id),
      status = case when v_provider_message_id is not null then 'sent' else 'failed' end::public.whatsapp_delivery_status,
      error_message = p_error
  where id = p_message_id
    -- Só liquida o que ainda está pendente: o webhook de entrega pode chegar
    -- ANTES de a resposta HTTP do envio voltar (acontece, e é rápido), e nesse
    -- caso a mensagem já está em `delivered` — voltá-la para `sent` seria a
    -- tela andando para trás.
    and status = 'pending';
end;
$$;

comment on function public.whatsapp_settle_outbound_message is
  'Fecha o envio: id do fornecedor vira `sent`, ausência dele vira `failed`. Só age sobre `pending`.';

-- ----------------------------------------------------------------------------
-- 10. Gestão da conversa
-- ----------------------------------------------------------------------------
create or replace function public.whatsapp_mark_chat_read(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.whatsapp_is_writer() then
    raise exception 'Sem permissão para alterar conversas de WhatsApp.' using errcode = '42501';
  end if;

  update public.whatsapp_chats
  set unread_count = 0, updated_at = pg_catalog.now()
  where id = p_chat_id and unread_count > 0;
end;
$$;

create or replace function public.whatsapp_set_chat_archived(p_chat_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.whatsapp_is_writer() then
    raise exception 'Sem permissão para alterar conversas de WhatsApp.' using errcode = '42501';
  end if;

  update public.whatsapp_chats
  set archived = coalesce(p_archived, false), updated_at = pg_catalog.now()
  where id = p_chat_id;

  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 11. Contador do menu
-- ----------------------------------------------------------------------------
-- Roda em TODA tela do sistema (o layout apura os contadores da navegação), por
-- isso é uma função e não uma consulta montada no cliente: assim ela usa o
-- índice parcial `whatsapp_chats_unread_idx` e devolve um número só.
create or replace function public.whatsapp_unread_total()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.whatsapp_is_reader()
      then coalesce(
        (select pg_catalog.count(*) from public.whatsapp_chats
          where unread_count > 0 and archived = false), 0
      )::integer
    -- Quem não pode ver a caixa recebe zero, e não erro: um contador é
    -- informação ("há 12 conversas em aberto") e não deve vazar para quem não
    -- pode abrir a tela.
    else 0
  end;
$$;

comment on function public.whatsapp_unread_total() is
  'Quantas conversas têm mensagem não lida. Devolve 0 para quem não pode ler a caixa.';

-- ----------------------------------------------------------------------------
-- 12. O bucket dos anexos
-- ----------------------------------------------------------------------------
-- PRIVADO. Uma foto que um associado mandou para a APCS não pode estar numa URL
-- adivinhável — e o conteúdo aqui é o menos previsível do sistema: documento
-- pessoal, foto de granja, áudio de reclamação.
--
-- `allowed_mime_types` não é declarado: o WhatsApp aceita praticamente tudo, e
-- uma lista fechada faria o anexo de um associado sumir em silêncio. O teto de
-- tamanho (20 MB) é a barreira que sobra caso alguém escreva no bucket sem
-- passar pela aplicação.
insert into storage.buckets (id, name, public, file_size_limit)
values ('whatsapp-media', 'whatsapp-media', false, 20971520)
on conflict (id) do nothing;

-- Só leitura, e só para quem atende. INSERT e DELETE não têm policy: quem grava
-- é o servidor com `service_role`, que ignora RLS. Uma policy de INSERT aqui
-- deixaria um usuário logado plantar um arquivo no meio de uma conversa.
create policy "whatsapp_media_bucket_select"
  on storage.objects for select
  using (
    bucket_id = 'whatsapp-media'
    and (select public.whatsapp_is_reader())
  );

-- ----------------------------------------------------------------------------
-- 13. Privilégios de execução
-- ----------------------------------------------------------------------------
-- ⚠️ POR QUE CADA `revoke` ABAIXO É NECESSÁRIO.
--
-- O Supabase declara `alter default privileges ... grant execute on functions
-- to anon, authenticated, service_role` no schema `public`. Ou seja: TODA
-- função nova nasce executável por `anon` — inclusive as `security definer`,
-- que é a combinação mais perigosa possível. Revogar não é excesso de zelo: é
-- desfazer um `grant` que o Supabase deu sem ninguém pedir.

-- As de ingestão: só o servidor, pelo webhook.
revoke execute on function public.whatsapp_record_inbound_message(
  text, text, boolean, text, text, public.whatsapp_message_kind, text, boolean, text, text,
  text, text, text, uuid, public.whatsapp_media_status, text, text, text, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.whatsapp_record_inbound_message(
  text, text, boolean, text, text, public.whatsapp_message_kind, text, boolean, text, text,
  text, text, text, uuid, public.whatsapp_media_status, text, text, text, integer, timestamptz
) to service_role;

revoke execute on function public.whatsapp_mark_message_status(
  text, text, public.whatsapp_delivery_status, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.whatsapp_mark_message_status(
  text, text, public.whatsapp_delivery_status, text, timestamptz
) to service_role;

revoke execute on function public.whatsapp_set_media(
  uuid, public.whatsapp_media_status, text, text, bigint
) from public, anon, authenticated;
grant execute on function public.whatsapp_set_media(
  uuid, public.whatsapp_media_status, text, text, bigint
) to service_role;

-- As da tela: quem está logado chama, e a função confere o papel.
revoke execute on function public.whatsapp_start_outbound_message(uuid, text) from public, anon;
grant execute on function public.whatsapp_start_outbound_message(uuid, text) to authenticated;

revoke execute on function public.whatsapp_settle_outbound_message(uuid, text, text)
  from public, anon;
grant execute on function public.whatsapp_settle_outbound_message(uuid, text, text) to authenticated;

revoke execute on function public.whatsapp_mark_chat_read(uuid) from public, anon;
grant execute on function public.whatsapp_mark_chat_read(uuid) to authenticated;

revoke execute on function public.whatsapp_set_chat_archived(uuid, boolean) from public, anon;
grant execute on function public.whatsapp_set_chat_archived(uuid, boolean) to authenticated;

revoke execute on function public.whatsapp_unread_total() from public, anon;
grant execute on function public.whatsapp_unread_total() to authenticated;

-- As auxiliares: ninguém as chama de fora. `whatsapp_is_reader` é usada DENTRO
-- das policies, e uma policy roda com os privilégios do dono da tabela — não
-- precisa de grant para o usuário.
revoke execute on function public.whatsapp_is_reader() from public, anon, authenticated;
revoke execute on function public.whatsapp_is_writer() from public, anon, authenticated;
revoke execute on function public.whatsapp_status_rank(public.whatsapp_delivery_status)
  from public, anon, authenticated;
revoke execute on function public.whatsapp_kind_label(public.whatsapp_message_kind)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 14. Como desfazer
-- ----------------------------------------------------------------------------
-- Não há `down` automático (o Supabase CLI não tem migration reversível). Para
-- desfazer à mão, nesta ordem:
--
--   drop policy if exists "whatsapp_media_bucket_select" on storage.objects;
--   delete from storage.objects where bucket_id = 'whatsapp-media';
--   delete from storage.buckets where id = 'whatsapp-media';
--   drop table if exists public.whatsapp_messages;
--   drop table if exists public.whatsapp_chats;
--   drop function if exists public.whatsapp_record_inbound_message;
--   drop function if exists public.whatsapp_mark_message_status;
--   drop function if exists public.whatsapp_set_media;
--   drop function if exists public.whatsapp_start_outbound_message;
--   drop function if exists public.whatsapp_settle_outbound_message;
--   drop function if exists public.whatsapp_mark_chat_read;
--   drop function if exists public.whatsapp_set_chat_archived;
--   drop function if exists public.whatsapp_unread_total;
--   drop function if exists public.whatsapp_kind_label;
--   drop function if exists public.whatsapp_status_rank;
--   drop function if exists public.whatsapp_is_writer;
--   drop function if exists public.whatsapp_is_reader;
--   drop type if exists public.whatsapp_media_status;
--   drop type if exists public.whatsapp_message_origin;
--   drop type if exists public.whatsapp_delivery_status;
--   drop type if exists public.whatsapp_message_kind;
--   drop type if exists public.whatsapp_direction;
--
-- ⚠️ Isso APAGA a caixa de entrada inteira — as conversas não existem em outro
-- lugar do sistema. Exporte antes.
-- ============================================================================
