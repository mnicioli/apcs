-- ============================================================================
-- "NÃO CONFIRMADOS" FICAVA EM ZERO PARA SEMPRE
-- ============================================================================
-- Defeito encontrado em produção, na tela de um evento: um participante estava
-- como NÃO CONFIRMADO, o contador de "Confirmados" desceu de 10 para 9 — e o de
-- "Não confirmados" continuou em 0, em vez de virar 1.
--
-- ----------------------------------------------------------------------------
-- A CAUSA: `to_jsonb` DE UMA LINHA NOMEIA AS CHAVES PELAS COLUNAS
-- ----------------------------------------------------------------------------
-- `event_registrations_board` montava as métricas assim:
--
--     'metrics', (select to_jsonb(m) from metricas m)
--
-- e a CTE `metricas` tem as colunas `participants`, `confirmed`,
-- `not_confirmed`, `registrations` e `companies`. O jsonb saía com esses cinco
-- nomes, em snake_case — enquanto a aplicação lê `metricas.notConfirmed`
-- (`getRegistrationBoard`, em src/lib/services/event-landing.ts).
--
-- ⚠️ E É POR ISSO QUE SÓ UMA DAS CINCO QUEBROU. Quatro são PALAVRAS ÚNICAS:
-- `participants`, `confirmed`, `registrations` e `companies` são iguais nas duas
-- convenções e casavam por coincidência. `not_confirmed` é a única composta, e
-- foi a única a chegar com o nome errado — caindo no `?? 0` do service.
--
-- ⚠️ O MODO DE FALHAR É O PIOR QUE EXISTE PARA UM CONTADOR: ele não some da
-- tela, não dá erro, não aparece no log. Ele mostra ZERO, que é um número
-- plausível — e "nenhum não confirmado" é exatamente o que se espera ver num
-- evento que está indo bem. O defeito só fica visível quando alguém marca
-- alguém como não confirmado E confere a soma à mão, que foi o que aconteceu.
--
-- Nenhuma barreira do projeto pegava isto: o TypeScript está certo dos dois
-- lados (o jsonb é `unknown` na fronteira), a função compila, a RLS passa, e o
-- teste do CSV usa `metrics` montado à mão. É a mesma família de
-- `sql-column-grants` e `sql-returns-table` — contrato que só existe como
-- combinação entre SQL e aplicação, e que ninguém confere.
--
-- ----------------------------------------------------------------------------
-- A CORREÇÃO, E A REGRA QUE ELA DEIXA
-- ----------------------------------------------------------------------------
-- As métricas passam a ser montadas CHAVE A CHAVE, com `jsonb_build_object` —
-- exatamente como `rows` sempre foi montado, dez linhas abaixo, e por este
-- motivo. `to_jsonb(<linha>)` é ótimo para depurar e é uma armadilha para
-- contrato: ele publica o nome interno das colunas como API.
--
-- `src/test/sql-event-landing.test.ts` passou a cobrar que TODA chave que
-- `RegistrationBoardMetrics` declara apareça literalmente no corpo da função.
--
-- ⚠️ NADA MAIS MUDA. O corpo abaixo é o de 20260925000200 palavra por palavra —
-- os filtros, o fuso do período, a busca por dígitos, a ordenação estável e a
-- paginação. `create or replace` porque a assinatura é a mesma.
-- ============================================================================


create or replace function public.event_registrations_board(
  p_event_id uuid,
  p_query text default null,
  p_confirmation text default null,
  p_from date default null,
  p_to date default null,
  p_sort text default 'recent',
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_texto text;
  v_digitos text;
  v_limite integer := greatest(1, least(coalesce(p_limit, 25), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_sort text := coalesce(nullif(btrim(lower(p_sort)), ''), 'recent');
  -- Os instantes que delimitam o período, no fuso da APCS. Ver o cabeçalho.
  v_inicio timestamptz := case
    when p_from is null then null
    else (p_from::timestamp at time zone 'America/Sao_Paulo')
  end;
  v_fim timestamptz := case
    when p_to is null then null
    else ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo')
  end;
  v_resultado jsonb;
begin
  -- A mesma normalização da coluna gerada, aplicada ao que se digitou. As duas
  -- pontas precisam concordar: sem isto, procurar "João" nunca acha "joao".
  v_texto := nullif(
    translate(
      lower(btrim(coalesce(p_query, ''))),
      'áàâãäåéèêëíìîïóòôõöúùûüçñ',
      'aaaaaaeeeeiiiiooooouuuucn'
    ), ''
  );

  -- ⚠️ O TELEFONE PRECISA DE UM SEGUNDO PADRÃO. Quem procura por telefone cola
  -- "(11) 99999-8888" da conversa; a coluna guarda "11999998888". Sem tirar a
  -- máscara do que foi digitado, a busca por telefone simplesmente nunca acha
  -- ninguém — e o §7 pede que ela ache.
  --
  -- Quatro dígitos é o piso: com menos, "11" casaria com metade da base e o
  -- resultado não ajudaria ninguém. Mesmo piso de `buildSearch` em Associados.
  v_digitos := nullif(regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g'), '');
  if v_digitos is not null and char_length(v_digitos) < 4 then
    v_digitos := null;
  end if;

  -- `_` e `%` viram literais: uma granja chamada "100%" não pode virar curinga.
  v_texto := replace(replace(v_texto, '\', '\\'), '%', '\%');
  v_texto := replace(v_texto, '_', '\_');

  with filtrado as (
    select
      p.id            as participant_id,
      p.registration_id,
      p.full_name,
      p.email,
      p.phone,
      p.whatsapp,
      p.confirmation,
      r.company_name,
      r.registered_at,
      r.status        as registration_status,
      r.origin
    from public.event_participants p
    join public.event_registrations r on r.id = p.registration_id
    where p.event_id = p_event_id
      -- ⚠️ A CADEIA CONFERIDA NO BANCO (§26). `p.event_id` e `r.event_id` são
      -- mantidos iguais pela FK composta da decisão 3 do Prompt 1; repetir a
      -- condição aqui é o que impede um participante de outro evento de entrar
      -- na página por uma junção mal escrita no futuro.
      and r.event_id = p_event_id

      and (p_confirmation is null
           or p_confirmation = 'all'
           or p.confirmation::text = p_confirmation)

      and (v_inicio is null or r.registered_at >= v_inicio)
      and (v_fim is null or r.registered_at < v_fim)

      and (
        v_texto is null
        or p.search_text like '%' || v_texto || '%'
        -- A granja: é por isso que existem duas colunas geradas.
        or r.search_text like '%' || v_texto || '%'
        or (v_digitos is not null and p.search_text like '%' || v_digitos || '%')
      )
  ),
  metricas as (
    select
      count(*)                                                          as participants,
      count(*) filter (where confirmation = 'confirmed')                as confirmed,
      count(*) filter (where confirmation = 'not_confirmed')            as not_confirmed,
      count(distinct registration_id)                                   as registrations,
      -- ⚠️ EMPRESAS DISTINTAS PELO NOME NORMALIZADO, e não pelo id da
      -- inscrição: a mesma granja pode ter mandado duas inscrições (dois
      -- grupos, dois momentos), e contá-la duas vezes responderia à pergunta
      -- errada. "Granja ABC" e "granja abc" são a mesma empresa.
      count(distinct translate(lower(btrim(company_name)),
            'áàâãäåéèêëíìîïóòôõöúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn')) as companies
    from filtrado
  ),
  pagina as (
    select f.*,
           row_number() over (
             order by
               case when v_sort = 'company'     then f.company_name end asc,
               case when v_sort = 'participant' then f.full_name end asc,
               case when v_sort = 'recent'      then f.registered_at end desc,
               -- ⚠️ DESEMPATE ESTÁVEL, sempre. Sem ele, duas pessoas inscritas
               -- no mesmo segundo podem trocar de lugar entre a página 1 e a
               -- página 2 — e uma delas some da listagem sem nunca aparecer.
               -- Mesma armadilha que `listLectures` documenta.
               f.registered_at desc,
               f.full_name asc,
               f.participant_id asc
           ) as rn
    from filtrado f
    order by rn
    limit v_limite
    offset v_offset
  )
  select jsonb_build_object(
    -- ⚠️ CHAVE A CHAVE, E NÃO `to_jsonb(m)`. Ver o cabeçalho desta migration:
    -- `to_jsonb` de uma linha nomeia as chaves pelas COLUNAS, e a coluna
    -- `not_confirmed` chegava à aplicação com esse nome enquanto a tela lia
    -- `notConfirmed`. As outras quatro são palavras únicas e casavam por
    -- coincidência — só a composta quebrou, e em silêncio.
    'metrics', (
      select jsonb_build_object(
        'participants', m.participants,
        'confirmed', m.confirmed,
        'notConfirmed', m.not_confirmed,
        'registrations', m.registrations,
        'companies', m.companies
      )
      from metricas m
    ),
    'total', (select participants from metricas),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'participantId', participant_id,
          'registrationId', registration_id,
          'companyName', company_name,
          'fullName', full_name,
          'email', email,
          'phone', phone,
          'whatsapp', whatsapp,
          'confirmation', confirmation,
          'registeredAt', registered_at,
          'registrationStatus', registration_status,
          'origin', origin
        )
        -- Pelo `rn` calculado acima: `jsonb_agg` sem `order by` segue a ordem de
        -- entrada na prática, e isso não é garantido pelo Postgres.
        order by rn
      )
      from pagina
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;


comment on function public.event_registrations_board is
  'Metricas, pagina e total dos participantes de um evento, com o MESMO filtro. Metricas montadas chave a chave: ver 20260929000000.';

-- Reaplicados por segurança: `create or replace` preserva os grants, mas
-- escrevê-los aqui mantém a regra visível no arquivo que define a função.
revoke execute on function
  public.event_registrations_board(uuid, text, text, date, date, text, integer, integer)
  from public, anon;
grant execute on function
  public.event_registrations_board(uuid, text, text, date, date, text, integer, integer)
  to authenticated;


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- Recriar a função como está em 20260925000200_event_registration_period.sql.
--
-- ⚠️ Isso devolve o defeito: "Não confirmados" volta a mostrar zero para
-- sempre. Não há dado a restaurar — nada foi gravado errado, só exibido.
-- ============================================================================
