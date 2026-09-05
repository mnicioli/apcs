-- ============================================================================
-- FLUXOS — CORREÇÃO: dois códigos de erro colidiam
-- ============================================================================
--
-- ⚠️ ESTA MIGRATION CONSERTA UM DEFEITO INTRODUZIDO EM 20260920000100, e o
-- parágrafo abaixo existe para que a colisão não se repita.
--
-- A classe `FL` é a dos Fluxos, e ela já tinha SETE códigos em uso quando
-- 20260920000100 foi escrita:
--
--   FL001  versão congelada          FL005  desenho inválido
--   FL002  transição não permitida   FL006  precisa de versão publicada
--   FL003  já publicada              FL007  fluxo com histórico
--   FL004  precisa de aprovação
--
-- As duas funções novas reaproveitaram FL005 e FL006 sem conferir. O sintoma
-- não seria um erro: seria a MENSAGEM ERRADA na tela. Quem tentasse reprovar
-- sem escrever o motivo leria "Este fluxo precisa de uma versão publicada", e
-- ficaria procurando um problema que não existe.
--
-- ⚠️ POR QUE UM ARQUIVO NOVO, E NÃO EDITAR AQUELE. 20260920000100 JÁ FOI
-- APLICADA. O Supabase acompanha as migrations pelo nome: editar o arquivo não
-- o executa de novo, e o banco continuaria com os códigos errados enquanto o
-- repositório mostraria os certos — que é a pior combinação possível.
--
-- O mapa TypeScript está em `src/lib/actions/errors.ts`, e ele é a razão de os
-- códigos serem estáveis: cada um vira uma frase escrita para quem usa o
-- sistema.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. §21 — o checklist. FL005 → FL008
-- ----------------------------------------------------------------------------
create or replace function public.set_flow_version_checklist(
  p_version_id uuid,
  p_checklist jsonb
)
returns public.flow_versions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_version public.flow_versions;
begin
  if not public.flow_is_writer() then
    raise exception 'Sem permissao para alterar fluxos.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_checklist) is distinct from 'object' then
    raise exception 'O checklist precisa ser um objeto.' using errcode = '22023';
  end if;

  -- ⚠️ VERSÃO PUBLICADA NÃO RECEBE CHECKLIST NOVO. Ela já foi ao ar; marcar um
  -- item depois disso reescreveria a história da homologação que autorizou a
  -- publicação — que é justamente o registro que o §21 existe para produzir.
  select * into v_version from public.flow_versions v where v.id = p_version_id;
  if v_version.id is null then
    raise exception 'Versao nao encontrada.' using errcode = 'P0002';
  end if;

  if v_version.status in ('published', 'superseded') then
    raise exception 'Uma versao ja publicada nao aceita mudanca no checklist.'
      using errcode = 'FL008';
  end if;

  update public.flow_versions v
  set checklist = p_checklist,
      updated_by = (select auth.uid()),
      updated_at = now()
  where v.id = p_version_id
  returning * into v_version;

  perform public.log_admin_action(
    'flow_version_checked',
    (select f.name from public.flows f where f.id = v_version.flow_id),
    jsonb_build_object(
      'flowId', v_version.flow_id,
      'versionId', v_version.id,
      'version', v_version.version,
      -- ⚠️ QUANTOS, E NÃO QUAIS. A trilha guarda o progresso; o conteúdo do
      -- checklist está na própria versão. Copiá-lo aqui criaria uma segunda
      -- cópia que envelhece.
      'marcados', (
        select count(*) from jsonb_each(p_checklist) e
        where (e.value ->> 'checked')::boolean is true
      )
    )
  );

  return v_version;
end;
$fn$;


-- ----------------------------------------------------------------------------
-- 2. §22 — a reprovação com motivo. FL006 → FL009
-- ----------------------------------------------------------------------------
create or replace function public.advance_flow_version(
  p_version_id uuid,
  p_to public.flow_version_status,
  p_reason text default null
)
returns public.flow_versions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before public.flow_versions;
  v_after public.flow_versions;
  v_action public.admin_audit_action;
  v_reprovacao boolean;
  v_reason text;
begin
  if not public.flow_is_writer() then
    raise exception 'Sem permissao para alterar fluxos.' using errcode = '42501';
  end if;

  select * into v_before from public.flow_versions v where v.id = p_version_id;
  if v_before.id is null then
    raise exception 'Versao nao encontrada.' using errcode = 'P0002';
  end if;

  if not (
    (v_before.status = 'draft' and p_to = 'testing')
    or (v_before.status = 'testing' and p_to in ('draft', 'pending_approval'))
    or (v_before.status = 'pending_approval' and p_to in ('draft', 'approved'))
    or (v_before.status = 'approved' and p_to = 'draft')
  ) then
    raise exception 'Esta mudanca de situacao nao e permitida para a versao.'
      using errcode = 'FL002';
  end if;

  -- §22. REPROVAR é sair de "aguardando aprovação" de volta para rascunho. Sair
  -- de `testing` ou de `approved` para rascunho é outra coisa — é quem desenhou
  -- decidindo mexer —, e não pede motivo de ninguém.
  v_reprovacao := (v_before.status = 'pending_approval' and p_to = 'draft');
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  if v_reprovacao and v_reason is null then
    -- ⚠️ RECUSAR A REPROVAÇÃO SEM MOTIVO é o ponto inteiro do §22. Sem isto, a
    -- pessoa que desenhou recebe a versão de volta sabendo apenas que alguém
    -- não gostou — e a próxima tentativa é adivinhação.
    raise exception 'Diga o motivo da reprovacao.' using errcode = 'FL009';
  end if;

  update public.flow_versions v
  set status = p_to,
      -- O motivo fica na versão REPROVADA, que é onde quem for corrigi-la vai
      -- procurar. Qualquer outro avanço o limpa: um motivo antigo pendurado
      -- numa versão já corrigida é pior que nenhum.
      review_notes = case when v_reprovacao then v_reason else null end,
      reviewed_by = case when v_reprovacao or p_to = 'approved' then (select auth.uid()) else null end,
      reviewed_at = case when v_reprovacao or p_to = 'approved' then now() else null end,
      updated_by = (select auth.uid()),
      updated_at = now()
  where v.id = p_version_id
  returning * into v_after;

  v_action := case
    when v_reprovacao then 'flow_version_rejected'
    when p_to = 'testing' then 'flow_version_tested'
    when p_to = 'pending_approval' then 'flow_version_submitted'
    when p_to = 'approved' then 'flow_version_approved'
    else 'flow_version_updated'
  end;

  perform public.log_admin_action(
    v_action,
    (select f.name from public.flows f where f.id = v_after.flow_id),
    jsonb_build_object(
      'flowId', v_after.flow_id,
      'versionId', v_after.id,
      'version', v_after.version,
      'de', v_before.status,
      'para', p_to,
      -- ⚠️ O MOTIVO ENTRA NA TRILHA, e não só na coluna. A coluna é limpa no
      -- avanço seguinte (ver acima); a trilha é o que responde "por que a v4
      -- foi reprovada em setembro" depois de a v4 ter sido corrigida e
      -- publicada.
      'motivo', v_reason
    )
  );

  return v_after;
end;
$fn$;


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- Desfazer é reaplicar os corpos de 20260920000100 — o que devolveria a
-- colisão de códigos. Não há motivo para fazê-lo.
-- ============================================================================
