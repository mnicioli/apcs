-- ============================================================================
-- CORREÇÃO: `start_broadcast` falhava com 42702 (referência ambígua)
-- ============================================================================
--
-- O SINTOMA: divulgar uma normativa por WhatsApp devolvia
-- "Ocorreu um erro inesperado. Tente novamente." e nenhuma mensagem saía. A
-- fila nunca era criada — o histórico continuava dizendo "Nunca divulgado".
--
-- O ERRO, depois que a action passou a registrá-lo (ver o commit que criou
-- `failFromPostgres`):
--
--   code:    42702
--   message: column reference "broadcast_id" is ambiguous
--   detail:  It could refer to either a PL/pgSQL variable or a table column.
--
-- ----------------------------------------------------------------------------
-- POR QUE ACONTECIA
-- ----------------------------------------------------------------------------
-- `start_broadcast` é declarada como:
--
--   returns table (broadcast_id uuid, queued integer, blocked integer)
--
-- e `RETURNS TABLE` cria VARIÁVEIS PL/pgSQL com esses nomes. Uma delas se chama
-- `broadcast_id` — que é também o nome de uma coluna de
-- `broadcast_recipients`. No corpo da função havia:
--
--   on conflict (broadcast_id, member_phone) do nothing
--
-- O alvo de um `ON CONFLICT` é um dos poucos lugares onde o PL/pgSQL FAZ
-- substituição de variável, e ali não existe forma de qualificar a coluna:
-- `on conflict (r.broadcast_id)` é erro de sintaxe. O Postgres via os dois
-- significados possíveis e desistia.
--
-- ⚠️ POR QUE NINGUÉM VIU ANTES. O corpo de uma função PL/pgSQL só é analisado
-- na PRIMEIRA EXECUÇÃO — `create function` aceita feliz. Type-check, lint,
-- testes e build passam todos: nenhum deles executa SQL. O primeiro a descobrir
-- foi quem clicou em "Divulgar", em produção.
--
-- ⚠️ E POR QUE SÓ AGORA. A mesma consulta de público roda em
-- `broadcast_audience_size` (o "1 associado receberá" da tela) e funcionava —
-- aquela função não tem `broadcast_id` entre os parâmetros de saída. As duas
-- pareciam concordar até a hora de gravar.
--
-- ----------------------------------------------------------------------------
-- A CORREÇÃO
-- ----------------------------------------------------------------------------
-- `#variable_conflict use_column`: quando um identificador servir tanto como
-- coluna quanto como variável, vale a COLUNA. É o remédio documentado para
-- exatamente este caso.
--
-- É seguro nesta função porque nenhum dos três nomes de saída é lido por nome
-- no corpo: `broadcast_id` só aparece como coluna, e `queued`/`blocked` nem
-- sequer existem como coluna em tabela nenhuma citada aqui. O valor de retorno
-- sai por `return query select v_id, ...`, com variáveis `v_` que não colidem
-- com nada.
--
-- ⚠️ O `ON CONFLICT` FICA. Ele é inalcançável hoje — a divulgação acabou de
-- nascer, e o `distinct on (m.whatsapp)` já garante um telefone por linha —,
-- mas ele existe para o dia em que alguém mexer no `distinct on`. Tirar a rede
-- de proteção porque ela estava mal presa é o conserto errado.
--
-- ⚠️ AS OUTRAS FUNÇÕES DO MÓDULO FORAM CONFERIDAS, uma a uma:
-- `claim_broadcast_recipients` também usa `RETURNS TABLE`, mas todas as suas
-- referências são qualificadas (`r.id`, `r.attempts`); `finish_broadcast`,
-- `settle_broadcast_recipient` e `release_stale_broadcast_recipients` devolvem
-- escalar ou rowtype e não criam variáveis com nome de coluna;
-- `broadcast_audience_size` não referencia `reachable`/`blocked` no corpo.
-- Só esta precisava de conserto.
--
-- DEPENDE DE: 20260901000100_broadcasts.sql
--
-- ⚠️ `create or replace` com a MESMA assinatura: não cria sobrecarga e PRESERVA
-- os grants. Os `revoke`/`grant` no fim são repetidos assim mesmo, para o
-- arquivo dizer sozinho quem pode executar isto.
-- ============================================================================

create or replace function public.start_broadcast(
  p_source public.broadcast_source,
  p_source_id uuid,
  p_title text,
  p_body text,
  p_segment_ids uuid[],
  p_media_bucket text default null,
  p_media_path text default null,
  p_media_mime text default null,
  p_media_filename text default null
)
returns table (broadcast_id uuid, queued integer, blocked integer)
language plpgsql
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_id uuid;
  v_total integer;
  v_blocked integer;
begin
  if not public.broadcast_is_writer() then
    raise exception 'Sem permissao para divulgar.' using errcode = '42501';
  end if;

  if p_segment_ids is null or cardinality(p_segment_ids) = 0 then
    raise exception 'Escolha ao menos um publico-alvo antes de divulgar.' using errcode = 'BC001';
  end if;

  if nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'A mensagem nao pode ficar vazia.' using errcode = 'BC002';
  end if;

  -- ⚠️ RECUSA PÚBLICO INEXISTENTE OU INATIVO. Sem isto, um id errado vindo da
  -- tela produziria uma fila VAZIA e uma tela dizendo "divulgado para 0
  -- pessoas" — que parece uma base vazia, não um erro de seleção.
  if exists (
    select 1
    from unnest(p_segment_ids) as pedido(id)
    where not exists (
      select 1 from public.event_segments s where s.id = pedido.id and s.active
    )
  ) then
    raise exception 'Publico-alvo desconhecido ou inativo.' using errcode = 'BC003';
  end if;

  insert into public.broadcasts (
    source, source_id, title, body,
    media_bucket, media_path, media_mime, media_filename,
    created_by_name
  )
  values (
    p_source, p_source_id, p_title, btrim(p_body),
    p_media_bucket, p_media_path, p_media_mime, p_media_filename,
    public.current_actor_name()
  )
  returning id into v_id;

  insert into public.broadcast_segments (broadcast_id, segment_id)
  select v_id, s.id
  from public.event_segments s
  where s.id = any(p_segment_ids);

  -- A FOTOGRAFIA: associados ativos, com telefone, cujo perfil corresponde a
  -- algum dos públicos escolhidos.
  insert into public.broadcast_recipients (
    broadcast_id, member_id, member_name, member_phone, status
  )
  select distinct on (m.whatsapp)
    v_id,
    m.id,
    m.full_name,
    m.whatsapp,
    case
      when public.is_notification_blocked(m.whatsapp)
        then 'blocked'::public.broadcast_recipient_status
      else 'pending'::public.broadcast_recipient_status
    end
  from public.members m
  where m.status = 'active'
    and m.profile_type is not null
    and m.whatsapp ~ '^[0-9]{10,15}$'
    and m.profile_type in (
      select public.profile_for_event_segment(s.slug)
      from public.event_segments s
      where s.id = any(p_segment_ids)
        and public.profile_for_event_segment(s.slug) is not null
    )
  -- `distinct on` exige ordem, e a ordem escolhe QUAL cadastro representa o
  -- telefone quando há dois: o mais antigo, que é o que tem histórico.
  order by m.whatsapp, m.created_at, m.id
  on conflict (broadcast_id, member_phone) do nothing;

  select count(*) into v_total
  from public.broadcast_recipients r where r.broadcast_id = v_id;

  select count(*) into v_blocked
  from public.broadcast_recipients r
  where r.broadcast_id = v_id and r.status = 'blocked';

  update public.broadcasts b
  set total_recipients = v_total,
      total_blocked = v_blocked,
      -- Fila sem ninguém para enviar já nasce encerrada: deixá-la `running`
      -- faria a tela oferecer "continuar" para sempre, sem nada a continuar.
      status = case when v_total - v_blocked = 0 then 'done'::public.broadcast_status
                    else 'running'::public.broadcast_status end,
      finished_at = case when v_total - v_blocked = 0 then now() else null end
  where b.id = v_id;

  return query select v_id, (v_total - v_blocked), v_blocked;
end;
$fn$;

comment on function public.start_broadcast(public.broadcast_source, uuid, text, text, uuid[], text, text, text, text) is
  'Abre uma divulgacao e monta a fila a partir dos publicos-alvo escolhidos. Filtra quem pediu para nao receber.';

revoke execute on function public.start_broadcast(public.broadcast_source, uuid, text, text, uuid[], text, text, text, text)
  from public, anon;
grant execute on function public.start_broadcast(public.broadcast_source, uuid, text, text, uuid[], text, text, text, text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- A conferência: a função EXECUTA DE VERDADE?
-- ----------------------------------------------------------------------------
-- ⚠️ ESTE BLOCO EXISTE PORQUE `create function` NÃO PROVA NADA, e porque a
-- primeira versão desta conferência também não provava.
--
-- O PL/pgSQL analisa cada comando SQL na PRIMEIRA VEZ QUE ELE RODA, um por um —
-- não a função inteira, não na criação. Um comando num caminho que ninguém
-- percorreu nunca foi analisado. Foi assim que a ambiguidade atravessou
-- type-check, lint, 1394 testes, build e deploy: o primeiro a executar aquele
-- `insert` foi quem clicou em "Divulgar", em produção.
--
-- A consequência prática: chamar a função com uma lista de públicos vazia (e
-- parar no `raise` da primeira regra) NÃO exercita os `insert` lá embaixo.
-- Seria uma conferência que passa sempre, inclusive com o defeito no lugar.
--
-- Então este bloco faz a chamada COMPLETA, com um público real, e desfaz o que
-- ela escreveu: o `begin ... exception` do PL/pgSQL abre uma subtransação, e a
-- exceção que ele mesmo levanta reverte tudo que foi gravado ali dentro. Nada
-- sobra em `broadcasts` nem em `broadcast_recipients`, e nenhuma mensagem sai —
-- quem envia é o worker, que não passa por aqui.
--
-- Qualquer 42702 sobrevivente estoura AQUI, e a migration falha na sua mão em
-- vez de falhar na de quem for divulgar.
do $checagem$
declare
  v_segmento uuid;
begin
  select s.id into v_segmento
  from public.event_segments s
  where s.active
  limit 1;

  if v_segmento is null then
    raise notice 'start_broadcast nao foi exercitada: nao ha publico-alvo ativo para testar.';
    return;
  end if;

  begin
    perform public.start_broadcast(
      'normative'::public.broadcast_source,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'checagem da migration',
      'checagem da migration',
      array[v_segmento]
    );

    -- Chegou aqui: o corpo inteiro foi analisado e executou. Só falta desfazer.
    raise exception 'desfazendo a checagem' using errcode = 'ZZ999';
  exception
    when sqlstate 'ZZ999' then
      raise notice 'start_broadcast executou do inicio ao fim. Checagem desfeita.';
    when sqlstate '42501' then
      -- Sem papel de aplicacao (rodando como `postgres`), a funcao recusa na
      -- primeira linha e os `insert` continuam sem ser analisados. A conferencia
      -- nao valeu — e dizer isso e melhor que fingir que valeu.
      raise notice 'start_broadcast NAO pôde ser exercitada: sem papel de aplicacao nesta sessao.';
  end;
end;
$checagem$;

-- ============================================================================
-- ROLLBACK (manual)
-- ----------------------------------------------------------------------------
-- Recriar `start_broadcast` a partir de 20260901000100_broadcasts.sql. Note que
-- isso traz de volta o defeito: a versão de lá não executa.
