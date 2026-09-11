# Avaliação de Evento

A etapa seguinte à Lista de Presença, na jornada que o escopo desenha:

```
EVENTO → INSCRIÇÕES → PARTICIPANTES → LISTA DE PRESENÇA → PRESENTE
      → (fim do evento + X) → ENVIO DA AVALIAÇÃO → PARTICIPANTE RESPONDE
```

> **Documento irmão:** a Lista de Presença está na
> [seção 23 de INSCRICOES.md](./INSCRICOES.md). Este arquivo é separado porque a
> avaliação tem banco, fila, página pública e permissões próprios — empilhar
> tudo naquele arquivo faria a lista de presença desaparecer no meio.

---

## 1. A regra que define o módulo

**Só quem esteve PRESENTE recebe avaliação.** Confirmação de inscrição não é
critério para nada aqui:

| Confirmado | Presente | Recebe? |
| ---------- | -------- | ------- |
| ON         | ON       | sim     |
| ON         | OFF      | **não** |
| OFF        | ON       | **sim** |

A terceira linha é a que costuma ser implementada errado. Neste sistema ela sai
de graça: `schedule_event_evaluations` simplesmente **não lê** a coluna
`confirmation` — e existe um teste que cobra essa ausência
(`sql-event-evaluation.test.ts`).

### ⚠️ A presença tem HORA (corrigido no Prompt 4)

    A PRESENÇA DECIDE SE O CONVITE SAI.   → schedule, claim
    DEPOIS QUE SAIU, O CONVITE VALE.      → página pública, submit

| Quando                            | Presença é consultada?                        |
| --------------------------------- | --------------------------------------------- |
| ao criar a avaliação (`schedule`) | **sim** — só presentes entram na fila         |
| ao reivindicar o lote (`claim`)   | **sim** — o estado ATUAL, no momento do envio |
| ao abrir o link público           | **não**                                       |
| ao gravar a resposta              | **não**                                       |

As duas primeiras são o §7 ("Presente OFF → não enviar") e o §33 ("o job deve
consultar o estado atual da presença no momento do processamento"): entre criar
a linha e mandar a mensagem passam um arrendamento de dez minutos e quantas
passadas forem precisas — tempo de sobra para uma correção acontecer.

As duas últimas são o §34 ("não cancelar automaticamente a avaliação enviada").
Até o Prompt 3, quem recebia o link e tinha a presença corrigida depois batia
num "esta avaliação não está disponível" — a correção administrativa virava
revogação silenciosa de um convite já entregue.

**Isso não afrouxa nada:** quem nunca esteve presente nunca teve linha criada,
logo nunca teve token, logo não alcança a página pública.

---

## 2. Quando a avaliação é enviada

Do **término do evento**, mais o atraso configurado. Nunca do check-in.

```
Evento: 29/08/2026, 14:00 às 18:00
Atraso: 30 minutos
Envio:  29/08/2026 18:30
```

A conta é `event_evaluation_send_at()`, no banco, com o fuso
`America/Sao_Paulo` explícito. Sem isso o Postgres leria o horário no fuso do
servidor (UTC, na Supabase) e "termina às 18:00" viraria 15:00 em São Paulo.

### ⚠️ O evento precisa ter horário de término

`events.end_time` é **opcional** neste sistema. Sem ele não existe "término +
atraso" a calcular, e o banco recusa habilitar a avaliação (erro `AV001`). A
tela avisa antes, com um link para o cadastro do evento.

Isso é deliberado: inventar um fim ("meia-noite", "mais quatro horas") mandaria
trezentas mensagens numa hora que ninguém combinou.

---

## 3. Onde ficam as telas

```
Eventos
├── Eventos
├── Landing Pages
├── Inscrições
└── Gestão do Evento
    ├── Lista de Presença     /events/presence
    └── Avaliações            /events/evaluations
```

| Tela                            | Rota                            | Permissão          |
| ------------------------------- | ------------------------------- | ------------------ |
| Seleção de evento               | `/events/evaluations`           | `evaluations.read` |
| Configuração + perguntas + fila | `/events/evaluations/[eventId]` | `evaluations.read` |
| **Página pública de resposta**  | `/avaliacoes/[token]`           | nenhuma (token)    |

> **`/events/evaluations` é o CRM; `/avaliacoes` é a página que a granja abre.**
> É o mesmo par de `/events` e `/eventos`: rota interna em inglês, rota pública
> em português. O menu nunca aponta para a pública — ela precisa de um token.

---

## 4. Permissões

| Chave               | Administrador | Atendente | O que libera                            |
| ------------------- | ------------- | --------- | --------------------------------------- |
| `evaluations.read`  | ✅            | ✅        | abrir a tela, ver perguntas e andamento |
| `evaluations.write` | ✅            | ❌        | editar perguntas e configuração         |
| `evaluations.send`  | ✅            | ✅        | reenviar, cancelar                      |

**A caixa do meio é a mais estreita, e é a única assimetria desse tipo no
sistema.** Reescrever a pergunta muda o que a APCS está perguntando — e, com
respostas já coletadas, muda o significado do histórico. Reenviar é operação de
quem está tocando o evento.

Reabrir uma avaliação respondida exige `evaluations.write`, e não `send`: ela
mexe no dado já coletado.

---

## 5. O modelo de dados

```
event_evaluations              ← event_id NULO = modelo reutilizável da APCS
  └── event_evaluation_versions          (§23 — versionamento)
        └── event_evaluation_sections    (blocos)
              └── event_evaluation_questions
                    └── event_evaluation_options   (label + numeric_value)

event_evaluation_settings      ← por evento: ligada?, atraso, prazo
event_participant_evaluations  ← uma por pessoa: token, situação, datas
  └── event_evaluation_answers
event_evaluation_audit_logs
```

### Por que o evento CLONA o modelo em vez de apontar para ele

Apontar seria mais barato — uma linha a menos — e editaria as perguntas de
**todos os eventos ao mesmo tempo**, inclusive os já respondidos. O clone é o
que permite "cada evento pode ter a sua avaliação" sem destruir o padrão da
casa.

Por isso, ao ligar a avaliação de um evento, o sistema copia o modelo escolhido
para uma avaliação daquele evento. A partir dali, editar as perguntas ali não
encosta no modelo da APCS.

---

## 6. O modelo padrão APCS

Semeado pela migration, idempotente. Cinco blocos:

1. **Avalie o evento — Empresa 1** (3 perguntas de nota)
2. **Avalie o evento — Empresa 2** (3 perguntas de nota)
3. **Infraestrutura** (5 perguntas de nota)
4. **Avaliação geral** (1 pergunta de nota)
5. **Comentários adicionais** (texto livre, **não obrigatório**)

> **"Empresa 1" e "Empresa 2" são para renomear.** O formulário de papel da APCS
> traz duas empresas específicas; deixá-las fixas na arquitetura quebraria no
> próximo evento com outros patrocinadores. Quem organiza renomeia os dois
> primeiros blocos no construtor.

A escala é sempre a mesma e guarda **valor numérico**:

| Valor | Rótulo    |
| ----- | --------- |
| 5     | Excelente |
| 4     | Bom       |
| 3     | Regular   |
| 2     | Ruim      |
| 1     | Péssimo   |

---

## 7. Os cinco tipos de pergunta

| Tipo                 | Guarda                      | Entra em média? |
| -------------------- | --------------------------- | --------------- |
| **Nota (escala)**    | opção + valor numérico      | **sim**         |
| **Escolha única**    | opção                       | não             |
| **Múltipla escolha** | uma linha por opção marcada | não             |
| **Sim / Não**        | opção (Sim = 1, Não = 0)    | não             |
| **Texto livre**      | texto                       | não             |

**As alternativas de Sim/Não são geradas pelo banco.** Se cada avaliação
escrevesse as suas, a apuração teria de adivinhar que "Sim", "sim" e "SIM" são a
mesma resposta.

**Toda alternativa de "Nota" precisa de valor.** Sem ele, a opção entra na
escala sem peso e a apuração a trataria como ausência de resposta — um "Regular"
sumindo da conta em silêncio.

### A resposta guarda o valor copiado

`event_evaluation_answers.numeric_value` é uma **cópia** do valor da opção no
instante da resposta. Sem a cópia, trocar "3 — Regular" por "3 — Neutro" com
peso 2 reescreveria em silêncio a média de todos os eventos passados.

---

## 8. Versionamento — o que acontece ao editar perguntas

| Situação da versão corrente | Salvar as perguntas faz o quê     |
| --------------------------- | --------------------------------- |
| **sem resposta**            | reescreve a versão corrente       |
| **com resposta**            | **publica uma versão nova (v+1)** |

Quem decide é o **banco**, e não a tela. Deixar isso para a interface
significaria que uma segunda tela — ou uma chamada direta ao PostgREST — tomaria
a decisão diferente.

As respostas antigas continuam apontando para as perguntas da versão que
aquelas pessoas leram. Nada é reescrito, nada é apagado.

**Trocar o MODELO inteiro** ("Recomeçar do modelo") é outra operação: ela
destrói as perguntas atuais e o banco **recusa** se já houver resposta. Não há a
saída de versionar ali, porque trocar o modelo não é alterar a estrutura: é
outra pesquisa.

---

## 9. O token

- 122 bits de um gerador criptográfico (`gen_random_uuid()`), 32 caracteres hex;
- **não é derivado de nada da pessoa** — um token derivado do e-mail seria
  adivinhável por quem conhece o e-mail;
- não aparece em listagem nenhuma: a coluna é revogada **até de quem pode ler a
  tabela** (`revoke select (token) ... from authenticated, anon`);
- **nunca entra em log nem na trilha de auditoria**;
- é guardado cru, e não como hash — porque **reenviar precisa dele**. Um reenvio
  acontece justamente quando o primeiro envio ficou em dúvida; rodar o token
  deixaria a pessoa com um link morto na mão.

Token desconhecido devolve a **mesma resposta** de uma avaliação cancelada.
Distinguir as duas contaria a quem estivesse adivinhando quando o palpite
acertou o formato.

---

## 10. Uma resposta por participante, por evento

Não é uma checagem que o código faz: é uma **impossibilidade**.

```sql
create unique index event_participant_evaluations_unique_idx
  on public.event_participant_evaluations (event_id, participant_id);
```

A gravação ainda tem duas barreiras contra envio duplo:

1. `select ... for update` no começo — o segundo envio espera o primeiro e
   encontra `answered`;
2. `update ... where status <> 'answered'` — se não casar, alguém respondeu no
   intervalo, e o `raise` desfaz as respostas gravadas nesta transação.

**Uma função é uma transação.** Qualquer recusa desfaz tudo: não existe resposta
pela metade.

### Reabrir (a exceção)

"Reabrir" **não apaga nada**. O banco incrementa `answer_round`, e a pessoa
responde **ao lado** da resposta anterior. A rodada 1 fica intacta e legível — é
o que permite explicar, depois, por que o número mudou.

---

## 11. O envio automático

```
/api/jobs/event-evaluations   (POST ou GET, protegida por segredo)
        ↓
expire_event_evaluations()      passou do prazo → expirada
        ↓
schedule_event_evaluations()    cria a avaliação dos PRESENTES
        ↓
claim_event_evaluations()       lote com `skip locked` + arrendamento
        ↓
MessagingProvider.send()        Z-API ou Cloud API da Meta
        ↓
mark_event_evaluation_sent()    só com o id do fornecedor
```

### ⚠️ FALTA LIGAR O CRON

A rota existe e é idempotente, mas **nada a chama sozinha ainda**. É o mesmo
estado de `/api/jobs/surveys` e `/api/jobs/flows` — `vercel.json` não declara
`crons`.

Para ligar, uma das duas:

```jsonc
// vercel.json — e definir CRON_SECRET no projeto
{
  "crons": [{ "path": "/api/jobs/event-evaluations", "schedule": "*/10 * * * *" }],
}
```

```bash
curl -X POST https://<host>/api/jobs/event-evaluations \
     -H "x-apcs-job-secret: $APCS_JOB_SECRET"
```

> **O plano Hobby da Vercel limita crons a uma execução diária.** Num plano
> Hobby, use o cron externo — um `*/10` no `vercel.json` faz o deploy falhar.

**Dez minutos basta.** O atraso configurável é de 30 minutos para cima; sair até
dez minutos depois da hora exata não muda nada para quem recebe.

**Chamar duas vezes seguidas é seguro.** Toda função é idempotente por
construção: o agendamento esbarra no índice único, a fila usa `skip locked`, e a
marcação só sai de um estado que ainda não foi marcado.

---

## 12. Falha no envio e reenvio

Falha **não é um estado terminal**: a linha continua `scheduled`, com
`last_error` e `attempts` atualizados, e a próxima passada a pega. Um estado
"falhou" exigiria alguém para tirá-la de lá — o tipo de fila que ninguém olha.

| O que aconteceu                | Como fica                                                      |
| ------------------------------ | -------------------------------------------------------------- |
| telefone inválido              | erro registrado; **não** volta à fila útil                     |
| erro do fornecedor (429/503)   | volta à fila, nova tentativa em 10 min                         |
| 5 tentativas                   | sai da fila; espera reenvio manual                             |
| enviada, carimbo falhou        | contada como `unsettled` na resposta da rotina                 |
| texto sem `{{link_avaliacao}}` | **não sai** — `misconfigured` (§22 do Prompt 4)                |
| 5 tentativas esgotadas         | sai da fila; a tela mostra **"Falha no envio"**, não "Na fila" |

O **motivo aparece na tela**, e é o que torna o reenvio útil: "telefone
inválido" pede corrigir o cadastro; um erro do fornecedor pede só tentar de
novo.

**Reenviar não cria resposta nenhuma** e **não troca o token** — a mesma linha,
o mesmo link. O banco recusa se a pessoa já respondeu (`AV004`) ou se o prazo
terminou (`AV005`).

---

## 13. A mensagem

Mora em `app_settings`, chave `events.evaluation_invite`, editável em
**Configurações → Textos e LGPD**. Não é constante de código.

Variáveis aceitas (lista fechada):

```
{{nome}}   {{evento}}   {{data_evento}}   {{link_avaliacao}}
```

**Variável escrita errado sai literal na mensagem.** `{{nome_completo}}` chega
assim mesmo no WhatsApp — feio, óbvio e corrigível em trinta segundos. Apagar o
que não se reconhece produziria uma frase com um buraco no meio, que parece
certa e não é.

Se a linha sumir do banco, o texto padrão de
`src/modules/event/event.evaluation.labels.ts` entra no lugar. Um convite vazio
no WhatsApp é uma mensagem que nem chega a ser enviada.

---

## 14. Erros da classe `AV`

| Código | Significado                                      |
| ------ | ------------------------------------------------ |
| AV001  | o evento não tem horário de término              |
| AV002  | a avaliação não está habilitada para este evento |
| AV003  | a estrutura enviada é inválida                   |
| AV004  | esta avaliação já foi respondida                 |
| AV005  | o prazo de resposta terminou                     |
| AV006  | falta responder uma pergunta obrigatória         |
| AV007  | a avaliação foi cancelada / não está disponível  |

Classe própria porque a classe `P0` é **reservada** pelo PL/pgSQL (`P0004` é
`assert_failure`, que `exception when others` não captura). Mesma razão das
classes `EV`, `LP` e `RG`.

---

## 15. LGPD e privacidade

- **Os comentários NÃO são anônimos** — foi decisão da APCS. Na apuração será
  possível identificar participante, granja, evento e comentário.
- A página pública mostra **só o primeiro nome**. O link pode ser reencaminhado.
- A página tem `robots: noindex` — o endereço **contém a credencial**.
- A trilha de auditoria nunca guarda nome, e-mail, telefone nem token.
- Nenhum id interno aparece na página pública.
- As duas funções públicas do banco são liberadas **só para `service_role`** —
  `anon` não executa nada. A superfície pública do Postgres continua em zero
  função.

---

## 16. Onde está cada coisa

| Camada           | Arquivo                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| Migration        | `supabase/migrations/20261002000100_event_evaluation.sql`                    |
| Enums            | `supabase/migrations/20261002000000_event_evaluation_enums.sql`              |
| Tipos            | `src/modules/event/event.evaluation.types.ts`                                |
| Textos           | `src/modules/event/event.evaluation.labels.ts`                               |
| Regras derivadas | `src/modules/event/event.evaluation.rules.ts`                                |
| Schemas (Zod)    | `src/modules/event/event.evaluation.schema.ts`                               |
| URLs / filtros   | `src/modules/event/event.evaluation.routes.ts`                               |
| Leitura          | `src/lib/services/event-evaluation.ts`                                       |
| Leitura pública  | `src/lib/services/event-evaluation-public.ts`                                |
| Worker           | `src/lib/services/event-evaluation-dispatch.ts`                              |
| Escrita          | `src/lib/actions/event-evaluation.ts`                                        |
| Escrita pública  | `src/lib/actions/event-evaluation-public.ts`                                 |
| Rotina           | `src/app/api/jobs/event-evaluations/route.ts`                                |
| Telas            | `src/app/(app)/events/evaluations/`                                          |
| Página pública   | `src/app/avaliacoes/[token]/`                                                |
| Testes           | `src/test/event-evaluation.test.ts`, `src/test/sql-event-evaluation.test.ts` |

---

## 17. O que NÃO está aqui

Comparação entre eventos, IA nos comentários, ranking e benchmark histórico.

> **A tabulação chegou no Prompt 3** — painel, médias, distribuição, comentários
> identificados, detalhe por participante e planilha estão em
> [RESULTADOS.md](./RESULTADOS.md). A modelagem descrita acima é o que a
> sustenta: a resposta guarda valor numérico, opção e texto separadamente, e a
> rodada permite explicar por que um número mudou.
>
> O Prompt 3 acrescentou **uma coluna** a este módulo: `is_overall` na pergunta,
> para marcar qual delas é a avaliação geral do evento. Ela é editada no
> construtor descrito na seção 7.
