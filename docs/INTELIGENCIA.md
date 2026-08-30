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

### O envio pelo WhatsApp

`handleIncomingMessage` devolve `{ body, attachments, handoff }` e **não envia
nada**. Quem coloca a resposta na conversa é o webhook — PROMPT 2/3. A separação
não é burocracia: é o que torna toda a conversa testável sem fornecedor, sem
rede e sem número de telefone.

Há um detalhe de prazo esperando lá: as URLs assinadas dos anexos duram 5
minutos (Bolsa e normativa) e 1 hora (imagem de evento). Quem baixa o arquivo é
o servidor do fornecedor, então a URL precisa continuar válida no momento em que
**ele** buscar — não no momento em que a montamos. Ver `OutboundDocumentMessage`.

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
