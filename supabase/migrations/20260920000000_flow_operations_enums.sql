-- ============================================================================
-- FLUXOS — OPERAÇÃO: os verbos de auditoria que faltavam
-- ============================================================================
--
-- ⚠️ ARQUIVO SEPARADO, E O MOTIVO É O POSTGRES. `alter type ... add value` não
-- pode ser usado na MESMA transação em que o valor novo é USADO. Cada migration
-- do Supabase roda numa transação; então acrescentar o verbo aqui e gravá-lo em
-- 20260920000100 é a única ordem que funciona.
--
-- É o mesmo par que 20260917000000 (enums) e 20260917000100 (tabelas) já fez.
-- Quem juntar os dois arquivos vai receber
-- "unsafe use of new value of enum type" na primeira execução.
--
-- ----------------------------------------------------------------------------
-- ⚠️ POR QUE DOIS VERBOS NOVOS, E NÃO UM CAMPO NO JSONB
-- ----------------------------------------------------------------------------
-- A tentação era gravar reprovação como `flow_version_updated` com
-- `{motivo: "..."}` no metadata — sem migration, sem enum novo.
--
-- Não serve, e a razão é a pergunta que a trilha precisa responder: "quantas
-- versões foram REPROVADAS neste trimestre?". Com o verbo genérico, essa
-- consulta vira um `where metadata ? 'motivo'` — um filtro sobre a FORMA do
-- jsonb, que quebra silenciosamente no dia em que alguém gravar `motivo` noutro
-- contexto. Reprovar é um ato distinto de "editar", e a trilha o registra assim.
--
-- É a mesma decisão que 20260917000000 tomou ao recusar um `flow_updated`
-- genérico para quinze operações diferentes.
-- ============================================================================

-- §22. A reprovação, com motivo. Distinta de "voltou para rascunho para
-- ajustar" — que continua sendo `flow_version_updated`.
alter type public.admin_audit_action add value if not exists 'flow_version_rejected';

-- §21. O checklist de homologação foi preenchido ou alterado. Separado de
-- `flow_version_updated` porque ele é o registro de QUEM CONFERIU O QUÊ — a
-- pergunta que se faz depois de um atendimento dar errado.
alter type public.admin_audit_action add value if not exists 'flow_version_checked';


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- ⚠️ NÃO HÁ. Postgres não remove valor de enum, e é uma limitação real da
-- plataforma — não um esquecimento deste arquivo.
--
-- Desfazer de verdade exigiria recriar o tipo inteiro, o que significa reescrever
-- `admin_audit_logs.action` e toda função que a mencione. Um valor a mais num
-- enum de auditoria não faz mal a nada: ele simplesmente deixa de aparecer.
-- ============================================================================
