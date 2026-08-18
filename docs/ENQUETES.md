# Enquetes

O módulo que permite à APCS **perguntar algo à sua base** e consolidar o que
voltou. A enquete sobre o valor da @ do suíno é o primeiro exemplo — e é apenas
um seed. Nenhuma linha da estrutura conhece o assunto de nenhuma enquete.

> **Estado:** PROMPT 1/3, 2/3 e 3/3 entregues — banco, regras, APIs, telas,
> mensageria, fila, webhook e observabilidade.
>
> ⚠️ **O disparo por WhatsApp está IMPLEMENTADO mas NÃO LIGADO.** Falta a conta
> da Meta e quatro variáveis de ambiente — nada de código. Enquanto elas não
> existirem, o sistema **recusa alto** em vez de fingir que enviou. Ver a
> seção 18.

---

## ⚠️ Leia isto antes de prometer o módulo a alguém

Três coisas que o escopo pede **não existem neste sistema**, e nenhuma delas é
uma decisão de implementação — são ausências de infraestrutura. Estão descritas
em detalhe na seção [GAPs](#gaps), mas em uma frase cada:

| #   | O que falta                | Efeito prático                                                                                                                                                                                                                              |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Cadastro de associados** | 3 das 6 dimensões de segmentação do §23 (Segmento, Categoria, Carteira) não têm onde se apoiar e são **recusadas** com mensagem explicativa. Região, Perfil, contatos específicos e "toda a base" funcionam.                                |
| 2   | **Conta de WhatsApp**      | O código do disparo, do webhook e do chatbot está pronto e testado com fornecedor falso. Falta a **conta Meta aprovada + 4 variáveis**. Sem elas o disparo recusa com "O envio por WhatsApp ainda não está integrado. Falta configurar: …". |
| 3   | **Gatilho do cron**        | A rota `/api/jobs/surveys` faz tudo (ativa, encerra, destrava, dispara) e é idempotente. Falta **agendar a chamada** — três linhas no `vercel.json` e um segredo. Ver a seção 22.                                                           |

O GAP 2 mudou de natureza no PROMPT 3/3: antes era "não existe integração";
agora é "existe e está desligada". A diferença importa para quem planeja — não
há mais desenvolvimento no caminho, só configuração.

---

## 1. As quatro decisões que estruturam o módulo

### 1.1 O portão da resposta é calculado, nunca confiado ao relógio de ninguém

`survey_response_gate()` confere **situação e janela de datas a cada resposta**.
O §16 é explícito ("o backend deverá validar essa regra; não depender apenas de
cron/frontend"), e aqui isso não é uma recomendação seguida: é a única porta.

A consequência que importa: **se a rotina de encerramento nunca rodar, uma
enquete vencida continua recusando resposta.** Ela só não muda de rótulo. Foi
medido contra o banco real — uma enquete com `status = 'active'` e `ends_at` no
passado devolve `closed` no portão e não grava nada.

É o mesmo desenho da expiração derivada de Eventos, pelo mesmo motivo: rotina que
não roda mente em silêncio.

### 1.2 A tabela de respostas não tem policy de SELECT. Nenhuma.

O §54 manda esconder **quem** respondeu numa enquete anônima. RLS filtra LINHA,
não COLUNA, e não existe policy que diga "esconda `contact_id` se a enquete for
anônima".

Então `survey_responses` é **ilegível pelo PostgREST**, ponto — inclusive para o
admin. Toda leitura passa por três funções `SECURITY DEFINER` que aplicam a regra
antes de devolver qualquer coisa:

| Função                | O que devolve                         | Anonimato                    |
| --------------------- | ------------------------------------- | ---------------------------- |
| `survey_results`      | contagem e percentual por alternativa | sempre seguro                |
| `survey_metrics`      | os números da campanha                | sempre seguro                |
| `survey_participants` | quem respondeu o quê                  | **recusa** se `is_anonymous` |

O anonimato deixa de ser disciplina da aplicação e vira propriedade do banco.

### 1.3 O grafo de situações é dado, não código

As transições moram em `survey_status_transitions` — uma tabela — e um trigger
(`surveys_guard`) recusa qualquer passo fora do grafo, em **qualquer** caminho de
escrita: função, PostgREST, psql.

Mudar o fluxo é um `insert` numa migration. E o frontend **lê** o grafo para
decidir quais botões mostrar, em vez de repetir a regra em TypeScript e as duas
saírem de sincronia.

### 1.4 O público é fotografado no agendamento

`schedule_survey()` materializa `survey_recipients`. Depois disso, mexer nos
cadastros não muda mais quem recebe uma campanha já planejada (§33) — e é essa
mesma tabela que dá **idempotência ao disparo** (§38, via o índice único
`(survey_id, contact_id)`) e **estado por pessoa** (§39, §40).

---

## 2. Entidades

```
surveys ──┬── survey_questions ── survey_options
          │                            ▲
          ├── survey_audience_criteria │   (§23–§31)
          ├── survey_recipients        │   (§32, §33, §39, §40)
          ├── survey_dispatches        │   (§37, §38)
          ├── survey_responses ────────┘   (§18, §19, §65)
          └── survey_audit_logs            (§62, §63)

survey_status_transitions   — o grafo (§9)
```

| Tabela                     | Papel                                                               |
| -------------------------- | ------------------------------------------------------------------- |
| `surveys`                  | A enquete: título, descrição, janela, configurações, imagem.        |
| `survey_questions`         | A pergunta. O MVP grava **uma**; a modelagem comporta várias (§6).  |
| `survey_options`           | As alternativas. `position` é o número que a pessoa digita no chat. |
| `survey_audience_criteria` | Uma **linha por critério** de segmentação.                          |
| `survey_recipients`        | A fotografia do público + estado de envio por pessoa.               |
| `survey_dispatches`        | Uma linha por **execução** de disparo (a corrida).                  |
| `survey_responses`         | As respostas. Sem policy de SELECT.                                 |
| `survey_audit_logs`        | Trilha imutável.                                                    |

### Onde `answer_type` mora, e por quê

Na **pergunta**, não na enquete — desvio consciente da lista do §4, que o §64
autoriza ("criar modelagem normalizada"). Com o tipo na enquete, o dia em que
existirem várias perguntas todas seriam obrigadas a ter o mesmo tipo, e uma
escolha única seguida de um comentário livre é o caso mais banal que existe.

Os seis tipos do §5 estão no enum. O que limita o MVP a `single_choice` é um
CHECK de uma linha (`survey_questions_mvp_type`), removível quando o próximo tipo
for implementado de ponta a ponta.

### Por que as datas aqui são `timestamptz`

Eventos e Palestras guardam `date` + `time` separados, sem fuso, de propósito: lá
o que se marca é "dia 20, às 14h" — um compromisso no calendário de quem vai.

Aqui o que se marca é **o instante em que a urna fecha**: uma fronteira absoluta
na linha do tempo, que precisa valer igual para o servidor em UTC, para o
associado e para quem lê o resultado. Um `date`+`time` sem fuso teria de ser
interpretado por alguém, e "alguém" é onde nasce a resposta aceita um minuto
depois do fim.

### `starts_at` × `scheduled_at`

O §15 diz que `data_inicio` ativa a enquete; o §35 pede "data e horário de
**envio**". São dois instantes que costumam coincidir mas não precisam — abrir a
urna à meia-noite e mandar o WhatsApp às 9h é exatamente o que se quer fazer. O
CHECK `surveys_dispatch_after_start` impede o contrário (enviar antes de abrir),
que geraria resposta recusada em massa.

---

## 3. O fluxo de situações (§9)

```
        ┌──────────────── cancelada ◄──────────┐
        │                                      │
   rascunho ──► agendada ──► ativa ──► encerrada
        ▲           │           │
        └───────────┘           └──► cancelada
         (desagendar)
```

| Situação    | Recebe resposta?          | Observações                                                  |
| ----------- | ------------------------- | ------------------------------------------------------------ |
| `draft`     | não                       | Edição completa. Pode ser **excluída** (§10).                |
| `scheduled` | não                       | Público já fotografado. Pode desagendar se nada foi enviado. |
| `active`    | **sim, dentro da janela** | Ver 1.1: fora da janela o portão fecha sozinho.              |
| `closed`    | não                       | Terminal. Não volta para ativa (§13).                        |
| `cancelled` | não                       | Terminal. Mantém histórico (§14).                            |

**A única volta do grafo** é `scheduled → draft` (desagendar), e ela existe
porque o §11 diz que uma agendada "pode ser editada conforme regras" — sem ela,
um erro de data só teria saída pelo cancelamento, que é terminal. Desagendar
**descarta a fotografia do público** junto: a lista foi tirada com a segmentação
antiga.

---

## 4. Segmentação (§23 a §31)

### A regra de combinação, escrita uma vez

```
OR dentro da mesma dimensão   ·   AND entre dimensões diferentes

    Região ∈ {SP, PR}   E   Perfil ∈ {produtor}
```

É a leitura que o §31 recomenda e a única que corresponde ao que uma pessoa quer
dizer ao marcar duas regiões: "de São Paulo **ou** do Paraná", nunca "de São
Paulo **e** do Paraná ao mesmo tempo", que não alcançaria ninguém.

Imposta em `resolve_survey_audience()`, numa consulta só. Cada bloco
`(não há critério desta dimensão) OR (casa com algum dela)` é um AND com os
outros.

### O que resolve hoje, e o que não

| Dimensão         | §   | Resolve? | De onde sai                        |
| ---------------- | --- | -------- | ---------------------------------- |
| Toda a base      | 24  | ✅       | todos os contatos **com telefone** |
| Segmento         | 25  | ❌       | não há vínculo contato ↔ segmento  |
| Categoria        | 26  | ❌       | não existe no banco                |
| Região           | 27  | ✅       | `chat_contacts.state` (UF)         |
| Perfil           | 28  | ✅       | `chat_contacts.contact_profile`    |
| Carteira         | 29  | ❌       | não existe no banco                |
| Grupo específico | 30  | ✅       | `chat_contacts.id`                 |

**Elegível = contato com telefone.** Sem telefone não há WhatsApp para receber, e
contá-lo no público inflaria a taxa de participação com gente que nunca teve
chance de responder.

**Usuários internos nunca entram** (§24): `profiles` não é consultada em lugar
nenhum do resolvedor. Não é uma regra a lembrar — é uma consequência de a tabela
nem ser olhada.

### As três recusadas

`assert_survey_audience()` levanta `SV007` com esta mensagem:

> A segmentação por _Segmento_ depende do cadastro de associados, que ainda não
> existe neste sistema. Use Região, Perfil, contatos específicos ou Toda a base.

**Por que recusar em vez de aceitar em silêncio:** as duas alternativas falham
sem ninguém perceber. Aceitar e não filtrar faria a enquete alcançar gente demais;
aceitar e filtrar tudo faria alcançar ninguém. É exatamente o erro que o seed de
públicos de Eventos já documentou neste projeto ("a segmentação rotulava mas não
separava").

O Zod (`surveyAudienceCriterionSchema`) repete a recusa **antes** do banco, para
a pessoa não descobrir depois de preencher o formulário inteiro. A lista de
dimensões disponíveis mora num lugar só: `isAudienceDimensionAvailable`.

---

## 5. Disparo e estado por pessoa (§34 a §40)

Este é o GAP 2 em ação. O que **existe**:

- `survey_recipients` com estado por pessoa: `pending → sent → delivered → read → responded`, mais `error`.
- Contagem de tentativas, última tentativa e último erro (§40).
- `provider_message_id` — por onde um webhook de "entregue"/"lido" encontra a linha sem adivinhar pelo telefone.
- `start_survey_dispatch()` abre a corrida e registra na trilha.
- `mark_survey_recipient()` — **o ponto exato onde um adaptador de fornecedor se pluga.**

O que **não existe**: quem manda a mensagem.

### A progressão é monotônica, e isso não é detalhe

`mark_survey_recipient()` recusa rebaixar o estado. Um webhook de "entregue" que
chega **depois** do de "lido" (a ordem não é garantida em nenhuma API de
mensageria) não desfaz o "lido". Sem isso, a taxa de participação oscilaria
conforme a ordem de chegada dos avisos.

`error` está fora da escala e sempre pode ser gravado: uma falha é notícia nova,
mesmo depois de um "enviado".

---

## 6. Resposta (§43 a §50, §73, §80, §81)

`register_survey_response()` é a **única** porta de escrita. `SECURITY DEFINER`,
com `execute` concedido **só** a `service_role` — o chat é anônimo, e a superfície
pública do banco continua sendo zero.

### Não lança exceção para desfecho de negócio

"Já respondeu", "encerrada" e "opção inválida" são conversas normais, não falhas.
O bot precisa de uma frase, não de um stack trace. Os seis desfechos e os textos
do escopo:

| Desfecho                                 | §      | Frase                                                                                 |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `registered`                             | 46     | "Obrigado pela sua participação!"                                                     |
| `already_answered`                       | 47     | "Você já participou desta enquete. Obrigado!"                                         |
| `invalid_option`                         | 44     | "Não identificamos uma opção válida. Por favor, escolha uma das opções apresentadas." |
| `closed`                                 | 48     | "Esta enquete já foi encerrada."                                                      |
| `cancelled` / `not_active` / `not_found` | 49, 50 | "Esta enquete não está disponível para respostas no momento."                         |

Os três últimos **colapsam na mesma frase de propósito**: para quem está do lado
de fora, "foi cancelada", "ainda é rascunho" e "está agendada" são a mesma
informação útil. Distinguir revelaria o estado interno de uma campanha — ou a
existência de um id.

### Idempotência (§73) vem antes de tudo

A checagem de `source_message_id` é a **primeira** coisa que a função faz. Uma
mensagem reentregue devolve `registered` de novo, e **não** "você já participou" —
que faria o bot repreender alguém por um retry técnico do próprio sistema.

Distinção que importa:

- mesma `source_message_id` → `registered` (idempotente, nada é gravado de novo)
- mensagem **nova** de quem já respondeu → `already_answered`

### Concorrência (§81)

Três camadas: lock consultivo em `(survey_id, contact_id)`, índice único
`survey_responses_unique_idx`, e um `exception when unique_violation` que devolve
`already_answered` — o mesmo desfecho que a requisição teria recebido pelo
caminho normal.

### O que a mensagem do bot NÃO carrega

Nem público-alvo, nem total de destinatários, nem **resultado parcial**.

O resultado parcial é o mais importante da lista: mandá-lo junto com a pergunta
("já votaram 40% em Aumentar") **enviesaria a enquete**. A pessoa responderia
sabendo o que os outros responderam, e o número que a APCS usaria para decidir
passaria a medir efeito manada em vez de expectativa de mercado. Não é vazamento
de privacidade — é vazamento que estraga o dado.

---

## 7. Métricas e resultados (§51 a §55)

### A taxa de participação, e uma interpretação declarada

O §52 diz, ao pé da letra: `respostas / mensagens entregues × 100`.

Implementado assim, o denominador **encolheria a cada resposta** — porque quem
responde sai do estado `delivered` e entra em `responded` —, e a taxa passaria de
100%. Os estados são uma **progressão**, então a contagem respeita isso:

```
entregues = recipients com status ∈ {delivered, read, responded}
enviadas  = recipients com status ∈ {sent, delivered, read, responded}
```

Divisor zero devolve **0%**, como o §52 manda — e é também a única resposta
honesta: sem ninguém alcançado não existe taxa.

### Resultados por alternativa (§53)

`survey_results()` usa `left join`: **alternativas com zero resposta aparecem com
0**. Sem isso, um gráfico montado a partir daqui esconderia as opções que ninguém
escolheu — e "ninguém votou em Reduzir muito" é um resultado, não uma ausência de
dado.

Alternativas **inativas** também aparecem, se tiverem resposta: é o §61 do lado da
leitura.

### Anonimato (§21, §54, §55) — onde exatamente fica a linha

O §21 autoriza manter o vínculo técnico para garantir uma resposta por pessoa e
para **controle de participação**. O §54 proíbe expor o associado nos
**resultados**. A linha, então:

| Informação               | Enquete anônima               | Não anônima |
| ------------------------ | ----------------------------- | ----------- |
| Quem **recebeu**         | visível (`survey_recipients`) | visível     |
| Quem **participou**      | visível — §21 autoriza        | visível     |
| **Quem respondeu o quê** | **bloqueado** (`SV008`)       | visível     |
| Contagem por alternativa | visível                       | visível     |

A trilha de auditoria segue a mesma linha: numa enquete anônima, a linha de
`survey_response_registered` grava a alternativa e **não** grava `contactId`.

> **SUGESTÃO registrada, não implementada.** Numa enquete anônima com poucas
> respostas, cruzar `survey_recipients` (quem participou) com `survey_results`
> pode desanonimizar: se só uma pessoa respondeu, o resultado é a resposta dela.
> A defesa usual é um piso de k respostas antes de exibir o resultado. **Não foi
> implementado** porque nenhum § pede, e o valor de k é decisão de negócio, não
> técnica. Se a APCS quiser, é um `if` em `survey_results`.

---

## 8. Permissões (§3)

| Perfil do escopo | Papel no CRM                              | Enquetes               |
| ---------------- | ----------------------------------------- | ---------------------- |
| ADMINISTRADOR    | `admin`                                   | tudo                   |
| GESTOR           | `ceo`                                     | tudo                   |
| ATENDENTE        | `comercial`                               | **somente visualizar** |
| (demais)         | `pm`, `tech_lead`, `financeiro`, `viewer` | nada                   |

Três camadas, e a primeira é a menos importante:

1. `assertPermission("surveys.write")` na Server Action — nega cedo, com mensagem clara.
2. **RLS** nas tabelas — vale para quem chamar o PostgREST direto.
3. **Checagem de papel dentro das funções** (`survey_is_writer` / `survey_is_reader`).

A trilha (`survey_audit_logs`) é mais estreita que a leitura: só `admin` e `ceo`.
O Atendente consulta enquetes, não o histórico de quem mexeu nelas.

---

## 9. Segurança — dois defeitos encontrados antes de subir

Ambos apareceram na bateria de permissões rodada contra o banco real, chamando a
API **diretamente** com cada papel. Nenhum dos dois apareceria testando pela tela.

### 9.1 `anon` lia a lista de participantes — com nome

**O que era.** O Supabase configura `ALTER DEFAULT PRIVILEGES` concedendo
`EXECUTE` a `anon`, `authenticated` e `service_role` em toda função nova de
`public`. E `revoke execute ... from public` **não desfaz isso**: `public` é o
pseudo-papel; a concessão a `anon` é explícita e separada.

Somado ao segundo defeito (9.2), o resultado medido foi:

```
set role anon;
select * from public.survey_participants('<id>');
→  Antônio Ferreira Lima | Aumentar | 2026-08-14 ...
```

Com a **chave anônima do navegador** — a que vai para o cliente, por definição
pública.

**A correção.** Um laço na migration revoga `EXECUTE` de `anon` em toda função
com `survey` no nome. Laço, e não lista escrita à mão, para que uma função nova
já nasça coberta. Verificado em produção: `anon` executa **nenhuma**.

### 9.2 `NULL not in (...)` deixava passar quem não tinha papel

**O que era.** `current_app_role()` devolve `NULL` para quem não tem perfil. E:

```sql
NULL not in ('admin', 'ceo')  →  NULL
```

Um `if <NULL> then raise` **não dispara** — `if` trata NULL como falso. Ou seja,
`if role not in (...) then raise` deixava passar exatamente quem não tinha papel
nenhum.

Nas funções `SECURITY INVOKER` isso é inofensivo: a RLS barra em seguida. Nas
`SECURITY DEFINER` — as três de resultado — a checagem era a **única** barreira.

**A correção.** `survey_is_writer()` e `survey_is_reader()`, com
`coalesce(..., false)`. A assimetria entre as duas é deliberada e está comentada
na migration: a de escrita tem uma válvula para chamada sem sessão de usuário (o
servidor, o dono do banco); a de **leitura não tem**, porque essas funções
devolvem dado.

### Os módulos já em produção foram verificados

Eventos, Bolsa, Palestras, Documentos e Chat têm o mesmo padrão `not in (...)`.
Foram testados contra o banco real, como `anon`:

| Função                                             | Resultado                                      |
| -------------------------------------------------- | ---------------------------------------------- |
| `create_lecture`, `create_event`, ...              | `42501` — a RLS barra                          |
| `find_lecture_conflicts`                           | 0 linhas — a RLS filtra                        |
| `enforce_lecture_rules`, `prevent_role_escalation` | `0A000` — funções de trigger não são chamáveis |
| `current_app_role`, `is_admin`                     | `(null)` e `false` — não revelam nada          |

**Não há vazamento hoje.** O padrão é frágil (uma função `SECURITY DEFINER` nova
o transformaria em furo), e a correção seria mecânica — o mesmo `coalesce` e o
mesmo revoke de `anon`. Fica **registrado como SUGESTÃO**, não alterado: o escopo
deste prompt é Enquetes, e mexer em cinco módulos em produção sem necessidade é
exatamente o que não se faz.

### O resto da superfície

- **SQL injection (§75):** zero SQL dinâmico. Nenhuma função monta string; todas são parametrizadas e têm `search_path = ''`.
- **XSS (§76):** limites de tamanho no banco e no Zod; o escape na renderização é do React. Guardar HTML "limpo" no banco seria confiar num sanitizador para sempre.
- **Grants de coluna:** `created_by`, `created_at` e `id` não são atualizáveis por `authenticated`. Testado: nem o `ceo` reescreve a autoria, nem assina a edição com o nome de outra pessoa.
- **§70:** não existe alteração arbitrária de situação. Nenhuma função de escrita tem parâmetro de status; quem muda situação são `schedule/activate/close/cancel`, cada uma com sua regra.

---

## 10. Testes

### Bateria SQL contra o banco real — 132 casos, 0 falhas

Rodada em transação revertida, em três blocos:

| Bloco | Casos | Cobre                                                                                         |
| ----- | ----- | --------------------------------------------------------------------------------------------- |
| 1     | 39    | Estrutura, grafo, criação, edição, **segmentação**, agendamento                               |
| 2     | 48    | Situações, **portão da resposta**, resposta, anonimato, resultados, métricas, disparo, rotina |
| 3     | 45    | **Permissões papel a papel** (`comercial`, `ceo`, `viewer`, `anon`) e grants declarados       |

Alguns casos que vale destacar:

- **Segmentação medida contra os 10 contatos reais da base:** toda a base → 7 (só os com telefone); SP → 4; produtor → 5; SP **E** produtor → 3; (SP **ou** PR) **E** associado → 2. Prova o AND/OR do §31 com números, não com prosa.
- **O portão com a janela vencida:** enquete `active`, `ends_at` no passado, nenhuma rotina rodada → o portão devolve `closed` e a resposta não é gravada.
- **Idempotência (§73):** a mesma `source_message_id` duas vezes → `registered` nas duas, **uma** linha gravada, e a alternativa **não muda**.
- **Progressão monotônica:** `read` depois `delivered` → continua `read`.
- **A rotina é idempotente:** segunda chamada devolve `0/0`.

### Vitest — 137 casos novos (777 no total do projeto)

| Arquivo                     | Casos | Foco                                                            |
| --------------------------- | ----- | --------------------------------------------------------------- |
| `survey.rules.test.ts`      | 38    | Etapa derivada, taxas, tradução da resposta do chat             |
| `survey.schema.test.ts`     | 29    | Contratos de entrada, GAP 1, datas impossíveis                  |
| `surveys.test.ts` (actions) | 50    | **Autorização na API**, payloads maliciosos, mapeamento de erro |
| `survey-chatbot.test.ts`    | 20    | Portão, idempotência, nunca lançar, nunca vazar                 |

Dois defeitos meus que os testes pegaram:

1. **A checagem de permissão estava invertida** nas oito actions. `assertPermission` devolve `null` quando autorizado; eu tratava como booleano. Efeito: **nenhum admin conseguiria escrever nada.** Não era furo de segurança (o banco negaria de qualquer forma), mas o módulo estaria inteiramente quebrado.
2. **`Date.parse("2026-02-31")` não falha** — o JavaScript transborda para 3 de março. O schema aceitava uma data impossível e a enquete fecharia num dia que a pessoa não escolheu. Corrigido reconstruindo a parte da data.

---

## 11. GAPs

### GAP 1 — Não existe cadastro de associados

As tabelas de pessoas deste banco são `profiles` (usuários do CRM) e
`chat_contacts` (quem falou com o bot). **Nenhuma é um registro de associados da
APCS.** O módulo de Eventos já havia documentado isso.

Consequências:

- O "associado" do §19 é, aqui, um `chat_contact` — a única entidade com telefone, que é o que o WhatsApp precisa. `survey_responses.contact_id` referencia `chat_contacts`, e a unicidade `(survey_id, contact_id)` é o §18 imposto pelo banco.
- Três dimensões de segmentação são recusadas (seção 4).

**O que destrava:** um cadastro de associados, ou — bem mais barato — uma tabela
`contact_segment_links` ligando `chat_contacts` a `event_segments`. Com ela, a
dimensão `segment` passa a resolver removendo três linhas de validação. As
dimensões já estão no enum justamente para que isso não exija `alter type`.

### GAP 2 — Não existe envio de WhatsApp

Conferido no projeto inteiro: "whatsapp" aparece como valor de enum (canal
preferido de contato) e como rótulo de tela. Não há cliente de API, credencial,
webhook nem fornecedor. O §34 manda usar "a integração existente" — ela não
existe.

O §36 antecipa isso ("não implementar 'Enviar agora' caso não esteja previsto na
integração atual") e foi seguido: não há botão de envio imediato.

**O que destrava:** um adaptador que leia `survey_recipients` com
`status = 'pending'`, mande a mensagem (`surveyWhatsAppMessage` já a monta no
formato do §41) e reporte por `mark_survey_recipient()`. Nada mais do módulo
precisa mudar.

### GAP 3 — Não existe agendador

Sem cron, sem `pg_cron` (extensões instaladas: `pg_stat_statements`, `pgcrypto`,
`plpgsql`, `supabase_vault`, `uuid-ossp`), sem worker, e `vercel.json` não declara
`crons`.

`process_scheduled_surveys()` existe, é idempotente por construção (as duas
varreduras filtram por situação, então rodar dez vezes tem o mesmo efeito de rodar
uma) e faz as duas coisas que o tempo deveria fazer sozinho: ativar o que venceu o
agendamento (§37) e encerrar o que passou da data (§57).

Falta **quem a chame**. Enquanto isso:

- A ativação também é manual (`activate_survey`), o que o §3 já prevê como permissão do ADMINISTRADOR e do GESTOR.
- **E o portão da decisão 1.1 garante que a ausência do agendador nunca deixe uma enquete vencida aceitar resposta.**

**O que destrava:** um Vercel Cron chamando uma Route Handler que execute a
função, protegido por um `CRON_SECRET`. Não foi implementado porque exige uma
variável de ambiente nova, e criar segredo sem combinar não é decisão de quem
está codando.

### GAP 4 — O chatbot não conversa sobre enquetes

`src/lib/services/survey-chatbot.ts` é a porta e está pronta e testada, mas **não
está ligada ao `decide.ts`**. Hoje o único fluxo do chat é o CSP, e todo texto do
bot sai de um catálogo aprovado. Ligar Enquetes exige um `chat_flow_key` novo e um
roteiro de conversa — trabalho de conversa, não de banco. É a mesma pendência de
Palestras.

---

## 12. Decisões que aguardam o negócio

| #   | Pergunta                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Piso de anonimato.** Exibir resultado de enquete anônima com menos de k respostas? Qual k? (ver 7)                                                                                            |
| 2   | **Alteração de resposta (§20).** A coluna `allows_response_change` existe e o padrão é `false`. Quando a APCS quiser permitir, falta definir: reabre a urna para a pessoa, ou substitui o voto? |
| 3   | **Múltiplas perguntas (§6).** A modelagem comporta; o MVP grava uma. Vale implementar?                                                                                                          |
| 4   | **Tipos de resposta (§5).** Cinco tipos estão no enum e desabilitados por um CHECK. Qual é o próximo — texto livre, escala?                                                                     |
| 5   | **Exportação (§56).** "Preparar suporte" foi feito (as funções de resultado já devolvem o dado pronto). O formato — CSV ou Excel — e onde o botão fica são decisão de tela (PROMPT 2/3).        |

---

## 13. Referência rápida das funções

### Escrita (papel `admin` / `ceo`)

| Função                                                            | §         |
| ----------------------------------------------------------------- | --------- |
| `create_survey(titulo, descricao, pergunta, alternativas[], ...)` | 4, 6, 7   |
| `update_survey(id, ...)`                                          | 60        |
| `update_survey_question(id, pergunta, alternativas[])`            | 60, 61    |
| `set_survey_audience(id, criterios jsonb)` → nº de elegíveis      | 23–31, 71 |
| `schedule_survey(id, envio, inicio, fim)` → fotografa o público   | 33, 35    |
| `unschedule_survey(id)`                                           | 11        |
| `activate_survey(id)`                                             | 3, 12     |
| `close_survey(id)`                                                | 58        |
| `cancel_survey(id, motivo)`                                       | 14, 59    |
| `delete_survey(id)` — só rascunho                                 | 10        |
| `start_survey_dispatch(id)`                                       | 37, 38    |

### Leitura (papel `admin` / `ceo` / `comercial`)

| Função                                                      | §      |
| ----------------------------------------------------------- | ------ |
| `survey_results(id)`                                        | 53     |
| `survey_metrics(id)`                                        | 51, 52 |
| `survey_participants(id)` — recusa se anônima               | 54, 55 |
| `count_survey_audience(id)` / `resolve_survey_audience(id)` | 32     |

### Só o servidor (`service_role`)

| Função                                                            | §         |
| ----------------------------------------------------------------- | --------- |
| `register_survey_response(enquete, alternativa, contato, msg_id)` | 43–50, 73 |
| `get_survey_for_chatbot(id)`                                      | 41, 42    |
| `mark_survey_recipient(destinatario, estado, msg_id, erro)`       | 39, 40    |
| `process_scheduled_surveys()`                                     | 37, 57    |

#### Mensageria (PROMPT 3/3, todas só `service_role`)

| Função                                                   | §          |
| -------------------------------------------------------- | ---------- |
| `claim_survey_recipients(enquete, corrida, lote)`        | 22, 23, 76 |
| `release_survey_recipients(ids[])`                       | 21, 28     |
| `requeue_stuck_survey_recipients(prazo)`                 | 87         |
| `retry_failed_survey_recipients(enquete, teto)`          | 19         |
| `block_opted_out_recipients(enquete)`                    | 32, 33     |
| `register_survey_opt_out(contato, canal, origem, nota)`  | 32         |
| `finish_survey_dispatch(corrida)`                        | 28, 35, 91 |
| `open_survey_context(destinatario, canal, msg_id)`       | 7          |
| `resolve_survey_context(contato, canal, msg_citada)`     | 9, 45      |
| `close_survey_context(estado, situacao, motivo)`         | 38, 39, 41 |
| `count_survey_context_miss(estado, teto)`                | 11         |
| `expire_survey_contexts()`                               | 41         |
| `record_survey_inbound_event(...)` → `true` na 1ª vez    | 16, 64     |
| `complete_survey_inbound_event(...)`                     | 49         |
| `mark_survey_recipient_by_message(msg_id, estado, erro)` | 26         |
| `find_contact_by_whatsapp(numero)` — só ESTREITA         | 45         |

#### Leitura de operação (papel `admin` / `ceo` / `comercial`)

| Função                                  | §          |
| --------------------------------------- | ---------- |
| `reconcile_survey_counters(enquete?)`   | 47, 48     |
| `survey_observability_counters(desde?)` | 49, 52, 53 |

### Códigos de erro — classe `SV`

Classe própria porque `P0` é **reservada** pelo PL/pgSQL (`P0004` é
`assert_failure`, que `exception when others` não captura). Mapeados em
`src/lib/actions/errors.ts`.

| Código  | Significado                                                 |
| ------- | ----------------------------------------------------------- |
| `SV001` | transição de situação não permitida                         |
| `SV002` | há respostas — a estrutura não pode mais mudar              |
| `SV003` | a situação atual não permite esta operação                  |
| `SV004` | janela de datas inválida                                    |
| `SV005` | a enquete precisa de pergunta e alternativas                |
| `SV006` | a segmentação não alcança ninguém                           |
| `SV007` | dimensão de segmentação sem cadastro de apoio (GAP 1)       |
| `SV008` | enquete anônima — participantes não podem ser identificados |
| `SV009` | tamanho de lote de disparo inválido                         |
| `SV010` | contexto de conversa inválido ou evento sem identificador   |

---

## 15. As telas (PROMPT 2/3)

| Rota                           | O que é                                                               |
| ------------------------------ | --------------------------------------------------------------------- |
| `/surveys`                     | A grid: filtros, busca, ordenação e paginação, tudo no servidor.      |
| `/surveys/new`                 | Criar. Só `admin` e `ceo` (§9).                                       |
| `/surveys/[id]`                | Visualização, métricas, ações por situação e histórico.               |
| `/surveys/[id]/edit`           | Editar. Trava o que o banco travaria (§36–§38).                       |
| `/surveys/[id]/results`        | O dashboard de resultados (§51).                                      |
| `/surveys/[id]/results/export` | O CSV (§49). É rota, e não action — precisa de `Content-Disposition`. |
| `/surveys/results`             | A leitura executiva: uma linha por enquete (§59).                     |

### O que foi reutilizado, e o que foi criado

**Reutilizado sem alteração:** o layout de `(app)`, a Sidebar, `Card`, `Button`,
`Badge`, `Input`, `Label`, `Select`, `Textarea`, `Dialog`, os tokens de cor, o
padrão de `loading.tsx`/`error.tsx`/`not-found.tsx`, a serialização de filtros na
URL de Palestras, `ACTION_ERROR_MESSAGES`, `formatDateTime` e o RBAC.

**Nenhuma cor nova, nenhuma dependência nova.** O gráfico de barras e o funil são
HTML e CSS — ver 15.3.

**Criado:** `SurveyForm`, `SurveyOptionEditor`, `SurveyAudienceSelector`,
`SurveyScheduleDialog`, `SurveyPreview`, `SurveyActions`, `SurveyMetricsCards`,
`SurveyResultsChart`, `SurveyFunnel`, `SurveyParticipantsTable`,
`SurveyAudienceSummary`, `SurveyHistory`, `SurveyFiltersBar`, `SurveyPagination`.

### 15.1 Onde as telas divergem do escopo, e por quê

**§2 — a grid tem 7 colunas, não 11.** É o próprio §2 pedindo ("não exibir
excesso de informação; priorizar leitura rápida"). Respostas e taxa de
participação são a matéria da tela de Resultados; na grid custariam uma consulta
de métricas por linha e competiriam com a informação que faz alguém abrir a
enquete.

**§4 — a barra tem 5 filtros, não 8.** Segmento, Categoria e Carteira não podem
existir em enquete nenhuma (o banco os recusa — GAP 1). Um filtro que só sabe
devolver zero manda a pessoa procurar defeito nas enquetes em vez de no cadastro
que falta. No lugar dos três controles mortos, uma nota dizendo o que falta.

**§22 — mas no SELETOR de público as três aparecem, desabilitadas.** A assimetria
é deliberada: no filtro elas seriam ruído; no seletor, quem procura "Categoria"
precisa encontrá-la e descobrir POR QUE não dá, em vez de concluir que o sistema
está incompleto.

**§43 — barras, sem pizza.** O §43 aceita "e/ou" e manda priorizar barras quando
há muitas opções. Para comparar grandezas a barra ganha da pizza em qualquer
quantidade: ler comprimento é mais fácil que ler ângulo.

**§49 — CSV, não XLSX.** O §49 diz "conforme infraestrutura existente", e não há
biblioteca de planilha no projeto. O CSV sai com BOM UTF-8 e separador `;` — o
que o Excel em português espera. Sem o BOM, "Suíno" abre como "SuÃ­no".

**§18 — a imagem opcional não foi implementada.** Ver as pendências, adiante.

### 15.2 Três defeitos que só o navegador encontrou

Os três passaram por lint, type-check, testes e build. Nenhum apareceria sem
percorrer o fluxo de verdade — que é exatamente o que o §79 manda fazer.

**1. O botão "Salvar" não fazia nada.** As alternativas moram em `useState` (o
editor precisa reordenar, o que `register` não faz), mas o resolver do React Hook
Form validava os valores do RHF — onde `options` era `[]` para sempre. A
validação falhava, `handleSubmit` nunca chamava o handler, e não havia erro
visível. Sem rede, sem console, sem pista. Corrigido sincronizando as
alternativas para o RHF, e acrescentando uma mensagem de validação que sempre
aparece quando o formulário se recusa a enviar.

**2. A estimativa de público dizia "0" com toda a confiança.** Os tipos do
domínio usam `string | null` para campo não preenchido; o schema Zod só aceitava
`string | "" | undefined`. Um critério de região chegava com `segmentId: null`, o
parse falhava, e a action devolvia `0` — **indistinguível de um público realmente
vazio**. "Região = SP", que alcança 4 pessoas, aparecia como zero. Corrigido nas
duas pontas: o schema aceita `null`, e a action passou a distinguir "nada
selecionado ainda" (zero legítimo) de "payload malformado" (falha visível).

**3. Duas seleções seguidas perdiam a primeira.** Marcar "SP" e logo "Produtor"
gravava só Produtor: o segundo clique calculava o próximo estado a partir da prop
`criteria` ANTIGA, porque o React ainda não havia reprocessado. Corrigido
passando o setter do `useState` e usando atualização funcional — no seletor de
público e no editor de alternativas. O teste do editor usa um wrapper com estado
real justamente para pegar esta classe de defeito; um `onChange` espião não
pegaria.

### 15.3 Decisões de construção que valem ser lidas

**A estimativa de público vem do BANCO.** `estimate_audience_criteria` usa a
mesma função (`resolve_audience_criteria`) que o agendamento usa para fotografar
o público. Recalcular a combinação do §31 em TypeScript daria um número que
diverge do real no primeiro ajuste da regra — e a divergência só apareceria
depois do envio. Medido no navegador: a tela previu 3, o agendamento fotografou 3.

**Reordenar é por botão, não por arrastar.** Arrastar não existe para quem navega
por teclado nem para leitor de tela. Dois botões com rótulo explícito ("Mover
'Manter' para cima") funcionam para todo mundo e não precisam de biblioteca.

**O gráfico é uma `<table>` com barras de CSS.** Feito assim ele já nasce
acessível (é uma tabela de verdade), imprimível e temático. Uma biblioteca traria
um `<canvas>` que não é nada disso.

**O funil some quando não há envio.** Cinco barras com três zeros no meio
sugeririam falha de entrega; o que existe é ausência de disparo, e para isso já
há a nota nos cards de métricas.

**O anonimato não é decidido na tela.** `listSurveyParticipants` devolve `null`
quando o banco recusa (SV008) e a seção some. Não existe um `if (isAnonymous)`
nas páginas que alguém possa apagar por engano — nem na tela, nem na exportação.

**O CSV escapa fórmula.** Uma alternativa chamada `=1+1` vira fórmula ao abrir no
Excel. O texto das alternativas vem de quem cria a enquete, que é entrada como
qualquer outra.

### 15.4 O que foi verificado no navegador (§79)

Contra o banco de produção, com dados reais:

| Passo                             | Resultado                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------- |
| Menu e grid                       | A seção Enquetes aparece; a grid lista o seed.                                   |
| Filtro de região                  | Mostra MG, PR e SP — as UFs que existem de fato.                                 |
| Estimativa: SP                    | 4 — igual à bateria SQL.                                                         |
| Estimativa: SP **e** Produtor     | 3 — o AND do §31, medido pela tela.                                              |
| Salvar rascunho                   | Datas, público e trilha gravados; autoria correta.                               |
| Resumo do agendamento             | Título, pergunta, 5 alternativas, público, 3 destinatários, anonimato.           |
| Agendar                           | Situação `scheduled`, 3 destinatários — **a fotografia bateu com a estimativa**. |
| Ativar                            | Situação `active`; as ações da tela viraram as do §57.                           |
| Responder (pela porta do chatbot) | 3 respostas; destinatários viraram "Respondeu".                                  |
| Resultados                        | 66,7% / 33,3%, alternativas zeradas presentes, funil, participantes.             |
| Exportar CSV                      | BOM UTF-8 presente, nome de arquivo sem acento, dados corretos.                  |
| Enquete anônima                   | Nenhum nome na tela **nem no CSV**; aviso explicando.                            |
| Mobile (375px)                    | Sem rolagem horizontal da página; a tabela rola sozinha.                         |

**Os dados de teste foram removidos** e a enquete do seed voltou ao estado
original (rascunho, sem público, sem respostas, com só a linha de trilha da
criação).

---

## 16. O que continua pendente

| #   | O que falta                         | Observação                                                                                                                                                               |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Conta de WhatsApp + 4 variáveis** | É configuração, não desenvolvimento. Ver a seção 18.4 e o roteiro de validação em 22.4.                                                                                  |
| 2   | **Gatilho do cron**                 | Três linhas no `vercel.json` e um segredo. Ver 22.1.                                                                                                                     |
| 3   | **Template aprovado na Meta**       | Necessário para iniciar conversa fora da janela de 24 h. Hoje o adaptador manda texto simples — trocar é uma função no adaptador.                                        |
| 4   | **Imagem da enquete (§18 do 2/3)**  | As colunas, o bucket privado e as policies existem desde o PROMPT 1/3. Falta o fluxo de upload em 3 passos, reaproveitável de Eventos. Opcional no escopo.               |
| 5   | **Exportação XLSX**                 | O CSV atende "conforme infraestrutura existente". XLSX exigiria dependência nova.                                                                                        |
| 6   | **Permissões testadas na ROTA**     | Testadas na action (50 casos) e no banco (45 casos, papel a papel, inclusive `anon`). Testar o `redirect()` das páginas exigiria autenticar como Atendente no navegador. |
| 7   | **Alertas de monitoramento**        | Os contadores existem; falta o coletor (§53 prevê "quando houver infraestrutura").                                                                                       |
| 8   | **GAP 1 — cadastro de associados**  | Inalterado. Três dimensões de segmentação continuam recusadas, e a checagem de atendimento humano só enxerga quem virou lead.                                            |

## 17. Arquivos

```
supabase/migrations/
  20260819000000_create_surveys.sql       estrutura, RLS, grants, funções
  20260819000100_seed_first_survey.sql    a enquete da @ do suíno (opcional)

src/modules/survey/
  survey.types.ts        tipos e listas
  survey.schema.ts       contratos Zod
  survey.rules.ts        regras puras (etapa derivada, taxas, resposta do chat)
  survey.labels.ts       rótulos PT-BR e as falas do bot
  survey.chatbot.ts      o recorte que pode sair da APCS

src/lib/services/
  surveys.ts             leitura (RLS)
  survey-chatbot.ts      a porta do chatbot (service_role)

src/lib/actions/
  surveys.ts             escrita (ActionResult, nunca lança)

src/lib/rbac/            surveys.read / surveys.write
src/config/navigation.ts seção ENQUETES

src/app/(app)/surveys/
  page.tsx                       a grid
  new/page.tsx                   criar
  [id]/page.tsx                  visualizar
  [id]/edit/page.tsx             editar
  [id]/results/page.tsx          resultados de uma enquete
  [id]/results/export/route.ts   o CSV
  results/page.tsx               a leitura executiva
  survey-form.tsx                o formulário em blocos
  survey-option-editor.tsx       alternativas: editar, reordenar, remover
  survey-audience-selector.tsx   público + estimativa ao vivo
  survey-schedule-dialog.tsx     o resumo e a confirmação do agendamento
  survey-preview.tsx             a prévia da mensagem
  survey-actions.tsx             ações por situação, com confirmação
  survey-metrics-cards.tsx       os números da campanha
  survey-results-chart.tsx       gráfico de barras e funil
  survey-participants-table.tsx  participantes, paginados no servidor
  survey-audience-summary.tsx    o público em uma linha
  survey-history.tsx             a trilha
  survey-filters.tsx             a barra de filtros
  survey-pagination.tsx          a paginação
  survey-badges.ts               os selos
  survey-dispatch-panel.tsx      as corridas de disparo (§35)

src/lib/messaging/            a camada do §2 — a porta e os adaptadores
  messaging.types.ts             o CONTRATO (nada acima sabe o fornecedor)
  phone.ts                       E.164 brasileiro; a única implementação da regra
  resilience.ts                  timeout, backoff, ritmo, disjuntor
  signature.ts                   HMAC do webhook, comparação em tempo constante
  telemetry.ts                   log estruturado com correlation id
  job-auth.ts                    o segredo das rotas de rotina
  registry.ts                    onde se escolhe o fornecedor
  providers/cloud-api.ts         WhatsApp Cloud API (Meta)
  providers/fake.ts              o dublê dos testes (§60)
  providers/unconfigured.ts      o que RECUSA quando não há configuração

src/lib/services/
  survey-dispatch.ts             o worker: fila, envio, retry, disjuntor
  survey-scheduler.ts            o ciclo: destrava, ativa, encerra, dispara
  survey-inbox.ts                o webhook: contexto, leitura, urna

src/modules/survey/
  survey.inbound.ts              como se lê o que a pessoa escreveu

src/app/api/
  jobs/surveys/route.ts          o ciclo, protegido por segredo
  webhooks/whatsapp/route.ts     o webhook, protegido por assinatura

e2e/                          o ciclo completo contra o banco real (§77)
  surveys.e2e.ts                 27 casos; exige APCS_E2E=1
  setup.ts                       carrega .env.local e trava o provedor no falso
  vitest.e2e.config.ts           fora do `pnpm test` de propósito
```

---

## 18. Mensageria (PROMPT 3/3)

### 18.1 A arquitetura, e o que ela proíbe

```
    Telas / Actions          ← o que a pessoa opera
          ↓
    Survey Service           ← src/lib/services/surveys.ts
          ↓
    Messaging Service        ← src/lib/services/survey-dispatch.ts
          ↓                     src/lib/services/survey-inbox.ts
    MessagingProvider        ← a PORTA: src/lib/messaging/messaging.types.ts
          ↓
    WhatsApp Cloud API       ← src/lib/messaging/providers/cloud-api.ts
```

O §2 pede a camada de abstração; ela está em `messaging.types.ts`. Nada acima
dela sabe o nome do fornecedor, o formato do payload ou o header de assinatura.
Nada abaixo dela sabe o que é uma enquete.

**Trocar de fornecedor é escrever um arquivo em `providers/` e um `case` em
`registry.ts`.** Nem o worker, nem o webhook, nem as telas mudam.

⚠️ **O que o contrato TORNA IMPOSSÍVEL.** Não existe `send()` que devolva
"provavelmente deu certo": `SendResult` é `ok: true` **com** o id do fornecedor,
ou `ok: false` com o motivo e se vale repetir. É o §88 escrito no tipo — sem id
do fornecedor não há como escrever "enviado", porque não há o que passar para
`mark_survey_recipient`.

### 18.2 Por que a Cloud API, e não um agregador

Procurei integração existente para reutilizar, como o §3 manda: **não há**. O
projeto só tem o chat próprio da web (`/api/chat`, fluxo CSP), que é outro canal
— sem provedor, sem credencial, sem webhook.

Escolhi a **WhatsApp Cloud API** (Meta) porque é a fonte oficial, sem
intermediário cobrando por mensagem, e o contrato dela é o mais estável entre as
alternativas. Se a APCS já tiver contrato com Z-API, Twilio ou 360dialog, o
adaptador correspondente é um arquivo novo — nada acima da porta muda.

### 18.3 ⚠️ O que acontece HOJE, sem configuração

`UnconfiguredProvider` **recusa**. Não registra, não enfileira, não devolve
sucesso com um id inventado.

A tentação seria um "provedor de log" que escreve a mensagem no console e
responde sucesso. É exatamente o que o §95 proíbe: a tela mostraria
_"10 enviadas, 0 erros"_ para uma campanha em que ninguém recebeu nada. Recusando,
a tela mostra o que é verdade.

E a recusa acontece **antes de abrir a corrida**, não durante: sem isso, um
disparo mal configurado marcaria a campanha inteira como erro e alguém teria de
limpar dez linhas na mão antes de tentar de novo. Assim a fila fica intacta.

### 18.4 O que falta para ligar

| Variável                        | O que é                                                             |
| ------------------------------- | ------------------------------------------------------------------- |
| `APCS_WHATSAPP_TOKEN`           | Token permanente do System User no app da Meta                      |
| `APCS_WHATSAPP_PHONE_NUMBER_ID` | O **id** do número no WhatsApp Business (não o número)              |
| `APCS_WHATSAPP_APP_SECRET`      | App Secret — é com ele que a assinatura do webhook é conferida      |
| `APCS_WHATSAPP_VERIFY_TOKEN`    | Texto que você inventa e repete no painel ao cadastrar a URL        |
| `APCS_JOB_SECRET`               | Segredo das rotas de rotina (no Vercel, `CRON_SECRET` também serve) |

Além delas, do lado da Meta: número aprovado, app em modo produção, webhook
apontando para `https://<host>/api/webhooks/whatsapp` assinando o campo
`messages`, e — para iniciar conversa fora da janela de 24 h — um **template
aprovado**. Hoje o adaptador manda mensagem de texto simples; o dia em que a
APCS aprovar o template, é trocar o corpo do `send()` no adaptador.

**Como validar depois de configurar:** ver a seção 22.4.

---

## 19. O fluxo de envio (§22 a §35)

```
  cron (5 min) → /api/jobs/surveys
        ↓
  requeue_stuck_survey_recipients()      §87  destrava quem ficou em ENVIANDO
        ↓
  process_scheduled_surveys()            §37  ativa o que venceu, encerra o vencido
        ↓
  expire_survey_contexts()               §41  fecha contexto de enquete encerrada
        ↓
  para cada enquete ATIVA com fila:
        ↓
  block_opted_out_recipients()           §32  quem pediu para sair sai da fila
        ↓
  start_survey_dispatch()                §35  abre a corrida
        ↓
  ┌── claim_survey_recipients(lote 25)   §22  FOR UPDATE SKIP LOCKED
  │      ↓
  │   telefone válido?  ──não──→ mark_survey_recipient('error')   §29 §30
  │      ↓ sim
  │   provider.send()  ← até 3 tentativas com backoff+jitter      §24 §75
  │      ↓ ok
  │   mark_survey_recipient('sent', id)  §88  só com o id do fornecedor
  │      ↓
  │   open_survey_context()              §7   DEPOIS do envio, nunca antes
  │      ↓
  └── repete até esvaziar, ou até o orçamento (45 s / 400 msgs)
        ↓
  finish_survey_dispatch()               §35  fecha a corrida com os números
```

### 19.1 A fila é a própria `survey_recipients`

Não há tabela de fila separada. A linha do destinatário **já é** o item de
trabalho: tem estado, tentativas, último erro e o id da mensagem. Uma tabela
paralela duplicaria tudo isso e criaria a pergunta "qual das duas está certa?".

O §87 (recuperação após reinício) sai de graça: **a fila é uma tabela**, então
reiniciar o serviço não perde nada — nada vive em memória.

### 19.2 ⚠️ `FOR UPDATE SKIP LOCKED` é a garantia do §76

Dois workers ao mesmo tempo: o primeiro tranca as linhas que pegou; o segundo
**pula** as trancadas em vez de esperar. Nenhum vê a mesma pessoa. Não é uma
checagem que alguém faz no código — é o Postgres recusando.

Sem `SKIP LOCKED`, o segundo esperaria o primeiro terminar e então leria as
mesmas linhas já em `sending`; o filtro as descartaria, mas só depois de o worker
ter ficado bloqueado à toa.

### 19.3 Interromper no meio é normal

Uma campanha de 5 mil pessoas a 5 msg/s leva 17 minutos. Nenhuma função
serverless vive tanto — e o §22 diz explicitamente para não bloquear uma
requisição HTTP por milhares de mensagens. Cada execução tem **orçamento**
(45 s / 400 mensagens), manda o que couber e termina. O que sobrou continua
`pending` e o ciclo seguinte continua de onde parou.

### 19.4 Falha individual × fornecedor fora do ar

Esta distinção decide o que o operador vê na tela, e é a razão de o disjuntor
existir numa fila que já tem retry:

| Situação                         | O que acontece                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| Um número sem WhatsApp           | Aquela pessoa vira `error` com a frase; **as demais continuam** (§28)                   |
| Falha temporária numa mensagem   | Até 3 tentativas com backoff exponencial + jitter (§24, §75)                            |
| Fornecedor fora do ar (5 falhas) | ⚠️ Disjuntor abre, a corrida para e **todos voltam para `pending`** — ninguém vira erro |

Marcar erro no terceiro caso diria _"falhou o envio para o João"_ quando o que
houve foi _"o WhatsApp estava fora do ar"_. O operador sairia conferindo telefone
por telefone em vez de esperar cinco minutos.

⚠️ **Só falha de infraestrutura abre o disjuntor.** "Este número não tem
WhatsApp" é o fornecedor funcionando perfeitamente — contá-la pararia a campanha
inteira por causa de cinco cadastros ruins.

### 19.5 O jitter não é enfeite

Sem ele, quinhentas mensagens que falharam juntas voltam **juntas** um segundo
depois e derrubam de novo o serviço que estava se recuperando.

---

## 20. O fluxo de resposta e o contexto (§7 a §16, §36 a §45)

```
  Associado responde no WhatsApp
        ↓
  POST /api/webhooks/whatsapp
        ↓
  verifySignature(corpo CRU, X-Hub-Signature-256)   §18   ← 401 se falhar
        ↓
  parseWebhook()  → eventos tipados
        ↓
  record_survey_inbound_event()   §16   ← já vi? então saio
        ↓
  find_contact_by_whatsapp() + sameWhatsAppNumber() §45
        ↓
  resolve_survey_context()        §9    ← 0, 1 ou N contextos
        ↓
  readSurveyReply()               §10 a §13
        ↓
  register_survey_response()      §14 §15  ← urna, com lock e índice único
        ↓
  close_survey_context()          §38
```

### 20.1 ⚠️ O contexto é a tabela que responde "3 do quê?"

`survey_conversation_states` é o §8 inteiro. Sem ela, identificar a enquete só
poderia sair da última mensagem que o CRM mandou — e isso quebra de três jeitos,
todos reais: a pessoa responde dois dias depois; o CRM mandou outra coisa no
meio; duas enquetes foram enviadas na mesma semana.

### 20.2 A desambiguação do §9

`resolve_survey_context` devolve **0, 1 ou N** e nunca escolhe sozinha:

| Resultado             | Significado                                                            |
| --------------------- | ---------------------------------------------------------------------- |
| 0 linhas              | §44 — o "1" solto **não é voto**. Volta ao fluxo normal do chatbot.    |
| 1 linha, `quoted`     | A pessoa usou _Responder_ na mensagem da enquete. Identificação exata. |
| 1 linha, `single`     | Só há uma enquete em aberto. Não há o que confundir.                   |
| N linhas, `ambiguous` | §9 — o bot **pergunta**, listando os títulos.                          |

⚠️ **Por que o bot pede para citar a mensagem, e não "responda 1 ou 2".** Um
seletor numerado criaria a ambiguidade que deveria resolver: depois de
_"1 ou 2?"_, a resposta "1" pode ser a enquete 1 ou a alternativa 1 — e as duas
leituras são igualmente plausíveis. Citar a mensagem é a única desambiguação que
**não depende de interpretar nada**.

### 20.3 Errou a resposta × não estava respondendo

A distinção que sustenta `survey.inbound.ts`:

| Mensagem                   | Leitura       | O que o bot faz                                      |
| -------------------------- | ------------- | ---------------------------------------------------- |
| `"3"`, `"3️⃣"`, `"opção 3"` | `option`      | Registra e confirma                                  |
| `"Manter"`                 | `option`      | Registra (§13, correspondência exata)                |
| `"Aument"`                 | `ambiguous`   | Pede de novo — **nunca chuta** entre duas plausíveis |
| `"7"` numa enquete de 5    | `invalid`     | §11 — pede de novo, com a lista junto                |
| `"bom dia"`                | `unrelated`   | ⚠️ **Cala.** Não conta como erro                     |
| `"SAIR"`                   | `opt_out`     | §32 — registra e confirma                            |
| `"atendente"`              | `wants_human` | §39 — solta a conversa                               |

Colapsar `invalid` e `unrelated` produziria o pior atendimento possível: quem
manda "bom dia" recebe _"escolha uma das opções apresentadas"_, e três bons-dias
depois é expulso da enquete por excesso de erro.

### 20.4 O emoji do teclado

O WhatsApp entrega o "1" do teclado numérico como `1` + U+FE0F + U+20E3. Para um
regex de dígito isso **não é um dígito** — e a pessoa que clicou exatamente no
número que o bot mandou receberia "opção inválida". `normalizeReply` remove os
dois combinadores.

### 20.5 §40 — atendimento humano tem precedência

Se o contato tem conversa com `assigned_to` preenchido e `resolved_at` nulo, o
bot da enquete **não fala e não registra** — a pessoa está resolvendo outro
assunto com o time.

**A exceção é a mensagem citada:** aí a intenção é inequívoca (clicou em
_Responder_ na mensagem da enquete), e ignorá-la faria a pessoa perder o voto.

⚠️ Esta checagem **só enxerga quem virou lead**: `chat_conversations.contact_id`
só é preenchido quando a triagem do chat fecha. Limitação do cadastro atual
(GAP 1), não desta regra.

### 20.6 Idempotência em três camadas

| Camada                                      | Contra o quê                                      |
| ------------------------------------------- | ------------------------------------------------- |
| `survey_inbound_events(provider, event_id)` | O webhook reentregue (§16, §64)                   |
| `survey_responses.source_message_id`        | A mesma mensagem chegando por outro caminho (§73) |
| `survey_responses(survey_id, contact_id)`   | Duas respostas da mesma pessoa (§14, §18)         |
| `pg_advisory_xact_lock`                     | Duas requisições **simultâneas** (§15, §63)       |

A primeira usa `on conflict do nothing`, e não `select` + `insert`: com duas
entregas paralelas do mesmo evento — o fornecedor faz isso — o par deixaria as
duas passarem, porque ambas leriam "não existe" antes de qualquer uma inserir.

### 20.7 ⚠️ O webhook responde 200 quase sempre

Para o fornecedor, qualquer coisa diferente de 200 significa "não recebi, mande
de novo" — e ele reentrega com backoff por horas. Um payload que não entendemos
não melhora sendo reentregue mil vezes.

As **duas** exceções: `401` (assinatura ausente ou inválida — não é a Meta
falando) e `413` (corpo grande demais).

---

## 21. Segurança da integração (§18, §80)

### 21.1 Três armadilhas da assinatura, todas evitadas

1. **Assinar o corpo reparseado.** O HMAC é calculado sobre os **bytes crus**.
   `JSON.stringify(await request.json())` produz outro texto (ordem de chaves,
   escapes) e a assinatura nunca bate — o que costuma "resolver" com alguém
   desligando a verificação. A rota usa `request.text()`.

2. **Comparar com `===`.** A comparação sai no primeiro byte diferente, e o
   tempo até sair vaza quantos bytes estavam certos. Usamos `timingSafeEqual`.

3. **Falhar aberto sem segredo.** Sem `APCS_WHATSAPP_APP_SECRET` o webhook
   **recusa**. Um endpoint que aceita qualquer payload é um jeito de qualquer
   pessoa na internet registrar respostas em nome de associados.

Um detalhe a mais: assinatura em formato inesperado é recusada **antes** de
`timingSafeEqual`, que lança quando os buffers têm tamanhos diferentes — o que
viraria 500 e, por si, um canal lateral por tipo de resposta.

### 21.2 As rotas de rotina

`/api/jobs/surveys` é pública na internet. Sem segredo, qualquer pessoa
dispararia campanhas em nome da APCS — que custam dinheiro por conversa iniciada
e queimam a reputação do número.

Sem `APCS_JOB_SECRET` a rota devolve **503** (e não 401): o problema é de
configuração do servidor, e um 401 mandaria quem opera procurar o erro no cron,
que está certo.

### 21.3 O que foi verificado

| Cenário                                    | Resultado                          |
| ------------------------------------------ | ---------------------------------- |
| Payload sem assinatura                     | 401                                |
| Assinatura de outro segredo                | 401                                |
| Corpo adulterado depois de assinado        | 401                                |
| Nenhum evento forjado virou linha no banco | ✓                                  |
| Payload assinado mas absurdo               | 200, sem efeito                    |
| `1; drop table surveys; --` como resposta  | Não vira consulta; nada registrado |
| Handshake `GET` com token errado           | 403                                |
| `anon` executa alguma função de enquete    | **NENHUMA**                        |
| `service_role` lê resultados               | **Recusado** (`survey_is_reader`)  |

O último merece destaque: a chave `service_role` serve para **registrar**
resposta, não para consultá-las. O worker e o webhook não conseguem ler resultado
nenhum.

### 21.4 LGPD (§50, §54, §55)

O log estruturado carrega **identificadores**, nunca conteúdo:

- ✅ `surveyId`, `recipientId`, `contactId`, `providerMessageId`, `correlationId`
- ✅ telefone **mascarado** (`***4567`)
- ❌ o texto que a pessoa escreveu
- ❌ o texto da mensagem enviada
- ❌ o telefone completo, o nome

Com os ids, quem tem acesso ao banco descobre tudo; quem só tem o log não
descobre nada sobre uma pessoa. Log é o lugar menos controlado do sistema — vai
para serviço terceiro, fica retido por meses e é lido por gente sem papel no CRM.

`survey_inbound_events` **não guarda o payload**: para não processar duas vezes
basta o id do evento.

---

## 22. Operação (§85, §86, §87)

### 22.1 Ligar o cron

No `vercel.json`:

```json
{
  "crons": [{ "path": "/api/jobs/surveys", "schedule": "*/5 * * * *" }]
}
```

e `CRON_SECRET` definido no projeto. Ou, de qualquer cron externo:

```bash
curl -X POST https://<host>/api/jobs/surveys -H "x-apcs-job-secret: $APCS_JOB_SECRET"
```

⚠️ **Chamar duas vezes seguidas é seguro.** Toda função invocada é idempotente
por construção: as varreduras filtram por situação, a fila reivindica com
`skip locked` e o destinatário só sai de `pending` uma vez. Isso é o que permite
deixar o cron agressivo sem medo.

### 22.2 O runbook

| Como…                  | O caminho                                                                    |
| ---------------------- | ---------------------------------------------------------------------------- |
| Criar uma enquete      | `/surveys/new` — pergunta, alternativas, público, datas                      |
| Agendar                | Botão _Agendar_ no detalhe; o resumo mostra público, datas e anonimato antes |
| Cancelar / encerrar    | Botões no detalhe. Encerrar é terminal; cancelar tira da fila o que não saiu |
| Ver resultados         | `/surveys/[id]/results` — gráfico, funil, participantes, CSV                 |
| Ver os disparos        | Seção **Disparos** no detalhe: uma linha por execução, com enviadas e falhas |
| Reenviar a quem falhou | Botão _Tentar enviar de novo_ — respeita teto de tentativas e opt-out        |
| Tirar alguém da lista  | `survey_opt_outs`, ou a própria pessoa responde **SAIR**                     |
| Interpretar a taxa     | `respostas ÷ entregues`. Zero entregues ⇒ 0%, nunca erro                     |

### 22.3 Tratamento de falhas (§86)

| Cenário                  | O que o sistema faz                                                              |
| ------------------------ | -------------------------------------------------------------------------------- |
| WhatsApp indisponível    | Disjuntor abre, fila preservada, ninguém marcado como erro. Ciclo seguinte tenta |
| Webhook indisponível     | A Meta reentrega; a idempotência garante efeito único                            |
| Fila parada (cron caiu)  | Nada se perde — a fila é tabela. `survey_queue_depth` denuncia                   |
| Worker morto no meio     | `requeue_stuck_survey_recipients` devolve após 15 min (§87)                      |
| Associado sem telefone   | Não entra na fotografia (a segmentação já exige telefone)                        |
| Telefone fixo / inválido | `error` com "Telefone fixo não recebe WhatsApp. Cadastre um celular."            |
| Fornecedor rejeitando    | Erro definitivo: **não repete**. Erro temporário: 3 tentativas com backoff       |
| Resposta duplicada       | "Você já participou desta enquete. Obrigado!" — e a urna não muda                |
| Resposta inválida        | Pede de novo com a lista; após 3, solta a conversa                               |
| Enquete expirada         | "Esta enquete já foi encerrada." — não registra                                  |
| Segmentação sem ninguém  | `schedule_survey` recusa com SV006 no momento do agendamento                     |

⚠️ **O prazo de 15 minutos do reaper é generoso de propósito.** Devolver uma
linha à fila cedo demais, enquanto o envio ainda está a caminho, faz a pessoa
receber **duas vezes** — o oposto do que o §76 pede.

### 22.4 Como validar quando a conta existir (§95)

1. Preencher as quatro variáveis e publicar.
2. `GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<o seu>&hub.challenge=123`
   deve devolver `123` em texto puro. Se der 403, o token não confere.
3. Criar uma enquete de teste com **um** contato — o seu próprio celular.
4. Agendar para agora e chamar `/api/jobs/surveys` à mão.
5. A mensagem deve chegar. Na tela: _Enviada_; depois _Entregue_ e _Lida_ pelos
   webhooks de status.
6. Responder com o número. A confirmação deve chegar e o resultado subir.
7. Responder de novo: deve vir _"Você já participou"_.
8. Responder **SAIR** em outro contato: não recebe a próxima campanha.

Se o passo 5 falhar com `wa_131047`, falta o **template aprovado** — a janela de
24 h da Meta não permite iniciar conversa com texto livre.

### 22.5 Observabilidade (§49 a §53)

`survey_observability_counters(p_since)` devolve, entre outros:

`surveys_created` · `surveys_scheduled` · `surveys_sent` · `survey_send_errors` ·
`survey_delivered` · `survey_read` · `survey_responses` ·
`survey_duplicate_responses` · `survey_invalid_responses` ·
`survey_webhook_events` · `survey_webhook_unprocessed` · `survey_queue_depth` ·
`survey_queue_in_flight` · `survey_queue_stuck` · `survey_contexts_open` ·
`survey_opt_outs`

As três de fila são **estado atual**, não janela: é o que um alerta observa.

⚠️ `survey_duplicate_responses` e `survey_invalid_responses` contam o caminho do
**WhatsApp**. Respostas pela janela de chat da web não geram evento de fornecedor
e não entram aqui — está dito para ninguém ler "0 inválidas" como "ninguém
errou".

**Correlation id (§51):** cada corrida e cada requisição de webhook geram um
UUID que viaja em todos os eventos de log daquele fluxo. Filtrar por ele devolve
o caminho inteiro: CRM → fila → WhatsApp → webhook → resposta.

**Alertas (§53):** não há infraestrutura de monitoramento instalada, e o §53 diz
"quando houver". Os contadores já estão prontos; o que falta é o coletor.
Sugestões de gatilho: `survey_queue_stuck > 0`, `survey_webhook_unprocessed > 10`,
`survey_send_errors` crescendo mais rápido que `surveys_sent`.

### 22.6 Reconciliação (§47, §48)

`survey_results` e `survey_metrics` **já derivam das respostas persistidas** — a
verdade dos resultados nunca depende de contador. O que pode divergir é o estado
do destinatário (operacional, não resultado): alguém pode responder pelo chat da
web sem ter recebido a mensagem.

`reconcile_survey_counters(p_survey_id)` corrige o que é seguro corrigir e
**relata** o que precisa de gente olhando:

| Campo                         | Significado                                                                |
| ----------------------------- | -------------------------------------------------------------------------- |
| `recipients_marked_responded` | Corrigidos: respondeu, mas o destinatário não sabia                        |
| `dispatches_recomputed`       | Totais de corrida recalculados a partir das linhas                         |
| `responses_without_recipient` | Respostas de quem não está na fotografia — **não é erro**, é o chat da web |
| `recipients_stuck_sending`    | Presos em ENVIANDO. `> 0` por muito tempo pede investigação                |

---

## 23. Testes do PROMPT 3/3

| Arquivo                                         | Casos | O que protege                                                  |
| ----------------------------------------------- | ----- | -------------------------------------------------------------- |
| `src/lib/messaging/phone.test.ts`               | 15    | §30 — o fixo da base real, DDD inexistente, o caminho de volta |
| `src/lib/messaging/resilience.test.ts`          | 15    | §19, §21, §24, §75 — backoff, jitter, ritmo, disjuntor         |
| `src/lib/messaging/signature.test.ts`           | 13    | §18, §80 — as três armadilhas do HMAC                          |
| `src/lib/messaging/registry.test.ts`            | 15    | §60, §95 — o falso fora de produção, o segredo dos jobs        |
| `src/lib/messaging/providers/cloud-api.test.ts` | 21    | §17, §26, §27, §29 — tradução e payload hostil                 |
| `src/modules/survey/survey.inbound.test.ts`     | 24    | §10 a §13, §32, §39 — errou × não estava respondendo           |
| `src/lib/services/survey-dispatch.test.ts`      | 18    | §61, §74, §75, §76 — a orquestração da fila                    |
| `src/lib/services/survey-inbox.test.ts`         | 26    | §62, §63, §64, §9, §40 — as decisões de conversa               |
| `e2e/surveys.e2e.ts`                            | 27    | §77, §78, §80 — o ciclo completo no banco **real**             |

**Total do módulo: 147 casos novos** (978 no projeto, contra 831 antes).
Mais **77 casos SQL** contra o Postgres de verdade, em transação revertida.

### 23.1 O E2E (§77, §78)

`e2e/surveys.e2e.ts` roda o ciclo inteiro contra o **banco de produção**, com o
fornecedor falso (§60 — nenhuma mensagem real sai).

```bash
APCS_E2E=1 npx vitest run --config e2e/vitest.e2e.config.ts
```

⚠️ Ele **não** entra no `pnpm test`: o `include` principal é `src/**/*.test.ts` e
o arquivo é `.e2e.ts`. E exige `APCS_E2E=1` — uma bateria que cria e apaga
campanha não pode rodar sozinha a cada commit.

**Duas decisões sobre como ele toca o banco real:**

1. Ele cria a **própria** enquete, com a pergunta e as alternativas do §78, em
   vez de usar a do seed. Ativar e encerrar a do seed seria **irreversível** — o
   grafo não tem volta de `closed`.
2. Tudo é apagado no fim, e o `afterAll` roda **mesmo com teste vermelho**.

Doze contatos: 10 celulares, 1 fixo (§29/§30) e 1 que pede opt-out (§32).

### 23.2 Dois defeitos que o E2E encontrou — nos próprios testes

**1. A limpeza filtrava pelo campo errado.** Ela apagava eventos por
`correlation_id`, que é um UUID novo a cada requisição — nunca casava. Os eventos
da rodada anterior sobreviviam, a idempotência os recusava **corretamente**, e a
bateria seguinte via "nenhuma resposta registrada" sem dizer por quê.

**2. O provedor falso repetia ids entre rodadas.** Ele gerava
`fake.wamid.1`, `fake.wamid.2`… Toda execução colidia com os ids da anterior — de
novo, a idempotência funcionando e o teste falhando por um motivo alheio ao que
media. Agora cada instância tem prefixo aleatório, e `reset()` **não** zera a
sequência.

Os dois são falhas de fixture, não de produto. Valem registro porque o sintoma
— "a resposta não foi registrada" — apontava para o lugar errado nas duas vezes.

---

## 24. O que depende do fornecedor (§95)

Sem mascarar nada:

| Item                                  | Estado                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------- |
| Camada de abstração, fila, contexto   | ✅ Implementado e testado                                              |
| Webhook, assinatura, idempotência     | ✅ Implementado e testado (com assinatura de verdade)                  |
| Retry, backoff, disjuntor, rate limit | ✅ Implementado e testado                                              |
| Reconciliação e observabilidade       | ✅ Implementado e testado                                              |
| Adaptador da Cloud API                | ⚠️ **Escrito a partir da documentação; nunca rodou contra a API real** |
| Envio de verdade                      | ❌ Depende da conta Meta + 4 variáveis                                 |
| Template aprovado (janela de 24 h)    | ❌ Depende da APCS                                                     |
| Alertas de monitoramento              | ❌ Não há coletor instalado (§53 prevê "quando houver")                |

⚠️ **O adaptador nunca falou com a Meta.** Ele foi escrito a partir da
documentação pública do endpoint `/{phone-number-id}/messages` e do formato de
webhook `whatsapp_business_account`, e está coberto por testes com respostas
gravadas. **Isso não é o mesmo que integração validada** — a validação real é o
roteiro da seção 22.4, e ela depende da APCS.
