-- ============================================================================
-- CORRIGE O GRANT DE `whatsapp_is_reader` — a caixa de entrada não abria.
-- ============================================================================
--
-- SINTOMA: toda leitura de `/whatsapp` estourava
--
--     42501 — permission denied for function whatsapp_is_reader
--
-- e a tela inteira caía ("Application error: a server-side exception has
-- occurred"), porque `listWhatsAppChats` LANÇA o erro do banco em vez de
-- engoli-lo — é o padrão de service do projeto, ver docs/SERVICE-ACTION-PATTERN.md.
--
-- ----------------------------------------------------------------------------
-- A CAUSA: uma premissa errada, e ela estava escrita em comentário
-- ----------------------------------------------------------------------------
-- A `20260822000000_create_whatsapp_inbox.sql` revogou o `execute` desta função
-- de `authenticated`, justificando assim:
--
--     "uma policy roda com os privilégios do dono da tabela
--      — não precisa de grant para o usuário"
--
-- Isso é falso, e a distinção é exatamente onde o módulo tropeçou:
--
--   • o que roda com os privilégios do DONO é o CORPO de uma função
--     `security definer`;
--   • a EXPRESSÃO DE UMA POLICY é avaliada como o papel que faz a consulta.
--
-- Logo, `authenticated` precisa de `execute` em toda função citada por uma
-- policy que se aplique a ele. E `whatsapp_is_reader` é citada por três:
--
--     whatsapp_chats_select          → public.whatsapp_chats
--     whatsapp_messages_select       → public.whatsapp_messages
--     whatsapp_media_bucket_select   → storage.objects
--
-- ⚠️ Sem o `execute`, a policy não chega a ser AVALIADA — e o Postgres recusa a
-- tabela inteira (42501) em vez de devolver zero linhas. É por isso que o
-- sintoma foi a página quebrada, e não uma caixa vazia. Uma policy que nega
-- devolve lista vazia; uma policy que não pode rodar derruba a consulta.
--
-- ----------------------------------------------------------------------------
-- POR QUE SÓ ESTA, E NÃO AS OUTRAS TRÊS AUXILIARES
-- ----------------------------------------------------------------------------
-- `whatsapp_is_writer`, `whatsapp_status_rank` e `whatsapp_kind_label` seguem
-- revogadas DE PROPÓSITO: são chamadas apenas DENTRO das oito funções
-- `security definer` do módulo, e ali o corpo roda como dono — o chamador não
-- precisa de privilégio nenhum. Concedê-las seria permissão morta, e permissão
-- morta é a que ninguém revisa depois.
--
-- O grant abaixo devolve o módulo ao padrão que Enquetes e Associados já
-- seguem (`survey_is_reader` e `membership_is_reader` são concedidas a
-- `authenticated` desde sempre); o WhatsApp é que havia desviado.
-- ============================================================================

-- `public` e `anon` continuam de fora: a função responde "quem está falando
-- pode ler a caixa?", e quem não tem sessão não tem por que perguntar.
revoke execute on function public.whatsapp_is_reader() from public, anon;
grant execute on function public.whatsapp_is_reader() to authenticated;

comment on function public.whatsapp_is_reader() is
  'Pode ler a caixa de entrada do WhatsApp. Concedida a `authenticated` porque é citada por três policies de RLS, e a expressão de uma policy é avaliada como o papel que consulta — não como o dono da tabela.';
