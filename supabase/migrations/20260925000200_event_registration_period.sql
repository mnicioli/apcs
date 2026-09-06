-- ============================================================================
-- O FILTRO DE PERÍODO PASSA A SER UMA DATA, NO FUSO DA APCS
-- ============================================================================
-- ⚠️ CORRIGE UM DEFEITO DE TRÊS HORAS, ENCONTRADO NA REVISÃO DO PROMPT 4.
--
-- `event_registrations_board` recebia `p_from`/`p_to` como `timestamptz`, e o
-- serviço montava o valor concatenando texto:
--
--     p_from: `${filters.from}T00:00:00`      -- "2026-09-06T00:00:00"
--
-- Um literal de timestamp SEM FUSO é interpretado pelo Postgres no fuso do
-- SERVIDOR, que na Supabase é UTC. Ou seja: "inscritos a partir de 06/09"
-- significava, na prática, 05/09 às 21h em São Paulo — e as inscrições feitas entre
-- 21h e meia-noite do dia 5 entravam num filtro que ninguém pediu. Na outra
-- ponta, o mesmo deslocamento CORTAVA as três últimas horas do último dia.
--
-- O sintoma seria quase invisível: uma contagem "quase certa", e uma exportação
-- com algumas linhas a mais ou a menos que a tela. Ninguém confere um CSV de
-- trezentas pessoas linha por linha.
--
-- ----------------------------------------------------------------------------
-- A CORREÇÃO: DATA ENTRA, FUSO É APLICADO NO BANCO
-- ----------------------------------------------------------------------------
-- Os parâmetros viram `date` — que é o que o `<input type="date">` produz e o
-- que a pessoa realmente escolheu — e a conversão para instante acontece AQUI,
-- com `at time zone 'America/Sao_Paulo'`, exatamente como `event_today()` faz
-- desde o módulo de Eventos. É a mesma decisão, pelo mesmo motivo: quem decide
-- o que é "o dia 6" é o calendário de quem olha a tela, não o relógio da
-- hospedagem.
--
-- ⚠️ O FIM É EXCLUSIVO NO DIA SEGUINTE, e não "23:59:59.999" do mesmo dia.
-- Escrever o fim como o último milissegundo é a armadilha clássica: uma
-- inscrição gravada às 23:59:59.9997 fica de fora, e o defeito só aparece uma
-- vez a cada mil anos de uso — que é pior do que aparecer sempre. `< dia + 1` é
-- exato por construção.
--
-- Continua INCLUSIVO nas duas pontas para quem lê a tela: escolher 01/08 a
-- 31/08 traz o dia 31 inteiro.
-- ============================================================================

drop function if exists public.event_registrations_board(
  uuid, text, text, timestamptz, timestamptz, text, integer, integer
);

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
    'metrics', (select to_jsonb(m) from metricas m),
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
  'Metricas, pagina e total dos participantes de um evento, com o MESMO filtro. Periodo em datas do fuso da APCS.';

revoke execute on function
  public.event_registrations_board(uuid, text, text, date, date, text, integer, integer)
  from public, anon;
grant execute on function
  public.event_registrations_board(uuid, text, text, date, date, text, integer, integer)
  to authenticated;


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   drop function if exists public.event_registrations_board(uuid, text, text, date, date, text, integer, integer);
--   -- e recriar a versão de 20260925000100, que recebia timestamptz.
--
-- ⚠️ Voltar atrás traz o defeito de três horas junto. Só faz sentido se a versão
-- de cima estiver quebrada por outro motivo.
-- ============================================================================
