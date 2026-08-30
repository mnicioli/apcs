-- ============================================================================
-- A CONFERÊNCIA: editar o nome de um usuário funciona de ponta a ponta?
-- ============================================================================
--
-- ⚠️ ESTA MIGRATION NÃO MUDA NADA. Ela EXERCITA o caminho que estava falhando e
-- desfaz o que escreveu. Ou ela passa — e o defeito era o enum que
-- 20260910000000 acabou de reafirmar —, ou ela falha mostrando o SQLSTATE e a
-- mensagem REAIS do banco.
--
-- Isso é deliberado. O relato foi "Ocorreu um erro inesperado. Tente novamente."
-- — a mensagem que aparece quando o mapa de erros não conhece o código, e que
-- não deixa ninguém descobrir nada. Uma correção que dependesse de eu ter
-- adivinhado certo deixaria o próximo passo sendo outro palpite. Assim, rodar
-- isto responde a pergunta em qualquer um dos dois casos.
--
-- ⚠️ POR QUE NÃO CHAMAR `update_user_profile` DIRETO: ela começa com
-- `if not public.is_admin()`. Numa migration não há `auth.uid()`, então a
-- chamada morreria no portão de permissão sem chegar perto do trecho suspeito.
-- O que este arquivo faz é executar os DOIS comandos que ela executa depois do
-- portão — o UPDATE em `profiles` e o registro na trilha — que é onde o erro
-- mora.
--
-- DEPENDE DE: 20260910000000_admin_audit_enum_repair.sql,
--             20260831000100_admin_users.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Os verbos existem?
-- ----------------------------------------------------------------------------
-- Pergunta ao catálogo, e não ao acaso. Se o arquivo anterior não rodou, é aqui
-- que se descobre — com o nome do que falta, não com "erro inesperado".
do $verbos$
declare
  v_faltando text[] := '{}';
  v_valor text;
begin
  foreach v_valor in array array[
    'user_updated', 'user_deactivated', 'user_reactivated', 'user_password_reset'
  ] loop
    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'admin_audit_action'
        and e.enumlabel = v_valor
    ) then
      v_faltando := v_faltando || v_valor;
    end if;
  end loop;

  if cardinality(v_faltando) > 0 then
    raise exception
      'admin_audit_action ainda nao tem: %. Aplique 20260910000000_admin_audit_enum_repair.sql antes deste arquivo.',
      array_to_string(v_faltando, ', ');
  end if;

  raise notice 'admin_audit_action: os quatro verbos de usuario estao no enum.';
end;
$verbos$;

-- ----------------------------------------------------------------------------
-- 2. O caminho inteiro, executado e desfeito
-- ----------------------------------------------------------------------------
-- ⚠️ ESCREVE DE VERDADE, e é isso que dá valor à conferência. Um teste que só
-- lesse o catálogo não planejaria o cast nem tocaria nos gatilhos de `profiles`
-- (`profiles_sync_role_key`, `prevent_role_escalation`) nem na FK da trilha — e
-- o defeito que estamos caçando é justamente de um comando que nunca tinha sido
-- executado.
--
-- A subtransação com `raise ... using errcode = 'ZZ999'` desfaz tudo o que o
-- bloco escreveu. É a mesma técnica de 20260906000000 e 20260907000000.
do $exercicio$
declare
  v_id uuid;
  v_estado text;
  v_mensagem text;
  v_detalhe text;
begin
  select p.id into v_id from public.profiles p order by p.created_at, p.id limit 1;

  if v_id is null then
    raise notice 'Nenhum usuario cadastrado — nada a exercitar.';
    return;
  end if;

  begin
    -- O UPDATE que `update_user_profile` faz. Grava os mesmos valores: o que
    -- interessa é que a ESCRITA aconteça (gatilhos, privilegios, constraints),
    -- não que o conteudo mude.
    update public.profiles p
    set full_name = p.full_name,
        email = p.email
    where p.id = v_id;

    -- E o registro na trilha, que é o comando sob suspeita.
    perform public.log_admin_action(
      'user_updated'::public.admin_audit_action,
      'verificacao-da-migration',
      jsonb_build_object('changed', to_jsonb(array['full_name']))
    );

    raise exception 'desfaz' using errcode = 'ZZ999';
  exception
    when sqlstate 'ZZ999' then
      -- O esperado: chegou ao fim e desfez o que escreveu.
      null;
    when others then
      get stacked diagnostics
        v_estado = returned_sqlstate,
        v_mensagem = message_text,
        v_detalhe = pg_exception_detail;

      raise exception
        'Editar o nome de um usuario AINDA falha. SQLSTATE % — % %',
        v_estado, v_mensagem, coalesce('(' || v_detalhe || ')', '')
        using hint =
          'Este e o erro que a tela mostrava como "Ocorreu um erro inesperado". Mande esta linha para quem for corrigir.';
  end;

  raise notice 'Editar nome de usuario: caminho completo exercitado e desfeito com sucesso.';
end;
$exercicio$;

-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- Não há o que desfazer: este arquivo não deixa nada gravado.
-- ============================================================================
