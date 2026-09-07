-- ============================================================================
-- CORREÇÃO (CRÍTICO): O TOGGLE "CONFIRMADO" NUNCA FUNCIONOU
-- ============================================================================
-- Relato de produção: marcar um participante como "Não confirmado" devolvia
--
--   "O banco recusou esta gravação por configuração interna — não é o seu
--    perfil. Avise quem cuida do sistema: o log do servidor diz qual coluna
--    faltou liberar."
--
-- E editar a ficha de um participante falhava do mesmo jeito. As duas coisas
-- eram o MESMO defeito, e ele estava lá desde o Prompt 1.
--
-- ----------------------------------------------------------------------------
-- A CAUSA, E POR QUE A MENSAGEM APONTAVA PARA O LUGAR ERRADO
-- ----------------------------------------------------------------------------
-- A mensagem manda procurar um `grant` de COLUNA faltando — porque foi isso
-- que aconteceu da última vez que este código apareceu (`events.description`,
-- em 20260908000000). Desta vez não era. Em `event_participants`,
-- `confirmation`, `updated_by` e `updated_at` estão todos liberados; o UPDATE
-- passava.
--
-- Quem recusava era a linha SEGUINTE: o insert na TRILHA.
--
-- `event_registration_audit_logs` é fechada por dois lados ao mesmo tempo, de
-- propósito (20260922000100, seções 6 e 7):
--
--     revoke insert, update, delete on public.event_registration_audit_logs
--       from authenticated, anon;
--     -- e NENHUMA policy de insert
--
-- O comentário que justifica isso diz, com todas as letras: "quem escreve na
-- trilha é `create_event_registration` / `update_event_registration` /
-- `set_participant_confirmation`, TODAS SECURITY DEFINER". Só que das três,
-- apenas a PRIMEIRA era. As outras duas nasceram SECURITY INVOKER — e a
-- terceira, `update_event_participant`, nasceu igual no Prompt 4.
--
-- ⚠️ O COMENTÁRIO DESCREVIA UM MUNDO QUE O CÓDIGO AO LADO DELE NÃO CONSTRUIU.
-- Uma função SECURITY INVOKER roda com o privilégio de QUEM CHAMOU. Quem chama
-- é `authenticated`. E `authenticated` não pode inserir na trilha. Logo: 42501,
-- sempre, para todo mundo, inclusive para o Administrador.
--
-- Nada disso apareceu antes porque:
--   * a função é CRIADA sem reclamar — o PL/pgSQL só planeja cada comando na
--     primeira vez que ele executa;
--   * type-check, lint e build não falam com o Postgres;
--   * os testes das actions mockam o Supabase, que é justamente quem recusava;
--   * e `create_event_registration`, a única das quatro que estava certa, é a
--     que o ciclo de homologação exercitou de ponta a ponta. Inscrever
--     funcionava. Confirmar, não — e ninguém tinha clicado.
--
-- ----------------------------------------------------------------------------
-- A CORREÇÃO, E POR QUE `alter` EM VEZ DE RECRIAR
-- ----------------------------------------------------------------------------
-- `alter function ... security definer` muda esse atributo e MAIS NADA. A
-- alternativa seria repetir aqui os três corpos inteiros dentro de um
-- `create or replace` — quase 200 linhas de PL/pgSQL copiadas à mão, num
-- arquivo que vai rodar em produção, só para trocar duas palavras. Cada linha
-- copiada é uma chance de o corpo divergir do original sem ninguém notar.
--
-- ⚠️ O QUE SE PERDE AO VIRAR SECURITY DEFINER, dito na cara: a RLS deixa de
-- valer dentro destas funções (o dono da tabela não passa por policy). A
-- segunda camada de RBAC some, e a checagem de papel DENTRO da função vira a
-- única barreira. Isso só é aceitável porque as três já a têm, na primeira
-- linha do corpo:
--
--     if not public.registrations_is_writer() then
--       raise exception '...' using errcode = '42501';
--     end if;
--
-- E `registrations_is_writer()` é exatamente o que as policies de update
-- checavam — `current_app_role() = 'admin'`. Não é uma barreira mais fraca; é
-- a MESMA, escrita um nível acima. O escopo por evento (`and event_id =
-- p_event_id`, o §26 do Prompt 4) continua onde estava e é mais estreito do
-- que qualquer policy.
--
-- ⚠️ `auth.uid()` CONTINUA SENDO QUEM CLICOU. Ele lê o JWT da requisição, não
-- o papel do banco — então a trilha continua registrando a pessoa certa, e não
-- "postgres". Se não fosse assim, a correção teria estragado a auditoria para
-- consertar o clique.
--
-- As três já têm `set search_path = ''` e qualificam todo nome com `public.`,
-- que é o outro requisito de uma SECURITY DEFINER. E o EXECUTE delas já estava
-- revogado de `public` e `anon` desde o Prompt 4.
--
-- Guarda contra a volta: `src/test/sql-audit-writes.test.ts`, que varre TODAS
-- as migrations e recusa função SECURITY INVOKER gravando em tabela onde
-- `authenticated` não tem insert.
-- ============================================================================

alter function public.set_participant_confirmation(
  uuid, uuid, public.event_participant_confirmation
) security definer;

alter function public.update_event_participant(
  uuid, uuid, text, text, text, text, public.event_participant_confirmation
) security definer;

alter function public.update_event_registration(
  uuid, uuid, text, public.event_registration_status
) security definer;


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   alter function public.set_participant_confirmation(
--     uuid, uuid, public.event_participant_confirmation) security invoker;
--   alter function public.update_event_participant(
--     uuid, uuid, text, text, text, text,
--     public.event_participant_confirmation) security invoker;
--   alter function public.update_event_registration(
--     uuid, uuid, text, public.event_registration_status) security invoker;
--
-- ⚠️ Voltar atrás devolve o defeito INTEIRO: confirmar participante, editar
-- ficha e cancelar inscrição param de funcionar para todos os papéis, com uma
-- mensagem que manda procurar um grant de coluna que está certo.
-- ============================================================================
