# Palestras

O módulo que controla as palestras da APCS — as que alguém pede pelo chatbot e
as que o time marca por conta própria — do primeiro pedido até o registro de que
aconteceu.

> **Estado:** completo e validado. Backend (PROMPT 1/3), telas (PROMPT 2/3) e QA
> com E2E, segurança e performance (PROMPT 3/3). O que ficou aberto está em §12
> (decisões de negócio) e §14.4 (sugestão de RLS para os outros módulos).

---

## 1. A ideia em um parágrafo

Uma solicitação de palestra **não é uma palestra agendada**. Ela chega, é
analisada, pode ser aprovada ou rejeitada, e só depois vira compromisso na
agenda. O módulo inteiro é desenhado para que esse caminho aconteça **na mesma
linha do banco**: aprovar não cria registro novo, muda o `status`. O protocolo
(`SOL-000042`), a data do pedido e quem pediu seguem os mesmos do primeiro
minuto até a realização — é isso que permite responder "o que houve com a
SOL-000042?" com uma consulta só.

---

## 2. As três decisões centrais

### 2.1 O grafo de status é DADO, não código

As transições permitidas moram na tabela `lecture_status_transitions`. Um
trigger (`lectures_guard`) recusa qualquer passo que não esteja lá — em
**qualquer** caminho de escrita: função Postgres, PostgREST direto, `psql`.

Três consequências práticas:

- mudar o fluxo é um `insert` numa migration, sem reescrever PL/pgSQL;
- o frontend **lê** o grafo (`listStatusTransitions()`) para saber quais botões
  mostrar, em vez de repetir a regra em TypeScript e as duas saírem de sincronia;
- não existe caminho de escrita que escape da regra.

Por isso `lecture.rules.ts` **não tem uma cópia do grafo**: todas as funções
(`canTransition`, `nextStatuses`, `entryStatuses`) recebem o grafo como
parâmetro.

### 2.2 A realização é um ATO, não uma data que passou

Nenhuma rotina marca palestra como realizada porque o calendário virou — o §56
do escopo proíbe. O que existe é uma **leitura derivada** (`lectureStage`): uma
palestra marcada cuja data já passou e que ninguém fechou aparece como
**"Aguardando registro"**.

É o mesmo desenho da expiração de Eventos, pelo mesmo motivo: o projeto não tem
infraestrutura de job (sem cron, sem `pg_cron`, sem worker), e uma rotina que não
roda mente em silêncio. A propriedade que faz isso funcionar é que **a derivação
nunca escreve**: o `status` no banco continua `confirmed`, só a leitura muda.

### 2.3 O §6 do chatbot é uma impossibilidade, não uma checagem

O escopo diz que o chatbot só pode **criar solicitação** — não pode aprovar,
rejeitar, planejar, confirmar, realizar, cancelar, nem definir responsável,
prioridade ou palestrante.

A função `create_lecture_request` **não tem parâmetro para nada disso**. Não há
o que validar, não há o que esquecer de validar, e nenhuma versão futura vai "só
passar o status junto" por descuido: teria que mudar a assinatura, o que aparece
no diff. `origin` e `status` são literais no corpo da função.

---

## 3. O fluxo de status

```
SOLICITADA ──> EM_ANÁLISE ──┬──> APROVADA ──> PLANEJADA ──> CONFIRMADA ──> REALIZADA
                            │
                            └──> REJEITADA (exige motivo)

CANCELADA: sai de qualquer situação NÃO terminal (exige motivo)
```

| Situação (banco) | Rótulo     | Terminal? | Ocupa a agenda? |
| ---------------- | ---------- | --------- | --------------- |
| `requested`      | Solicitada | não       | não             |
| `under_review`   | Em análise | não       | não             |
| `approved`       | Aprovada   | não       | não             |
| `rejected`       | Rejeitada  | **sim**   | não             |
| `planned`        | Planejada  | não       | **sim**         |
| `confirmed`      | Confirmada | não       | **sim**         |
| `held`           | Realizada  | **sim**   | **sim**         |
| `cancelled`      | Cancelada  | **sim**   | não             |

**Pontos de entrada** (com que situação uma palestra pode nascer):

| Entrada     | Quando se usa                                           |
| ----------- | ------------------------------------------------------- |
| `requested` | o pedido — do chatbot, ou anotado por quem atendeu      |
| `planned`   | a APCS decidiu fazer e já está marcando (ninguém pediu) |
| `confirmed` | já estava acordado quando o registro foi criado         |
| `held`      | registro **histórico** de algo que já aconteceu (§53)   |

`under_review` e `approved` não entram: analisar e aprovar pressupõem um pedido
que já existia. `rejected` e `cancelled` também não: não se cadastra uma
palestra já negada.

---

## 4. Estrutura do banco

### `public.lectures`

A linha única de cada palestra. Destaques:

| Coluna                          | Nota                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `protocol`                      | `SOL-000001`. Vem do DEFAULT (sequence), **sem grant de insert nem de update** |
| `origin`                        | `chatbot` \| `internal`. Imutável (trigger + grant)                            |
| `requested_at`                  | Gerada pelo servidor. Imutável (trigger + grant)                               |
| `event_date`                    | Obrigatória desde o pedido — o §7 já coleta "Data desejada \*"                 |
| `start_time` / `end_time`       | `time` sem fuso. Término **estritamente** maior que o início (§13)             |
| `attendees_estimated`           | `> 0` — a ausência de estimativa é NULL, não zero (§18)                        |
| `attendees_actual`              | `>= 0` — zero presentes é um resultado real (§52)                              |
| `speaker_id` / `responsible_id` | `profiles`, `on delete set null`                                               |
| `rejection_reason`              | Existe **se e somente se** `status = 'rejected'`                               |
| `cancellation_reason`           | Existe **se e somente se** `status = 'cancelled'`                              |
| `held_at`, `outcome_notes`      | Só existem em palestra realizada                                               |
| `requester_*`                   | **Snapshot** de quem pediu (ver §5 abaixo)                                     |
| `search_text`                   | Coluna gerada, minúscula e sem acento (ver §7)                                 |
| `idempotency_key`               | Chave **opaca** do chatbot (§59/§60). Sem grant nenhum: só a função escreve    |

### `public.lecture_status_transitions`

O grafo. `from_status` **nulo** = ponto de entrada. A chave é feita de dois
índices parciais em vez de uma PK porque PK não aceita nulo.

### `public.lecture_audit_logs`

A trilha imutável: só aceita INSERT. Legível por `admin` e `ceo`.

### Índices (§50)

| Índice                      | Serve a                                      |
| --------------------------- | -------------------------------------------- |
| `lectures_protocol_key`     | consulta por protocolo (§47) — vem do UNIQUE |
| `(event_date, start_time)`  | calendário (§31) e busca de conflito (§33)   |
| `(status, requested_at ↓)`  | a caixa de entrada                           |
| `(city)`                    | filtro por cidade                            |
| `(responsible_id)` parcial  | "as palestras sob minha responsabilidade"    |
| `(speaker_id)` parcial      | idem, por palestrante                        |
| `(requester_contact_id)`    | consulta do chatbot por contato              |
| `(requested_at ↓, id)`      | a ordenação PADRÃO da grid (§14.2, item 3)   |
| `(idempotency_key)` parcial | retry do chatbot não vira dois protocolos    |

**`origin` não tem índice, e é decisão.** São dois valores: qualquer filtro por
origem seleciona perto de metade da tabela, e o planner prefere varredura
sequencial. Criá-lo custaria escrita em toda inserção sem economizar leitura —
exatamente o "índice redundante" que o §50 manda evitar. O mesmo vale para
`type`, `format` e `priority`.

---

## 5. Solicitante: vínculo **e** snapshot

`requester_contact_id` aponta para `chat_contacts` (quem falou com o bot). Os
campos `requester_name`, `requester_email`, `requester_phone` e
`requester_organization` são **cópia**.

Os dois, e não só o vínculo, porque `chat_contacts` é editável e apagável — há
policy de delete para admin, atendendo ao direito de eliminação da LGPD
(art. 18). Sem o snapshot, atender um pedido de eliminação apagaria junto a
resposta para "quem pediu a SOL-000042?", que é registro operacional da APCS, não
dado de marketing.

---

## 6. Permissões

| Papel (RBAC) | Escopo        | Pode                                                 |
| ------------ | ------------- | ---------------------------------------------------- |
| `admin`      | Administrador | tudo                                                 |
| `ceo`        | Gestor        | tudo                                                 |
| `comercial`  | Atendente     | **só visualizar** (grid, calendário, detalhe, grafo) |
| demais       | —             | nada                                                 |

Duas camadas, contando a mesma história:

1. `PERMISSION_MATRIX` em `src/lib/rbac/rbac.config.ts` — `lectures.read`
   (`admin`, `ceo`, `comercial`) e `lectures.write` (`admin`, `ceo`);
2. RLS nas policies de `lectures`, `lecture_status_transitions` e
   `lecture_audit_logs`.

A **trilha de auditoria é mais estreita que a leitura**: só `admin` e `ceo` a
leem. O Atendente consulta a palestra; o histórico de quem decidiu o quê não é
dele.

> ⚠️ **Esta migration altera uma tabela existente.** Ela acrescenta a policy
> `profiles_select_directory` em `public.profiles`. Ver §11.

---

## 7. Busca sem acento, e por que ela é diferente aqui

Em Eventos e na Bolsa a listagem cabe inteira na memória e o filtro roda em
JavaScript — o que resolve a busca com acento de graça (`normalizeForSearch`).

Aqui não dá: o chatbot gera solicitações continuamente, o §48 exige **paginação
no servidor**, e filtrar _depois_ de paginar devolveria páginas com buracos — a
página 1 com três linhas, a 2 com dezessete.

Então a busca foi para o banco. `lectures.search_text` é uma **coluna gerada**,
minúscula e sem acento, concatenando nome, tema, cidade, protocolo, nome do
solicitante e organização.

Por que `translate()` e não `unaccent`:

- este banco **não tem** as extensões `unaccent` nem `pg_trgm` (conferido);
- `unaccent` não é `IMMUTABLE`, então não poderia ser usado numa coluna gerada
  de qualquer forma. `translate()` é.

`search_text` **não tem índice**: `ilike '%termo%'` só é indexável com
`pg_trgm`. No volume esperado a varredura é barata. **Caminho de crescimento:**
instalar `pg_trgm` e criar um índice GIN com `gin_trgm_ops`.

---

## 8. Conflito de horário (§33)

**Alerta, nunca bloqueio.** O escopo é explícito: pode haver mais de um
palestrante disponível, então quem decide é quem está olhando a tela.

A regra de sobreposição usa o `OVERLAPS` do Postgres, e foi conferida caso a
caso contra este banco antes de virar código:

| Caso                          | Conflita? | Por quê                                      |
| ----------------------------- | --------- | -------------------------------------------- |
| 10:00–11:00 × 10:30–11:30     | sim       | sobreposição parcial                         |
| 10:00–11:00 × 11:00–12:00     | **não**   | encostar não é sobrepor — sequência é normal |
| 10:00–11:00 × 09:00–10:00     | **não**   | idem                                         |
| 10:00–11:00 × 10:00–11:00     | sim       | idênticos                                    |
| 10:00 (sem fim) × 09:00–11:00 | sim       | sem término, ocupa o instante do início      |
| 10:00 (sem fim) × 10:00       | sim       | mesmo instante                               |
| 11:00 (sem fim) × 10:00–11:00 | **não**   | o instante final é aberto                    |

Ocupam a agenda: `planned`, `confirmed`, `held`. Pedido, análise e aprovação
ainda são data _desejada_; rejeitada e cancelada não ocupam nada.

Existem **duas** implementações, e é proposital:

- `find_lecture_conflicts` (Postgres) — a autoridade. Enxerga as palestras que
  não estão na tela;
- `overlaps()` (TypeScript) — para o calendário avisar **enquanto** a pessoa
  arrasta, sem ida ao servidor.

Os mesmos sete casos estão testados nos dois lados.

---

## 9. As operações (as "APIs")

Este projeto **não tem endpoints REST** — a arquitetura é Server Components +
Server Actions + services (ver [ARCHITECTURE.md](./ARCHITECTURE.md)). O §42 do
escopo pede "conforme padrão REST/API já utilizado pelo projeto", e é o que
segue abaixo.

### Leitura — `src/lib/services/lectures.ts`

| Função                  | Escopo | Equivalente REST                       |
| ----------------------- | ------ | -------------------------------------- |
| `listLectures`          | §41,48 | `GET /palestras?filtros&page&sort`     |
| `getLecture`            | §41    | `GET /palestras/{id}`                  |
| `getLectureByProtocol`  | §47    | `GET /palestras/protocolo/{protocolo}` |
| `listLecturesInRange`   | §31    | `GET /palestras/calendario?start&end`  |
| `listStatusTransitions` | §4     | `GET /palestras/transicoes`            |
| `getLectureInbox`       | §57    | `GET /palestras/caixa-de-entrada`      |
| `listLectureCities`     | §32    | `GET /palestras/cidades`               |
| `listLectureAudit`      | §41    | `GET /palestras/{id}/historico`        |
| `findLectureConflicts`  | §33    | `GET /palestras/conflitos?data&hora`   |

### Escrita — `src/lib/actions/lectures.ts`

| Action                           | Escopo | Equivalente REST                    |
| -------------------------------- | ------ | ----------------------------------- |
| `createLectureAction`            | §28,42 | `POST /palestras`                   |
| `updateLectureAction`            | §42    | `PATCH /palestras/{id}`             |
| `setLectureStatusAction`         | §43    | `PATCH /palestras/{id}/status`      |
| `rescheduleLectureAction`        | §34,44 | `PATCH /palestras/{id}/schedule`    |
| `assignLectureResponsibleAction` | §45    | `PATCH /palestras/{id}/responsavel` |
| `assignLectureSpeakerAction`     | §46    | `PATCH /palestras/{id}/palestrante` |
| `registerLectureOutcomeAction`   | §26    | `PATCH /palestras/{id}/realizacao`  |
| `checkLectureConflictsAction`    | §33,34 | `GET /palestras/conflitos`          |

### Chatbot — `src/lib/services/lecture-chatbot.ts`

| Função                        | Escopo | Nota                                |
| ----------------------------- | ------ | ----------------------------------- |
| `createLectureRequest`        | §40,58 | devolve protocolo + situação        |
| `getLectureRequestByProtocol` | §60    | **exige o `contactId` da conversa** |

`getLectureRequestByProtocol` amarrar a consulta a quem pediu não é zelo: o
protocolo é sequencial e previsível, e sem essa amarração varrer de `SOL-000001`
a `SOL-000999` devolveria o mapa de quem pediu palestra para a APCS, com cidade e
tema. O contato vem do cookie httpOnly da conversa, nunca de algo digitado.

---

## 9.1 As telas

### Rotas

| Rota                  | O que é                                     |
| --------------------- | ------------------------------------------- |
| `/lectures`           | grid paginada, filtros, busca, ordenação    |
| `/lectures/calendar`  | calendário (mensal, semanal, diária, anual) |
| `/lectures/[id]`      | detalhe, ações e histórico                  |
| `/lectures/[id]/edit` | edição dos campos descritivos               |
| `/lectures/new`       | cadastro interno                            |

> **Por que `/lectures` e não `/palestras`.** O escopo escreve as rotas em
> português, mas o CLAUDE.md do projeto é explícito: código e rotas em inglês,
> texto de tela em PT-BR. Todas as rotas existentes seguem isso (`/events`,
> `/market`, `/documents`). O menu diz **Palestras**.

### Menu

Seção própria na navegação, com **Calendário** e **Palestras**. O contador de
solicitações pendentes (§40) fica no item _Palestras_, e não no Calendário: uma
solicitação nova ainda **não tem data marcada**, então ela não está no
calendário — está esperando na lista.

O número vem de `countPendingLectures()`, uma contagem sem trazer linha
(`head: true`), apurada no layout e só para quem tem `lectures.read`.

### Componentes

| Componente                    | Papel                                                 |
| ----------------------------- | ----------------------------------------------------- |
| `LectureFiltersBar`           | os filtros — **o mesmo** na grid e no calendário      |
| `LecturePagination`           | paginação server-side, feita de links                 |
| `LectureForm`                 | dois formulários (cadastro e edição), não um com `if` |
| `LectureActions`              | a barra de ações do detalhe + o retorno de sucesso    |
| `LectureStatusDialog`         | transições — lidas do grafo, não de uma lista fixa    |
| `LectureScheduleDialog`       | reagendar; serve ao botão E ao arrastar-e-soltar      |
| `LectureAssignDialog`         | responsável e palestrante                             |
| `LectureOutcomeDialog`        | resultado da realização                               |
| `LectureConflictAlert`        | o aviso do §25                                        |
| `LectureHistory`              | a trilha traduzida para linguagem de tela             |
| `CalendarToolbar`             | navegação e troca de visão (links)                    |
| `CalendarBoard`               | o único pedaço de cliente do calendário               |
| `CalendarMonth/Week/Day/Year` | as quatro visões                                      |
| `LectureChip`                 | uma palestra dentro do calendário                     |
| `ProtocolCopy`                | protocolo em destaque + copiar (§46)                  |

### O calendário

| Visão   | Período buscado          | Arrasto |
| ------- | ------------------------ | ------- |
| Mensal  | semana da 1ª à da última | sim     |
| Semanal | segunda a domingo        | sim     |
| Diária  | um dia                   | sim     |
| Anual   | 1º de janeiro a 31/12    | **não** |

A mensal pede um pouco **mais** que o mês porque a grade mostra as pontas dos
meses vizinhos — sem elas aqueles dias apareceriam sempre vazios, parecendo que
não há palestra quando há.

A anual não aceita arrasto de propósito: uma célula de dia naquela escala tem
poucos pixels, e errar o dia num calendário de ano inteiro é mais fácil que
acertar. Quem quer remarcar desce para o mês.

**Arrastar não reagenda.** Soltar abre a confirmação que o §26 exige, e a
palestra só muda de lugar depois que o servidor responde (§27). Se ele recusar,
nada foi movido — não há o que desfazer (§28). Ao mover o horário, a **duração
acompanha**: uma palestra de 09:00–10:00 solta às 15:00 vira 15:00–16:00.

O arrasto exige mouse — é uma limitação real da API de drag-and-drop do HTML.
Quem navega por teclado reagenda pelo botão **Reagendar** na tela da palestra: o
mesmo caminho, a mesma action, a mesma confirmação. O calendário anuncia isso em
texto, em vez de fingir que a funcionalidade está lá para todo mundo.

### Estado de tela na URL

Filtros, ordenação, página, visão e data do calendário moram todos na URL. Isso
faz três coisas de uma vez: o servidor pode renderizar (não há estado escondido
no cliente), o endereço pode ser compartilhado, e **alternar entre grid e
calendário preserva o recorte** (§48) sem ninguém sincronizar nada — as duas
telas usam a mesma serialização, em `lecture.routes.ts`.

Um valor que não pertence ao domínio vira "sem filtro", nunca uma lista vazia:
uma URL colada errada não deve parecer "não há nada aqui" — e um valor arbitrário
nunca chega ao SQL.

### Selos de situação

São oito situações para as quatro variantes do design system, então algumas
**compartilham a cor** — e isso é a decisão, não uma limitação sofrida. A cor é o
sinal secundário: separa "pede ação" de "em curso" de "encerrado", que é o que se
lê varrendo a grid com o olho. Quem é qual está escrito dentro do próprio selo.
Nenhuma cor nova foi criada.

A única situação que usa `alert` é a etapa derivada **"Aguardando registro"** —
a data passou, a palestra estava marcada, e ninguém disse se aconteceu. É a única
coisa no módulo que merece "precisa de olho humano".

---

## 10. Códigos de erro

Classe **`PL`** — própria porque a classe `P0` é **reservada** pelo PL/pgSQL
(`P0004` é `assert_failure`, que `exception when others` não captura). Mesmo
motivo das classes `EV` (Eventos) e `MB` (Bolsa).

| Código  | Significado                       | Mensagem em `errors.ts`       |
| ------- | --------------------------------- | ----------------------------- |
| `42501` | sem permissão                     | `forbidden`                   |
| `P0002` | palestra não encontrada           | `notFound`                    |
| `PL001` | transição de status não permitida | `lectureTransitionNotAllowed` |
| `PL002` | campo imutável                    | `lectureFieldImmutable`       |
| `PL003` | o status atual não permite        | `lectureStatusBlocksAction`   |
| `PL004` | motivo obrigatório ausente        | `lectureReasonRequired`       |
| `PL005` | falta horário para confirmar      | `lectureNeedsTime`            |
| `PL006` | usuário informado não existe      | `lectureProfileNotFound`      |

---

## 11. ⚠️ Mudança em tabela existente: o diretório de perfis

A migration acrescenta uma policy a `public.profiles`.

**O problema encontrado:** a policy `profiles_select_own_or_admin` deixa cada
usuário ver **apenas o próprio perfil** (admin vê todos). Isso quebra dois
requisitos:

- o §21 e o §45 exigem que o **Gestor** atribua um responsável — e sem ler
  `profiles` ele não tem lista para escolher;
- o nome do responsável e do palestrante apareceria **vazio** na grid para todo
  mundo que não fosse admin.

O segundo problema **já existe hoje, em silêncio**, com o "cadastrado por" de
Eventos e o "publicado por" da Bolsa.

**A correção:**

```sql
create policy "profiles_select_directory"
  on public.profiles for select
  using (
    public.current_app_role() in ('admin', 'ceo', 'comercial', 'pm', 'tech_lead', 'financeiro')
  );
```

Quem opera o CRM vê o diretório de quem opera o CRM. Não é dado de terceiro — são
colegas de uma empresa só, que é o que este produto é. `viewer` fica **de fora**:
é o papel de entrada (todo usuário novo nasce nele) e continua vendo só o próprio
perfil.

> **Esta é uma decisão de segurança que vale conferir.** Se a APCS preferir não
> expor o e-mail dos colegas, o caminho é trocar a policy por uma _view_
> `profile_directory (id, full_name, role)` com privilégios de definidor — mais
> restrita, mas aparece como alerta "Security Definer View" no advisor do
> Supabase. O rollback da policy está no rodapé da migration.

---

## 12. GAPs e decisões provisórias

Registrados, não inventados. Todos esperam decisão de negócio.

### G1 — "Nome" no chatbot: da palestra ou de quem pede? 🔴

O §7 manda o chatbot coletar **"Nome \*"** e o §29 lista **`nome`** e
**`nome_solicitante`** como campos distintos. As duas coisas não fecham: o bot
coleta um nome só.

**Como está:** a solicitação nasce com `name = requester_name`. A função
`create_lecture_request` já tem o parâmetro `p_name` pronto para receber um
título separado, se a resposta for essa.

**O que decidir:** o chatbot deve perguntar também um título para a palestra, ou
o nome de quem pede basta para identificá-la na grid?

### G2 — Palestrante externo não tem onde ser cadastrado 🔴

O §20 pede `palestrante_id`. As únicas tabelas de pessoas do projeto são
`profiles` (usuários do CRM) e `chat_contacts` (quem falou com o bot).
Implementado como `profiles`, seguindo o §72 ("reutilizar entidades existentes").

**O que isso impede:** registrar um especialista convidado que não tem conta no
CRM.

**O que decidir:** a APCS convida palestrantes de fora? Se sim, é preciso um
catálogo `lecture_speakers` (nos moldes de `event_segments`) — uma migration e um
CRUD simples.

### G3 — Não existe volta no fluxo 🟡

O §5 desenha o fluxo só para a frente, e o escopo manda não inventar regra de
negócio. Então `confirmed → planned`, `approved → under_review` etc. **não
existem**.

**O caso concreto que isso deixa sem saída:** a palestra confirmada cujo
palestrante desiste. Hoje ela só pode ser **cancelada** — e cancelar é terminal,
então retomar exigiria um registro novo, com protocolo novo, contrariando o
espírito do §67.

**O que decidir:** liberar quais voltas? É um `insert` em
`lecture_status_transitions`, sem código.

### G4 — Não existe central de notificações 🟡

O §57 pede "gerar evento/notificação interna conforme arquitetura existente".
Conferido: o projeto **não tem** tabela de notificação, job, canal nem central.

**Como está:** a chegada de uma solicitação grava uma linha de trilha
(`lecture_created`, transacional) e `getLectureInbox()` devolve o contador que
vira badge — que é o que o §57 pede de concreto.

**O que falta para uma central de verdade:** uma tabela `notifications`, um
conceito de "lido/não lido" por usuário, e uma decisão sobre canal (só in-app?
e-mail? WhatsApp?). É módulo próprio.

### G5 — O motivo da rejeição não vai para o chatbot 🟡

`ChatbotLecture` (o recorte que sai para fora da APCS) **não inclui**
`rejection_reason`.

**Por quê:** o motivo é anotação interna ("agenda cheia", "tema fora do
escopo", ou algo bem menos diplomático). Repassá-lo cru para a pessoa que pediu
é o tipo de vazamento que só se descobre depois de acontecer.

**O que decidir:** o que comunicar a quem teve o pedido recusado? Um texto
padrão? O motivo real? Um campo separado "mensagem ao solicitante"?

### D1 — Decisão provisória: `held_at` herda a data da palestra

Ao marcar como realizada, `held_at = event_date`. Deixar nulo obrigaria um
segundo passo para gravar o que já se sabe. `register_lecture_outcome` corrige,
se a palestra aconteceu em outra data.

### D2 — Decisão provisória: cancelar é sempre terminal

O §54 não diz de onde se cancela. Implementado como: de qualquer situação **não
terminal**. `held` fica de fora porque cancelar uma palestra que já aconteceu
faria o registro mentir; `rejected` porque não se recusa duas vezes.

---

## 13. Validação executada

**158 casos SQL contra o banco real**, numa transação revertida (migration +
testes + `rollback`). Cobertura por seção do escopo:

| Bloco | O que prova                                                        | Casos |
| ----- | ------------------------------------------------------------------ | ----- |
| A     | protocolo: formato, unicidade, imutabilidade (grant **e** trigger) | 6     |
| B     | origem e data da solicitação imutáveis                             | 4     |
| C     | pontos de entrada válidos e inválidos                              | 9     |
| D     | o fluxo inteiro, os pulos, a volta, o cancelamento                 | 21    |
| E     | motivos obrigatórios em rejeição e cancelamento                    | 7     |
| F     | regras de horário                                                  | 7     |
| G     | tipo OUTROS nos dois sentidos                                      | 6     |
| H     | participantes estimados (`> 0`) e realizados (`>= 0`)              | 6     |
| I     | conflito: os sete casos + status que não ocupam + não bloqueia     | 14    |
| J     | permissões dos quatro papéis, trilha e grafo protegidos            | 17    |
| K     | chatbot: assinatura sem §6, service_role, origem não forjável      | 18    |
| L     | reagendamento não duplica e preserva protocolo                     | 9     |
| M     | atribuições, idempotência, desatribuição                           | 8     |
| N     | realização como ato; data passada NÃO vira realizada sozinha       | 8     |
| O     | busca sem acento                                                   | 4     |
| P     | diretório de perfis                                                | 3     |
| Q     | auditoria: ações, diff, autor congelado, sem ruído                 | 6     |
| S     | índices, grafo completo, exclusão física impossível                | 5     |

**640 testes Vitest** no total do projeto (244 de Palestras, em `lecture.rules`,
`lecture.schema`, `lecture.calendar`, `lecture.routes`, `lecture-status-dialog`,
`lecture-schedule-dialog`, `lecture-xss`, `actions/lectures` e
`services/lecture-chatbot`).

### O que a conferência no navegador encontrou

As telas foram exercitadas contra o banco real, com uma fixture temporária que
depois foi apagada (produção voltou a 0 palestras, 0 trilha, sequência em
`SOL-000001`). Três defeitos apareceram ali, e nenhum deles apareceria em teste
de unidade isolado:

1. **O alerta de conflito era apagado no instante em que nascia.** No calendário,
   `onDone` desmontava o diálogo junto com a mensagem de sucesso — o
   reagendamento acontecia e o aviso nunca era visto. Quem fecha o diálogo passou
   a ser o próprio diálogo.
2. **Arrastar quebrava o horário.** Uma palestra de 09:00–10:00 solta às 15:00
   abria a confirmação com término 10:00 — antes do início — e o botão já nascia
   bloqueado, sobre um campo em que ninguém encostou. Agora a duração acompanha o
   arrasto (`shiftedEndTime`).
3. **"Agosto de 2026" virava "Agosto De 2026".** A classe `capitalize` do
   Tailwind põe maiúscula em toda palavra; o rótulo já vinha na caixa certa.

Um quarto foi encontrado pelos próprios testes, antes do navegador: `suggested`
é um objeto literal recriado a cada render, e depender dele no `useEffect` fazia
o efeito rodar de novo a cada renderização, limpando o estado do diálogo.

Mapa do §66 (o que ele pede → onde está provado):

| §66 pede      | SQL        | Vitest                |
| ------------- | ---------- | --------------------- |
| criação       | C, G, J11  | cadastro interno      |
| edição        | G5, Q      | edição                |
| status        | D          | grafo de status       |
| protocolo     | A          | formato do protocolo  |
| chatbot       | K          | chatbot (§6, §7, §60) |
| conflito      | I          | conflito de horário   |
| reagendamento | L          | reagendamento         |
| permissões    | J, P       | —                     |
| cancelamento  | D17–D21, E | situação              |
| rejeição      | D13–D16, E | situação              |

---

## 14. QA final (PROMPT 3/3)

### 14.1 O que foi rodado

| Bateria                              | Onde                            | Resultado |
| ------------------------------------ | ------------------------------- | --------- |
| QA SQL do PROMPT 3, banco real       | transação revertida             | 200 casos |
| Correção de mensagem + idempotência  | migration `20260817000000`      | 37 casos  |
| Correção de RLS/InitPlan             | migration `20260818000000`      | 30 casos  |
| Autorização chamando a action direto | `actions/lectures.test.ts`      | 71 casos  |
| Chatbot: contrato, idempotência, §60 | `services/lecture-chatbot.test` | 25 casos  |
| XSS: escapagem na saída              | `lecture-xss.test.tsx`          | 15 casos  |
| Fluxo E2E completo                   | navegador, banco real           | §101      |

O fluxo do §101 foi percorrido de ponta a ponta pelas telas, começando por uma
solicitação criada pela porta REAL do chatbot (`create_lecture_request` com
`service_role`):

```
chatbot → Solicitada → Em análise → Aprovada → responsável → palestrante
        → Planejada → Confirmada → Realizada → resultado registrado
```

Ao final, a trilha da SOL-000077 tinha as **nove** linhas correspondentes, e o
banco confirmou `status = held`, `held_at = 2026-09-15`, `attendees_actual = 63`.
Também foram percorridos rejeição (com e sem motivo), cancelamento, reagendamento
com conflito, e o calendário nas quatro visões.

### 14.2 Os cinco defeitos que o QA encontrou

Nenhum foi achado lendo código: todos apareceram exercitando o sistema.

**1. A mensagem culpava o campo errado.** Tentar `rejeitada → confirmada` devolvia
_"Informe o horário de início antes de confirmar a palestra."_ A operação era
recusada — a segurança nunca esteve em risco, o trigger barra de qualquer jeito.
O problema é que a frase mandava fazer uma coisa que não resolve: quem
preenchesse o horário tentaria de novo e seria recusado outra vez, agora sem
pista nenhuma. Causa: as pré-condições rodavam antes de alguém perguntar se
aquele caminho existe. Corrigido em `20260817000000` — o grafo é consultado
primeiro.

**2. Retry técnico virava dois protocolos.** `create_lecture_request` não tinha
chave de idempotência: uma conexão que cai depois do insert e antes da resposta
faz o cliente tentar de novo, e a pessoa recebia dois números para o mesmo
pedido. Corrigido em `20260817000000` com chave **opaca** e índice único parcial
— nunca derivada de nome/data, porque duas solicitações iguais em dias diferentes
são pedidos legítimos (§59/§60).

**3. A RLS chamava `current_app_role()` uma vez por linha.** Medido com 20.000
palestras:

| Consulta               | Antes  | Depois  | Ganho |
| ---------------------- | ------ | ------- | ----- |
| contagem exata da grid | 376 ms | 6,4 ms  | 59×   |
| grid, página 1         | 389 ms | 13,4 ms | 29×   |
| contador do menu       | 377 ms | 8,8 ms  | 43×   |
| calendário do ano      | 128 ms | 5,8 ms  | 22×   |

A pista foi o custo ser o **mesmo** em consultas que fazem coisas diferentes —
contar, ordenar, filtrar. Custo por linha, não por trabalho. A função já era
`STABLE`, e isso não basta: dentro de um `USING` ela só é avaliada uma vez se
estiver embrulhada num subselect escalar, que vira `InitPlan`. Corrigido em
`20260818000000`, junto com um índice para a ordenação padrão da grid. A lógica
de quem vê o quê não mudou — reconferida nos 17 casos de papel.

**4. Página além do fim virava tela de erro.** Quem guardou nos favoritos a
página 3 de um filtro que hoje devolve dez linhas via _"Não foi possível carregar
as palestras"_ (PGRST103). Acontece também quando uma mudança de situação encolhe
a lista sob os próprios pés. Agora é uma página vazia com a contagem verdadeira e
um botão "Voltar para a primeira página" que **mantém os filtros**.

**5. Quem estava definido aparecia como "Não definido".** Uma palestra com
palestrante atribuído mostrava "Não definido" porque aquele perfil ainda não tinha
`full_name`. Quem acabou de atribuir olhava a tela e concluía que a operação
falhou — o pior tipo de erro, o que mente com cara de verdade. Corrigido com
`actorLabel()`: nome → e-mail → aviso explícito, e `null` só quando não há
ninguém. O e-mail já era mostrado pelo seletor de responsável ao mesmo público.

**Bônus, mesma família do #4:** `/lectures/nao-e-uuid` ia ao banco, o Postgres
recusava e a tela dizia "Não foi possível carregar" — falha de sistema para o que
é só um endereço que não existe. Agora `isLectureId` responde "não encontrada", e
entrada malformada deixa de virar consulta.

### 14.3 Segurança conferida

| Verificação                     | Como foi provada                                              |
| ------------------------------- | ------------------------------------------------------------- |
| Atendente não escreve pela API  | 71 casos chamando cada action direto; `rpc` nunca é chamado   |
| Atendente não escreve pela RLS  | `update` direto afeta **0 linhas**; contraprova com admin: 1  |
| Ninguém apaga palestra          | sem `DELETE` para `authenticated`, nem para admin             |
| Trilha imutável                 | `update`/`delete` negados para admin, gestor e atendente      |
| Porta do chatbot fechada        | `42501` para admin, atendente e anônimo; só `service_role`    |
| Origem `chatbot` não é forjável | policy de insert exige `origin = 'internal'`                  |
| XSS                             | 15 casos de render + payload real na tela; nada executa       |
| SQL injection                   | payloads em busca, filtros, motivo e id; tabela intacta       |
| `%` e `_` não vazam a base      | escapados; a busca volta vazia                                |
| Erro interno não vaza           | **conferido no build de produção**: sem PGRST, SQL ou caminho |

⚠️ Sobre o item "erro interno": em **desenvolvimento** o Next serializa a
mensagem do servidor no payload RSC, então `PGRST103` aparece no HTML de dev.
Isso foi verificado contra o build de produção (`pnpm build` + servidor real), e
lá não aparece — nem código, nem SQL, nem caminho de arquivo, nem segredo.

### 14.4 Sugestão registrada (§102) — não implementada

**As outras tabelas do projeto têm o mesmo problema de RLS do defeito #3.**
`events`, `market_bulletins`, `documents`, `chat_*` e as demais policies de
`profiles` chamam `current_app_role()` / `auth.uid()` sem o subselect escalar. O
custo é o mesmo medido acima: ~1,3 ms por linha lida.

Não foi corrigido de propósito. O §82 manda não alterar funcionalidade existente
sem necessidade e o §102 manda registrar melhoria como sugestão em vez de mudar o
escopo em silêncio. A correção é mecânica (embrulhar cada chamada em
`(select ...)`) e cabe numa migration própria, com os testes de papel de cada
módulo. **Fica para decisão.**

---

## 15. O que fica para depois

**Fora dos três prompts** (dependem de decisão de negócio):

- **ligar o fluxo de palestras ao `decide.ts` do chat.** Hoje existe a PORTA
  (`create_lecture_request`, testada e idempotente), mas não a CONVERSA: o motor
  do chat é moldado no CSP (`CspCollected`, `renderCspContent`, `csp_leads`) e o
  enum `chat_flow_key` só tem `'csp'`. Um fluxo de Palestras exige migration para
  o enum, um catálogo de conteúdo aprovado, um schema de extração próprio e
  seleção de fluxo no widget — trabalho de módulo, não de ajuste. Ver
  [CHAT.md](./CHAT.md);
- a sugestão de RLS do §14.4;
- as decisões G1 a G5.
