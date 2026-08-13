-- ============================================================================
-- Catálogo inicial de públicos-alvo de eventos
-- ----------------------------------------------------------------------------
-- Arquivo separado do schema de propósito: público-alvo é DADO DE NEGÓCIO, e a
-- APCS vai acrescentar outros com o tempo. Cada público novo é um `insert` como
-- os de baixo — sem uma linha de código, sem tela nova, sem tipo regerado.
--
-- Esse é exatamente o retorno de o catálogo ser uma TABELA e não um enum: um
-- enum exigiria duas migrations por público (o valor não pode ser usado na mesma
-- transação em que é criado) e o Postgres não permite remover valor de enum —
-- um nome errado seria permanente.
--
-- ⚠️ ENQUANTO HOUVER UM ÚNICO PÚBLICO, A SEGMENTAÇÃO ROTULA MAS NÃO SEPARA
-- NINGUÉM. Isso é esperado nesta etapa: não existe cadastro de associados neste
-- banco contra o qual resolver a audiência. Ver docs/EVENTS.md.
-- ============================================================================

insert into public.event_segments (slug, name, description)
values (
  'all-members',
  'Todos os associados',
  'Eventos abertos a toda a base de associados da APCS.'
)
on conflict (slug) do nothing;

-- ----------------------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   delete from public.event_segments where slug = 'all-members';
--
-- Falha de propósito se algum evento já usar o público (a FK de
-- `event_segment_links` é `on delete restrict`) — apagar um público em uso
-- deixaria eventos sem destinatário.
-- ----------------------------------------------------------------------------
