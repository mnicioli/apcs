-- ============================================================================
-- DIVULGAÇÃO COM DUAS MENSAGENS: a imagem antes, o documento depois
-- ============================================================================
--
-- O QUE MUDA: a Bolsa passa a mandar DOIS envios para cada associado — a imagem
-- do boletim primeiro, SEM TEXTO, e o PDF logo em seguida, com a mensagem.
--
-- ⚠️ POR QUE A ORDEM É ESSA, e por que ela é conteúdo e não capricho. No
-- WhatsApp a imagem chega ABERTA na conversa: é ela que faz alguém parar de
-- rolar e ver que a APCS publicou o boletim da semana. O PDF chega FECHADO, um
-- cartão de arquivo com nome e tamanho — ele é o que a pessoa guarda, imprime e
-- reencontra na busca, mas não é o que chama atenção. Invertendo a ordem, o
-- aviso vira um anexo que ninguém abriu.
--
-- E a imagem vai sem legenda de propósito: com texto nas duas, o associado
-- receberia a mesma mensagem duas vezes seguidas.
--
-- ⚠️ O QUE NÃO MUDA: normativa e comunicação continuam com um envio só (o PDF
-- com o texto), e palestra continua sem arquivo nenhum. As colunas novas ficam
-- nulas para elas, e o worker simplesmente não tem imagem para mandar. Só a
-- Bolsa tem os dois arquivos — ela é o único módulo que guarda imagem E PDF na
-- mesma versão.
--
-- DEPENDE DE: 20260901000100_broadcasts.sql, 20260906000000_fix_start_broadcast_ambiguity.sql

-- ----------------------------------------------------------------------------
-- 1. A imagem na campanha
-- ----------------------------------------------------------------------------
-- Guarda CAMINHO, nunca URL — pelo mesmo motivo das colunas `media_*`: uma URL
-- assinada expira, e guardá-la seria guardar uma credencial vencida. Quem
-- assina é o worker, a cada corrida.
alter table public.broadcasts
  add column if not exists image_bucket text,
  add column if not exists image_path text,
  add column if not exists image_mime text,
  add column if not exists image_filename text;

comment on column public.broadcasts.image_path is
  'Imagem enviada ANTES do documento e SEM legenda. Hoje só a Bolsa preenche.';

comment on column public.broadcasts.media_path is
  'O documento (PDF) que leva a mensagem. Sai DEPOIS da imagem, quando ha imagem.';

do $bloco$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'broadcasts_image_complete'
  ) then
    -- Mesma regra de `broadcasts_media_complete`: anexo é tudo-ou-nada, porque
    -- um caminho sem bucket é um arquivo que ninguém acha.
    alter table public.broadcasts
      add constraint broadcasts_image_complete
      check (
        (image_bucket is null and image_path is null)
        or (image_bucket is not null and image_path is not null)
      );
  end if;
end;
$bloco$;

-- ----------------------------------------------------------------------------
-- 2. `start_broadcast` passa a receber a imagem
-- ----------------------------------------------------------------------------
-- ⚠️ DROP ANTES DO CREATE porque a assinatura MUDA (quatro parâmetros a mais).
-- Um `create or replace` deixaria as duas versões vivas, e uma chamada por nome
-- de argumento — que é como o PostgREST chama — ficaria ambígua: erro 42725 em
-- produção, num caminho que passou por type-check, testes e build.
drop function if exists public.start_broadcast(
  public.broadcast_source, uuid, text, text, uuid[], text, text, text, text
);

create function public.start_broadcast(
  p_source public.broadcast_source,
  p_source_id uuid,
  p_title text,
  p_body text,
  p_segment_ids uuid[],
  p_media_bucket text default null,
  p_media_path text default null,
  p_media_mime text default null,
  p_media_filename text default null,
  p_image_bucket text default null,
  p_image_path text default null,
  p_image_mime text default null,
  p_image_filename text default null
)
returns table (broadcast_id uuid, queued integer, blocked integer)
language plpgsql
security definer
set search_path = ''
as $fn$
-- ⚠️ `RETURNS TABLE` cria variáveis com os nomes das colunas de saída, e uma
-- delas se chama `broadcast_id` — que também é coluna de `broadcast_recipients`.
-- Sem esta linha, o `on conflict (broadcast_id, ...)` lá embaixo levanta 42702 e
-- NENHUMA divulgação sai. Ver 20260906000000_fix_start_broadcast_ambiguity.sql,
-- que existe só por causa disso.
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
    image_bucket, image_path, image_mime, image_filename,
    created_by_name
  )
  values (
    p_source, p_source_id, p_title, btrim(p_body),
    p_media_bucket, p_media_path, p_media_mime, p_media_filename,
    p_image_bucket, p_image_path, p_image_mime, p_image_filename,
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

comment on function public.start_broadcast(public.broadcast_source, uuid, text, text, uuid[], text, text, text, text, text, text, text, text) is
  'Abre uma divulgacao e monta a fila a partir dos publicos-alvo escolhidos. Filtra quem pediu para nao receber.';

revoke execute on function public.start_broadcast(
  public.broadcast_source, uuid, text, text, uuid[], text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.start_broadcast(
  public.broadcast_source, uuid, text, text, uuid[], text, text, text, text, text, text, text, text
) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. As duas conferências
-- ----------------------------------------------------------------------------
-- ⚠️ A PRIMEIRA: sobrou alguma versão antiga da função? O `drop` acima depende
-- de a assinatura bater EXATAMENTE. Se não bater, ele não acha nada, o `create`
-- cria uma SEGUNDA versão e a migration termina "com sucesso" — o erro só
-- aparece depois, em produção, quando o PostgREST chamar por nome de argumento
-- e o Postgres não souber qual escolher.
do $checagem$
declare
  v_qtd integer;
begin
  select count(*) into v_qtd
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'start_broadcast';

  if v_qtd <> 1 then
    raise exception
      'start_broadcast ficou com % versoes. Uma chamada por nome de argumento seria ambigua.', v_qtd;
  end if;
end;
$checagem$;

-- ⚠️ A SEGUNDA: a função EXECUTA? `create function` não prova nada — o PL/pgSQL
-- analisa cada comando na primeira vez que ELE roda, não a função na criação.
-- Foi assim que um 42702 atravessou type-check, lint, testes, build e deploy, e
-- só apareceu para quem clicou em "Divulgar".
--
-- Então aqui a chamada é COMPLETA, com um público real, dentro de uma
-- subtransação que este bloco mesmo desfaz: o `begin ... exception` do PL/pgSQL
-- abre uma subtransação, e a exceção levantada dentro dela reverte tudo que foi
-- gravado. Nada sobra em `broadcasts` nem em `broadcast_recipients`, e nenhuma
-- mensagem sai — quem envia é o worker, que não passa por aqui.
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
      'market_bulletin'::public.broadcast_source,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'checagem da migration',
      'checagem da migration',
      array[v_segmento],
      'market', 'checagem/doc.pdf', 'application/pdf', 'doc.pdf',
      'market', 'checagem/img.jpg', 'image/jpeg', 'img.jpg'
    );

    -- Chegou aqui: o corpo inteiro foi analisado e executou. Só falta desfazer.
    raise exception 'desfazendo a checagem' using errcode = 'ZZ999';
  exception
    when sqlstate 'ZZ999' then
      raise notice 'start_broadcast executou do inicio ao fim, com imagem e documento. Checagem desfeita.';
    when sqlstate '42501' then
      -- Sem papel de aplicacao (rodando como `postgres`), a funcao recusa na
      -- primeira linha e os `insert` continuam sem ser analisados. A conferencia
      -- nao valeu — e dizer isso e melhor que fingir que valeu.
      raise notice 'start_broadcast NAO pode ser exercitada: sem papel de aplicacao nesta sessao.';
  end;
end;
$checagem$;

-- ============================================================================
-- ROLLBACK (manual, na ordem)
-- ----------------------------------------------------------------------------
--   drop function if exists public.start_broadcast(public.broadcast_source, uuid, text, text, uuid[], text, text, text, text, text, text, text, text);
--   -- e recriar a versão de 9 parâmetros a partir de
--   -- 20260906000000_fix_start_broadcast_ambiguity.sql
--   alter table public.broadcasts drop constraint if exists broadcasts_image_complete;
--   alter table public.broadcasts drop column if exists image_filename, drop column if exists image_mime,
--     drop column if exists image_path, drop column if exists image_bucket;
