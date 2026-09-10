-- ============================================================================
-- UM VALOR NOVO NA TRILHA DE INSCRIÇÕES — A PRESENÇA
-- ============================================================================
-- ⚠️ ARQUIVO SEPARADO, E ELE TEM DE CONTINUAR SEPARADO.
--
-- `alter type ... add value` e o USO do valor novo não podem estar na mesma
-- transação: o Postgres recusa com "unsafe use of new value of enum type". O
-- CLI do Supabase roda cada migration numa transação própria, então a divisão
-- em dois arquivos é o que faz isso funcionar.
--
-- É a mesma razão pela qual 20260925000000 existe separado de 20260925000100, e
-- `src/test/sql-enum-values.test.ts` guarda a separação.
--
-- ----------------------------------------------------------------------------
-- POR QUE UM VALOR NOVO, E NÃO `participant_confirmation_changed`
-- ----------------------------------------------------------------------------
-- ⚠️ CONFIRMADO E PRESENTE SÃO DOIS FATOS DIFERENTES SOBRE A MESMA PESSOA, e o
-- §3 do escopo é explícito em mantê-los independentes: mudar um não mexe no
-- outro, em nenhuma direção.
--
-- Empilhar os dois no mesmo valor de trilha destruiria exatamente a distinção
-- que o escopo pede que exista. Quem investigasse "a Maria apareceu no evento?"
-- leria "confirmação alterada" e teria de abrir a `metadata` para descobrir de
-- QUAL dos dois campos se tratava — e uma trilha que exige interpretação para
-- responder a pergunta mais óbvia não está registrando, está escondendo.
--
-- A `metadata` continua carregando `participantId`, `from` e `to`. O que este
-- valor acrescenta é o rótulo: "isto é presença".
-- ============================================================================

alter type public.event_registration_audit_action
  add value if not exists 'participant_presence_changed';


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- O Postgres não remove valor de enum. É inofensivo: um valor que ninguém
-- escreve não aparece em lugar nenhum. Mesma situação de `participant_updated`
-- em 20260925000000.
-- ============================================================================
