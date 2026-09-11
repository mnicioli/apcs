-- ============================================================================
-- AVALIAÇÃO DE EVENTO — os enums (Prompt 2, §4, §5, §8, §36)
-- ============================================================================
-- ⚠️ ARQUIVO SEPARADO, E NÃO É CERIMÔNIA. Duas coisas obrigam a separação neste
-- projeto, e só uma delas se aplica aqui:
--
--   1. `alter type ... add value` e o USO do valor novo não podem dividir
--      transação — o Postgres recusa com "unsafe use of new value of enum type".
--      É o caso de 20261001000000, que acrescentou um valor à trilha de
--      inscrições.
--
--   2. `create type` NÃO tem essa restrição: o tipo nasce usável no mesmo
--      arquivo. Mesmo assim os enums de um domínio novo moram sozinhos aqui,
--      como em 20260922000000 (Landing Pages), 20260925000000 (Inscrições) e
--      20260917000000 (Fluxos). O motivo é operacional: no dia em que um valor
--      precisar ser ACRESCENTADO, o arquivo já existe e a regra 1 já está
--      respeitada sem ninguém precisar lembrar dela.
--
-- `src/test/sql-enum-values.test.ts` guarda as duas coisas: valor citado por
-- função que o banco não conhece, e `add value` usado na mesma migration.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Tipo de pergunta (§4)
-- ----------------------------------------------------------------------------
-- ⚠️ CINCO TIPOS, E O ESCOPO PEDE EXATAMENTE ESTES. "Não implementar um
-- construtor extremamente complexo" — então nada de matriz, nada de NPS, nada de
-- data, nada de upload. Os cinco cobrem o formulário que a APCS usa hoje e o
-- que ela descreveu querer.
--
-- ⚠️ `rating` E `single_choice` SÃO PARENTES E NÃO SÃO A MESMA COISA. Os dois
-- guardam UMA opção escolhida; a diferença é que `rating` promete que toda opção
-- tem `value` numérico e que a ordem dele significa alguma coisa ("5 é melhor
-- que 4"). É o que o Prompt 3 vai somar e tirar média. Um `single_choice`
-- ("almoçou no evento?": sim/não/não sei) não tem média nenhuma, e tratá-lo como
-- nota produziria o número mais confiante e mais errado do painel.
create type public.event_evaluation_question_type as enum (
  'rating',
  'single_choice',
  'multiple_choice',
  'yes_no',
  'free_text'
);

comment on type public.event_evaluation_question_type is
  'Tipos de pergunta da avaliacao (§4). rating promete value numerico ordenavel; single_choice nao.';


-- ----------------------------------------------------------------------------
-- 2. Ciclo de vida da avaliação de UM participante (§8)
-- ----------------------------------------------------------------------------
-- ⚠️ O ESTADO É DO PARTICIPANTE, e não do evento. O §8 lista os estados sem
-- dizer de quem eles são, e a resposta importa: "enviada" e "respondida" só
-- existem por pessoa. Um evento com 300 presentes tem 300 linhas caminhando
-- por esta máquina, cada uma no seu passo.
--
-- O grafo, e ele é quase todo de mão única:
--
--        pending ──► scheduled ──► sent ──► answered
--                        │           │
--                        │           ├──► expired
--                        │           └──► scheduled   (reenvio, §17)
--                        ├──► expired
--                        └──► cancelled
--
-- ⚠️ `pending` E `scheduled` NÃO SÃO REDUNDANTES, e a diferença é o §14. A linha
-- nasce `scheduled` quando o job a cria já sabendo a hora do disparo. `pending`
-- é o estado de quem existe e AINDA NÃO TEM hora — hoje só acontece quando o
-- evento perde o horário de término depois da linha criada. Sem ele, esse caso
-- viraria uma linha `scheduled` para um instante que ninguém consegue calcular,
-- e a fila tentaria enviá-la para sempre.
--
-- ⚠️ NÃO EXISTE `failed`. Falha de envio é `scheduled` com `last_error`
-- preenchido e `attempts` incrementado — porque falha é TENTATIVA, não destino:
-- a linha continua na fila e a próxima passada a pega. Um estado terminal de
-- falha exigiria alguém para tirá-la de lá, e é exatamente o tipo de fila que
-- ninguém olha. É o mesmo desenho de `survey_recipient_status`.
create type public.event_evaluation_status as enum (
  'pending',
  'scheduled',
  'sent',
  'answered',
  'expired',
  'cancelled'
);

comment on type public.event_evaluation_status is
  'Situacao da avaliacao de UM participante (§8). Falha de envio nao e estado: e scheduled com last_error.';


-- ----------------------------------------------------------------------------
-- 3. Trilha (§36)
-- ----------------------------------------------------------------------------
-- ⚠️ O §36 PEDE OITO COISAS E ESTA LISTA TEM DEZ. As duas a mais são
-- `invitation_failed` e `evaluation_answered`, e nenhuma das duas é zelo:
--
--   • sem `invitation_failed`, "por que fulano não recebeu?" só tem resposta
--     enquanto `last_error` não for sobrescrito pela tentativa seguinte;
--   • sem `evaluation_answered`, a única marca de que alguém respondeu é
--     `answered_at` na própria linha — e o §19 prevê REABRIR a avaliação, que
--     é justamente a operação que apaga essa marca.
--
-- ⚠️ O QUE NÃO ESTÁ AQUI: abrir o link, ver a pergunta, trocar de página. O §36
-- é explícito ("não é necessário auditar cada clique"), e uma trilha que cresce
-- por visualização deixa de ser lida no dia em que alguém precisa dela.
create type public.event_evaluation_audit_action as enum (
  'evaluation_created',
  'settings_changed',
  'structure_changed',
  'version_published',
  'invitation_sent',
  'invitation_failed',
  'invitation_resent',
  'invitation_cancelled',
  'evaluation_answered',
  'evaluation_reopened'
);

comment on type public.event_evaluation_audit_action is
  'Acoes auditadas da avaliacao de evento (§36). Nao inclui navegacao nem visualizacao.';


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   drop type if exists public.event_evaluation_audit_action;
--   drop type if exists public.event_evaluation_status;
--   drop type if exists public.event_evaluation_question_type;
--
-- ⚠️ SÓ DEPOIS de 20261002000100, que é quem usa os três. Rodar antes falha com
-- "cannot drop type because other objects depend on it" — e a mensagem, apesar
-- de assustadora, é o Postgres protegendo os dados.
-- ============================================================================
