-- ============================================================================
-- CORREÇÃO: administrador não conseguia SALVAR a edição de um evento
-- ============================================================================
--
-- O SINTOMA: um Administrador — com 33 de 33 permissões na Matriz de Acesso —
-- abria "Editar evento", clicava em Salvar e recebia
-- "Você não tem permissão para esta ação". Criar evento funcionava; editar,
-- nunca.
--
-- ----------------------------------------------------------------------------
-- A CAUSA, E POR QUE ELA NÃO ESTAVA NO RBAC
-- ----------------------------------------------------------------------------
-- `events` tem grants por COLUNA desde a migration original:
--
--     revoke update on public.events from authenticated;
--     grant update (name, location, registration_url, ...) on public.events
--       to authenticated;
--
-- Isso existe por um bom motivo (está escrito lá): sem grant de coluna, alguém
-- chamando o PostgREST direto reescreveria `created_by` de um evento alheio — a
-- policy de update deixaria passar, porque RLS filtra LINHA, não COLUNA.
--
-- `20260904000000_event_description.sql` acrescentou `events.description` e NÃO
-- acrescentou a coluna a essa lista. Como `update_event` é SECURITY INVOKER, o
-- UPDATE roda com o privilégio de quem clicou — e escrever numa coluna sem
-- grant é 42501, "permission denied". A action traduz 42501 para `forbidden`, e
-- `forbidden` é exatamente "Você não tem permissão para esta ação".
--
-- ⚠️ O RBAC ESTAVA CERTO O TEMPO TODO. A permissão `events.write` do
-- administrador nunca foi o problema: a prova é que a própria tela de edição só
-- abre para quem a tem (`/events/[id]/edit` redireciona sem ela). A mensagem
-- apontava para o lugar errado porque 42501 é o mesmo código para "seu papel não
-- pode" e para "esta COLUNA não é sua" — e só o segundo estava acontecendo.
--
-- ⚠️ POR QUE NADA PEGOU ANTES: a coluna existe, o tipo bate, a função compila, a
-- policy passa. O erro só aparece na hora de gravar, e só para quem NÃO é dono
-- da tabela — ou seja, nunca no psql de quem roda a migration, sempre no
-- navegador de quem usa o sistema.
--
-- A barreira que passa a existir: `src/test/sql-column-grants.test.ts` varre as
-- migrations e reprova coluna nova em tabela com grant de coluna que não
-- apareça num grant.
--
-- DEPENDE DE: 20260813000000_create_events.sql, 20260904000000_event_description.sql

grant update (description) on public.events to authenticated;

-- ----------------------------------------------------------------------------
-- A conferência
-- ----------------------------------------------------------------------------
-- ⚠️ CONFERE TODAS AS COLUNAS QUE `update_event` ESCREVE, e não só a que faltava.
-- Uma migration que conserta um caso e não olha os vizinhos deixa o próximo
-- exatamente onde este estava. `has_column_privilege` responde a pergunta que
-- importa — "o usuário do sistema consegue gravar aqui?" — em vez da que é fácil
-- — "a coluna existe?".
do $checagem$
declare
  v_coluna text;
  v_faltando text[] := '{}';
begin
  foreach v_coluna in array array[
    'name', 'description', 'location', 'registration_url',
    'event_date', 'start_time', 'end_time', 'status',
    'image_path', 'image_mime', 'image_size_bytes',
    'updated_by', 'updated_at'
  ] loop
    if not has_column_privilege('authenticated', 'public.events', v_coluna, 'UPDATE') then
      v_faltando := v_faltando || v_coluna;
    end if;
  end loop;

  if cardinality(v_faltando) > 0 then
    raise exception
      'authenticated nao pode atualizar public.events(%). Sem isso, salvar um evento devolve 42501.',
      array_to_string(v_faltando, ', ');
  end if;

  raise notice 'public.events: as % colunas que update_event escreve estao liberadas.', 13;
end;
$checagem$;

-- ============================================================================
-- ROLLBACK (manual)
-- ----------------------------------------------------------------------------
--   revoke update (description) on public.events from authenticated;
--   -- (traz de volta o defeito: editar evento volta a devolver 42501)
