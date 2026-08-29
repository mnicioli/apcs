-- ============================================================================
-- QUANTAS PESSOAS ESTE EVENTO VAI ALCANÇAR — a pergunta antes do clique
-- ============================================================================
--
-- ⚠️ ESTA FUNÇÃO EXISTE POR UM MOTIVO DE SEGURANÇA, NÃO DE CONVENIÊNCIA.
--
-- "Divulgar" manda WhatsApp para a base e NÃO TEM DESFAZER. Uma confirmação
-- que diz apenas "deseja divulgar?" pede que a pessoa aprove um número que ela
-- não conhece — e a diferença entre 12 e 1.200 destinatários é a diferença
-- entre um erro corrigível e um incidente com o número da APCS.
--
-- Com a contagem, a caixa de confirmação diz "isto vai enviar para 247
-- pessoas", e um público-alvo marcado errado fica visível ANTES, não depois.
--
-- ----------------------------------------------------------------------------
-- POR QUE `security definer`
-- ----------------------------------------------------------------------------
-- Ela lê `members`, e quem divulga evento tem papel `comercial` ou `ceo` — que
-- não necessariamente enxerga o cadastro de associados pela RLS. A alternativa
-- seria abrir `members` para esses papéis, o que daria acesso a nome, telefone
-- e CNPJ de toda a base para responder uma pergunta que é só um número.
--
-- Devolver só a CONTAGEM é o mínimo que responde à pergunta. A barreira de
-- papel está no corpo, e é a mesma de `start_event_dispatch`.
-- ============================================================================

create or replace function public.count_event_audience(p_event_id uuid)
returns table (total integer, blocked integer)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if (select public.current_app_role()) not in ('admin', 'ceo', 'comercial') then
    raise exception 'Sem permissao para consultar a audiencia.' using errcode = '42501';
  end if;

  return query
  with alvo as (
    -- ⚠️ `distinct on (whatsapp)` — a MESMA regra de `start_event_dispatch`.
    -- Se a prévia contasse cadastros e a fila contasse telefones, a tela
    -- prometeria 250 e o banco entregaria 243, e ninguem saberia explicar a
    -- diferenca. As duas contam a mesma coisa de proposito.
    select distinct on (m.whatsapp)
      m.whatsapp,
      exists (
        select 1
        from public.notification_opt_outs o
        join public.chat_contacts c on c.id = o.contact_id
        where public.notification_phone_key(c.phone)
            = public.notification_phone_key(m.whatsapp)
      ) as opted_out
    from public.members m
    where m.status = 'active'
      and m.profile_type is not null
      and m.whatsapp ~ '^[0-9]{10,15}$'
      and m.profile_type in (
        select public.profile_for_event_segment(s.slug)
        from public.event_segment_links l
        join public.event_segments s on s.id = l.segment_id
        where l.event_id = p_event_id
          and public.profile_for_event_segment(s.slug) is not null
      )
    order by m.whatsapp, m.created_at, m.id
  )
  select
    count(*) filter (where not a.opted_out)::integer,
    count(*) filter (where a.opted_out)::integer
  from alvo a;
end;
$fn$;

comment on function public.count_event_audience(uuid) is
  'Quantos associados o evento alcanca, e quantos estao em opt-out. So a contagem — nunca a lista.';

revoke execute on function public.count_event_audience(uuid) from public, anon;
grant execute on function public.count_event_audience(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Como desfazer
-- ----------------------------------------------------------------------------
--   drop function if exists public.count_event_audience(uuid);
-- ----------------------------------------------------------------------------
