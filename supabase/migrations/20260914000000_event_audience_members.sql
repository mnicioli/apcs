-- ============================================================================
-- A AUDIÊNCIA DE EVENTOS PASSA A TER FONTE: o cadastro de associados
-- ============================================================================
--
-- `src/modules/event/event.audience.ts` foi escrito em agosto com um aviso no
-- topo: "não existe cadastro de associados neste sistema" — e a única
-- implementação da porta era `NO_ASSOCIATE_REGISTRY`, que responde "não sei"
-- para tudo. Aquilo estava certo na época e o arquivo termina prometendo:
--
--     "No dia em que o cadastro existir, escreve-se uma implementação de
--      EventAudienceSource e nada mais neste módulo muda."
--
-- O cadastro existe desde `20260821000000_create_membership.sql`. Estas duas
-- funções são a metade dessa promessa que mora no banco.
--
-- ----------------------------------------------------------------------------
-- ⚠️ POR QUE NO BANCO, E NÃO EM TYPESCRIPT
-- ----------------------------------------------------------------------------
-- A tradução "público-alvo → perfil de associado" já existe e é
-- `profile_for_event_segment(slug)`, de `20260828205853_event_dispatch.sql`.
-- Reescrevê-la em TypeScript criaria a segunda verdade sobre a mesma coisa — e
-- as duas divergiriam no dia em que um público novo aparecesse, com o sintoma
-- aparecendo só no envio.
--
-- `security definer` pelo motivo de sempre neste módulo: o consumidor é o
-- chatbot, que é ANÔNIMO. Uma função INVOKER devolveria vazio para quem ela
-- existe para atender. O que elas expõem é estreito de propósito — slugs de
-- público e ids de associado, nunca nome, telefone ou e-mail.
--
-- DEPENDE DE: 20260821000000_create_membership.sql (members),
--             20260828205853_event_dispatch.sql (profile_for_event_segment),
--             20260813000100_seed_event_segments.sql ('all-members')
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. A que públicos este associado pertence
-- ----------------------------------------------------------------------------
-- ⚠️ `null` E `'{}'` SÃO RESPOSTAS DIFERENTES, e a distinção é o motivo de esta
-- função ser plpgsql em vez de uma linha de SQL:
--
--     null   "não sei quem é você"   → o bot encaminha para uma pessoa
--     '{}'   "você não está em nenhum público"  → a resposta é zero eventos
--
-- É o mesmo contrato de `AudienceLookup` no TypeScript, e o mesmo erro que ele
-- existe para evitar: colapsar os dois num array vazio faria o robô dizer "não
-- há eventos para você" para alguém que ele simplesmente não identificou.
--
-- ⚠️ 'all-members' ENTRA SEMPRE. É o atalho "toda a base", e
-- `profile_for_event_segment('all-members')` devolve null de propósito — ele não
-- corresponde a perfil nenhum porque corresponde a todos. Sem o `or` explícito
-- abaixo, um evento aberto a toda a associação não alcançaria associado nenhum.
--
-- ⚠️ ASSOCIADO SEM `profile_type` RECEBE SÓ 'all-members'. Não é bug: é a
-- consequência honesta de um cadastro incompleto, e é visível — a pessoa
-- continua alcançável pelos eventos gerais e some dos segmentados. Foi
-- exatamente esse campo em branco que derrubou o público das Enquetes; ver
-- `supabase/diagnostico-alcance-enquetes.sql`, seção 5.
create or replace function public.event_segments_for_member(p_member_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_perfil public.membership_profile_type;
  v_existe boolean := false;
begin
  select m.profile_type, true
    into v_perfil, v_existe
  from public.members m
  where m.id = p_member_id
    and m.status = 'active';

  if not v_existe then
    return null;
  end if;

  return (
    select coalesce(array_agg(s.slug order by s.slug), '{}'::text[])
    from public.event_segments s
    where s.active
      and (
        s.slug = 'all-members'
        or public.profile_for_event_segment(s.slug) = v_perfil
      )
  );
end;
$fn$;

comment on function public.event_segments_for_member(uuid) is
  'Os slugs de publico-alvo de um associado ATIVO. null = associado desconhecido ou inativo, que e diferente de lista vazia.';


-- ----------------------------------------------------------------------------
-- 2. Quais associados estão em QUALQUER um destes públicos (OU)
-- ----------------------------------------------------------------------------
-- ⚠️ OU, NUNCA E — a regra do escopo. Pertencer a um dos públicos do evento
-- basta. E quem pertence a dois aparece UMA vez: `distinct` aqui é o que impede
-- uma futura campanha de mandar a mesma mensagem duas vezes para a mesma
-- pessoa.
--
-- ⚠️ LISTA DE PÚBLICOS VAZIA DEVOLVE ZERO ASSOCIADOS, e não "todos". Ler
-- ausência de público como alcance total é exatamente o que geraria comunicação
-- indevida — o mesmo cuidado que `getAvailableEvents` já toma do outro lado.
create or replace function public.members_in_event_segments(p_slugs text[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(array_agg(distinct m.id), '{}'::uuid[])
  from public.members m
  where m.status = 'active'
    and coalesce(cardinality(p_slugs), 0) > 0
    and exists (
      select 1
      from public.event_segments s
      where s.slug = any(p_slugs)
        and s.active
        and (
          s.slug = 'all-members'
          or public.profile_for_event_segment(s.slug) = m.profile_type
        )
    );
$fn$;

comment on function public.members_in_event_segments(text[]) is
  'Ids dos associados ativos em QUALQUER um dos publicos (OU), sem repeticao. Lista vazia de publicos devolve zero associados.';


-- ----------------------------------------------------------------------------
-- 3. Privilégios
-- ----------------------------------------------------------------------------
-- ⚠️ A LIÇÃO DE 20260912000000 APLICADA ANTES DE DOER: as duas funções abaixo
-- são DEFINER, então o que elas chamam por dentro roda como dono — mas CHAMÁ-LAS
-- exige EXECUTE nelas mesmas. Foi exatamente esse detalhe que quebrou o público
-- das Enquetes em produção.
--
-- `anon` não recebe: o chatbot entra pelo servidor Next com `service_role`
-- (que ignora grants), como Palestras e Enquetes já fazem. A superfície pública
-- do banco continua sendo zero. `authenticated` recebe porque as telas de
-- Eventos vão querer responder "quantos este evento alcança?".
revoke execute on function public.event_segments_for_member(uuid) from public, anon;
revoke execute on function public.members_in_event_segments(text[]) from public, anon;
grant execute on function public.event_segments_for_member(uuid) to authenticated;
grant execute on function public.members_in_event_segments(text[]) to authenticated;


-- ============================================================================
-- A CONFERÊNCIA
-- ----------------------------------------------------------------------------
-- ⚠️ ELA NÃO LÊ `public.members`. O papel que o `supabase db push` usa não tem
-- privilégio de leitura naquela tabela — foi assim que 20260912000000 abortou
-- duas vezes num relatório que não tinha nada a ver com a correção. O que dá
-- para perguntar aqui sem encenação é ao CATÁLOGO.
-- ============================================================================
do $conferencia$
begin
  -- 1. O atalho de toda a base existe? Sem ele, `event_segments_for_member`
  --    devolveria lista vazia para todo associado sem perfil definido, e um
  --    evento aberto a toda a associação não alcançaria ninguém.
  if not exists (select 1 from public.event_segments where slug = 'all-members') then
    raise exception
      'O publico "all-members" nao existe. Aplique 20260813000100_seed_event_segments.sql antes desta.';
  end if;

  -- 2. `authenticated` executa as duas? É a armadilha de 20260912000000.
  if not has_function_privilege('authenticated', 'public.event_segments_for_member(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.members_in_event_segments(text[])', 'EXECUTE') then
    raise exception 'authenticated nao pode executar as funcoes de audiencia — devolveriam 42501 na tela.';
  end if;

  raise notice 'Audiencia de eventos: funcoes criadas e executaveis por authenticated.';
end;
$conferencia$;


-- ============================================================================
-- ROLLBACK (manual)
-- ----------------------------------------------------------------------------
--   drop function if exists public.event_segments_for_member(uuid);
--   drop function if exists public.members_in_event_segments(text[]);
--   -- (event-chatbot.ts volta a responder "unknown-audience" para tudo)
-- ============================================================================
