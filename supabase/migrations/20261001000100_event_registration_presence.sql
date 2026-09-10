-- ============================================================================
-- A LISTA DE PRESENÇA (Prompt 1 da jornada de Gestão do Evento)
-- ============================================================================
-- A jornada que este arquivo abre:
--
--   EVENTO → INSCRIÇÃO → PARTICIPANTE → LISTA DE PRESENÇA → PRESENTE ON/OFF
--
-- ----------------------------------------------------------------------------
-- DECISÃO 1 — A PRESENÇA É DO PARTICIPANTE, E NÃO DA INSCRIÇÃO (§2)
-- ----------------------------------------------------------------------------
-- A inscrição é da GRANJA; quem entra pela porta são as PESSOAS dela. A Granja
-- XPTO pode inscrever João, Maria e Carlos e aparecerem só dois — se a presença
-- morasse na inscrição, não haveria como dizer QUAL dos três faltou.
--
-- Por isso as três colunas nascem em `event_participants`, que é a entidade que
-- já representa "uma pessoa neste evento" e já carrega `event_id` guardado por
-- FK composta. Não há tabela nova: uma `event_attendances` paralela seria uma
-- segunda cópia da mesma cadeia, com o mesmo risco de divergir.
--
-- ----------------------------------------------------------------------------
-- DECISÃO 2 — REUSAR `event_registrations_board`, E NÃO ESCREVER OUTRA (§7 a §16)
-- ----------------------------------------------------------------------------
-- ⚠️ A TENTAÇÃO ERA UMA `event_presence_board` NOVA, e ela custaria caro.
--
-- A tela de Presença pede exatamente o que a de Inscrições já resolve: busca
-- server-side atravessando DUAS tabelas (a granja mora na inscrição, a pessoa
-- no participante), a cadeia evento→inscrição→participante conferida no banco
-- contra IDOR, paginação, ordenação estável e — o mais delicado — métricas que
-- respeitam o filtro ativo saindo da MESMA CTE.
--
-- Uma segunda função duplicaria esse `where`. E o modo de falhar da duplicação
-- é silencioso: no dia em que a busca ganhasse um campo numa das cópias, uma
-- das telas passaria a não achar quem a outra acha, sem erro nenhum.
--
-- Então a função ganha `p_presence`, dois campos na linha e duas métricas. As
-- duas telas leem a mesma consulta, e uma correção conserta as duas.
--
-- ----------------------------------------------------------------------------
-- DECISÃO 3 — CONFIRMADO E PRESENTE NÃO SE TOCAM (§3)
-- ----------------------------------------------------------------------------
-- ⚠️ O ESCOPO É EXPLÍCITO, E O DESENHO O IMPÕE EM VEZ DE PEDIR QUE ALGUÉM
-- LEMBRE. `set_participant_presence` escreve `present`, `checked_in_at` e
-- `checked_in_by` — e mais nada. `set_participant_confirmation` escreve
-- `confirmation` — e mais nada. Nenhuma das duas lê a outra coluna.
--
-- Não há trigger, não há regra derivada, não há "se confirmou, marca presente".
-- Confirmado é o que a granja AFIRMOU; Presente é quem APARECEU. Um evento em
-- que os dois números batem é sorte, não invariante.
--
-- ----------------------------------------------------------------------------
-- DECISÃO 4 — O RELÓGIO É DO BANCO (§12, §21)
-- ----------------------------------------------------------------------------
-- `checked_in_at` recebe `now()` DENTRO do UPDATE. A função não aceita
-- timestamp como parâmetro, então não existe caminho em que o relógio do
-- navegador de quem opera decida a que horas alguém chegou — nem por engano
-- (máquina com a hora errada), nem de propósito.
--
-- ----------------------------------------------------------------------------
-- DECISÃO 5 — O QR CODE FUTURO JÁ TEM ONDE ENTRAR (§22)
-- ----------------------------------------------------------------------------
-- A regra de presença é UMA função de domínio, `set_participant_presence`, e o
-- backoffice apenas a consome. `p_source` diz QUEM acionou; hoje só existe
-- 'backoffice', e o dia em que o QR Code chegar ele passa 'qr_code' e herda
-- inteiras a validação da cadeia, a idempotência e a trilha.
--
-- ⚠️ A LISTA DE ORIGENS É FECHADA. `p_source` acaba na `metadata` da trilha, e
-- um texto livre vindo de fora transformaria o registro de origem em campo que
-- qualquer chamador preenche com qualquer coisa — o que é pior que não existir,
-- porque parece prova.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. As três colunas (§4, §27)
-- ----------------------------------------------------------------------------
-- ⚠️ BACKWARD-COMPATIBLE POR CONSTRUÇÃO (§27). `present` nasce
-- `not null default false`, então toda linha que já existe passa a valer
-- "ausente" sem UPDATE nenhum — nada é reescrito, nada é apagado, e a
-- confirmação de ninguém é tocada. As duas colunas de carimbo nascem nulas, que
-- é a leitura honesta de "esta pessoa nunca fez check-in".
alter table public.event_participants
  add column if not exists present boolean not null default false,
  add column if not exists checked_in_at timestamptz,
  add column if not exists checked_in_by uuid references public.profiles on delete set null;

comment on column public.event_participants.present is
  'Compareceu ao evento. Independente de confirmation — ver a decisao 3 da migration.';

comment on column public.event_participants.checked_in_at is
  'Quando o check-in foi registrado, pelo relogio do BANCO. Nulo enquanto present = false.';

comment on column public.event_participants.checked_in_by is
  'Quem registrou o check-in. Nulo enquanto present = false, e nulo tambem quando a origem nao for uma pessoa.';

-- ============================================================================
-- ⚠️ O ESTADO IMPOSSÍVEL, IMPEDIDO PELO POSTGRES.
-- ============================================================================
-- O §13 manda a reversão limpar os carimbos. Sem este CHECK, isso dependeria de
-- toda escrita futura lembrar — e o resíduo seria cruel: um participante
-- `present = false` com `checked_in_at` preenchido leria, para quem olhasse a
-- tabela, como "ausente que fez check-in às 18h02". Quem investigasse concluiria
-- que o sistema perdeu o estado, e não que ele foi revertido de propósito.
--
-- `checked_in_by` pode ser nulo COM `present = true`, e a assimetria é a
-- decisão 5: um check-in por QR Code não tem operador. O que não pode existir é
-- ausente com carimbo.
alter table public.event_participants
  drop constraint if exists event_participants_presence_consistency;

alter table public.event_participants
  add constraint event_participants_presence_consistency check (
    (present and checked_in_at is not null)
    or (not present and checked_in_at is null and checked_in_by is null)
  );

-- O filtro do §15, dentro de um evento. Espelha
-- `event_participants_event_confirmation_idx`, que existe pelo mesmo motivo.
create index if not exists event_participants_event_present_idx
  on public.event_participants (event_id, present);


-- ----------------------------------------------------------------------------
-- 2. Grants de coluna — DELIBERADAMENTE AUSENTES
-- ----------------------------------------------------------------------------
-- ⚠️ AS TRÊS COLUNAS NÃO ENTRAM NO `grant update (...)` DE `event_participants`,
-- E ISSO É A REGRA SENDO SEGUIDA, NÃO ESQUECIDA.
--
-- `20260922000100` revogou o UPDATE da tabela e o devolveu coluna a coluna;
-- `src/test/sql-column-grants.test.ts` cobra que coluna nova apareça num grant
-- — ou numa lista de exceções COM O MOTIVO. Estas três estão lá, e o motivo é o
-- mesmo de `flow_versions.reviewed_by`:
--
--   ELAS REGISTRAM QUEM AFIRMOU O QUÊ, E QUANDO.
--
-- Um `grant update (checked_in_by)` abriria o caminho do PostgREST, onde o
-- corpo do PATCH é escolhido por quem chama — e alguém poderia gravar que OUTRA
-- PESSOA registrou a presença, às 18h02 de um dia que escolheu. O registro de
-- check-in viraria um campo preenchível, o que é pior que não existir.
--
-- Quem escreve é `set_participant_presence`, SECURITY DEFINER: ela roda como o
-- DONO da tabela, que não passa por grant de coluna nem por RLS. O autor vem de
-- `auth.uid()` e a hora vem de `now()` — nenhum dos dois é escolhido por quem
-- chama.
--
-- ⚠️ E `present` ANDA JUNTO, mesmo sendo um booleano inocente. Com grant nela,
-- um PATCH direto tentaria ligar a presença sem carimbo; o CHECK da seção 1
-- recusaria, e a pessoa receberia um erro de constraint incompreensível vindo
-- de um caminho que não deveria existir. As três são escritas pela mesma
-- função, ou por nenhuma.


-- ----------------------------------------------------------------------------
-- 3. Quem pode o quê (§19)
-- ----------------------------------------------------------------------------
-- ⚠️ CHAVE PRÓPRIA, `presence.*`, E A RAZÃO NÃO É ORGANIZAÇÃO — É QUE O RECORTE
-- DE PAPÉIS É DIFERENTE DO DE `registrations.*`, PELA PRIMEIRA VEZ NESTE MÓDULO.
--
--   presence.read   → admin, comercial   (Administrador e Atendente)
--   presence.write  → admin, comercial   (Administrador e Atendente)
--
-- Compare com o vizinho:
--
--   registrations.write → admin           (só o Administrador)
--
-- ⚠️ A DIFERENÇA É DELIBERADA, e é o mesmo raciocínio que fez o WhatsApp ser o
-- único módulo em que escrever não é mais estreito que ler. Em Documentos,
-- Eventos, Bolsa e Associados o Atendente só lê porque PUBLICAR é decisão de
-- quem responde por aquilo. Marcar quem entrou pela porta do evento NÃO É UMA
-- DECISÃO: é o trabalho de quem está na porta com a lista na mão.
--
-- Uma lista de presença que só o Administrador consegue marcar não é uma lista
-- de presença — é uma tela que alguém olha enquanto anota num papel.
--
-- ⚠️ E A INDEPENDÊNCIA DAS DUAS CHAVES TEM CONSEQUÊNCIA VISÍVEL NA TELA, que é
-- exatamente o §11: o Atendente marca PRESENÇA e vê CONFIRMADO sem poder mexer,
-- porque a confirmação continua sendo `registrations.write`. A tela não inventa
-- uma segunda lógica de confirmação; ela mostra o que existe, com a permissão
-- que já existia.
--
-- Um "Conferente de Portaria" que só marque presença continua possível sem
-- papel novo: é um CARGO criado em /permissions com base `admin` e só as chaves
-- `presence.*` — a forma desenhada em 20260903000100 para o caso "precisa disto
-- e mais nada".

create or replace function public.presence_is_reader()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Sem a válvula de `auth.uid() is null`: a lista carrega nome, e-mail e
  -- telefone de terceiros, e chamada sem sessão não passa. Mesma assimetria de
  -- `registrations_is_reader`.
  select coalesce((select public.current_app_role()) in ('admin', 'comercial'), false);
$$;

comment on function public.presence_is_reader() is
  'Pode abrir a Lista de Presenca de um evento. Administrador e Atendente.';

create or replace function public.presence_is_writer()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select public.current_app_role()) in ('admin', 'comercial'), false);
$$;

comment on function public.presence_is_writer() is
  'Pode marcar e desmarcar presenca. Administrador e Atendente — ver a secao 3 da migration.';

revoke execute on function public.presence_is_reader() from public, anon;
grant execute on function public.presence_is_reader() to authenticated;
revoke execute on function public.presence_is_writer() from public, anon;
grant execute on function public.presence_is_writer() to authenticated;


-- ----------------------------------------------------------------------------
-- 4. A regra de domínio: marcar e desmarcar presença (§12, §13, §17, §20, §22)
-- ----------------------------------------------------------------------------
-- ⚠️ UMA FUNÇÃO PARA OS DOIS SENTIDOS, e não `check_in` + `check_out`. Ligar e
-- desligar são a MESMA operação sobre o mesmo campo, com a mesma cadeia a
-- conferir, a mesma trilha a escrever e a mesma idempotência a garantir. Duas
-- funções seriam duas cópias de tudo isso — e a de desligar, usada dez vezes
-- menos, seria a que deixaria de receber a próxima correção.
--
-- ⚠️ SECURITY DEFINER, E ISSO NÃO É COMODIDADE. Ela grava em
-- `event_registration_audit_logs`, onde `authenticated` NÃO TEM INSERT e não há
-- policy nenhuma — a trilha é fechada de propósito. Uma versão INVOKER
-- funcionaria em toda a bateria de testes e falharia com 42501 no primeiro
-- clique de uma pessoa de verdade, com uma mensagem que manda procurar um grant
-- de coluna que está certo. Isso JÁ ACONTECEU neste módulo (ver
-- 20260927000000 e `src/test/sql-audit-writes.test.ts`).
--
-- ⚠️ E SENDO DEFINER, A PERMISSÃO PRECISA SER CONFERIDA AQUI DENTRO. O DEFINER
-- desliga a RLS: sem o `raise` da primeira linha, qualquer sessão autenticada
-- marcaria presença de qualquer um. É a mesma forma de
-- `set_participant_confirmation`.
create or replace function public.set_participant_presence(
  p_event_id uuid,
  p_participant_id uuid,
  p_present boolean,
  p_source text default 'backoffice'
)
returns public.event_participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.event_participants;
  v_new public.event_participants;
  v_source text := coalesce(nullif(btrim(lower(p_source)), ''), 'backoffice');
begin
  if not public.presence_is_writer() then
    raise exception 'Sem permissão para alterar a presença.' using errcode = '42501';
  end if;

  -- Decisão 5: lista fechada. Um valor desconhecido é erro, e não um texto
  -- livre entrando na trilha.
  if v_source not in ('backoffice', 'qr_code') then
    raise exception 'Origem de check-in desconhecida.' using errcode = '22023';
  end if;

  if p_present is null then
    raise exception 'A presença precisa ser verdadeira ou falsa.' using errcode = '22023';
  end if;

  -- ==========================================================================
  -- ⚠️ §18 — A CADEIA, ANTES DE QUALQUER COISA.
  -- ==========================================================================
  -- `p_participant_id` vem do navegador. Sem o `and p.event_id = p_event_id`, um
  -- id trocado na requisição marcaria presença em OUTRO evento — e a tela de
  -- origem nunca mostraria nada de errado, porque a linha alterada não está
  -- nela. É o mesmo `and` de `set_participant_confirmation`.
  --
  -- A mensagem NÃO distingue "não existe" de "é de outro evento", de propósito:
  -- a diferença entre as duas respostas é um oráculo que confirma a existência
  -- de ids alheios.
  select * into v_old
  from public.event_participants p
  where p.id = p_participant_id
    and p.event_id = p_event_id;

  if not found then
    raise exception 'Participante não encontrado.' using errcode = 'P0002';
  end if;

  -- ==========================================================================
  -- ⚠️ §20 — COMPARE-AND-SET: A CONDIÇÃO ESTÁ DENTRO DO UPDATE.
  -- ==========================================================================
  -- "Apenas mudanças reais de estado devem gerar auditoria." Um `select` →
  -- `if igual then return` → `update` faz isso na maior parte do tempo e perde a
  -- corrida no caso que importa: dois cliques no mesmo instante, ou duas pessoas
  -- com a lista aberta na mesma linha. As duas passariam pelo `if` e as duas
  -- gravariam — duas linhas de trilha dizendo que houve uma mudança que só
  -- aconteceu uma vez.
  --
  -- Com o `is distinct from` no `where`, o segundo UPDATE não casa com linha
  -- nenhuma, `v_new` volta nulo, e a trilha não é escrita. O Postgres serializa
  -- os dois pelo lock da linha; não há janela.
  --
  -- ⚠️ E OS CARIMBOS SÃO CALCULADOS AQUI, NÃO RECEBIDOS (§12, §21, decisão 4).
  -- `now()` é o relógio do banco. `auth.uid()` é a sessão de quem chamou.
  -- Nenhum dos dois passa pelo navegador.
  --
  -- ⚠️ DESLIGAR LIMPA OS DOIS (§13). O histórico do check-in anterior NÃO se
  -- perde: ele está na trilha, que é imutável e não é reescrita por isto. O que
  -- as colunas guardam é o ESTADO ATUAL, e o estado atual de quem não está
  -- presente não tem hora de chegada.
  update public.event_participants
  set present = p_present,
      checked_in_at = case when p_present then now() else null end,
      checked_in_by = case when p_present then (select auth.uid()) else null end,
      updated_by = (select auth.uid())
  where id = p_participant_id
    and event_id = p_event_id
    and present is distinct from p_present
  returning * into v_new;

  if v_new.id is null then
    -- Já estava no valor pedido. É SUCESSO, e não erro: a operação é idempotente
    -- (§20), e quem clicou duas vezes vê o mesmo estado das duas vezes. Devolver
    -- erro aqui faria a tela reverter um toggle que está certo.
    return v_old;
  end if;

  -- ⚠️ O ID DO PARTICIPANTE, NUNCA O NOME OU O E-MAIL. A trilha desta plataforma
  -- não guarda dado pessoal (ver o comentário da tabela em 20260922000100);
  -- quem precisa saber de quem se trata consulta a tabela, que está sob RLS.
  --
  -- ⚠️ E ELA GUARDA O DE/PARA, que é o §5 inteiro: desligar audita tanto quanto
  -- ligar, e as duas linhas coexistem. Reverter uma presença não apaga o
  -- registro de que ela existiu.
  insert into public.event_registration_audit_logs (
    registration_id, event_id, action, actor_id, metadata
  ) values (
    v_new.registration_id,
    v_new.event_id,
    'participant_presence_changed',
    (select auth.uid()),
    jsonb_build_object(
      'participantId', v_new.id,
      'from', v_old.present,
      'to', v_new.present,
      'source', v_source,
      'checkedInAt', v_new.checked_in_at
    )
  );

  return v_new;
end;
$$;

comment on function public.set_participant_presence is
  'Marca ou desmarca a presenca de um participante. Compare-and-set, carimbo do banco e trilha. Ver a decisao 5 sobre p_source.';

revoke execute on function public.set_participant_presence(uuid, uuid, boolean, text)
  from public, anon;
grant execute on function public.set_participant_presence(uuid, uuid, boolean, text)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 5. O quadro, agora com presença (§9, §10, §14, §15, §16)
-- ----------------------------------------------------------------------------
-- Ver a decisão 2. O corpo abaixo é o de 20260929000000 palavra por palavra —
-- os filtros, o fuso do período, a busca por dígitos, a ordenação estável e a
-- paginação. O que entra:
--
--   • `p_presence`  — o filtro do §15 ('all' | 'present' | 'absent')
--   • `present` e `checkedInAt` em cada linha (§10)
--   • `present` e `absent` nas métricas (§9)
--
-- ⚠️ `drop` E RECRIA, e não `create or replace`: a assinatura muda (`p_presence`
-- entrou). Um `create or replace` criaria uma SOBRECARGA, e a chamada por nome
-- de argumento que o PostgREST faz ficaria ambígua — 42725, "function is not
-- unique". É a mesma armadilha que 20260905000000 documenta e que
-- 20260925000100 já enfrentou duas vezes neste módulo.
drop function if exists public.event_registrations_board(
  uuid, text, text, date, date, text, integer, integer
);

create or replace function public.event_registrations_board(
  p_event_id uuid,
  p_query text default null,
  p_confirmation text default null,
  p_from date default null,
  p_to date default null,
  p_sort text default 'recent',
  p_limit integer default 25,
  p_offset integer default 0,
  p_presence text default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_texto text;
  v_digitos text;
  v_limite integer := greatest(1, least(coalesce(p_limit, 25), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_sort text := coalesce(nullif(btrim(lower(p_sort)), ''), 'recent');
  -- ⚠️ O FILTRO DE PRESENÇA VIRA BOOLEANO AQUI, UMA VEZ. Comparar texto dentro
  -- do `where` faria o planejador perder o índice `(event_id, present)`, e um
  -- valor desconhecido cai em nulo — ou seja, "todos" — em vez de derrubar a
  -- tela. Uma URL colada errada não deve parecer "ninguém compareceu".
  v_present boolean := case lower(btrim(coalesce(p_presence, '')))
    when 'present' then true
    when 'absent' then false
    else null
  end;
  -- Os instantes que delimitam o período, no fuso da APCS. Ver o cabeçalho de
  -- 20260925000200.
  v_inicio timestamptz := case
    when p_from is null then null
    else (p_from::timestamp at time zone 'America/Sao_Paulo')
  end;
  v_fim timestamptz := case
    when p_to is null then null
    else ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo')
  end;
  v_resultado jsonb;
begin
  -- A mesma normalização da coluna gerada, aplicada ao que se digitou. As duas
  -- pontas precisam concordar: sem isto, procurar "João" nunca acha "joao".
  v_texto := nullif(
    translate(
      lower(btrim(coalesce(p_query, ''))),
      'áàâãäåéèêëíìîïóòôõöúùûüçñ',
      'aaaaaaeeeeiiiiooooouuuucn'
    ), ''
  );

  -- ⚠️ O TELEFONE PRECISA DE UM SEGUNDO PADRÃO. Quem procura por telefone cola
  -- "(11) 99999-8888" da conversa; a coluna guarda "11999998888". Sem tirar a
  -- máscara do que foi digitado, a busca por telefone simplesmente nunca acha
  -- ninguém — e o §14 pede que ela ache.
  --
  -- Quatro dígitos é o piso: com menos, "11" casaria com metade da base e o
  -- resultado não ajudaria ninguém. Mesmo piso de `buildSearch` em Associados.
  v_digitos := nullif(regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g'), '');
  if v_digitos is not null and char_length(v_digitos) < 4 then
    v_digitos := null;
  end if;

  -- `_` e `%` viram literais: uma granja chamada "100%" não pode virar curinga.
  v_texto := replace(replace(v_texto, '\', '\\'), '%', '\%');
  v_texto := replace(v_texto, '_', '\_');

  with filtrado as (
    select
      p.id            as participant_id,
      p.registration_id,
      p.full_name,
      p.email,
      p.phone,
      p.whatsapp,
      p.confirmation,
      p.present,
      p.checked_in_at,
      r.company_name,
      r.registered_at,
      r.status        as registration_status,
      r.origin
    from public.event_participants p
    join public.event_registrations r on r.id = p.registration_id
    where p.event_id = p_event_id
      -- ⚠️ A CADEIA CONFERIDA NO BANCO (§18). `p.event_id` e `r.event_id` são
      -- mantidos iguais pela FK composta da decisão 3 do Prompt 1; repetir a
      -- condição aqui é o que impede um participante de outro evento de entrar
      -- na página por uma junção mal escrita no futuro.
      and r.event_id = p_event_id

      and (p_confirmation is null
           or p_confirmation = 'all'
           or p.confirmation::text = p_confirmation)

      -- §15 — o filtro principal desta tela.
      and (v_present is null or p.present = v_present)

      and (v_inicio is null or r.registered_at >= v_inicio)
      and (v_fim is null or r.registered_at < v_fim)

      and (
        v_texto is null
        or p.search_text like '%' || v_texto || '%'
        -- A granja: é por isso que existem duas colunas geradas.
        or r.search_text like '%' || v_texto || '%'
        or (v_digitos is not null and p.search_text like '%' || v_digitos || '%')
      )
  ),
  metricas as (
    select
      count(*)                                                          as participants,
      count(*) filter (where confirmation = 'confirmed')                as confirmed,
      count(*) filter (where confirmation = 'not_confirmed')            as not_confirmed,
      -- ⚠️ OS DOIS SÃO CONTADOS, e "ausentes" não é subtração. `participants -
      -- present` daria o mesmo número hoje e é uma conta que depende de
      -- `present` ser `not null` para sempre. Contar as duas condições diz o que
      -- se quer dizer, e continua certo se um dia houver um terceiro estado.
      count(*) filter (where present)                                   as present,
      count(*) filter (where not present)                               as absent,
      count(distinct registration_id)                                   as registrations,
      -- ⚠️ EMPRESAS DISTINTAS PELO NOME NORMALIZADO, e não pelo id da
      -- inscrição: a mesma granja pode ter mandado duas inscrições (dois
      -- grupos, dois momentos), e contá-la duas vezes responderia à pergunta
      -- errada. "Granja ABC" e "granja abc" são a mesma empresa.
      count(distinct translate(lower(btrim(company_name)),
            'áàâãäåéèêëíìîïóòôõöúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn')) as companies
    from filtrado
  ),
  pagina as (
    select f.*,
           row_number() over (
             order by
               case when v_sort = 'company'     then f.company_name end asc,
               case when v_sort = 'participant' then f.full_name end asc,
               case when v_sort = 'recent'      then f.registered_at end desc,
               -- ⚠️ DESEMPATE ESTÁVEL, sempre. Sem ele, duas pessoas inscritas
               -- no mesmo segundo podem trocar de lugar entre a página 1 e a
               -- página 2 — e uma delas some da listagem sem nunca aparecer.
               -- Mesma armadilha que `listLectures` documenta.
               f.registered_at desc,
               f.full_name asc,
               f.participant_id asc
           ) as rn
    from filtrado f
    order by rn
    limit v_limite
    offset v_offset
  )
  select jsonb_build_object(
    -- ⚠️ CHAVE A CHAVE, E NÃO `to_jsonb(m)`. Ver o cabeçalho de 20260929000000:
    -- `to_jsonb` de uma linha nomeia as chaves pelas COLUNAS, e a coluna
    -- `not_confirmed` chegava à aplicação com esse nome enquanto a tela lia
    -- `notConfirmed`. As outras eram palavras únicas e casavam por
    -- coincidência — só a composta quebrou, e em silêncio.
    'metrics', (
      select jsonb_build_object(
        'participants', m.participants,
        'confirmed', m.confirmed,
        'notConfirmed', m.not_confirmed,
        'present', m.present,
        'absent', m.absent,
        'registrations', m.registrations,
        'companies', m.companies
      )
      from metricas m
    ),
    'total', (select participants from metricas),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'participantId', participant_id,
          'registrationId', registration_id,
          'companyName', company_name,
          'fullName', full_name,
          'email', email,
          'phone', phone,
          'whatsapp', whatsapp,
          'confirmation', confirmation,
          'present', present,
          'checkedInAt', checked_in_at,
          'registeredAt', registered_at,
          'registrationStatus', registration_status,
          'origin', origin
        )
        -- Pelo `rn` calculado acima: `jsonb_agg` sem `order by` segue a ordem de
        -- entrada na prática, e isso não é garantido pelo Postgres.
        order by rn
      )
      from pagina
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function public.event_registrations_board is
  'Metricas, pagina e total dos participantes de um evento, com o MESMO filtro. Serve Inscricoes e Lista de Presenca — ver a decisao 2 de 20261001000100.';

-- ⚠️ NÃO É `create or replace` LOGO ACIMA — houve um `drop`, e um `drop` LEVA OS
-- GRANTS JUNTO. Sem estas quatro linhas a função nasceria executável por
-- `public`, o que é o padrão do Postgres e o oposto do que este módulo faz.
--
-- ⚠️ E `checked_in_by` NÃO SAI DAQUI, de propósito. A tela mostra QUANDO (§10);
-- QUEM mora na trilha. Trazê-lo na linha exigiria juntar com `profiles` para ter
-- o nome — e a policy de `profiles` só devolve a PRÓPRIA linha para quem não é
-- administrador, então a coluna apareceria vazia para o Atendente sem nenhum
-- aviso. Um campo que some conforme quem olha é pior que um campo ausente.
revoke execute on function
  public.event_registrations_board(uuid, text, text, date, date, text, integer, integer, text)
  from public, anon;
grant execute on function
  public.event_registrations_board(uuid, text, text, date, date, text, integer, integer, text)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 6. As duas camadas de permissão, semeadas (§19)
-- ----------------------------------------------------------------------------
-- ⚠️ SÓ O TETO NÃO BASTA. `app_role_ceilings` declara o que a RLS entrega a cada
-- PAPEL-BASE, mas quem decide o que uma pessoa vê é o CARGO dela
-- (`app_role_permissions`), semeado em 20260903000100 com uma cópia do teto
-- DAQUELE momento. Uma permissão acrescentada depois entra no teto e não entra
-- em cargo nenhum — e o resultado seria o item "Lista de Presença" invisível até
-- para o Administrador, com a RLS liberada e a tela no ar.
--
-- É a mesma seção 20 de 20260917000100_flows.sql, e existe um teste que recusa
-- uma migration que mexa no teto sem semear (`src/test/sql-role-ceilings.test.ts`).
insert into public.app_role_ceilings (base_role, permission) values
  ('admin', 'presence.read'),
  ('admin', 'presence.write'),
  ('comercial', 'presence.read'),
  ('comercial', 'presence.write')
on conflict do nothing;

insert into public.app_role_permissions (role_key, permission)
select r.key, c.permission
from public.app_roles r
join public.app_role_ceilings c on c.base_role = r.base_role
where r.is_builtin
  and c.permission in ('presence.read', 'presence.write')
on conflict do nothing;


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   delete from public.app_role_permissions
--     where permission in ('presence.read', 'presence.write');
--   delete from public.app_role_ceilings
--     where permission in ('presence.read', 'presence.write');
--
--   drop function if exists public.set_participant_presence(uuid, uuid, boolean, text);
--   drop function if exists public.presence_is_writer();
--   drop function if exists public.presence_is_reader();
--
--   drop index if exists public.event_participants_event_present_idx;
--   alter table public.event_participants
--     drop constraint if exists event_participants_presence_consistency;
--   alter table public.event_participants
--     drop column if exists checked_in_by,
--     drop column if exists checked_in_at,
--     drop column if exists present;
--
--   -- E recriar `event_registrations_board` como está em 20260929000000.
--
-- ⚠️ AS COLUNAS LEVAM O DADO JUNTO. Quem já foi marcado presente deixa de ter
-- registro de estado — a trilha sobrevive (ela é outra tabela), mas a lista
-- volta a zero. Não é uma operação para "desfazer e refazer depois".
-- ============================================================================
