-- ============================================================================
-- Seed: a primeira enquete da APCS — expectativa sobre o valor da @ do suíno
-- ----------------------------------------------------------------------------
-- §8/§83. Migration SEPARADA de propósito, e por duas razões:
--
--   1. O §83 diz "seed OPCIONAL". Num arquivo próprio, quem não quiser a
--      enquete de demonstração apaga esta migration e não perde nada — o módulo
--      inteiro continua de pé.
--   2. É a prova de que o módulo é genérico (§ do cabeçalho do escopo: "não
--      criar uma implementação específica apenas para a enquete sobre o valor da
--      @ do suíno"). Se a estrutura precisasse saber o que é suíno, este arquivo
--      não conseguiria ser só um insert. Ele é.
--
-- Nasce em RASCUNHO, sem público e sem datas. É o estado certo: quem vai decidir
-- para quem perguntar, quando abrir e quando fechar é a APCS, não a migration.
-- ============================================================================

do $seed$
begin
  -- Idempotente: `supabase db reset` reaplica todas as migrations, e sem esta
  -- guarda a base ganharia uma enquete repetida a cada reset.
  if exists (
    select 1 from public.surveys
    where title = 'Expectativa sobre o valor da @ do suíno'
  ) then
    return;
  end if;

  -- Pelo MESMO caminho que a aplicação usa, e não por `insert` direto: assim o
  -- seed passa pelas validações, pelo trigger do grafo e pela trilha de
  -- auditoria. Um seed que entra por uma porta lateral é um seed que pode criar
  -- um registro que a aplicação consideraria inválido.
  --
  -- `created_by` fica nulo (a migration não roda em nome de ninguém) e a linha
  -- de trilha registra a criação sem ator — é a leitura verdadeira: quem criou
  -- esta enquete foi a instalação do sistema.
  perform public.create_survey(
    'Expectativa sobre o valor da @ do suíno',
    'Enquete de expectativa de mercado enviada aos associados da APCS pelo WhatsApp.',
    'Como você acredita que ficará o valor da @ do suíno nas próximas semanas?',
    array[
      'Aumentar muito',
      'Aumentar',
      'Manter',
      'Reduzir',
      'Reduzir muito'
    ]
  );
end $seed$;

-- ----------------------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- A enquete nasce em rascunho, então a exclusão física é permitida (§10) e a
-- função já confere isso:
--
--   select public.delete_survey(id) from public.surveys
--    where title = 'Expectativa sobre o valor da @ do suíno';
--
-- Se ela já tiver sido agendada ou respondida, `delete_survey` recusa — e está
-- certo: o caminho passa a ser o cancelamento, para preservar o histórico.
-- ----------------------------------------------------------------------------
