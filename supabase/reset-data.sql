-- ============================================================================
-- LIMPEZA DA BASE — apaga os dados, preserva o schema.
-- ----------------------------------------------------------------------------
-- COMO RODAR: Supabase Dashboard > SQL Editor > cole > Run.
-- Roda como `postgres`: ignora RLS, grants de coluna e as policies dos modulos.
--
-- ⚠️ ISTO NAO TEM VOLTA. Nao ha "desfazer" depois do commit. Se a base tiver
--    qualquer dado real, faca backup antes (Dashboard > Database > Backups).
--
-- O arquivo tem TRES blocos. Por padrao SO O BLOCO 1 executa; os outros dois
-- estao comentados de proposito, porque cada um cobra um preco diferente:
--
--   BLOCO 1  Dados operacionais .......... ATIVO. Leads, conversas, associados,
--            palestras, eventos, boletins, enquetes, WhatsApp, documentos.
--   BLOCO 2  Catalogos das migrations .... comentado. So se quiser o estado
--            "recem-migrado". Exige recolocar o catalogo (secao 2.1).
--   BLOCO 3  Usuarios ................... comentado. APAGA O SEU LOGIN.
--
-- NUNCA APAGUE, em nenhum cenario:
--   lecture_status_transitions
--   membership_application_status_transitions
--   survey_status_transitions
-- Sao os grafos de status que os triggers `*_guard` consultam. Vazios, o
-- trigger cai no `not exists` e RECUSA TODA criacao: nenhuma palestra, nenhuma
-- solicitacao e nenhuma enquete poderiam mais ser criadas — e o erro que
-- aparece na tela nao aponta para a causa. Se acontecer, o conserto e reaplicar
-- as migrations que semeiam essas tres tabelas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- BLOCO 1 — Dados operacionais
-- ----------------------------------------------------------------------------
-- `truncate` e nao `delete`, por tres motivos: a ordem das FKs deixa de
-- importar, `restart identity` zera as sequences de `chat_messages.seq`,
-- `whatsapp_messages.seq` e das trilhas (senao a proxima mensagem da base
-- limpa nasceria com seq 4812), e a tabela inteira sai numa operacao so.
--
-- `cascade` alcanca so quem referencia as tabelas listadas. Conferido: nada do
-- que se quer preservar esta nesse caminho — `event_segments` e os tres grafos
-- de status ficam do lado REFERENCIADO, e truncate nao sobe por ai.
--
-- Uma unica instrucao com todas as tabelas: assim a ordem das FKs nao importa e
-- ou tudo cai junto, ou nada cai.
begin;

truncate table
  -- Chat publico e leads
  public.chat_messages,
  public.chat_conversations,
  public.csp_leads,
  public.chat_contacts,

  -- Associados
  public.membership_audit_logs,
  public.membership_applications,
  public.members,

  -- Palestras  (lecture_status_transitions FICA DE FORA — ver o cabecalho)
  public.lecture_audit_logs,
  public.lectures,

  -- Eventos  (event_segments FICA DE FORA — e catalogo, secao 2)
  public.event_audit_logs,
  public.event_segment_links,
  public.events,

  -- Documentos
  public.document_audit_logs,
  public.document_versions,
  public.documents,

  -- Boletins de mercado
  public.market_bulletin_audit_logs,
  public.market_bulletin_versions,
  public.market_bulletins,

  -- Enquetes  (survey_status_transitions FICA DE FORA — ver o cabecalho)
  public.survey_audit_logs,
  public.survey_responses,
  public.survey_dispatches,
  public.survey_recipients,
  public.survey_audience_criteria,
  public.survey_options,
  public.survey_questions,
  public.survey_conversation_states,
  public.survey_inbound_events,
  public.notification_opt_outs,
  public.surveys,

  -- WhatsApp
  public.whatsapp_messages,
  public.whatsapp_chats
restart identity cascade;

-- Recoloca o catalogo de Comunicacao, que a migration
-- `20260812000100_seed_communication_documents.sql` semeia e o truncate acima
-- levou junto. Sem isto a aba Comunicacao abre vazia e nao ha tela para
-- recria-la — as quatro publicacoes sao fixas.
insert into public.documents (category, name, description)
values
  ('communication', 'ISP',               'Publicação ISP da APCS.'),
  ('communication', 'Revista',           'Revista institucional da APCS.'),
  ('communication', 'Calendário Anual',  'Calendário anual de atividades e eventos da APCS.'),
  ('communication', 'Custo de Produção', 'Publicação de custo de produção suinícola.')
on conflict do nothing;

commit;

-- ----------------------------------------------------------------------------
-- BLOCO 2 — Catalogos semeados pelas migrations  (DESCOMENTE se quiser)
-- ----------------------------------------------------------------------------
-- So faz sentido para voltar a base ao estado "recem-migrada". Sao dados que
-- nenhuma tela cria: se apagar, tem de recolocar pela secao 2.1 abaixo ou
-- reaplicando as migrations correspondentes.
--
-- begin;
-- truncate table public.event_segment_links, public.event_segments restart identity cascade;
-- commit;

-- 2.1 Recoloca os publicos-alvo de Eventos (migrations 20260813000100 e ...300).
--
-- begin;
-- insert into public.event_segments (slug, name, description) values
--   ('all-members',   'Toda a base',   'Atalho: grava o evento para os cinco públicos de uma vez.'),
--   ('associados',    'Associados',    null),
--   ('empresas',      'Empresas',      null),
--   ('produtores',    'Produtores',    null),
--   ('universidades', 'Universidades', null),
--   ('tecnicos',      'Técnicos',      null)
-- on conflict (slug) do nothing;
-- commit;

-- 2.2 A primeira enquete (migration 20260819000100) nasce em rascunho. Para
--     recria-la, use a MESMA porta que a migration usa — `create_survey` passa
--     pelas validacoes, pelo grafo e pela trilha; um insert direto nao passa.
--
-- select public.create_survey(
--   'Expectativa sobre o valor da @ do suíno',
--   'Enquete de expectativa de mercado enviada aos associados da APCS pelo WhatsApp.',
--   'Como você acredita que ficará o valor da @ do suíno nas próximas semanas?',
--   array['Aumentar muito', 'Aumentar', 'Manter', 'Reduzir', 'Reduzir muito']
-- );

-- ----------------------------------------------------------------------------
-- BLOCO 3 — Usuarios  (DESCOMENTE com cuidado)
-- ----------------------------------------------------------------------------
-- ⚠️ APAGA O SEU PROPRIO LOGIN. Depois disto ninguem entra no sistema ate que
--    alguem se cadastre de novo — e quem se cadastra nasce `viewer`, entao vai
--    precisar da promocao a admin no fim deste bloco.
--
-- Apague `auth.users`, NUNCA `public.profiles` direto: a FK de profiles e
-- `on delete cascade` a partir de auth.users, e as colunas `created_by` /
-- `updated_by` espalhadas pelos modulos sao `on delete set null`. Truncar
-- profiles em cascata derrubaria essas tabelas inteiras junto.
--
-- begin;
-- delete from auth.users;
-- commit;
--
-- Depois de recriar sua conta pelo /login, promova-a (troque o e-mail):
-- update public.profiles set role = 'admin' where email = 'voce@empresa.com';

-- ----------------------------------------------------------------------------
-- ARQUIVOS NO STORAGE — nao saem por SQL
-- ----------------------------------------------------------------------------
-- O truncate acima apagou as LINHAS que apontam para os arquivos, nao os
-- arquivos. Apagar `storage.objects` por SQL tambem nao resolve: remove o
-- registro e deixa o binario orfao no bucket, ocupando espaco e sem nada que o
-- referencie.
--
-- O caminho certo e o Dashboard > Storage, esvaziando os cinco buckets:
--   documents · events · market-bulletins · surveys · whatsapp-media
--
-- NESTA ORDEM: o SQL primeiro, os buckets depois. A policy
-- `market_bulletins_bucket_delete` recusa apagar arquivo que alguma versao de
-- boletim ainda referencia — historico nao se apaga. Com as versoes ja
-- truncadas pelo BLOCO 1, os arquivos viram orfaos e a policy libera. Na ordem
-- inversa, os PDFs dos boletins publicados nao saem.
--
-- Nao apague os BUCKETS em si — eles sao criados pelas migrations, e sem eles
-- todo upload passa a falhar.

-- ============================================================================
-- Conferencia — deve voltar tudo zerado, menos as tres primeiras linhas
-- ============================================================================
select 'PRESERVAR · transicoes de palestra'    as tabela, count(*) from public.lecture_status_transitions
union all select 'PRESERVAR · transicoes de solicitacao', count(*) from public.membership_application_status_transitions
union all select 'PRESERVAR · transicoes de enquete',     count(*) from public.survey_status_transitions
union all select 'PRESERVAR · publicos de evento',        count(*) from public.event_segments
union all select 'PRESERVAR · catalogo de comunicacao',   count(*) from public.documents where category = 'communication'
union all select 'perfis (usuarios)',                     count(*) from public.profiles
union all select 'contatos do chat',                      count(*) from public.chat_contacts
union all select 'conversas do chat',                     count(*) from public.chat_conversations
union all select 'leads',                                 count(*) from public.csp_leads
union all select 'associados',                            count(*) from public.members
union all select 'solicitacoes de associacao',            count(*) from public.membership_applications
union all select 'palestras',                             count(*) from public.lectures
union all select 'eventos',                               count(*) from public.events
union all select 'documentos (versoes)',                  count(*) from public.document_versions
union all select 'boletins de mercado',                   count(*) from public.market_bulletins
union all select 'enquetes',                              count(*) from public.surveys
union all select 'conversas de WhatsApp',                 count(*) from public.whatsapp_chats
union all select 'mensagens de WhatsApp',                 count(*) from public.whatsapp_messages;
