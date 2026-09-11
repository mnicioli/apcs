-- ============================================================================
-- RESULTADOS DA AVALIAÇÃO — o valor de trilha (Prompt 3, §42)
-- ============================================================================
-- ⚠️ ARQUIVO SEPARADO, E AQUI A SEPARAÇÃO É OBRIGATÓRIA — diferente da do
-- Prompt 2.
--
-- Lá os três enums eram `create type`, que nasce usável no mesmo arquivo, e o
-- arquivo à parte era só disciplina. Aqui é `alter type ... add value`: o
-- Postgres recusa o USO de um valor novo na mesma transação que o acrescenta
-- ("unsafe use of new value of enum type"), e `20261003000100` usa este valor
-- dentro de `log_evaluation_export`.
--
-- `src/test/sql-enum-values.test.ts` guarda exatamente isto.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- A exportação auditada (§42)
-- ----------------------------------------------------------------------------
-- ⚠️ POR QUE A EXPORTAÇÃO É AUDITADA E A VISUALIZAÇÃO NÃO.
--
-- O §42 manda auditar a exportação e dispensa auditar "cada visualização
-- simples". A diferença não é de zelo, é de consequência: abrir o painel mostra
-- os dados DENTRO do sistema, sob RLS, e fecha quando a aba fecha. Exportar
-- produz um arquivo com nome, e-mail, telefone e o comentário identificado de
-- centenas de pessoas — e a partir do download não existe mais RLS, nem
-- permissão, nem forma de saber onde ele foi parar.
--
-- É a única ação desta tela que tira dado pessoal do sistema. Por isso ela tem
-- permissão própria (`results.export`) e por isso ela deixa rastro.
alter type public.event_evaluation_audit_action
  add value if not exists 'results_exported';


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- ⚠️ NÃO HÁ ROLLBACK PARA UM VALOR DE ENUM. O Postgres não tem
-- `alter type ... drop value` — remover exigiria recriar o tipo inteiro e
-- reescrever toda coluna que o usa, o que derrubaria as trilhas existentes.
--
-- É inofensivo: um valor a mais num enum que ninguém emite é um valor que
-- ninguém vê. Desfazer o Prompt 3 significa remover 20261003000100 e deixar
-- este valor onde está.
-- ============================================================================
