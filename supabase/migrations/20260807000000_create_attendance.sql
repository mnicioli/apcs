-- ============================================================================
-- Central de Atendimento — camada humana sobre as conversas do chat
-- ----------------------------------------------------------------------------
-- Módulo 17 do roadmap (ver docs/ROADMAP.md). Hoje só existe visibilidade das
-- conversas que viraram lead: quem parou no meio da triagem, quem pediu para
-- falar com uma pessoa ou quem bateu no limite de mensagens é INVISÍVEL para o
-- time. Esta migration cria o estado do atendimento humano sobre a conversa.
--
-- POR QUE COLUNAS NOVAS E NÃO UM STATUS A MAIS EM `chat_conversation_status`:
--   `status` descreve o que o BOT fez com a conversa (triagem concluída,
--   encaminhada, recusada). Marcar um encaminhamento como 'completed' porque
--   uma pessoa ligou de volta faria o banco AFIRMAR algo falso sobre a triagem.
--   São duas dimensões independentes — e ficam em campos independentes.
--
-- O QUE ESTA MIGRATION NÃO FAZ: não existe resposta do operador dentro do chat.
--   Isso exigiria um papel novo em `chat_message_role`, afrouxar a constraint
--   `chat_messages_bot_has_key` e pausar o bot — outro módulo, outra migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Estado do atendimento humano
-- ----------------------------------------------------------------------------
alter table public.chat_conversations
  -- Referencia `profiles` (e não `auth.users`) de propósito: com a FK apontando
  -- para uma tabela do schema `public`, o PostgREST consegue embutir o nome de
  -- quem assumiu numa consulta só, sem uma segunda ida ao banco.
  add column assigned_to uuid references public.profiles on delete set null,
  add column assigned_at timestamptz,
  add column resolved_at timestamptz,
  add column internal_notes text,
  -- Teto igual ao do Zod do formulário. Sem ele, uma coluna `text` sem limite
  -- escrita por usuário autenticado é um convite a encher a tabela.
  add constraint chat_conversations_internal_notes_len
    check (internal_notes is null or char_length(internal_notes) <= 2000);

comment on column public.chat_conversations.assigned_to is
  'Quem assumiu o atendimento humano desta conversa.';
comment on column public.chat_conversations.resolved_at is
  'Quando o atendimento humano foi encerrado. Nulo = ainda na fila.';
comment on column public.chat_conversations.internal_notes is
  'Anotação interna do time. NUNCA é exibida para o visitante do chat.';

-- A fila é sempre "o que ainda não foi resolvido, mais recente primeiro".
-- Índice parcial: só indexa as linhas abertas, que é a fração que a tela lê.
create index chat_conversations_open_attendance_idx
  on public.chat_conversations (last_message_at desc)
  where resolved_at is null;

-- ----------------------------------------------------------------------------
-- 2. Escrita do backoffice
-- ----------------------------------------------------------------------------
-- Espelha `attendances.write` em src/lib/rbac/rbac.config.ts — os mesmos papéis
-- que gerenciam leads gerenciam a fila. As duas camadas contam a mesma história.
create policy "chat_conversations_update_attendance"
  on public.chat_conversations for update
  using (public.current_app_role() in ('admin', 'comercial'))
  with check (public.current_app_role() in ('admin', 'comercial'));

-- RLS filtra LINHA, não COLUNA. Sem o grant abaixo, um `comercial` poderia
-- chamar o PostgREST com o próprio JWT e reescrever `collected`, `status` ou o
-- `session_token_hash` da conversa — a policy deixaria passar. O atendimento só
-- mexe no seu próprio estado; o banco passa a impor exatamente isso.
--
-- `status` fica DE FORA da lista de propósito: quem decide o estado da conversa
-- é o motor do chat, nunca a tela.
revoke update on public.chat_conversations from authenticated;
grant update (assigned_to, assigned_at, resolved_at, internal_notes)
  on public.chat_conversations to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Quem está com cada atendimento
-- ----------------------------------------------------------------------------
-- Até aqui, `profiles` só permitia ler o PRÓPRIO perfil (ou tudo, se admin).
-- Numa central de atendimento isso quebra a coordenação básica: "em atendimento
-- com quem?" ficaria em branco, e duas pessoas ligariam para o mesmo produtor.
--
-- A liberação é para os MESMOS papéis que já leem as conversas inteiras e os
-- leads — ou seja, quem já enxerga telefone e transcrição de produtor. Ver o
-- nome e o papel de um colega é estritamente menos sensível do que isso.
create policy "profiles_select_team"
  on public.profiles for select
  using (public.current_app_role() in ('admin', 'ceo', 'comercial'));
