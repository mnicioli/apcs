-- ============================================================================
-- Palestras — dois ajustes encontrados no QA (PROMPT 3/3)
-- ----------------------------------------------------------------------------
-- Migration NOVA em vez de emenda na 20260816000000: aquela já está aplicada na
-- produção e registrada em `supabase_migrations`. Reescrevê-la faria um banco
-- recriado do zero divergir do que está no ar — a divergência silenciosa que
-- migration existe para evitar.
--
-- 1. `set_lecture_status` pergunta ao grafo ANTES de cobrar horário.
-- 2. Solicitação do chatbot ganha chave de idempotência (§59, §60).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A mensagem certa para a transição impossível
-- ----------------------------------------------------------------------------
-- ACHADO DO QA: rejeitada → confirmada devolvia
--
--   "Informe o horário de início antes de confirmar a palestra."  (PL005)
--
-- A operação era recusada — a segurança nunca esteve em risco, o trigger barra
-- de qualquer jeito. O problema é que a frase MANDA FAZER UMA COISA QUE NÃO
-- RESOLVE: quem preencher o horário vai tentar de novo e ser recusado outra vez,
-- agora sem pista nenhuma. Uma palestra rejeitada não vira confirmada por falta
-- de horário; ela não vira confirmada, ponto.
--
-- A causa é ordem de checagem: as pré-condições (motivo, horário) rodavam antes
-- de alguém perguntar se aquele caminho existe. A correção é perguntar primeiro.
--
-- ⚠️ Isto DUPLICA a consulta que o trigger `lectures_guard` já faz, e a
-- duplicação é intencional: o trigger é a garantia (vale para qualquer caminho
-- de escrita), esta consulta é a MENSAGEM. Se a função sumir amanhã, o grafo
-- continua imposto; o que se perde é o texto bom.
create or replace function public.set_lecture_status(
  p_lecture_id uuid,
  p_status public.lecture_status,
  p_reason text default null
)
returns public.lectures
language plpgsql
set search_path = ''
as $$
declare
  v_old public.lectures;
  v_new public.lectures;
  v_reason text := nullif(btrim(p_reason), '');
  v_action public.lecture_audit_action;
begin
  perform public.lock_lecture(p_lecture_id);

  select * into v_old from public.lectures where id = p_lecture_id;
  if not found then
    raise exception 'Palestra não encontrada.' using errcode = 'P0002';
  end if;

  if v_old.status = p_status then
    -- Idempotente: pedir de novo o que já vale não é erro e não vira trilha.
    return v_old;
  end if;

  -- ⚠️ PRIMEIRO O CAMINHO EXISTE?, e só depois as pré-condições dele. Invertido,
  -- a pessoa recebe uma instrução que não leva a lugar nenhum.
  if not exists (
    select 1 from public.lecture_status_transitions
    where from_status = v_old.status and to_status = p_status
  ) then
    raise exception 'Não é possível mudar a situação de "%" para "%".', v_old.status, p_status
      using errcode = 'PL001';
  end if;

  -- §24/§25. Antes do update, para a mensagem falar de motivo e não de CHECK.
  if p_status = 'rejected' and v_reason is null then
    raise exception 'Informe o motivo da rejeição.' using errcode = 'PL004';
  end if;
  if p_status = 'cancelled' and v_reason is null then
    raise exception 'Informe o motivo do cancelamento.' using errcode = 'PL004';
  end if;

  -- §13. Confirmar (e realizar) exige horário.
  if p_status in ('confirmed', 'held') and v_old.start_time is null then
    raise exception 'Informe o horário de início antes de confirmar a palestra.'
      using errcode = 'PL005';
  end if;

  update public.lectures
  set status = p_status,
      rejection_reason = case when p_status = 'rejected' then v_reason end,
      cancellation_reason = case when p_status = 'cancelled' then v_reason end,
      -- §26/§56. Realizar é um ATO — e o ato acontece na data da palestra. Os
      -- números da realização entram depois, por `register_lecture_outcome`.
      held_at = case when p_status = 'held' then v_old.event_date end,
      updated_by = auth.uid()
  where id = p_lecture_id
  returning * into v_new;

  -- §36. Cancelar e rejeitar têm ação própria; o resto é mudança de situação.
  v_action := case p_status
    when 'cancelled' then 'lecture_cancelled'
    when 'rejected' then 'lecture_rejected'
    else 'lecture_status_changed'
  end;

  insert into public.lecture_audit_logs (lecture_id, action, metadata)
  values (
    p_lecture_id,
    v_action,
    jsonb_build_object(
      'actor_name', public.current_actor_name(),
      'from', v_old.status,
      'to', v_new.status,
      'reason', v_reason
    )
  );

  return v_new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Idempotência da solicitação do chatbot (§59, §60)
-- ----------------------------------------------------------------------------
-- ACHADO DO QA: não havia nada impedindo que um RETRY TÉCNICO virasse duas
-- solicitações. Uma conexão que cai depois do insert e antes da resposta faz o
-- cliente tentar de novo; sem chave, a segunda tentativa gera outra linha, outro
-- protocolo, outra linha de trilha — e a pessoa recebe dois números para o mesmo
-- pedido.
--
-- ⚠️ A CHAVE VEM DE FORA E É OPACA. O §60 é explícito em NÃO deduplicar por
-- nome/data, e a razão é boa: uma cooperativa que pede duas palestras iguais em
-- dias diferentes, ou duas pessoas da mesma empresa pedindo o mesmo tema, são
-- pedidos LEGÍTIMOS. Deduplicar por conteúdo transformaria "o sistema me
-- protegeu de um retry" em "o sistema comeu meu pedido".
--
-- Nula por padrão: quem não passa chave continua criando normalmente. A
-- idempotência é uma garantia que o CHAMADOR pede, não uma que o banco impõe.
alter table public.lectures
  add column idempotency_key text;

comment on column public.lectures.idempotency_key is
  'Chave opaca de idempotência do chatbot (§60). Nula em cadastro interno. Nunca derivada do conteúdo do pedido.';

-- Comprimento mínimo para uma chave não ser algo como "1" — que colidiria entre
-- conversas diferentes e faria o pedido de uma pessoa devolver o protocolo de
-- outra.
alter table public.lectures
  add constraint lectures_idempotency_key_len
  check (idempotency_key is null or char_length(idempotency_key) between 8 and 128);

-- Parcial: só as linhas COM chave disputam unicidade. Sem o `where`, todas as
-- palestras internas (chave nula) seriam consideradas... nada — nulos não
-- colidem em índice único. O `where` deixa isso explícito e mantém o índice do
-- tamanho do que ele realmente indexa.
create unique index lectures_idempotency_key_idx
  on public.lectures (idempotency_key)
  where idempotency_key is not null;

-- A coluna NÃO entra em nenhum grant: só a função abaixo escreve nela, e ela é
-- SECURITY DEFINER. Nem o admin altera a chave de idempotência de um pedido.

create or replace function public.create_lecture_request(
  p_requester_name text,
  p_city text,
  p_type public.lecture_type,
  p_type_other text,
  p_theme text,
  p_event_date date,
  p_start_time time,
  p_location text,
  p_format public.lecture_format,
  p_attendees_estimated integer,
  p_notes text,
  p_requester_contact_id uuid,
  p_requester_email text,
  p_requester_phone text,
  p_requester_organization text,
  p_name text default null,
  -- §60. Último parâmetro e com default: as chamadas existentes continuam
  -- válidas sem mudança.
  p_idempotency_key text default null
)
returns public.lectures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lecture public.lectures;
  v_key text := nullif(btrim(p_idempotency_key), '');
begin
  -- Caminho feliz do retry: a chave já existe, devolve o MESMO pedido. Sem
  -- protocolo novo, sem linha de trilha nova — do ponto de vista de quem chamou,
  -- a primeira tentativa simplesmente funcionou.
  if v_key is not null then
    select * into v_lecture from public.lectures where idempotency_key = v_key;
    if found then
      return v_lecture;
    end if;
  end if;

  begin
    insert into public.lectures (
      origin, status,
      name, theme, city, location, type, type_other, format,
      event_date, start_time,
      attendees_estimated, notes,
      requester_contact_id, requester_name, requester_email, requester_phone,
      requester_organization, idempotency_key
    )
    values (
      'chatbot', 'requested',
      coalesce(nullif(btrim(p_name), ''), btrim(p_requester_name)),
      btrim(p_theme),
      btrim(p_city),
      nullif(btrim(p_location), ''),
      p_type,
      case when p_type = 'other' then nullif(btrim(p_type_other), '') end,
      p_format,
      p_event_date,
      p_start_time,
      p_attendees_estimated,
      nullif(btrim(p_notes), ''),
      p_requester_contact_id,
      btrim(p_requester_name),
      nullif(btrim(p_requester_email), ''),
      nullif(btrim(p_requester_phone), ''),
      nullif(btrim(p_requester_organization), ''),
      v_key
    )
    returning * into v_lecture;
  exception when unique_violation then
    -- Duas tentativas AO MESMO TEMPO com a mesma chave: uma insere, a outra cai
    -- aqui. O select acima não podia ver a linha da concorrente (ela ainda não
    -- tinha commitado); agora pode. Sem este bloco, o retry simultâneo — que é
    -- exatamente o caso que a chave existe para cobrir — devolveria erro.
    select * into v_lecture from public.lectures where idempotency_key = v_key;
    if not found then
      -- Não foi a chave que colidiu; foi outra coisa (protocolo, por exemplo).
      raise;
    end if;
    return v_lecture;
  end;

  -- §57. Não existe central de notificações neste projeto. O que existe é ISTO:
  -- uma linha de trilha, imediata e transacional, que o contador da caixa de
  -- entrada lê.
  insert into public.lecture_audit_logs (lecture_id, action, actor_id, metadata)
  values (
    v_lecture.id,
    'lecture_created',
    null,
    jsonb_build_object(
      'origin', 'chatbot',
      'protocol', v_lecture.protocol,
      'status', v_lecture.status,
      'theme', v_lecture.theme,
      'city', v_lecture.city,
      'eventDate', v_lecture.event_date,
      'requesterName', v_lecture.requester_name
    )
  );

  return v_lecture;
end;
$$;

comment on function public.create_lecture_request(
  text, text, public.lecture_type, text, text, date, time, text,
  public.lecture_format, integer, text, uuid, text, text, text, text, text
) is
  'A ÚNICA porta de entrada do chatbot. Sem parâmetro de status, prioridade, responsável ou palestrante — o §6 vira impossibilidade, não checagem. Aceita chave de idempotência (§60).';

-- A assinatura mudou (um parâmetro a mais), então os grants são de uma FUNÇÃO
-- NOVA aos olhos do Postgres. A antiga continua existindo com os grants dela —
-- e é por isso que ela é removida logo abaixo, senão sobraria uma porta sem
-- idempotência aberta para o `service_role`.
revoke execute on function public.create_lecture_request(
  text, text, public.lecture_type, text, text, date, time, text,
  public.lecture_format, integer, text, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_lecture_request(
  text, text, public.lecture_type, text, text, date, time, text,
  public.lecture_format, integer, text, uuid, text, text, text, text, text
) to service_role;

drop function if exists public.create_lecture_request(
  text, text, public.lecture_type, text, text, date, time, text,
  public.lecture_format, integer, text, uuid, text, text, text, text
);
