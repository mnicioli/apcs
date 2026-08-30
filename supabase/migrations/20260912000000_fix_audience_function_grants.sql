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
-- perguntava era o errado. É a mesma lição do grant de coluna de
-- `events.description`: um privilégio só falha para quem NÃO é dono — ou seja,
-- nunca no psql de quem roda a migration, sempre no navegador de quem usa.
--
-- ⚠️ E DUAS TENTATIVAS DE CONSERTAR ISSO AQUI FALHARAM, o que vale registrar
-- para ninguém tentar a terceira:
--
--   1ª — `set local role authenticated` DENTRO de um bloco PL/pgSQL. O `perform`
--        rodou, a NOTICE saiu, e o `reset role` seguinte não devolveu o papel.
--   2ª — os mesmos comandos em primeiro nível. O `supabase db push` executa em
--        AUTOCOMMIT: cada statement é sua própria transação, e o Postgres avisa
--        `25P01: SET LOCAL can only be used in transaction blocks` e IGNORA o
--        comando. A troca de papel nunca aconteceu — e a NOTICE "sem erro de
--        privilégio" saiu de uma execução feita como dono. Teatro.
--
-- Uma migration não é o lugar para trocar de papel. O que sobrou aqui é a
-- pergunta que o catálogo responde direito, sem encenação: `authenticated` pode
-- executar cada função da cadeia? Quem testa a EXECUÇÃO de ponta a ponta, com o
-- papel certo, é `src/test/sql-function-grants.test.ts`, que percorre o grafo de
-- chamadas das migrations e roda no CI.
--
-- O diagnóstico de alcance ("quantos associados o disparo alcança?") saiu daqui
-- pelo mesmo motivo: ele lê `public.members`, e o papel que o `db push` usa não
-- tem privilégio para isso — a migration abortava num relatório. Ele virou
-- `supabase/diagnostico-alcance-enquetes.sql`, para rodar no SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Todas as funções da cadeia estão executáveis por quem usa o sistema
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

-- ============================================================================
-- ROLLBACK (manual)
-- ----------------------------------------------------------------------------
--   revoke execute on function public.profile_for_event_segment(text) from authenticated;
--   revoke execute on function public.notification_phone_key(text) from authenticated;
--   -- (traz de volta o defeito: a estimativa volta a falhar e o publico-alvo
--   --  volta a nao ser gravado)
-- ============================================================================
