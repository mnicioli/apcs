-- ============================================================================
-- UM VALOR NOVO NA TRILHA DE INSCRIÇÕES
-- ============================================================================
-- ⚠️ ARQUIVO SEPARADO, E ELE TEM DE CONTINUAR SEPARADO.
--
-- `alter type ... add value` e o USO do valor novo não podem estar na mesma
-- transação: o Postgres recusa com "unsafe use of new value of enum type". O
-- CLI do Supabase roda cada migration numa transação própria, então a divisão em
-- dois arquivos é o que faz isso funcionar.
--
-- É a mesma razão pela qual 20260922000000 existe separado de 20260922000100.
-- Juntar os dois "para simplificar" quebra a aplicação da migration inteira, e o
-- erro não aponta para a causa.
--
-- ----------------------------------------------------------------------------
-- POR QUE UM VALOR NOVO, E NÃO `registration_updated`
-- ----------------------------------------------------------------------------
-- `registration_updated` é a INSCRIÇÃO mudando (a granja trocou de nome). O
-- §13 do Prompt 4 abre a edição do PARTICIPANTE — nome, e-mail, telefone,
-- WhatsApp —, que é outro sujeito e outro dado.
--
-- Usar o mesmo valor para os dois faria a trilha responder "alguma coisa mudou
-- nesta inscrição" quando a pergunta de quem investiga é "mudaram os dados de
-- QUEM?". O `metadata` já carrega o `participantId`; o que faltava era o rótulo.
-- ============================================================================

alter type public.event_registration_audit_action
  add value if not exists 'participant_updated';


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- O Postgres não remove valor de enum. É inofensivo: um valor que ninguém
-- escreve não aparece em lugar nenhum. Mesma situação dos cinco valores
-- acrescentados a `event_audit_action` em 20260922000000.
-- ============================================================================
