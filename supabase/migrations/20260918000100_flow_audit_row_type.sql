-- ============================================================================
-- 20260918000100 — O GATILHO DE AUDITORIA LIA UMA COLUNA QUE A TABELA NÃO TEM
-- ============================================================================
--
-- ⚠️ DEFEITO ENCONTRADO ABRINDO A TELA, NÃO LENDO O CÓDIGO. Criar um fluxo
-- falhava com:
--
--     42703: record "new" has no field "position"
--
-- E não era só criar fluxo: `flow_audit()` é UMA função para SEIS tabelas
-- (`flows`, `attendance_teams`, `attendance_team_members`, `flow_nodes`,
-- `flow_transitions`, `flow_versions`). O atalho do arrastar, introduzido em
-- 20260918000000, foi escrito como UMA condição só:
--
--     if tg_table_name = 'flow_nodes' and tg_op = 'UPDATE'
--        and new.position is distinct from old.position
--     then
--
-- ⚠️ E `AND` NÃO SALVA. O PL/pgSQL entrega a condição inteira ao executor como
-- uma expressão só, e para isso precisa RESOLVER `new.position` contra o tipo
-- da linha ANTES de avaliar qualquer termo. Numa inserção em `flows`, `new` é
-- um registro de `flows`, que não tem `position` — erro, antes de o primeiro
-- termo dizer "esta tabela não é flow_nodes". A ordem em que se lê a condição
-- não é a ordem em que o banco a monta.
--
-- ⚠️ POR QUE NENHUMA BARREIRA PEGOU: a migration aplica sem reclamar, porque
-- criar a função não a executa. Os testes estáticos leem SQL como texto e não
-- sabem quais colunas cada tabela tem. E o type-check do TypeScript não
-- enxerga dentro do banco. O primeiro a perceber foi o navegador.
--
-- A CORREÇÃO: dois `if` aninhados. O PL/pgSQL prepara cada expressão na
-- primeira vez que AQUELE comando roda — e o comando de dentro só roda quando o
-- de fora já garantiu que a tabela é `flow_nodes`. Nada mais muda nesta função.
--
-- ⚠️ NÃO "SIMPLIFIQUE" JUNTANDO OS DOIS `if` DE VOLTA EM UM. É exatamente o
-- defeito que este arquivo conserta.
-- ============================================================================

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
  --
  -- ⚠️ OS DOIS `if` SÃO ANINHADOS DE PROPÓSITO, E NÃO PODEM VIRAR UM SÓ. Esta
  -- função serve seis tabelas, e só `flow_nodes` tem `position`. Num `if` único
  -- o PL/pgSQL resolveria `new.position` contra o tipo da linha ANTES de avaliar
  -- o primeiro termo, e todo INSERT em `flows` morreria com 42703. Ver o
  -- cabeçalho deste arquivo.
  if tg_table_name = 'flow_nodes' and tg_op = 'UPDATE' then
    if new.position is distinct from old.position
       and (new.key, new.name, new.type, new.configuration, new.is_start)
           is not distinct from (old.key, old.name, old.type, old.configuration, old.is_start)
    then
      return null;
    end if;
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
  'Escreve a trilha dos fluxos. Ignora o UPDATE que so move o no no canvas — ver 20260918000100 para o porque dos dois if aninhados.';
