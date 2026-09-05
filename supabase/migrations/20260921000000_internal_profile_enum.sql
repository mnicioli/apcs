-- ============================================================================
-- ASSOCIADOS — o perfil "interno", para o público de testes da APCS
-- ============================================================================
--
-- ⚠️ ARQUIVO SEPARADO PELA RESTRIÇÃO DO POSTGRES: `alter type ... add value`
-- não pode ser USADO na mesma transação em que roda. O valor entra aqui, e
-- 20260921000100 o usa em `profile_for_event_segment`.
--
-- É o mesmo par de 20260828194955 (que acrescentou `universidade`) e das
-- migrations de fluxos. Juntar os dois arquivos dá
-- "unsafe use of new value of enum type" na primeira execução.
--
-- ----------------------------------------------------------------------------
-- POR QUE UM PERFIL, E NÃO UMA LISTA AVULSA DE CONTATOS
-- ----------------------------------------------------------------------------
-- O público-alvo deste CRM não é uma lista de pessoas escolhidas a dedo: quem
-- está em "Criadores" é quem tem `members.profile_type = 'criador'`. A regra é
-- uma só, em `profile_for_event_segment`, e vale para eventos, disparos e
-- enquetes ao mesmo tempo.
--
-- Um público de membros explícitos exigiria uma tabela de vínculo, uma segunda
-- forma de responder "quem está neste público" e uma tela para gerenciá-la — e
-- as duas formas divergiriam na primeira vez que alguém mexesse numa delas.
-- Acrescentar um PERFIL reaproveita o caminho inteiro que já existe e já é
-- testado.
--
-- ⚠️ E ELE NÃO É ASSOCIADO. `universidade` já abriu esse precedente: nem todo
-- perfil do cadastro é sócio da APCS. Quem decide isso é
-- `isAssociateProfile()` (src/modules/membership/membership.types.ts), e o time
-- interno fica de fora — ele não conta em número de associados, não aparece em
-- indicador de base e não recebe cobrança.
-- ============================================================================

alter type public.membership_profile_type add value if not exists 'interno';

comment on type public.membership_profile_type is
  'Perfil do cadastro. `criador`, `empresa` e `tecnico` sao associados; `universidade` e `interno` nao sao. Ver isAssociateProfile().';


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- ⚠️ NÃO HÁ. O Postgres não remove valor de enum — é limitação da plataforma,
-- não esquecimento deste arquivo. Desfazer exigiria recriar o tipo inteiro e
-- reescrever `members.profile_type`, `membership_applications` e toda função
-- que os mencione.
--
-- O que dá para fazer, e basta: DESATIVAR o público em 20260921000100
-- (`update public.event_segments set active = false where slug =
-- 'time-interno-apcs'`). A partir daí ninguém consegue selecioná-lo —
-- `assert_event_segments` exige `active` — e o valor do enum fica inerte.
-- ============================================================================
