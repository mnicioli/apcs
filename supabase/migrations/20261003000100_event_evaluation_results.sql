-- ============================================================================
-- RESULTADOS DA AVALIAÇÃO — tabulação e painel (Prompt 3 de 5)
-- ============================================================================
-- A terceira etapa da jornada:
--
--   PRESENÇA → AVALIAÇÃO → RESPOSTA → [ RESULTADOS ]
--
-- ----------------------------------------------------------------------------
-- ⚠️ ESTA MIGRATION NÃO CRIA TABELA NENHUMA, E ISSO É O PONTO.
-- ----------------------------------------------------------------------------
-- O §22 manda derivar os cálculos dos dados persistidos; o §44 manda o backend
-- ser a fonte. O Prompt 2 já guardou tudo o que a tabulação precisa, e no
-- formato certo:
--
--   `numeric_value`  a nota, COPIADA da opção no instante da resposta (§8)
--   `option_id`      qual alternativa, para a distribuição (§9, §36)
--   `text_value`     o comentário (§13)
--   `version_id`     a versão que a pessoa leu (§21)
--   `round`          a rodada, para a reabertura do §19 não duplicar contagem
--
-- Uma tabela de resultados agregados seria uma SEGUNDA VERDADE sobre os mesmos
-- fatos, e ela sairia de sincronia na primeira resposta que chegasse fora do
-- caminho previsto. O que falta é só CONSULTA — e é isso que este arquivo é.
--
-- O que ele acrescenta ao modelo é uma coluna só, `is_overall`, porque o §34
-- pede explicitamente uma forma de MARCAR a pergunta de avaliação geral.
--
-- ----------------------------------------------------------------------------
-- AS DECISÕES, E POR QUE CADA UMA
-- ----------------------------------------------------------------------------
--
-- DECISÃO 1 — A PERGUNTA GERAL É UMA COLUNA, E NÃO O TÍTULO DO BLOCO.
--
--   Daria para procurar um bloco chamado "Avaliação geral". Seria mais barato e
--   quebraria no primeiro evento em que alguém renomeasse o bloco — e renomear
--   blocos é justamente o que o §3 do Prompt 2 manda a APCS fazer a cada
--   encontro.
--
--   `is_overall` é declarado por quem monta o formulário, sobrevive a rename, e
--   é o que o §18 usa para os filtros de nota ("não aplicar filtro de nota
--   indiscriminadamente a todas as perguntas").
--
--   ⚠️ NO MÁXIMO UMA POR VERSÃO, e quem impõe é
--   `save_event_evaluation_structure`. Um índice único não alcança: a versão
--   está a dois saltos da pergunta (pergunta → bloco → versão), e índice não
--   atravessa junção. A alternativa seria denormalizar `version_id` na
--   pergunta — uma cópia a mais para sair de sincronia, para impor uma regra que
--   o único caminho de escrita já impõe.
--
-- DECISÃO 2 — DUAS VERSÕES COM RESPOSTA VIRAM DOIS BLOCOS, E NÃO UMA SOMA.
--
--   O §21 proíbe recalcular respostas históricas com base na estrutura atual. E
--   como as perguntas da v1 e da v2 são LINHAS DIFERENTES, agrupar por
--   `question_id` já produz o comportamento certo de graça: nada se mistura.
--
--   O que a tela mostra é cada versão com seus blocos, rotulada. Somar "Tema e
--   conteúdo" da v1 com o da v2 seria somar duas perguntas que só por acaso têm
--   o mesmo texto.
--
-- DECISÃO 3 — O DENOMINADOR DO PERCENTUAL É QUEM RESPONDEU A PERGUNTA.
--
--   Não é o total de respostas, e a diferença só aparece na múltipla escolha:
--   uma pessoa que marca três opções gera três linhas. Dividindo pelas linhas, a
--   soma fecharia 100% e cada percentual seria "quanto esta opção representa das
--   marcações" — um número que ninguém pediu.
--
--   Dividindo por PESSOAS, cada percentual é "quantos dos que responderam
--   marcaram isto", e a soma passa de 100%. É exatamente o que o §36 descreve.
--   Para os tipos de resposta única os dois números são idênticos.
--
-- DECISÃO 4 — TUDO É `SECURITY INVOKER`.
--
--   As seis consultas deste arquivo só LEEM, e leem tabelas que já têm RLS
--   (`evaluations_is_reader()`). INVOKER mantém a segunda camada: quem não passa
--   na policy recebe zero linhas mesmo que a checagem de permissão da aplicação
--   falhe. DEFINER aqui seria trocar essa barreira por nada.
--
--   A exceção é `log_evaluation_export`, que ESCREVE na trilha — e trilha é
--   tabela fechada, o que obriga DEFINER (ver `sql-audit-writes.test.ts`). Ela
--   confere a permissão por dentro, porque DEFINER desliga a RLS.
--
-- ----------------------------------------------------------------------------
-- CÓDIGOS DE ERRO — a classe `AV`, já mapeada em src/lib/actions/errors.ts.
-- ----------------------------------------------------------------------------
-- Este arquivo não inventa código novo: ele lê. O único `raise` é o 42501 de
-- `log_evaluation_export`.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. A pergunta de avaliação geral (§11, §18, §34 — decisão 1)
-- ----------------------------------------------------------------------------
alter table public.event_evaluation_questions
  add column if not exists is_overall boolean not null default false;

comment on column public.event_evaluation_questions.is_overall is
  'A pergunta de AVALIACAO GERAL (§34). No maximo uma por versao — imposta por save_event_evaluation_structure.';

-- ⚠️ `where is_overall` — índice PARCIAL. Ele é consultado para achar UMA linha
-- entre milhares, e as outras não têm por que ocupar espaço nele.
create index if not exists event_evaluation_questions_overall_idx
  on public.event_evaluation_questions (section_id)
  where is_overall;

-- ⚠️ SÓ PARA `rating`. Marcar uma pergunta de texto como "avaliação geral"
-- produziria uma média de nada — e o §35 é explícito: não calcular média para
-- texto livre. O CHECK impede o estado em vez de a tabulação ter que se
-- defender dele.
alter table public.event_evaluation_questions
  drop constraint if exists event_evaluation_questions_overall_is_rating;
alter table public.event_evaluation_questions
  add constraint event_evaluation_questions_overall_is_rating
  check (not is_overall or question_type = 'rating');


-- ----------------------------------------------------------------------------
-- 2. O modelo padrão já nasce com a pergunta geral marcada (§34)
-- ----------------------------------------------------------------------------
-- ⚠️ RETROATIVO, E RESTRITO. O modelo padrão foi semeado no Prompt 2 sem esta
-- coluna, e sem este bloco ele ficaria com `is_overall` falso em toda pergunta —
-- o que faria a "Nota média geral" da tela abrir em "N/A" para todo evento que
-- usasse o padrão da casa.
--
-- O `where` é estreito de propósito: só a pergunta de NOTA do bloco "Avaliação
-- geral", e só em avaliações que ainda não foram marcadas. Um `update` mais
-- solto poderia marcar a pergunta errada num formulário que alguém já
-- personalizou.
update public.event_evaluation_questions q
set is_overall = true
from public.event_evaluation_sections s
where s.id = q.section_id
  and q.question_type = 'rating'
  and btrim(lower(s.title)) = 'avaliação geral'
  and not exists (
    select 1
    from public.event_evaluation_questions outra
    join public.event_evaluation_sections outro_bloco on outro_bloco.id = outra.section_id
    where outro_bloco.version_id = s.version_id
      and outra.is_overall
  );


-- ----------------------------------------------------------------------------
-- 3. Índices para a tabulação (§23)
-- ----------------------------------------------------------------------------
-- ⚠️ O QUE JÁ EXISTIA E NÃO PRECISA SER REFEITO, do Prompt 2:
--
--   event_participant_evaluations (event_id, status)      a fila por evento
--   event_participant_evaluations (status, scheduled_for) a fila do worker
--   event_evaluation_answers (question_id)                a agregação
--   event_evaluation_answers (participant_evaluation_id, round, question_id,
--                             option_id) unique           o detalhe por pessoa
--
-- O último já serve de índice de prefixo para "as respostas desta avaliação
-- nesta rodada", que é a consulta do §15. Criar um índice só para
-- `participant_evaluation_id` seria uma cópia do começo dele.
--
-- O que falta é o que as telas NOVAS pedem.

-- §16/§17 — a lista de respostas, ordenada pela data da resposta.
-- ⚠️ PARCIAL: a lista só mostra quem respondeu, e `answered_at` é nulo para
-- todo o resto. Sem o `where`, o índice carregaria as linhas pendentes de todos
-- os eventos para nunca serem lidas por esta consulta.
create index if not exists event_participant_evaluations_answered_idx
  on public.event_participant_evaluations (event_id, answered_at desc)
  where status = 'answered';

-- §21/decisão 2 — "quais versões deste evento têm resposta". Sem ele, descobrir
-- isso é uma varredura da tabela inteira a cada abertura do painel.
create index if not exists event_participant_evaluations_version_idx
  on public.event_participant_evaluations (version_id, event_id);

-- §9/§36 — a distribuição por alternativa. A agregação agrupa por `option_id`, e
-- sem índice isso é uma varredura de `event_evaluation_answers` por pergunta.
create index if not exists event_evaluation_answers_option_idx
  on public.event_evaluation_answers (option_id)
  where option_id is not null;

-- §13/§14 — os comentários. Parcial pelo mesmo motivo do índice de respondidas:
-- a maioria esmagadora das linhas de resposta não é comentário.
create index if not exists event_evaluation_answers_text_idx
  on public.event_evaluation_answers (participant_evaluation_id)
  where text_value is not null;


-- ----------------------------------------------------------------------------
-- 4. Quem pode o quê (§40)
-- ----------------------------------------------------------------------------
-- ⚠️ DUAS CHAVES NOVAS, E NÃO O REÚSO DE `evaluations.read`.
--
-- O §40 pede `events.results.view` e `events.results.export`, e as duas
-- sobrevivem à pergunta "isto muda quem pode o quê?":
--
--   results.read    ver o painel, os comentários identificados e o detalhe
--   results.export  BAIXAR o arquivo com tudo isso
--
-- ⚠️ E `results.export` É SÓ DO ADMINISTRADOR — a decisão mais restritiva deste
-- prompt, e ela é deliberada.
--
-- A exportação de INSCRIÇÕES já alcança o Atendente, e está certo: uma lista de
-- quem se inscreveu é um dado de contato, e quem opera o evento precisa dela
-- para trabalhar.
--
-- Esta é outra coisa. O arquivo leva OPINIÃO AMARRADA A NOME — "João da Granja
-- XPTO achou a palestra da patrocinadora ruim" — e o §41 é explícito sobre
-- proteger comentário identificado. Uma vez baixado, não há mais RLS, não há
-- permissão e não há como saber onde o arquivo foi parar. Por isso a porta é
-- estreita e a passagem é auditada (§42).
--
-- Se a APCS decidir que o Atendente precisa, a saída é um CARGO em /permissions
-- com esta chave — uma decisão consciente, tomada por quem administra, e não um
-- padrão herdado sem ninguém reparar.
--
-- Devem bater com `results_is_reader()` / `results_is_exporter()` abaixo.
create or replace function public.results_is_reader()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Sem válvula para sessão ausente: a tela mostra nome, e-mail, telefone e o
  -- comentário identificado de terceiros. Mesma assimetria de
  -- `evaluations_is_reader`.
  select coalesce((select public.current_app_role()) in ('admin', 'comercial'), false);
$$;

comment on function public.results_is_reader() is
  'Pode abrir o painel de resultados. Administrador e Atendente.';

create or replace function public.results_is_exporter()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select public.current_app_role()) = 'admin', false);
$$;

comment on function public.results_is_exporter() is
  'Pode BAIXAR o arquivo de resultados. So Administrador — ver a secao 4 da migration.';

revoke execute on function public.results_is_reader() from public, anon;
grant execute on function public.results_is_reader() to authenticated;
revoke execute on function public.results_is_exporter() from public, anon;
grant execute on function public.results_is_exporter() to authenticated;


-- ----------------------------------------------------------------------------
-- 5. Os números do topo (§3, §5, §6, §28, §30)
-- ----------------------------------------------------------------------------
-- ⚠️ UMA CONSULTA PARA OS ONZE NÚMEROS, e não onze consultas. É a mesma decisão
-- de `event_registrations_board` e de `event_evaluation_participants`: com uma
-- consulta por indicador, o dia em que um filtro novo entrar só em algumas delas
-- a tela vai dizer "87 enviadas" sobre um universo de 64. Ninguém confere a soma
-- à mão.
--
-- ⚠️ `elegiveis` É `present`, E `confirmation` NÃO APARECE AQUI (§4). "120
-- inscritos, 90 confirmados, 80 presentes → elegíveis = 80. Não: 90." A coluna
-- de confirmação simplesmente não é lida por esta função, e existe um teste que
-- cobra essa ausência.
--
-- ⚠️ `falhas` NÃO É UM STATUS (§29). O Prompt 2 não tem `failed` no enum: falha
-- é `scheduled` com `last_error` preenchido, porque falha é TENTATIVA e não
-- destino. O §28 pede a contagem, e ela sai daí — sem inventar uma segunda
-- enumeração, que é justamente o que o §29 proíbe.
create or replace function public.event_results_summary(p_event_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with presentes as (
    select p.id
    from public.event_participants p
    where p.event_id = p_event_id and p.present
  ),
  avaliacoes as (
    select pe.id, pe.status, pe.last_error, pe.version_id, pe.answer_round
    from public.event_participant_evaluations pe
    where pe.event_id = p_event_id
  ),
  -- ⚠️ A NOTA GERAL SAI DA PERGUNTA MARCADA, e de nenhuma outra (§34). Sem
  -- pergunta marcada, `avg` devolve nulo e a tela mostra "N/A" — o §34 é
  -- explícito: "não inventar uma média sem definição".
  geral as (
    select avg(a.numeric_value)::numeric as media, count(*) as respostas
    from public.event_evaluation_answers a
    join avaliacoes av on av.id = a.participant_evaluation_id
      and a.round = av.answer_round
    join public.event_evaluation_questions q on q.id = a.question_id
    where av.status = 'answered'
      and q.is_overall
      and a.numeric_value is not null
  )
  select jsonb_build_object(
    'eventId', e.id,
    'eventName', e.name,
    'eventDate', e.event_date,
    'startTime', e.start_time,
    'endTime', e.end_time,
    'location', e.location,
    'status', e.status,

    'participants', (select count(*) from public.event_participants p where p.event_id = e.id),
    'present', (select count(*) from presentes),
    -- §4. Elegível = presente. Ponto.
    'eligible', (select count(*) from presentes),
    'sent', (select count(*) from avaliacoes where status in ('sent', 'answered')),
    'answered', (select count(*) from avaliacoes where status = 'answered'),
    -- §28. "Pendentes" é quem recebeu (ou está na fila) e ainda não respondeu —
    -- e não `enviadas − respondidas`, que esqueceria quem nunca chegou a sair.
    'pending', (select count(*) from avaliacoes where status in ('pending', 'scheduled', 'sent')),
    'expired', (select count(*) from avaliacoes where status = 'expired'),
    'cancelled', (select count(*) from avaliacoes where status = 'cancelled'),
    'failed', (select count(*) from avaliacoes
                where last_error is not null and status <> 'answered'),
    -- Quantos presentes ainda não têm avaliação criada — a rotina não passou.
    'notCreated', (select count(*) from presentes
                    where id not in (select participant_id
                                      from public.event_participant_evaluations pe2
                                      where pe2.event_id = e.id)),

    'overallAverage', (select media from geral),
    'overallCount', (select respostas from geral),
    'hasOverallQuestion', exists (
      select 1
      from public.event_evaluation_questions q
      join public.event_evaluation_sections s on s.id = q.section_id
      join avaliacoes av on av.version_id = s.version_id
      where q.is_overall
    ),
    -- §21/decisão 2. Quantas versões diferentes foram respondidas neste evento.
    'answeredVersions', (select count(distinct version_id)
                          from avaliacoes where status = 'answered')
  )
  from public.events e
  where e.id = p_event_id;
$$;

comment on function public.event_results_summary is
  'Os KPIs do painel (§3, §5, §28). Elegivel = presente (§4). SECURITY INVOKER — a RLS vale.';

revoke execute on function public.event_results_summary(uuid) from public, anon;
grant execute on function public.event_results_summary(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 6. A tabulação por pergunta (§7 a §11, §33, §35, §36, §37)
-- ----------------------------------------------------------------------------
-- O coração deste prompt. Devolve a estrutura da avaliação com os números
-- colados nela: bloco → pergunta → distribuição.
--
-- ⚠️ AS RESPOSTAS SÃO FILTRADAS UMA VEZ, NO TOPO (`respostas`), e todo o resto
-- parte dali. Sem isso, cada agregação repetiria o mesmo `join` de três tabelas
-- e o mesmo filtro de rodada — e bastaria uma delas esquecer o `a.round =
-- av.answer_round` para a reabertura do §19 contar a pessoa duas vezes.
--
-- ⚠️ `a.round = av.answer_round` É O §19 CHEGANDO AQUI. Reabrir uma avaliação
-- incrementa a rodada e preserva a resposta anterior; a tabulação lê a rodada
-- CORRENTE. Sem esta condição, quem respondeu duas vezes pesaria o dobro na
-- média — e a resposta que a APCS decidiu descartar continuaria contando.
--
-- ⚠️ MÉDIA SÓ DE `numeric_value` (§8, §35). Texto livre, escolha sem valor e
-- Sim/Não não entram: `avg` ignora nulo, e as opções desses tipos têm
-- `numeric_value` nulo por construção. Não é um `if` — é o formato do dado.
create or replace function public.event_results_questions(p_event_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with avaliacoes as (
    select pe.id, pe.version_id, pe.answer_round
    from public.event_participant_evaluations pe
    where pe.event_id = p_event_id
      and pe.status = 'answered'
  ),
  respostas as (
    select a.id, a.question_id, a.option_id, a.numeric_value, a.text_value,
           a.participant_evaluation_id
    from public.event_evaluation_answers a
    join avaliacoes av on av.id = a.participant_evaluation_id
      and a.round = av.answer_round
  ),
  -- ⚠️ AS PESSOAS QUE RESPONDERAM A PERGUNTA — o denominador da decisão 3. É por
  -- ele que a múltipla escolha passa de 100% (§36) e a escolha única não.
  respondentes as (
    select question_id, count(distinct participant_evaluation_id) as pessoas
    from respostas
    group by question_id
  ),
  numeros as (
    select question_id,
           count(*) filter (where numeric_value is not null) as com_nota,
           avg(numeric_value)::numeric as media,
           min(numeric_value) as minimo,
           max(numeric_value) as maximo
    from respostas
    group by question_id
  ),
  por_opcao as (
    select o.question_id, o.id as option_id, o.label, o.numeric_value, o.position,
           count(r.id) as total
    from public.event_evaluation_options o
    left join respostas r on r.option_id = o.id
    group by o.id, o.question_id, o.label, o.numeric_value, o.position
  )
  select coalesce(
    jsonb_agg(bloco order by versao desc, posicao, titulo),
    '[]'::jsonb
  )
  from (
    select
      v.version as versao,
      s.position as posicao,
      s.title as titulo,
      jsonb_build_object(
        'sectionId', s.id,
        'title', s.title,
        'description', s.description,
        'position', s.position,
        'versionId', v.id,
        'version', v.version,
        -- §33. A média do bloco, só das perguntas quantitativas.
        --
        -- ⚠️ É A MÉDIA DAS RESPOSTAS DO BLOCO, e não a média das médias. As duas
        -- só coincidem quando toda pergunta tem o mesmo número de respostas — e
        -- não têm, porque pergunta opcional pode ficar em branco. A média das
        -- médias daria peso igual a uma pergunta respondida por 60 pessoas e a
        -- outra respondida por 3.
        'average', (
          select avg(r.numeric_value)::numeric
          from respostas r
          join public.event_evaluation_questions q2 on q2.id = r.question_id
          where q2.section_id = s.id and r.numeric_value is not null
        ),
        'questions', coalesce(perguntas.lista, '[]'::jsonb)
      ) as bloco
    from public.event_evaluation_sections s
    join public.event_evaluation_versions v on v.id = s.version_id
    join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'questionId', q.id,
          'prompt', q.prompt,
          'type', q.question_type,
          'required', q.required,
          'isOverall', q.is_overall,
          'position', q.position,
          'respondents', coalesce(resp.pessoas, 0),
          'answers', coalesce(n.com_nota, 0),
          'average', n.media,
          'min', n.minimo,
          'max', n.maximo,
          -- §13/§35. O texto livre não tem distribuição: tem quantidade. Os
          -- comentários em si saem por `event_results_responses`, que os traz
          -- com o participante ao lado.
          'textCount', (
            select count(*) from respostas r2
            where r2.question_id = q.id
              and r2.text_value is not null
              and btrim(r2.text_value) <> ''
          ),
          'options', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'optionId', o.option_id,
                  'label', o.label,
                  'value', o.numeric_value,
                  'position', o.position,
                  'total', o.total
                )
                order by o.position, o.label
              )
              from por_opcao o
              where o.question_id = q.id
            ),
            '[]'::jsonb
          )
        )
        order by q.position, q.id
      ) as lista
      from public.event_evaluation_questions q
      left join respondentes resp on resp.question_id = q.id
      left join numeros n on n.question_id = q.id
      where q.section_id = s.id
    ) perguntas on true
    -- ⚠️ SÓ AS VERSÕES QUE TÊM RESPOSTA (decisão 2). Uma v2 recém-publicada, sem
    -- ninguém que a tenha respondido, apareceria como uma lista de perguntas com
    -- zero em tudo — indistinguível de "todo mundo deixou em branco".
    where s.version_id in (select distinct version_id from avaliacoes)
  ) blocos;
$$;

comment on function public.event_results_questions is
  'Blocos, perguntas, medias e distribuicao (§7 a §11, §33, §36). Respeita a versao (§21) e a rodada (§19).';

revoke execute on function public.event_results_questions(uuid) from public, anon;
grant execute on function public.event_results_questions(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 7. A lista de respostas (§16, §17, §18)
-- ----------------------------------------------------------------------------
-- ⚠️ SÓ QUEM RESPONDEU. O §16 é explícito: "como só devem existir respostas
-- efetivamente submetidas, evitar estados desnecessários nessa tabela". Quem não
-- respondeu tem tela própria (`event_results_pending`), com as colunas que
-- fazem sentido para ELE — situação do envio, prazo — e que aqui seriam seis
-- travessões por linha.
--
-- ⚠️ OS FILTROS DE NOTA USAM A PERGUNTA MARCADA, E SÓ ELA (§18). "Não aplicar
-- filtro de nota indiscriminadamente a todas as perguntas" — filtrar "nota 5"
-- contra qualquer pergunta traria quem deu 5 para o café e 1 para o evento, o
-- que responde a pergunta errada.
--
-- ⚠️ A BUSCA ATRAVESSA DUAS TABELAS — a granja mora na inscrição, a pessoa mora
-- no participante. É por isso que é uma função e não um `or=` do PostgREST, que
-- não cruza a junção. Mesmo motivo de `event_registrations_board`.
create or replace function public.event_results_responses(
  p_event_id uuid,
  p_query text default null,
  p_filter text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with base as (
    select
      pe.id as participant_evaluation_id,
      pe.participant_id,
      pe.answered_at,
      pe.version_id,
      pe.answer_round,
      p.full_name,
      p.email,
      p.phone,
      p.whatsapp,
      r.company_name,
      -- §16. A nota geral da pessoa: a resposta dela à pergunta marcada como
      -- avaliação geral. Nula quando o formulário não tem essa pergunta.
      (
        select a.numeric_value
        from public.event_evaluation_answers a
        join public.event_evaluation_questions q on q.id = a.question_id
        where a.participant_evaluation_id = pe.id
          and a.round = pe.answer_round
          and q.is_overall
        limit 1
      ) as overall_value,
      (
        select o.label
        from public.event_evaluation_answers a
        join public.event_evaluation_questions q on q.id = a.question_id
        join public.event_evaluation_options o on o.id = a.option_id
        where a.participant_evaluation_id = pe.id
          and a.round = pe.answer_round
          and q.is_overall
        limit 1
      ) as overall_label,
      -- ⚠️ `string_agg` PORQUE UM FORMULÁRIO PODE TER MAIS DE UMA PERGUNTA DE
      -- TEXTO. O modelo padrão tem uma, mas nada impede duas — e pegar só a
      -- primeira esconderia a segunda sem avisar ninguém.
      (
        select string_agg(btrim(a.text_value), ' — ' order by q.position, q.id)
        from public.event_evaluation_answers a
        join public.event_evaluation_questions q on q.id = a.question_id
        where a.participant_evaluation_id = pe.id
          and a.round = pe.answer_round
          and a.text_value is not null
          and btrim(a.text_value) <> ''
      ) as comment
    from public.event_participant_evaluations pe
    join public.event_participants p on p.id = pe.participant_id
    join public.event_registrations r on r.id = p.registration_id
    where pe.event_id = p_event_id
      and pe.status = 'answered'
  ),
  filtrada as (
    select * from base b
    where (
      p_query is null or btrim(p_query) = ''
      or b.full_name ilike '%' || btrim(p_query) || '%'
      or b.email ilike '%' || btrim(p_query) || '%'
      or b.company_name ilike '%' || btrim(p_query) || '%'
      or coalesce(b.whatsapp, '') ilike '%' || btrim(p_query) || '%'
      or coalesce(b.phone, '') ilike '%' || btrim(p_query) || '%'
    )
    and (
      p_filter is null or btrim(p_filter) = '' or p_filter = 'all'
      or (p_filter = 'with_comment' and b.comment is not null)
      or (p_filter = 'rating_5' and b.overall_value = 5)
      or (p_filter = 'rating_4' and b.overall_value = 4)
      or (p_filter = 'rating_3' and b.overall_value = 3)
      or (p_filter = 'rating_2' and b.overall_value = 2)
      or (p_filter = 'rating_1' and b.overall_value = 1)
    )
  )
  select jsonb_build_object(
    'total', (select count(*) from filtrada),
    'withComment', (select count(*) from filtrada where comment is not null),
    'rows', coalesce(
      (
        select jsonb_agg(linha order by ordem desc nulls last, nome)
        from (
          select
            f.answered_at as ordem,
            f.full_name as nome,
            jsonb_build_object(
              'participantEvaluationId', f.participant_evaluation_id,
              'participantId', f.participant_id,
              'fullName', f.full_name,
              'companyName', f.company_name,
              'email', f.email,
              'phone', f.phone,
              'whatsapp', f.whatsapp,
              'answeredAt', f.answered_at,
              'overallValue', f.overall_value,
              'overallLabel', f.overall_label,
              'comment', f.comment
            ) as linha
          from filtrada f
          order by f.answered_at desc nulls last, f.full_name
          limit greatest(coalesce(p_limit, 25), 1)
          offset greatest(coalesce(p_offset, 0), 0)
        ) pagina
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.event_results_responses is
  'A lista de quem respondeu (§16, §17). O filtro de nota usa SO a pergunta is_overall (§18).';

revoke execute on function public.event_results_responses(uuid, text, text, integer, integer)
  from public, anon;
grant execute on function public.event_results_responses(uuid, text, text, integer, integer)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 8. O detalhe de uma resposta (§15)
-- ----------------------------------------------------------------------------
-- ⚠️ §45 — A CADEIA, ANTES DE QUALQUER COISA. `p_participant_evaluation_id` vem
-- do navegador; sem o `and pe.event_id = p_event_id`, um id trocado na URL
-- abriria a resposta de OUTRO evento. É o mesmo `and` de
-- `resend_event_evaluation` e de `set_participant_presence`.
--
-- Devolver nulo (e não um erro distinto) para "não existe" e para "é de outro
-- evento" é deliberado: a diferença entre as duas respostas é um oráculo que
-- confirma a existência de ids alheios.
--
-- ⚠️ A ESTRUTURA VEM DA VERSÃO QUE A PESSOA LEU (§21, §23), e não da atual. É
-- por isso que o `join` parte de `pe.version_id` — se o formulário virou v2
-- depois, esta resposta continua sendo exibida contra as perguntas da v1.
create or replace function public.event_results_response_detail(
  p_event_id uuid,
  p_participant_evaluation_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'participantEvaluationId', pe.id,
    'fullName', p.full_name,
    'companyName', r.company_name,
    'email', p.email,
    'whatsapp', p.whatsapp,
    'answeredAt', pe.answered_at,
    'version', v.version,
    'round', pe.answer_round,
    'sections', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'title', s.title,
            'position', s.position,
            'questions', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'prompt', q.prompt,
                    'type', q.question_type,
                    'isOverall', q.is_overall,
                    'position', q.position,
                    -- ⚠️ O RÓTULO E O VALOR JUNTOS ("5 — Excelente", como o §15
                    -- pede). O valor sozinho não diz nada a quem confere; o
                    -- rótulo sozinho não permite checar a conta da média.
                    'answers', coalesce(
                      (
                        select jsonb_agg(
                          jsonb_build_object(
                            'label', o.label,
                            'value', a.numeric_value,
                            'text', a.text_value
                          )
                          order by o.position nulls last, a.id
                        )
                        from public.event_evaluation_answers a
                        left join public.event_evaluation_options o on o.id = a.option_id
                        where a.participant_evaluation_id = pe.id
                          and a.round = pe.answer_round
                          and a.question_id = q.id
                      ),
                      '[]'::jsonb
                    )
                  )
                  order by q.position, q.id
                )
                from public.event_evaluation_questions q
                where q.section_id = s.id
              ),
              '[]'::jsonb
            )
          )
          order by s.position, s.id
        )
        from public.event_evaluation_sections s
        where s.version_id = pe.version_id
      ),
      '[]'::jsonb
    )
  )
  from public.event_participant_evaluations pe
  join public.event_participants p on p.id = pe.participant_id
  join public.event_registrations r on r.id = p.registration_id
  join public.event_evaluation_versions v on v.id = pe.version_id
  where pe.id = p_participant_evaluation_id
    and pe.event_id = p_event_id
    and pe.status = 'answered';
$$;

comment on function public.event_results_response_detail is
  'A resposta de UMA pessoa, contra a versao que ela leu (§15, §21). Confere a cadeia evento↔avaliacao (§45).';

revoke execute on function public.event_results_response_detail(uuid, uuid) from public, anon;
grant execute on function public.event_results_response_detail(uuid, uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 9. Quem ainda não respondeu (§31)
-- ----------------------------------------------------------------------------
-- ⚠️ INCLUI QUEM AINDA NEM TEM AVALIAÇÃO CRIADA, e é o que torna esta tela útil.
-- O §31 pede "estavam presentes; eram elegíveis; receberam avaliação OU possuem
-- envio pendente". Um presente para quem a rotina ainda não passou está
-- pendente do mesmo jeito — e é justamente o caso que ninguém descobre sozinho,
-- porque não há linha para aparecer em lugar nenhum.
--
-- ⚠️ CANCELADA FICA DE FORA. Alguém decidiu que aquela pessoa não vai receber;
-- listá-la como pendência faria a lista nunca esvaziar e ninguém entender por
-- quê.
create or replace function public.event_results_pending(
  p_event_id uuid,
  p_query text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with base as (
    select
      p.id as participant_id,
      p.full_name,
      p.email,
      p.whatsapp,
      p.phone,
      r.company_name,
      pe.id as participant_evaluation_id,
      pe.status,
      pe.sent_at,
      pe.scheduled_for,
      pe.expires_at,
      pe.attempts,
      pe.last_error
    from public.event_participants p
    join public.event_registrations r on r.id = p.registration_id
    left join public.event_participant_evaluations pe
      on pe.participant_id = p.id and pe.event_id = p.event_id
    where p.event_id = p_event_id
      -- §4/§31. Presença é o critério, aqui como em todo o resto.
      and p.present
      and (pe.id is null or pe.status in ('pending', 'scheduled', 'sent', 'expired'))
      and (
        p_query is null or btrim(p_query) = ''
        or p.full_name ilike '%' || btrim(p_query) || '%'
        or p.email ilike '%' || btrim(p_query) || '%'
        or r.company_name ilike '%' || btrim(p_query) || '%'
        or coalesce(p.whatsapp, '') ilike '%' || btrim(p_query) || '%'
      )
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'metrics', jsonb_build_object(
      'notCreated', (select count(*) from base where participant_evaluation_id is null),
      'queued', (select count(*) from base where status in ('pending', 'scheduled')),
      'sent', (select count(*) from base where status = 'sent'),
      'expired', (select count(*) from base where status = 'expired'),
      'failed', (select count(*) from base where last_error is not null)
    ),
    'rows', coalesce(
      (
        select jsonb_agg(linha order by nome)
        from (
          select
            b.full_name as nome,
            jsonb_build_object(
              'participantId', b.participant_id,
              'participantEvaluationId', b.participant_evaluation_id,
              'fullName', b.full_name,
              'companyName', b.company_name,
              'email', b.email,
              'whatsapp', b.whatsapp,
              'phone', b.phone,
              'status', b.status,
              'sentAt', b.sent_at,
              'scheduledFor', b.scheduled_for,
              'expiresAt', b.expires_at,
              'attempts', coalesce(b.attempts, 0),
              'lastError', b.last_error
            ) as linha
          from base b
          order by b.full_name
          limit greatest(coalesce(p_limit, 25), 1)
          offset greatest(coalesce(p_offset, 0), 0)
        ) pagina
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.event_results_pending is
  'Presentes que ainda nao responderam (§31). Inclui quem nem tem avaliacao criada; exclui cancelada.';

revoke execute on function public.event_results_pending(uuid, text, integer, integer)
  from public, anon;
grant execute on function public.event_results_pending(uuid, text, integer, integer)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 10. A exportação (§25, §26, §27)
-- ----------------------------------------------------------------------------
-- Devolve duas coisas: a lista de PERGUNTAS (que vira o cabeçalho dinâmico do
-- §25) e as linhas, cada uma com um mapa `questionId → resposta`.
--
-- ⚠️ AS COLUNAS SÃO MONTADAS AQUI, E NÃO NA ROTA. O §25 pede colunas dinâmicas
-- porque as perguntas são configuráveis; se a rota tivesse que descobrir quais
-- são, ela faria uma segunda consulta e as duas poderiam discordar sobre a
-- ordem — e uma planilha com o cabeçalho fora de ordem em relação aos valores é
-- pior que uma planilha que não abre.
--
-- ⚠️ O MESMO FILTRO DA TELA (§27), pela MESMA assinatura de
-- `event_results_responses`. É isso que faz "a exportação respeita os filtros"
-- ser uma consequência do desenho e não uma regra a lembrar.
--
-- ⚠️ E O TOKEN NÃO SAI DAQUI (§41: "não incluir tokens de avaliação no Excel").
-- Não há como ele escapar por engano: a coluna não é selecionada em lugar nenhum
-- desta função, e `revoke select (token)` do Prompt 2 impediria mesmo se
-- estivesse.
create or replace function public.event_results_export(
  p_event_id uuid,
  p_query text default null,
  p_filter text default null,
  p_limit integer default 5000
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with avaliacoes as (
    select pe.id, pe.version_id, pe.answer_round
    from public.event_participant_evaluations pe
    where pe.event_id = p_event_id and pe.status = 'answered'
  ),
  -- ⚠️ SÓ AS PERGUNTAS DAS VERSÕES RESPONDIDAS. Uma v2 publicada e ainda não
  -- respondida acrescentaria colunas vazias ao arquivo inteiro.
  --
  -- ⚠️ E O RÓTULO CARREGA A VERSÃO QUANDO HÁ MAIS DE UMA (§21). Com v1 e v2
  -- respondidas, "Infraestrutura - Recepção" apareceria duas vezes no cabeçalho
  -- — duas colunas com o mesmo nome e conteúdos diferentes, que é o formato de
  -- planilha que ninguém consegue conferir.
  perguntas as (
    select
      q.id as question_id,
      v.version,
      s.position as section_position,
      q.position as question_position,
      case
        when (select count(distinct version_id) from avaliacoes) > 1
          then 'v' || v.version || ' · ' || s.title || ' - ' || q.prompt
        else s.title || ' - ' || q.prompt
      end as label
    from public.event_evaluation_questions q
    join public.event_evaluation_sections s on s.id = q.section_id
    join public.event_evaluation_versions v on v.id = s.version_id
    where s.version_id in (select distinct version_id from avaliacoes)
  ),
  base as (
    select
      pe.id as participant_evaluation_id,
      pe.answered_at,
      pe.answer_round,
      p.full_name,
      p.email,
      p.phone,
      p.whatsapp,
      r.company_name,
      (
        select a.numeric_value
        from public.event_evaluation_answers a
        join public.event_evaluation_questions q on q.id = a.question_id
        where a.participant_evaluation_id = pe.id
          and a.round = pe.answer_round and q.is_overall
        limit 1
      ) as overall_value,
      (
        select string_agg(btrim(a.text_value), ' — ' order by q.position, q.id)
        from public.event_evaluation_answers a
        join public.event_evaluation_questions q on q.id = a.question_id
        where a.participant_evaluation_id = pe.id
          and a.round = pe.answer_round
          and a.text_value is not null and btrim(a.text_value) <> ''
      ) as comment
    from public.event_participant_evaluations pe
    join public.event_participants p on p.id = pe.participant_id
    join public.event_registrations r on r.id = p.registration_id
    where pe.event_id = p_event_id and pe.status = 'answered'
  ),
  filtrada as (
    select * from base b
    where (
      p_query is null or btrim(p_query) = ''
      or b.full_name ilike '%' || btrim(p_query) || '%'
      or b.email ilike '%' || btrim(p_query) || '%'
      or b.company_name ilike '%' || btrim(p_query) || '%'
      or coalesce(b.whatsapp, '') ilike '%' || btrim(p_query) || '%'
      or coalesce(b.phone, '') ilike '%' || btrim(p_query) || '%'
    )
    and (
      p_filter is null or btrim(p_filter) = '' or p_filter = 'all'
      or (p_filter = 'with_comment' and b.comment is not null)
      or (p_filter = 'rating_5' and b.overall_value = 5)
      or (p_filter = 'rating_4' and b.overall_value = 4)
      or (p_filter = 'rating_3' and b.overall_value = 3)
      or (p_filter = 'rating_2' and b.overall_value = 2)
      or (p_filter = 'rating_1' and b.overall_value = 1)
    )
  )
  select jsonb_build_object(
    'eventName', (select e.name from public.events e where e.id = p_event_id),
    'eventDate', (select e.event_date from public.events e where e.id = p_event_id),
    'questions', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('questionId', question_id, 'label', label)
          order by version, section_position, question_position
        )
        from perguntas
      ),
      '[]'::jsonb
    ),
    'rows', coalesce(
      (
        select jsonb_agg(linha order by ordem desc nulls last, nome)
        from (
          select
            f.answered_at as ordem,
            f.full_name as nome,
            jsonb_build_object(
              'fullName', f.full_name,
              'companyName', f.company_name,
              'email', f.email,
              'phone', f.phone,
              'whatsapp', f.whatsapp,
              'answeredAt', f.answered_at,
              'overallValue', f.overall_value,
              'comment', f.comment,
              -- ⚠️ UM MAPA, E NÃO UM ARRAY NA ORDEM DAS COLUNAS. O array
              -- dependeria de a rota iterar exatamente na mesma ordem da CTE
              -- `perguntas` — e o dia em que as duas divergissem, cada valor
              -- entraria na coluna do vizinho, em silêncio. Com o mapa, a rota
              -- procura pela CHAVE.
              'answers', coalesce(
                (
                  select jsonb_object_agg(
                    a.question_id::text,
                    a.texto
                  )
                  from (
                    select
                      a2.question_id,
                      -- ⚠️ O RÓTULO, E NÃO O NÚMERO. Quem abre a planilha lê
                      -- "Excelente"; quem quer a conta tem a coluna "Nota
                      -- geral" e o número dentro do rótulo da escala. Texto
                      -- livre entra como o próprio texto.
                      string_agg(
                        coalesce(o.label, btrim(a2.text_value)),
                        ' | ' order by o.position nulls last, a2.id
                      ) as texto
                    from public.event_evaluation_answers a2
                    left join public.event_evaluation_options o on o.id = a2.option_id
                    where a2.participant_evaluation_id = f.participant_evaluation_id
                      and a2.round = f.answer_round
                    group by a2.question_id
                  ) a
                ),
                '{}'::jsonb
              )
            ) as linha
          from filtrada f
          order by f.answered_at desc nulls last, f.full_name
          limit greatest(coalesce(p_limit, 5000), 1)
        ) pagina
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.event_results_export is
  'As linhas da exportacao com colunas dinamicas (§25) e os mesmos filtros da tela (§27). Nunca o token (§41).';

revoke execute on function public.event_results_export(uuid, text, text, integer)
  from public, anon;
grant execute on function public.event_results_export(uuid, text, text, integer)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 11. A exportação deixa rastro (§42)
-- ----------------------------------------------------------------------------
-- ⚠️ `SECURITY DEFINER` PORQUE ESCREVE NA TRILHA, que é tabela fechada — e com a
-- checagem de permissão POR DENTRO, porque DEFINER desliga a RLS. É a mesma
-- disciplina das funções de escrita do Prompt 2, e `sql-audit-writes.test.ts`
-- guarda o outro lado.
--
-- ⚠️ O TERMO BUSCADO NÃO ENTRA NA TRILHA. Ele pode ser o e-mail, o telefone ou o
-- nome de uma pessoa — e a trilha é a tabela que ninguém pensa em varrer quando
-- alguém pede exclusão de dados. O que fica é SE houve busca, que é o que
-- responde "esta exportação foi a lista inteira ou um recorte?".
create or replace function public.log_evaluation_export(
  p_event_id uuid,
  p_rows integer,
  p_filter text default null,
  p_searched boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation uuid;
begin
  if not public.results_is_exporter() then
    raise exception 'Sem permissão para exportar os resultados.' using errcode = '42501';
  end if;

  select s.evaluation_id into v_evaluation
  from public.event_evaluation_settings s
  where s.event_id = p_event_id;

  insert into public.event_evaluation_audit_logs
    (event_id, evaluation_id, action, actor_id, metadata)
  values (
    p_event_id, v_evaluation, 'results_exported', (select auth.uid()),
    jsonb_build_object(
      'rows', greatest(coalesce(p_rows, 0), 0),
      'filter', coalesce(nullif(btrim(coalesce(p_filter, '')), ''), 'all'),
      'searched', coalesce(p_searched, false)
    )
  );
end;
$$;

comment on function public.log_evaluation_export is
  'Registra a exportacao de resultados (§42). Nunca guarda o termo buscado.';

revoke execute on function public.log_evaluation_export(uuid, integer, text, boolean)
  from public, anon;
grant execute on function public.log_evaluation_export(uuid, integer, text, boolean)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 12. Duas funções do Prompt 2 que precisam saber da coluna nova
-- ----------------------------------------------------------------------------
-- ⚠️ ALTERAÇÃO MÍNIMA E NECESSÁRIA, e não refatoração. O §49 pede para não
-- alterar funcionalidade existente sem necessidade; as duas mudanças abaixo são
-- a necessidade:
--
--   • `save_event_evaluation_structure` é o ÚNICO caminho de escrita da
--     estrutura. Sem ela ler `isOverall`, a coluna da seção 1 nunca sairia de
--     `false` e o §34 não teria como ser cumprido.
--
--   • `event_evaluation_summaries` alimenta a tela de seleção de evento, e o §3
--     pede Local e Situação ali. Os dois são colunas de `events` que já estão no
--     `from` — não há consulta a mais, só dois campos no `jsonb`.
--
-- A tela do Prompt 2 ignora os campos novos e continua idêntica.

-- ⚠️ RECRIADA INTEIRA porque PL/pgSQL não tem "alterar um trecho". O corpo é o
-- de 20261002000100 com TRÊS acréscimos, todos marcados com `§34` abaixo.
create or replace function public.save_event_evaluation_structure(
  p_event_id uuid,
  p_sections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation uuid;
  v_current uuid;
  v_target uuid;
  v_next_version integer;
  v_versionou boolean := false;

  v_secao jsonb;
  v_secao_pos integer;
  v_secao_id uuid;

  v_pergunta jsonb;
  v_pergunta_pos integer;
  v_pergunta_id uuid;
  v_tipo text;

  v_opcao jsonb;
  v_opcao_pos integer;
  v_qtd_opcoes integer;

  -- §34. Quantas perguntas o payload marcou como avaliação geral.
  v_gerais integer := 0;
  v_is_overall boolean;
begin
  if not public.evaluations_is_writer() then
    raise exception 'Sem permissão para editar as perguntas.' using errcode = '42501';
  end if;

  select s.evaluation_id into v_evaluation
  from public.event_evaluation_settings s
  where s.event_id = p_event_id;

  if v_evaluation is null then
    raise exception 'Configure a avaliação deste evento antes de editar as perguntas.'
      using errcode = 'AV002';
  end if;

  if jsonb_typeof(p_sections) is distinct from 'array' or jsonb_array_length(p_sections) = 0 then
    raise exception 'A avaliação precisa de pelo menos um bloco de perguntas.' using errcode = 'AV003';
  end if;

  v_current := public.current_evaluation_version_id(v_evaluation);

  if v_current is not null and exists (
    select 1 from public.event_participant_evaluations pe
    where pe.version_id = v_current and pe.status = 'answered'
  ) then
    select coalesce(max(v.version), 0) + 1 into v_next_version
    from public.event_evaluation_versions v where v.evaluation_id = v_evaluation;

    insert into public.event_evaluation_versions (evaluation_id, version, created_by)
    values (v_evaluation, v_next_version, (select auth.uid()))
    returning id into v_target;

    v_versionou := true;
  else
    if v_current is null then
      insert into public.event_evaluation_versions (evaluation_id, version, created_by)
      values (v_evaluation, 1, (select auth.uid()))
      returning id into v_target;
    else
      v_target := v_current;
      delete from public.event_evaluation_sections s where s.version_id = v_target;
    end if;
  end if;

  for v_secao, v_secao_pos in
    select valor, ordem
    from jsonb_array_elements(p_sections) with ordinality as t(valor, ordem)
  loop
    if coalesce(btrim(v_secao ->> 'title'), '') = '' then
      raise exception 'Todo bloco precisa de um título.' using errcode = 'AV003';
    end if;

    if jsonb_typeof(v_secao -> 'questions') is distinct from 'array'
       or jsonb_array_length(v_secao -> 'questions') = 0 then
      raise exception 'O bloco "%" está sem perguntas.', btrim(v_secao ->> 'title')
        using errcode = 'AV003';
    end if;

    insert into public.event_evaluation_sections (version_id, position, title, description)
    values (
      v_target,
      v_secao_pos,
      left(btrim(v_secao ->> 'title'), 200),
      nullif(btrim(coalesce(v_secao ->> 'description', '')), '')
    )
    returning id into v_secao_id;

    for v_pergunta, v_pergunta_pos in
      select valor, ordem
      from jsonb_array_elements(v_secao -> 'questions') with ordinality as t(valor, ordem)
    loop
      if coalesce(btrim(v_pergunta ->> 'prompt'), '') = '' then
        raise exception 'Toda pergunta precisa de um enunciado.' using errcode = 'AV003';
      end if;

      v_tipo := coalesce(btrim(v_pergunta ->> 'type'), '');
      if v_tipo not in ('rating', 'single_choice', 'multiple_choice', 'yes_no', 'free_text') then
        raise exception 'Tipo de pergunta desconhecido: %.', v_tipo using errcode = 'AV003';
      end if;

      -- ========================================================================
      -- §34 — A PERGUNTA DE AVALIAÇÃO GERAL.
      -- ========================================================================
      v_is_overall := coalesce((v_pergunta ->> 'isOverall')::boolean, false);

      -- ⚠️ SÓ `rating` PODE SER A GERAL. O CHECK da tabela recusaria de qualquer
      -- jeito; a mensagem daqui é a que diz o que fazer.
      if v_is_overall and v_tipo <> 'rating' then
        raise exception 'A pergunta de avaliação geral precisa ser do tipo Nota.'
          using errcode = 'AV003';
      end if;

      if v_is_overall then
        v_gerais := v_gerais + 1;
        -- ⚠️ NO MÁXIMO UMA POR VERSÃO (decisão 1 de 20261003000100). Duas
        -- fariam a "Nota média geral" do painel depender de qual linha o banco
        -- devolvesse primeiro — um número diferente a cada abertura da tela.
        if v_gerais > 1 then
          raise exception 'Só uma pergunta pode ser a avaliação geral.' using errcode = 'AV003';
        end if;
      end if;

      insert into public.event_evaluation_questions
        (section_id, position, prompt, question_type, required, is_overall)
      values (
        v_secao_id,
        v_pergunta_pos,
        left(btrim(v_pergunta ->> 'prompt'), 500),
        v_tipo::public.event_evaluation_question_type,
        coalesce((v_pergunta ->> 'required')::boolean, false),
        v_is_overall
      )
      returning id into v_pergunta_id;

      if v_tipo = 'yes_no' then
        insert into public.event_evaluation_options (question_id, position, label, numeric_value)
        values (v_pergunta_id, 1, 'Sim', 1), (v_pergunta_id, 2, 'Não', 0);

      elsif v_tipo = 'free_text' then
        if jsonb_typeof(v_pergunta -> 'options') = 'array'
           and jsonb_array_length(v_pergunta -> 'options') > 0 then
          raise exception 'Pergunta de texto livre não tem alternativas.' using errcode = 'AV003';
        end if;

      else
        if jsonb_typeof(v_pergunta -> 'options') is distinct from 'array' then
          raise exception 'A pergunta "%" precisa de alternativas.',
            btrim(v_pergunta ->> 'prompt') using errcode = 'AV003';
        end if;

        v_qtd_opcoes := jsonb_array_length(v_pergunta -> 'options');
        if v_qtd_opcoes < 2 then
          raise exception 'A pergunta "%" precisa de pelo menos duas alternativas.',
            btrim(v_pergunta ->> 'prompt') using errcode = 'AV003';
        end if;

        for v_opcao, v_opcao_pos in
          select valor, ordem
          from jsonb_array_elements(v_pergunta -> 'options') with ordinality as t(valor, ordem)
        loop
          if coalesce(btrim(v_opcao ->> 'label'), '') = '' then
            raise exception 'Toda alternativa precisa de um texto.' using errcode = 'AV003';
          end if;

          if v_tipo = 'rating' and (v_opcao ->> 'value') is null then
            raise exception 'Toda alternativa de uma pergunta de nota precisa de um valor.'
              using errcode = 'AV003';
          end if;

          insert into public.event_evaluation_options (question_id, position, label, numeric_value)
          values (
            v_pergunta_id,
            v_opcao_pos,
            left(btrim(v_opcao ->> 'label'), 200),
            (v_opcao ->> 'value')::integer
          );
        end loop;
      end if;
    end loop;
  end loop;

  insert into public.event_evaluation_audit_logs (event_id, evaluation_id, action, actor_id, metadata)
  values (
    p_event_id, v_evaluation,
    case when v_versionou then 'version_published' else 'structure_changed' end,
    (select auth.uid()),
    jsonb_build_object(
      'versionId', v_target,
      'sections', jsonb_array_length(p_sections),
      'newVersion', v_versionou,
      -- §34. Saber, pela trilha, quando o formulário ficou sem pergunta geral —
      -- que é o dia em que a "Nota média geral" do painel vira "N/A".
      'hasOverall', v_gerais = 1
    )
  );

  return public.event_evaluation_detail(p_event_id);
end;
$$;

comment on function public.save_event_evaluation_structure is
  'Salva a estrutura inteira (decisao 3 do Prompt 2). Versiona sozinha (§23) e impoe uma unica pergunta geral (§34).';

revoke execute on function public.save_event_evaluation_structure(uuid, jsonb) from public, anon;
grant execute on function public.save_event_evaluation_structure(uuid, jsonb) to authenticated;


-- ⚠️ DOIS CAMPOS A MAIS, E NADA MUDA PARA QUEM JÁ USA. `location` e `status`
-- vêm de `public.events`, que já está no `from` — não há consulta nova. A tela
-- de Avaliações do Prompt 2 continua lendo os mesmos campos de antes.
create or replace function public.event_evaluation_summaries(
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with base as (
    select
      e.id,
      e.name,
      e.event_date,
      e.start_time,
      e.end_time,
      e.location,
      e.status,
      s.enabled,
      s.evaluation_id,
      s.delay_minutes,
      s.response_window_days,
      public.event_evaluation_send_at(e.id, coalesce(s.delay_minutes, 0)) as send_at,
      (select count(*) from public.event_participants p
        where p.event_id = e.id) as participants,
      (select count(*) from public.event_participants p
        where p.event_id = e.id and p.present) as present,
      (select count(*) from public.event_participant_evaluations pe
        where pe.event_id = e.id and pe.status in ('sent', 'answered')) as sent,
      (select count(*) from public.event_participant_evaluations pe
        where pe.event_id = e.id and pe.status = 'answered') as answered,
      (select count(*) from public.event_participant_evaluations pe
        where pe.event_id = e.id and pe.status in ('pending', 'scheduled')) as queued
    from public.events e
    left join public.event_evaluation_settings s on s.event_id = e.id
    where exists (select 1 from public.event_participants p where p.event_id = e.id)
      and (
        p_query is null
        or btrim(p_query) = ''
        or e.name ilike '%' || btrim(p_query) || '%'
      )
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce(
      (
        select jsonb_agg(linha order by linha_date desc, linha_name)
        from (
          select
            b.event_date as linha_date,
            b.name as linha_name,
            jsonb_build_object(
              'eventId', b.id,
              'eventName', b.name,
              'eventDate', b.event_date,
              'startTime', b.start_time,
              'endTime', b.end_time,
              'location', b.location,
              'status', b.status,
              'configured', b.evaluation_id is not null,
              'enabled', coalesce(b.enabled, false),
              'delayMinutes', b.delay_minutes,
              'responseWindowDays', b.response_window_days,
              'sendAt', b.send_at,
              'participants', b.participants,
              'present', b.present,
              'sent', b.sent,
              'answered', b.answered,
              'queued', b.queued
            ) as linha
          from base b
          order by b.event_date desc, b.name
          limit greatest(coalesce(p_limit, 20), 1)
          offset greatest(coalesce(p_offset, 0), 0)
        ) pagina
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.event_evaluation_summaries is
  'A grid das telas de Avaliacoes e de Resultados. So eventos com participante. SECURITY INVOKER — a RLS vale.';

revoke execute on function public.event_evaluation_summaries(text, integer, integer)
  from public, anon;
grant execute on function public.event_evaluation_summaries(text, integer, integer)
  to authenticated;


-- ⚠️ TERCEIRA E ÚLTIMA FUNÇÃO DO PROMPT 2 RECRIADA, e pelo mesmo motivo das duas
-- de cima: sem `isOverall` no que ela devolve, o construtor carregaria toda
-- pergunta como "não é a geral" e a primeira edição apagaria a marcação que a
-- seção 2 acabou de gravar.
--
-- ⚠️ UM CAMPO A MAIS, e nada mais mudou. A página pública passa a receber
-- `isOverall` junto das perguntas e simplesmente o ignora — o formulário de quem
-- responde não tem por que saber qual pergunta vira o indicador do painel.
create or replace function public.evaluation_version_structure(p_version_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'description', s.description,
        'position', s.position,
        'questions', coalesce(q.perguntas, '[]'::jsonb)
      )
      order by s.position, s.id
    ),
    '[]'::jsonb
  )
  from public.event_evaluation_sections s
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', qq.id,
        'prompt', qq.prompt,
        'type', qq.question_type,
        'required', qq.required,
        'isOverall', qq.is_overall,
        'position', qq.position,
        'options', coalesce(o.opcoes, '[]'::jsonb)
      )
      order by qq.position, qq.id
    ) as perguntas
    from public.event_evaluation_questions qq
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id', oo.id,
          'label', oo.label,
          'value', oo.numeric_value,
          'position', oo.position
        )
        order by oo.position, oo.id
      ) as opcoes
      from public.event_evaluation_options oo
      where oo.question_id = qq.id
    ) o on true
    where qq.section_id = s.id
  ) q on true
  where s.version_id = p_version_id;
$$;

comment on function public.evaluation_version_structure is
  'A estrutura de uma versao em jsonb. Usada pela tela, pelo construtor e pela pagina publica.';

revoke execute on function public.evaluation_version_structure(uuid) from public, anon;
grant execute on function public.evaluation_version_structure(uuid) to authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 13. As duas camadas de permissão, semeadas (§40)
-- ----------------------------------------------------------------------------
-- ⚠️ SÓ O TETO NÃO BASTA. `app_role_ceilings` declara o que a RLS entrega a cada
-- PAPEL-BASE, mas quem decide o que uma pessoa vê é o CARGO dela
-- (`app_role_permissions`). Uma permissão acrescentada depois entra no teto e
-- não entra em cargo nenhum — e o resultado seria o item "Resultados" invisível
-- até para o Administrador, com a RLS liberada e a tela no ar.
--
-- Existe um teste que recusa uma migration que mexa no teto sem semear
-- (`src/test/sql-role-ceilings.test.ts`).
insert into public.app_role_ceilings (base_role, permission) values
  ('admin', 'results.read'),
  ('admin', 'results.export'),
  ('comercial', 'results.read')
on conflict do nothing;

insert into public.app_role_permissions (role_key, permission)
select r.key, c.permission
from public.app_roles r
join public.app_role_ceilings c on c.base_role = r.base_role
where r.is_builtin
  and c.permission in ('results.read', 'results.export')
on conflict do nothing;


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   delete from public.app_role_permissions
--     where permission in ('results.read', 'results.export');
--   delete from public.app_role_ceilings
--     where permission in ('results.read', 'results.export');
--
--   drop function if exists public.log_evaluation_export(uuid, integer, text, boolean);
--   drop function if exists public.event_results_export(uuid, text, text, integer);
--   drop function if exists public.event_results_pending(uuid, text, integer, integer);
--   drop function if exists public.event_results_response_detail(uuid, uuid);
--   drop function if exists public.event_results_responses(uuid, text, text, integer, integer);
--   drop function if exists public.event_results_questions(uuid);
--   drop function if exists public.event_results_summary(uuid);
--   drop function if exists public.results_is_exporter();
--   drop function if exists public.results_is_reader();
--
--   drop index if exists public.event_evaluation_answers_text_idx;
--   drop index if exists public.event_evaluation_answers_option_idx;
--   drop index if exists public.event_participant_evaluations_version_idx;
--   drop index if exists public.event_participant_evaluations_answered_idx;
--   drop index if exists public.event_evaluation_questions_overall_idx;
--
--   alter table public.event_evaluation_questions
--     drop constraint if exists event_evaluation_questions_overall_is_rating;
--   alter table public.event_evaluation_questions drop column if exists is_overall;
--
--   -- E recriar `save_event_evaluation_structure`, `event_evaluation_summaries`
--   -- e `evaluation_version_structure` como estão em 20261002000100.
--
-- ⚠️ NENHUMA RESPOSTA SE PERDE NESTE ROLLBACK, e é a diferença entre desfazer
-- este prompt e desfazer o anterior. Aqui não há tabela de dado: o que sai são
-- consultas, índices, duas permissões e a marcação da pergunta geral. As
-- avaliações respondidas continuam inteiras — só param de ser tabuladas.
-- ============================================================================
