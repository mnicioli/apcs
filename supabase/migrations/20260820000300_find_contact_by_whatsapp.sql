-- ============================================================================
-- ENQUETES — PROMPT 3/3 · achar o contato pelo número que o WhatsApp mandou
-- ============================================================================
--
-- O fornecedor entrega `5519991234567`. Os contatos deste banco estão gravados
-- como `(19) 99123-4567`. Comparar as duas strings não casa NUNCA — e o
-- sintoma seria o pior possível: toda resposta cairia em "não conheço este
-- número" e nenhuma seria registrada, sem erro nenhum aparecendo.
--
-- ⚠️ ESTA FUNÇÃO NÃO DECIDE — ELA ESTREITA.
--
-- A regra de "o que é um telefone válido de WhatsApp" (celular, DDD que existe,
-- 9 na frente) mora em UM lugar só: `src/lib/messaging/phone.ts`. Repeti-la
-- aqui criaria duas verdades que divergiriam no primeiro ajuste. O que o SQL
-- faz é o que o SQL faz bem: reduzir a base inteira a um punhado de candidatos
-- pelos 8 últimos dígitos. Quem confirma é `sameWhatsAppNumber`, no servidor.
--
-- Oito dígitos, e não os nove do celular, porque parte da base foi cadastrada
-- antes do nono dígito ou sem ele. Casar por oito devolve um candidato a mais
-- de vez em quando — e a confirmação no servidor descarta.
-- ============================================================================

create or replace function public.find_contact_by_whatsapp(p_number text)
returns setof public.chat_contacts
language sql
stable
security definer
set search_path = ''
as $$
  select c.*
  from public.chat_contacts c
  where c.phone is not null
    and length(pg_catalog.regexp_replace(c.phone, '[^0-9]', '', 'g')) >= 8
    and pg_catalog.right(pg_catalog.regexp_replace(c.phone, '[^0-9]', '', 'g'), 8)
      = pg_catalog.right(pg_catalog.regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g'), 8)
    and length(pg_catalog.regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g')) >= 8
  -- Empate é possível (dois cadastros do mesmo número, ou dois números que
  -- terminam igual em DDDs diferentes). O mais recente primeiro; quem chama
  -- confirma o número inteiro e escolhe.
  order by c.created_at desc
  limit 10;
$$;

comment on function public.find_contact_by_whatsapp(text) is
  'Estreita a base a candidatos pelos 8 últimos dígitos. A regra de número válido mora em src/lib/messaging/phone.ts — aqui não se decide, só se filtra.';

revoke execute on function public.find_contact_by_whatsapp(text)
  from public, anon, authenticated;
grant execute on function public.find_contact_by_whatsapp(text) to service_role;

do $revoke_anon$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'find_contact_by_whatsapp'
  loop
    execute pg_catalog.format('revoke execute on function %s from anon', f.assinatura);
  end loop;
end $revoke_anon$;
