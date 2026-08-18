-- ============================================================================
-- ENQUETES — PROMPT 3/3 · mensageria, contexto de conversa e observabilidade
-- ============================================================================
--
-- O PROMPT 1/3 deixou o banco pronto para receber um adaptador de mensageria:
-- `survey_recipients` já tem `status`, `attempts`, `last_error` e
-- `provider_message_id`; `survey_dispatches` já registra a corrida;
-- `register_survey_response` já é idempotente por `source_message_id`.
--
-- Esta migration acrescenta o que faltava para o ciclo COMPLETO do §93:
--
--   1. A FILA de verdade (§22, §23, §76) — reivindicação atômica com
--      `for update skip locked`. Dois workers simultâneos nunca pegam a mesma
--      pessoa; não é uma checagem que alguém faz, é o Postgres recusando.
--
--   2. O CONTEXTO DA CONVERSA (§7, §8, §9, §45) — a tabela que responde
--      "quando esta pessoa mandar '3', 3 do quê?". O §8 é explícito: não
--      depender da última mensagem. O §45 é explícito: nunca associar uma
--      resposta apenas ao telefone.
--
--   3. A IDEMPOTÊNCIA DO WEBHOOK (§16, §19, §64) — o mesmo evento reentregue
--      não vira segundo efeito. Chave (provider, provider_event_id).
--
--   4. O OPT-OUT (§32) — ver a decisão 4, abaixo.
--
--   5. A RECONCILIAÇÃO (§47, §48) e os CONTADORES (§49, §52, §53).
--
-- ----------------------------------------------------------------------------
-- DECISÕES CENTRAIS
-- ----------------------------------------------------------------------------
--
-- 1. A FILA É A PRÓPRIA `survey_recipients`, e não uma tabela nova.
--    A linha do destinatário já É o item de trabalho: tem estado, tentativas,
--    último erro e o id da mensagem do fornecedor. Uma tabela de fila separada
--    duplicaria tudo isso e criaria a pergunta "qual das duas está certa?".
--    §87 (recuperação após reinício) sai de graça: a fila é uma tabela, então
--    reiniciar o serviço não perde nada — nada vive em memória.
--
-- 2. O CONTEXTO NÃO ADIVINHA. `resolve_survey_context` devolve uma de três
--    coisas: nada, um contexto, ou VÁRIOS com `matched_by = 'ambiguous'`. Ela
--    nunca escolhe por conta própria quando há dúvida — é o §9 ao pé da letra.
--    Quem chama decide perguntar. O caminho preferido é o casamento pela
--    mensagem CITADA (`matched_by = 'quoted'`), que não depende de heurística
--    nenhuma.
--
-- 3. NADA AQUI MANDA MENSAGEM. O banco não fala HTTP. Estas funções abrem a
--    fila, guardam o contexto e registram o desfecho; quem conversa com o
--    fornecedor é o worker em `src/lib/services/survey-dispatch.ts`. É o §2:
--    Survey Service → Messaging Service → WhatsApp Provider. Trocar de
--    fornecedor não toca em uma linha deste arquivo.
--
-- 4. ⚠️ `survey_opt_outs` É UM ACRÉSCIMO AO ESCOPO, e está aqui de propósito.
--    O §32 manda respeitar as regras de opt-in "se o CRM possuir" — e o CRM
--    NÃO possui: não há coluna de consentimento em `chat_contacts`, não há
--    blacklist, não há registro de descadastro (o consentimento LGPD do chat
--    mora em `chat_conversations`, e conversa recusada nem chega a virar
--    contato). Documentar o vazio e seguir enviando produziria uma campanha de
--    WhatsApp sem NENHUMA saída para quem não quer receber, o que não é uma
--    lacuna de produto — é algo que não deveria ser ligado. Então a saída
--    existe: quem responde "SAIR" entra aqui e nunca mais recebe.
--    Um registro de comunicação para a plataforma inteira continua sendo
--    trabalho do módulo Comunicação; este é o de Enquetes.
--
-- 5. O EVENTO DE ENTRADA NÃO GUARDA O PAYLOAD. §50: "não registrar informações
--    sensíveis desnecessariamente". Para não processar duas vezes basta o id do
--    evento; guardar o corpo da mensagem seria guardar o que a pessoa escreveu,
--    em uma tabela cuja única função é dizer "já vi este".
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Canal e estado de contexto
-- ----------------------------------------------------------------------------
-- §2. O canal é um enum de UM valor hoje. Existe para que a troca/adição de
-- canal seja um `add value` e não uma refatoração: as chaves de contexto e de
-- opt-out já nascem por canal. Recusar-se a receber WhatsApp não é recusar-se
-- a receber e-mail.
create type public.survey_channel as enum ('whatsapp');

-- §7/§38/§39/§41. O ciclo de vida de um contexto de enquete numa conversa.
create type public.survey_context_status as enum (
  'awaiting_reply', -- §7 a pergunta foi entregue e espera resposta
  'answered',       -- §38 respondeu; o contexto sai de cena e vira histórico
  'expired',        -- §41 a enquete encerrou antes da resposta
  'released',       -- §39/§40 devolvido ao atendimento (humano ou outro fluxo)
  'superseded'      -- a mesma enquete foi reenviada; o contexto antigo sai
);

-- ----------------------------------------------------------------------------
-- 2. Contexto da conversa (§7, §8, §9, §44, §45)
-- ----------------------------------------------------------------------------
-- ⚠️ ESTA TABELA É O §8 INTEIRO.
--
-- Sem ela, "identificar a enquete" só poderia sair da última mensagem que o CRM
-- mandou — e isso quebra de três jeitos, todos reais: a pessoa responde dois
-- dias depois; o CRM mandou outra coisa no meio; duas enquetes foram enviadas
-- na mesma semana. O contexto é PERSISTIDO, e é ele que manda.
create table public.survey_conversation_states (
  id uuid primary key default gen_random_uuid(),

  contact_id uuid not null references public.chat_contacts on delete cascade,
  channel public.survey_channel not null,

  survey_id uuid not null references public.surveys on delete cascade,
  question_id uuid not null references public.survey_questions on delete cascade,

  -- Quem recebeu. `set null` porque o contexto sobrevive à limpeza de uma
  -- fotografia de público, e a resposta continua valendo.
  recipient_id uuid references public.survey_recipients on delete set null,

  -- §6. O id da mensagem QUE FEZ A PERGUNTA. É por ele que uma resposta CITADA
  -- ("responder" no WhatsApp) encontra a enquete certa sem nenhum palpite.
  provider_message_id text,

  status public.survey_context_status not null default 'awaiting_reply',

  asked_at timestamptz not null default now(),

  -- §41. Cópia do fim da enquete no momento do envio. É informativa: quem
  -- decide se aceita resposta é sempre `survey_response_gate`, que lê a enquete
  -- de verdade. Guardar aqui permite responder "por que este contexto expirou?"
  -- sem depender de a enquete ainda existir.
  expires_at timestamptz,

  cleared_at timestamptz,
  cleared_reason text,

  -- §11. Quantas respostas inválidas seguidas. Um teto evita que alguém fique
  -- preso num laço de "opção inválida" com o bot para sempre.
  invalid_attempts integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint survey_context_invalid_attempts check (invalid_attempts >= 0),
  constraint survey_context_reason_len
    check (cleared_reason is null or char_length(cleared_reason) <= 200),
  constraint survey_context_message_len
    check (provider_message_id is null or char_length(provider_message_id) between 1 and 200),
  -- Um contexto fechado tem de dizer quando fechou, e um aberto não pode ter
  -- data de fechamento. Sem isto, "quantos contextos estão abertos?" teria duas
  -- respostas diferentes conforme a coluna consultada.
  constraint survey_context_cleared_coherent check (
    (status = 'awaiting_reply' and cleared_at is null)
    or (status <> 'awaiting_reply' and cleared_at is not null)
  )
);

comment on table public.survey_conversation_states is
  '§8. O contexto persistido: quando a pessoa responder "3", esta linha diz 3 do quê. Nunca depender da última mensagem enviada.';

-- ⚠️ UM CONTEXTO ABERTO POR PESSOA POR ENQUETE POR CANAL.
--
-- Note o que este índice NÃO impede: a mesma pessoa ter DOIS contextos abertos
-- de enquetes DIFERENTES. Isso é permitido de propósito — é o §45 ("mais de uma
-- enquete ativa para o mesmo associado ... manter identificação individual").
-- O que ele impede é o disparo duplicado abrir dois contextos da MESMA enquete,
-- que tornaria a desambiguação impossível de resolver por qualquer critério.
create unique index survey_context_open_idx
  on public.survey_conversation_states (contact_id, channel, survey_id)
  where status = 'awaiting_reply';

-- A consulta quente: "que contextos esta pessoa tem abertos?"
create index survey_context_lookup_idx
  on public.survey_conversation_states (contact_id, channel, status);

-- §6. O casamento pela mensagem citada.
create unique index survey_context_message_idx
  on public.survey_conversation_states (provider_message_id)
  where provider_message_id is not null;

create index survey_context_survey_idx
  on public.survey_conversation_states (survey_id, asked_at desc);

-- ----------------------------------------------------------------------------
-- 3. Eventos de entrada (§16, §19, §64)
-- ----------------------------------------------------------------------------
-- ⚠️ A IDEMPOTÊNCIA DO WEBHOOK É ESTE ÍNDICE ÚNICO, e não um `if` no código.
--
-- O fornecedor reentrega quando não recebe 200 a tempo — e ele vai reentregar,
-- porque é assim que webhooks funcionam. O `on conflict do nothing` de
-- `record_survey_inbound_event` transforma a segunda entrega em "já vi este",
-- de forma atômica, mesmo com duas requisições paralelas.
create table public.survey_inbound_events (
  id bigint generated always as identity primary key,

  provider text not null,
  provider_event_id text not null,

  -- 'message' (resposta da pessoa) ou 'status' (entregue/lido/falhou).
  event_type text not null,

  -- §50/§51. O rastro, sem o conteúdo. Ver a decisão 5 do cabeçalho.
  contact_id uuid references public.chat_contacts on delete set null,
  survey_id uuid references public.surveys on delete set null,
  correlation_id text,

  received_at timestamptz not null default now(),
  processed_at timestamptz,

  -- §49. O desfecho é o que alimenta os contadores de duplicadas e inválidas.
  outcome text,

  constraint survey_inbound_provider_len check (char_length(provider) between 1 and 40),
  constraint survey_inbound_event_len check (char_length(provider_event_id) between 1 and 200),
  constraint survey_inbound_type_len check (char_length(event_type) between 1 and 40),
  constraint survey_inbound_outcome_len
    check (outcome is null or char_length(outcome) <= 60),
  constraint survey_inbound_correlation_len
    check (correlation_id is null or char_length(correlation_id) <= 100)
);

comment on table public.survey_inbound_events is
  '§16. Um evento do fornecedor, uma linha. A unicidade (provider, provider_event_id) é a idempotência — não guarda o corpo da mensagem (§50).';

create unique index survey_inbound_events_unique_idx
  on public.survey_inbound_events (provider, provider_event_id);

create index survey_inbound_events_recent_idx
  on public.survey_inbound_events (received_at desc);

create index survey_inbound_events_outcome_idx
  on public.survey_inbound_events (outcome, received_at desc)
  where outcome is not null;

-- ----------------------------------------------------------------------------
-- 4. Opt-out (§32, §54)
-- ----------------------------------------------------------------------------
-- Ver a decisão 4 do cabeçalho: isto é um acréscimo consciente ao escopo.
create table public.survey_opt_outs (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.chat_contacts on delete cascade,
  channel public.survey_channel not null,

  -- Onde a pessoa pediu: 'chatbot' (respondeu SAIR) ou 'manual' (o time
  -- registrou por ela, depois de um pedido por telefone/e-mail).
  source text not null,
  note text,

  created_at timestamptz not null default now(),

  constraint survey_opt_outs_source check (source in ('chatbot', 'manual')),
  constraint survey_opt_outs_note_len check (note is null or char_length(note) <= 300)
);

comment on table public.survey_opt_outs is
  '§32. Quem pediu para não receber. Consultado ANTES de cada disparo — não é uma preferência, é um bloqueio.';

create unique index survey_opt_outs_unique_idx
  on public.survey_opt_outs (contact_id, channel);

-- ----------------------------------------------------------------------------
-- 5. Coluna nova em survey_recipients (§35)
-- ----------------------------------------------------------------------------
-- Sem ela, "quantas mensagens a corrida de terça mandou?" só teria como
-- resposta o total acumulado da enquete — que inclui a corrida de segunda.
-- Uma reexecução depois de uma falha parcial ficaria impossível de auditar.
alter table public.survey_recipients
  add column last_dispatch_id uuid references public.survey_dispatches on delete set null;

create index survey_recipients_dispatch_idx
  on public.survey_recipients (last_dispatch_id)
  where last_dispatch_id is not null;

-- ----------------------------------------------------------------------------
-- 6. RLS e grants
-- ----------------------------------------------------------------------------
-- ⚠️ Todas as policies usam `(select public.current_app_role())`, com o
-- subselect. Sem ele o Postgres avalia a função uma vez POR LINHA. Medido neste
-- projeto: 376 ms → 6,4 ms com 20 mil linhas. Ver
-- 20260818000000_lecture_rls_initplan.sql.
alter table public.survey_conversation_states enable row level security;
alter table public.survey_inbound_events enable row level security;
alter table public.survey_opt_outs enable row level security;

-- §57. Leitura para quem lê enquete (admin, ceo, comercial): o contexto é
-- operação de campanha — "por que o João não respondeu?" é pergunta de
-- Atendente. Não há conteúdo de mensagem aqui, só ponteiros.
create policy "survey_conversation_states_select"
  on public.survey_conversation_states for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

-- ⚠️ Sem policy de escrita para ninguém: contexto nasce e morre pelas funções
-- desta migration, chamadas pelo servidor. Um contexto editado à mão apontaria
-- uma resposta para a enquete errada — que é exatamente o que o §45 proíbe.

-- A trilha técnica do fornecedor é diagnóstico, não operação.
create policy "survey_inbound_events_select"
  on public.survey_inbound_events for select
  using ((select public.current_app_role()) in ('admin', 'ceo'));

-- §32. O Atendente PRECISA ver quem optou por sair — é a resposta para "por que
-- a Maria não recebeu?", e a pergunta chega no atendimento.
create policy "survey_opt_outs_select"
  on public.survey_opt_outs for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

-- Registrar opt-out no lugar de alguém é ato de quem administra a comunicação.
create policy "survey_opt_outs_insert"
  on public.survey_opt_outs for insert
  with check ((select public.current_app_role()) in ('admin', 'ceo'));

-- ⚠️ SEM policy de DELETE, e isto é deliberado.
--
-- Apagar um opt-out é "voltar a mandar mensagem para quem pediu para parar".
-- Se um dia houver um caminho legítimo (a própria pessoa pedindo para voltar),
-- ele será uma função com trilha, e não um DELETE que não deixa rastro.

revoke insert, update, delete on public.survey_conversation_states from authenticated, anon;
revoke insert, update, delete on public.survey_inbound_events from authenticated, anon;
revoke update, delete on public.survey_opt_outs from authenticated, anon;

create trigger on_survey_conversation_states_updated
  before update on public.survey_conversation_states
  for each row execute procedure public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 7. A fila (§15, §22, §23, §76, §87)
-- ----------------------------------------------------------------------------
-- ⚠️ `for update skip locked` É A GARANTIA DO §76, e ela não é uma checagem.
--
-- Dois workers rodando ao mesmo tempo: o primeiro tranca as linhas que pegou; o
-- segundo PULA as linhas trancadas (skip locked) em vez de esperar por elas.
-- Nenhum dos dois vê a mesma pessoa. Sem `skip locked`, o segundo esperaria o
-- primeiro terminar e então leria as mesmas linhas já com status 'sending' —
-- o filtro as descartaria, mas depois de o worker ter ficado bloqueado.
--
-- E se o worker morrer com as linhas em 'sending'? Elas voltam por
-- `requeue_stuck_survey_recipients` (§87). Não há estado em memória para
-- perder: a fila é uma tabela.
create or replace function public.claim_survey_recipients(
  p_survey_id uuid,
  p_dispatch_id uuid,
  p_limit integer default 50
)
returns setof public.survey_recipients
language plpgsql
-- SECURITY DEFINER porque a escrita direta em `survey_recipients` é revogada
-- (seção 12 da migration original). O controle de quem pode chamar é o grant
-- lá embaixo: só `service_role`.
security definer
set search_path = ''
as $$
begin
  -- §23. Um lote gigante é um request pendurado; um lote de 1 é um round-trip
  -- por pessoa. O teto existe para que "processar tudo de uma vez" não seja
  -- expressável.
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'O lote deve ficar entre 1 e 500 destinatários.' using errcode = 'SV009';
  end if;

  return query
  update public.survey_recipients r
  set status = 'sending',
      last_attempt_at = now(),
      last_dispatch_id = p_dispatch_id
  where r.id in (
    select c.id
    from public.survey_recipients c
    where c.survey_id = p_survey_id
      and c.status = 'pending'
    -- Ordem de chegada: quem entrou na fotografia primeiro sai primeiro. Sem
    -- ordem explícita, uma falha parcial reprocessaria em ordem aleatória e
    -- "quem ainda não recebeu?" viraria um sorteio.
    order by c.created_at, c.id
    for update skip locked
    limit p_limit
  )
  returning r.*;
end;
$$;

comment on function public.claim_survey_recipients(uuid, uuid, integer) is
  '§22/§76. Reivindica um lote da fila com FOR UPDATE SKIP LOCKED. Dois workers nunca pegam a mesma pessoa.';

revoke execute on function public.claim_survey_recipients(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_survey_recipients(uuid, uuid, integer) to service_role;

-- §87. RECUPERAÇÃO. Um worker que morre no meio (deploy, timeout da função
-- serverless, queda do processo) deixa linhas em 'sending' para sempre.
--
-- ⚠️ O PRAZO É GENEROSO DE PROPÓSITO. Devolver uma linha para a fila cedo
-- demais, enquanto o envio de verdade ainda está a caminho, faz a pessoa
-- receber duas vezes — o oposto do que o §76 pede. Quinze minutos é mais que
-- qualquer timeout de fornecedor razoável (o nosso é de 15 segundos).
create or replace function public.requeue_stuck_survey_recipients(
  p_older_than interval default '15 minutes'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.survey_recipients
  set status = 'pending'
  where status = 'sending'
    and last_attempt_at is not null
    and last_attempt_at < now() - p_older_than;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.requeue_stuck_survey_recipients(interval) is
  '§87. Devolve à fila quem ficou preso em ENVIANDO por queda do worker. Prazo generoso: devolver cedo demais gera envio duplicado.';

revoke execute on function public.requeue_stuck_survey_recipients(interval)
  from public, anon, authenticated;
grant execute on function public.requeue_stuck_survey_recipients(interval) to service_role;

-- §32/§33. Tira da fila quem pediu para não receber, ANTES de qualquer envio.
--
-- Marca como ERRO em vez de apagar: a pergunta "por que a Maria não recebeu
-- esta campanha?" precisa de resposta, e sumir com a linha a deixaria sem uma.
create or replace function public.block_opted_out_recipients(p_survey_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.survey_recipients r
  set status = 'error',
      last_error = 'Contato optou por não receber mensagens desta campanha.'
  where r.survey_id = p_survey_id
    and r.status in ('pending', 'sending')
    and exists (
      select 1
      from public.survey_opt_outs o
      where o.contact_id = r.contact_id
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.block_opted_out_recipients(uuid) is
  '§32/§33. Bloqueia quem optou por sair antes do envio. Marca ERRO em vez de apagar, para que "por que ela não recebeu?" tenha resposta.';

revoke execute on function public.block_opted_out_recipients(uuid)
  from public, anon, authenticated;
grant execute on function public.block_opted_out_recipients(uuid) to service_role;

-- §32. Registro do pedido de saída. Idempotente: pedir duas vezes é uma vez.
create or replace function public.register_survey_opt_out(
  p_contact_id uuid,
  p_channel public.survey_channel,
  p_source text default 'chatbot',
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.survey_opt_outs (contact_id, channel, source, note)
  values (p_contact_id, p_channel, p_source, left(nullif(btrim(p_note), ''), 300))
  on conflict (contact_id, channel) do nothing
  returning id into v_id;

  -- §38/§39. Quem pediu para sair não continua com perguntas em aberto.
  update public.survey_conversation_states
  set status = 'released',
      cleared_at = now(),
      cleared_reason = 'opt_out'
  where contact_id = p_contact_id
    and channel = p_channel
    and status = 'awaiting_reply';

  return v_id is not null;
end;
$$;

comment on function public.register_survey_opt_out(uuid, public.survey_channel, text, text) is
  '§32. Registra o pedido de saída e libera os contextos abertos da pessoa. Idempotente.';

revoke execute on function public.register_survey_opt_out(
  uuid, public.survey_channel, text, text
) from public, anon, authenticated;
grant execute on function public.register_survey_opt_out(
  uuid, public.survey_channel, text, text
) to service_role;

-- ----------------------------------------------------------------------------
-- 8. Fim da corrida (§27, §28, §35, §91)
-- ----------------------------------------------------------------------------
-- ⚠️ §28: FALHA INDIVIDUAL NÃO CANCELA A CAMPANHA.
--
-- O status da corrida é 'failed' só quando NINGUÉM foi enviado havendo gente
-- para enviar — isto é, quando o problema é do fornecedor, e não das pessoas.
-- Dez destinatários com duas falhas terminam 'completed' com dois erros
-- registrados (§74), porque a campanha alcançou oito pessoas.
create or replace function public.finish_survey_dispatch(p_dispatch_id uuid)
returns public.survey_dispatches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch public.survey_dispatches;
  v_sent integer;
  v_errors integer;
  v_touched integer;
begin
  select * into v_dispatch from public.survey_dispatches where id = p_dispatch_id;
  if not found then
    raise exception 'Corrida de disparo não encontrada.' using errcode = 'P0002';
  end if;

  -- Só o que ESTA corrida tocou (por isso `last_dispatch_id` existe).
  select
    count(*) filter (where status in ('sent', 'delivered', 'read', 'responded'))::integer,
    count(*) filter (where status = 'error')::integer,
    count(*)::integer
  into v_sent, v_errors, v_touched
  from public.survey_recipients
  where last_dispatch_id = p_dispatch_id;

  update public.survey_dispatches
  set status = case
        when v_touched > 0 and v_sent = 0 then 'failed'::public.survey_dispatch_status
        else 'completed'::public.survey_dispatch_status
      end,
      total_sent = v_sent,
      total_errors = v_errors,
      finished_at = now()
  where id = p_dispatch_id
  returning * into v_dispatch;

  -- §35/§91. O fim da corrida entra na trilha com os números do momento.
  insert into public.survey_audit_logs (survey_id, action, actor_id, metadata)
  values (
    v_dispatch.survey_id,
    'survey_dispatch_completed',
    null,
    jsonb_build_object(
      'dispatchId', v_dispatch.id,
      'status', v_dispatch.status,
      'recipients', v_dispatch.total_recipients,
      'sent', v_sent,
      'errors', v_errors,
      'finishedAt', v_dispatch.finished_at
    )
  );

  return v_dispatch;
end;
$$;

comment on function public.finish_survey_dispatch(uuid) is
  '§28/§35. Fecha a corrida com os números dela. Só marca ''failed'' quando NINGUÉM saiu — falha individual não cancela a campanha.';

revoke execute on function public.finish_survey_dispatch(uuid) from public, anon, authenticated;
grant execute on function public.finish_survey_dispatch(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 9. Contexto da conversa (§7, §8, §9, §38, §44, §45)
-- ----------------------------------------------------------------------------
-- §7. Abre o contexto DEPOIS que a mensagem saiu — nunca antes.
--
-- Abrir antes deixaria a pessoa com uma pergunta em aberto que ela nunca viu:
-- se o envio falhar, o próximo "1" que ela mandasse por outro motivo viraria
-- voto numa enquete que nunca chegou.
create or replace function public.open_survey_context(
  p_recipient_id uuid,
  p_channel public.survey_channel,
  p_provider_message_id text default null
)
returns public.survey_conversation_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient public.survey_recipients;
  v_survey public.surveys;
  v_question_id uuid;
  v_state public.survey_conversation_states;
begin
  select * into v_recipient from public.survey_recipients where id = p_recipient_id;
  if not found then
    raise exception 'Destinatário não encontrado.' using errcode = 'P0002';
  end if;

  if v_recipient.contact_id is null then
    raise exception 'Destinatário sem contato: não há a quem atribuir o contexto.'
      using errcode = 'SV010';
  end if;

  select * into v_survey from public.surveys where id = v_recipient.survey_id;

  select id into v_question_id
  from public.survey_questions
  where survey_id = v_recipient.survey_id
  order by position
  limit 1;

  if v_question_id is null then
    raise exception 'A enquete não tem pergunta.' using errcode = 'SV005';
  end if;

  -- Reenvio da MESMA enquete: o contexto anterior sai de cena antes de o novo
  -- entrar, senão o índice único recusaria a inserção. O anterior vira
  -- 'superseded' (e não 'released') para que a trilha distinga "a pessoa foi
  -- devolvida ao atendimento" de "mandamos de novo".
  update public.survey_conversation_states
  set status = 'superseded',
      cleared_at = now(),
      cleared_reason = 'resent'
  where contact_id = v_recipient.contact_id
    and channel = p_channel
    and survey_id = v_recipient.survey_id
    and status = 'awaiting_reply';

  insert into public.survey_conversation_states (
    contact_id, channel, survey_id, question_id, recipient_id,
    provider_message_id, expires_at
  )
  values (
    v_recipient.contact_id, p_channel, v_recipient.survey_id, v_question_id,
    v_recipient.id, nullif(btrim(p_provider_message_id), ''), v_survey.ends_at
  )
  returning * into v_state;

  return v_state;
end;
$$;

comment on function public.open_survey_context(uuid, public.survey_channel, text) is
  '§7. Abre o contexto DEPOIS do envio confirmado. Um reenvio substitui o contexto anterior em vez de duplicá-lo.';

revoke execute on function public.open_survey_context(uuid, public.survey_channel, text)
  from public, anon, authenticated;
grant execute on function public.open_survey_context(uuid, public.survey_channel, text)
  to service_role;

-- ⚠️ §9 E §45 MORAM AQUI.
--
-- Esta função NUNCA escolhe quando há dúvida. Ela devolve:
--
--   0 linhas               → não há enquete em contexto (§44: o "1" solto é do
--                            fluxo normal do chatbot, não é voto)
--   1 linha, 'quoted'      → a pessoa RESPONDEU a mensagem da enquete; é a
--                            identificação mais forte que existe, e não depende
--                            de nenhuma heurística
--   1 linha, 'single'      → só há uma enquete em aberto; não há o que confundir
--   N linhas, 'ambiguous'  → §9: quem chama PERGUNTA qual delas
--
-- Devolver a mais recente no caso ambíguo seria "assumir silenciosamente" —
-- exatamente a frase que o §9 proíbe.
create or replace function public.resolve_survey_context(
  p_contact_id uuid,
  p_channel public.survey_channel,
  p_reply_to_message_id text default null
)
returns table (
  state_id uuid,
  survey_id uuid,
  question_id uuid,
  recipient_id uuid,
  survey_title text,
  asked_at timestamptz,
  matched_by text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_quoted uuid;
  v_open integer;
begin
  if p_contact_id is null then
    return;
  end if;

  -- 1. A mensagem citada. Note que ela vale mesmo para um contexto JÁ FECHADO:
  -- alguém que responde duas vezes à mesma mensagem precisa ouvir "você já
  -- participou" (§14), e não cair no fluxo genérico do chatbot.
  if nullif(btrim(p_reply_to_message_id), '') is not null then
    select s.id into v_quoted
    from public.survey_conversation_states s
    where s.provider_message_id = btrim(p_reply_to_message_id)
      and s.contact_id = p_contact_id
      and s.channel = p_channel;

    if v_quoted is not null then
      return query
      select s.id, s.survey_id, s.question_id, s.recipient_id,
             v.title, s.asked_at, 'quoted'::text
      from public.survey_conversation_states s
      join public.surveys v on v.id = s.survey_id
      where s.id = v_quoted;
      return;
    end if;
  end if;

  -- 2. Os contextos abertos.
  select count(*)::integer into v_open
  from public.survey_conversation_states s
  where s.contact_id = p_contact_id
    and s.channel = p_channel
    and s.status = 'awaiting_reply';

  if v_open = 0 then
    return;
  end if;

  return query
  select s.id, s.survey_id, s.question_id, s.recipient_id,
         v.title, s.asked_at,
         case when v_open = 1 then 'single' else 'ambiguous' end::text
  from public.survey_conversation_states s
  join public.surveys v on v.id = s.survey_id
  where s.contact_id = p_contact_id
    and s.channel = p_channel
    and s.status = 'awaiting_reply'
  order by s.asked_at desc;
end;
$$;

comment on function public.resolve_survey_context(uuid, public.survey_channel, text) is
  '§9/§45. Devolve 0, 1 ou N contextos com matched_by = quoted|single|ambiguous. NUNCA escolhe sozinha no caso ambíguo.';

revoke execute on function public.resolve_survey_context(uuid, public.survey_channel, text)
  from public, anon, authenticated;
grant execute on function public.resolve_survey_context(uuid, public.survey_channel, text)
  to service_role;

-- §38/§39/§41. Fecha o contexto mantendo o histórico (a linha continua lá).
create or replace function public.close_survey_context(
  p_state_id uuid,
  p_status public.survey_context_status,
  p_reason text default null
)
returns public.survey_conversation_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.survey_conversation_states;
begin
  if p_status = 'awaiting_reply' then
    raise exception 'Fechar um contexto exige uma situação terminal.' using errcode = 'SV010';
  end if;

  update public.survey_conversation_states
  set status = p_status,
      cleared_at = now(),
      cleared_reason = left(nullif(btrim(p_reason), ''), 200)
  where id = p_state_id
    and status = 'awaiting_reply'
  returning * into v_state;

  -- Já estava fechado: devolve como está, sem erro. Um webhook reentregue
  -- passa por aqui, e um erro faria o fornecedor tentar de novo para sempre.
  if not found then
    select * into v_state from public.survey_conversation_states where id = p_state_id;
  end if;

  return v_state;
end;
$$;

revoke execute on function public.close_survey_context(
  uuid, public.survey_context_status, text
) from public, anon, authenticated;
grant execute on function public.close_survey_context(
  uuid, public.survey_context_status, text
) to service_role;

-- §11. Conta uma resposta inválida e diz se a pessoa já passou do limite.
-- Sem teto, um "6" repetido viraria uma conversa infinita com o bot.
create or replace function public.count_survey_context_miss(
  p_state_id uuid,
  p_max integer default 3
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  update public.survey_conversation_states
  set invalid_attempts = invalid_attempts + 1
  where id = p_state_id
  returning invalid_attempts into v_attempts;

  if v_attempts is null then
    return 0;
  end if;

  -- §39. Estourou o limite: a enquete solta a conversa e o atendimento normal
  -- volta. Insistir seria prender a pessoa num fluxo que ela claramente não
  -- quer seguir.
  if v_attempts >= p_max then
    update public.survey_conversation_states
    set status = 'released',
        cleared_at = now(),
        cleared_reason = 'too_many_invalid'
    where id = p_state_id
      and status = 'awaiting_reply';
  end if;

  return v_attempts;
end;
$$;

revoke execute on function public.count_survey_context_miss(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.count_survey_context_miss(uuid, integer) to service_role;

-- §41. Fecha os contextos de enquetes que já encerraram. Idempotente.
create or replace function public.expire_survey_contexts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.survey_conversation_states s
  set status = 'expired',
      cleared_at = now(),
      cleared_reason = 'survey_closed'
  from public.surveys v
  where v.id = s.survey_id
    and s.status = 'awaiting_reply'
    and (
      v.status in ('closed', 'cancelled')
      or (v.ends_at is not null and now() >= v.ends_at)
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.expire_survey_contexts() from public, anon, authenticated;
grant execute on function public.expire_survey_contexts() to service_role;

-- ----------------------------------------------------------------------------
-- 10. Eventos de entrada (§16, §19, §64)
-- ----------------------------------------------------------------------------
-- Devolve `true` na PRIMEIRA vez e `false` em toda reentrega.
--
-- ⚠️ A atomicidade vem do `on conflict do nothing`, não de um `select` antes do
-- `insert`. Com duas entregas paralelas do mesmo evento (o fornecedor faz
-- isso), o par select+insert deixaria as duas passarem: ambas leriam "não
-- existe" antes de qualquer uma inserir.
create or replace function public.record_survey_inbound_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_contact_id uuid default null,
  p_survey_id uuid default null,
  p_correlation_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if nullif(btrim(p_event_id), '') is null then
    raise exception 'Evento sem identificador.' using errcode = 'SV010';
  end if;

  insert into public.survey_inbound_events (
    provider, provider_event_id, event_type, contact_id, survey_id, correlation_id
  )
  values (
    left(btrim(p_provider), 40),
    left(btrim(p_event_id), 200),
    left(btrim(p_event_type), 40),
    p_contact_id,
    p_survey_id,
    left(nullif(btrim(p_correlation_id), ''), 100)
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into v_id;

  return v_id is not null;
end;
$$;

comment on function public.record_survey_inbound_event(text, text, text, uuid, uuid, text) is
  '§16. true = primeira vez; false = reentrega. A atomicidade é o ON CONFLICT, não um SELECT antes do INSERT.';

revoke execute on function public.record_survey_inbound_event(text, text, text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_survey_inbound_event(text, text, text, uuid, uuid, text)
  to service_role;

-- §49. Carimba o desfecho — é daqui que saem os contadores de duplicadas e
-- inválidas, sem uma tabela de métricas paralela.
create or replace function public.complete_survey_inbound_event(
  p_provider text,
  p_event_id text,
  p_outcome text,
  p_survey_id uuid default null,
  p_contact_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.survey_inbound_events
  set processed_at = now(),
      outcome = left(btrim(p_outcome), 60),
      survey_id = coalesce(p_survey_id, survey_id),
      contact_id = coalesce(p_contact_id, contact_id)
  where provider = left(btrim(p_provider), 40)
    and provider_event_id = left(btrim(p_event_id), 200);
end;
$$;

revoke execute on function public.complete_survey_inbound_event(text, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_survey_inbound_event(text, text, text, uuid, uuid)
  to service_role;

-- ----------------------------------------------------------------------------
-- 11. Webhook de status (§26)
-- ----------------------------------------------------------------------------
-- O fornecedor avisa "entregue"/"lido" citando o id DELE, não o nosso. Esta
-- função é a tradução — e delega a `mark_survey_recipient`, que é quem tem a
-- regra de progressão monotônica (um "entregue" atrasado não rebaixa um "lido").
create or replace function public.mark_survey_recipient_by_message(
  p_provider_message_id text,
  p_status public.survey_recipient_status,
  p_error text default null
)
returns public.survey_recipients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if nullif(btrim(p_provider_message_id), '') is null then
    return null;
  end if;

  select id into v_id
  from public.survey_recipients
  where provider_message_id = btrim(p_provider_message_id);

  -- Silêncio de propósito: o WhatsApp manda status de TODA mensagem da conta,
  -- inclusive das que não são de enquete. Lançar erro aqui faria o webhook
  -- devolver 500 para eventos que não são nossos — e o fornecedor reentregaria
  -- para sempre.
  if v_id is null then
    return null;
  end if;

  return public.mark_survey_recipient(v_id, p_status, null, p_error);
end;
$$;

comment on function public.mark_survey_recipient_by_message(text, public.survey_recipient_status, text) is
  '§26. Traduz o id do fornecedor para o nosso. Devolve NULL em silêncio quando a mensagem não é de enquete — o webhook recebe status de tudo.';

revoke execute on function public.mark_survey_recipient_by_message(
  text, public.survey_recipient_status, text
) from public, anon, authenticated;
grant execute on function public.mark_survey_recipient_by_message(
  text, public.survey_recipient_status, text
) to service_role;

-- ----------------------------------------------------------------------------
-- 12. Progressão monotônica com 'sending' (§25, §26)
-- ----------------------------------------------------------------------------
-- Reescreve `mark_survey_recipient` para conhecer o estado novo. Sem isto,
-- 'sending' ficaria FORA da escala (`array_position` devolveria NULL) e a
-- proteção contra rebaixamento seria pulada toda vez que a linha estivesse em
-- voo — deixando um webhook fora de ordem levar 'read' de volta para 'sent'.
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
  v_escala text[] := array['pending', 'sending', 'sent', 'delivered', 'read', 'responded'];
begin
  select * into v_old from public.survey_recipients where id = p_recipient_id;
  if not found then
    raise exception 'Destinatário não encontrado.' using errcode = 'P0002';
  end if;

  v_rank := array_position(v_escala, p_status::text);
  v_old_rank := array_position(v_escala, v_old.status::text);

  -- 'error' está fora da escala e sempre pode ser gravado: uma falha é notícia
  -- nova, mesmo depois de um "enviado".
  if p_status <> 'error' and v_old.status <> 'error'
     and v_rank is not null and v_old_rank is not null and v_rank <= v_old_rank then
    return v_old;
  end if;

  update public.survey_recipients
  set status = p_status,
      -- ⚠️ 'sending' NÃO conta tentativa: quem conta é o resultado do envio
      -- ('sent' ou 'error'). Contar na reivindicação faria um worker que morre
      -- antes de chamar o fornecedor gastar a cota de retry da pessoa.
      attempts = case when p_status in ('sent', 'error') then attempts + 1 else attempts end,
      last_attempt_at = case
        when p_status in ('sent', 'error') then now() else last_attempt_at end,
      last_error = case
        when p_status = 'error' then left(coalesce(p_error, 'Falha no envio.'), 1000)
        else last_error end,
      provider_message_id =
        coalesce(nullif(btrim(p_provider_message_id), ''), provider_message_id)
  where id = p_recipient_id
  returning * into v_new;

  return v_new;
end;
$$;

comment on function public.mark_survey_recipient is
  'Onde um adaptador de WhatsApp se pluga. A progressão é monotônica: webhook fora de ordem não rebaixa o estado. ''sending'' está na escala (§25).';

-- ----------------------------------------------------------------------------
-- 13. Reconciliação (§47, §48)
-- ----------------------------------------------------------------------------
-- ⚠️ POR QUE ISTO EXISTE se o §47 diz para derivar tudo das respostas.
--
-- `survey_results` e `survey_metrics` JÁ derivam das respostas persistidas — a
-- verdade dos resultados nunca depende de contador. O que pode divergir é o
-- estado do DESTINATÁRIO (que é operacional, não resultado): alguém pode
-- responder pelo chat da web sem nunca ter recebido a mensagem, e aí a linha
-- do destinatário fica em 'delivered' enquanto a resposta existe.
--
-- Esta função é o detector do §48: ela CORRIGE o que é seguro corrigir e
-- RELATA o que precisa de gente olhando.
create or replace function public.reconcile_survey_counters(p_survey_id uuid default null)
returns table (
  survey_id uuid,
  recipients_marked_responded integer,
  dispatches_recomputed integer,
  responses_without_recipient integer,
  recipients_stuck_sending integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.survey_is_reader() then
    raise exception 'Sem permissão para reconciliar enquetes.' using errcode = '42501';
  end if;

  return query
  with alvo as (
    select v.id from public.surveys v
    where p_survey_id is null or v.id = p_survey_id
  ),
  -- 1. Quem respondeu mas cujo destinatário não sabe disso.
  corrigidos as (
    update public.survey_recipients r
    set status = 'responded'
    from public.survey_responses resp
    where resp.survey_id = r.survey_id
      and resp.contact_id = r.contact_id
      and r.status <> 'responded'
      and r.status <> 'error'
      and r.survey_id in (select id from alvo)
    returning r.survey_id
  ),
  -- 2. Os totais de cada corrida, recalculados a partir das linhas de verdade.
  corridas as (
    update public.survey_dispatches d
    set total_sent = c.enviados,
        total_errors = c.erros
    from (
      select rec.last_dispatch_id as dispatch_id,
             count(*) filter (
               where rec.status in ('sent', 'delivered', 'read', 'responded')
             )::integer as enviados,
             count(*) filter (where rec.status = 'error')::integer as erros
      from public.survey_recipients rec
      where rec.last_dispatch_id is not null
        and rec.survey_id in (select id from alvo)
      group by rec.last_dispatch_id
    ) c
    where d.id = c.dispatch_id
      and (d.total_sent <> c.enviados or d.total_errors <> c.erros)
    returning d.survey_id
  ),
  -- 3. Respostas de quem não está na fotografia. NÃO é erro: é alguém que
  -- respondeu pelo chat da web sem ter recebido o WhatsApp. Vira número para
  -- que a diferença entre "respostas" e "destinatários que responderam" tenha
  -- explicação em vez de virar suspeita.
  orfas as (
    select resp.survey_id, count(*)::integer as n
    from public.survey_responses resp
    where resp.survey_id in (select id from alvo)
      and not exists (
        select 1 from public.survey_recipients r
        where r.survey_id = resp.survey_id and r.contact_id = resp.contact_id
      )
    group by resp.survey_id
  ),
  presos as (
    select r.survey_id, count(*)::integer as n
    from public.survey_recipients r
    where r.status = 'sending'
      and r.survey_id in (select id from alvo)
    group by r.survey_id
  )
  select
    a.id,
    coalesce((select count(*)::integer from corrigidos c where c.survey_id = a.id), 0),
    coalesce((select count(*)::integer from corridas d where d.survey_id = a.id), 0),
    coalesce((select o.n from orfas o where o.survey_id = a.id), 0),
    coalesce((select p.n from presos p where p.survey_id = a.id), 0)
  from alvo a
  order by a.id;
end;
$$;

comment on function public.reconcile_survey_counters(uuid) is
  '§48. Corrige o que é seguro corrigir (estado do destinatário, totais da corrida) e RELATA o que precisa de gente olhando.';

revoke execute on function public.reconcile_survey_counters(uuid) from public, anon;

-- ----------------------------------------------------------------------------
-- 14. Observabilidade (§49, §52, §53)
-- ----------------------------------------------------------------------------
-- Os contadores do §49, derivados das tabelas — sem uma tabela de métricas
-- paralela que precisaria ser mantida em dia.
--
-- ⚠️ `survey_duplicate_responses` e `survey_invalid_responses` saem de
-- `survey_inbound_events.outcome`, ou seja, contam o caminho do WHATSAPP. As
-- respostas pela janela de chat da web não geram evento de fornecedor e por
-- isso não entram aqui — elas aparecem no log da aplicação. Está dito para que
-- ninguém leia "0 inválidas" como "ninguém errou".
create or replace function public.survey_observability_counters(
  p_since timestamptz default null
)
returns table (metric text, value bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := coalesce(p_since, now() - interval '30 days');
begin
  if not public.survey_is_reader() then
    raise exception 'Sem permissão para consultar métricas.' using errcode = '42501';
  end if;

  return query
  select 'surveys_created'::text, count(*)::bigint
    from public.surveys where created_at >= v_since
  union all
  select 'surveys_scheduled', count(*)::bigint
    from public.survey_audit_logs
    where action = 'survey_scheduled' and created_at >= v_since
  union all
  select 'surveys_sent', count(*)::bigint
    from public.survey_recipients
    where status in ('sent', 'delivered', 'read', 'responded') and updated_at >= v_since
  union all
  select 'survey_send_errors', count(*)::bigint
    from public.survey_recipients where status = 'error' and updated_at >= v_since
  union all
  select 'survey_delivered', count(*)::bigint
    from public.survey_recipients
    where status in ('delivered', 'read', 'responded') and updated_at >= v_since
  union all
  select 'survey_read', count(*)::bigint
    from public.survey_recipients
    where status in ('read', 'responded') and updated_at >= v_since
  union all
  select 'survey_responses', count(*)::bigint
    from public.survey_responses where answered_at >= v_since
  union all
  select 'survey_duplicate_responses', count(*)::bigint
    from public.survey_inbound_events
    where outcome = 'already_answered' and received_at >= v_since
  union all
  select 'survey_invalid_responses', count(*)::bigint
    from public.survey_inbound_events
    where outcome = 'invalid_option' and received_at >= v_since
  union all
  select 'survey_webhook_events', count(*)::bigint
    from public.survey_inbound_events where received_at >= v_since
  union all
  select 'survey_webhook_unprocessed', count(*)::bigint
    from public.survey_inbound_events
    where processed_at is null and received_at >= v_since
  -- §53. Os três abaixo são ESTADO ATUAL, não janela: é o que um alerta olha.
  union all
  select 'survey_queue_depth', count(*)::bigint
    from public.survey_recipients where status = 'pending'
  union all
  select 'survey_queue_in_flight', count(*)::bigint
    from public.survey_recipients where status = 'sending'
  union all
  select 'survey_queue_stuck', count(*)::bigint
    from public.survey_recipients
    where status = 'sending'
      and last_attempt_at is not null
      and last_attempt_at < now() - interval '15 minutes'
  union all
  select 'survey_contexts_open', count(*)::bigint
    from public.survey_conversation_states where status = 'awaiting_reply'
  union all
  select 'survey_opt_outs', count(*)::bigint
    from public.survey_opt_outs;
end;
$$;

comment on function public.survey_observability_counters(timestamptz) is
  '§49/§52/§53. Os contadores derivados das tabelas. As três últimas linhas de fila são estado ATUAL — é o que um alerta observa.';

revoke execute on function public.survey_observability_counters(timestamptz) from public, anon;

-- ----------------------------------------------------------------------------
-- 15. A porta anônima continua fechada
-- ----------------------------------------------------------------------------
-- ⚠️ ESTE BLOCO EXISTE POR CAUSA DE UM BURACO REAL, encontrado medindo o banco
-- no PROMPT 1/3: o Supabase tem `alter default privileges` concedendo EXECUTE a
-- `anon` em TODA função nova de `public`. Um `revoke ... from public` NÃO
-- desfaz isso — são concessões diferentes.
--
-- Sem esta varredura, cada função criada acima nasceria chamável por qualquer
-- pessoa com a chave anônima, que é pública por definição.
do $revoke_anon$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like '%survey%' or p.proname like '%opt_out%')
  loop
    execute pg_catalog.format('revoke execute on function %s from anon', f.assinatura);
  end loop;
end $revoke_anon$;
