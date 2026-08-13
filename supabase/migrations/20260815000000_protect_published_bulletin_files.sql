-- ============================================================================
-- Bolsa — arquivo de publicação PUBLICADA não se apaga
-- ----------------------------------------------------------------------------
-- Fecha um buraco entre duas camadas que, sozinhas, pareciam cobertas:
--
--   `market_bulletin_versions`  já não concede UPDATE em `image_path`/`pdf_path`
--                               (grants de coluna) nem DELETE de linha.
--   bucket `market-bulletins`   concedia DELETE de OBJETO a admin/ceo.
--
-- Ou seja: a LINHA era imutável, mas os BYTES não. Um admin chamando a API de
-- Storage direto conseguia apagar o PDF de uma publicação do histórico, e a
-- linha continuaria lá apontando para um arquivo que não existe mais — o pior
-- estado possível, porque a tela promete um documento que não abre.
--
-- POR QUE A POLICY DE DELETE EXISTE, mesmo assim: é ela que permite recolher o
-- arquivo órfão quando a validação de conteúdo reprova depois do upload físico.
-- Tirar o DELETE inteiro quebraria a limpeza e trocaria um problema por outro.
--
-- A REGRA CERTA, então, não é "quem pode apagar" e sim "o que pode ser
-- apagado": objeto SEM linha que o referencie. Isso separa exatamente os dois
-- casos — órfão sai, publicado fica —, e passa a valer para qualquer caminho,
-- inclusive a API crua.
--
-- Custo: uma busca por igualdade em `image_path`/`pdf_path`, que são UNIQUE e
-- portanto já indexadas. DELETE aqui é operação rara (só limpeza de órfão).
-- ============================================================================

drop policy if exists "market_bulletins_bucket_delete" on storage.objects;

create policy "market_bulletins_bucket_delete"
  on storage.objects for delete
  using (
    bucket_id = 'market-bulletins'
    and public.current_app_role() in ('admin', 'ceo')
    -- ⚠️ A CONDIÇÃO QUE FAZ O TRABALHO: se existe publicação apontando para
    -- este objeto, ele é histórico — e histórico não se apaga.
    and not exists (
      select 1
      from public.market_bulletin_versions v
      where v.image_path = storage.objects.name
         or v.pdf_path = storage.objects.name
    )
  );

comment on policy "market_bulletins_bucket_delete" on storage.objects is
  'Só apaga objeto órfão: arquivo referenciado por uma publicação é imutável, inclusive para admin.';

-- ----------------------------------------------------------------------------
-- ROLLBACK (se precisar desfazer)
-- ----------------------------------------------------------------------------
--   drop policy if exists "market_bulletins_bucket_delete" on storage.objects;
--   create policy "market_bulletins_bucket_delete"
--     on storage.objects for delete
--     using (
--       bucket_id = 'market-bulletins'
--       and public.current_app_role() in ('admin', 'ceo')
--     );
