-- ============================================================================
-- APOSENTA OS PAPÉIS CEO, GERENTE DE PROJETO E TECH LEAD
-- ============================================================================
--
-- Decisão do produto: o sistema passa a ter QUATRO papéis — Administrador,
-- Comercial, Financeiro e Visualização. Quem publica normativa, comunicado,
-- boletim, evento, palestra e enquete, e quem aprova associado, é o
-- ADMINISTRADOR. Não há mais um nível intermediário.
--
-- ----------------------------------------------------------------------------
-- ⚠️ O ENUM `app_role` NÃO É RECONSTRUÍDO, E ESTA É A DECISÃO CENTRAL DO ARQUIVO
-- ----------------------------------------------------------------------------
-- O Postgres não sabe remover um valor de enum. O caminho oficial é criar um
-- tipo novo, converter a coluna e apagar o antigo — e é aí que a conta fica
-- cara: as expressões das policies guardam o OID do tipo, então TODAS as 122
-- referências a 'ceo' espalhadas por 21 migrations teriam de ser reescritas na
-- mesma transação, junto com toda função que tem `app_role` na assinatura.
--
-- Cento e vinte e duas reescritas de policy é onde um erro de digitação abre um
-- módulo em silêncio. Uma policy que passasse de `in ('admin','ceo')` para
-- `in ('admin','ceo','comercial')` por engano não daria erro nenhum — daria
-- acesso, e ninguém perceberia.
--
-- ENTÃO A TRANCA FICA NA PORTA, NÃO NAS 122 JANELAS. Se nenhuma linha de
-- `profiles` pode ter 'ceo', `current_app_role()` nunca devolve 'ceo', e todo
-- `in ('admin','ceo',...)` do banco se comporta exatamente como
-- `in ('admin',...)`. As referências continuam lá, inertes, e o CHECK abaixo é
-- o que prova que são inertes.
--
-- O efeito colateral bom: reverter é apagar o CHECK. O ruim: quem ler uma
-- policy vai ver 'ceo' e precisar chegar até aqui para entender. Por isso o
-- comentário no tipo, no fim do arquivo.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Quem está com um papel aposentado AGORA
-- ----------------------------------------------------------------------------
-- ⚠️ CEO VIRA ADMINISTRADOR, e não `viewer`. É a consequência direta da decisão
-- "só Administrador faz tudo": se a pessoa que publica normativa e aprova
-- associado fosse rebaixada a Visualização, a APCS ficaria sem ninguém capaz de
-- publicar no instante em que esta migration rodasse — e a descoberta seria na
-- próxima vez que alguém tentasse trabalhar.
--
-- ⚠️ ISSO É UMA PROMOÇÃO. Administrador também gerencia usuários e
-- configurações, que o CEO não fazia. É deliberado e é o preço da decisão —
-- mas CONFIRA A LISTA em /users depois de rodar. Cada conversão fica registrada
-- na trilha da Administração, com o motivo, justamente para essa conferência.
with convertidos as (
  update public.profiles
  set role = 'admin'
  where role = 'ceo'
  returning email
)
insert into public.admin_audit_logs (action, target, actor_name, metadata)
select
  'user_role_changed',
  c.email,
  'Aposentadoria de papéis',
  jsonb_build_object('from', 'ceo', 'to', 'admin', 'motivo', 'papel aposentado')
from convertidos c;

-- Gerente de Projeto e Tech Lead viram Visualização. Diferente do CEO, eles
-- nunca tiveram acesso a módulo nenhum da APCS: apareciam em UMA policy (o
-- diretório interno de colegas) e em nada mais. Ninguém perde trabalho aqui.
with convertidos as (
  update public.profiles
  set role = 'viewer'
  where role in ('pm', 'tech_lead')
  returning email, role
)
insert into public.admin_audit_logs (action, target, actor_name, metadata)
select
  'user_role_changed',
  c.email,
  'Aposentadoria de papéis',
  jsonb_build_object('to', 'viewer', 'motivo', 'papel aposentado')
from convertidos c;


-- ----------------------------------------------------------------------------
-- 2. A tranca
-- ----------------------------------------------------------------------------
-- ⚠️ LISTA NEGATIVA ("estes não"), e não positiva ("só estes"). Uma lista
-- positiva teria de ser editada toda vez que um papel novo entrasse — e o
-- esquecimento apareceria como "não consigo promover ninguém para o papel que
-- acabei de criar", horas depois. A negativa envelhece sozinha: papel novo
-- passa, papel aposentado não.
alter table public.profiles
  add constraint profiles_role_not_retired
  check (role not in ('ceo', 'pm', 'tech_lead'));

comment on constraint profiles_role_not_retired on public.profiles is
  'Papeis aposentados. E este CHECK que torna inertes as 122 referencias a ceo espalhadas pelas policies.';


-- ----------------------------------------------------------------------------
-- 3. A mensagem boa, antes do erro feio
-- ----------------------------------------------------------------------------
-- O CHECK acima já barra. Mas ele barra com "new row violates check constraint
-- profiles_role_not_retired", que não diz nada a quem está usando a tela. Esta
-- guarda existe só para a frase — a segurança continua sendo o CHECK.
create or replace function public.set_user_role(
  p_user_id uuid,
  p_role public.app_role
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before public.profiles%rowtype;
  v_after public.profiles%rowtype;
  v_admins integer;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores alteram o papel de um usuario.' using errcode = '42501';
  end if;

  if p_role in ('ceo', 'pm', 'tech_lead') then
    raise exception 'Este papel foi aposentado e nao pode mais ser atribuido.' using errcode = 'AD006';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'Voce nao pode alterar o proprio papel.' using errcode = 'AD002';
  end if;

  select * into v_before from public.profiles p where p.id = p_user_id;
  if v_before.id is null then
    raise exception 'Usuario nao encontrado.' using errcode = 'P0002';
  end if;

  -- Nada mudou: sai sem escrever e sem sujar a trilha.
  if v_before.role = p_role then
    return v_before;
  end if;

  -- ⚠️ CONTA OS ADMINS ATIVOS ANTES DE REBAIXAR UM. `count(*) = 1` combinado
  -- com "este é admin e vai deixar de ser" é exatamente o caso em que o sistema
  -- fica órfão. O `and p.active` entrou com 20260831000100_admin_users.sql:
  -- um administrador desligado não administra nada.
  if v_before.role = 'admin' and p_role <> 'admin' then
    select count(*) into v_admins
    from public.profiles p
    where p.role = 'admin' and p.active;

    if v_admins <= 1 then
      raise exception 'O sistema precisa de pelo menos um administrador.' using errcode = 'AD001';
    end if;
  end if;

  update public.profiles
  set role = p_role
  where id = p_user_id
  returning * into v_after;

  perform public.log_admin_action(
    'user_role_changed',
    v_after.email,
    jsonb_build_object('from', v_before.role, 'to', p_role)
  );

  return v_after;
end;
$fn$;

comment on function public.set_user_role(uuid, public.app_role) is
  'Troca o papel de um usuario. Recusa papel aposentado (AD006), deixar o sistema sem admin (AD001) e trocar o proprio papel (AD002).';

-- O convite também escolhe papel, e pela mesma porta precisa recusar o mesmo.
create or replace function public.log_user_invite(p_email text, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores convidam usuarios.' using errcode = '42501';
  end if;

  if p_role in ('ceo', 'pm', 'tech_lead') then
    raise exception 'Este papel foi aposentado e nao pode mais ser atribuido.' using errcode = 'AD006';
  end if;

  perform public.log_admin_action(
    'user_invited',
    lower(btrim(p_email)),
    jsonb_build_object('role', p_role)
  );
end;
$fn$;


-- ----------------------------------------------------------------------------
-- 4. O aviso para quem ler uma policy e estranhar
-- ----------------------------------------------------------------------------
comment on type public.app_role is
  'Papeis do sistema. ATENCAO: ceo, pm e tech_lead foram APOSENTADOS em 20260902000000 e nao podem mais ser atribuidos (CHECK profiles_role_not_retired). Eles continuam no enum porque o Postgres nao remove valor de enum, e continuam citados em policies antigas — inertes, ja que nenhuma linha de profiles pode te-los.';
