-- ============================================================================
-- OPERAÇÃO DO ROBÔ — governança, custo, limite de uso e as métricas
-- ============================================================================
--
-- As três etapas anteriores construíram o que o robô FAZ. Esta constrói o que
-- se pergunta sobre ele depois que ele está no ar:
--
--   "ele está entendendo as pessoas?"        as métricas de intenção
--   "o que estão perguntando e não temos?"   as perguntas sem resposta
--   "quanto isso está custando?"             modelo e tokens por turno
--   "de onde saiu esta resposta?"            a origem, por turno
--   "como eu desligo isso agora?"            a chave geral
--   "e se alguém resolver abusar?"           o limite de uso
--
-- ----------------------------------------------------------------------------
-- ⚠️ NENHUMA TABELA NOVA, E É O PONTO
-- ----------------------------------------------------------------------------
-- Tudo aqui são COLUNAS em `intelligence_interactions`, VIEWS sobre ela, e uma
-- função de contagem. A trilha já existe e já é a linha-por-turno; um "fato de
-- métrica" separado seria a mesma informação num segundo lugar, com outro ciclo
-- de vida e liberdade para divergir da primeira.
--
-- DEPENDE DE: 20260914000200_intelligence.sql,
--             20260915000000_whatsapp_bot.sql
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Custo e governança do modelo (§78, §80)
-- ----------------------------------------------------------------------------
alter table public.intelligence_interactions
  add column if not exists model text,
  add column if not exists prompt_version text,
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer;

comment on column public.intelligence_interactions.model is
  'O modelo que classificou este turno. Null quando o turno nao passou pelo modelo.';
comment on column public.intelligence_interactions.prompt_version is
  'Versao do prompt de sistema em uso. Sem isto, uma mudanca de prompt nao e atribuivel.';

-- ⚠️ NULO NÃO É ZERO, e a diferença é o que torna a conta de custo confiável.
-- Um turno lido sem modelo (um "sim", uma escolha de menu) tem `model` nulo, e
-- não deve entrar na média de tokens como se tivesse custado zero — ele
-- simplesmente não aconteceu ali. Ver as views da seção 5.
alter table public.intelligence_interactions
  drop constraint if exists intelligence_interactions_tokens_range;
alter table public.intelligence_interactions
  add constraint intelligence_interactions_tokens_range check (
    (input_tokens is null or input_tokens >= 0)
    and (output_tokens is null or output_tokens >= 0)
  );


-- ----------------------------------------------------------------------------
-- 2. A origem da resposta (§17, §32, §33)
-- ----------------------------------------------------------------------------
-- "De onde saiu isto?" é a pergunta que uma trilha de IA precisa responder, e
-- `tool` sozinho não responde: ele diz que foi uma normativa, não QUAL.
--
-- ⚠️ NÃO É UMA CHAVE ESTRANGEIRA, e a escolha é deliberada. As origens moram em
-- quatro tabelas diferentes (`knowledge_entries`, `documents`,
-- `market_bulletins`, `events`), e quatro colunas anuláveis com quatro FKs
-- seriam quatro `null` em toda linha para o benefício de uma integridade que a
-- trilha não quer: se um documento for apagado, o registro de que ele foi
-- enviado tem de sobreviver — é justamente aí que ele importa.
alter table public.intelligence_interactions
  add column if not exists source_type text,
  add column if not exists source_id uuid;

alter table public.intelligence_interactions
  drop constraint if exists intelligence_interactions_source_pair;
alter table public.intelligence_interactions
  add constraint intelligence_interactions_source_pair check (
    (source_type is null and source_id is null)
    or (
      source_type in ('knowledge', 'document', 'market_bulletin', 'event')
      and source_id is not null
    )
  );

comment on column public.intelligence_interactions.source_type is
  'De qual modulo saiu a resposta. Sem FK de proposito: a trilha sobrevive ao que ela audita.';

create index if not exists intelligence_interactions_source_idx
  on public.intelligence_interactions (source_type, source_id)
  where source_type is not null;


-- ----------------------------------------------------------------------------
-- 3. O menu de emergência (§46)
-- ----------------------------------------------------------------------------
-- Quando o modelo está fora do ar, o robô oferece um menu numerado. A escolha
-- ("2") é lida SEM modelo — mas só vale como escolha se um menu tiver sido
-- mostrado, e é isto que esta coluna guarda.
--
-- ⚠️ SEM ELA, TODO "2" VIRARIA ESCOLHA DE MENU. Um associado que escreve "2"
-- respondendo outra coisa receberia a Normativa do nada; e o pior caso não é o
-- engano, é o silêncio de quem desiste depois dele.
alter table public.conversation_context
  add column if not exists menu_shown_at timestamptz;

comment on column public.conversation_context.menu_shown_at is
  'Quando o menu de emergencia foi mostrado. So dentro da validade um numero conta como escolha.';


-- ----------------------------------------------------------------------------
-- 4. Limite de uso (§39)
-- ----------------------------------------------------------------------------
-- ⚠️ POR QUE O LIMITE NÃO É UM CONTADOR EM MEMÓRIA. O app roda em serverless:
-- duas instâncias não compartilham memória, e um contador local viraria um
-- limite por instância — ou seja, nenhum. É a mesma conclusão de
-- `src/lib/chat/rate-limit.ts`, e pelo mesmo motivo.
--
-- ⚠️ E POR QUE SÃO DOIS NÚMEROS. Eles defendem coisas diferentes:
--
--   por minuto   o rajada — alguém colando trinta mensagens de uma vez
--   por hora     o custo — o modelo é pago por chamada, e um laço de duas
--                horas com uma automação do outro lado é uma conta inesperada
--
-- Um só não cobre: um limite por minuto generoso o bastante para uma conversa
-- normal ainda permite 360 chamadas por hora.
create or replace function public.whatsapp_bot_rate_ok(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- Rajada: mensagens que a PESSOA mandou no último minuto.
    (
      select pg_catalog.count(*)
      from public.whatsapp_messages m
      where m.chat_id = p_chat_id
        and m.direction = 'inbound'
        and m.occurred_at > pg_catalog.now() - interval '1 minute'
    ) <= 6
    and
    -- Custo: turnos que o ROBÔ processou nesta conversa na última hora. Conta
    -- respostas, e não mensagens recebidas — é o que gasta.
    (
      select pg_catalog.count(*)
      from public.intelligence_interactions i
      where i.whatsapp_chat_id = p_chat_id
        and i.created_at > pg_catalog.now() - interval '1 hour'
    ) < 40;
$$;

comment on function public.whatsapp_bot_rate_ok is
  'Limite de uso do robo por conversa: 6 mensagens/minuto (rajada) e 40 turnos/hora (custo).';

-- O Supabase concede EXECUTE a `anon` em toda função nova do schema `public`,
-- inclusive `security definer`. Esta lê `whatsapp_messages` — revogar não é
-- zelo, é desfazer um grant que ninguém pediu. Ver a seção 13 de 20260822000000.
revoke execute on function public.whatsapp_bot_rate_ok(uuid)
  from public, anon, authenticated;
grant execute on function public.whatsapp_bot_rate_ok(uuid) to service_role;

-- ⚠️ ESTOURAR O LIMITE É FICAR CALADO, e não responder "voce esta indo rapido
-- demais". Duas razões: quem manda sete mensagens num minuto não está esperando
-- resposta, e uma frase automática de repreensão a um associado é pior que o
-- silêncio. A conversa continua acesa na aba "Nao lidas", que é onde uma pessoa
-- a vê. Ver `intelligence-inbox.ts`.


-- ----------------------------------------------------------------------------
-- 5. As métricas (§34, §35, §36, §37, §76)
-- ----------------------------------------------------------------------------
-- ⚠️ `security_invoker = true` EM TODAS. Sem isso, uma view no Postgres roda com
-- os privilégios de quem a CRIOU — o dono do banco —, e a RLS de
-- `intelligence_interactions` (só `is_admin()`) seria contornada por qualquer
-- pessoa autenticada que soubesse o nome da view. Com invoker, a view herda a
-- policy da tabela e não há segunda porta.

/**
 * O painel do dia a dia. Uma linha por dia, no fuso da APCS.
 */
create or replace view public.intelligence_daily_metrics
with (security_invoker = true) as
select
  (i.created_at at time zone 'America/Sao_Paulo')::date as dia,
  pg_catalog.count(*) as turnos,
  pg_catalog.count(distinct i.whatsapp_chat_id) as conversas,

  -- §36 e §37: as duas taxas que dizem o que fazer a seguir. Muito
  -- `desconhecido` é intenção faltando; muito `handoff` é conhecimento faltando.
  pg_catalog.count(*) filter (where i.intent = 'desconhecido') as desconhecidos,
  pg_catalog.count(*) filter (where i.outcome = 'handoff') as encaminhamentos,

  pg_catalog.count(*) filter (where i.outcome = 'tool_ok') as entregas,
  -- "Perguntou e a APCS não tinha o que mandar" — trabalho de quem publica.
  pg_catalog.count(*) filter (where i.outcome = 'tool_empty') as sem_conteudo,
  -- "Quebrou" — trabalho de quem cuida do sistema. Os dois separados de
  -- propósito: juntos, ninguém sabe para quem ligar.
  pg_catalog.count(*) filter (where i.outcome = 'tool_error') as erros,
  pg_catalog.count(*) filter (where i.outcome = 'confirmed') as confirmacoes,

  pg_catalog.avg(i.latency_ms)::integer as latencia_media_ms,
  pg_catalog.avg(i.confidence)::numeric(4, 3) as confianca_media,

  -- ⚠️ SÓ OS TURNOS QUE PASSARAM PELO MODELO. Um turno lido sem modelo custou
  -- zero, e somá-lo como zero puxaria a média para baixo — fazendo o custo por
  -- classificação parecer menor do que é.
  pg_catalog.count(*) filter (where i.model is not null) as turnos_com_modelo,
  pg_catalog.sum(i.input_tokens) as tokens_entrada,
  pg_catalog.sum(i.output_tokens) as tokens_saida
from public.intelligence_interactions i
group by 1;

comment on view public.intelligence_daily_metrics is
  'KPIs do robo por dia (§35). security_invoker: herda a RLS de intelligence_interactions.';

/**
 * O que as pessoas pedem, por intenção — os últimos 30 dias.
 */
create or replace view public.intelligence_intent_totals
with (security_invoker = true) as
select
  i.intent,
  pg_catalog.count(*) as turnos,
  pg_catalog.avg(i.confidence)::numeric(4, 3) as confianca_media,
  pg_catalog.count(*) filter (where i.outcome = 'tool_ok') as entregas,
  pg_catalog.count(*) filter (where i.outcome = 'tool_empty') as sem_conteudo,
  pg_catalog.count(*) filter (where i.outcome = 'tool_error') as erros
from public.intelligence_interactions i
where i.created_at > pg_catalog.now() - interval '30 days'
group by 1;

comment on view public.intelligence_intent_totals is
  'Distribuicao de intencoes nos ultimos 30 dias (§35).';

/**
 * §37. AS PERGUNTAS QUE O ROBÔ NÃO ENTENDEU — a lista mais útil daqui.
 *
 * É ela que vira entrada na Base de Conhecimento. Sem o TEXTO não há o que ler,
 * e o texto não está na trilha de propósito (§35 do escopo 1: a trilha não
 * duplica dado pessoal) — ele mora em `whatsapp_messages`, e é de lá que a view
 * o busca.
 *
 * ⚠️ QUEM VÊ ISTO JÁ VÊ A CONVERSA INTEIRA. A view não abre nada novo: ela pede
 * `is_admin()` (pela trilha) E o papel de leitura do WhatsApp (pela mensagem),
 * as duas policies valendo por causa do `security_invoker`. É estritamente mais
 * restrita que a caixa de entrada.
 */
create or replace view public.intelligence_unknown_questions
with (security_invoker = true) as
select
  i.id,
  i.created_at,
  i.whatsapp_chat_id,
  i.confidence,
  i.outcome,
  m.body as pergunta
from public.intelligence_interactions i
join public.whatsapp_messages m on m.id = i.whatsapp_message_id
where i.intent = 'desconhecido'
   or i.outcome = 'tool_empty';

comment on view public.intelligence_unknown_questions is
  'O que perguntaram e o robo nao respondeu. Vira entrada na Base de Conhecimento (§37).';


-- ----------------------------------------------------------------------------
-- 6. As frases novas e a chave geral (§46, §50, §51, §83)
-- ----------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  (
    -- §46. O menu que substitui a IA quando ela está fora do ar. Numerado
    -- porque a resposta a ele é lida SEM modelo — que é o único jeito de o
    -- fallback funcionar quando o modelo é justamente o que caiu.
    'chatbot.menu',
    E'Estou com uma limitação no atendimento automático agora. Posso ajudar por aqui:\n\n1 - Bolsa de Suínos\n2 - Normativas\n3 - Comunicação (ISP, revista, calendário)\n4 - Eventos\n5 - Falar com um atendente\n\nResponda com o número.'
  ),
  (
    -- §51. "Obrigado", "era isso". Antes disto caía em `fallback` — o robô
    -- respondia "não entendi" a quem estava agradecendo, que é a última
    -- impressão que a pessoa leva da conversa.
    'chatbot.closing',
    'De nada! Se precisar de mais alguma coisa, é só chamar. 👍'
  ),
  (
    -- §83. A CHAVE GERAL. Existe para que "desligar o robô agora" seja uma
    -- edição de texto e não um deploy — que é a diferença entre cinco minutos e
    -- meia hora no dia em que ele disser algo errado.
    --
    -- Só o valor exato `off` desliga. Qualquer outra coisa (inclusive lixo, ou a
    -- chave ausente) mantém ligado: a ausência da configuração precisa
    -- significar o comportamento de antes dela existir.
    'chatbot.enabled',
    'on'
  )
on conflict (key) do nothing;


-- ============================================================================
-- A CONFERÊNCIA
-- ----------------------------------------------------------------------------
-- ⚠️ ELA CONFERE O `security_invoker` DAS VIEWS, e é a checagem que mais
-- importa aqui. Uma view sem ele roda com os privilégios do DONO do banco — a
-- RLS de `intelligence_interactions` seria contornada por qualquer pessoa
-- autenticada que soubesse o nome da view, e nada no sistema acusaria.
--
-- O que ela NÃO faz é ler as tabelas: o papel do `supabase db push` não tem
-- privilégio nelas (ver 20260912000000).
-- ============================================================================
do $conferencia$
declare
  v_nome text;
  v_opcoes text[];
begin
  foreach v_nome in array array[
    'intelligence_daily_metrics',
    'intelligence_intent_totals',
    'intelligence_unknown_questions'
  ] loop
    select c.reloptions into v_opcoes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_nome and c.relkind = 'v';

    if v_opcoes is null or not ('security_invoker=true' = any(v_opcoes)) then
      raise exception
        'A view % nao tem security_invoker. Ela rodaria com os privilegios do dono do banco e contornaria a RLS da trilha.',
        v_nome;
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint where conname = 'intelligence_interactions_source_pair'
  ) then
    raise exception 'Falta o CHECK intelligence_interactions_source_pair.';
  end if;

  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.conversation_context'::regclass
      and attname = 'menu_shown_at' and not attisdropped
  ) then
    raise exception 'Falta conversation_context.menu_shown_at — todo numero viraria escolha de menu.';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role', 'public.whatsapp_bot_rate_ok(uuid)', 'EXECUTE'
  ) then
    raise exception 'service_role nao pode executar whatsapp_bot_rate_ok — o limite de uso nao valeria.';
  end if;

  raise notice 'Operacao do robo: custo, origem, menu, limite de uso e metricas conferidos.';
end;
$conferencia$;
