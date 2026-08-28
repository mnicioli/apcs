-- ============================================================================
-- SEED DE DEMONSTRACAO — dados ficticios para apresentacao.
-- ----------------------------------------------------------------------------
-- COMO RODAR: Supabase Dashboard > SQL Editor > cole tudo > Run.
-- Roda como `postgres`, entao ignora RLS e os grants de coluna.
--
-- Todos os ids comecam com `ddddddd` (de "demo"). Para remover tudo depois,
-- rode `supabase/seed-demo-cleanup.sql`.
--
-- ATENCAO: nomes, telefones e e-mails abaixo sao inventados.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Contatos do chat (a base de quase tudo)
-- ----------------------------------------------------------------------------
insert into public.chat_contacts (id, full_name, city, state, contact_profile, phone, email, preferred_channel, preferred_time, created_at) values
  ('ddddddd1-0000-4000-8000-000000000001', 'Joana Ribeiro',   'Ponta Grossa',     'PR', 'producer', '42999180011', 'joana.ribeiro@granjaboavista.com.br', 'whatsapp', 'morning',   now() - interval '9 days'),
  ('ddddddd1-0000-4000-8000-000000000002', 'Carlos Menezes',  'Castro',           'PR', 'producer', '42998740022', 'carlos@agromenezes.com.br',           'phone',    'afternoon', now() - interval '7 days'),
  ('ddddddd1-0000-4000-8000-000000000003', 'Fernanda Lopes',  'Toledo',           'PR', 'supplier', '45999330033', 'fernanda.lopes@nutrisul.com.br',      'email',    'any',       now() - interval '6 days'),
  ('ddddddd1-0000-4000-8000-000000000004', 'Ricardo Tanaka',  'Marechal Rondon',  'PR', 'producer', '45998120044', 'ricardo.tanaka@granjatanaka.com.br',  'whatsapp', 'evening',   now() - interval '5 days'),
  ('ddddddd1-0000-4000-8000-000000000005', 'Beatriz Almeida', 'Cascavel',         'PR', 'member',   '45999560055', 'beatriz.almeida@cooperoeste.com.br',  'whatsapp', 'morning',   now() - interval '4 days'),
  ('ddddddd1-0000-4000-8000-000000000006', 'Paulo Schneider', 'Palmeira',         'PR', 'producer', '42998330066', 'paulo.schneider@granjasp.com.br',     'whatsapp', 'afternoon', now() - interval '3 days'),
  ('ddddddd1-0000-4000-8000-000000000007', 'Marina Costa',    'Chapeco',          'SC', 'supplier', '49999470077', 'marina.costa@vetsuinos.com.br',       'email',    'morning',   now() - interval '2 days'),
  ('ddddddd1-0000-4000-8000-000000000008', 'Eduardo Ferrari', 'Carambei',         'PR', 'producer', '42999650088', 'eduardo@granjaferrari.com.br',        'whatsapp', 'any',       now() - interval '1 day'),
  ('ddddddd1-0000-4000-8000-000000000009', 'Luciana Prado',   'Irati',            'PR', 'producer', '42998910099', 'luciana.prado@granjaprado.com.br',    'whatsapp', 'morning',   now() - interval '20 hours'),
  ('ddddddd1-0000-4000-8000-000000000010', 'Anderson Vieira', 'Guarapuava',       'PR', 'member',   '42999120100', 'anderson.vieira@apcs-demo.com.br',    'phone',    'afternoon', now() - interval '6 hours')
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Conversas do chat publico
-- ----------------------------------------------------------------------------
insert into public.chat_conversations (id, contact_id, flow_key, status, session_token_hash, consent_given_at, consent_policy_version, collected, ip_hash, user_agent, last_message_at, created_at) values
  ('ddddddd2-0000-4000-8000-000000000001', 'ddddddd1-0000-4000-8000-000000000001', 'csp', 'completed', 'demo-hash-0001', now() - interval '9 days',   '1',  '{"fullName":"Joana Ribeiro","city":"Ponta Grossa","state":"PR"}',   'demo-ip-01', 'Mozilla/5.0 (demo)', now() - interval '9 days',    now() - interval '9 days'),
  ('ddddddd2-0000-4000-8000-000000000002', 'ddddddd1-0000-4000-8000-000000000002', 'csp', 'completed', 'demo-hash-0002', now() - interval '7 days',   '1',  '{"fullName":"Carlos Menezes","city":"Castro","state":"PR"}',        'demo-ip-02', 'Mozilla/5.0 (demo)', now() - interval '7 days',    now() - interval '7 days'),
  ('ddddddd2-0000-4000-8000-000000000003', 'ddddddd1-0000-4000-8000-000000000003', 'csp', 'completed', 'demo-hash-0003', now() - interval '6 days',   '1',  '{"fullName":"Fernanda Lopes","city":"Toledo","state":"PR"}',        'demo-ip-03', 'Mozilla/5.0 (demo)', now() - interval '6 days',    now() - interval '6 days'),
  ('ddddddd2-0000-4000-8000-000000000004', 'ddddddd1-0000-4000-8000-000000000004', 'csp', 'completed', 'demo-hash-0004', now() - interval '5 days',   '1',  '{"fullName":"Ricardo Tanaka","city":"Marechal Rondon","state":"PR"}', 'demo-ip-04', 'Mozilla/5.0 (demo)', now() - interval '5 days',  now() - interval '5 days'),
  ('ddddddd2-0000-4000-8000-000000000005', 'ddddddd1-0000-4000-8000-000000000005', 'csp', 'completed', 'demo-hash-0005', now() - interval '4 days',   '1',  '{"fullName":"Beatriz Almeida","city":"Cascavel","state":"PR"}',     'demo-ip-05', 'Mozilla/5.0 (demo)', now() - interval '4 days',    now() - interval '4 days'),
  ('ddddddd2-0000-4000-8000-000000000006', 'ddddddd1-0000-4000-8000-000000000006', 'csp', 'completed', 'demo-hash-0006', now() - interval '3 days',   '1',  '{"fullName":"Paulo Schneider","city":"Palmeira","state":"PR"}',     'demo-ip-06', 'Mozilla/5.0 (demo)', now() - interval '3 days',    now() - interval '3 days'),
  ('ddddddd2-0000-4000-8000-000000000007', 'ddddddd1-0000-4000-8000-000000000007', 'csp', 'completed', 'demo-hash-0007', now() - interval '2 days',   '1',  '{"fullName":"Marina Costa","city":"Chapeco","state":"SC"}',         'demo-ip-07', 'Mozilla/5.0 (demo)', now() - interval '2 days',    now() - interval '2 days'),
  ('ddddddd2-0000-4000-8000-000000000008', 'ddddddd1-0000-4000-8000-000000000008', 'csp', 'completed', 'demo-hash-0008', now() - interval '1 day',    '1',  '{"fullName":"Eduardo Ferrari","city":"Carambei","state":"PR"}',     'demo-ip-08', 'Mozilla/5.0 (demo)', now() - interval '1 day',     now() - interval '1 day'),
  ('ddddddd2-0000-4000-8000-000000000009', 'ddddddd1-0000-4000-8000-000000000009', 'csp', 'completed', 'demo-hash-0009', now() - interval '20 hours', '1',  '{"fullName":"Luciana Prado","city":"Irati","state":"PR"}',          'demo-ip-09', 'Mozilla/5.0 (demo)', now() - interval '20 hours',  now() - interval '20 hours'),
  ('ddddddd2-0000-4000-8000-000000000010', 'ddddddd1-0000-4000-8000-000000000010', 'csp', 'completed', 'demo-hash-0010', now() - interval '6 hours',  '1',  '{"fullName":"Anderson Vieira","city":"Guarapuava","state":"PR"}',   'demo-ip-10', 'Mozilla/5.0 (demo)', now() - interval '6 hours',   now() - interval '6 hours'),
  ('ddddddd2-0000-4000-8000-000000000011', null, 'csp', 'active',    'demo-hash-0011', now() - interval '2 hours',   '1',  '{"city":"Ivaipora","state":"PR"}', 'demo-ip-11', 'Mozilla/5.0 (demo)', now() - interval '2 hours',   now() - interval '2 hours'),
  ('ddddddd2-0000-4000-8000-000000000012', null, 'csp', 'active',    'demo-hash-0012', now() - interval '40 minutes','1',  '{}',                               'demo-ip-12', 'Mozilla/5.0 (demo)', now() - interval '40 minutes', now() - interval '40 minutes'),
  ('ddddddd2-0000-4000-8000-000000000013', null, 'csp', 'abandoned', 'demo-hash-0013', null,                          null, '{}',                              'demo-ip-13', 'Mozilla/5.0 (demo)', now() - interval '3 days',    now() - interval '3 days')
on conflict (id) do nothing;

-- Uma conversa completa, para abrir na apresentacao e mostrar o historico.
insert into public.chat_messages (conversation_id, role, content, content_key, created_at)
select 'ddddddd2-0000-4000-8000-000000000009'::uuid, r, c, k, now() - interval '20 hours' + (i * interval '1 minute')
from (values
  (1, 'bot'::public.chat_message_role,  'Ola! Sou o assistente da APCS. Posso te ajudar com o Centro de Servicos ao Produtor (CSP). Podemos continuar?', 'csp.greeting'),
  (2, 'user'::public.chat_message_role, 'Oi, pode sim', null),
  (3, 'bot'::public.chat_message_role,  'Otimo. Para comecar, qual e o seu nome completo?', 'csp.ask_name'),
  (4, 'user'::public.chat_message_role, 'Luciana Prado', null),
  (5, 'bot'::public.chat_message_role,  'Prazer, Luciana! De qual cidade voce fala?', 'csp.ask_city'),
  (6, 'user'::public.chat_message_role, 'Irati, PR', null),
  (7, 'bot'::public.chat_message_role,  'Sobre o que voce gostaria de saber: insumos, racao, logistica ou informacoes gerais?', 'csp.ask_interest'),
  (8, 'user'::public.chat_message_role, 'Queria entender melhor como funciona o CSP e quais servicos voces oferecem', null),
  (9, 'bot'::public.chat_message_role,  'Perfeito. Registrei seu contato e a equipe da APCS vai falar com voce pelo WhatsApp.', 'csp.wrap_up')
) as t(i, r, c, k);

insert into public.chat_messages (conversation_id, role, content, content_key, created_at)
select 'ddddddd2-0000-4000-8000-000000000011'::uuid, r, c, k, now() - interval '2 hours' + (i * interval '1 minute')
from (values
  (1, 'bot'::public.chat_message_role,  'Ola! Sou o assistente da APCS. Podemos continuar?', 'csp.greeting'),
  (2, 'user'::public.chat_message_role, 'Sim', null),
  (3, 'bot'::public.chat_message_role,  'Para comecar, qual e o seu nome completo?', 'csp.ask_name')
) as t(i, r, c, k);

-- ----------------------------------------------------------------------------
-- 3. Leads do CSP — o que a Dashboard e a tela de Leads mostram
-- ----------------------------------------------------------------------------
insert into public.csp_leads (id, conversation_id, contact_id, full_name, city, state, contact_profile, interest, volume_range, preferred_channel, preferred_time, phone, email, status, notes, created_at) values
  ('ddddddd3-0000-4000-8000-000000000001', 'ddddddd2-0000-4000-8000-000000000001', 'ddddddd1-0000-4000-8000-000000000001', 'Joana Ribeiro',   'Ponta Grossa',    'PR', 'producer', 'input',       'from_200_to_1000', 'whatsapp', 'morning',   '42999180011', 'joana.ribeiro@granjaboavista.com.br', 'qualified',  'Granja com 600 matrizes. Ja compra racao pelo CSP, quer cotar insumos veterinarios.', now() - interval '9 days'),
  ('ddddddd3-0000-4000-8000-000000000002', 'ddddddd2-0000-4000-8000-000000000002', 'ddddddd1-0000-4000-8000-000000000002', 'Carlos Menezes',  'Castro',          'PR', 'producer', 'feed',        'from_50_to_200',   'phone',    'afternoon', '42998740022', 'carlos@agromenezes.com.br',           'in_contact', 'Ligar depois das 14h. Pediu tabela de precos de racao inicial.', now() - interval '7 days'),
  ('ddddddd3-0000-4000-8000-000000000003', 'ddddddd2-0000-4000-8000-000000000003', 'ddddddd1-0000-4000-8000-000000000003', 'Fernanda Lopes',  'Toledo',          'PR', 'supplier', 'logistics',   'not_applicable',   'email',    'any',       '45999330033', 'fernanda.lopes@nutrisul.com.br',      'in_contact', 'Fornecedora de nutricao animal; quer ser homologada no CSP.', now() - interval '6 days'),
  ('ddddddd3-0000-4000-8000-000000000004', 'ddddddd2-0000-4000-8000-000000000004', 'ddddddd1-0000-4000-8000-000000000004', 'Ricardo Tanaka',  'Marechal Rondon', 'PR', 'producer', 'input',       'above_1000',       'whatsapp', 'evening',   '45998120044', 'ricardo.tanaka@granjatanaka.com.br',  'qualified',  'Maior volume da carteira. Reuniao marcada com o comercial.', now() - interval '5 days'),
  ('ddddddd3-0000-4000-8000-000000000005', 'ddddddd2-0000-4000-8000-000000000005', 'ddddddd1-0000-4000-8000-000000000005', 'Beatriz Almeida', 'Cascavel',        'PR', 'member',   'information', null,               'whatsapp', 'morning',   '45999560055', 'beatriz.almeida@cooperoeste.com.br',  'discarded',  'Ja e atendida pela cooperativa; sem interesse no momento.', now() - interval '4 days'),
  ('ddddddd3-0000-4000-8000-000000000006', 'ddddddd2-0000-4000-8000-000000000006', 'ddddddd1-0000-4000-8000-000000000006', 'Paulo Schneider', 'Palmeira',        'PR', 'producer', 'feed',        'from_50_to_200',   'whatsapp', 'afternoon', '42998330066', 'paulo.schneider@granjasp.com.br',     'in_contact', 'Enviou fotos das instalacoes. Aguardando proposta.', now() - interval '3 days'),
  ('ddddddd3-0000-4000-8000-000000000007', 'ddddddd2-0000-4000-8000-000000000007', 'ddddddd1-0000-4000-8000-000000000007', 'Marina Costa',    'Chapeco',         'SC', 'supplier', 'logistics',   'not_applicable',   'email',    'morning',   '49999470077', 'marina.costa@vetsuinos.com.br',       'new',        null, now() - interval '2 days'),
  ('ddddddd3-0000-4000-8000-000000000008', 'ddddddd2-0000-4000-8000-000000000008', 'ddddddd1-0000-4000-8000-000000000008', 'Eduardo Ferrari', 'Carambei',        'PR', 'producer', 'input',       'from_200_to_1000', 'whatsapp', 'any',       '42999650088', 'eduardo@granjaferrari.com.br',        'new',        null, now() - interval '1 day'),
  ('ddddddd3-0000-4000-8000-000000000009', 'ddddddd2-0000-4000-8000-000000000009', 'ddddddd1-0000-4000-8000-000000000009', 'Luciana Prado',   'Irati',           'PR', 'producer', 'information', 'up_to_50',         'whatsapp', 'morning',   '42998910099', 'luciana.prado@granjaprado.com.br',    'new',        null, now() - interval '20 hours'),
  ('ddddddd3-0000-4000-8000-000000000010', 'ddddddd2-0000-4000-8000-000000000010', 'ddddddd1-0000-4000-8000-000000000010', 'Anderson Vieira', 'Guarapuava',      'PR', 'member',   'feed',        'from_50_to_200',   'phone',    'afternoon', '42999120100', 'anderson.vieira@apcs-demo.com.br',    'new',        null, now() - interval '6 hours')
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 4. Associados
-- ----------------------------------------------------------------------------
insert into public.members (id, code, status, origin, profile_type, full_name, whatsapp, email, city, state, organization, farm_name, production_city, sow_count, cnpj, activity_area, job_title, legal_name, trade_name, interests, joined_at, notes, contact_id, created_at) values
  ('ddddddd4-0000-4000-8000-000000000001', 'APCS-0001', 'active',   'import',      'criador',      'Joana Ribeiro',      '42999180011', 'joana.ribeiro@granjaboavista.com.br', 'Ponta Grossa',    'PR', 'Granja Boa Vista',    'Granja Boa Vista',   'Ponta Grossa',    600,  null,             null, null, null, null, '{"Nutricao","Sanidade"}',        current_date - 1200, 'Associada desde a fundacao do nucleo regional.', 'ddddddd1-0000-4000-8000-000000000001', now() - interval '400 days'),
  ('ddddddd4-0000-4000-8000-000000000002', 'APCS-0002', 'active',   'import',      'criador',      'Ricardo Tanaka',     '45998120044', 'ricardo.tanaka@granjatanaka.com.br',  'Marechal Rondon', 'PR', 'Granja Tanaka',       'Granja Tanaka',      'Marechal Rondon', 1800, null,             null, null, null, null, '{"Mercado","Genetica"}',         current_date - 900,  null, 'ddddddd1-0000-4000-8000-000000000004', now() - interval '380 days'),
  ('ddddddd4-0000-4000-8000-000000000003', 'APCS-0003', 'active',   'import',      'tecnico',      'Beatriz Almeida',    '45999560055', 'beatriz.almeida@cooperoeste.com.br',  'Cascavel',        'PR', 'Cooper Oeste',        null,                 null,              null, null,             'Assistencia tecnica', 'Medica veterinaria', null, null, '{"Sanidade","Bem-estar animal"}', current_date - 700, null, 'ddddddd1-0000-4000-8000-000000000005', now() - interval '300 days'),
  ('ddddddd4-0000-4000-8000-000000000004', 'APCS-0004', 'active',   'import',      'empresa',      'Nutri Sul Alimentos','45999330033', 'contato@nutrisul.com.br',             'Toledo',          'PR', 'Nutri Sul',           null,                 null,              null, '12345678000199', null, null, 'Nutri Sul Alimentos Ltda', 'Nutri Sul', '{"Nutricao"}', current_date - 500, 'Fornecedora homologada.', 'ddddddd1-0000-4000-8000-000000000003', now() - interval '250 days'),
  ('ddddddd4-0000-4000-8000-000000000005', 'APCS-0005', 'inactive', 'import',      'criador',      'Paulo Schneider',    '42998330066', 'paulo.schneider@granjasp.com.br',     'Palmeira',        'PR', 'Granja SP',           'Granja Sao Paulo',   'Palmeira',        120,  null,             null, null, null, null, '{"Custo de producao"}',          current_date - 1500, 'Nao renovou a anuidade de 2025.', 'ddddddd1-0000-4000-8000-000000000006', now() - interval '600 days'),
  ('ddddddd4-0000-4000-8000-000000000006', 'APCS-0006', 'active',   'manual',      'criador',      'Eduardo Ferrari',    '42999650088', 'eduardo@granjaferrari.com.br',        'Carambei',        'PR', 'Granja Ferrari',      'Granja Ferrari',     'Carambei',        450,  null,             null, null, null, null, '{"Mercado","Nutricao"}',         current_date - 120,  null, 'ddddddd1-0000-4000-8000-000000000008', now() - interval '120 days'),
  ('ddddddd4-0000-4000-8000-000000000007', 'APCS-0007', 'suspended','import',      'tecnico',      'Anderson Vieira',    '42999120100', 'anderson.vieira@apcs-demo.com.br',    'Guarapuava',      'PR', 'Agro Vieira',         null,                 null,              null, null,             'Comercial', 'Consultor', null, null, '{"Mercado"}',                    current_date - 800,  'Vinculo suspenso a pedido do associado.', 'ddddddd1-0000-4000-8000-000000000010', now() - interval '350 days'),
  ('ddddddd4-0000-4000-8000-000000000008', 'APCS-0008', 'active',   'application', 'criador',      'Luciana Prado',      '42998910099', 'luciana.prado@granjaprado.com.br',    'Irati',           'PR', 'Granja Prado',        'Granja Prado',       'Irati',           45,   null,             null, null, null, null, '{"Sanidade"}',                   current_date - 10,   'Entrou pelo formulario do site.', 'ddddddd1-0000-4000-8000-000000000009', now() - interval '10 days')
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 5. Solicitacoes de associacao (a caixa de entrada publica)
-- ----------------------------------------------------------------------------
-- O trigger `membership_applications_guard` so aceita nascer em `pending`.
-- Os outros status vem dos UPDATEs abaixo, seguindo o grafo de transicoes.
insert into public.membership_applications (id, status, profile_type, full_name, whatsapp, email, city, state, organization, farm_name, production_city, sow_count, cnpj, activity_area, job_title, legal_name, trade_name, interests, consent_accepted, consent_at, consent_policy_version, dedupe_key, source_ip_hash, user_agent, created_at) values
  ('ddddddd5-0000-4000-8000-000000000001', 'pending', 'criador',      'Helena Bortolini',     '42998220011', 'helena.bortolini@granjahb.com.br', 'Ipiranga',     'PR', 'Granja HB',          'Granja HB',    'Ipiranga', 200,  null,             null,              null,          null,                         null,      '{"Nutricao","Mercado"}', true, now() - interval '4 hours',  '1', 'demo-dedupe-0001', 'demo-ip-21', 'Mozilla/5.0 (demo)', now() - interval '4 hours'),
  ('ddddddd5-0000-4000-8000-000000000002', 'pending', 'empresa',      'Sul Vet Distribuidora','45999880022', 'comercial@sulvet.com.br',          'Cascavel',     'PR', 'Sul Vet',            null,           null,       null, '98765432000155', null,              null,          'Sul Vet Distribuidora Ltda', 'Sul Vet', '{"Sanidade"}',           true, now() - interval '1 day',    '1', 'demo-dedupe-0002', 'demo-ip-22', 'Mozilla/5.0 (demo)', now() - interval '1 day'),
  ('ddddddd5-0000-4000-8000-000000000003', 'pending', 'tecnico',      'Tiago Marchi',         '42999770033', 'tiago.marchi@consultoria.com.br',  'Ponta Grossa', 'PR', 'Marchi Consultoria', null,           null,       null, null,             'Nutricao animal', 'Zootecnista', null,                         null,      '{"Nutricao"}',           true, now() - interval '2 days',   '1', 'demo-dedupe-0003', 'demo-ip-23', 'Mozilla/5.0 (demo)', now() - interval '2 days'),
  ('ddddddd5-0000-4000-8000-000000000004', 'pending', 'criador',      'Luciana Prado',        '42998910099', 'luciana.prado@granjaprado.com.br', 'Irati',        'PR', 'Granja Prado',       'Granja Prado', 'Irati',    45,   null,             null,              null,          null,                         null,      '{"Sanidade"}',           true, now() - interval '12 days',  '1', 'demo-dedupe-0004', 'demo-ip-24', 'Mozilla/5.0 (demo)', now() - interval '12 days'),
  ('ddddddd5-0000-4000-8000-000000000005', 'pending', 'tecnico',      'Marcos Aurelio Reis',  '41998660044', 'marcos.reis@exemplo.com.br',       'Curitiba',     'PR', null,                 null,           null,       null, null,             'Outro setor',     'Analista',    null,                         null,      '{}',                     true, now() - interval '15 days',  '1', 'demo-dedupe-0005', 'demo-ip-25', 'Mozilla/5.0 (demo)', now() - interval '15 days')
on conflict (id) do nothing;

-- Uma em analise.
update public.membership_applications set status = 'in_review'
where id = 'ddddddd5-0000-4000-8000-000000000003';

-- Uma aprovada (aponta para a associada APCS-0008, como o CHECK exige).
update public.membership_applications
set status = 'approved',
    member_id = 'ddddddd4-0000-4000-8000-000000000008',
    reviewed_at = now() - interval '11 days',
    review_note = 'Cadastro conferido; associada criada com o codigo APCS-0008.'
where id = 'ddddddd5-0000-4000-8000-000000000004';

-- Uma recusada.
update public.membership_applications
set status = 'rejected',
    reviewed_at = now() - interval '14 days',
    review_note = 'Atuacao fora da cadeia suinicola. Orientado a acompanhar os boletins publicos.'
where id = 'ddddddd5-0000-4000-8000-000000000005';

-- ----------------------------------------------------------------------------
-- 6. Palestras
-- ----------------------------------------------------------------------------
-- O trigger `lectures_guard` so aceita nascer em requested/planned/confirmed/held.
-- Os outros status sao alcancados pelos UPDATEs logo abaixo, seguindo o grafo.
insert into public.lectures (id, origin, name, theme, city, location, type, type_other, format, event_date, start_time, end_time, attendees_estimated, priority, status, notes, requester_contact_id, requester_name, requester_email, requester_phone, requester_organization, requested_at, created_at) values
  ('ddddddd6-0000-4000-8000-000000000001', 'chatbot',  'Palestra Sindicato Rural de Castro',  'Mercado de Suinos 2026',         'Castro',       'Sindicato Rural de Castro',   'associate',  null, 'in_person', current_date + 21, '14:00', '16:00', 80,  'high',   'confirmed', 'Sindicato pediu foco em projecao de precos.', 'ddddddd1-0000-4000-8000-000000000002', 'Carlos Menezes',  'carlos@agromenezes.com.br',           '42998740022', 'Sindicato Rural de Castro', now() - interval '18 days', now() - interval '18 days'),
  ('ddddddd6-0000-4000-8000-000000000002', 'internal', 'Custo de Producao na Pratica',        'Custo de Producao',              'Ponta Grossa', 'Centro de Convencoes APCS',   'company',    null, 'hybrid',    current_date + 35, '09:00', '12:00', 120, 'normal', 'planned',   'Transmissao online confirmada.', null, null, null, null, null, now() - interval '12 days', now() - interval '12 days'),
  ('ddddddd6-0000-4000-8000-000000000003', 'chatbot',  'Semana Academica de Zootecnia',       'Bem-estar Animal',               'Curitiba',     'UFPR - Campus Agrarias',      'university', null, 'in_person', current_date + 48, '19:00', '21:00', 200, 'normal', 'requested', 'Universidade pediu palestrante da APCS.', 'ddddddd1-0000-4000-8000-000000000007', 'Marina Costa',    'marina.costa@vetsuinos.com.br',       '49999470077', 'UFPR',                     now() - interval '3 days',  now() - interval '3 days'),
  ('ddddddd6-0000-4000-8000-000000000004', 'chatbot',  'Encontro de Produtores de Toledo',    'Nutricao e Racao',               'Toledo',       'Cooperativa Central',         'associate',  null, 'in_person', current_date + 60, '08:30', '11:30', 90,  'normal', 'requested', null, 'ddddddd1-0000-4000-8000-000000000003', 'Fernanda Lopes',  'fernanda.lopes@nutrisul.com.br',      '45999330033', 'Nutri Sul',                now() - interval '2 days',  now() - interval '2 days'),
  ('ddddddd6-0000-4000-8000-000000000005', 'chatbot',  'Feira Agro Guarapuava',               'Sanidade e Biosseguridade',      'Guarapuava',   'Parque de Exposicoes',        'other',      'Feira agropecuaria', 'in_person', current_date + 75, '15:00', '17:00', 150, 'urgent', 'requested', 'Organizacao quer confirmacao ate sexta.', 'ddddddd1-0000-4000-8000-000000000010', 'Anderson Vieira', 'anderson.vieira@apcs-demo.com.br',    '42999120100', 'Agro Vieira',              now() - interval '1 day',   now() - interval '1 day'),
  ('ddddddd6-0000-4000-8000-000000000006', 'internal', 'Genetica Aplicada a Suinocultura',    'Genetica',                       'Cascavel',     'Auditorio Cooper Oeste',      'company',    null, 'online',    current_date + 14, '10:00', '11:30', 60,  'normal', 'planned',   null, null, null, null, null, null, now() - interval '9 days',  now() - interval '9 days'),
  ('ddddddd6-0000-4000-8000-000000000007', 'internal', 'Panorama do Mercado - 1o Semestre',   'Mercado de Suinos',              'Ponta Grossa', 'Centro de Convencoes APCS',   'company',    null, 'in_person', current_date - 20, '14:00', '16:00', 100, 'normal', 'held',      null, null, null, null, null, null, now() - interval '70 days', now() - interval '70 days'),
  ('ddddddd6-0000-4000-8000-000000000008', 'chatbot',  'Dia de Campo em Palmeira',            'Manejo Sanitario',               'Palmeira',     'Granja Sao Paulo',            'associate',  null, 'in_person', current_date - 45, '09:00', '12:00', 50,  'low',    'held',      null, 'ddddddd1-0000-4000-8000-000000000006', 'Paulo Schneider', 'paulo.schneider@granjasp.com.br',     '42998330066', 'Granja SP',                now() - interval '100 days',now() - interval '100 days'),
  ('ddddddd6-0000-4000-8000-000000000009', 'chatbot',  'Workshop de Ambiencia',               'Ambiencia e Instalacoes',        'Irati',        'Granja Prado',                'associate',  null, 'in_person', current_date + 90, '13:30', '16:00', 40,  'normal', 'requested', null, 'ddddddd1-0000-4000-8000-000000000009', 'Luciana Prado',   'luciana.prado@granjaprado.com.br',    '42998910099', 'Granja Prado',             now() - interval '5 days',  now() - interval '5 days'),
  ('ddddddd6-0000-4000-8000-000000000010', 'chatbot',  'Palestra Escola Tecnica Carambei',    'Carreira na Suinocultura',       'Carambei',     'Escola Tecnica',              'university', null, 'in_person', current_date + 30, '19:30', '21:00', 70,  'low',    'requested', null, 'ddddddd1-0000-4000-8000-000000000008', 'Eduardo Ferrari', 'eduardo@granjaferrari.com.br',        '42999650088', 'Escola Tecnica Carambei',  now() - interval '6 days',  now() - interval '6 days')
on conflict (id) do nothing;

-- Resultado das duas ja realizadas.
update public.lectures
set held_at = event_date, attendees_actual = 92, outcome_notes = 'Sala cheia. Pedido de repeticao no segundo semestre.'
where id = 'ddddddd6-0000-4000-8000-000000000007';

update public.lectures
set held_at = event_date, attendees_actual = 38, outcome_notes = 'Chuva reduziu o publico previsto.'
where id = 'ddddddd6-0000-4000-8000-000000000008';

-- Caminha pelo grafo para ter uma EM ANALISE, uma APROVADA, uma REJEITADA e uma CANCELADA.
update public.lectures set status = 'under_review' where id = 'ddddddd6-0000-4000-8000-000000000003';

update public.lectures set status = 'under_review' where id = 'ddddddd6-0000-4000-8000-000000000004';
update public.lectures set status = 'approved'     where id = 'ddddddd6-0000-4000-8000-000000000004';

update public.lectures set status = 'under_review' where id = 'ddddddd6-0000-4000-8000-000000000010';
update public.lectures set status = 'rejected', rejection_reason = 'Data conflita com a assembleia anual. Sugerido remarcar para marco.'
where id = 'ddddddd6-0000-4000-8000-000000000010';

update public.lectures set status = 'cancelled', cancellation_reason = 'Solicitante desistiu; evento adiado pela organizacao.'
where id = 'ddddddd6-0000-4000-8000-000000000009';

-- Responsavel e palestrante: usa o primeiro perfil admin/ceo que existir.
update public.lectures l
set responsible_id = p.id, speaker_id = p.id
from (select id from public.profiles where role in ('admin', 'ceo') order by created_at limit 1) p
where l.id::text like 'ddddddd6-%'
  and l.status in ('planned', 'confirmed', 'held');

-- ----------------------------------------------------------------------------
-- 7. Caixa de entrada do WhatsApp
-- ----------------------------------------------------------------------------
insert into public.whatsapp_chats (id, provider, chat_key, phone, is_group, name, contact_id, member_id, unread_count, archived, last_message_at, last_message_preview, last_message_from_me, created_at) values
  ('ddddddd7-0000-4000-8000-000000000001', 'zapi', '554299180011', '554299180011', false, 'Joana Ribeiro',   'ddddddd1-0000-4000-8000-000000000001', 'ddddddd4-0000-4000-8000-000000000001', 2, false, now() - interval '18 minutes', 'Consegue me mandar a cotacao ainda hoje?',            false, now() - interval '30 days'),
  ('ddddddd7-0000-4000-8000-000000000002', 'zapi', '554299650088', '554299650088', false, 'Eduardo Ferrari', 'ddddddd1-0000-4000-8000-000000000008', 'ddddddd4-0000-4000-8000-000000000006', 1, false, now() - interval '1 hour',      'Bom dia! Chegou o boletim de mercado desta semana?',  false, now() - interval '20 days'),
  ('ddddddd7-0000-4000-8000-000000000003', 'zapi', '554598120044', '554598120044', false, 'Ricardo Tanaka',  'ddddddd1-0000-4000-8000-000000000004', 'ddddddd4-0000-4000-8000-000000000002', 0, false, now() - interval '3 hours',     'Perfeito, obrigado! Ate quinta.',                     false, now() - interval '45 days'),
  ('ddddddd7-0000-4000-8000-000000000004', 'zapi', '554299870099', '554299870099', false, 'Luciana Prado',   'ddddddd1-0000-4000-8000-000000000009', 'ddddddd4-0000-4000-8000-000000000008', 0, false, now() - interval '5 hours',     'Enviamos o material do CSP no seu e-mail.',           true,  now() - interval '12 days'),
  ('ddddddd7-0000-4000-8000-000000000005', 'zapi', '554999470077', '554999470077', false, 'Marina Costa',    'ddddddd1-0000-4000-8000-000000000007', null,                                    3, false, now() - interval '25 minutes',  'Oi! Sou fornecedora e queria falar sobre homologacao', false, now() - interval '2 days'),
  ('ddddddd7-0000-4000-8000-000000000006', 'zapi', '120363000000000001@g.us', null,  true,  'Nucleo Campos Gerais', null,                              null,                                    0, false, now() - interval '8 hours',     'Pessoal, reuniao confirmada para terca as 9h.',       false, now() - interval '90 days'),
  ('ddddddd7-0000-4000-8000-000000000007', 'zapi', '554298330066', '554298330066', false, 'Paulo Schneider', 'ddddddd1-0000-4000-8000-000000000006', 'ddddddd4-0000-4000-8000-000000000005', 0, true,  now() - interval '9 days',      'Obrigado pelo retorno.',                              false, now() - interval '60 days')
on conflict (id) do nothing;

insert into public.whatsapp_messages (chat_id, provider, provider_message_id, direction, origin, kind, body, sender_name, status, occurred_at, delivered_at, read_at, created_at)
select 'ddddddd7-0000-4000-8000-000000000001'::uuid, 'zapi', 'demo-msg-001-' || i, d, o, 'text', b, s, st, now() - interval '2 hours' + (i * interval '6 minutes'), now() - interval '2 hours' + (i * interval '6 minutes'), null, now() - interval '2 hours' + (i * interval '6 minutes')
from (values
  (1, 'inbound'::public.whatsapp_direction,  'contact'::public.whatsapp_message_origin, 'Bom dia! Aqui e a Joana da Granja Boa Vista.',              'Joana Ribeiro', 'read'::public.whatsapp_delivery_status),
  (2, 'outbound'::public.whatsapp_direction, 'agent'::public.whatsapp_message_origin,   'Bom dia, Joana! Tudo bem? Como posso ajudar?',              null,            'read'::public.whatsapp_delivery_status),
  (3, 'inbound'::public.whatsapp_direction,  'contact'::public.whatsapp_message_origin, 'Preciso de uma cotacao de vacina para o proximo lote.',      'Joana Ribeiro', 'read'::public.whatsapp_delivery_status),
  (4, 'outbound'::public.whatsapp_direction, 'agent'::public.whatsapp_message_origin,   'Claro! Vou levantar com o CSP e te retorno ainda hoje.',     null,            'read'::public.whatsapp_delivery_status),
  (5, 'inbound'::public.whatsapp_direction,  'contact'::public.whatsapp_message_origin, 'Sao 600 matrizes, mesmo esquema do ano passado.',            'Joana Ribeiro', 'delivered'::public.whatsapp_delivery_status),
  (6, 'inbound'::public.whatsapp_direction,  'contact'::public.whatsapp_message_origin, 'Consegue me mandar a cotacao ainda hoje?',                   'Joana Ribeiro', 'delivered'::public.whatsapp_delivery_status)
) as t(i, d, o, b, s, st);

insert into public.whatsapp_messages (chat_id, provider, provider_message_id, direction, origin, kind, body, sender_name, status, occurred_at, created_at) values
  ('ddddddd7-0000-4000-8000-000000000002', 'zapi', 'demo-msg-002-1', 'inbound',  'contact', 'text', 'Bom dia! Chegou o boletim de mercado desta semana?',   'Eduardo Ferrari', 'delivered', now() - interval '1 hour',      now() - interval '1 hour'),
  ('ddddddd7-0000-4000-8000-000000000003', 'zapi', 'demo-msg-003-1', 'outbound', 'agent',   'text', 'Ricardo, a reuniao ficou para quinta as 10h, ok?',    null,              'read',      now() - interval '4 hours',     now() - interval '4 hours'),
  ('ddddddd7-0000-4000-8000-000000000003', 'zapi', 'demo-msg-003-2', 'inbound',  'contact', 'text', 'Perfeito, obrigado! Ate quinta.',                     'Ricardo Tanaka',  'read',      now() - interval '3 hours',     now() - interval '3 hours'),
  ('ddddddd7-0000-4000-8000-000000000004', 'zapi', 'demo-msg-004-1', 'outbound', 'bot',     'text', 'Enviamos o material do CSP no seu e-mail.',           null,              'read',      now() - interval '5 hours',     now() - interval '5 hours'),
  ('ddddddd7-0000-4000-8000-000000000005', 'zapi', 'demo-msg-005-1', 'inbound',  'contact', 'text', 'Oi! Sou fornecedora e queria falar sobre homologacao','Marina Costa',    'delivered', now() - interval '25 minutes',  now() - interval '25 minutes'),
  ('ddddddd7-0000-4000-8000-000000000006', 'zapi', 'demo-msg-006-1', 'inbound',  'contact', 'text', 'Pessoal, reuniao confirmada para terca as 9h.',       'Anderson Vieira', 'delivered', now() - interval '8 hours',     now() - interval '8 hours'),
  ('ddddddd7-0000-4000-8000-000000000007', 'zapi', 'demo-msg-007-1', 'inbound',  'contact', 'text', 'Obrigado pelo retorno.',                              'Paulo Schneider', 'read',      now() - interval '9 days',      now() - interval '9 days')
on conflict do nothing;

commit;

-- ============================================================================
-- Conferencia rapida
-- ============================================================================
select 'leads' as tabela, count(*) from public.csp_leads
union all select 'conversas',    count(*) from public.chat_conversations
union all select 'associados',   count(*) from public.members
union all select 'solicitacoes', count(*) from public.membership_applications
union all select 'palestras',    count(*) from public.lectures
union all select 'whatsapp',     count(*) from public.whatsapp_chats;
