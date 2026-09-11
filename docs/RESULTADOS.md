# Resultados da Avaliação

A tabulação das respostas coletadas pelo [módulo de Avaliação](./AVALIACOES.md).
Terceira e última etapa da jornada de Gestão do Evento:

```
EVENTO → INSCRIÇÕES → PARTICIPANTES → LISTA DE PRESENÇA → PRESENTE
      → AVALIAÇÃO ENVIADA → PARTICIPANTE RESPONDE → [ RESULTADOS ]
```

---

## 1. A decisão que define o módulo

**Esta etapa não criou nenhuma tabela.**

O Prompt 2 já guardou tudo o que a tabulação precisa, e no formato certo:

| Coluna          | Para quê                                             |
| --------------- | ---------------------------------------------------- |
| `numeric_value` | a nota, **copiada** da opção no instante da resposta |
| `option_id`     | qual alternativa, para a distribuição                |
| `text_value`    | o comentário                                         |
| `version_id`    | a versão que a pessoa leu                            |
| `round`         | a rodada, para a reabertura não duplicar contagem    |

Uma tabela de resultados agregados seria uma **segunda verdade** sobre os mesmos
fatos, e sairia de sincronia na primeira resposta que chegasse fora do caminho
previsto. O que faltava era só **consulta** — seis funções de agregação, quatro
índices e uma coluna.

A coluna é `is_overall`, e ela existe porque o §34 pede uma forma explícita de
marcar a pergunta de avaliação geral.

---

## 2. Onde ficam as telas

```
Eventos
└── Gestão do Evento
    ├── Lista de Presença     /events/presence
    ├── Avaliações            /events/evaluations
    └── Resultados            /events/results
```

| Tela                           | Rota                                       | Permissão            |
| ------------------------------ | ------------------------------------------ | -------------------- |
| Seleção de evento              | `/events/results`                          | `results.read`       |
| Painel · Respostas · Pendentes | `/events/results/[eventId]`                | `results.read`       |
| Detalhe de uma resposta        | `/events/results/[eventId]/respostas/[id]` | `results.read`       |
| Planilha                       | `/events/results/[eventId]/export`         | **`results.export`** |

A tela de um evento tem **três abas**, e cada uma carrega só o que desenha — o
painel não busca a lista de pendentes, a de respostas não recalcula a
distribuição. A aba mora na URL, junto de busca, filtro e página.

---

## 3. Permissões

| Chave            | Administrador | Atendente | O que libera                               |
| ---------------- | ------------- | --------- | ------------------------------------------ |
| `results.read`   | ✅            | ✅        | painel, comentários identificados, detalhe |
| `results.export` | ✅            | ❌        | **baixar a planilha**                      |

**Baixar é mais estreito que ler, e é deliberado.** Ler deixa o dado dentro do
sistema, sob RLS. Baixar o tira de lá para sempre — com opinião amarrada a nome
("fulano da granja tal achou a palestra da patrocinadora ruim"). A exportação de
_inscrições_ alcança o Atendente porque uma lista de contatos é material de
trabalho; esta é outra coisa.

Se a APCS decidir que o Atendente precisa, a saída é um **cargo** em
`/permissions` com essa chave — uma decisão consciente, e não um padrão herdado
sem ninguém reparar.

O reenvio a partir da aba de Pendentes continua sendo **`evaluations.send`**, e
reusa `resendEvaluationAction` inteira. Não há lógica de reenvio aqui.

---

## 4. Elegibilidade — a regra que não muda

**Avaliações elegíveis = participantes PRESENTES.** Confirmação de inscrição não
é critério para nada.

```
120 inscritos · 90 confirmados · 80 presentes
→ elegíveis = 80   (nunca 90)
```

A regra sai de graça: `event_results_summary` **não lê** a coluna
`confirmation`. Há um teste que cobra essa ausência.

---

## 5. Os indicadores

| KPI              | De onde sai                                                         |
| ---------------- | ------------------------------------------------------------------- |
| Participantes    | `event_participants` do evento                                      |
| Presentes        | os mesmos, com `present`                                            |
| Elegíveis        | **igual a Presentes** — aparece separado para a regra ficar legível |
| Enviadas         | status `sent` ou `answered`                                         |
| Respondidas      | status `answered`                                                   |
| Pendentes        | status `pending`, `scheduled` ou `sent`                             |
| Taxa de resposta | respondidas ÷ enviadas                                              |
| Nota média geral | média da pergunta marcada como `is_overall`                         |
| Falha no envio   | `last_error` preenchido e ainda não respondida                      |

### Taxa de resposta

**Respondidas ÷ enviadas**, e é a regra que o §30 recomenda: evita misturar a
adesão de quem recebeu com a eficiência do disparo, que são coisas com causas e
donos diferentes.

Sem nenhum envio, a taxa é **0%** — e o cartão traz a frase "nenhuma avaliação
enviada ainda" embaixo, para o zero não ser lido como fracasso de adesão.

> **Isso difere da coluna Taxa na grid de Avaliações**, que mostra "—". Lá é uma
> comparação entre eventos, e o travessão distingue "não enviou nada" de "enviou
> e ninguém respondeu". Aqui é um indicador de um evento só, ao lado de
> "Enviadas: 0", que já explica o zero.

### Nota média geral

Sai **exclusivamente** da pergunta marcada como avaliação geral. Sem nenhuma
marcada, o cartão mostra **"N/A"** e explica como resolver — nunca uma média
inventada a partir de perguntas que medem coisas diferentes.

---

## 6. A pergunta de avaliação geral

`event_evaluation_questions.is_overall` — marcada no construtor, em
**Avaliações → Perguntas**.

- **no máximo uma por versão** (imposta por `save_event_evaluation_structure`);
- **só do tipo Nota** (CHECK no banco + validação no schema);
- marcar uma **desmarca a anterior** no rascunho do construtor;
- trocar o tipo para algo que não é Nota **desmarca sozinho**.

Ela decide duas coisas: a **Nota média geral** do painel, e contra qual pergunta
os **filtros de nota** rodam (§18: "não aplicar filtro de nota indiscriminadamente
a todas as perguntas"). Sem ela, os cinco filtros de nota somem da tela em vez de
oferecerem opções que não devolvem nada.

O modelo padrão da APCS já nasce com a pergunta de "Avaliação geral" marcada — a
migration faz isso retroativamente, e só onde ninguém marcou outra.

### ⚠️ Por que é coluna, e não o título do bloco

Daria para procurar um bloco chamado "Avaliação geral". Quebraria no primeiro
evento em que alguém renomeasse o bloco — e renomear blocos é exatamente o que o
modelo padrão manda fazer a cada encontro.

---

## 7. As médias

| Nível        | Como é calculada                                        |
| ------------ | ------------------------------------------------------- |
| **Pergunta** | `avg(numeric_value)` das respostas daquela pergunta     |
| **Bloco**    | `avg(numeric_value)` de **todas as respostas** do bloco |
| **Geral**    | `avg(numeric_value)` da pergunta `is_overall`           |

**A média do bloco é a média das respostas, e não a média das médias.** As duas
só coincidem quando toda pergunta tem o mesmo número de respostas — e não têm,
porque pergunta opcional fica em branco. A média das médias daria peso igual a
uma pergunta respondida por 60 pessoas e a outra respondida por 3.

**Não entram em média nenhuma:** texto livre, escolha sem valor numérico,
múltipla escolha e Sim/Não. Não é um `if` por tipo — é o formato do dado:
`numeric_value` é nulo nesses casos e `avg` ignora nulo.

---

## 8. Percentuais e distribuição

**O denominador é quem RESPONDEU a pergunta**, e não o total de marcações.

| Tipo                         | Soma dos percentuais    |
| ---------------------------- | ----------------------- |
| Nota, escolha única, Sim/Não | 100%                    |
| **Múltipla escolha**         | **pode passar de 100%** |

Em múltipla escolha uma pessoa gera várias linhas. Dividindo pelas linhas, cada
percentual seria "quanto esta opção representa das marcações" — um número que
ninguém pediu. Dividindo por **pessoas**, cada percentual é "quantos dos que
responderam marcaram isto", e a tela avisa embaixo do gráfico que a soma passa de
100%.

**Alternativa com zero continua aparecendo.** "Ninguém deu Péssimo" é um
resultado, e escondê-la faria a distribuição mudar de forma entre dois eventos
com a mesma escala.

**A escala vem das opções**, nunca de um `5` escrito no código — o §9 é explícito
sobre não assumir cinco níveis para sempre.

---

## 9. Versionamento

Se as perguntas mudaram durante a coleta, **cada versão aparece em bloco
próprio**, rotulada — e o topo da tela avisa.

Somar "Tema e conteúdo" da v1 com o da v2 seria somar duas perguntas que só por
acaso têm o mesmo texto. Como as perguntas de cada versão são **linhas
diferentes**, agrupar por `question_id` já produz o comportamento certo de graça.

No **detalhe de uma resposta**, as perguntas exibidas são as da versão que
_aquela pessoa_ leu — nunca a atual.

Na **planilha**, com duas versões respondidas, o rótulo da coluna ganha o prefixo
`v1 ·` / `v2 ·`. Sem isso o cabeçalho teria "Infraestrutura - Recepção" duas
vezes, com conteúdos diferentes.

---

## 10. Reabertura e rodadas

Reabrir uma avaliação (§19 do Prompt 2) incrementa `answer_round` e **preserva** a
resposta anterior. Toda agregação filtra `a.round = pe.answer_round`, então a
tabulação lê apenas a rodada corrente.

Sem esse filtro, quem respondeu duas vezes pesaria o dobro na média — e a
resposta que a APCS decidiu descartar continuaria contando. O defeito seria
invisível: a média mudaria de 4,6 para 4,5 e ninguém teria como saber.

O detalhe da resposta mostra um selo **"rodada 2"** quando é o caso.

---

## 11. Comentários

**Não são anônimos** — foi decisão da APCS, registrada desde o Prompt 2.

Aparecem na aba **Respostas**, na mesma linha de quem escreveu: participante,
granja, data e o texto. O filtro "Com comentário" recorta a lista, e a busca
alcança participante, granja, e-mail e WhatsApp.

Um formulário com **mais de uma pergunta de texto** gera um comentário só,
juntado com `—`. Pegar apenas o primeiro esconderia o segundo sem avisar
ninguém.

---

## 12. A aba de Pendentes

Presentes que ainda **não responderam**. Inclui quem **nem tem avaliação
criada** — é o caso que ninguém descobre sozinho, porque não há linha para
aparecer em lugar nenhum.

**Cancelada fica de fora.** Alguém decidiu que aquela pessoa não vai receber;
listá-la como pendência faria a lista nunca esvaziar.

Cada linha traz situação do envio, data, prazo e o **motivo da falha**, quando
houve — e é o motivo que torna o reenvio útil: "telefone inválido" pede corrigir
o cadastro; um erro do fornecedor pede só tentar de novo.

### Situações

Reutilizam o enum do Prompt 2, inteiro. **"Falha" não é um status** — o banco não
tem `failed`: falha é `scheduled` com `last_error` preenchido, porque falha é
tentativa e não destino. A contagem de falhas sai daí.

`Ainda não gerada` é a **ausência de linha** ganhando nome na tela, e não um
sexto valor de enum.

---

## 13. A planilha

**CSV com BOM UTF-8 e separador `;`** — a convenção que o projeto já tem em
`surveys/[id]/results/export` e `registrations/[eventId]/export`. Abre no Excel
com dois cliques. Não há biblioteca de planilha no projeto, e acrescentar uma
para gerar um arquivo que o Excel abre igual seria pagar caro por nada.

Colunas fixas, depois **uma coluna por pergunta** (montadas a partir do
formulário real do evento), depois Comentário:

```
Evento · Data do evento · Participante · Granja/Empresa · E-mail · Telefone ·
WhatsApp · Data/Hora da resposta · Nota geral ·
<uma coluna por pergunta> · Comentário
```

- **respeita os filtros da tela** — o botão é um link montado pela mesma função
  que monta a paginação, e os dois lados leem os mesmos parâmetros;
- **leva o recorte inteiro**, nunca a página carregada (teto de 5.000 linhas);
- **nunca inclui o token** — a função do banco não o seleciona, e o
  `revoke select (token)` do Prompt 2 impediria mesmo se selecionasse;
- **escapa `=`, `+`, `-` e `@`** no começo de cada célula. O comentário é
  digitado numa página aberta na internet: alguém pode escrever
  `=HYPERLINK(...)` e esperar que a APCS abra a planilha;
- **deixa rastro** na trilha (`results_exported`), com quantas linhas e **se**
  houve busca — nunca o termo, que pode ser o e-mail ou o nome de alguém.

Uma falha ao gravar a trilha **não derruba o download**: um erro de auditoria não
deve transformar um relatório numa tela de erro para quem tem todo o direito de
baixá-lo. O caso fica no log do servidor.

---

## 14. Performance

Tudo é agregado no Postgres. O frontend não recebe resposta crua para somar —
o §44 é explícito: "não fazer: buscar 10.000 respostas → frontend calcula média".

**Índices acrescentados:**

| Índice                                                  | Para quê                   |
| ------------------------------------------------------- | -------------------------- |
| `..._answered_idx (event_id, answered_at desc)` parcial | a lista de respostas       |
| `..._version_idx (version_id, event_id)`                | quais versões têm resposta |
| `event_evaluation_answers_option_idx` parcial           | a distribuição             |
| `event_evaluation_answers_text_idx` parcial             | os comentários             |
| `..._questions_overall_idx` parcial                     | a pergunta geral           |

Os parciais existem porque a maioria das linhas não interessa àquelas consultas:
`answered_at` é nulo para quem não respondeu, e a maioria esmagadora das
respostas não é comentário.

Índices que **já existiam** e não foram refeitos: `(event_id, status)`,
`(status, scheduled_for)`, `(question_id)` e o único de resposta — que já serve
de prefixo para "as respostas desta avaliação nesta rodada".

---

## 15. Atualização

Server Components sem cache. Uma resposta nova aparece **no próximo
carregamento** — não há tempo real, e não é preciso (§24).

---

## 16. LGPD

- Comentários identificados só com `results.read`;
- planilha só com `results.export`, e auditada;
- **token nunca sai** em consulta, log ou arquivo;
- nada disso tem página pública;
- o log de erro da exportação não carrega o termo buscado.

---

## 17. Onde está cada coisa

| Camada           | Arquivo                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| Migration        | `supabase/migrations/20261003000100_event_evaluation_results.sql`       |
| Enum             | `supabase/migrations/20261003000000_event_evaluation_results_enums.sql` |
| Tipos            | `src/modules/event/event.results.types.ts`                              |
| Textos           | `src/modules/event/event.results.labels.ts`                             |
| Regras derivadas | `src/modules/event/event.results.rules.ts`                              |
| URLs / filtros   | `src/modules/event/event.results.routes.ts`                             |
| Leitura          | `src/lib/services/event-results.ts`                                     |
| Gráficos         | `src/app/(app)/events/results/results-charts.tsx`                       |
| Telas            | `src/app/(app)/events/results/`                                         |
| Exportação       | `src/app/(app)/events/results/[eventId]/export/route.ts`                |
| Testes           | `src/test/event-results.test.ts`, `src/test/sql-event-results.test.ts`  |

---

## 18. O que NÃO está aqui

Comparação entre eventos, IA nos comentários, análise de sentimento,
recomendações, ranking, benchmark histórico e painel cross-eventos.

**A modelagem não impede nada disso.** Toda resposta continua ligada a
`event_id`, `evaluation_id`, `version_id`, `question_id` e ao valor — que é o
que uma comparação futura vai precisar.
