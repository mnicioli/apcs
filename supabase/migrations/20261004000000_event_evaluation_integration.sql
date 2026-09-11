-- ============================================================================
-- INTEGRAÇÃO DA JORNADA (Prompt 4 de 5)
-- ============================================================================
-- Este arquivo NÃO acrescenta funcionalidade. Ele corrige três costuras entre os
-- prompts 1, 2 e 3 que só aparecem quando a jornada é percorrida inteira:
--
--   1. o portão de presença não existia no CLAIM (§33);
--   2. o portão de presença existia DEMAIS na porta pública (§34);
--   3. o agendador pulava em silêncio o evento sem presentes (§5, §14).
--
-- Nenhuma tabela, nenhuma coluna, nenhum enum. Quatro funções recriadas.
--
-- ----------------------------------------------------------------------------
-- ⚠️ A CORREÇÃO 1 E A CORREÇÃO 2 SÃO A MESMA IDEIA, EM SENTIDOS OPOSTOS.
-- ----------------------------------------------------------------------------
-- O Prompt 2 espalhou a checagem de presença por quatro lugares — agendar, ler
-- em público, gravar a resposta — achando que "mais barreiras é mais seguro". O
-- Prompt 4 mostra que não: a presença responde UMA pergunta, e ela tem hora.
--
--     A PRESENÇA DECIDE SE O CONVITE SAI.
--     DEPOIS QUE SAIU, O CONVITE VALE.
--
-- Antes do envio (agendar, reivindicar) ela é o critério — §7 é explícito, e o
-- §33 pede que o job consulte o estado ATUAL no momento do processamento.
--
-- Depois do envio ela não é mais. O §34 é igualmente explícito: "não cancelar
-- automaticamente a avaliação enviada; não apagar; não apagar resposta". Uma
-- pessoa que recebeu o link, e cuja presença foi corrigida por engano na
-- segunda-feira, não pode descobrir isso batendo num "esta avaliação não está
-- disponível" — que foi exatamente o que o Prompt 2 construiu.
--
-- ⚠️ E ISSO NÃO AFROUXA NADA. Quem nunca esteve presente nunca teve linha
-- criada, logo nunca teve token, logo não alcança a página pública. O portão que
-- sai daqui protegia um caso que não existe; o que ele fazia de verdade era
-- invalidar convites legítimos.
--
-- ----------------------------------------------------------------------------
-- CÓDIGOS DE ERRO — nenhum novo. Ver 20261002000100 (classe `AV`).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. §33 — o portão de presença no momento do envio
-- ----------------------------------------------------------------------------
-- ⚠️ O CASO REAL QUE ISTO CORRIGE:
--
--   18:00  evento termina
--   18:30  o job cria a avaliação de quem estava presente
--   18:31  o envio falha (fornecedor fora do ar)
--   19:00  o administrador percebe que marcou a pessoa errada e desmarca
--   19:10  a próxima passada reivindica a linha e MANDA A MENSAGEM
--
-- O agendamento conferia a presença; a reivindicação não. Entre os dois passa um
-- arrendamento de dez minutos e quantas passadas forem precisas — tempo de sobra
-- para a correção acontecer e ser ignorada.
--
-- ⚠️ O MESMO VALE PARA A AVALIAÇÃO DESABILITADA (§3). Desligar a avaliação de um
-- evento depois que a fila foi criada não impedia o que já estava na fila de
-- sair. "Se avaliação estiver desabilitada: NÃO criar envio automático" — e
-- também não CONTINUAR um.
--
-- ⚠️ E O `join` NÃO É CARO. Ele acontece sobre o lote já limitado pelo `limit`
-- ... na verdade não: ele entra no `where` da CTE `alvo`, antes do limite. Os
-- dois lados são indexados (`event_participants` pela PK, `settings` pela PK do
-- evento), e o filtro de fila já reduziu o conjunto a quem está vencido.
create or replace function public.claim_event_evaluations(p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  with alvo as (
    select pe.id
    from public.event_participant_evaluations pe
    -- §33. O estado ATUAL da presença, no momento do processamento.
    join public.event_participants p
      on p.id = pe.participant_id and p.event_id = pe.event_id
    -- §3. E a avaliação ainda tem de estar habilitada.
    join public.event_evaluation_settings s on s.event_id = pe.event_id
    where pe.status = 'scheduled'
      and pe.scheduled_for is not null
      and pe.scheduled_for <= now()
      and p.present
      and s.enabled
      -- §16. O teto de tentativas. Quem estourou sai da fila e espera um
      -- reenvio manual, que zera a contagem.
      and pe.attempts < 5
      and (pe.last_attempt_at is null or pe.last_attempt_at < now() - interval '10 minutes')
      and (pe.expires_at is null or pe.expires_at > now())
    order by pe.scheduled_for
    limit greatest(coalesce(p_limit, 25), 1)
    for update of pe skip locked
  ),
  atualizadas as (
    update public.event_participant_evaluations pe
    set attempts = pe.attempts + 1,
        last_attempt_at = now()
    from alvo
    where pe.id = alvo.id
    returning pe.id
  )
  select array_agg(id) into v_ids from atualizadas;

  if v_ids is null then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', pe.id,
          'token', pe.token,
          'eventId', pe.event_id,
          'eventName', e.name,
          'eventDate', e.event_date,
          'participantId', p.id,
          'fullName', p.full_name,
          'whatsapp', p.whatsapp,
          'phone', p.phone,
          'attempts', pe.attempts
        )
        order by pe.scheduled_for
      )
      from public.event_participant_evaluations pe
      join public.events e on e.id = pe.event_id
      join public.event_participants p on p.id = pe.participant_id
      where pe.id = any(v_ids)
    ),
    '[]'::jsonb
  );
end;
$$;

comment on function public.claim_event_evaluations is
  'Reivindica um lote com skip locked e arrendamento de 10 min (§15). Reconfere presenca e avaliacao habilitada (§3, §33).';

revoke execute on function public.claim_event_evaluations(integer)
  from public, anon, authenticated;
grant execute on function public.claim_event_evaluations(integer) to service_role;


-- ----------------------------------------------------------------------------
-- 2. §34 — a avaliação enviada sobrevive à correção de presença
-- ----------------------------------------------------------------------------
-- ⚠️ O QUE SAI DAQUI É UMA LINHA, E ELA ERA UM DEFEITO:
--
--     when not coalesce(v_participant.present, false) then 'cancelled'
--
-- Ela transformava uma correção administrativa numa revogação silenciosa de um
-- convite já entregue. O §34 proíbe: "não cancelar automaticamente a avaliação
-- enviada". O §18 repete com outras palavras.
--
-- ⚠️ O PARTICIPANTE CONTINUA SENDO LIDO, e continua sendo obrigatório existir —
-- é dele que sai o primeiro nome da saudação. O que deixou de existir é o
-- julgamento sobre a presença dele.
create or replace function public.get_public_event_evaluation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.event_participant_evaluations;
  v_event public.events;
  v_participant public.event_participants;
  v_estado text;
begin
  if coalesce(btrim(p_token), '') = '' then
    return jsonb_build_object('state', 'not_found');
  end if;

  select * into v_row
  from public.event_participant_evaluations pe
  where pe.token = btrim(p_token);

  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;

  select * into v_event from public.events e where e.id = v_row.event_id;
  select * into v_participant
  from public.event_participants p where p.id = v_row.participant_id;

  -- ⚠️ §20 — O EVENTO PODE ESTAR ENCERRADO. Nada aqui olha `events.status` nem a
  -- data: a avaliação vive até ser respondida, expirar ou ser cancelada.
  --
  -- ⚠️ O PRAZO É CONFERIDO AQUI E AGORA, e não pela situação gravada. A rotina
  -- de expiração pode não ter rodado ainda; `expires_at < now()` não depende de
  -- ninguém.
  v_estado := case
    when v_participant.id is null then 'not_found'
    when v_row.status = 'answered' then 'answered'
    when v_row.status = 'cancelled' then 'cancelled'
    when v_row.status = 'expired' then 'expired'
    when v_row.expires_at is not null and v_row.expires_at <= now() then 'expired'
    else 'ok'
  end;

  return jsonb_build_object(
    'state', v_estado,
    'eventName', v_event.name,
    'eventDate', v_event.event_date,
    'eventLocation', v_event.location,
    'firstName', split_part(btrim(coalesce(v_participant.full_name, '')), ' ', 1),
    'expiresAt', v_row.expires_at,
    'sections', case
      when v_estado = 'ok' then public.evaluation_version_structure(v_row.version_id)
      else '[]'::jsonb
    end
  );
end;
$$;

comment on function public.get_public_event_evaluation is
  'A avaliacao pelo token (§27). Nao julga presenca (§34) nem exige evento ativo (§20). Token desconhecido devolve not_found.';

revoke execute on function public.get_public_event_evaluation(text)
  from public, anon, authenticated;
grant execute on function public.get_public_event_evaluation(text) to service_role;


-- ----------------------------------------------------------------------------
-- 3. §34 — e a resposta também
-- ----------------------------------------------------------------------------
-- ⚠️ MESMA CORREÇÃO, NO LUGAR ONDE ELA DÓI MAIS. A leitura bloqueada mostrava
-- uma frase; a GRAVAÇÃO bloqueada descartava o que a pessoa acabou de digitar.
--
-- O que sai é a recusa por presença. O que FICA, e não muda:
--
--   • o `for update` que serializa dois envios simultâneos (§17);
--   • a recusa de avaliação já respondida (§17, AV004);
--   • a recusa de cancelada e de vencida (§20);
--   • a conferência de que a pergunta é desta versão (§24);
--   • a conferência das obrigatórias contra o que foi gravado (§16);
--   • o compare-and-set da situação (§17).
--
-- ⚠️ O PARTICIPANTE CONTINUA SENDO EXIGIDO. Sem a linha dele não há a quem
-- atribuir a resposta — e isso é integridade, não julgamento de presença.
create or replace function public.submit_event_evaluation(
  p_token text,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.event_participant_evaluations;
  v_participant public.event_participants;
  v_resposta jsonb;
  v_question record;
  v_option_id uuid;
  v_texto text;
  v_opcoes jsonb;
  v_faltando text;
  v_reivindicada uuid;
begin
  if coalesce(btrim(p_token), '') = '' then
    raise exception 'Avaliação não encontrada.' using errcode = 'P0002';
  end if;

  -- §17. Dois envios simultâneos chegam os dois; o primeiro tranca a linha e o
  -- segundo espera — e quando entra, encontra `answered`.
  select * into v_row
  from public.event_participant_evaluations pe
  where pe.token = btrim(p_token)
  for update;

  if not found then
    raise exception 'Avaliação não encontrada.' using errcode = 'P0002';
  end if;

  if v_row.status = 'answered' then
    raise exception 'Esta avaliação já foi respondida.' using errcode = 'AV004';
  end if;

  if v_row.status = 'cancelled' then
    raise exception 'Esta avaliação não está mais disponível.' using errcode = 'AV007';
  end if;

  if v_row.status = 'expired'
     or (v_row.expires_at is not null and v_row.expires_at <= now()) then
    raise exception 'Esta avaliação não está mais disponível.' using errcode = 'AV005';
  end if;

  -- ⚠️ SEM JULGAR A PRESENÇA (§34). A linha existe, logo o convite saiu, logo a
  -- resposta vale. O que se exige é o participante EXISTIR — é dele que a
  -- resposta é.
  select * into v_participant
  from public.event_participants p
  where p.id = v_row.participant_id and p.event_id = v_row.event_id;

  if not found then
    raise exception 'Esta avaliação não está mais disponível.' using errcode = 'AV007';
  end if;

  if jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception 'Respostas inválidas.' using errcode = 'AV003';
  end if;

  for v_resposta in select valor from jsonb_array_elements(p_answers) as t(valor)
  loop
    -- §24/§48. A pergunta tem de ser DESTA versão. Sem este `where`, um
    -- `questionId` trocado gravaria a resposta desta pessoa contra a pergunta de
    -- OUTRA avaliação.
    select q.id, q.question_type, q.required, q.prompt into v_question
    from public.event_evaluation_questions q
    join public.event_evaluation_sections s on s.id = q.section_id
    where s.version_id = v_row.version_id
      and q.id = (v_resposta ->> 'questionId')::uuid;

    if not found then
      raise exception 'Resposta enviada para uma pergunta que não é desta avaliação.'
        using errcode = 'AV003';
    end if;

    if v_question.question_type = 'free_text' then
      v_texto := nullif(btrim(coalesce(v_resposta ->> 'text', '')), '');
      if v_texto is null then
        continue;
      end if;

      insert into public.event_evaluation_answers
        (participant_evaluation_id, round, question_id, text_value)
      values (v_row.id, v_row.answer_round, v_question.id, left(v_texto, 4000));

    else
      v_opcoes := v_resposta -> 'optionIds';
      if jsonb_typeof(v_opcoes) is distinct from 'array' or jsonb_array_length(v_opcoes) = 0 then
        continue;
      end if;

      if v_question.question_type <> 'multiple_choice' and jsonb_array_length(v_opcoes) > 1 then
        raise exception 'A pergunta "%" aceita uma alternativa só.', v_question.prompt
          using errcode = 'AV003';
      end if;

      for v_option_id in
        select (valor #>> '{}')::uuid from jsonb_array_elements(v_opcoes) as t(valor)
      loop
        if not exists (
          select 1 from public.event_evaluation_options o
          where o.id = v_option_id and o.question_id = v_question.id
        ) then
          raise exception 'Alternativa inválida para a pergunta "%".', v_question.prompt
            using errcode = 'AV003';
        end if;

        -- §32 do Prompt 3. O valor vem da OPÇÃO, e nunca do payload.
        insert into public.event_evaluation_answers
          (participant_evaluation_id, round, question_id, option_id, numeric_value)
        select v_row.id, v_row.answer_round, v_question.id, o.id, o.numeric_value
        from public.event_evaluation_options o
        where o.id = v_option_id;
      end loop;
    end if;
  end loop;

  -- §16/§25. As obrigatórias, conferidas contra o que FOI GRAVADO.
  select string_agg(q.prompt, '; ') into v_faltando
  from public.event_evaluation_questions q
  join public.event_evaluation_sections s on s.id = q.section_id
  where s.version_id = v_row.version_id
    and q.required
    and not exists (
      select 1 from public.event_evaluation_answers a
      where a.participant_evaluation_id = v_row.id
        and a.round = v_row.answer_round
        and a.question_id = q.id
    );

  if v_faltando is not null then
    raise exception 'Falta responder: %', left(v_faltando, 300) using errcode = 'AV006';
  end if;

  -- §17. A rede embaixo do `for update`: se não casar, alguém respondeu no
  -- intervalo — e o `raise` desfaz as linhas de resposta gravadas acima.
  update public.event_participant_evaluations pe
  set status = 'answered',
      answered_at = now(),
      sent_at = coalesce(pe.sent_at, now())
  where pe.id = v_row.id
    and pe.status <> 'answered'
  returning pe.id into v_reivindicada;

  if v_reivindicada is null then
    raise exception 'Esta avaliação já foi respondida.' using errcode = 'AV004';
  end if;

  insert into public.event_evaluation_audit_logs
    (event_id, evaluation_id, action, actor_id, metadata)
  values (
    v_row.event_id, v_row.evaluation_id, 'evaluation_answered',
    null,
    jsonb_build_object(
      'participantEvaluationId', v_row.id,
      'versionId', v_row.version_id,
      'round', v_row.answer_round
    )
  );

  return jsonb_build_object('state', 'answered');
end;
$$;

comment on function public.submit_event_evaluation is
  'Grava a resposta inteira numa transacao (§16). Nao julga presenca (§34) — o convite saiu, a resposta vale.';

revoke execute on function public.submit_event_evaluation(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_event_evaluation(text, jsonb) to service_role;


-- ----------------------------------------------------------------------------
-- 4. §5 e §14 — o agendador conta o que ignorou, e por quê
-- ----------------------------------------------------------------------------
-- ⚠️ ANTES ELE DEVOLVIA DOIS NÚMEROS e engolia o resto. Um evento que terminou
-- sem ninguém presente era descartado pelo `exists` sem deixar rastro — e o §5
-- pede exatamente esse registro ("Evento processado / Presentes: 0 /
-- Avaliações geradas: 0"). O §14 pede "participantes ignorados; motivo do
-- ignore".
--
-- ⚠️ CONTAGENS, E NÃO UMA LISTA DE EVENTOS. Uma lista cresceria a cada passada
-- para sempre: todo evento passado sem presentes voltaria ao log a cada dez
-- minutos, e o que é para ajudar a investigar viraria o ruído que impede. O que
-- sai são três números por passada, e eles respondem a pergunta que interessa:
-- "alguma coisa deixou de ser feita, e por qual motivo?"
--
-- ⚠️ E O `exists` CONTINUA FILTRANDO O TRABALHO. Ele só deixou de ser invisível:
-- o que ele descarta agora é contado antes.
create or replace function public.schedule_event_evaluations(p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evento record;
  v_version uuid;
  v_send_at timestamptz;
  v_expires timestamptz;
  v_criadas integer;
  v_total integer := 0;
  v_eventos integer := 0;
  v_sem_presente integer := 0;
  v_sem_pergunta integer := 0;
begin
  -- §5. Quantos eventos venceram a hora e não tinham ninguém presente para
  -- avaliar. Não é erro: é o dia em que o evento foi pequeno, ou a lista de
  -- presença não foi preenchida.
  select count(*) into v_sem_presente
  from public.event_evaluation_settings s
  join public.events e on e.id = s.event_id
  where s.enabled
    and s.evaluation_id is not null
    and e.end_time is not null
    and public.event_evaluation_send_at(s.event_id, s.delay_minutes) <= now()
    and not exists (
      select 1 from public.event_participants p
      where p.event_id = s.event_id and p.present
    );

  for v_evento in
    select s.event_id, s.evaluation_id, s.delay_minutes, s.response_window_days
    from public.event_evaluation_settings s
    join public.events e on e.id = s.event_id
    where s.enabled
      and s.evaluation_id is not null
      -- §3/§9. Sem término não há conta a fazer.
      and e.end_time is not null
      and public.event_evaluation_send_at(s.event_id, s.delay_minutes) <= now()
      and exists (
        select 1 from public.event_participants p
        where p.event_id = s.event_id
          and p.present
          and not exists (
            select 1 from public.event_participant_evaluations pe
            where pe.event_id = p.event_id and pe.participant_id = p.id
          )
      )
    order by public.event_evaluation_send_at(s.event_id, s.delay_minutes)
    limit greatest(coalesce(p_limit, 5), 1)
  loop
    v_version := public.current_evaluation_version_id(v_evento.evaluation_id);

    -- §14. Formulário vazio é um motivo de ignore, e agora ele é contado.
    if v_version is null or not exists (
      select 1 from public.event_evaluation_sections s where s.version_id = v_version
    ) then
      v_sem_pergunta := v_sem_pergunta + 1;
      continue;
    end if;

    v_send_at := public.event_evaluation_send_at(v_evento.event_id, v_evento.delay_minutes);
    v_expires := case
      when v_evento.response_window_days is null then null
      else v_send_at + make_interval(days => v_evento.response_window_days)
    end;

    -- ⚠️ §7/§8 — `p.present` É O ÚNICO CRITÉRIO, e `confirmation` não aparece
    -- aqui. "Confirmado OFF + Presente ON → RECEBE" sai de graça porque a coluna
    -- de confirmação não é lida por esta função.
    insert into public.event_participant_evaluations
      (event_id, participant_id, evaluation_id, version_id, token,
       status, scheduled_for, expires_at)
    select
      p.event_id,
      p.id,
      v_evento.evaluation_id,
      v_version,
      replace(gen_random_uuid()::text, '-', ''),
      'scheduled',
      v_send_at,
      v_expires
    from public.event_participants p
    where p.event_id = v_evento.event_id
      and p.present
    -- §12. A idempotência não é uma checagem: é o índice único.
    on conflict (event_id, participant_id) do nothing;

    get diagnostics v_criadas = row_count;
    v_total := v_total + v_criadas;
    if v_criadas > 0 then
      v_eventos := v_eventos + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'events', v_eventos,
    'created', v_total,
    'skippedNoPresent', v_sem_presente,
    'skippedNoQuestions', v_sem_pergunta
  );
end;
$$;

comment on function public.schedule_event_evaluations is
  'Cria a avaliacao dos PRESENTES de eventos ja terminados + atraso (§7, §9). Conta o que ignorou e por que (§5, §14).';

revoke execute on function public.schedule_event_evaluations(integer)
  from public, anon, authenticated;
grant execute on function public.schedule_event_evaluations(integer) to service_role;


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   -- Recriar as quatro funções como estão em 20261002000100:
--   --   claim_event_evaluations(integer)
--   --   get_public_event_evaluation(text)
--   --   submit_event_evaluation(text, jsonb)
--   --   schedule_event_evaluations(integer)
--
-- ⚠️ DESFAZER ISTO REINTRODUZ DOIS DEFEITOS, e vale saber quais antes de fazer:
-- convites voltam a sair para quem teve a presença corrigida depois da fila
-- montada (§33), e quem recebeu o convite volta a ser bloqueado na hora de
-- responder se alguém mexer na presença dele (§34).
--
-- Nenhum dado é perdido nos dois sentidos: este arquivo só troca consultas.
-- ============================================================================
