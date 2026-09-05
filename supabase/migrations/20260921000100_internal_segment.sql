-- ============================================================================
-- PÚBLICO-ALVO — "Time Interno APCS"
-- ============================================================================
--
-- O quinto público do catálogo, para a APCS testar com gente de casa antes de
-- falar com a base. Ele funciona exatamente como os outros quatro: uma linha em
-- `event_segments` e uma linha no tradutor `profile_for_event_segment`.
--
-- DEPENDE DE: 20260921000000 (o valor `interno` no enum).
--
-- ----------------------------------------------------------------------------
-- ⚠️ COMO SE COLOCA ALGUÉM NESTE PÚBLICO
-- ----------------------------------------------------------------------------
-- Abrindo o cadastro da pessoa em Associados e trocando o PERFIL para "Time
-- Interno". Não há tela de "adicionar ao público" — nunca houve, para nenhum
-- dos cinco: pertencer a um público É ter aquele perfil.
--
-- A pessoa precisa de `whatsapp` preenchido e `status = 'active'` para receber
-- qualquer coisa. As três condições (perfil, telefone, ativo) são as mesmas que
-- `broadcast_audience_size` e `members_in_event_segments` já cobram de todo
-- mundo — este público não tem exceção nenhuma.
--
-- ----------------------------------------------------------------------------
-- ⚠️ O QUE ISTO **NÃO** RESOLVE
-- ----------------------------------------------------------------------------
-- O §18 do Prompt 5 dos Fluxos pede um "enviar teste" que marque a mensagem
-- como TESTE e a separe da comunicação oficial. Isto aqui é a metade que
-- faltava — o PÚBLICO —, e não a outra metade: uma mensagem enviada a este
-- público hoje é gravada como qualquer outra, sem marcação.
--
-- Na prática significa: dá para mandar um evento, um disparo ou uma enquete só
-- para o time interno, e isso já é o teste de ponta a ponta. O que ainda não
-- existe é o sistema SABER que aquilo foi teste. Ver docs/FLUXOS.md, seção 16.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. O público
-- ----------------------------------------------------------------------------
-- O CHECK `event_segments_slug_format` só aceita [a-z0-9-]: daí o slug sem
-- acento e sem maiúscula, com o nome de tela por extenso ao lado.
insert into public.event_segments (slug, name, description)
values (
  'time-interno-apcs',
  'Time Interno APCS',
  'Pessoas da própria APCS, para testar comunicações antes de falar com a base. '
    || 'Não são associados e não entram nos indicadores de base.'
)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      active = true;


-- ----------------------------------------------------------------------------
-- 2. O tradutor público ↔ perfil
-- ----------------------------------------------------------------------------
-- ⚠️ ESTA FUNÇÃO É O ÚNICO LUGAR QUE DECIDE QUEM ESTÁ EM QUE PÚBLICO, e é por
-- isso que acrescentar um público é uma linha aqui. Ela é lida por:
--
--   `event_segments_for_member`   a que públicos este associado pertence
--   `members_in_event_segments`   quem está nestes públicos (eventos, enquetes)
--   `broadcast_audience_size`     quantos um disparo alcança
--   `create_broadcast`            quem entra na lista de destinatários
--
-- Os quatro passam por aqui. Uma segunda tradução em qualquer um deles seria
-- uma segunda verdade sobre a mesma pergunta.
--
-- ⚠️ `immutable` E NÃO `stable`: ela é uma tabela de tradução pura, sem consulta
-- nenhuma. O planejador conta com isso para usá-la dentro de `in (...)` sem
-- reavaliar por linha — ver `create_broadcast`.
create or replace function public.profile_for_event_segment(p_slug text)
returns public.membership_profile_type
language sql
immutable
set search_path = ''
as $fn$
  select case p_slug
    when 'produtores'        then 'criador'
    when 'empresas'          then 'empresa'
    when 'tecnicos'          then 'tecnico'
    when 'universidades'     then 'universidade'
    when 'time-interno-apcs' then 'interno'
    else null
  end::public.membership_profile_type;
$fn$;

comment on function public.profile_for_event_segment(text) is
  'Traduz slug de publico-alvo em perfil de cadastro. Null quando o slug nao corresponde a perfil (atalho ou publico aposentado).';


-- ============================================================================
-- ROLLBACK
-- ============================================================================
--   -- Desativar basta: `assert_event_segments` exige `active`, então nem uma
--   -- chamada direta à API consegue mais usar o público. Não APAGUE a linha —
--   -- a FK de `event_segment_links` é `on delete restrict`, e a auditoria de
--   -- eventos antigos guarda ids de segmento.
--   update public.event_segments set active = false where slug = 'time-interno-apcs';
--
--   -- E devolver o tradutor à versão de 20260828205853, sem a quinta linha.
--   -- (Deixá-la é inofensivo: um público inativo nunca chega a ser traduzido.)
-- ============================================================================
