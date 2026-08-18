-- ============================================================================
-- ENQUETES — PROMPT 3/3 · devolver à fila
-- ============================================================================
--
-- Duas funções que faltavam para o worker se comportar bem quando o problema
-- NÃO é da pessoa. Elas existem porque `mark_survey_recipient` recusa
-- rebaixamento de propósito (a progressão é monotônica, §26), e devolver alguém
-- de 'sending' para 'pending' é exatamente um rebaixamento — legítimo, mas
-- precisa ser explícito para não abrir brecha para o webhook fazer o mesmo.
-- ============================================================================

-- §21/§28. O DISJUNTOR ABRIU: o fornecedor caiu no meio da corrida.
--
-- ⚠️ ESTAS PESSOAS NÃO PODEM VIRAR 'error'.
--
-- Marcar erro aqui seria dizer "falhou o envio para o João" quando o que houve
-- foi "o WhatsApp estava fora do ar". A diferença aparece na tela: o operador
-- veria 400 falhas individuais e sairia conferindo telefone por telefone, em vez
-- de esperar cinco minutos. Elas voltam para a fila e o próximo ciclo tenta de
-- novo — sem gastar tentativa, porque tentativa se conta no resultado do envio.
create or replace function public.release_survey_recipients(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  update public.survey_recipients
  set status = 'pending'
  where id = any(p_ids)
    -- Só o que ESTE worker reivindicou. Sem esta condição, um id vindo de outro
    -- lugar poderia "devolver" para a fila alguém que já recebeu a mensagem —
    -- e a pessoa receberia duas vezes.
    and status = 'sending';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.release_survey_recipients(uuid[]) is
  '§21/§28. Devolve à fila quem foi reivindicado mas não chegou a ser enviado (fornecedor fora do ar). Não conta tentativa e não marca erro.';

revoke execute on function public.release_survey_recipients(uuid[])
  from public, anon, authenticated;
grant execute on function public.release_survey_recipients(uuid[]) to service_role;

-- §19/§86. "Tentar de novo quem falhou", para quando a causa já foi resolvida
-- (o número foi corrigido, o fornecedor voltou, o template foi aprovado).
--
-- ⚠️ TEM TETO. Sem `p_max_attempts`, um botão de "tentar de novo" numa campanha
-- com trezentos números inválidos vira trezentas chamadas ao fornecedor toda
-- vez que alguém clica — e a conta de WhatsApp é cobrada por conversa iniciada.
create or replace function public.retry_failed_survey_recipients(
  p_survey_id uuid,
  p_max_attempts integer default 5
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- A barreira de papel: quem pode escrever a enquete pode remandar. É a mesma
  -- checagem que `lock_survey` faz, sem tomar o lock (não há escrita na enquete).
  if not public.survey_is_writer() then
    raise exception 'Sem permissão para reenviar esta enquete.' using errcode = '42501';
  end if;

  -- §32. Quem pediu para sair NÃO volta para a fila, por mais que alguém clique.
  update public.survey_recipients r
  set status = 'pending',
      last_error = null
  where r.survey_id = p_survey_id
    and r.status = 'error'
    and r.attempts < p_max_attempts
    and not exists (
      select 1 from public.survey_opt_outs o where o.contact_id = r.contact_id
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.retry_failed_survey_recipients(uuid, integer) is
  '§19. Devolve à fila quem falhou, respeitando teto de tentativas e opt-out. Nunca ressuscita quem pediu para sair.';

revoke execute on function public.retry_failed_survey_recipients(uuid, integer) from public, anon;

-- A varredura do `anon` de novo — as funções acima nasceram depois do bloco
-- anterior, e o `alter default privileges` do Supabase concede EXECUTE a `anon`
-- em toda função nova de `public`. Ver o comentário longo na migration
-- 20260820000100.
do $revoke_anon$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('release_survey_recipients', 'retry_failed_survey_recipients')
  loop
    execute pg_catalog.format('revoke execute on function %s from anon', f.assinatura);
  end loop;
end $revoke_anon$;
