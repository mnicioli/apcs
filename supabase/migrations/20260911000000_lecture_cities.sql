-- ============================================================================
-- CIDADES: um catálogo que se preenche sozinho
-- ============================================================================
--
-- O PEDIDO: "assim como implementamos em Palestrante — um dropdown do que já
-- está cadastrado e a opção Outro para acrescentar —, o mesmo mecanismo em
-- Cidade. E a tela de consulta deve ter o dropdown das cidades cadastradas."
--
-- O PROBLEMA REAL: `lectures.city` é texto livre desde
-- 20260816000000_create_lectures.sql. Sem catálogo, "Espírito Santo do Pinhal",
-- "espirito santo do pinhal" e "Esp. Sto. do Pinhal" são três cidades para o
-- banco e uma só para quem lê. O filtro por cidade — que existe — encontra uma
-- grafia e perde as outras duas, em silêncio.
--
-- ----------------------------------------------------------------------------
-- ⚠️ A DIFERENÇA PARA `lecture_speakers`, E POR QUE ELA EXISTE
-- ----------------------------------------------------------------------------
-- O catálogo de palestrantes precisou de uma COLUNA NOVA em `lectures`
-- (`speaker_catalog_id`) porque ali havia DUAS origens possíveis para a mesma
-- informação: um perfil do CRM ou um nome externo. Duas colunas, um CHECK, e a
-- regra "uma palestra tem um palestrante" imposta pelo banco.
--
-- Cidade não tem essa dualidade: uma cidade é uma cidade. Então `lectures.city`
-- CONTINUA sendo a fonte da verdade — é ela que a tela mostra, que
-- `search_text` indexa e que o filtro consulta —, e o catálogo é só a LISTA de
-- valores distintos, mantida em dia por um gatilho.
--
-- O que se ganha ao não criar FK nem coluna: nada em `create_lecture`,
-- `update_lecture` ou `create_lecture_request` precisa mudar de assinatura. As
-- três — mais qualquer caminho futuro — passam pelo gatilho de graça. Trocar as
-- assinaturas exigiria `drop` + `create` + regrant nas três, e cada uma dessas
-- é uma chance de 42725 em produção (ver a seção 7 de
-- 20260905000000_lecture_speakers.sql).
--
-- ⚠️ O GATILHO TAMBÉM PADRONIZA A GRAFIA. Quem digitar "espirito santo do
-- pinhal" grava "Espírito Santo do Pinhal" — a forma que já estava no catálogo.
-- É isso que mantém a lista curta e o filtro certo, inclusive no caminho do
-- chatbot, onde ninguém revisa o que foi digitado.
--
-- DEPENDE DE: 20260816000000_create_lectures.sql, 20260905000000_lecture_speakers.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A chave de comparação
-- ----------------------------------------------------------------------------
-- ⚠️ REUSA `speaker_name_key`, e isso é deliberado. A pergunta é a mesma —
-- "estes dois textos são o mesmo nome?" — e duas funções que respondem a mesma
-- pergunta divergem no primeiro ajuste. A tabela de tradução dela já concorda
-- com `lectures.search_text` e com `normalizeForSearch` (src/lib/utils.ts); uma
-- quarta implementação seria uma quarta chance de discordar.
--
-- O nome da função fala de palestrante e passa a servir a cidade também. O
-- comentário abaixo registra isso, para quem a encontrar não achar que é uso
-- indevido.
comment on function public.speaker_name_key is
  'Chave de comparação de nome: minúsculas, sem acento, sem espaço nas pontas. Usada por lecture_speakers.name_key e por lecture_cities.name_key.';

-- ----------------------------------------------------------------------------
-- 2. O catálogo
-- ----------------------------------------------------------------------------
create table if not exists public.lecture_cities (
  id uuid primary key default gen_random_uuid(),

  -- A cidade COMO FOI DIGITADA da primeira vez — é ela que aparece na tela e é
  -- para ela que o gatilho padroniza as grafias seguintes.
  name text not null,

  -- A chave de deduplicação. Gerada: ninguém a escreve, ninguém a corrige.
  name_key text generated always as (public.speaker_name_key(name)) stored,

  -- Para tirar da lista uma digitação errada SEM apagar as palestras dela.
  active boolean not null default true,

  created_at timestamptz not null default now(),

  constraint lecture_cities_name_len
    check (btrim(name) <> '' and length(name) <= 120)
);

-- ⚠️ ÍNDICE ÚNICO, e não um `unique` decorativo: é ele que o `on conflict` da
-- seção 3 infere, e é ele que impede duas linhas para a mesma cidade quando duas
-- palestras são cadastradas ao mesmo tempo.
create unique index if not exists lecture_cities_key_idx
  on public.lecture_cities (name_key);

-- A lista do seletor: ativas, em ordem alfabética.
create index if not exists lecture_cities_active_idx
  on public.lecture_cities (name) where active;

comment on table public.lecture_cities is
  'Catalogo de cidades das palestras. Preenchido pelo gatilho lectures_normalize_city — lectures.city continua sendo a fonte da verdade.';

-- ----------------------------------------------------------------------------
-- 3. Resolver um texto na grafia canônica
-- ----------------------------------------------------------------------------
-- Devolve o nome da cidade como o catálogo a conhece, criando a linha na
-- primeira vez. É isto que faz o "Outro" do formulário virar uma opção do
-- seletor na próxima palestra, sem tela de cadastro de cidade.
--
-- ⚠️ SECURITY DEFINER, ao contrário de `resolve_lecture_speaker`. A diferença
-- não é descuido: aquela é chamada pelo formulário, por quem tem
-- `lectures.write`. Esta roda dentro de um GATILHO, e um gatilho dispara também
-- para o `create_lecture_request` do chatbot, que grava com `service_role` e por
-- um caminho onde `authenticated` não existe. Como INVOKER, o catálogo deixaria
-- de receber justamente as cidades que chegam sozinhas.
--
-- O que ela pode fazer é estreito por construção: inserir uma cidade e devolver
-- um texto. Não lê nem escreve nada mais.
create or replace function public.resolve_lecture_city(p_city text)
returns text
language plpgsql
security definer
set search_path = ''
as $funcao$
declare
  v_city text := btrim(coalesce(p_city, ''));
  v_canonica text;
begin
  if v_city = '' then
    return null;
  end if;

  -- ⚠️ O `insert` VEM PRIMEIRO, e não depois de um `select` que não achou nada.
  -- Com o select antes, duas sessões cadastrando palestras na mesma cidade nova
  -- ao mesmo tempo passariam as duas pelo "não existe" e a segunda estouraria
  -- com violação de unicidade — um erro genérico na cara de quem só digitou uma
  -- cidade. Assim a segunda cai no `do nothing` e lê a linha que a primeira
  -- criou. Mesma decisão de `resolve_lecture_speaker`.
  insert into public.lecture_cities (name)
  values (v_city)
  on conflict (name_key) do nothing;

  select c.name into v_canonica
  from public.lecture_cities c
  where c.name_key = public.speaker_name_key(v_city);

  -- Cidade desativada volta para a lista: quem acabou de digitá-la está dizendo
  -- que há palestra lá de novo.
  update public.lecture_cities
  set active = true
  where name_key = public.speaker_name_key(v_city) and not active;

  -- `coalesce` por segurança: se por algum motivo a leitura não achar a linha,
  -- é melhor gravar o que a pessoa digitou do que gravar NULL numa coluna
  -- `not null` e derrubar o cadastro inteiro.
  return coalesce(v_canonica, v_city);
end;
$funcao$;

comment on function public.resolve_lecture_city is
  'Grafia canonica da cidade, criando a linha do catalogo na primeira vez. NULL para texto vazio.';

revoke execute on function public.resolve_lecture_city(text) from public, anon;
grant execute on function public.resolve_lecture_city(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. O gatilho
-- ----------------------------------------------------------------------------
-- ⚠️ BEFORE, para poder REESCREVER `new.city` com a grafia canônica. Um AFTER só
-- conseguiria registrar a cidade no catálogo — e aí "Espírito Santo do Pinhal" e
-- "espirito santo do pinhal" continuariam sendo duas palestras em cidades
-- diferentes para o filtro, que é metade do problema.
--
-- ⚠️ SEM `of city` NA CLÁUSULA DE UPDATE. Restringir às atualizações que tocam a
-- coluna pareceria uma economia, mas `update_lecture` reescreve a linha inteira
-- a cada salvamento: a coluna consta do UPDATE mesmo quando o valor não muda, e
-- a diferença seria só aparente. Sem a restrição, o comportamento é o mesmo em
-- qualquer caminho de escrita — inclusive num futuro que ainda não existe.
create or replace function public.lectures_normalize_city()
returns trigger
language plpgsql
security definer
set search_path = ''
as $funcao$
begin
  new.city := coalesce(public.resolve_lecture_city(new.city), new.city);
  return new;
end;
$funcao$;

comment on function public.lectures_normalize_city is
  'Padroniza lectures.city pela grafia do catalogo e registra cidade nova. Cobre formulario e chatbot de uma vez.';

drop trigger if exists lectures_normalize_city on public.lectures;

create trigger lectures_normalize_city
  before insert or update on public.lectures
  for each row
  execute function public.lectures_normalize_city();

-- ----------------------------------------------------------------------------
-- 5. Backfill do que já está cadastrado
-- ----------------------------------------------------------------------------
-- ⚠️ A ORDEM DECIDE A GRAFIA QUE VENCE, então ela não pode ser arbitrária. A
-- palestra MAIS ANTIGA de cada cidade define a forma canônica: foi a primeira
-- vez que alguém escreveu aquele nome, e é a que tem mais chance de ter sido
-- digitada com cuidado (as seguintes costumam ser cópia apressada).
--
-- `on conflict do nothing` porque duas grafias da mesma cidade colidem na chave
-- — que é exatamente o ponto: a segunda não entra, e o UPDATE abaixo faz as
-- palestras dela apontarem para a primeira.
insert into public.lecture_cities (name)
select distinct on (public.speaker_name_key(l.city)) btrim(l.city)
from public.lectures l
where btrim(coalesce(l.city, '')) <> ''
order by public.speaker_name_key(l.city), l.created_at, l.id
on conflict (name_key) do nothing;

-- E as palestras existentes passam a usar a grafia do catálogo.
--
-- ⚠️ ISTO DISPARA O GATILHO DA SEÇÃO 4, que é inofensivo aqui: ele resolve para
-- a mesma linha que este UPDATE está gravando. O `where` evita reescrever quem
-- já está certo — sem ele, seria um UPDATE em toda a tabela para mudar nada.
update public.lectures l
set city = c.name
from public.lecture_cities c
where c.name_key = public.speaker_name_key(l.city)
  and l.city is distinct from c.name;

-- ----------------------------------------------------------------------------
-- 6. RLS e grants
-- ----------------------------------------------------------------------------
-- Espelha PERMISSION_MATRIX, como `lecture_speakers`:
--   lectures.read  → admin, ceo, comercial
--   lectures.write → admin, ceo
--
-- ⚠️ SEM POLICY DE INSERT, e é a diferença que importa em relação a
-- `lecture_speakers`. Lá o formulário insere direto, chamando
-- `resolve_lecture_speaker` como INVOKER. Aqui a ÚNICA porta de escrita é o
-- gatilho, que roda como DEFINER — logo, uma policy de insert só abriria um
-- segundo caminho, por onde alguém criaria cidade sem palestra nenhuma.
alter table public.lecture_cities enable row level security;

drop policy if exists "lecture_cities_select" on public.lecture_cities;
create policy "lecture_cities_select"
  on public.lecture_cities for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));

-- A policy de UPDATE existe para UMA coisa só — tirar da lista uma digitação
-- errada —, e quem garante esse recorte é o grant de coluna abaixo, não a
-- policy. RENOMEAR não é operação deste módulo: a cidade está congelada em
-- palestras já comunicadas, e corrigir grafia em massa é decisão consciente, por
-- migration.
drop policy if exists "lecture_cities_update" on public.lecture_cities;
create policy "lecture_cities_update"
  on public.lecture_cities for update
  using (public.current_app_role() in ('admin', 'ceo'))
  with check (public.current_app_role() in ('admin', 'ceo'));

-- Sem policy de DELETE: uma cidade apagada some do catálogo e as palestras dela
-- ficam apontando para um nome que a lista não conhece mais. `active = false` é
-- o caminho.

revoke all on public.lecture_cities from authenticated, anon;
grant select on public.lecture_cities to authenticated;
grant update (active) on public.lecture_cities to authenticated;

-- ============================================================================
-- A CONFERÊNCIA
-- ----------------------------------------------------------------------------
-- ⚠️ NÃO PERGUNTA "A TABELA EXISTE?" — EXERCITA O CAMINHO E DESFAZ.
--
-- O que pode dar errado aqui não é a criação da tabela; é o gatilho não
-- padronizar a grafia, ou o catálogo não receber a cidade nova. Os dois só
-- aparecem numa escrita de verdade. A subtransação com `errcode = 'ZZ999'`
-- desfaz tudo — mesma técnica de 20260906000000 e 20260910000100.
-- ============================================================================
do $checagem$
declare
  v_id uuid;
  v_gravado text;
  v_no_catalogo integer;
  v_estado text;
  v_mensagem text;
begin
  select l.id into v_id from public.lectures l order by l.created_at, l.id limit 1;

  if v_id is null then
    raise notice 'Nenhuma palestra cadastrada — o gatilho nao pode ser exercitado agora.';
    return;
  end if;

  begin
    -- Uma cidade que ninguém digitaria, em grafia torta de propósito.
    update public.lectures set city = '  zzz cidade de teste da migration  '
    where id = v_id;

    select l.city into v_gravado from public.lectures l where l.id = v_id;

    if v_gravado <> 'zzz cidade de teste da migration' then
      raise exception
        'O gatilho nao normalizou a cidade: gravou "%" em vez da grafia do catalogo.', v_gravado;
    end if;

    select count(*) into v_no_catalogo
    from public.lecture_cities c
    where c.name_key = public.speaker_name_key('ZZZ Cidade de Teste da Migration');

    if v_no_catalogo <> 1 then
      raise exception
        'A cidade nova nao entrou no catalogo (encontradas % linhas). O dropdown ficaria sem ela.',
        v_no_catalogo;
    end if;

    raise exception 'desfaz' using errcode = 'ZZ999';
  exception
    when sqlstate 'ZZ999' then
      null; -- o esperado: exercitou e desfez
    when others then
      get stacked diagnostics v_estado = returned_sqlstate, v_mensagem = message_text;
      raise exception 'Catalogo de cidades nao funcionou. SQLSTATE % — %', v_estado, v_mensagem;
  end;

  raise notice 'Catalogo de cidades: gatilho exercitado e desfeito. % cidades no catalogo.',
    (select count(*) from public.lecture_cities);
end;
$checagem$;

-- ============================================================================
-- ROLLBACK (manual)
-- ----------------------------------------------------------------------------
--   drop trigger if exists lectures_normalize_city on public.lectures;
--   drop function if exists public.lectures_normalize_city();
--   drop function if exists public.resolve_lecture_city(text);
--   drop table if exists public.lecture_cities;
--
-- ⚠️ O QUE O ROLLBACK NÃO DESFAZ: a padronização de grafia aplicada às palestras
-- existentes na seção 5. Ela é uma correção de dado, não um efeito colateral —
-- reverter exigiria saber qual era a grafia torta de cada linha, que ninguém
-- guardou porque ninguém a queria de volta.
-- ============================================================================
