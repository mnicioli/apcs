-- ============================================================================
-- DIAGNÓSTICO: quantos associados uma enquete alcança, e onde os outros somem
-- ============================================================================
--
-- COMO RODAR: cole no SQL Editor do Dashboard do Supabase e execute. Ele SÓ LÊ —
-- não cria, não altera e não apaga nada.
--
-- ⚠️ POR QUE NÃO ESTÁ NUMA MIGRATION. Estava, e a migration abortava: o papel
-- que o `supabase db push` usa não tem privilégio de leitura em `public.members`,
-- então um relatório derrubava uma correção de schema que não tinha nada a ver.
-- O SQL Editor roda com um papel que lê tudo — é o lugar certo para perguntar.
--
-- QUANDO USAR: a tela de enquete mostra "Público estimado: nenhum associado" e
-- você quer saber se o problema é a segmentação ou o cadastro.
--
-- ⚠️ A ORDEM DAS LINHAS É A ORDEM DOS FILTROS de `resolve_audience_criteria`
-- (20260909000000_survey_audience_members.sql). O número cai exatamente no
-- filtro que está tirando as pessoas — é isso que a saída mostra.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. O funil, de cima para baixo
-- ----------------------------------------------------------------------------
with base as (
  select
    m.status,
    m.whatsapp,
    m.contact_id,
    m.profile_type,
    public.notification_phone_key(m.whatsapp) as chave
  from public.members m
)
select
  'associados cadastrados'                        as etapa,
  count(*)                                        as quantos,
  ''                                              as observacao
from base
union all
select
  'com situacao ATIVA',
  count(*),
  'inativo nao recebe — e a primeira condicao de resolve_audience_criteria'
from base where status = 'active'
union all
select
  '  + WhatsApp utilizavel (>= 10 digitos)',
  count(*),
  'a coluna guarda so digitos; DDD + numero'
from base where status = 'active' and length(chave) >= 10
union all
select
  '  + ligado a agenda (members.contact_id)',
  count(*),
  'preenchido pelo gatilho members_link_phone_book; e por ele que a enquete identifica quem responde'
from base where status = 'active' and length(chave) >= 10 and contact_id is not null
union all
select
  '  + com perfil definido (profile_type)',
  count(*),
  'sem perfil, nenhum publico-alvo alcanca a pessoa'
from base
where status = 'active' and length(chave) >= 10 and contact_id is not null
  and profile_type is not null
union all
select
  '= ALCANCE FINAL (telefones distintos)',
  count(distinct chave),
  'e este o numero que a tela mostra em "Toda a base"'
from base
where status = 'active' and length(chave) >= 10 and contact_id is not null
  and profile_type is not null;

-- ----------------------------------------------------------------------------
-- 2. O alcance de cada público-alvo
-- ----------------------------------------------------------------------------
-- É o número que a tela mostra ao marcar cada chip. Zero aqui com gente no funil
-- acima significa que os associados existem mas estão com OUTRO perfil.
select
  s.name                                                          as publico_alvo,
  public.profile_for_event_segment(s.slug)::text                  as perfil_correspondente,
  count(distinct public.notification_phone_key(m.whatsapp))       as alcance
from public.event_segments s
left join public.members m
  on m.profile_type = public.profile_for_event_segment(s.slug)
 and m.status = 'active'
 and m.contact_id is not null
 and length(public.notification_phone_key(m.whatsapp)) >= 10
where s.active
  and public.profile_for_event_segment(s.slug) is not null
group by s.name, s.slug
order by s.name;

-- ----------------------------------------------------------------------------
-- 3. Quem está de fora, e por quê
-- ----------------------------------------------------------------------------
-- ⚠️ SEM NOME E SEM TELEFONE. A pergunta é "quantos e por qual motivo", não
-- "quem" — um diagnóstico não precisa de dado pessoal para responder isso, e
-- colar a saída num chat é o destino mais provável dele.
select
  case
    when m.status <> 'active'                                    then '1. situacao nao e ATIVA'
    when length(public.notification_phone_key(m.whatsapp)) < 10  then '2. sem WhatsApp utilizavel'
    when m.contact_id is null                                    then '3. sem ligacao com a agenda'
    when m.profile_type is null                                  then '4. sem perfil definido'
    else                                                              '0. alcancavel'
  end                as motivo,
  count(*)           as quantos
from public.members m
group by 1
order by 1;

-- ----------------------------------------------------------------------------
-- 4. As situações que existem no cadastro
-- ----------------------------------------------------------------------------
-- Se "com situacao ATIVA" veio zero, é aqui que se vê o que os associados são.
select m.status::text as situacao, count(*) as quantos
from public.members m
group by 1
order by 2 desc;

-- ----------------------------------------------------------------------------
-- 5. Os perfis que existem no cadastro
-- ----------------------------------------------------------------------------
-- `null` aqui é o caso mais comum de "o cadastro tem gente e a enquete não
-- alcança ninguém": a carga trouxe os associados sem perfil, e o público-alvo
-- filtra justamente por ele.
select coalesce(m.profile_type::text, '(sem perfil)') as perfil, count(*) as quantos
from public.members m
group by 1
order by 2 desc;
