# Inteligência — Base de Conhecimento e a camada de roteamento

Documentação do menu **Inteligência**. Leia antes de mexer no que o chatbot
responde, e antes de ligar um módulo novo ao robô.

> **Etapa 1:** Base de Conhecimento + as mensagens configuráveis do chatbot.
> **Etapa 2:** Intelligence Layer — Intent Router, Tool Registry, contexto da
> conversa e o log de decisão.
>
> As duas estão entregues. O que **não** está é o envio pelo WhatsApp: o motor
> devolve a resposta pronta (texto + anexos) e quem a coloca na conversa é o
> webhook, que é o PROMPT 2/3.

---

## 1. O princípio, e ele já era o do chat

```
Pessoa escreve  →  LLM interpreta  →  Motor decide  →  Conteúdo oficial  →  Pessoa lê
                   (dados+intenção)   (determinístico)  (CRM, com versão)
```

**A IA nunca escreve o que o associado lê.** Ela lê a mensagem, identifica a
intenção e extrai parâmetros; quem escolhe o texto é código determinístico, a
partir de conteúdo que a APCS publicou.

Isso não é novo neste projeto: é exatamente como o chat da web já funciona desde
`20260804000000` (ver [CHAT.md](./CHAT.md), e `src/lib/chat/decide.ts`). O que a
Base de Conhecimento acrescenta é a fonte de resposta que faltava — a textual.

---

## 2. As cinco fontes de resposta, e quem manda em cada uma

| Pergunta do associado            | Fonte                      | Porta do chatbot       | Regra de publicação                  |
| -------------------------------- | -------------------------- | ---------------------- | ------------------------------------ |
| "Qual o valor da Bolsa?"         | `market_bulletin_versions` | `market-chatbot.ts`    | ativa + `chatbot_enabled` + vigência |
| "Me manda a normativa X"         | `document_versions`        | `document-chatbot.ts`  | ativa + `available_for_chatbot`      |
| "Que eventos tem?"               | `events`                   | `event-chatbot.ts`     | visibilidade por segmento            |
| "Quero uma palestra"             | `lectures`                 | `lecture-chatbot.ts`   | só CRIA solicitação                  |
| "Qual o horário de atendimento?" | **`knowledge_entries`**    | `knowledge-chatbot.ts` | **ativo + liberado + vigência**      |

⚠️ **A Base de Conhecimento não duplica nenhuma das outras quatro.** Ela existe
para o que não tem dono em lugar nenhum: horário, contato, como funciona um
processo, o que a associação faz. Preço e normativa continuam saindo do módulo
próprio, com versão e vigência — e o formulário avisa isso em cima do campo.

O risco real deste módulo não é técnico. É alguém colar o preço da semana num
item de conhecimento: ali ele não tem versão, não tem vigência, não tem trilha
de publicação, e ninguém nunca mais o revisa porque ele não aparece em lista
nenhuma de conteúdo.

---

## 3. A regra que manda em tudo (§43 do escopo)

```
ATIVO  +  DISPONÍVEL PARA CHATBOT  +  DENTRO DA VIGÊNCIA  =  ELEGÍVEL
```

Ela mora em **um** lugar: o `where` de `search_knowledge()`
(`20260913000100_knowledge.sql`, seção 7).

O chatbot não tem outra porta: `knowledge_entries` não tem policy de select para
`anon`, e a função é `security definer` justamente para que a regra seja
executada por quem a escreveu, e não remontada por quem chama.

`knowledge.rules.ts::isAvailableToChatbot` **espelha** esse `where` para a tela
poder explicar o estado sem ida ao banco. É uma dívida assumida — duas escritas
da mesma regra podem divergir —, e é `knowledge.rules.test.ts` que a mantém
visível: a tabela de casos de lá cita o `where` condição por condição.

### Status e "disponível para o chatbot" são coisas diferentes

Em Documentos existe o CHECK `available_for_chatbot = (status = 'active')`,
porque uma normativa publicada é, por definição, a que vale.

Aqui **não**, e é deliberado (§19 do escopo): "nosso telefone é X" pode estar
ativo como referência do atendimento humano e ainda não liberado para o robô
dizer sozinho. Copiar aquele CHECK apagaria essa decisão.

---

## 4. Palavras-chave: por que o banco as exige

A busca compara as palavras-chave com a **mensagem** da pessoa. Ninguém escreve
"Horário de atendimento" no WhatsApp — escreve "vocês abrem que horas?". O
título quase nunca aparece dentro da mensagem; a palavra-chave aparece.

Um item sem palavra-chave é invisível para o robô. E o sintoma seria o pior
possível: a equipe vê o item escrito, ativo e marcado como disponível, e o bot
responde "não encontrei".

Por isso a exigência é **estrutural**, não uma validação de formulário:

```sql
constraint knowledge_entries_chatbot_needs_keywords
  check (not available_for_chatbot or cardinality(keywords) >= 1)
```

E por isso a tela tem o painel **"Testar o que o chatbot encontraria"**, que
chama a mesma função do banco que o robô vai chamar. O erro que ele pega é
sempre o mesmo: palavras escritas como a APCS fala ("boletim", "cotação") quando
o associado escreve de outro jeito ("preço", "quanto tá").

---

## 5. O que foi construído (Etapa 1)

### Banco

| Objeto                           | Arquivo                              | Papel                               |
| -------------------------------- | ------------------------------------ | ----------------------------------- |
| `knowledge_status`               | `20260913000000_knowledge_enums.sql` | ativo/inativo, tipo próprio         |
| 4 verbos em `admin_audit_action` | idem                                 | criado, editado, ativado, inativado |
| `knowledge_categories`           | `20260913000100_knowledge.sql`       | catálogo editável pela tela         |
| `knowledge_entries`              | idem                                 | os itens                            |
| `knowledge_stamp_editor()`       | idem                                 | carimba `updated_by`                |
| `knowledge_audit()`              | idem                                 | a trilha, por **gatilho**           |
| `search_knowledge(text, int)`    | idem                                 | a porta do chatbot                  |
| 5 chaves em `app_settings`       | idem                                 | as frases do robô                   |

**A auditoria é gatilho, e não chamada** — divergindo do resto do projeto. Não
há função de escrita aqui: a tela grava pelo PostgREST, com RLS e grants de
coluna fazendo a segurança. Criar três RPCs só para ter onde chamar
`log_admin_action` seria uma camada a mais para não fazer mais nada. No gatilho,
não existe caminho de escrita — tela, script, psql, correção manual — que
escape.

### Aplicação

- `src/modules/intelligence/knowledge.{types,schema,rules,labels}.ts`
- `src/lib/services/knowledge.ts` (leitura; cliente autenticado, RLS valendo)
- `src/lib/actions/knowledge.ts` (escrita; `ActionResult`, nunca `throw`)
- `/knowledge`, `/knowledge/new`, `/knowledge/[id]/edit`
- `/settings/chatbot` — as cinco frases
- `knowledge.read` / `knowledge.write` no RBAC + `app_role_ceilings`

### Testes

- `knowledge.rules.test.ts` — o espelho do §43, os extremos da janela, o fuso
- `knowledge.schema.test.ts` — a exigência de palavra-chave, as datas, a janela
- `src/test/sql-role-ceilings.test.ts` — **guarda nova**, ver abaixo

---

## 6. A armadilha que o guard novo pega

Adicionar uma permissão exige **três** escritas, e a terceira é a que se esquece:

1. `PERMISSION_MATRIX` (`rbac.config.ts`) — o que o código entende;
2. `app_role_ceilings` — o teto de cada papel-base, no banco;
3. `app_role_permissions` — **o que cada cargo realmente abre**.

Os cargos embutidos foram semeados em `20260903000100` com uma cópia do teto
**daquele momento**. Uma permissão acrescentada depois entra no teto e não entra
em cargo nenhum — e o resultado é o pior tipo de defeito: RLS liberada, tela no
ar, item de menu invisível **até para o Administrador**, e nada no sistema
dizendo por quê.

`src/test/sql-role-ceilings.test.ts` cobre os três casos e reprova a migration
que mexe no teto sem semear os embutidos. A migration desta entrega também
confere isso na própria aplicação (seção "A CONFERÊNCIA").

---

## 7. As seis frases do chatbot

Em `/settings/chatbot`, gravadas em `app_settings`:

| Chave                   | Quando aparece                                    |
| ----------------------- | ------------------------------------------------- |
| `chatbot.welcome`       | a pessoa manda "oi" — e também quando pede ajuda  |
| `chatbot.fallback`      | o robô **não entendeu** o pedido                  |
| `chatbot.no_result`     | entendeu, e **não há publicação vigente**         |
| `chatbot.error`         | a consulta **falhou**                             |
| `chatbot.unidentified`  | a resposta depende de saber **quem** está falando |
| `chatbot.human_handoff` | pediu para falar com alguém                       |

⚠️ **As quatro do meio parecem a mesma coisa e não são**, e cada uma é trabalho
de uma pessoa diferente: `no_result` é de quem publica, `error` é de quem cuida
do sistema, `unidentified` é de quem cuida do cadastro, e `fallback` é de quem
escreve as palavras-chave. Um texto só para todas faria a equipe atender sem
saber qual dos quatro aconteceu.

⚠️ **Saudação e ajuda compartilham `welcome` de propósito.** A frase de
boas-vindas É, por construção, a lista do que o robô sabe fazer — que é a
resposta a "o que você faz?". Um texto de ajuda separado seria uma segunda cópia
da mesma lista, e a segunda é a que envelhece quando um módulo novo é ligado.

Cada uma tem um padrão escrito no código (`SETTING_FALLBACKS`) para o caso de a
linha não existir. Um bot sem frase de erro não fica calado: fica mandando
string vazia, que no WhatsApp é uma mensagem que nem chega a ser enviada.

---

## 8. A camada de roteamento (Etapa 2)

```
mensagem
   |
   +- tem pergunta pendente?  -> affirmation.ts   (sim/nao, SEM modelo)
   |                                 |
   +- nao                      -> classify.ts     (LLM: intent + confianca + assunto)
                                     |
                                     v
                               router.ts   <- puro, testavel, sem I/O
                                     |
        +---------------+------------+--------+--------------+
        v               v                     v              v
     tools.ts       confirmacao           mensagem        handoff
   (5 ferramentas)  (faixa media)      (app_settings)      (§31)
```

| Peça          | Arquivo                                       | Responsabilidade                     |
| ------------- | --------------------------------------------- | ------------------------------------ |
| Registro      | `src/modules/intelligence/intent.registry.ts` | intenção → ferramenta, sensibilidade |
| Decisão       | `src/modules/intelligence/router.ts`          | **puro**: escolhe o que fazer        |
| Interpretação | `src/lib/intelligence/classify.ts`            | chama o Claude; devolve JSON         |
| Sim/não       | `src/lib/intelligence/affirmation.ts`         | determinístico, sem modelo           |
| Ferramentas   | `src/lib/intelligence/tools.ts`               | consultam as portas de domínio       |
| Memória       | `src/lib/intelligence/context.ts`             | §28, §29, §30                        |
| Trilha        | `src/lib/intelligence/log.ts`                 | §26, §36                             |
| Encanamento   | `src/lib/intelligence/engine.ts`              | banco → modelo → decisão → banco     |

### As três faixas de confiança (§23)

| Faixa | Consulta                | Ação sensível |
| ----- | ----------------------- | ------------- |
| alta  | ≥ 0.75 executa          | ≥ 0.85        |
| média | ≥ 0.45 confirma         | idem          |
| baixa | responde com `fallback` | idem          |

⚠️ **A faixa do meio existe por causa do §24.** "Quero saber o valor" não pode
virar Bolsa automaticamente — pode ser a anuidade. O robô pergunta.

⚠️ **Ação sensível é a que deixa rastro fora do robô**: abrir uma solicitação,
ou chamar uma pessoa. Consultar o boletim errado custa uma mensagem; chamar um
atendente por engano custa o tempo de alguém e faz o associado esperar.

⚠️ **Confiança fora de faixa, ou `NaN`, cai em "baixa".** O número vem de um
modelo, e "não sei ler isto" tem de falhar para o lado que pergunta de novo.

### A memória, e por que ela expira

`conversation_context` guarda a última intenção e o último assunto **por
conversa**. É o que faz "E a Câmara Setorial?" — uma frase sem verbo — ser
compreensível: ela herda a intenção do turno anterior.

⚠️ **A herança sempre CONFIRMA, nunca executa.** É inferência nossa, não leitura
do modelo; tratá-la como certa faria uma frase solta disparar uma ferramenta.

⚠️ **Trinta minutos** (§30). Curto demais quebra a conversa de WhatsApp, onde a
pessoa responde quando pode; longo demais faz o robô responder a pergunta de
ontem.

⚠️ **Uma linha por conversa** — a chave primária é o id do chat. Isso é o que
dispensa rotina de limpeza: a tabela nunca passa do número de conversas.

### O log de decisão

`intelligence_interactions` — uma linha por mensagem processada. Ela **não
guarda o texto da mensagem** (§35): ele já vive em `whatsapp_messages`, com a
política de retenção daquele módulo. O que fica aqui é o raciocínio.

⚠️ **`tool_empty` e `tool_error` são valores separados no enum**, e é a decisão
central da tabela. Mil `tool_empty` são um catálogo desatualizado; mil
`tool_error` são um incidente. A soma dos dois não distingue nada.

---

## 9. O que ficou de fora, e por quê

### As duas ferramentas de ESCRITA

`solicitar_palestra` e `participar_enquete` **encaminham para uma pessoa** em vez
de executar. As portas do banco já existem e são estreitas de propósito
(`create_lecture_request` não tem parâmetro de status; `register_survey_response`
só registra um voto).

O que falta não é a porta: é o **roteiro** que coleta nome, cidade e contato ao
longo de vários turnos. Roteiro é `csp.flow.ts` — com slots, ordem e retomada —,
e não cabe num roteador de um turno só. Espremer as duas numa ferramenta faria o
robô perguntar tudo de uma vez e falhar na primeira resposta parcial.

É o primeiro item natural de um próximo passo.

### O envio pelo WhatsApp — feito na Etapa 3, ver a seção 11

`handleIncomingMessage` continua devolvendo a resposta e **não enviando nada**;
quem a coloca na conversa é `deliver.ts`. A separação não é burocracia: é o que
torna toda a conversa testável sem fornecedor, sem rede e sem número de telefone.

⚠️ **O prazo das URLs assinadas mudou por causa desta etapa.** As portas de
chatbot assinavam com 5 minutos, que é o prazo das telas — dimensionado para um
navegador, com uma pessoa olhando. No caminho do WhatsApp não há navegador: quem
baixa o arquivo é o servidor da Z-API, quando **ele** processar o envio.

O `broadcast-dispatch.ts` já tinha aprendido isso e assina com uma hora
("uma URL curta demais expiraria no meio da fila e as últimas pessoas receberiam
só o texto — sem erro nenhum, que é a pior forma de falhar"). As portas de
chatbot passaram a usar `CHATBOT_SIGNED_URL_TTL_SECONDS`, com a mesma folga. As
telas continuam com os 5 minutos.

### A precedência das Enquetes (§32)

Quando há enquete em andamento, quem trata a mensagem é `survey-inbox.ts`,
**antes** do roteador — aquele é um autômato com pergunta corrente e tolerância
a resposta inválida. O mesmo vale para o opt-out global, que vem antes de tudo.

Essa ordem já existe no webhook da Z-API e precisa continuar existindo quando o
roteador entrar na fila. Está escrito aqui para não ser redescoberto.

### Sem cache, e é uma decisão

O §38 pede para avaliar cache. A recomendação é **não implementar agora**: a
elegibilidade depende de datas, então um cache correto teria de invalidar por
relógio e não só por evento — e o próprio §38 diz que ele nunca pode devolver
conteúdo inativo. Risco assimétrico, ganho hipotético até haver volume medido.

### Sem busca semântica, e também é uma decisão

`search_knowledge()` casa palavras-chave, título e (para perguntas curtas)
conteúdo. É determinístico e explicável — a tela de teste mostra exatamente o que
o robô veria.

O §42 pede que a estrutura **comporte** RAG, não que ele exista. O caminho,
quando houver volume: uma coluna de embedding em `knowledge_entries` e um segundo
termo no `order by` da mesma função. O contrato de saída
(`id, title, content, category, score`) já é o de um recuperador.

---

## 10. As guardas que este módulo acrescentou

| Teste                           | O que ele impede                                            |
| ------------------------------- | ----------------------------------------------------------- |
| `sql-role-ceilings.test.ts`     | permissão que existe no teto e em cargo nenhum              |
| `chatbot-doors.test.ts`         | porta de chatbot com o cliente do usuário — resposta vazia  |
| `intelligence-registry.test.ts` | nome de intenção que o CHECK do banco recusaria em produção |
| `router.test.ts`                | qualquer caminho do roteador que produza texto não aprovado |

As três primeiras nasceram de defeitos reais deste projeto. A última é a versão,
para esta camada, do que `decide.test.ts` já faz para o chat da web.

---

## 11. O WhatsApp (Etapa 3)

A camada anterior decidia e não falava. Esta a liga ao número da APCS.

### A fila do webhook

```
Z-API → /api/webhooks/zapi/[secret]
            ↓
        livro-razão      grava TUDO, antes de qualquer decisão
            ↓
        opt-out          quem pediu para sair não recebe mais nada
            ↓
        enquetes         um "3" dentro de uma enquete é voto, não pergunta
            ↓
        robô             o resto — e só DEPOIS do 200
```

**A ordem é a regra.** Cada passo tira eventos do seguinte, e trocar dois de
lugar não é refatoração: é mudar o que a APCS responde a uma pessoa.

O que tornou a costura possível foi pequeno: `recordInboundEvents` passou a
devolver **quais** mensagens gravou (`RecordedMessage[]`), e
`processInboundEvents` passou a devolver **quais** eventos tratou (`handled`) —
o mesmo campo que o opt-out já tinha. Antes, os dois devolviam contagens, e uma
contagem não permite saber o que sobrou.

O `survey-inbox.ts` já dizia, em dois comentários escritos meses antes, que os
eventos sem contexto de enquete eram "o fluxo normal do chatbot". Faltava só o
webhook conseguir saber quais eram.

### Por que a resposta sai depois do 200

Classificar chama um modelo; enviar chama o fornecedor duas ou três vezes. São
segundos, às vezes mais de dez. Para a Z-API, demora significa "não recebi" — e
ela reentregaria o payload no meio da nossa própria resposta.

O robô roda em `after()`, como os anexos já rodavam. É o §39.

### Nada disso entrou numa fila

O §38 pede para usar a fila, se houver. **Há**, e ela não serve aqui: as filas de
`broadcast-dispatch` e `event-dispatch` são de campanha — reivindicação em lote,
orçamento por corrida e, sem cron no projeto, um botão "Continuar" na tela. Uma
resposta de chatbot posta ali esperaria alguém clicar.

O que a fila existe para resolver — não estourar o limite do fornecedor com mil
envios — não é o problema de uma resposta para uma pessoa que está esperando.

**E o retry é menor aqui: duas tentativas, não três.** Não é preferência, é
aritmética de prazo: o timeout do fornecedor é de 15 s e a rota tem
`maxDuration = 60`. Três tentativas que estourem são 45 s, e com a classificação
antes e o download de anexo depois, a plataforma mataria a função no meio do
envio — deixando a mensagem presa em `pending`, sem ninguém para curá-la.

A razão humana leva ao mesmo número: quem escreveu "qual a bolsa hoje?" já
desistiu antes da terceira tentativa. Melhor a mensagem virar falha visível na
caixa de entrada, onde um atendente a vê.

### O silêncio

Três coisas calam o robô, e todas moram em `whatsapp_bot_should_answer`:

| Motivo                     | Por quê                                                         |
| -------------------------- | --------------------------------------------------------------- |
| conversa de grupo          | um grupo não é alguém perguntando, e não há a quem mandar o PDF |
| `bot_paused_until` vigente | uma pessoa está atendendo, ou o robô acabou de encaminhar       |
| atendimento humano aberto  | a mesma checagem que as Enquetes já faziam, agora em SQL        |

**A pausa é uma data, e não um interruptor.** Um `bot_ativo = false` precisaria
de alguém para religar, e a caixa de entrada do WhatsApp não tem botão de
"resolver" — o robô ficaria mudo naquela conversa para sempre, e o sintoma
apareceria meses depois como "o bot parou de responder para o fulano". Com data,
o silêncio expira sozinho; cada fala humana o renova.

Quem renova é um **gatilho** (`whatsapp_messages_pause_bot`), e não uma chamada.
A razão é concreta: há dois caminhos por onde uma pessoa fala — a tela do CRM
(`origin = 'agent'`) e o celular físico (`origin = 'phone'`, que chega pelo
webhook). O segundo não passa por código nosso nenhum; não existe lugar onde
encaixar a chamada.

### O eco — a armadilha que quase passou

A Z-API devolve pelo webhook **tudo** que sai do número, inclusive o que ela
mesma acabou de enviar a nosso pedido. Esse retorno é gravado como
`origin = 'phone'` ("veio do aparelho"), e a duplicata é descartada pelo índice
de `provider_message_id`.

Só que o id do fornecedor é escrito na **liquidação**, depois do envio. Entre
gravar pendente e liquidar cabem os 15 s do timeout do fornecedor — e um eco que
chegue nessa janela não casa com nada: entra como linha nova, com cara de pessoa
digitando no celular, e dispararia o gatilho.

O sintoma seria **"o bot responde a primeira mensagem e ignora o resto"**, por
uma hora, sem nada no log. O desvio está em `whatsapp_pause_bot_on_human` e o
teste que o fixa, em `whatsapp-bot-sql.test.ts`.

### A porta de saída, e o contador que ela não toca

O robô não usa `whatsapp_start_outbound_message` (a do atendente) por três
motivos, e o terceiro é o que dói: ela **zera `unread_count`**, com a
justificativa correta, para uma pessoa, de que "responder é ler".

Aplicada ao robô, essa linha faz a conversa desaparecer da aba "Não lidas" — e o
associado que escreveu "quero falar com alguém" recebe a frase de encaminhamento
e nunca mais é procurado. Ninguém veria: a caixa fica bonita, vazia e errada.

Por isso `whatsapp_start_bot_message`, com `origin = 'bot'`, sem autor, e sem
tocar no contador. A conferência da migration lê o corpo da função e recusa o
push se ele voltar a mexer nele.

### Imagem e PDF (§13, §14)

A ordem que a pessoa lê é a do §14 — explicação, imagem, PDF. **A explicação vai
como legenda da imagem**, e não como um balão antes dela.

É um desvio deliberado da letra do §14, pela razão que `messaging.types.ts` já
tinha escrito: dois balões separados podem ser entregues fora de ordem, e a
pessoa veria o cartaz sem explicação — ou a explicação antes do cartaz. Os dois
fornecedores aceitam legenda no anexo.

O segundo anexo leva o **nome do arquivo** como legenda: é o que a pessoa vê
embaixo do PDF e o que ela vai procurar seis meses depois.

Falha permanente **interrompe o resto**. Mandar o PDF sozinho, sem a imagem com a
explicação, entrega um arquivo do nada.

### Idempotência (§40, §41)

O robô não tem tabela própria de "já processei". Ele herda a do livro-razão: o
índice único de `provider_message_id` existe desde agosto, e o que mudou foi
`recordInboundEvents` passar a **dizer** o que era reentrega. Uma segunda entrega
do mesmo webhook produz zero mensagens.

### Rastreabilidade (§46)

```
provider_message_id → whatsapp_messages.id → intelligence_interactions
                                                  ↓ intent, confidence, tool, outcome
                                             reply_message_id → a mensagem que saiu
```

`reply_message_id` é a coluna nova. Sem ela, ligar "o robô decidiu mandar a
Bolsa" a "este PDF saiu às 14h32" seria adivinhação por proximidade de horário.

O `correlationId` costura tudo isso no log, no escopo `intelligence`.

### O que o §48 pede, e onde está

| Evento do §48              | Onde                                                       |
| -------------------------- | ---------------------------------------------------------- |
| `CHATBOT_MESSAGE_RECEIVED` | `whatsapp_messages` (o livro-razão)                        |
| `INTENT_IDENTIFIED`        | `intelligence_interactions.intent` + `confidence`          |
| `KNOWLEDGE_ACCESSED`       | `intelligence_interactions.tool = getKnowledge`            |
| `DOCUMENT_ACCESSED`        | `tool = getActiveNormativa` / `getActiveComunicacao`       |
| `MEDIA_SENT`               | `whatsapp_messages` com `origin = 'bot'` e `kind` de anexo |
| `HUMAN_HANDOFF`            | `outcome = 'handoff'` + `bot_paused_until` preenchido      |

**Não há tabela nova de auditoria**, e é deliberado: `admin_audit_log` exige um
ator autenticado, e o robô não é ninguém. Um contador de anexos em
`intelligence_interactions` seria um segundo registro do mesmo fato, com menos
informação (sem id do fornecedor, sem status de entrega) e livre para divergir.

---

## 12. Pendências desta etapa

### O webhook da Cloud API não tem robô

`/api/webhooks/whatsapp` (Meta) só alimenta Enquetes — ele nunca chamou
`recordInboundEvents`, então não há conversa no livro-razão a que o robô possa
responder. A caixa de entrada inteira foi construída para a Z-API, que é o
fornecedor em uso.

Se a APCS trocar de fornecedor, o conserto é conhecido: acrescentar
`recordInboundEvents` e as mesmas duas chamadas daquela rota. Bolar agora uma
segunda ingestão para um fornecedor não contratado seria a integração duplicada
que o §1 proíbe.

### Foto e áudio não são respondidos

Uma mensagem só com anexo não tem o que classificar, e o §36 é explícito que o
MVP não interpreta mídia. As duas saídas eram responder "não entendi" ou ficar
calado, e o calado ganhou: a conversa fica com o contador de não lidas **aceso**,
que é o caminho real de escalada. Um "não entendi" automático faria a pessoa
achar que foi atendida e parar de esperar.

O dia em que houver transcrição de áudio, a condição some (`motivoParaPular`, em
`intelligence-inbox.ts`).

### Não há roteamento de atendimento (§23)

O §23 pede para usar a lógica de distribuição existente — Compras, Logística,
SAC. **Ela não existe**, e o `docs/WHATSAPP.md` já registrava isso: a caixa de
entrada não tem atribuição nem fila.

Esta etapa não a criou. Ela criou a pergunta menor que o robô precisa responder
("devo falar agora?"), que é uma data e não um dono. Quando a atribuição chegar,
ela substitui a checagem de pausa dentro de `whatsapp_bot_should_answer` e nada
mais neste módulo muda.

### O eco duplica uma linha no histórico

O desvio do eco impede a **pausa** indevida, mas a linha duplicada continua sendo
gravada (uma mensagem `origin = 'phone'` com o mesmo texto). É uma condição
anterior a este módulo — vale para a resposta do atendente também — e o conserto
é na ingestão, não aqui.

---

## 13. As guardas desta etapa

| Teste                        | O que ele impede                                                     |
| ---------------------------- | -------------------------------------------------------------------- |
| `deliver.test.ts`            | PDF antes da imagem; anexo para o número errado; meia resposta       |
| `intelligence-inbox.test.ts` | robô respondendo por cima de enquete, de atendente ou do próprio eco |
| `whatsapp-bot-sql.test.ts`   | a função do robô voltar a zerar `unread_count`                       |

A última tem uma irmã na própria migration, que lê `pg_proc`. As duas existem
porque a conferência do banco só roda no `db:push` — ou seja, depois de alguém
decidir aplicar em produção.
