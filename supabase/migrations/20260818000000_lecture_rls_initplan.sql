-- ============================================================================
-- Palestras — a policy chamava `current_app_role()` UMA VEZ POR LINHA
-- ----------------------------------------------------------------------------
-- ACHADO DO QA DE PERFORMANCE (§61, §62), com 20.000 palestras no banco:
--
--   contagem exata da grid ....... 376 ms  →   6,4 ms
--   grid, página 1 ............... 389 ms  →  13,4 ms
--   contador do menu ............. 377 ms  →   8,8 ms
--   calendário do ano inteiro .... 128 ms  →   5,8 ms
--
-- A pista foi o custo ser o MESMO (~380 ms) em consultas que fazem coisas
-- completamente diferentes — contar, ordenar, filtrar. Custo constante por
-- linha, não por trabalho: a assinatura de uma função chamada em laço.
--
-- ⚠️ A FUNÇÃO JÁ ERA `STABLE`, e isso NÃO BASTA — é a parte contraintuitiva.
--
-- `STABLE` autoriza o Postgres a reaproveitar o resultado dentro da consulta;
-- não o obriga. Numa cláusula `USING`, a chamada fica no filtro da varredura e é
-- avaliada para cada linha candidata. Embrulhá-la num SUBSELECT ESCALAR —
-- `(select public.current_app_role())` — a transforma num InitPlan: um nó
-- calculado UMA vez, antes da varredura começar. Dá para conferir no
-- `explain`: onde antes não havia InitPlan, agora aparece `InitPlan 1`.
--
-- É a mesma pegadinha que a documentação do Supabase descreve para `auth.uid()`.
-- `current_actor_name()` neste projeto já usa `(select auth.uid())` por dentro;
-- o que faltava era o mesmo cuidado do lado das POLICIES.
--
-- ⚠️ A LÓGICA NÃO MUDA — nem um papel a mais, nem um a menos. Conferido no mesmo
-- teste: com a policy nova, `viewer` continua vendo 0 linhas e o Atendente
-- continua vendo todas. Uma otimização de RLS que mexesse em quem vê o quê não
-- seria uma otimização.
--
-- ⚠️ ESCOPO: só as policies de PALESTRAS. As tabelas de Eventos, Bolsa,
-- Documentos, Chat e `profiles` têm exatamente o mesmo padrão e o mesmo custo —
-- medido, não suposto. Não são deste módulo e estão registradas em
-- docs/PALESTRAS.md como sugestão, com os números. Corrigir módulo alheio numa
-- entrega de QA de Palestras seria alterar o que ninguém pediu.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- lectures
-- ----------------------------------------------------------------------------
drop policy "lectures_select" on public.lectures;
create policy "lectures_select"
  on public.lectures for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

-- ⚠️ `origin = 'internal'` no WITH CHECK continua sendo o que impede um admin de
-- FORJAR uma solicitação de chatbot. `created_by = (select auth.uid())` compara
-- coluna com valor — a coluna varia por linha, o valor não, e por isso só o lado
-- constante é embrulhado.
drop policy "lectures_insert" on public.lectures;
create policy "lectures_insert"
  on public.lectures for insert
  with check (
    (select public.current_app_role()) in ('admin', 'ceo')
    and created_by = (select auth.uid())
    and origin = 'internal'
  );

drop policy "lectures_update" on public.lectures;
create policy "lectures_update"
  on public.lectures for update
  using ((select public.current_app_role()) in ('admin', 'ceo'))
  with check (
    (select public.current_app_role()) in ('admin', 'ceo')
    and updated_by = (select auth.uid())
  );

-- ----------------------------------------------------------------------------
-- lecture_status_transitions
-- ----------------------------------------------------------------------------
-- Quinze linhas hoje, e ainda assim vale: a tela lê o grafo a cada abertura de
-- diálogo de situação, e o padrão precisa ser o mesmo em todo o módulo para não
-- virar "aqui a gente lembrou, ali não".
drop policy "lecture_status_transitions_select" on public.lecture_status_transitions;
create policy "lecture_status_transitions_select"
  on public.lecture_status_transitions for select
  using ((select public.current_app_role()) in ('admin', 'ceo', 'comercial'));

-- ----------------------------------------------------------------------------
-- lecture_audit_logs
-- ----------------------------------------------------------------------------
-- Esta é a que mais cresce: uma palestra movimentada gera dez linhas, e a tela
-- de detalhe lê até 200 de uma vez.
drop policy "lecture_audit_logs_select" on public.lecture_audit_logs;
create policy "lecture_audit_logs_select"
  on public.lecture_audit_logs for select
  using ((select public.current_app_role()) in ('admin', 'ceo'));

drop policy "lecture_audit_logs_insert" on public.lecture_audit_logs;
create policy "lecture_audit_logs_insert"
  on public.lecture_audit_logs for insert
  with check (
    (select public.current_app_role()) in ('admin', 'ceo')
    and actor_id = (select auth.uid())
  );

-- ----------------------------------------------------------------------------
-- profiles_select_directory
-- ----------------------------------------------------------------------------
-- Criada pela migration de Palestras, então é responsabilidade deste módulo
-- consertá-la. As DEMAIS policies de `profiles` não são tocadas.
--
-- Esta é a mais cara de todas em efeito colateral: `profiles` é lida em TODA
-- navegação (para montar o cabeçalho) e em todo embed de autoria da grid.
drop policy "profiles_select_directory" on public.profiles;
create policy "profiles_select_directory"
  on public.profiles for select
  using (
    (select public.current_app_role())
      in ('admin', 'ceo', 'comercial', 'pm', 'tech_lead', 'financeiro')
  );

comment on policy "profiles_select_directory" on public.profiles is
  'Diretório interno: quem tem papel operacional vê os colegas, para atribuir responsáveis e exibir autorias.';

-- ----------------------------------------------------------------------------
-- Índice para a ordenação padrão da grid
-- ----------------------------------------------------------------------------
-- O §35 manda ordenar por data da solicitação, e é a ordenação PADRÃO da tela.
-- Os índices existentes cobrem `(status, requested_at desc)` e
-- `(event_date, start_time)`; nenhum serve para "ordene tudo por data da
-- solicitação", que é o caso mais comum — abrir a tela.
--
-- `id` como segunda coluna porque o desempate da listagem é `requested_at desc,
-- id asc`: sem ele o índice ordena até a primeira coluna e o Postgres ainda
-- precisa reordenar cada bloco de empates.
create index lectures_requested_at_idx
  on public.lectures (requested_at desc, id asc);
