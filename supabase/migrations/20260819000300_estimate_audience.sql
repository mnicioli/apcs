-- ============================================================================
-- Enquetes — estimar o público ANTES de salvar (§30)
-- ----------------------------------------------------------------------------
-- O §30 pede que a tela mostre "Público estimado: 1.245" e ATUALIZE o número a
-- cada mudança de critério. Até aqui só existia `resolve_survey_audience(uuid)`,
-- que precisa de uma enquete já gravada — e no formulário de criação ela ainda
-- não existe.
--
-- ⚠️ A DECISÃO: a regra do §31 (OR dentro da dimensão, AND entre dimensões)
-- passa a viver em UM lugar só — `resolve_audience_criteria(jsonb)` —, e a
-- função por enquete vira um invólucro que lê os critérios e delega.
--
-- A alternativa seria reimplementar a combinação no TypeScript para a
-- estimativa. Foi recusada, e o §66 diz o porquê ("não duplicar regra de negócio
-- no frontend"): duas implementações da mesma regra divergem no primeiro ajuste,
-- e a divergência apareceria como "a tela disse 1.245 e chegaram 900" — depois
-- do envio, quando já não dá para desfazer.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A regra, agora sobre CRITÉRIOS soltos
-- ----------------------------------------------------------------------------
-- Mesma lógica que estava em `resolve_survey_audience`, palavra por palavra — só
-- que lendo de um jsonb em vez da tabela.
--
-- SECURITY INVOKER: a RLS de `chat_contacts` continua valendo. Quem não pode ler
-- contatos não descobre por aqui quantas pessoas a APCS tem cadastradas.
create or replace function public.resolve_audience_criteria(p_criteria jsonb)
returns table (contact_id uuid, full_name text, phone text)
language sql
stable
set search_path = ''
as $$
  with k as (
    select
      c->>'dimension' as dimension,
      nullif(c->>'contactId', '')::uuid as contact_id,
      nullif(btrim(c->>'value'), '') as value
    from jsonb_array_elements(coalesce(p_criteria, '[]'::jsonb)) as c
  )
  select c.id, c.full_name, c.phone
  from public.chat_contacts c
  where c.phone is not null
    and (
      -- §24. O atalho "toda a base" dispensa os demais critérios.
      exists (select 1 from k where k.dimension = 'all')
      or (
        -- §27 REGIÃO → a UF do contato.
        (
          not exists (select 1 from k where k.dimension = 'region')
          or exists (
            select 1 from k
            where k.dimension = 'region' and upper(k.value) = upper(c.state)
          )
        )
        -- §28 PERFIL → o perfil declarado na triagem.
        and (
          not exists (select 1 from k where k.dimension = 'profile')
          or exists (
            select 1 from k
            where k.dimension = 'profile' and k.value = c.contact_profile::text
          )
        )
        -- §30 GRUPO ESPECÍFICO → contatos escolhidos a dedo.
        and (
          not exists (select 1 from k where k.dimension = 'contact')
          or exists (
            select 1 from k where k.dimension = 'contact' and k.contact_id = c.id
          )
        )
        -- Sem nenhum critério resolvível, o público é vazio — e não "todos".
        -- Sem esta linha, uma seleção que só tivesse as dimensões sem cadastro
        -- de apoio (Segmento, Categoria, Carteira) alcançaria a base inteira por
        -- omissão, e a estimativa mentiria para cima.
        and exists (
          select 1 from k where k.dimension in ('region', 'profile', 'contact')
        )
      )
    )
  order by c.full_name nulls last, c.id;
$$;

comment on function public.resolve_audience_criteria(jsonb) is
  'A regra do §31 (OR dentro da dimensão, AND entre dimensões) — a ÚNICA implementação. Elegível = contato com telefone.';

revoke execute on function public.resolve_audience_criteria(jsonb) from public, anon;
grant execute on function public.resolve_audience_criteria(jsonb) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. O número, que é o que a tela mostra (§30)
-- ----------------------------------------------------------------------------
-- Função à parte para a tela não precisar trazer a lista inteira só para contar.
create or replace function public.estimate_audience_criteria(p_criteria jsonb)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer from public.resolve_audience_criteria(p_criteria);
$$;

revoke execute on function public.estimate_audience_criteria(jsonb) from public, anon;
grant execute on function public.estimate_audience_criteria(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. A função por enquete vira um invólucro
-- ----------------------------------------------------------------------------
-- ⚠️ O CORPO MUDA, A ASSINATURA NÃO. `schedule_survey` e
-- `count_survey_audience` continuam chamando exatamente o que chamavam — e
-- passam a usar a mesma implementação que a estimativa da tela. É isso que
-- garante que o número previsto e o número fotografado sejam o mesmo número.
create or replace function public.resolve_survey_audience(p_survey_id uuid)
returns table (contact_id uuid, full_name text, phone text)
language sql
stable
set search_path = ''
as $$
  select r.contact_id, r.full_name, r.phone
  from public.resolve_audience_criteria((
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'dimension', k.dimension,
        'contactId', k.contact_id,
        'value', k.value
      )),
      '[]'::jsonb
    )
    from public.survey_audience_criteria k
    where k.survey_id = p_survey_id
  )) r;
$$;

comment on function public.resolve_survey_audience(uuid) is
  'O público de uma enquete gravada. Delega a regra a resolve_audience_criteria — uma implementação só (§31).';

-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   -- 1. devolver o corpo de resolve_survey_audience da migration
--   --    20260819000000 (a versão que consultava a tabela diretamente);
--   drop function if exists public.estimate_audience_criteria(jsonb);
--   drop function if exists public.resolve_audience_criteria(jsonb);
--
-- ⚠️ A ORDEM IMPORTA: `resolve_survey_audience` depende de
-- `resolve_audience_criteria`. Derrubar a segunda antes de restaurar a primeira
-- deixaria `schedule_survey` quebrada.
-- ============================================================================
