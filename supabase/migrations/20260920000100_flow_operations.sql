-- ============================================================================
-- FLUXOS — OPERAÇÃO: homologação, SLA, laço seguro e monitoramento
-- ============================================================================
--
-- O Prompt 5 fecha o módulo para uso real. Esta migration resolve as lacunas
-- que dependiam do BANCO; o resto (telas, simulador, documentação) é TypeScript.
--
-- O que entra, e por que cada coisa não podia ficar em código:
--
--   §10  LAÇO POR CONVERSA        o teto de 20 saltos do motor é POR TURNO. Um
--                                 desenho que volta ao menu a cada resposta
--                                 nunca o estoura, e circula para sempre — uma
--                                 conversa por turno, sem nada falhar. O
--                                 contador precisa VIVER na execução.
--   §35  CARIMBOS DE SLA          "quanto tempo até alguém atender?" só se
--                                 responde com o instante gravado na linha.
--   §36  SLA POR TIME             o prazo é do TIME, e muda sem deploy.
--   §21  CHECKLIST                quem conferiu o quê, antes de aprovar.
--   §22  MOTIVO DA REPROVAÇÃO     "por que voltou para rascunho" é a pergunta
--                                 que ninguém consegue responder três semanas
--                                 depois.
--   §30  INTENÇÃO PERSISTIDA      `flow_runs.intent` existia desde o Prompt 1 e
--                                 nunca foi preenchida. Sem ela, o §47 não tem
--                                 como agregar nada em SQL.
--   §29  MÉTRICAS                 contar execuções no cliente exigiria trazer
--                                 todas as linhas para o Node.
--
-- ⚠️ DUAS FUNÇÕES SÃO DERRUBADAS E RECRIADAS, e o `drop` é obrigatório:
-- `create or replace` com uma lista de parâmetros diferente cria uma SOBRECARGA
-- em vez de substituir. As duas versões conviveriam, o PostgREST escolheria uma
-- pelo formato da chamada, e metade das gravações usaria a antiga em silêncio.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. §36 — o SLA é do TIME, e não do código
-- ----------------------------------------------------------------------------
-- ⚠️ NO TIME, E NÃO SÓ NO NÓ. O nó ATTENDANT já aceita `slaMinutes` na
-- configuração, e ele continua valendo como EXCEÇÃO — "esta transferência
-- específica é urgente". O que faltava era o padrão: "toda conversa que cai no
-- Financeiro tem 4 horas".
--
-- Sem o padrão no time, o prazo teria de ser repetido em cada nó de cada versão
-- de cada fluxo que transfere para aquele time — e mudar de 4h para 2h seria
-- abrir todas elas. Versão publicada não se edita, então na prática seria
-- impossível.
alter table public.attendance_teams
  add column if not exists sla_minutes integer,
  add column if not exists business_hours text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'attendance_teams_sla_range'
  ) then
    -- Teto de uma semana: acima disso não é prazo de atendimento, é esquecimento
    -- com número. O mínimo de 1 evita o zero, que significaria "já venceu".
    alter table public.attendance_teams add constraint attendance_teams_sla_range
      check (sla_minutes is null or sla_minutes between 1 and 10080);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'attendance_teams_hours_len'
  ) then
    alter table public.attendance_teams add constraint attendance_teams_hours_len
      check (business_hours is null or char_length(business_hours) <= 200);
  end if;
end $$;

comment on column public.attendance_teams.sla_minutes is
  'Prazo padrao do time em minutos (§36). NULL = sem prazo. O no ATTENDANT pode sobrepor.';
comment on column public.attendance_teams.business_hours is
  'Expediente do time, no formato de src/modules/flow/flow.hours.ts. NULL = usa o geral.';


-- ----------------------------------------------------------------------------
-- 2. §35 e §10 — os carimbos do atendimento humano e o contador de laço
-- ----------------------------------------------------------------------------
alter table public.flow_runs
  add column if not exists assigned_at timestamptz,
  add column if not exists first_response_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists sla_minutes integer,
  add column if not exists node_executions integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'flow_runs_node_executions_range'
  ) then
    -- ⚠️ O TETO DO BANCO É DEZ VEZES O DO MOTOR, de propósito. Quem recusa a
    -- execução é a aplicação, com uma mensagem que o desenho controla (§10);
    -- este CHECK é a rede embaixo dela, para o caso de alguém escrever direto.
    -- Fossem iguais, um ajuste do limite na aplicação viraria erro de constraint.
    alter table public.flow_runs add constraint flow_runs_node_executions_range
      check (node_executions between 0 and 2000);
  end if;
end $$;

comment on column public.flow_runs.assigned_at is
  'Quando a conversa entrou na fila de um time (§35). O relogio do SLA comeca aqui.';
comment on column public.flow_runs.first_response_at is
  'Quando uma PESSOA respondeu pela primeira vez (§35). Gravado por gatilho, nao pelo motor.';
comment on column public.flow_runs.resolved_at is
  'Quando o atendimento humano foi encerrado (§35). Diferente de completed_at, que e o fim do FLUXO.';
comment on column public.flow_runs.sla_minutes is
  'O prazo que valia NO MOMENTO da transferencia. Congelado: mudar o SLA do time nao reescreve o passado.';
comment on column public.flow_runs.node_executions is
  'Quantos nos esta conversa ja atravessou, somando TODOS os turnos (§10). O teto por turno nao pega laco lento.';

-- A fila do atendente: conversas transferidas e ainda sem resposta humana.
-- Parcial porque as encerradas serão a maioria das linhas em seis meses.
create index if not exists flow_runs_sla_pending_idx
  on public.flow_runs (assigned_at)
  where assigned_at is not null and first_response_at is null;


-- ----------------------------------------------------------------------------
-- 3. §21 e §22 — o checklist e o motivo da reprovação
-- ----------------------------------------------------------------------------
-- ⚠️ O CHECKLIST É UM JSONB, E NÃO UMA TABELA. A pergunta que decidiu: alguém
-- vai consultar "quais itens foram marcados" ATRAVÉS de várias versões? Não —
-- ele só é lido junto da versão a que pertence, e sempre inteiro. Uma tabela
-- filha traria join, RLS própria e cascade para não responder pergunta nenhuma.
--
-- A FORMA dele vive em `src/modules/flow/flow.checklist.ts`, e o CHECK aqui só
-- exige que seja objeto: os itens mudam com o processo da APCS, e um enum no
-- banco transformaria "acrescentar um item ao checklist" numa migration.
alter table public.flow_versions
  add column if not exists checklist jsonb not null default '{}'::jsonb,
  add column if not exists review_notes text,
  add column if not exists reviewed_by uuid references public.profiles on delete set null,
  add column if not exists reviewed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'flow_versions_checklist_object'
  ) then
    alter table public.flow_versions add constraint flow_versions_checklist_object
      check (jsonb_typeof(checklist) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'flow_versions_review_notes_len'
  ) then
    alter table public.flow_versions add constraint flow_versions_review_notes_len
      check (review_notes is null or char_length(review_notes) <= 1000);
  end if;
end $$;

comment on column public.flow_versions.checklist is
  'Checklist de homologacao (§21): { item: { checked, by, at } }. A forma vive em flow.checklist.ts.';
comment on column public.flow_versions.review_notes is
  'O motivo da REPROVACAO (§22). Preenchido por advance_flow_version quando volta de pending_approval.';


-- ----------------------------------------------------------------------------
-- 4. §21 — gravar o checklist
-- ----------------------------------------------------------------------------
-- ⚠️ FUNÇÃO, E NÃO UM GRANT DE COLUNA. O checklist registra QUEM CONFERIU, e
-- deixar `authenticated` escrevê-lo pelo PostgREST permitiria a qualquer um
-- gravar `{ by: "outra pessoa" }`. Aqui o autor sai de `auth.uid()`, que
-- ninguém do lado de fora escolhe.
create or replace function public.set_flow_version_checklist(
  p_version_id uuid,
  p_checklist jsonb
)
returns public.flow_versions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_version public.flow_versions;
begin
  if not public.flow_is_writer() then
    raise exception 'Sem permissao para alterar fluxos.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_checklist) is distinct from 'object' then
    raise exception 'O checklist precisa ser um objeto.' using errcode = '22023';
  end if;

  -- ⚠️ VERSÃO PUBLICADA NÃO RECEBE CHECKLIST NOVO. Ela já foi ao ar; marcar um
  -- item depois disso reescreveria a história da homologação que autorizou a
  -- publicação — que é justamente o registro que o §21 existe para produzir.
  select * into v_version from public.flow_versions v where v.id = p_version_id;
  if v_version.id is null then
    raise exception 'Versao nao encontrada.' using errcode = 'P0002';
  end if;

  if v_version.status in ('published', 'superseded') then
    raise exception 'Uma versao ja publicada nao aceita mudanca no checklist.'
      using errcode = 'FL005';
  end if;

  update public.flow_versions v
  set checklist = p_checklist,
      updated_by = (select auth.uid()),
      updated_at = now()
  where v.id = p_version_id
  returning * into v_version;

  perform public.log_admin_action(
    'flow_version_checked',
    (select f.name from public.flows f where f.id = v_version.flow_id),
    jsonb_build_object(
      'flowId', v_version.flow_id,
      'versionId', v_version.id,
      'version', v_version.version,
      -- ⚠️ QUANTOS, E NÃO QUAIS. A trilha guarda o progresso; o conteúdo do
      -- checklist está na própria versão. Copiá-lo aqui criaria uma segunda
      -- cópia que envelhece.
      'marcados', (
        select count(*) from jsonb_each(p_checklist) e
        where (e.value ->> 'checked')::boolean is true
      )
    )
  );

  return v_version;
end;
$fn$;

comment on function public.set_flow_version_checklist(uuid, jsonb) is
  'Grava o checklist de homologacao (§21). O autor sai de auth.uid(), nunca do payload.';

revoke execute on function public.set_flow_version_checklist(uuid, jsonb)
  from public, anon;


-- ----------------------------------------------------------------------------
-- 5. §22 — a mudança de situação, agora com motivo
-- ----------------------------------------------------------------------------
-- ⚠️ O `drop` É OBRIGATÓRIO. `create or replace` com um parâmetro a mais cria
-- uma SOBRECARGA: as duas conviveriam, e o PostgREST escolheria pela forma da
-- chamada. Metade das reprovações gravaria o motivo e a outra metade não, sem
-- nada falhar.
drop function if exists public.advance_flow_version(uuid, public.flow_version_status);

create or replace function public.advance_flow_version(
  p_version_id uuid,
  p_to public.flow_version_status,
  p_reason text default null
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
  v_reprovacao boolean;
  v_reason text;
begin
  if not public.flow_is_writer() then
    raise exception 'Sem permissao para alterar fluxos.' using errcode = '42501';
  end if;

  select * into v_before from public.flow_versions v where v.id = p_version_id;
  if v_before.id is null then
    raise exception 'Versao nao encontrada.' using errcode = 'P0002';
  end if;

  if not (
    (v_before.status = 'draft' and p_to = 'testing')
    or (v_before.status = 'testing' and p_to in ('draft', 'pending_approval'))
    or (v_before.status = 'pending_approval' and p_to in ('draft', 'approved'))
    or (v_before.status = 'approved' and p_to = 'draft')
  ) then
    raise exception 'Esta mudanca de situacao nao e permitida para a versao.'
      using errcode = 'FL002';
  end if;

  -- §22. REPROVAR é sair de "aguardando aprovação" de volta para rascunho. Sair
  -- de `testing` ou de `approved` para rascunho é outra coisa — é quem desenhou
  -- decidindo mexer —, e não pede motivo de ninguém.
  v_reprovacao := (v_before.status = 'pending_approval' and p_to = 'draft');
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  if v_reprovacao and v_reason is null then
    -- ⚠️ RECUSAR A REPROVAÇÃO SEM MOTIVO é o ponto inteiro do §22. Sem isto, a
    -- pessoa que desenhou recebe a versão de volta sabendo apenas que alguém
    -- não gostou — e a próxima tentativa é adivinhação.
    raise exception 'Diga o motivo da reprovacao.' using errcode = 'FL006';
  end if;

  update public.flow_versions v
  set status = p_to,
      -- O motivo fica na versão REPROVADA, que é onde quem for corrigi-la vai
      -- procurar. Qualquer outro avanço o limpa: um motivo antigo pendurado
      -- numa versão já corrigida é pior que nenhum.
      review_notes = case when v_reprovacao then v_reason else null end,
      reviewed_by = case when v_reprovacao or p_to = 'approved' then (select auth.uid()) else null end,
      reviewed_at = case when v_reprovacao or p_to = 'approved' then now() else null end,
      updated_by = (select auth.uid()),
      updated_at = now()
  where v.id = p_version_id
  returning * into v_after;

  v_action := case
    when v_reprovacao then 'flow_version_rejected'
    when p_to = 'testing' then 'flow_version_tested'
    when p_to = 'pending_approval' then 'flow_version_submitted'
    when p_to = 'approved' then 'flow_version_approved'
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
      'para', p_to,
      -- ⚠️ O MOTIVO ENTRA NA TRILHA, e não só na coluna. A coluna é limpa no
      -- avanço seguinte (ver acima); a trilha é o que responde "por que a v4
      -- foi reprovada em setembro" depois de a v4 ter sido corrigida e
      -- publicada.
      'motivo', v_reason
    )
  );

  return v_after;
end;
$fn$;

comment on function public.advance_flow_version(uuid, public.flow_version_status, text) is
  'Move a versao no ciclo de vida (§4). Reprovar (pending_approval -> draft) EXIGE motivo (§22).';

revoke execute on function public.advance_flow_version(uuid, public.flow_version_status, text)
  from public, anon;


-- ----------------------------------------------------------------------------
-- 6. §30 e §35 — o commit do passo, com intenção, laço e carimbo de SLA
-- ----------------------------------------------------------------------------
-- ⚠️ MESMO MOTIVO DO `drop` ANTERIOR: três parâmetros a mais criariam uma
-- sobrecarga silenciosa.
--
-- ⚠️ E OS CARIMBOS SÃO DERIVADOS, e não parâmetros. `assigned_at` é "a hora em
-- que o status virou handed_off", e essa informação já está em `p_run_status`.
-- Recebê-la de fora seria deixar quem chama escolher a hora — e um relógio de
-- aplicação atrasado transformaria o SLA numa ficção.
drop function if exists public.flow_commit_step(
  bigint, integer, uuid, public.flow_run_status, public.flow_conversation_status,
  jsonb, integer, text, public.flow_step_status, jsonb, text, text, jsonb
);

create or replace function public.flow_commit_step(
  p_step_id bigint,
  p_lock_version integer,
  p_current_node_id uuid,
  p_run_status public.flow_run_status,
  p_conversation_status public.flow_conversation_status,
  p_variables jsonb,
  p_attempt_count integer,
  p_team_key text default null,
  p_step_status public.flow_step_status default 'succeeded',
  p_output jsonb default '{}'::jsonb,
  p_error text default null,
  p_failure_reason text default null,
  p_events jsonb default '[]'::jsonb,
  -- §30/§47. A leitura da IA, para a trilha e para as métricas. NULL significa
  -- "não houve leitura neste turno" — e nesse caso a anterior é PRESERVADA, e
  -- não apagada: a pergunta "o que a IA entendeu nesta conversa" tem uma
  -- resposta só, a da vez em que ela leu.
  p_intent text default null,
  p_intent_confidence numeric default null,
  -- §10. Quantos nós ESTE turno atravessou. Soma no contador da conversa.
  p_nodes_walked integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_run_id uuid;
  v_team_id uuid;
  v_evento jsonb;
  v_intent text;
begin
  select s.flow_run_id into v_run_id
  from public.flow_run_steps s
  where s.id = p_step_id;

  if v_run_id is null then
    raise exception 'Passo nao encontrado.' using errcode = 'P0002';
  end if;

  if p_team_key is not null then
    select t.id into v_team_id
    from public.attendance_teams t
    where t.key = p_team_key and t.status = 'active';
  end if;

  -- ⚠️ O FORMATO DA INTENÇÃO É CONFERIDO AQUI, e não confiado a quem chama. A
  -- coluna tem um CHECK (`flow_runs_intent_format`), e uma violação dele
  -- derrubaria o commit inteiro — perdendo o passo, os eventos e o avanço por
  -- causa de um campo acessório. Vale mais gravar nulo.
  v_intent := case
    when p_intent is not null and p_intent ~ '^[a-z_]{3,40}$' then p_intent
    else null
  end;

  update public.flow_runs r
  set current_node_id = p_current_node_id,
      status = p_run_status,
      conversation_status = p_conversation_status,
      variables = p_variables,
      attempt_count = p_attempt_count,
      assigned_team_id = coalesce(v_team_id, r.assigned_team_id),
      intent = coalesce(v_intent, r.intent),
      intent_confidence = case
        when v_intent is not null then p_intent_confidence
        else r.intent_confidence
      end,
      node_executions = least(r.node_executions + greatest(coalesce(p_nodes_walked, 0), 0), 2000),
      -- §35. O RELÓGIO DO SLA COMEÇA NA PRIMEIRA VEZ que a conversa entra numa
      -- fila. `coalesce` e não sobrescrita: uma conversa devolvida ao robô e
      -- transferida de novo continua contando do primeiro pedido, que é quando
      -- a pessoa começou a esperar.
      assigned_at = case
        when p_run_status = 'handed_off' then coalesce(r.assigned_at, now())
        else r.assigned_at
      end,
      -- O prazo que valia NO MOMENTO da transferência, congelado. Mudar o SLA
      -- do time amanhã não pode reescrever se o de ontem foi cumprido.
      sla_minutes = case
        when p_run_status = 'handed_off' and r.sla_minutes is null and v_team_id is not null
          then (select t.sla_minutes from public.attendance_teams t where t.id = v_team_id)
        else r.sla_minutes
      end,
      failure_reason = p_failure_reason,
      last_activity_at = now(),
      completed_at = case
        when p_run_status in ('completed', 'failed', 'cancelled') then coalesce(r.completed_at, now())
        else null
      end,
      lock_version = r.lock_version + 1,
      updated_at = now()
  where r.id = v_run_id
    and r.lock_version = p_lock_version;

  -- ⚠️ `not found`, E NÃO `get diagnostics` — é a forma que a versão anterior
  -- desta função usava, e `src/test/sql-flow-engine.test.ts` guarda a
  -- PROPRIEDADE (recusar em silêncio, devolvendo false) procurando por ela.
  --
  -- As duas fariam a mesma coisa. Manter a mesma é o que impede uma reescrita
  -- de parecer uma mudança de comportamento para quem lê o diff — e foi
  -- exatamente assim que o teste pegou esta função quando ela foi recriada.
  if not found then
    return false;
  end if;

  update public.flow_run_steps s
  set status = p_step_status,
      output = p_output,
      error = p_error,
      completed_at = now(),
      duration_ms = greatest(0, (extract(epoch from (now() - s.started_at)) * 1000)::integer)
  where s.id = p_step_id;

  for v_evento in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb))
  loop
    insert into public.flow_run_events (flow_run_id, type, node_id, payload)
    values (
      v_run_id,
      (v_evento ->> 'type')::public.flow_event_type,
      nullif(v_evento ->> 'nodeId', '')::uuid,
      coalesce(v_evento -> 'payload', '{}'::jsonb)
    );
  end loop;

  return true;
end;
$fn$;

comment on function public.flow_commit_step is
  'Grava o avanco sob trava otimista (§24). Carimba SLA (§35), soma o laco (§10) e guarda a intencao (§30).';

revoke execute on function public.flow_commit_step(
  bigint, integer, uuid, public.flow_run_status, public.flow_conversation_status,
  jsonb, integer, text, public.flow_step_status, jsonb, text, text, jsonb,
  text, numeric, integer
) from public, anon, authenticated;

grant execute on function public.flow_commit_step(
  bigint, integer, uuid, public.flow_run_status, public.flow_conversation_status,
  jsonb, integer, text, public.flow_step_status, jsonb, text, text, jsonb,
  text, numeric, integer
) to service_role;


-- ----------------------------------------------------------------------------
-- 7. §35 — a primeira resposta humana, por GATILHO
-- ----------------------------------------------------------------------------
-- ⚠️ GATILHO, E NÃO UMA CHAMADA NA APLICAÇÃO. "Quando um atendente respondeu"
-- precisa valer para TODO caminho que produz uma resposta humana: a caixa de
-- entrada do CRM hoje, uma tela nova amanhã, um disparo pela API. Uma chamada
-- em código valeria para os caminhos que alguém lembrou de instrumentar — e a
-- métrica de SLA ficaria otimista, contando como "sem resposta" conversas que
-- foram respondidas por uma porta não instrumentada.
--
-- ⚠️ `origin = 'agent'` É A DEFINIÇÃO INTEIRA. `direction = 'outbound'` inclui o
-- robô, e o robô respondendo não é atendimento humano — contá-lo zeraria o SLA
-- de toda conversa transferida no instante seguinte à transferência, que é
-- justamente quando a mensagem "vou te encaminhar" sai.
create or replace function public.flow_mark_human_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.flow_runs r
  set first_response_at = now()
  where r.whatsapp_chat_id = new.chat_id
    and r.assigned_at is not null
    and r.first_response_at is null
    -- Só a execução ABERTA. Uma conversa antiga, já encerrada, não recebe
    -- carimbo por causa de uma mensagem de hoje.
    and r.status in ('running', 'waiting_reply', 'handed_off');

  return null;
end;
$fn$;

comment on function public.flow_mark_human_response() is
  'Carimba first_response_at quando uma PESSOA responde (§35). origin = agent, nunca o robo.';

drop trigger if exists whatsapp_messages_flow_sla on public.whatsapp_messages;

create trigger whatsapp_messages_flow_sla
  after insert on public.whatsapp_messages
  for each row
  when (new.direction = 'outbound' and new.origin = 'agent')
  execute function public.flow_mark_human_response();


-- ----------------------------------------------------------------------------
-- 8. §35 — encerrar o atendimento humano
-- ----------------------------------------------------------------------------
create or replace function public.flow_resolve_run(
  p_run_id uuid,
  p_conversation_status public.flow_conversation_status default 'resolved'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_atualizou integer;
begin
  if not public.flow_is_writer() then
    raise exception 'Sem permissao para alterar fluxos.' using errcode = '42501';
  end if;

  if p_conversation_status not in ('resolved', 'closed') then
    raise exception 'Encerramento aceita apenas resolved ou closed.' using errcode = '22023';
  end if;

  update public.flow_runs r
  set conversation_status = p_conversation_status,
      resolved_at = coalesce(r.resolved_at, now()),
      status = 'completed',
      completed_at = coalesce(r.completed_at, now()),
      lock_version = r.lock_version + 1,
      updated_at = now()
  where r.id = p_run_id
    and r.status in ('running', 'waiting_reply', 'handed_off');

  get diagnostics v_atualizou = row_count;

  if v_atualizou > 0 then
    insert into public.flow_run_events (flow_run_id, type, payload)
    values (p_run_id, 'flow_completed', jsonb_build_object('por', 'atendente'));
  end if;

  return v_atualizou > 0;
end;
$fn$;

comment on function public.flow_resolve_run(uuid, public.flow_conversation_status) is
  'Fecha o atendimento humano e carimba resolved_at (§35). Idempotente: a segunda chamada devolve false.';

revoke execute on function public.flow_resolve_run(uuid, public.flow_conversation_status)
  from public, anon;


-- ----------------------------------------------------------------------------
-- 9. §29 a §33 — os indicadores
-- ----------------------------------------------------------------------------
-- ⚠️ UMA FUNÇÃO, E NÃO SEIS CONSULTAS NO NODE. Cada indicador isolado seria uma
-- ida ao banco varrendo a mesma tabela; e "taxa de fallback" calculada no
-- cliente exigiria trazer TODAS as execuções do período para contá-las em
-- memória. Em seis meses isso é a página de monitoramento derrubando o
-- servidor.
--
-- ⚠️ `stable` E SÓ LEITURA. Ela pode ser chamada pela tela sem risco de escrita.
create or replace function public.flow_metrics(
  p_flow_id uuid default null,
  p_days integer default 30
)
returns table (
  flow_id uuid,
  flow_name text,
  started bigint,
  completed bigint,
  handed_off bigint,
  failed bigint,
  abandoned bigint,
  fallback_runs bigint,
  avg_duration_seconds numeric,
  avg_confidence numeric,
  identified_intent bigint
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with janela as (
    select greatest(coalesce(p_days, 30), 1) as dias
  ),
  execucoes as (
    select r.*
    from public.flow_runs r, janela j
    where r.started_at >= now() - make_interval(days => j.dias)
      and (p_flow_id is null or r.flow_id = p_flow_id)
  )
  select
    f.id,
    f.name,
    count(e.id),
    count(e.id) filter (where e.status = 'completed'),
    count(e.id) filter (where e.assigned_at is not null),
    count(e.id) filter (where e.status = 'failed'),
    -- ⚠️ ABANDONO É O QUE NÃO TERMINOU E PAROU DE FALAR. Sem o corte de tempo,
    -- toda conversa em andamento contaria como abandonada — inclusive a que
    -- começou há dois minutos.
    count(e.id) filter (
      where e.status in ('running', 'waiting_reply')
        and e.last_activity_at < now() - interval '24 hours'
    ),
    -- §31. Quantas passaram por um caminho de fallback. O evento existe desde o
    -- Prompt 3; o que faltava era alguém perguntar.
    count(distinct ev.flow_run_id) filter (where ev.type = 'answer_rejected'),
    avg(extract(epoch from (coalesce(e.completed_at, e.last_activity_at) - e.started_at)))
      filter (where e.status = 'completed'),
    avg(e.intent_confidence) filter (where e.intent is not null),
    count(e.id) filter (where e.intent is not null)
  from public.flows f
  left join execucoes e on e.flow_id = f.id
  left join public.flow_run_events ev on ev.flow_run_id = e.id
  where p_flow_id is null or f.id = p_flow_id
  group by f.id, f.name
  order by count(e.id) desc, f.name;
$fn$;

comment on function public.flow_metrics(uuid, integer) is
  'Indicadores por fluxo (§29, §30). Somente leitura; agrega no banco para a tela nao trazer as execucoes.';

revoke execute on function public.flow_metrics(uuid, integer) from public, anon;


-- ----------------------------------------------------------------------------
-- 10. §33 — a visão de erros
-- ----------------------------------------------------------------------------
create or replace function public.flow_error_totals(
  p_days integer default 30,
  p_limit integer default 50
)
returns table (
  flow_id uuid,
  flow_name text,
  node_id uuid,
  node_type public.flow_node_type,
  failure_reason text,
  occurrences bigint,
  last_seen timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    r.flow_id,
    f.name,
    s.node_id,
    s.node_type,
    -- O motivo do MOTOR quando há, senão o do passo. Nunca a frase técnica
    -- crua: `error` pode conter mensagem de fornecedor, e a tela agrupa por
    -- motivo — não por texto de exceção.
    coalesce(r.failure_reason, s.status::text),
    count(*),
    max(s.completed_at)
  from public.flow_run_steps s
  join public.flow_runs r on r.id = s.flow_run_id
  join public.flows f on f.id = r.flow_id
  where s.status = 'failed'
    and s.started_at >= now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
  group by r.flow_id, f.name, s.node_id, s.node_type, coalesce(r.failure_reason, s.status::text)
  order by count(*) desc, max(s.completed_at) desc
  limit greatest(coalesce(p_limit, 50), 1);
$fn$;

comment on function public.flow_error_totals(integer, integer) is
  'Erros agrupados por fluxo, no e motivo (§33). Somente leitura.';

revoke execute on function public.flow_error_totals(integer, integer) from public, anon;


-- ----------------------------------------------------------------------------
-- 11. §35 — a fila com SLA, para a tela de atendimento
-- ----------------------------------------------------------------------------
create or replace function public.flow_sla_queue(p_limit integer default 100)
returns table (
  run_id uuid,
  flow_name text,
  team_key text,
  team_name text,
  whatsapp_chat_id uuid,
  assigned_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  sla_minutes integer,
  minutes_waiting integer,
  breached boolean
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    r.id,
    f.name,
    t.key,
    t.name,
    r.whatsapp_chat_id,
    r.assigned_at,
    r.first_response_at,
    r.resolved_at,
    r.sla_minutes,
    (extract(epoch from (coalesce(r.first_response_at, now()) - r.assigned_at)) / 60)::integer,
    -- ⚠️ SEM PRAZO NÃO HÁ VIOLAÇÃO. Um time sem `sla_minutes` não é um time que
    -- descumpre sempre: é um time para o qual a APCS não definiu prazo. Tratar
    -- NULL como zero encheria a tela de vermelho sem significado.
    r.sla_minutes is not null
      and coalesce(r.first_response_at, now()) > r.assigned_at + make_interval(mins => r.sla_minutes)
  from public.flow_runs r
  join public.flows f on f.id = r.flow_id
  left join public.attendance_teams t on t.id = r.assigned_team_id
  where r.assigned_at is not null
  order by r.first_response_at is not null, r.assigned_at
  limit greatest(coalesce(p_limit, 100), 1);
$fn$;

comment on function public.flow_sla_queue(integer) is
  'A fila de conversas transferidas, com espera e violacao de prazo (§35). Somente leitura.';

revoke execute on function public.flow_sla_queue(integer) from public, anon;


-- ----------------------------------------------------------------------------
-- 12. Os grants de coluna — a armadilha do `events.description`
-- ----------------------------------------------------------------------------
-- ⚠️ OBRIGATÓRIO E FÁCIL DE ESQUECER. `attendance_teams` e `flow_versions` têm
-- `revoke update` seguido de `grant update (colunas)`. Uma coluna que não
-- aparece na lista não pode ser escrita por `authenticated`, e o sintoma é
-- 42501 — que a tela mostra como "Você não tem permissão", para um
-- administrador com todas as permissões.
--
-- `src/test/sql-column-grants.test.ts` guarda esta porta.
--
-- ⚠️ `flow_versions.checklist` NÃO ENTRA NA LISTA, e a ausência é deliberada:
-- ele é escrito por `set_flow_version_checklist`, que carimba o autor a partir
-- de `auth.uid()`. Concedê-lo aqui abriria o caminho pelo PostgREST, onde
-- qualquer um poderia gravar que outra pessoa conferiu. O mesmo vale para
-- `review_notes`, `reviewed_by` e `reviewed_at`, que são de
-- `advance_flow_version`.
grant update (
  name, description, status, sla_minutes, business_hours, updated_by, updated_at
) on public.attendance_teams to authenticated;


-- ============================================================================
-- ROLLBACK
-- ============================================================================
--   drop trigger if exists whatsapp_messages_flow_sla on public.whatsapp_messages;
--   drop function if exists public.flow_mark_human_response();
--   drop function if exists public.flow_sla_queue(integer);
--   drop function if exists public.flow_error_totals(integer, integer);
--   drop function if exists public.flow_metrics(uuid, integer);
--   drop function if exists public.flow_resolve_run(uuid, public.flow_conversation_status);
--   drop function if exists public.set_flow_version_checklist(uuid, jsonb);
--
--   -- ⚠️ AS DUAS RECRIADAS PRECISAM VOLTAR À ASSINATURA ANTIGA, e não apenas
--   -- ser derrubadas: `store.ts` e a action de avançar chamam por nome. Ver o
--   -- corpo original em 20260919000000 e 20260917000100.
--   drop function if exists public.flow_commit_step(bigint, integer, uuid, public.flow_run_status, public.flow_conversation_status, jsonb, integer, text, public.flow_step_status, jsonb, text, text, jsonb, text, numeric, integer);
--   drop function if exists public.advance_flow_version(uuid, public.flow_version_status, text);
--
--   alter table public.flow_versions
--     drop column if exists checklist,
--     drop column if exists review_notes,
--     drop column if exists reviewed_by,
--     drop column if exists reviewed_at;
--   alter table public.flow_runs
--     drop column if exists assigned_at,
--     drop column if exists first_response_at,
--     drop column if exists resolved_at,
--     drop column if exists sla_minutes,
--     drop column if exists node_executions;
--   alter table public.attendance_teams
--     drop column if exists sla_minutes,
--     drop column if exists business_hours;
-- ============================================================================
