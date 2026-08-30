-- ============================================================================
-- CORREÇÃO: a estimativa de público de Enquetes não rodava para quem usa o sistema
-- ============================================================================
--
-- O SINTOMA, com os quatro públicos-alvo marcados:
--
--   • no formulário:  "Não foi possível calcular o público agora."
--   • no diálogo:     "Destinatários: não foi possível calcular"
--   • ao confirmar:   "A segmentação escolhida não alcança nenhum associado
--                      ativo com WhatsApp cadastrado."
--
-- Três mensagens, UMA causa — e nenhuma delas apontava para ela.
--
-- ----------------------------------------------------------------------------
-- A CAUSA: UM `revoke` DE 28/08 QUE EU IGNOREI EM 09/09
-- ----------------------------------------------------------------------------
-- `20260828205853_event_dispatch.sql` termina assim, e o comentário explica:
--
--     -- A auxiliar de mapeamento: usada dentro das funções acima, que rodam
--     -- como dono. Ninguém a chama de fora.
--     revoke execute on function public.profile_for_event_segment(text)
--       from public, anon, authenticated;
--     revoke execute on function public.notification_phone_key(text)
--       from public, anon, authenticated;
--
-- Era verdade quando foi escrito: as funções de divulgação são todas SECURITY
-- DEFINER, então chamavam as duas rodando como dono.
--
-- ⚠️ DEIXOU DE SER VERDADE quando `20260909000000_survey_audience_members.sql`
-- reescreveu `resolve_audience_criteria` — que é SECURITY **INVOKER**, de
-- propósito — para usar as duas. A partir daí, toda a cadeia de Enquetes que
-- passa por ela roda como `authenticated` e esbarra num `permission denied for
-- function`.
--
-- A cadeia inteira, e é ela que explica as três mensagens:
--
--     set_survey_audience  (INVOKER)          ← salvar o público
--       └─ count_survey_audience  (INVOKER)
--            └─ resolve_survey_audience  (INVOKER)
--                 └─ resolve_audience_criteria  (INVOKER)
--                      ├─ profile_for_event_segment  ✗ 42501
--                      └─ notification_phone_key     ✗ 42501
--
--     estimate_audience_criteria  (INVOKER)   ← o número da tela
--       └─ resolve_audience_criteria  →  o mesmo 42501
--
-- ⚠️ E É POR ISSO QUE A MENSAGEM FINAL MENTIA. O 42501 derruba
-- `set_survey_audience` INTEIRA, então os critérios nunca chegam a ser gravados.
-- O agendamento seguinte encontra a enquete SEM público-alvo nenhum e levanta
-- SV006 — cujo texto é "a segmentação não alcança ninguém". A tela mandava
-- revisar um público-alvo que estava certo; o que faltava era permissão para
-- executar duas funções de mapeamento.
--
-- ----------------------------------------------------------------------------
-- POR QUE GRANT, E NÃO SECURITY DEFINER
-- ----------------------------------------------------------------------------
-- A saída fácil seria marcar `resolve_audience_criteria` como SECURITY DEFINER.
-- Foi recusada: ela lê `public.members`, e o comentário dela promete
-- textualmente que "quem não pode ler associados não descobre por aqui quantos a
-- APCS tem". DEFINER apagaria essa promessa para resolver um problema de
-- privilégio de FUNÇÃO — trocaria um erro visível por um vazamento silencioso.
--
-- ⚠️ E O QUE ESTAS DUAS FUNÇÕES EXPÕEM É NADA. As duas são `immutable`, recebem
-- um texto e devolvem um texto:
--
--     profile_for_event_segment('produtores') → 'criador'   (um `case`)
--     notification_phone_key('5519999...')    → '19999...'  (os 11 últimos dígitos)
--
-- Nenhuma delas lê tabela, e a única entrada que enxergam é a que quem chamou
-- acabou de digitar. O `revoke` original era arrumação — "ninguém chama de fora"
-- —, não uma fronteira de segurança.
--
-- DEPENDE DE: 20260828205853_event_dispatch.sql, 20260909000000_survey_audience_members.sql
-- ============================================================================

grant execute on function public.profile_for_event_segment(text) to authenticated;
grant execute on function public.notification_phone_key(text) to authenticated;

comment on function public.profile_for_event_segment(text) is
  'Traduz slug de publico-alvo em perfil de associado. Chamada tambem por resolve_audience_criteria, que e SECURITY INVOKER — dai o grant a authenticated.';

comment on function public.notification_phone_key(text) is
  'Ultimos 11 digitos do telefone (DDD + celular). Chamada tambem por resolve_audience_criteria, que e SECURITY INVOKER — dai o grant a authenticated.';

-- ============================================================================
-- A CONFERÊNCIA
-- ----------------------------------------------------------------------------
-- ⚠️ A CHECAGEM DE 20260909000000 PASSOU E O RECURSO NÃO FUNCIONAVA. Ela rodava
-- `estimate_audience_criteria` como DONO da migration — que pode executar tudo.
-- A pergunta que ela fazia ("o número bate?") era boa; o usuário com que ela
-- perguntava era o errado.
--
-- Esta seção pergunta como `authenticated`, que é quem clica no botão. É a mesma
-- lição do grant de coluna de `events.description`: um privilégio só falha para
-- quem NÃO é dono da tabela — ou seja, nunca no psql de quem roda a migration,
-- sempre no navegador de quem usa o sistema.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Todas as funções da cadeia estão executáveis por quem usa o sistema
-- ----------------------------------------------------------------------------
do $privilegios$
declare
  v_assinatura text;
  v_faltando text[] := '{}';
begin
  foreach v_assinatura in array array[
    'public.estimate_audience_criteria(jsonb)',
    'public.resolve_audience_criteria(jsonb)',
    'public.resolve_survey_audience(uuid)',
    'public.count_survey_audience(uuid)',
    'public.profile_for_event_segment(text)',
    'public.notification_phone_key(text)'
  ] loop
    if not has_function_privilege('authenticated', v_assinatura, 'EXECUTE') then
      v_faltando := v_faltando || v_assinatura;
    end if;
  end loop;

  if cardinality(v_faltando) > 0 then
    raise exception
      'authenticated nao pode executar: %. A estimativa de publico devolve 42501 e o publico-alvo nao chega a ser gravado.',
      array_to_string(v_faltando, ', ');
  end if;

  raise notice 'Privilegios: as 6 funcoes da cadeia de publico estao executaveis por authenticated.';
end;
$privilegios$;

-- ----------------------------------------------------------------------------
-- 2. A estimativa roda mesmo, com o papel de quem clica
-- ----------------------------------------------------------------------------
-- ⚠️ TROCA O PAPEL DE VERDADE. Conferir o catálogo de privilégios (seção 1) diz
-- que o grant existe; só executar diz que a cadeia inteira passa. Elas respondem
-- perguntas diferentes, e foi a segunda que faltou da última vez.
--
-- O NÚMERO devolvido aqui não importa e nem seria o certo: sem um JWT,
-- `auth.uid()` é nulo, `current_app_role()` também, e a RLS de `members` recusa
-- tudo. O que importa é o erro que NÃO acontece.
do $execucao$
declare
  v_segmento uuid;
  v_estado text;
  v_mensagem text;
begin
  if not pg_has_role(current_user, 'authenticated', 'MEMBER') then
    raise notice 'Sem como assumir authenticated nesta conexao — conferencia de execucao pulada.';
    return;
  end if;

  select s.id into v_segmento
  from public.event_segments s
  where s.active and public.profile_for_event_segment(s.slug) is not null
  order by s.slug
  limit 1;

  if v_segmento is null then
    raise notice 'Nenhum publico-alvo ativo — nada a exercitar.';
    return;
  end if;

  begin
    set local role authenticated;

    perform public.estimate_audience_criteria(
      jsonb_build_array(jsonb_build_object('dimension', 'segment', 'segmentId', v_segmento))
    );

    reset role;
  exception
    when others then
      get stacked diagnostics v_estado = returned_sqlstate, v_mensagem = message_text;
      reset role;
      raise exception
        'A estimativa de publico AINDA falha para quem usa o sistema. SQLSTATE % — %',
        v_estado, v_mensagem;
  end;

  raise notice 'Estimativa de publico: executada como authenticated, sem erro de privilegio.';
end;
$execucao$;

-- ----------------------------------------------------------------------------
-- 3. E, já que estamos aqui: quantos associados o disparo alcança?
-- ----------------------------------------------------------------------------
-- ⚠️ ISTO NÃO É DECORAÇÃO. Corrigido o privilégio, a tela vai mostrar um número
-- — e se esse número for ZERO a causa é outra, do lado do CADASTRO. Estas linhas
-- dizem em qual filtro as pessoas somem, sem exigir uma segunda ida ao banco.
--
-- A ordem é a mesma de `resolve_audience_criteria`, de cima para baixo.
do $diagnostico$
declare
  v_total integer;
  v_ativos integer;
  v_com_fone integer;
  v_com_ponte integer;
  v_com_perfil integer;
  v_linha record;
begin
  select count(*) into v_total from public.members;

  select count(*) into v_ativos
  from public.members where status = 'active';

  select count(*) into v_com_fone
  from public.members
  where status = 'active'
    and length(public.notification_phone_key(whatsapp)) >= 10;

  select count(*) into v_com_ponte
  from public.members
  where status = 'active'
    and length(public.notification_phone_key(whatsapp)) >= 10
    and contact_id is not null;

  select count(distinct public.notification_phone_key(whatsapp)) into v_com_perfil
  from public.members
  where status = 'active'
    and length(public.notification_phone_key(whatsapp)) >= 10
    and contact_id is not null
    and profile_type is not null;

  raise notice '--- Alcance do disparo de Enquetes ---';
  raise notice 'associados cadastrados ................ %', v_total;
  raise notice 'com situacao ATIVA .................... %', v_ativos;
  raise notice '  + WhatsApp utilizavel (>= 10 dig) ... %', v_com_fone;
  raise notice '  + ligados a agenda (contact_id) ..... %', v_com_ponte;
  raise notice '  + com perfil definido, por telefone .. %', v_com_perfil;

  if v_com_perfil = 0 then
    raise notice 'ATENCAO: nenhum associado alcancavel. O privilegio foi corrigido, mas o publico continuara zero ate o cadastro ter associados ATIVOS, com WhatsApp e com perfil.';
  end if;

  for v_linha in
    select m.profile_type::text as perfil,
           count(distinct public.notification_phone_key(m.whatsapp)) as quantos
    from public.members m
    where m.status = 'active'
      and length(public.notification_phone_key(m.whatsapp)) >= 10
      and m.contact_id is not null
      and m.profile_type is not null
    group by m.profile_type
    order by m.profile_type::text
  loop
    raise notice '    perfil % ... %', v_linha.perfil, v_linha.quantos;
  end loop;
end;
$diagnostico$;

-- ============================================================================
-- ROLLBACK (manual)
-- ----------------------------------------------------------------------------
--   revoke execute on function public.profile_for_event_segment(text) from authenticated;
--   revoke execute on function public.notification_phone_key(text) from authenticated;
--   -- (traz de volta o defeito: a estimativa volta a falhar e o publico-alvo
--   --  volta a nao ser gravado)
-- ============================================================================
