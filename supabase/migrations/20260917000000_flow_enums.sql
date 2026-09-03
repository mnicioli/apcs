-- ============================================================================
-- Os tipos dos FLUXOS DE ATENDIMENTO
-- ============================================================================
--
-- ⚠️ ARQUIVO SEPARADO PELO MESMO MOTIVO DE SEMPRE: o Postgres não deixa USAR um
-- valor de enum na mesma transação em que ele foi acrescentado por
-- `alter type ... add value`, e a migration seguinte usa os quinze verbos de
-- auditoria abaixo dentro de gatilhos e funções. Juntar os dois arquivos faz o
-- `create function` falhar com "unsafe use of new value of enum type".
--
-- É a mesma lição de `20260913000000_knowledge_enums.sql` e de
-- `20260910000000_admin_audit_enum_repair.sql`, e ela já custou um defeito em
-- produção: o PL/pgSQL só planeja um comando na PRIMEIRA vez que ele executa,
-- então um `create function` que menciona um valor inexistente passa limpo na
-- migration e só quebra no dia em que alguém clica no botão.
--
-- DEPENDE DE: 20260830100000_admin_module.sql (admin_audit_action)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. O canal do fluxo
-- ----------------------------------------------------------------------------
-- ⚠️ ENUM COM DOIS VALORES DESDE O PRIMEIRO DIA, e não uma coluna `text` livre
-- nem um `default 'whatsapp'` sozinho. O requisito é explícito: não hardcodar
-- WhatsApp como único canal na estrutura.
--
-- `web` já existe como valor mesmo sem tela: ele é o que impede alguém de
-- resolver o segundo canal com um booleano `is_whatsapp`, que é a forma que a
-- pressa costuma tomar. Acrescentar um terceiro canal é uma linha
-- (`alter type ... add value`) — e continua exigindo o arquivo de enums
-- separado, como este.
create type public.flow_channel as enum ('whatsapp', 'web');

comment on type public.flow_channel is
  'Canal em que o fluxo roda. Existe com dois valores desde o inicio para que o segundo canal nao vire um booleano.';


-- ----------------------------------------------------------------------------
-- 2. O interruptor do fluxo — ATIVO / INATIVO
-- ----------------------------------------------------------------------------
-- ⚠️ ISTO É DO FLUXO, NÃO DA VERSÃO, e a separação é a decisão mais importante
-- deste par de migrations.
--
-- O ciclo de vida pedido (RASCUNHO → EM_TESTE → AGUARDANDO_APROVAÇÃO →
-- PUBLICADO → ATIVO → INATIVO) mistura duas coisas de naturezas diferentes:
--
--   • O que acontece com um DESENHO até ele valer          → versão
--   • Se a APCS quer o fluxo atendendo AGORA               → fluxo
--
-- Se "inativar" fosse um estado da VERSÃO, desligar o fluxo por uma tarde
-- ESCREVERIA numa versão publicada — e o §22 diz que versão publicada é
-- imutável. Seria a regra mais importante do módulo sendo quebrada pelo botão
-- mais banal dele.
--
-- Com o interruptor no fluxo, desligar não toca em versão nenhuma: o histórico
-- fica intacto e o motor simplesmente não entra.
create type public.flow_status as enum ('active', 'inactive');

comment on type public.flow_status is
  'Interruptor operacional do fluxo. Desligar NAO altera versao nenhuma — versao publicada e imutavel (§22).';


-- ----------------------------------------------------------------------------
-- 3. O ciclo de vida de uma VERSÃO
-- ----------------------------------------------------------------------------
-- ⚠️ `superseded` É O "INATIVA" DO §22, E O NOME IMPORTA. A versão que deixou de
-- valer não foi desligada por ninguém: ela foi SUBSTITUÍDA por outra. Chamá-la
-- de "inativa" faria parecer que existe um botão para reativá-la — e não
-- existe: o caminho de volta é publicar de novo (§23), que é uma publicação
-- controlada, com trilha própria, e não a reversão de um interruptor.
--
-- ⚠️ NÃO EXISTE VALOR "ATIVA". Publicada É a que vale — e o índice único
-- parcial da migration seguinte garante uma só por fluxo. Um segundo valor para
-- dizer a mesma coisa criaria o estado impossível "publicada e não ativa", que
-- alguém teria de decidir como tratar em cada consulta.
create type public.flow_version_status as enum (
  'draft',            -- RASCUNHO — a unica situacao em que se edita
  'testing',          -- EM_TESTE
  'pending_approval', -- AGUARDANDO_APROVACAO
  'approved',         -- aprovada, ainda nao publicada
  'published',        -- PUBLICADA — no maximo uma por fluxo
  'superseded'        -- foi publicada e outra tomou o lugar
);

comment on type public.flow_version_status is
  'Ciclo de vida de uma versao. `published` e a que vale (uma por fluxo); `superseded` e a que foi substituida.';


-- ----------------------------------------------------------------------------
-- 4. Os tipos de nó
-- ----------------------------------------------------------------------------
-- Os seis do escopo. O nó INICIAL não é um tipo: é a propriedade `is_start` de
-- um nó qualquer — porque na prática o início de um fluxo é uma MENSAGEM de
-- boas-vindas ou uma PERGUNTA, e um tipo `start` obrigaria todo fluxo a
-- começar com um nó que não faz nada.
create type public.flow_node_type as enum (
  'message',   -- envia uma mensagem e segue
  'question',  -- pergunta e ESPERA resposta
  'condition', -- avalia e escolhe o caminho
  'action',    -- executa uma acao de negocio (registry no TypeScript)
  'attendant', -- transfere para um TIME
  'end'        -- encerra a execucao
);

comment on type public.flow_node_type is
  'Os seis tipos de no. O no inicial nao e um tipo: e a propriedade is_start (§20).';


-- ----------------------------------------------------------------------------
-- 5. A situação de uma EXECUÇÃO
-- ----------------------------------------------------------------------------
-- ⚠️ NÃO CONFUNDIR COM O ITEM 6 — o §13 do escopo existe só para isto.
--
-- Este enum responde "o motor está andando?". O do item 6 responde "como está o
-- atendimento?". Uma execução pode estar `waiting_reply` (o motor parou num nó
-- QUESTION) enquanto a conversa está em `triage`; e pode estar `handed_off` (o
-- motor saiu de cena) enquanto a conversa está `in_service`.
--
-- Juntar os dois num enum só produziria valores como
-- "aguardando_resposta_em_atendimento", e a primeira pergunta de suporte ("o
-- robô travou ou a pessoa está com alguém?") deixaria de ter resposta.
create type public.flow_run_status as enum (
  'running',       -- o motor esta executando nos
  'waiting_reply', -- parou num QUESTION e espera a pessoa
  'handed_off',    -- entregue a um time humano; o motor saiu
  'completed',     -- chegou a um no END
  'failed',        -- erro na execucao
  'cancelled'      -- interrompida (fluxo despublicado, conversa arquivada)
);

comment on type public.flow_run_status is
  'Situacao do MOTOR numa execucao. Nao confundir com flow_conversation_status, que e a situacao do ATENDIMENTO (§13).';


-- ----------------------------------------------------------------------------
-- 6. A situação do ATENDIMENTO
-- ----------------------------------------------------------------------------
-- Os sete estados do §13, na ordem em que uma conversa costuma percorrê-los.
create type public.flow_conversation_status as enum (
  'new',
  'triage',
  'waiting_reply',
  'in_service',
  'waiting_customer',
  'resolved',
  'closed'
);

comment on type public.flow_conversation_status is
  'Situacao do ATENDIMENTO (§13). Independente de flow_run_status, que e a situacao do motor.';


-- ----------------------------------------------------------------------------
-- 7. O estado de um time de atendimento
-- ----------------------------------------------------------------------------
-- ⚠️ TIPO PRÓPRIO, MESMO SENDO IGUAL A `flow_status`. É a mesma decisão que
-- `knowledge_status` tomou diante de `document_version_status`: reaproveitar
-- amarraria os dois. O dia em que um time precisar de um terceiro estado ("em
-- férias coletivas", por exemplo), o `alter type` cairia sobre os fluxos junto.
create type public.attendance_team_status as enum ('active', 'inactive');

comment on type public.attendance_team_status is
  'Estado de um time. Time inativo nao recebe transferencia nova; as ja feitas continuam de pe.';


-- ----------------------------------------------------------------------------
-- 8. Os verbos novos da trilha da Administração (§17)
-- ----------------------------------------------------------------------------
-- ⚠️ CADA VERBO É UMA PERGUNTA QUE A TRILHA PRECISA RESPONDER FILTRANDO, e não
-- lendo o `metadata` de cada linha. "Quem publicou a versão que está no ar?" e
-- "quem desligou o fluxo ontem?" são perguntas diferentes, feitas por pessoas
-- diferentes, com pressa — e um `flow_updated` genérico com um campo no jsonb
-- transformaria as duas numa varredura.
--
-- `if not exists` porque `alter type ... add value` não é idempotente sozinho, e
-- uma migration que já rodou não pode falhar ao rodar de novo.
alter type public.admin_audit_action add value if not exists 'flow_created';
alter type public.admin_audit_action add value if not exists 'flow_updated';
alter type public.admin_audit_action add value if not exists 'flow_deleted';
alter type public.admin_audit_action add value if not exists 'flow_activated';
alter type public.admin_audit_action add value if not exists 'flow_deactivated';
alter type public.admin_audit_action add value if not exists 'flow_version_created';
alter type public.admin_audit_action add value if not exists 'flow_version_updated';
alter type public.admin_audit_action add value if not exists 'flow_version_tested';
alter type public.admin_audit_action add value if not exists 'flow_version_submitted';
alter type public.admin_audit_action add value if not exists 'flow_version_approved';
alter type public.admin_audit_action add value if not exists 'flow_version_published';
alter type public.admin_audit_action add value if not exists 'flow_version_rolled_back';
alter type public.admin_audit_action add value if not exists 'flow_node_changed';
alter type public.admin_audit_action add value if not exists 'flow_transition_changed';
alter type public.admin_audit_action add value if not exists 'flow_team_changed';


-- ============================================================================
-- ROLLBACK (manual)
-- ----------------------------------------------------------------------------
--   drop type if exists public.flow_channel;
--   drop type if exists public.flow_status;
--   drop type if exists public.flow_version_status;
--   drop type if exists public.flow_node_type;
--   drop type if exists public.flow_run_status;
--   drop type if exists public.flow_conversation_status;
--   drop type if exists public.attendance_team_status;
--   -- Os valores de `admin_audit_action` NAO sao removiveis: o Postgres nao sabe
--   -- tirar valor de enum, e a trilha ja gravada aponta para eles. Ficam
--   -- inertes, como 'ceo' em `app_role` (ver 20260902000000_retire_roles.sql).
-- ============================================================================
