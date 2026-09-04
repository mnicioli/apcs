-- ============================================================================
-- FLOW BUILDER — o que o desenhador visual exigiu do banco
-- ============================================================================
--
-- O Prompt 2 (o Builder) não acrescenta tabela nenhuma: nó e transição já
-- guardam configuração em jsonb, e foi para isto que aquele jsonb existe — os
-- campos novos (tipo de pergunta, anexo, atraso, SLA, prioridade) entram sem
-- migration, validados por Zod em `flow.schema.ts`.
--
-- Duas coisas, porém, NÃO cabem em jsonb, porque são comportamento do banco:
--
--   1. A validação precisava aprender que existe pergunta SEM alternativa.
--   2. A auditoria precisava parar de gravar uma linha por arrastar de mouse.
--
-- DEPENDE DE: 20260917000100_flows.sql
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. A validação aprende os cinco tipos de pergunta
-- ----------------------------------------------------------------------------
-- ⚠️ O QUE MUDOU, E POR QUE ERA UM DEFEITO DE VERDADE.
--
-- A versão anterior exigia duas alternativas de TODA pergunta. O Builder
-- introduziu `kind`, e com ele duas perguntas que não têm alternativa nenhuma:
--
--     free_text   "Qual o seu nome?"        a resposta É o valor
--     number      "Quantos animais?"        a resposta É o valor
--
-- Com a regra antiga, um fluxo perfeitamente correto que perguntasse o nome do
-- associado seria RECUSADO na publicação, com a frase "não tem alternativas
-- configuradas" — mandando a pessoa configurar alternativas numa pergunta que
-- por definição não tem.
--
-- `yes_no` também sai da conta: as duas alternativas dele são fixas (SIM/NAO) e
-- não são escritas no desenho, justamente para que a mesma chave valha em todo
-- fluxo do sistema.
--
-- ⚠️ E ELA GANHOU UMA REGRA NOVA: pergunta de texto livre com MAIS DE UMA saída.
-- O motor grava a variável e segue pela única saída — se houver duas, a segunda
-- nunca executa, e o desenho mente sobre o que faz. É o mesmo tipo de defeito
-- silencioso da chave de alternativa repetida.
create or replace function public.validate_flow_version(p_version_id uuid)
returns table (code text, detail text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_flow_id uuid;
begin
  select v.flow_id into v_flow_id
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

  -- 2. Sem nó final, toda conversa fica em aberto para sempre — e ninguém
  --    percebe, porque uma conversa parada é indistinguível de uma demorada.
  if not exists (
    select 1 from public.flow_nodes n where n.flow_version_id = p_version_id and n.type = 'end'
  ) then
    return query select 'missing_end'::text, 'O fluxo precisa de ao menos um no de encerramento.'::text;
  end if;

  -- 3. Nó sem saída que não encerra nem transfere: o motor chegaria nele e
  --    pararia sem ter o que fazer.
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
  --    nada em execução — e é por isso que passa despercebido até alguém
  --    perguntar por que aquela pergunta nunca aparece.
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

  -- 5. Pergunta DE ESCOLHA sem alternativas. `coalesce(kind, 'buttons')` porque
  --    um nó desenhado antes do Builder não tem o campo — e o padrão do schema
  --    é 'buttons'.
  --
  --    ⚠️ CONTA SÓ AS PREENCHIDAS, e é a diferença entre esta regra funcionar e
  --    ela ser decorativa. O Builder cria alternativas com o rótulo em branco (a
  --    pessoa ainda vai digitar), então contar o TAMANHO da lista aprovaria uma
  --    pergunta com duas alternativas mudas — que no WhatsApp chega como uma
  --    lista de itens em branco.
  return query
    select 'question_without_options'::text,
           format('A pergunta "%s" nao tem duas alternativas preenchidas.', n.key)::text
    from public.flow_nodes n
    where n.flow_version_id = p_version_id
      and n.type = 'question'
      and coalesce(n.configuration ->> 'kind', 'buttons') in ('buttons', 'list')
      and (
        select count(*)
        from jsonb_array_elements(
          case when jsonb_typeof(n.configuration -> 'options') = 'array'
               then n.configuration -> 'options' else '[]'::jsonb end
        ) as opcao
        where btrim(coalesce(opcao ->> 'label', '')) <> ''
      ) < 2;

  -- 6. Pergunta ABERTA com mais de uma saída. O motor segue pela única saída;
  --    a segunda seta nunca executa, e o desenho passa a mentir sobre o que faz.
  return query
    select 'open_question_branches'::text,
           format('A pergunta "%s" e de resposta aberta e nao pode ter mais de uma saida.', n.key)::text
    from public.flow_nodes n
    where n.flow_version_id = p_version_id
      and n.type = 'question'
      and coalesce(n.configuration ->> 'kind', 'buttons') in ('free_text', 'number')
      and (
        select count(*) from public.flow_transitions t
        where t.flow_version_id = p_version_id and t.source_node_id = n.id
      ) > 1;

  -- 7. Mensagem ou pergunta SEM TEXTO.
  --
  --    ⚠️ ESTA REGRA NASCEU COM O BUILDER, E ELA COBRE UM BURACO QUE SÓ APARECEU
  --    QUANDO A GRAVAÇÃO AFROUXOU. Enquanto o Zod exigia texto não vazio, um nó
  --    mudo não chegava ao banco; mas aquela exigência impedia a criação da
  --    caixinha no canvas (a pessoa ainda não escreveu nada ao arrastá-la), e
  --    por isso ela caiu.
  --
  --    Sem esta conferência, o vazio passaria despercebido até o atendimento: o
  --    motor usa o NOME do nó como texto quando não há texto — e a pessoa do
  --    outro lado receberia "Mensagem 3" no WhatsApp.
  return query
    select 'empty_message'::text,
           format('A etapa "%s" nao tem texto para enviar.', n.key)::text
    from public.flow_nodes n
    where n.flow_version_id = p_version_id
      and n.type in ('message', 'question')
      and btrim(coalesce(n.configuration ->> 'text', '')) = '';

  -- 8. Transferir para um time que não existe (ou que foi desativado) é uma
  --    conversa que entra numa fila que ninguém abre.
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
  'As regras do §19 + os tipos de pergunta do Builder. Lista vazia significa publicavel.';

revoke execute on function public.validate_flow_version(uuid) from public, anon;
grant execute on function public.validate_flow_version(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 2. A auditoria para de gravar o arrastar do mouse
-- ----------------------------------------------------------------------------
-- ⚠️ SEM ISTO, O AUTO SAVE DO BUILDER AFOGA A TRILHA.
--
-- Arrastar um nó pelo canvas grava `position`. Com o salvamento automático do
-- §14, isso acontece a cada pausa de digitação — e cada gravação virava uma
-- linha `flow_node_changed` em `admin_audit_logs`. Uma tarde reorganizando um
-- fluxo de trinta nós produziria centenas de linhas dizendo "etapa alterada",
-- todas verdadeiras e nenhuma útil.
--
-- O efeito colateral é pior que o volume: a trilha existe para responder "o que
-- mudou no fluxo?", e ela passaria a responder "alguém mexeu no layout". A
-- resposta certa some no meio do ruído.
--
-- A regra é estreita de propósito — só sai da trilha o UPDATE em que
-- EXCLUSIVAMENTE a posição mudou. Mexer no texto e arrastar no mesmo salvamento
-- continua sendo registrado.
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
  -- ⚠️ A SAÍDA ANTECIPADA DO ARRASTAR. Vem antes de tudo porque é o caso mais
  -- frequente do Builder, e porque montar `v_meta` para descartar em seguida
  -- seria trabalho jogado fora a cada 800ms de quem está desenhando.
  if tg_table_name = 'flow_nodes' and tg_op = 'UPDATE'
     and new.position is distinct from old.position
     and (new.key, new.name, new.type, new.configuration, new.is_start)
         is not distinct from (old.key, old.name, old.type, old.configuration, old.is_start)
  then
    return null;
  end if;

  -- `flows` e `attendance_teams` só têm gatilho de INSERT/UPDATE: `new` sempre
  -- existe nas duas.
  --
  -- ⚠️ E EM DELETE O PL/pgSQL NÃO ATRIBUI `new` — lê-lo levanta "record new is
  -- not assigned yet", e não devolve nulo. Por isso cada tabela que aceita
  -- DELETE tem os dois ramos escritos por extenso, e não um
  -- `coalesce(new.x, old.x)`, que é mais curto e quebraria toda exclusão.
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
  'Escreve a trilha dos fluxos. Ignora o UPDATE que so move o no no canvas — ver a secao 2 de 20260918000000.';


-- ============================================================================
-- A CONFERÊNCIA
-- ============================================================================
do $conferencia$
begin
  -- A função nova precisa continuar executável por quem abre a tela: ela é o
  -- que alimenta a lista de pendências do botão de publicar. Foi exatamente
  -- este privilégio que 20260912000000 perdeu, num módulo diferente.
  if not has_function_privilege('authenticated', 'public.validate_flow_version(uuid)', 'EXECUTE') then
    raise exception 'authenticated nao pode executar validate_flow_version — a tela nao mostraria as pendencias.';
  end if;

  -- Os cinco gatilhos continuam apontando para `flow_audit`? Um
  -- `create or replace function` não os derruba, mas conferir é barato e o
  -- oposto — descobrir que a trilha parou — é caro.
  if (select count(*) from pg_trigger where tgname in (
        'on_flows_audit', 'on_attendance_teams_audit', 'on_attendance_team_members_audit',
        'on_flow_nodes_audit', 'on_flow_transitions_audit'
      )) <> 5 then
    raise exception 'Faltam gatilhos de auditoria dos fluxos — a trilha estaria muda.';
  end if;

  raise notice 'Flow Builder: validacao e auditoria atualizadas.';
end;
$conferencia$;


-- ============================================================================
-- ROLLBACK (manual)
-- ----------------------------------------------------------------------------
--   Reaplique as secoes 10 e 17 de 20260917000100_flows.sql, que contem as
--   versoes anteriores das duas funcoes. Nao ha tabela nem coluna a desfazer.
-- ============================================================================
