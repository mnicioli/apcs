-- ============================================================================
-- Enquetes — leituras que as TELAS pedem: métricas em lote e participantes
-- paginados
-- ----------------------------------------------------------------------------
-- Duas funções que existem por causa do frontend (PROMPT 2/3), e cada uma
-- resolve um problema concreto que a tela criaria se não existissem.
--
-- 1. `survey_metrics_batch` — O FIM DO N+1.
--    O §2 pede "Respostas" e "Taxa de participação" como colunas da grid, e o
--    §51 pede uma tela de resultados que lista várias enquetes. Com
--    `survey_metrics(id)` uma enquete por vez, uma página de 20 linhas viraria
--    20 idas ao banco — exatamente o que o §64 manda evitar.
--
-- 2. `survey_participants_page` — O §50 CUMPRIDO DE VERDADE.
--    O §50 pede paginação SERVER-SIDE na lista de participantes.
--    `survey_participants` devolve tudo; paginar isso no navegador seria
--    carregar a lista inteira para mostrar 20 linhas, e numa enquete de milhares
--    de respostas é a mesma coisa que não paginar.
--
-- ⚠️ AS DUAS SÃO SECURITY DEFINER PELO MESMO MOTIVO DAS ORIGINAIS:
-- `survey_responses` não tem policy de SELECT (é a decisão 2 do módulo — ver
-- 20260819000000_create_surveys.sql). E, por serem DEFINER, as duas checam
-- `survey_is_reader()` no topo — a checagem é a única barreira, e ela precisa
-- ser à prova de NULL. `survey_participants_page` repete também a recusa de
-- enquete anônima (§54): uma porta nova para o mesmo dado precisa da mesma
-- tranca, senão a tranca da porta antiga vira decoração.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Métricas de várias enquetes de uma vez (§2, §51, §64)
-- ----------------------------------------------------------------------------
-- Devolve UMA LINHA POR ID PEDIDO, mesmo para enquetes sem destinatário nenhum
-- — daí o `left join` a partir da lista de entrada. Sem isso a tela teria de
-- descobrir quais ids sumiram e preencher zeros na mão, que é onde nasce a
-- linha em branco no meio da grid.
create or replace function public.survey_metrics_batch(p_survey_ids uuid[])
returns table (
  survey_id uuid,
  total_audience integer,
  total_sent integer,
  total_delivered integer,
  total_read integer,
  total_responses integer,
  total_errors integer,
  participation_rate numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.survey_is_reader() then
    raise exception 'Sem permissão para consultar resultados.' using errcode = '42501';
  end if;

  -- ⚠️ Os nomes internos (`sid`, `qtd`, `audiencia`) NÃO repetem os parâmetros
  -- OUT desta função. Dentro de PL/pgSQL um OUT vira variável, e uma referência
  -- não qualificada a `total_responses` ficaria ambígua — o Postgres recusa a
  -- consulta inteira com 42702. Aconteceu em `survey_results` durante a
  -- construção do módulo; aqui já nasce evitado.
  return query
  with alvo as (
    select distinct unnest(coalesce(p_survey_ids, '{}'::uuid[])) as sid
  ),
  destinatarios as (
    select
      d.survey_id as sid,
      count(*)::integer as audiencia,
      -- A progressão é cumulativa: quem RESPONDEU também foi entregue. Contar
      -- só o estado exato faria o denominador da taxa encolher a cada resposta.
      count(*) filter (
        where d.status in ('sent', 'delivered', 'read', 'responded')
      )::integer as enviadas,
      count(*) filter (
        where d.status in ('delivered', 'read', 'responded')
      )::integer as entregues,
      count(*) filter (where d.status in ('read', 'responded'))::integer as lidas,
      count(*) filter (where d.status = 'error')::integer as erros
    from public.survey_recipients d
    where d.survey_id = any (p_survey_ids)
    group by d.survey_id
  ),
  respostas as (
    select r.survey_id as sid, count(*)::integer as qtd
    from public.survey_responses r
    where r.survey_id = any (p_survey_ids)
    group by r.survey_id
  )
  select
    a.sid,
    coalesce(d.audiencia, 0),
    coalesce(d.enviadas, 0),
    coalesce(d.entregues, 0),
    coalesce(d.lidas, 0),
    coalesce(p.qtd, 0),
    coalesce(d.erros, 0),
    case
      when coalesce(d.entregues, 0) = 0 then 0::numeric
      else round(coalesce(p.qtd, 0)::numeric * 100 / d.entregues, 2)
    end
  from alvo a
  left join destinatarios d on d.sid = a.sid
  left join respostas p on p.sid = a.sid;
end;
$$;

comment on function public.survey_metrics_batch(uuid[]) is
  'Métricas de várias enquetes numa consulta só — evita o N+1 da grid (§2, §64).';

-- ----------------------------------------------------------------------------
-- 2. Participantes paginados (§47, §50)
-- ----------------------------------------------------------------------------
-- Mesma regra de anonimato de `survey_participants`, e não é redundância: são
-- duas portas para o mesmo dado, e uma porta sem tranca anula a tranca da outra.
--
-- `p_query` filtra por NOME (§50). Resposta e data são filtráveis pela
-- ordenação e pelo próprio recorte da tela; o nome é o que alguém digita.
create or replace function public.survey_participants_page(
  p_survey_id uuid,
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  contact_id uuid,
  contact_name text,
  option_id uuid,
  option_text text,
  answered_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_anonymous boolean;
  v_query text := nullif(btrim(p_query), '');
begin
  if not public.survey_is_reader() then
    raise exception 'Sem permissão para consultar resultados.' using errcode = '42501';
  end if;

  select s.is_anonymous into v_anonymous from public.surveys s where s.id = p_survey_id;
  if not found then
    raise exception 'Enquete não encontrada.' using errcode = 'P0002';
  end if;

  if v_anonymous then
    raise exception 'Esta enquete é anônima: os participantes não podem ser identificados.'
      using errcode = 'SV008';
  end if;

  -- `count(*) over ()` devolve o total junto das linhas da página: sem ele, a
  -- paginação precisaria de uma segunda consulta e as duas poderiam discordar
  -- se uma resposta entrasse entre elas.
  return query
  select
    r.contact_id,
    c.full_name,
    r.option_id,
    o.text,
    r.answered_at,
    count(*) over () as total_count
  from public.survey_responses r
  join public.survey_options o on o.id = r.option_id
  left join public.chat_contacts c on c.id = r.contact_id
  where r.survey_id = p_survey_id
    and (
      v_query is null
      -- Sem acento e sem caixa, como a busca da grid. `translate` porque este
      -- banco não tem `unaccent` (conferido).
      or translate(lower(coalesce(c.full_name, '')),
                   'áàâãäåéèêëíìîïóòôõöúùûüçñ',
                   'aaaaaaeeeeiiiiooooouuuucn') like
         '%' || translate(lower(v_query),
                   'áàâãäåéèêëíìîïóòôõöúùûüçñ',
                   'aaaaaaeeeeiiiiooooouuuucn') || '%'
    )
  order by r.answered_at desc, r.id
  limit greatest(1, least(coalesce(p_limit, 20), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

comment on function public.survey_participants_page is
  '§47/§50. Participantes paginados no SERVIDOR. Recusa-se a responder para enquete anônima.';

-- ----------------------------------------------------------------------------
-- 3. Grants
-- ----------------------------------------------------------------------------
-- `revoke from public` antes do grant, e `anon` explicitamente fora: o
-- `revoke ... from public` NÃO desfaz a concessão que o Supabase dá a `anon` por
-- DEFAULT PRIVILEGES. Foi assim que `survey_participants` acabou legível por
-- anônimo antes da correção — ver docs/ENQUETES.md §9.1.
revoke execute on function public.survey_metrics_batch(uuid[]) from public, anon;
grant execute on function public.survey_metrics_batch(uuid[]) to authenticated;

revoke execute on function public.survey_participants_page(uuid, text, integer, integer)
  from public, anon;
grant execute on function public.survey_participants_page(uuid, text, integer, integer)
  to authenticated;

-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   drop function if exists public.survey_participants_page(uuid, text, integer, integer);
--   drop function if exists public.survey_metrics_batch(uuid[]);
--
-- Nenhuma tabela é alterada; as duas funções são leitura pura.
-- ============================================================================
