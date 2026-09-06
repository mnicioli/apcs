-- ============================================================================
-- O BACKOFFICE DE INSCRIÇÕES (Prompt 4)
-- ============================================================================
-- O Prompt 1 deixou `listRegistrations`: lê até mil INSCRIÇÕES de um evento e
-- filtra em memória. Serviu para provar o modelo, e não serve para esta tela.
--
-- O §9 pede uma grid de PARTICIPANTES (uma linha por pessoa, não por granja), o
-- §7 pede busca no servidor sobre cinco campos que moram em DUAS tabelas, e o
-- §21 pede paginação e ordenação no servidor. Nada disso o PostgREST resolve
-- direto: um `or=` não atravessa a junção entre `event_participants` e
-- `event_registrations`, então "procurar por Granja ABC" e "procurar por
-- joao@email.com" não cabem na mesma consulta.
--
-- ----------------------------------------------------------------------------
-- DECISÃO 1 — UMA FUNÇÃO SÓ, DEVOLVENDO MÉTRICAS + PÁGINA + TOTAL
-- ----------------------------------------------------------------------------
-- `event_registrations_board` devolve um jsonb com as três coisas.
--
-- ⚠️ O MOTIVO É O §6, NÃO O DESEMPENHO: "os indicadores devem respeitar os
-- filtros ativos". Com uma função para a lista e outra para os contadores, o
-- MESMO `where` teria de ser escrito duas vezes — e o dia em que alguém
-- acrescentasse um filtro numa e esquecesse na outra, a tela mostraria "12
-- confirmados" sobre uma lista de 5. O erro seria silencioso e ninguém
-- conferiria a soma à mão.
--
-- Com uma CTE só, o filtro existe uma vez e alimenta os dois. De quebra é uma
-- ida ao banco em vez de duas (§21).
--
-- ⚠️ SECURITY INVOKER (o padrão), e não DEFINER. Aqui existe usuário logado, e
-- a RLS de `event_registrations`/`event_participants` — que só libera
-- `registrations_is_reader()` — é a segunda camada do RBAC. Um DEFINER
-- desligaria justamente a proteção que faz sentido nesta porta. O contraste é
-- com `get_public_event_landing_page`, que é DEFINER porque ali não há sessão
-- para a RLS avaliar.
--
-- ----------------------------------------------------------------------------
-- DECISÃO 2 — BUSCA POR COLUNA GERADA, COMO EM PALESTRAS
-- ----------------------------------------------------------------------------
-- `search_text` em `event_participants` e em `event_registrations`, geradas com
-- o mesmo `translate()` de `lectures.search_text` (20260816000000). O `ilike`
-- do Postgres é sensível a acento: procurar "joao" não acharia "João", e é o
-- que qualquer pessoa digita numa caixa de busca.
--
-- `translate` e não `unaccent`: colunas geradas exigem função IMMUTABLE, e
-- `unaccent` não é (depende do dicionário instalado). A lista de letras é a
-- mesma de `normalizeForSearch` no TypeScript — as duas pontas precisam
-- concordar, porque uma normaliza o que se guarda e a outra o que se digita.
--
-- ⚠️ DUAS COLUNAS, E NÃO UMA. A granja mora na INSCRIÇÃO e a pessoa mora no
-- PARTICIPANTE. Copiar o nome da granja para dentro do participante faria a
-- busca ficar mais simples e criaria uma cópia que se desatualiza no primeiro
-- "editar Granja/Empresa" — que é justamente o §13.
--
-- ----------------------------------------------------------------------------
-- DECISÃO 3 — TODA ESCRITA PASSA A EXIGIR O EVENTO (§25, §26)
-- ----------------------------------------------------------------------------
-- `set_participant_confirmation` e `update_event_registration` recebiam só o id
-- do alvo. O §26 pede a cadeia conferida no backend:
--
--     Event → LandingPage → Registration → Participant
--
-- As duas passam a receber `p_event_id` e a recusar quando o alvo pertence a
-- outro evento (P0002, o mesmo código de "não encontrado" — quem tenta um id de
-- outro evento não deve descobrir que ele existe).
--
-- ⚠️ ISSO NÃO É REDUNDANTE COM A RLS. A RLS responde "esta pessoa pode ver
-- inscrições?"; ela não responde "este participante é do evento que a tela diz
-- estar aberto". Um administrador tem acesso a todos os eventos — o que a
-- checagem impede é a operação ATRAVESSAR o contexto por um id trocado na
-- requisição, que é o §26 ao pé da letra.
--
-- ----------------------------------------------------------------------------
-- DECISÃO 4 — A CONFIRMAÇÃO VIRA UM COMPARE-AND-SET ATÔMICO (§22, §23)
-- ----------------------------------------------------------------------------
-- A versão do Prompt 1 fazia `select` → `if igual then return` → `update`. Duas
-- requisições simultâneas (duplo clique, retry de rede, dois operadores na
-- mesma pessoa) passam AS DUAS pelo `if` e gravam AS DUAS — resultado certo,
-- mas DUAS linhas de auditoria dizendo que alguém mudou de `false` para `true`,
-- sendo que a segunda não mudou nada.
--
-- A trilha é o registro de quem afirmou o quê (§12); enchê-la de mudanças que
-- não aconteceram é corrompê-la em silêncio. Agora o `update` traz a condição
-- dentro dele: `where id = ? and confirmation is distinct from ?`. Quem não
-- alterar nada não grava nada — e a operação fica segura para repetição, que é
-- o §23.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. As colunas de busca
-- ----------------------------------------------------------------------------
-- ⚠️ O TELEFONE ENTRA CRU. Ele já é guardado só com dígitos (o CHECK
-- `event_participants_phone_digits` garante), então quem cola "(11) 99999-8888"
-- da conversa encontra a pessoa depois de a busca tirar a máscara — ver
-- `p_query` na função abaixo.
alter table public.event_participants
  add column if not exists search_text text generated always as (
    translate(
      lower(
        coalesce(full_name, '') || ' ' ||
        coalesce(email, '') || ' ' ||
        coalesce(phone, '') || ' ' ||
        coalesce(whatsapp, '')
      ),
      'áàâãäåéèêëíìîïóòôõöúùûüçñ',
      'aaaaaaeeeeiiiiooooouuuucn'
    )
  ) stored;

comment on column public.event_participants.search_text is
  'Nome, e-mail e telefones sem acento e em minusculas. Espelha normalizeForSearch (src/lib/utils.ts).';

alter table public.event_registrations
  add column if not exists search_text text generated always as (
    translate(
      lower(coalesce(company_name, '')),
      'áàâãäåéèêëíìîïóòôõöúùûüçñ',
      'aaaaaaeeeeiiiiooooouuuucn'
    )
  ) stored;

comment on column public.event_registrations.search_text is
  'Granja/empresa sem acento e em minusculas. A busca da tela de Inscricoes olha esta e a do participante.';

-- A grid é sempre de UM evento, ordenada por data da inscrição. Sem este
-- índice, cada página é um scan da tabela inteira mais uma ordenação.
create index if not exists event_registrations_event_registered_idx
  on public.event_registrations (event_id, registered_at desc);


-- ----------------------------------------------------------------------------
-- 2. O quadro da tela: métricas + página + total, numa consulta
-- ----------------------------------------------------------------------------
-- Ordenações aceitas (§21). A lista é FECHADA de propósito: `p_sort` vem da URL,
-- e um `order by` montado com texto recebido de fora é injeção de SQL por outro
-- nome. Um valor desconhecido cai no padrão em vez de dar erro — uma URL colada
-- errada não deve devolver tela quebrada.
--
--   recent    (padrão)  as inscrições mais novas primeiro
--   company             por granja/empresa, e dentro dela por pessoa
--   participant         por nome da pessoa
create or replace function public.event_registrations_board(
  p_event_id uuid,
  p_query text default null,
  p_confirmation text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
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

      and (p_from is null or r.registered_at >= p_from)
      and (p_to is null or r.registered_at <= p_to)

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
  'Metricas, pagina e total dos participantes de um evento, com o MESMO filtro (Prompt 4, decisao 1).';

-- Sem grant para `anon`: esta tela é do CRM, e a tabela guarda dado pessoal de
-- terceiros. `authenticated` executa e a RLS decide o que ele enxerga.
revoke execute on function
  public.event_registrations_board(uuid, text, text, timestamptz, timestamptz, text, integer, integer)
  from public, anon;
grant execute on function
  public.event_registrations_board(uuid, text, text, timestamptz, timestamptz, text, integer, integer)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 3. Os eventos que têm página de inscrição (§4)
-- ----------------------------------------------------------------------------
-- A tela inicial de Inscrições. Uma função, e não um `select` com embeds, pelo
-- mesmo motivo da decisão 1: as cinco contagens por evento seriam N+1 do lado
-- do TypeScript — vinte eventos, vinte idas ao banco no meio da renderização.
create or replace function public.event_registration_summaries(
  p_query text default null,
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
  v_limite integer := greatest(1, least(coalesce(p_limit, 25), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_resultado jsonb;
begin
  v_texto := nullif(
    translate(
      lower(btrim(coalesce(p_query, ''))),
      'áàâãäåéèêëíìîïóòôõöúùûüçñ',
      'aaaaaaeeeeiiiiooooouuuucn'
    ), ''
  );
  v_texto := replace(replace(v_texto, '\', '\\'), '%', '\%');
  v_texto := replace(v_texto, '_', '\_');

  with paginas as (
    select l.id, l.event_id, l.slug, l.status, l.closes_at, l.max_participants,
           e.name, e.event_date, e.start_time, e.end_time
    from public.event_landing_pages l
    join public.events e on e.id = l.event_id
    where v_texto is null
       -- §4: nome do evento OU slug. Quem chega com o endereço colado de uma
       -- conversa procura por ele, e não pelo nome.
       or translate(lower(e.name), 'áàâãäåéèêëíìîïóòôõöúùûüçñ',
                    'aaaaaaeeeeiiiiooooouuuucn') like '%' || v_texto || '%'
       or l.slug like '%' || v_texto || '%'
  ),
  -- ⚠️ AS CONTAGENS SÓ DE INSCRIÇÃO ATIVA. Uma inscrição cancelada devolveu as
  -- vagas ao evento (decisão do Prompt 1) e não pode continuar contando como
  -- gente que vem.
  contagens as (
    select r.landing_page_id,
           count(distinct r.id)                                       as registrations,
           count(p.id)                                                as participants,
           count(p.id) filter (where p.confirmation = 'confirmed')     as confirmed,
           count(p.id) filter (where p.confirmation = 'not_confirmed') as not_confirmed
    from public.event_registrations r
    left join public.event_participants p on p.registration_id = r.id
    where r.status = 'active'
      and r.landing_page_id in (select id from paginas)
    group by r.landing_page_id
  ),
  total as (select count(*) as n from paginas),
  -- ⚠️ A ORDEM APARECE DUAS VEZES DE PROPÓSITO. Aqui ela decide QUAIS linhas
  -- entram na página (é o `limit`/`offset`); no `jsonb_agg` abaixo ela decide em
  -- que ordem elas saem. `jsonb_agg` sem `order by` segue a ordem de entrada na
  -- prática, mas isso não é garantido pelo Postgres — e uma grid que reordena
  -- sozinha entre dois carregamentos é o tipo de defeito que ninguém consegue
  -- reproduzir.
  --
  -- Eventos mais recentes primeiro: quem abre esta tela está atrás do evento que
  -- acabou de acontecer ou está por acontecer, não do de 2024.
  ordenado as (
    select pg.event_id, pg.id as landing_page_id, pg.slug, pg.status,
           pg.closes_at, pg.max_participants,
           pg.name, pg.event_date, pg.start_time, pg.end_time,
           coalesce(c.registrations, 0)  as registrations,
           coalesce(c.participants, 0)   as participants,
           coalesce(c.confirmed, 0)      as confirmed,
           coalesce(c.not_confirmed, 0)  as not_confirmed
    from paginas pg
    left join contagens c on c.landing_page_id = pg.id
    order by pg.event_date desc, pg.name asc
    limit v_limite
    offset v_offset
  )
  select jsonb_build_object(
    'total', (select n from total),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'eventId', o.event_id,
          'landingPageId', o.landing_page_id,
          'slug', o.slug,
          'landingStatus', o.status,
          'closesAt', o.closes_at,
          'maxParticipants', o.max_participants,
          'eventName', o.name,
          'eventDate', o.event_date,
          'startTime', o.start_time,
          'endTime', o.end_time,
          'registrations', o.registrations,
          'participants', o.participants,
          'confirmed', o.confirmed,
          'notConfirmed', o.not_confirmed
        )
        order by o.event_date desc, o.name asc
      )
      from ordenado o
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function public.event_registration_summaries is
  'Eventos com pagina de inscricao e as contagens de cada um. Tela inicial de Inscricoes (§4 do Prompt 4).';

revoke execute on function public.event_registration_summaries(text, integer, integer)
  from public, anon;
grant execute on function public.event_registration_summaries(text, integer, integer)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 4. Editar um participante (§13, §14, §15)
-- ----------------------------------------------------------------------------
-- ⚠️ NÃO EXISTIA. `set_participant_confirmation` diz, no comentário do Prompt 1,
-- que NÃO edita nome, e-mail nem telefone — "é operação para quando existir tela
-- que a peça". A tela é esta.
--
-- ⚠️ O CUIDADO QUE JUSTIFICA A FUNÇÃO SER NOVA E NÃO UM `update` DIRETO: mexer
-- no e-mail mexe na chave do §12 do Prompt 1. A conferência de duplicidade tem
-- de DESCONSIDERAR O PRÓPRIO PARTICIPANTE (§14) — sem isso, salvar a ficha sem
-- mexer no e-mail acusaria a pessoa de estar duplicada com ela mesma.
create or replace function public.update_event_participant(
  p_event_id uuid,
  p_participant_id uuid,
  p_full_name text default null,
  p_email text default null,
  p_phone text default null,
  p_whatsapp text default null,
  p_confirmation public.event_participant_confirmation default null
)
returns public.event_participants
language plpgsql
set search_path = ''
as $$
declare
  v_old public.event_participants;
  v_new public.event_participants;
  v_nome text;
  v_email text;
  v_phone text;
  v_whatsapp text;
  v_confirmation public.event_participant_confirmation;
  v_changes jsonb := '[]'::jsonb;
begin
  if not public.registrations_is_writer() then
    raise exception 'Sem permissão para alterar participantes.' using errcode = '42501';
  end if;

  -- §26 — a cadeia. O `and p.event_id = p_event_id` é o que impede um id de
  -- participante de OUTRO evento de ser editado por esta porta.
  select * into v_old
  from public.event_participants p
  where p.id = p_participant_id
    and p.event_id = p_event_id;

  if not found then
    -- ⚠️ MESMO CÓDIGO PARA "NÃO EXISTE" E PARA "É DE OUTRO EVENTO". Distinguir
    -- os dois transformaria esta função num oráculo: quem tentasse ids ao acaso
    -- descobriria quais existem no sistema.
    raise exception 'Participante não encontrado.' using errcode = 'P0002';
  end if;

  -- Nulo mantém o valor atual; é o mesmo contrato de `update_event_registration`.
  v_nome := coalesce(nullif(btrim(coalesce(p_full_name, '')), ''), v_old.full_name);
  v_email := coalesce(nullif(lower(btrim(coalesce(p_email, ''))), ''), v_old.email);
  v_confirmation := coalesce(p_confirmation, v_old.confirmation);

  -- ⚠️ TELEFONE E WHATSAPP NÃO USAM `coalesce` COM O VALOR ANTIGO, e a diferença
  -- é o §13 inteiro: eles precisam poder ser APAGADOS. Uma string vazia aqui
  -- significa "limpe este campo"; o contrato é o mesmo de `update_member`.
  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_whatsapp := nullif(regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g'), '');

  -- §15 — pelo menos um dos dois. O CHECK `event_participants_needs_a_phone`
  -- recusaria igual; esta checagem existe para a mensagem dizer o que fazer, em
  -- vez de a tela mostrar uma violação de constraint.
  if v_phone is null and v_whatsapp is null then
    raise exception 'Informe telefone ou WhatsApp para o participante.' using errcode = 'RG005';
  end if;

  if v_nome is null or char_length(btrim(v_nome)) < 2 then
    raise exception 'Informe o nome do participante.' using errcode = '23514';
  end if;

  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Informe um e-mail válido.' using errcode = '23514';
  end if;

  -- ⚠️ §14 — DUPLICIDADE, DESCONSIDERANDO O PRÓPRIO REGISTRO.
  --
  -- A garantia continua sendo o índice `event_participants_event_email_idx`,
  -- que é quem recusa duas requisições simultâneas. Esta checagem existe para
  -- DIZER QUAL e-mail é o problema — coisa que a violação de índice não sabe
  -- fazer. Ela olha só inscrição ATIVA, pela mesma razão de
  -- `create_event_registration`.
  if v_email is distinct from v_old.email and exists (
    select 1
    from public.event_participants p
    join public.event_registrations r on r.id = p.registration_id
    where p.event_id = p_event_id
      and p.id <> p_participant_id
      and r.status = 'active'
      and p.email = v_email
  ) then
    raise exception 'O e-mail % já está inscrito neste evento.', v_email using errcode = 'RG003';
  end if;

  update public.event_participants
  set full_name = btrim(v_nome),
      email = v_email,
      phone = v_phone,
      whatsapp = v_whatsapp,
      confirmation = v_confirmation,
      updated_by = (select auth.uid())
  where id = p_participant_id
  returning * into v_new;

  -- ⚠️ A TRILHA GUARDA QUE MUDOU, NÃO O QUE MUDOU (§25). Os nomes dos campos
  -- entram; os valores NÃO. Gravar "email: joao@x.com → joao@y.com" copiaria
  -- dado pessoal para uma tabela append-only que ninguém lembraria de limpar
  -- num pedido de exclusão — e a tabela `event_participants`, que é de onde o
  -- dado sai, está sob RLS.
  --
  -- A CONFIRMAÇÃO É A EXCEÇÃO, e é o §12: ela não identifica ninguém e é
  -- justamente a mudança que precisa de "de false para true" na trilha.
  if v_old.full_name is distinct from v_new.full_name then
    v_changes := v_changes || to_jsonb('fullName'::text);
  end if;
  if v_old.email is distinct from v_new.email then
    v_changes := v_changes || to_jsonb('email'::text);
  end if;
  if v_old.phone is distinct from v_new.phone then
    v_changes := v_changes || to_jsonb('phone'::text);
  end if;
  if v_old.whatsapp is distinct from v_new.whatsapp then
    v_changes := v_changes || to_jsonb('whatsapp'::text);
  end if;

  if jsonb_array_length(v_changes) > 0 then
    insert into public.event_registration_audit_logs (
      registration_id, event_id, action, actor_id, metadata
    ) values (
      v_new.registration_id,
      v_new.event_id,
      'participant_updated',
      (select auth.uid()),
      jsonb_build_object('participantId', v_new.id, 'fields', v_changes)
    );
  end if;

  -- A confirmação tem trilha própria, com valores — ver acima.
  if v_old.confirmation is distinct from v_new.confirmation then
    insert into public.event_registration_audit_logs (
      registration_id, event_id, action, actor_id, metadata
    ) values (
      v_new.registration_id,
      v_new.event_id,
      'participant_confirmation_changed',
      (select auth.uid()),
      jsonb_build_object(
        'participantId', v_new.id,
        'from', v_old.confirmation,
        'to', v_new.confirmation
      )
    );
  end if;

  return v_new;
end;
$$;

comment on function public.update_event_participant is
  'Edita nome, e-mail, telefones e confirmacao de um participante, conferindo o evento (§13, §14, §26 do Prompt 4).';

revoke execute on function public.update_event_participant(
  uuid, uuid, text, text, text, text, public.event_participant_confirmation
) from public, anon;
grant execute on function public.update_event_participant(
  uuid, uuid, text, text, text, text, public.event_participant_confirmation
) to authenticated;


-- ----------------------------------------------------------------------------
-- 5. O toggle de confirmação, agora atômico e com escopo de evento
-- ----------------------------------------------------------------------------
-- Ver as decisões 3 e 4 do cabeçalho. `drop` e recria porque a assinatura muda
-- (`p_event_id` entrou): `create or replace` criaria uma sobrecarga e a chamada
-- por nome ficaria ambígua.
drop function if exists public.set_participant_confirmation(
  uuid, public.event_participant_confirmation
);

create or replace function public.set_participant_confirmation(
  p_event_id uuid,
  p_participant_id uuid,
  p_confirmation public.event_participant_confirmation
)
returns public.event_participants
language plpgsql
set search_path = ''
as $$
declare
  v_old public.event_participants;
  v_new public.event_participants;
begin
  if not public.registrations_is_writer() then
    raise exception 'Sem permissão para alterar participantes.' using errcode = '42501';
  end if;

  -- §26 — a cadeia, antes de qualquer coisa.
  select * into v_old
  from public.event_participants p
  where p.id = p_participant_id
    and p.event_id = p_event_id;

  if not found then
    raise exception 'Participante não encontrado.' using errcode = 'P0002';
  end if;

  -- ⚠️ COMPARE-AND-SET: a condição está DENTRO do update (decisão 4). Um duplo
  -- clique, um retry ou dois operadores na mesma pessoa não geram duas linhas
  -- de trilha dizendo que houve mudança — a segunda simplesmente não atualiza
  -- nada, e `v_new` volta nulo.
  update public.event_participants
  set confirmation = p_confirmation,
      updated_by = (select auth.uid())
  where id = p_participant_id
    and event_id = p_event_id
    and confirmation is distinct from p_confirmation
  returning * into v_new;

  if v_new.id is null then
    -- Já estava no valor pedido. É sucesso, e não erro: a operação é idempotente
    -- (§23), e quem clicou duas vezes vê o mesmo estado das duas vezes.
    return v_old;
  end if;

  -- ⚠️ O ID DO PARTICIPANTE, NUNCA O NOME OU O E-MAIL (§25). Quem precisa saber
  -- de quem se trata consulta a tabela, que está sob RLS.
  insert into public.event_registration_audit_logs (
    registration_id, event_id, action, actor_id, metadata
  ) values (
    v_new.registration_id,
    v_new.event_id,
    'participant_confirmation_changed',
    (select auth.uid()),
    jsonb_build_object(
      'participantId', v_new.id,
      'from', v_old.confirmation,
      'to', v_new.confirmation
    )
  );

  return v_new;
end;
$$;

revoke execute on function public.set_participant_confirmation(
  uuid, uuid, public.event_participant_confirmation
) from public, anon;
grant execute on function public.set_participant_confirmation(
  uuid, uuid, public.event_participant_confirmation
) to authenticated;


-- ----------------------------------------------------------------------------
-- 6. Editar a granja/empresa da inscrição, com escopo de evento
-- ----------------------------------------------------------------------------
-- Mesma mudança da seção 5: `p_event_id` entrou (decisão 3). O corpo é o do
-- Prompt 1 — inclusive a reconferência de capacidade ao reativar, que continua
-- valendo mesmo sem tela para ela: o §16 proíbe EXCLUSÃO, e o cancelamento
-- continua sendo a operação que a substitui quando existir tela que a peça.
drop function if exists public.update_event_registration(
  uuid, text, public.event_registration_status
);

create or replace function public.update_event_registration(
  p_event_id uuid,
  p_registration_id uuid,
  p_company_name text default null,
  p_status public.event_registration_status default null
)
returns public.event_registrations
language plpgsql
set search_path = ''
as $$
declare
  v_old public.event_registrations;
  v_new public.event_registrations;
  v_page public.event_landing_pages;
  v_changes jsonb := '[]'::jsonb;
  v_action public.event_registration_audit_action := 'registration_updated';
  v_target public.event_registration_status;
  v_livres integer;
  v_pessoas integer;
begin
  if not public.registrations_is_writer() then
    raise exception 'Sem permissão para alterar inscrições.' using errcode = '42501';
  end if;

  -- §26 — a cadeia.
  select * into v_old
  from public.event_registrations r
  where r.id = p_registration_id
    and r.event_id = p_event_id;

  if not found then
    raise exception 'Inscrição não encontrada.' using errcode = 'P0002';
  end if;

  -- O lock é da PÁGINA, não da inscrição: reativar consome vaga, e vaga é um
  -- recurso da página.
  perform public.lock_event_landing_page(v_old.landing_page_id);

  v_target := coalesce(p_status, v_old.status);

  -- ⚠️ REATIVAR CONFERE A CAPACIDADE DE NOVO. Entre o cancelamento e a
  -- reativação, outras pessoas podem ter tomado as vagas devolvidas.
  if v_target = 'active' and v_old.status = 'cancelled' then
    select * into v_page
    from public.event_landing_pages l
    where l.id = v_old.landing_page_id;

    if v_page.max_participants is not null then
      select count(*)::integer into v_pessoas
      from public.event_participants p
      where p.registration_id = v_old.id;

      v_livres := v_page.max_participants
                - public.event_landing_participant_count(v_page.id);

      if v_pessoas > v_livres then
        raise exception 'Não há vagas suficientes para reativar esta inscrição: restam %.',
          greatest(v_livres, 0) using errcode = 'RG002';
      end if;
    end if;
  end if;

  update public.event_registrations
  set company_name = coalesce(nullif(btrim(coalesce(p_company_name, '')), ''), v_old.company_name),
      status = v_target,
      updated_by = (select auth.uid())
  where id = p_registration_id
  returning * into v_new;

  -- ⚠️ O NOME DA GRANJA ENTRA NA TRILHA, ao contrário do nome da PESSOA. Uma
  -- granja é pessoa jurídica: o nome dela não é dado pessoal, e é justamente o
  -- que alguém vai querer conferir ao investigar "por que esta inscrição mudou
  -- de empresa?".
  if v_old.company_name is distinct from v_new.company_name then
    v_changes := v_changes || jsonb_build_object(
      'field', 'companyName', 'from', v_old.company_name, 'to', v_new.company_name
    );
  end if;

  if v_old.status is distinct from v_new.status then
    v_action := (case
      when v_new.status = 'cancelled' then 'registration_cancelled'
      else 'registration_reactivated'
    end)::public.event_registration_audit_action;
    v_changes := v_changes || jsonb_build_object(
      'field', 'status', 'from', v_old.status, 'to', v_new.status
    );
  end if;

  if jsonb_array_length(v_changes) > 0 then
    insert into public.event_registration_audit_logs (
      registration_id, event_id, action, actor_id, metadata
    ) values (
      v_new.id, v_new.event_id, v_action, (select auth.uid()),
      jsonb_build_object('changes', v_changes)
    );
  end if;

  return v_new;
end;
$$;

revoke execute on function public.update_event_registration(
  uuid, uuid, text, public.event_registration_status
) from public, anon;
grant execute on function public.update_event_registration(
  uuid, uuid, text, public.event_registration_status
) to authenticated;


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   drop function if exists public.update_event_registration(uuid, uuid, text, public.event_registration_status);
--   drop function if exists public.set_participant_confirmation(uuid, uuid, public.event_participant_confirmation);
--   drop function if exists public.update_event_participant(uuid, uuid, text, text, text, text, public.event_participant_confirmation);
--   drop function if exists public.event_registration_summaries(text, integer, integer);
--   drop function if exists public.event_registrations_board(uuid, text, text, timestamptz, timestamptz, text, integer, integer);
--   drop index if exists public.event_registrations_event_registered_idx;
--   alter table public.event_registrations drop column if exists search_text;
--   alter table public.event_participants drop column if exists search_text;
--   -- e recriar as versões de 20260922000100 de update_event_registration e
--   -- set_participant_confirmation (as duas de assinatura menor).
--
-- ⚠️ NENHUMA LINHA DE DADO É TOCADA. As colunas novas são GERADAS (derivadas do
-- que já existe) e as funções não mudam nenhum registro ao serem recriadas.
-- ============================================================================
