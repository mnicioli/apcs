-- ============================================================================
-- Documentos iniciais de Comunicação
-- ----------------------------------------------------------------------------
-- Migration separada da que criou o valor do enum, de propósito: o Postgres não
-- deixa usar um valor de enum na mesma transação em que ele foi adicionado.
--
-- Estes quatro são DADOS, não código. Entram como linhas para o sistema já
-- nascer utilizável, e o botão "Novo documento" continua criando quantos mais
-- forem necessários sem tocar em migration. Nenhuma regra específica de cada um
-- é assumida aqui — todos são documentos versionados, exatamente como as
-- normativas.
--
-- `on conflict do nothing` respeita o índice `documents_category_name_key`
-- (unique por categoria + nome em minúsculas): rodar de novo não duplica.
-- ============================================================================

insert into public.documents (category, name, description)
values
  ('communication', 'ISP',
   'Publicação ISP da APCS.'),
  ('communication', 'Revista',
   'Revista institucional da APCS.'),
  ('communication', 'Calendário Anual',
   'Calendário anual de atividades e eventos da APCS.'),
  ('communication', 'Custo de Produção',
   'Publicação de custo de produção suinícola.')
on conflict do nothing;
