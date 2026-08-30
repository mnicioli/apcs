# Inteligência — Base de Conhecimento e a camada de roteamento

Documentação do menu **Inteligência**. Leia antes de mexer no que o chatbot
responde, e antes de ligar um módulo novo ao robô.

> **Etapa 1 (esta entrega):** Base de Conhecimento + as mensagens configuráveis
> do chatbot.
> **Etapa 2 (a seguir):** Intelligence Layer — Intent Router, Tool Registry,
> contexto da conversa e o log de decisão.

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

| Pergunta do associado            | Fonte                      | Porta do chatbot                        | Regra de publicação                  |
| -------------------------------- | -------------------------- | --------------------------------------- | ------------------------------------ |
| "Qual o valor da Bolsa?"         | `market_bulletin_versions` | `market-chatbot.ts`                     | ativa + `chatbot_enabled` + vigência |
| "Me manda a normativa X"         | `document_versions`        | `documents.ts::getActiveChatbotVersion` | ativa + `available_for_chatbot`      |
| "Que eventos tem?"               | `events`                   | `event-chatbot.ts`                      | visibilidade por segmento            |
| "Quero uma palestra"             | `lectures`                 | `lecture-chatbot.ts`                    | só CRIA solicitação                  |
| "Qual o horário de atendimento?" | **`knowledge_entries`**    | **`search_knowledge()`**                | **ativo + liberado + vigência**      |

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

## 7. As cinco frases do chatbot

Em `/settings/chatbot`, gravadas em `app_settings`:

| Chave                   | Quando aparece                            |
| ----------------------- | ----------------------------------------- |
| `chatbot.welcome`       | a pessoa manda "oi"                       |
| `chatbot.fallback`      | o robô **não entendeu** o pedido          |
| `chatbot.no_result`     | entendeu, e **não há publicação vigente** |
| `chatbot.error`         | a consulta **falhou**                     |
| `chatbot.human_handoff` | pediu para falar com alguém               |

⚠️ **As três do meio parecem a mesma coisa e não são.** Textos iguais nos três
fariam a equipe atender sem saber qual dos três aconteceu — e o segundo ("não
temos boletim ativo") é trabalho para quem publica, enquanto o terceiro é
trabalho para quem cuida do sistema.

Cada uma tem um padrão escrito no código (`SETTING_FALLBACKS`) para o caso de a
linha não existir. Um bot sem frase de erro não fica calado: fica mandando
string vazia, que no WhatsApp é uma mensagem que nem chega a ser enviada.

---

## 8. Gaps conhecidos e o que vem na Etapa 2

### G1 — Não existe roteador de intenção fora do CSP

`CHAT_INTENTS` são as sete intenções **daquele fluxo**, não do domínio APCS. A
Etapa 2 traz `intent.registry.ts` e `router.ts`.

### G2 — As cinco portas de domínio existem e ninguém as chama

Todas carregam o mesmo comentário: _"ainda não está ligada ao `decide.ts`, e
isso é deliberado"_. A Etapa 2 traz o `tool.registry.ts` que as chama.

### G3 — Sem contexto de conversa no WhatsApp

`chat_conversations.collected` é do CSP. O §28 ("e a Câmara Setorial?") exige
estado persistido por conversa, com expiração (§30). Etapa 2.

### G4 — Sem log de decisão da IA

Intent, confiança, ferramenta, resultado (§26/§36) não são registrados em lugar
nenhum. Etapa 2, referenciando `whatsapp_chats` — **sem** criar uma estrutura
paralela de conversa (§27).

### G5 — Três portas de domínio usam o cliente AUTENTICADO

`documents.ts`, `market-chatbot.ts` e `event-chatbot.ts` usam
`@/lib/supabase/server`. O chatbot é **anônimo**: ligadas como estão, as três
devolvem vazio por RLS. Palestras e Enquetes já usam `@/lib/supabase/admin`.

Está na Etapa 2, e é a primeira coisa dela: sem isso o funil da Bolsa (§15) não
roda de ponta a ponta, e o Tool Registry teria três ferramentas que aparentam
funcionar e respondem "não encontrei".

### G6 — Sem cache, e é uma decisão

O §38 pede para avaliar cache. A recomendação é **não implementar agora**: a
elegibilidade depende de datas (`effective_date`, vigência), então um cache
correto teria de invalidar por relógio e não só por evento — e o próprio §38 diz
que ele nunca pode devolver conteúdo inativo. Risco assimétrico, ganho
hipotético até haver volume medido. O ponto de extensão fica; a infraestrutura,
não.

### G7 — Sem busca semântica, e também é uma decisão

`search_knowledge()` casa palavras-chave, título e (para perguntas curtas)
conteúdo. É determinístico e explicável — a tela de teste mostra exatamente o
que o robô veria.

O §42 pede que a estrutura **comporte** RAG no futuro, não que ele exista agora.
O caminho, quando houver volume: uma coluna de embedding em `knowledge_entries`
e um segundo termo no `order by` da mesma função. O contrato de saída
(`id, title, content, category, score`) já é o de um recuperador.
