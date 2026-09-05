# Fluxos de Atendimento

supabase/migrations/20260920000000_flow_operations_enums.sql os 2 verbos de auditoria novos
supabase/migrations/20260920000100_flow_operations.sql SLA, checklist, laco, metricas
supabase/migrations/20260920000200_flow_operations_error_codes.sql correcao: FL005/FL006 colidiam

**Inteligência → Fluxos de Atendimento** — o desenho do caminho que uma conversa
percorre antes de chegar a uma pessoa.

Antes deste módulo, esse caminho vivia em código (`intent.registry.ts`,
`router.ts`, `engine.ts`): mudar a triagem exigia um programador, um deploy e um
`pnpm db:types`. O módulo tira essa decisão do código e a coloca numa tela.

> **Estado: pronto para operação (Prompts 1 a 5 de 5).** Uma pessoa da APCS
> monta o fluxo, testa no simulador, homologa, aprova, publica e acompanha —
> sem tocar em código. Uma mensagem real do WhatsApp entra pelo webhook,
> atravessa o fluxo publicado, consulta o conteúdo oficial ou transfere para um
> time com prazo registrado. A IA lê a frase quando o desenho pede, e nunca
> escolhe o nó.
>
> O que ficou de fora está em [Pendências](#16-pendências) — a mais próxima de
> um defeito é o cron do timeout, que não está agendado.

> **Para OPERAR** (montar, testar, homologar, publicar, acompanhar), o guia é
> [FLUXOS-COMO-USAR.md](./FLUXOS-COMO-USAR.md). Este documento é a parte técnica.

> **O robô de um turno continua existindo, e continua atendendo.** Ele é o
> caminho de quem NÃO está num fluxo. Enquanto a APCS não publicar um fluxo de
> entrada, o atendimento é exatamente o de antes — ver
> [a fila do webhook](#a-fila-do-webhook).

---

## 1. Os conceitos, e por que são separados

| Conceito      | Responde                                 | Tabela             |
| ------------- | ---------------------------------------- | ------------------ |
| **Fluxo**     | que atendimento é este, e está ligado?   | `flows`            |
| **Versão**    | qual DESENHO, e em que etapa ele está?   | `flow_versions`    |
| **Nó**        | o que acontece neste ponto               | `flow_nodes`       |
| **Transição** | para onde vai depois, e sob que condição | `flow_transitions` |
| **Execução**  | o que está acontecendo NESTA conversa    | `flow_runs`        |
| **Passo**     | cada avanço, com trava contra repetição  | `flow_run_steps`   |
| **Time**      | para quem a conversa é transferida       | `attendance_teams` |

---

## 2. As quatro regras que mandam em tudo

1. **Só se edita rascunho.** Versão publicada é imutável.
2. **Uma publicada por fluxo.** É um índice único parcial, não uma convenção.
3. **Nada se apaga.** A versão substituída vira `superseded` e fica.
4. **Quem decide é o motor.** A IA entrega intenção e confiança; a escolha do
   caminho é determinística.

As três primeiras estão em constraint e gatilho. A quarta é de arquitetura e
mora em `src/modules/flow/flow.engine.ts` — ali ela aparece como o que **não**
existe: nenhum campo daquele arquivo guarda texto gerado.

---

## 3. O ciclo de vida

```
RASCUNHO ──► EM TESTE ──► AGUARDANDO APROVAÇÃO ──► APROVADA ──► NO AR
    ▲            │                  │                  │
    └────────────┴──────────────────┴──────────────────┘
                    (volta para rascunho)
```

**Alterar um fluxo que está no ar** nunca é editar a versão publicada: é
`create_flow_version()`, que COPIA o desenho para um rascunho novo. A v1
continua exatamente como era — e é isso que torna o rollback possível.

**Ligar e desligar** é do FLUXO (`flows.status`), não da versão. Se "inativar"
fosse estado da versão, desligar o fluxo por uma tarde escreveria numa versão
publicada — a regra mais importante do módulo quebrada pelo botão mais banal
dele.

**Rollback** é publicar de novo uma versão `superseded`. É a mesma função, com
verbo de auditoria diferente, para que "isto foi um avanço ou uma volta?"
continue respondível.

---

## 4. As duas formas do desenho

O desenho existe em dois formatos, e **nunca as duas são autoridade ao mesmo
tempo**:

| Situação da versão | Quem manda        | `definition` |
| ------------------ | ----------------- | ------------ |
| Rascunho           | as TABELAS de nós | `NULL`       |
| Publicada          | o JSONB congelado | preenchido   |

A travessia é `publish_flow_version()`, que compila um no outro. O CHECK
`flow_versions_definition_shape` torna isso estrutural.

O ganho é o motor: ler um fluxo em produção é **um** select por chave primária,
sem join, e sem a possibilidade de alguém ter arrastado um nó entre duas
mensagens da mesma conversa.

---

## 5. Chaves estáveis — rótulo ≠ regra

Toda opção, todo nó e todo time carregam uma **chave em MAIÚSCULAS**
(`EVENTOS`, `PERGUNTA_ASSUNTO`, `TIME_MARKETING`). É ela que a versão publicada
guarda.

O texto que a pessoa lê pode mudar numa quinta-feira:

```
"Eventos e inscrições"  →  "Eventos"        a chave continua EVENTOS
```

**Nunca existe condição por número de opção.** A lista numerada do WhatsApp é
uma forma de APRESENTAR; o motor traduz "2" para a chave na primeira linha em
que lê a resposta, e nada além daquela função sabe que houve um número.
Reordenar as alternativas na tela é inofensivo — e há um teste que garante isso.

---

## 6. Times, não pessoas

O fluxo aponta para `TIME_MARKETING`, nunca para a Maria.

Se apontasse para a pessoa, o dia em que ela saísse do time seria o dia de abrir
CADA versão publicada e trocar o destino — e versão publicada não se edita. O
fluxo apontaria para alguém que não está mais lá, para sempre.

Trocar quem atende é `setAttendanceTeamMembersAction`, e não toca em fluxo,
versão, nó nem transição.

Os sete times nascem com a migration, ativos e sem membros: quem está em cada um
é decisão da APCS.

---

## 7. Motor e situação da conversa

São duas dimensões independentes, e confundi-las é o erro fácil:

| `flow_runs.status`    | o MOTOR       | `running`, `waiting_reply`, `handed_off`, `completed`, `failed`, `cancelled`             |
| --------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `conversation_status` | o ATENDIMENTO | `new`, `triage`, `waiting_reply`, `in_service`, `waiting_customer`, `resolved`, `closed` |

Elas andam juntas em um único ponto: a transferência para um time. Em todo o
resto, a pergunta "o robô travou ou a pessoa está com alguém?" precisa de duas
respostas.

---

## 8. Idempotência

Webhook reentrega — e reentrega justamente quando a primeira resposta demorou,
ou seja, sob carga, que é quando uma checagem em código perde a corrida.

A trava é o índice único `flow_run_steps (flow_run_id, idempotency_key)`, onde a
chave é o id da mensagem que provocou o passo. A mesma mensagem chegando duas
vezes falha com 23505 na segunda, e o motor sabe que aquele passo já foi dado.

O registro de ações marca quais **escrevem** (`writes: true`) — para essas, a
trava não é conforto, é obrigação: dois protocolos de palestra significam alguém
ligando duas vezes para a mesma pessoa.

---

## 9. Onde as regras são conferidas

| Regra                                        | Onde vale                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Uma versão publicada por fluxo               | índice único parcial                                                                                |
| Um nó inicial por versão                     | índice único parcial                                                                                |
| Transição não alcança nó de outra versão     | FK **composta**                                                                                     |
| Só se escreve nó/transição em rascunho       | gatilho `flow_graph_draft_only` (FL001)                                                             |
| Nó inicial, nó final, beco sem saída, órfão… | `validate_flow_version()`, na publicação                                                            |
| Publicar sem aprovar                         | `publish_flow_version()` (FL004)                                                                    |
| Publicar por `PATCH`, sem validar            | **grant de coluna** — `status`, `definition` e `active_version_id` são revogados de `authenticated` |
| Excluir fluxo com histórico                  | `delete_flow()` (FL007) + `revoke delete`                                                           |
| Ação de negócio sem handler ligado           | `publishFlowVersionAction` (TypeScript)                                                             |

A última é a única cuja barreira **não** está no banco, e é declarada como
exceção em `flow.rules.ts`: saber se `consultar_bolsa` tem handler é uma
propriedade do build que está no ar, e o Postgres não tem como conhecê-la.

---

## 10. Permissões

| Papel                   | Fluxos                                                     |
| ----------------------- | ---------------------------------------------------------- |
| Administrador (`admin`) | tudo: desenhar, testar, aprovar, publicar, ligar, reverter |
| Atendente (`comercial`) | consultar                                                  |

**O escopo pedia um "Gestor" e ele não existe neste projeto**: o papel `ceo` foi
aposentado em `20260902000000_retire_roles.sql`, e um CHECK em `profiles.role`
impede que qualquer conta o tenha. Ressuscitá-lo traria junto 122 referências em
policies antigas.

O caminho para um "Gestor de Fluxos" é um **cargo** criado em `/permissions` com
base `admin` e só as chaves `flows.*` — um cargo tira do teto do papel-base, que
é exatamente o desenho de `20260903000100_custom_roles.sql`.

---

## 11. Estendendo

**Uma ação de negócio nova** (§26 do escopo) são duas linhas em
`src/modules/flow/flow.actions.registry.ts`: o valor em `FLOW_ACTION_KEYS` e a
entrada no registro. Nem o motor, nem o validador, nem a tela mudam — o
`Record<FlowActionKey, …>` completo faz o TypeScript apontar o que falta.

**Ligar o handler** (Prompt 3) é uma entrada em `FLOW_ACTION_HANDLERS`, apontando
para o serviço que já existe (`market-chatbot.ts`, `knowledge-chatbot.ts`, …).

**Um canal novo** já tem o enum (`flow_channel` nasceu com `whatsapp` e `web`) e
o desenho está escrito em `20260914000200_intelligence.sql`: coluna irmã de
`whatsapp_chat_id` mais um CHECK de "exatamente um dos dois".

**Um tipo de nó novo** exige `alter type ... add value` no arquivo de enums
(separado, sempre) + um ramo no `switch` de `percorrer()` + um membro na união
discriminada de `flow.schema.ts`. O TypeScript aponta os três.

---

## 12. O Builder visual

`/flows/[id]` — quatro áreas: dados do fluxo em cima, caixa de ferramentas à
esquerda, canvas no meio, propriedades à direita. O canvas é
[React Flow](https://reactflow.dev) (`@xyflow/react`), a única dependência de
peso que o módulo trouxe, carregada só nessa rota.

**A peça mais importante é a bolinha de saída.** Uma pergunta de escolha ganha
um ponto de ligação POR ALTERNATIVA, e cada ponto carrega a CHAVE dela. Arrastar
de "Eventos" até o próximo nó monta a condição `{answer, EVENTOS}` — ninguém
digita chave, ninguém escolhe número, e não existe caminho pelo qual uma seta
acabe presa a uma posição. Reordenar as alternativas move as bolinhas e mantém
as setas.

**Auto save** com espera de 800ms. Posições viajam por uma ação própria
(`saveNodePositionsAction`) e **não entram na trilha** — o gatilho ignora o
UPDATE em que só a posição mudou, senão uma tarde reorganizando o desenho
produziria centenas de linhas de "etapa alterada".

**Onde cada coisa é cobrada** — a divisão foi corrigida durante o Builder:

| Camada     | Confere                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| Zod        | a FORMA: campo existe, tipo bate, chave no formato, alternativa repetida  |
| Publicação | se está COMPLETO: texto escrito, time ativo, duas alternativas de verdade |

A versão anterior cobrava conteúdo na gravação, e isso quebrava a primeira ação
do desenhador: arrastar uma caixinha de mensagem cria o nó na hora, com o texto
vazio — e a criação era recusada antes de a caixinha aparecer.

**Testar fluxo** roda `advanceFlow()`, o motor de verdade — o mesmo que vai
atender no WhatsApp. As ações de negócio não são executadas: o simulador mostra
qual seria e segue como se tivesse dado certo, dizendo isso na tela.

---

## 13. O motor de execução

O Builder desenha "como o fluxo deve funcionar". O motor responde, a cada
mensagem, "qual é o próximo passo". São coisas separadas de propósito, e a
separação vale para dentro do motor também:

| Camada                | Faz                                                 |
| --------------------- | --------------------------------------------------- |
| `flow.engine.ts`      | **decide** — puro, sem I/O; devolve efeitos         |
| `flow.executors.ts`   | executa UM tipo de nó; um tipo novo é uma entrada   |
| `flow.transitions.ts` | escolhe a seta — a única decisão de rumo do sistema |
| `flow.operators.ts`   | compara valores; doze operadores num registro       |
| `lib/flow/store.ts`   | grava, sempre por função do banco                   |
| `lib/flow/actions.ts` | chama o handler de negócio, com retry               |
| `lib/flow/deliver.ts` | traduz efeito em mensagem de WhatsApp               |
| `lib/flow/runtime.ts` | **orquestra** os cinco na ordem certa               |

### A ordem que importa: grava, depois fala

A tentação é o contrário — falar primeiro "para a pessoa não esperar". Mas é
entre os dois momentos que mora a concorrência: se outra mensagem já moveu a
conversa, a trava otimista recusa a gravação. Falando antes, as mensagens **já
teriam saído**, e a recusa chegaria tarde — o associado receberia a pergunta de
um nó que ele já passou.

Gravando antes, a recusa acontece com ninguém tendo ouvido nada. O preço é o
inverso: uma falha de ENVIO depois da gravação deixa o estado adiantado. Esse
caso é **visível** (a mensagem fica `failed` em `whatsapp_messages`), enquanto o
outro seria invisível.

### Concorrência

`flow_runs.lock_version`. Toda escrita exige o número que foi lido e o
incrementa. Duas mensagens simultâneas leem `3`; a primeira grava `4`, e a
segunda — que ainda pede `3` — não encontra linha e recebe `false`. Quem chamou
relê; nada foi enviado.

A numeração dos passos (`seq`) é serializada por um `for update` na linha da
execução, dentro de `flow_claim_step`. São coisas diferentes: o bloqueio protege
o **número**, a trava protege o **estado**.

### Tentativas e fallback

Uma pergunta tem `maxAttempts` (padrão 3), um aviso de resposta inválida e um
desfecho: **encerrar** ou **transferir para um time**. Antes disso, a pergunta se
repetia para sempre — quem não entendesse o menu ficava recebendo a mesma frase
indefinidamente, e ninguém da APCS ficava sabendo.

Duas coisas que o escopo cita e **não** foram implementadas, com o motivo:

- **"repetir" como desfecho** — repetir é o que acontece ATÉ as tentativas
  acabarem. Oferecê-lo também como desfecho criaria a única configuração capaz
  de prender alguém num laço para sempre.
- **"voltar ao nó anterior"** — "anterior" é uma posição na TRAVESSIA, não no
  desenho, e duas conversas chegam à mesma pergunta por caminhos diferentes.
  Quem quer isso desenha a seta de volta, que aparece no canvas.

### Ações e seus desfechos

Uma ação devolve `success`, `not_found`, `failure` ou `retry`, e o motor grava
`<acao>_status` no contexto. É o que permite dar caminhos diferentes a "não
encontrei normativa sobre isso" e "o serviço está fora do ar" — com um booleano,
o associado ouviria "ocorreu um erro" para uma busca que apenas não teve
resultado.

**Só `retry` é repetido.** Uma consulta que respondeu "não achei" respondeu;
repeti-la daria a mesma resposta três vezes mais devagar. Quem pede nova
tentativa é o handler, não o motor adivinhando a partir de um erro genérico.

### Tempo

Política **por fluxo** (`timeout_minutes`, `timeout_action`, `timeout_team_id`),
e ela mora no fluxo e não na versão de propósito: mudar o prazo de 24h para 12h
não deveria exigir publicar uma versão nova, nem deixar as conversas em
andamento com o prazo antigo.

A varredura é `/api/jobs/flows` (cron de hora em hora). Ela só **lê** as
candidatas; quem age é o motor, pelas portas normais — um segundo caminho de
escrita divergiria do primeiro na primeira manutenção.

`remind` envia **um** lembrete e, na janela seguinte, encerra. Lembrete é a única
ação que não muda o estado: sem esse limite, quem nunca mais respondesse
receberia a mesma mensagem a cada 24 horas para sempre.

### Interrupção humana

`flow_runs.automation_paused_until` — e é ELE que o motor consulta, não o
`conversation_status`. O status descreve o atendimento e serve à fila; a pausa
descreve o robô. Amarrar um ao outro faria toda mudança de rótulo na fila mexer,
sem querer, em quem pode falar com o associado.

A pausa é por MINUTOS e expira sozinha, então "voltar ao robô" é o caso normal
em vez de uma intervenção que alguém precisa lembrar de fazer.

### A trilha: passo ≠ evento

|                   | Responde                           | Granularidade                |
| ----------------- | ---------------------------------- | ---------------------------- |
| `flow_run_steps`  | o que o motor FEZ com uma mensagem | um por chave de idempotência |
| `flow_run_events` | o que ACONTECEU dentro do passo    | vários por passo             |

Uma tabela só obrigaria a escolher entre perder a granularidade (duração por nó)
e perder a chave de idempotência (uma linha por mensagem). São perguntas
diferentes.

**Nenhuma das duas guarda o texto do associado.** Ele vive em
`whatsapp_messages`, com a retenção de lá; duplicá-lo criaria uma segunda cópia
de dado pessoal numa tabela que ninguém lembraria de expurgar.

---

## 14. A integração com os canais e os módulos

O motor deixou de ser um componente isolado. Esta seção é o Prompt 4.

### A fila do webhook

Uma mensagem que chega no WhatsApp passa por quatro consumidores, **nesta
ordem**, e cada um tira eventos do seguinte:

```
livro-razão   grava TUDO, sempre, antes de qualquer decisão
     ↓
opt-out       quem pediu para sair não recebe mais nada
     ↓
enquetes      um "3" dentro de uma enquete é voto, não pergunta
     ↓
FLUXOS        continua a triagem de onde ela parou
     ↓
robô          o resto, um turno de cada vez
```

**Os fluxos entraram antes do robô de um turno**, e o motivo é o §6: uma conversa
parada numa pergunta ("é sobre pagamento, cobrança ou outro assunto?") precisa
continuar de onde parou. O robô de um turno trataria "cobrança" como pergunta
nova e abandonaria a triagem no meio — com as variáveis coletadas, sem nada
falhar, e a pessoa recomeçando do zero sem entender por quê.

> **Sem fluxo publicado, nada muda.** `processFlowMessages` não marca nada como
> tratado quando não há fluxo de entrada ativo para o canal, e a mensagem segue
> para o robô exatamente como seguia antes. Ligar o Flow Engine é uma decisão
> tomada na tela de Fluxos, e não um deploy. É o teste mais importante de
> `flow-inbox.test.ts`.

O consumidor compartilha com o robô as três barreiras que já existiam: a chave
geral (`chatbot.enabled`), `whatsapp_bot_should_answer` (grupo, silêncio,
atendimento humano) e o limite de uso. **Uma chave geral só**: no dia em que o
atendimento disser algo errado, quem for desligá-lo às pressas procura um
interruptor, não dois.

### A IA: ela interpreta, o desenho decide

A regra do §13 é que a IA **não** escolhe o próximo nó. Aqui isso é uma
propriedade da arquitetura, e não uma promessa:

```
runtime.ts    lê a frase → grava a leitura como VARIÁVEL
     ↓
flow.engine   escolhe a seta pelas condições que alguém desenhou
```

O motor não importa nada de IA. O que ele vê são quatro variáveis comuns:

| Variável                | O que é                                      |
| ----------------------- | -------------------------------------------- |
| `sys_intent`            | `consultar_bolsa`, `desconhecido`…           |
| `sys_intent_band`       | `high` / `medium` / `low`                    |
| `sys_intent_confidence` | `"0.95"` — ponto decimal, para os operadores |
| `sys_intent_subject`    | o termo que a pessoa usou                    |

O desenhador liga transições de condição nelas. `band = high` segue direto;
`band = medium` vai para um nó de confirmação (§15); `sys_ia_indisponivel` vai
para o menu numerado, que funciona sem modelo.

**A leitura vale por um turno.** `withoutFlowIntent` apaga as quatro no começo de
cada turno — sem isso, um `band = high` de três turnos atrás casava com uma seta
de intenção hoje, e quem digitasse "3" para falar com um atendente recebia a
Bolsa. Esse defeito existiu e foi encontrado por um teste; a história está em
`flow.intent.ts`.

**Menu e texto livre convivem** (§16). A alternativa é lida **primeiro**, por
igualdade exata: quem digita "2" sai por ela sem que o modelo seja consultado.
A IA só entra quando o casamento literal falha **e** a pergunta está marcada com
"Entender o que ela quis dizer" (`interpretIntent`, desmarcado por padrão). Um
fluxo de menu puro nunca paga uma chamada de modelo.

As duas barras de confiança são configuráveis em **Configurações → Chatbot**
(`flow.intent_confidence_high` = 0,90 e `flow.intent_confidence_medium` = 0,70).
São mais altas que as do robô de um turno (0,75) porque o fluxo consegue
_perguntar_ quando duvida — o custo de duvidar cai de "perdi o atendimento" para
"gastei um turno".

### As ações: delegação, nunca consulta

Nenhum handler em `src/lib/flow/action-handlers.ts` fala com o banco. Todos
src/lib/services/flow-monitoring.ts indicadores, erros, fila de SLA e saude (§28 a §35, §54)
chamam uma ferramenta que já existe (`lib/intelligence/tools.ts`), que chama uma
porta de chatbot que já existe (`*-chatbot.ts`) — que é onde mora a regra de
"ativo + disponível para o chatbot + vigente".

Não existe um `.eq("status", "active")` para alguém esquecer de escrever, porque
não existe consulta nenhuma. É o §18 e o §21 ("nunca retornar versão antiga")
sendo uma propriedade do código em vez de uma disciplina.

| Ação                     | Delega para                   | Produz                                              |
| ------------------------ | ----------------------------- | --------------------------------------------------- |
| `consultar_bolsa`        | `getActiveBolsa`              | `bolsa_titulo`, `bolsa_imagem_url`, `bolsa_pdf_url` |
| `consultar_normativa`    | `getActiveNormativa`          | `normativa_titulo`, `normativa_url`                 |
| `consultar_comunicacao`  | `getActiveComunicacao`        | `comunicado_titulo`, `comunicado_url`               |
| `consultar_evento`       | `getActiveEvents`             | `evento_lista`                                      |
| `consultar_conhecimento` | `getKnowledge`                | `conhecimento_resposta`                             |
| `consultar_palestra`     | `getLectureRequestByProtocol` | `palestra_situacao`, `palestra_tema`…               |

**A Bolsa devolve imagem e PDF separados** (§19). Quem decide o que mandar, e em
que ordem, é o desenho: um nó de mensagem com `{{bolsa_imagem_url}}` e outro com
`{{bolsa_pdf_url}}`. Os campos de anexo do nó de mensagem passaram a ser
interpolados justamente para isso — sem isso, o Builder só aceitaria um endereço
fixo, apontando para um boletim que vence na semana seguinte.

**Quatro ações continuam sem handler, de propósito**: `solicitar_palestra`
(precisa de cinco campos que o registro ainda não declara), `participar_enquete`
(precisa de um `surveyId` que o fluxo não tem de onde tirar — quem trata voto é
`survey-inbox.ts`, antes na fila), `registrar_lead` e `criar_ticket` (não há
porta de escrita para delegar). A publicação **recusa** fluxos que dependam
delas, com uma frase dizendo qual falta: o desenhador descobre no botão de
publicar, e não o associado no meio do atendimento.

### Horário de atendimento (§34)

`flow.business_hours` aceita uma linha como `seg-sex 08:00-18:00` ou
`seg-qui 08:00-18:00, sex 08:00-12:00`. Ela produz a variável
`sys_horario_atendimento` (`"sim"` / `"nao"`), e **nada mais**: o que acontece
fora do expediente é uma seta que alguém desenhou. Vazio significa atender
sempre — dizer "voltamos amanhã" com o time inteiro à mesa manda a pessoa embora
sem ninguém ficar sabendo.

O valor é recalculado a cada turno: uma conversa que começa às 17h58 e chega ao
nó de transferência às 18h02 transfere como fora do expediente.

### O log da IA (§44)

`flow.intent_resolved`, `flow.intent_failed` e `flow.intent_skipped` — os três
separados porque pedem coisas diferentes de quem lê (o terceiro é "a APCS não
ligou a IA", que não é falha de ninguém).

**A mensagem da pessoa não entra no log.** Ela já está em `whatsapp_messages`,
que tem RLS, dono e prazo; repeti-la no log de aplicação a moveria para um lugar
sem nada disso. O `correlationId` costura os dois registros.

---

## 15. Operação: homologar, publicar, monitorar

O Prompt 5 fecha o módulo para uso real. As peças, e a decisão por trás de cada uma.

### As duas travas de laço, e por que são duas

| Constante                    | Valor | Pega o quê                                                                                                          |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| `LIMITE_DE_SALTOS`           | 20    | o laço **fechado**: `MENU → CONDIÇÃO → MENU` sem parar. Trava o webhook em segundos e aparece na primeira conversa. |
| `LIMITE_DE_NOS_POR_CONVERSA` | 200   | o laço **lento**: `PERGUNTA A → PERGUNTA B → PERGUNTA A`, uma mensagem por turno.                                   |

O segundo era o buraco: cada turno do laço lento gasta dois saltos, muito abaixo
de vinte, e o contador zerava na volta seguinte. A conversa circulava **para
sempre** — e nada falhava, porque cada turno era válido. A pessoa recebia as
mesmas duas perguntas até desistir.

Por isso o contador vive na execução (`flow_runs.node_executions`) e atravessa os
turnos. A recusa é `loop_detected`, distinta de `hop_limit`: um manda procurar
uma seta, o outro manda procurar um caminho sem saída.

> O CHECK do banco é 2000, dez vezes a constante. Quem recusa é a aplicação, com
> um motivo legível; o banco é a rede embaixo — e ajustar o número no código não
> pode virar erro de constraint.

### O simulador (§11 a §16)

Ele roda `advanceFlow`, `readFlowIntent`, `withFlowIntent` e `resolveTransition`
— **as mesmas funções da produção**. Um simulador que reimplementasse qualquer
uma concordaria com o desenho e discordaria do WhatsApp.

O §12 (não tocar em nada real) não é disciplina: é o fato de
`flow-simulator.tsx` ser um componente de **cliente** que importa apenas módulos
puros de `src/modules/`. Não há cliente de banco, `server-only` nem server
action — não existe caminho dali para o mundo real.

Três coisas que ele ganhou e mudam o valor do teste:

- **desfecho da ação escolhível** — antes era sempre `success`, o que escondia
  metade do desenho. Quem homologava nunca via o caminho de "não encontrei".
- **simular IA** — a leitura passa pelas barras configuradas de verdade.
- **painel de depuração** — etapa anterior, ligação seguida, variáveis. É o que
  responde _por que_ o fluxo foi para onde foi.

### Homologação (§21, §22)

O checklist tem onze itens e grava quem marcou e quando. **Ele não bloqueia a
publicação**, e a decisão está escrita em `flow.checklist.ts`: os itens são
afirmações de uma pessoa, não verificáveis pelo sistema. Uma trava sobre elas não
impede publicar sem revisar — impede publicar sem _clicar_, e a distância entre
as duas coisas é onde nasce o hábito de marcar tudo antes de ler.

Reprovar (`pending_approval → draft`) **exige motivo**, e a exigência é do banco
(`FL009`). Sair de `testing` ou de `approved` para rascunho não pede nada: é quem
desenhou decidindo mexer.

### Monitoramento (§28 a §35)

Três funções `stable`, somente leitura, que agregam **no banco**:
`flow_metrics`, `flow_error_totals`, `flow_sla_queue`. Contar no cliente exigiria
trazer todas as execuções do período para a memória do servidor — e a tela cairia
justamente quando alguém a abrisse para investigar.

A saúde de um fluxo (§54) é **derivada na leitura**, e não guardada numa coluna.
Uma coluna precisaria de alguém para mantê-la, e o dia em que esse alguém
falhasse a tela mostraria verde sobre um fluxo quebrado — confiança sem
fundamento. Calculando na hora, o pior caso é a tela demorar um pouco mais.

`idle` (sem movimento) é separado de `healthy` de propósito: um fluxo publicado
que ninguém acionou pode estar perfeito ou pode estar inalcançável, e é a segunda
hipótese que precisa ser notada.

### SLA (§35, §36)

| Coluna                        | Quem escreve                                           |
| ----------------------------- | ------------------------------------------------------ |
| `flow_runs.assigned_at`       | `flow_commit_step`, quando o status vira `handed_off`  |
| `flow_runs.first_response_at` | **gatilho** em `whatsapp_messages`, `origin = 'agent'` |
| `flow_runs.resolved_at`       | `flow_resolve_run`                                     |
| `flow_runs.sla_minutes`       | congelado do time no momento da transferência          |

**O gatilho é a decisão que importa.** "Quando um atendente respondeu" precisa
valer para todo caminho que produz resposta humana — a caixa de entrada hoje, uma
tela nova amanhã, um disparo pela API. Uma chamada em código valeria só para os
caminhos que alguém lembrou de instrumentar, e a métrica ficaria otimista,
contando como "sem resposta" conversas que foram respondidas por uma porta não
instrumentada.

`origin = 'agent'` é a definição inteira: `direction = 'outbound'` incluiria o
robô, e o robô respondendo zeraria o SLA no instante seguinte à transferência —
que é quando a mensagem "vou te encaminhar" sai.

### Comparação de versões (§39)

`diffFlowGraphs` compara por **chave estável**, nunca por id. `create_flow_version`
copia o desenho com ids novos (§3), então um diff por id diria "12 removidos, 12
adicionados" em toda comparação — literalmente verdade e completamente inútil.

Renomear uma chave aparece como remoção + inclusão, e está certo: para as
transições que apontavam para ela, uma chave nova É um nó novo.

---

## 16. Pendências

Resolvidas no Prompt 5 e removidas desta lista: simulador completo, contexto de
intenção persistido (`flow_runs.intent`), SLA medido, monitoramento.

- **Enviar teste para o Time Interno APCS** (§17 a §19) — **não implementado, e
  a razão é de produto.** "Time Interno APCS" não existe como público no
  sistema: não há segmento, time nem lista de contatos autorizados com esse
  papel. Construir o envio exigiria inventar essa entidade — e o §19 é
  justamente sobre não deixar um teste virar comunicação oficial por engano.

  O que existe hoje cobre o teste sem risco: o simulador percorre todos os
  caminhos, inclusive os de erro e os da IA, sem mandar nada. O que falta é
  provar entrega, anexo e formatação no aparelho — e isso hoje se faz com um
  fluxo publicado num canal de teste.

  Para implementar: um público "interno" (segmento ou lista de contatos),
  `TEST_MESSAGE` como origem em `whatsapp_messages`, e a confirmação forte do
  §19 quando o destino não for esse público.

- **Retenção configurável** (§43) — `flow_run_steps`, `flow_run_events` e os
  logs de IA crescem sem expurgo. As políticas de retenção da plataforma valem,
  mas não há configuração por módulo nem rotina de limpeza.
- **Health check de infraestrutura** (§53) — a saúde por FLUXO existe (§54, na
  tela de monitoramento). Um endpoint que responda pelo WhatsApp, pela IA e pelo
  banco não existe; `getWhatsAppHealth` cobre parte disso na tela de
  Configurações.
- **Alertas** (§34) — a estrutura está pronta (`readFlowHealth` devolve
  `warning`/`error` com motivo), e nada dispara notificação. Ligar exigiria
  decidir para quem, por qual canal e com que frequência.
- **Tela da política de tempo** — as colunas existem e nenhuma tela as edita.
  Hoje se configura por SQL.
- **Tela do SLA por time** — `attendance_teams.sla_minutes` e `business_hours`
  existem e têm grant de coluna; a tela de times ainda não os edita.
- **Estratégia de distribuição** — o modelo suporta (`assigned_team_id` é
  separado de `assigned_user_id`), e nenhuma está implementada: a conversa entra
  na fila do time e alguém a assume.
- **Tela de times com edição de membros** — as actions existem
  (`setAttendanceTeamMembersAction`); a lista de `/flows` mostra os times em
  leitura.
- **Editar os dados do fluxo pela tela** — `updateFlowAction` existe e nenhuma
  tela a chama ainda. Nome, descrição e canal são definidos na criação.
- **Tela do contexto para o atendente** (§30) — os dados existem (variáveis,
  `flow_run_events`, `flow_run_steps`, `flow_runs.intent`); falta a tela que os
  mostra junto da conversa na caixa de entrada. `handoffSummary` já monta as
  linhas.
- **A Cloud API não tem o robô nem os fluxos** — `/api/webhooks/whatsapp` só
  chama as enquetes. A fila de consumidores mora na rota da Z-API, que é o
  fornecedor em uso. Não é decisão nova: já era assim.
- **`vercel.json` não agenda nada** — nem `/api/jobs/flows` (varredura de tempo)
  nem `/api/jobs/surveys` têm entrada em `crons`. As rotas existem e estão
  autenticadas; ninguém as chama. **É a pendência mais próxima de um defeito:**
  sem o cron, o timeout do §27 nunca roda e conversas abandonadas ficam abertas
  para sempre.
- **Opt-in por fluxo** (§38) — o opt-out já tem precedência na fila. Registrar
  um consentimento novo A PARTIR de um fluxo ainda não tem caminho.
- **Resumo por IA** — se um dia existir, entra como campo A MAIS embaixo das
  variáveis coletadas, nunca no lugar delas.

---

## 17. Arquivos

```
supabase/migrations/20260917000000_flow_enums.sql    os sete tipos + 15 verbos de auditoria
supabase/migrations/20260917000100_flows.sql         8 tabelas, 12 funções, 11 gatilhos, RLS
supabase/migrations/20260918000000_flow_builder.sql  validação dos tipos de pergunta + auditoria sem ruído
supabase/migrations/20260918000100_flow_audit_row_type.sql  o atalho do arrastar, com os dois `if`
supabase/migrations/20260919000000_flow_engine.sql   o motor: trilha, eventos, trava, tempo, 5 funções

DECISÃO (puro, sem I/O)
src/modules/flow/flow.types.ts                       o domínio, o estado e os efeitos
src/modules/flow/flow.schema.ts                      Zod — a união discriminada por tipo de nó
src/modules/flow/flow.rules.ts                       ciclo de vida + espelho da validação
src/modules/flow/flow.engine.ts                      a travessia e as três portas de entrada
src/modules/flow/flow.executors.ts                   um executor por tipo de nó (§6)
src/modules/flow/flow.transitions.ts                 a escolha da seta — a única decisão de rumo
src/modules/flow/flow.operators.ts                   os doze operadores (§14)
src/modules/flow/flow.node-config.ts                 a leitura defensiva do retrato congelado
src/modules/flow/flow.checklist.ts                    o checklist de homologacao (§21) — NAO e trava
src/modules/flow/flow.diff.ts                        a comparacao entre versoes, por CHAVE (§39)
src/modules/flow/flow.intent.ts                      a leitura da IA vira VARIÁVEL, nunca caminho (§13)
src/modules/flow/flow.hours.ts                       o expediente, lido de uma linha de texto (§34)
src/modules/flow/flow.builder.ts                     as decisões do Builder que não dependem de React
src/modules/flow/flow.actions.registry.ts            o registro de ações
src/modules/flow/flow.labels.ts                      os textos PT-BR

EXECUÇÃO (I/O, service_role)
src/lib/flow/runtime.ts                              a coreografia (§42)
src/lib/flow/store.ts                                a persistência, sempre por função do banco
src/lib/flow/actions.ts                              o handler de negócio, com retry (§25)
src/lib/flow/deliver.ts                              efeito → mensagem de WhatsApp (§7)
src/lib/flow/timeout.ts                              a varredura de tempo (§27)
src/lib/flow/intent.ts                               chama a IA e lê os limites configurados (§14, §44)
src/lib/flow/action-handlers.ts                      delega às ferramentas do robô (§17 a §27)
src/app/api/jobs/flows/route.ts                      o cron que a aciona

src/lib/services/flow-inbox.ts                       o lugar do fluxo na fila do webhook (§4, §6)
src/app/api/webhooks/zapi/[secret]/route.ts          a fila de quatro consumidores
src/lib/services/flows.ts                            leitura (telas)
src/lib/actions/flows.ts                             escrita (telas)

src/app/(app)/flows/page.tsx                         a lista + os times
src/app/(app)/flows/new/                             o cadastro de um fluxo
src/app/(app)/flows/[id]/page.tsx                    o servidor do Builder
src/app/(app)/flows/[id]/flow-builder.tsx            as quatro áreas, auto save, ciclo de vida
src/app/(app)/flows/[id]/builder-node.tsx            a caixinha do canvas
src/app/(app)/flows/[id]/node-inspector.tsx          o painel de propriedades
src/app/(app)/flows/[id]/flow-simulator.tsx          "Testar fluxo"
src/app/(app)/flows/[id]/flow-homologation.tsx      checklist, reprovacao, resumo de publicacao, historico
src/app/(app)/flows/monitoring/page.tsx             indicadores, funil, fila de SLA e erros (§28 a §34)

TESTES
src/modules/flow/flow.engine.test.ts                 as regras isoladas do motor
src/modules/flow/flow.engine.integration.test.ts     o caminho inteiro (§39, §40) e as tentativas
src/modules/flow/flow.engine.intent.test.ts          menu + texto livre, e a IA que não escolhe nó
src/modules/flow/flow.intent.test.ts                 as faixas configuráveis e o prefixo do motor
src/modules/flow/flow.hours.test.ts                  o expediente, e o erro de digitação que não derruba
src/modules/flow/flow.operators.test.ts              os doze operadores, e o que NÃO casa
src/lib/flow/action-handlers.test.ts                 delegação e os quatro desfechos
src/lib/services/flow-inbox.test.ts                  quem sai do robô, e quem continua nele
src/test/sql-flow-validation.test.ts                 o espelho TypeScript ↔ SQL da validação
src/test/sql-flow-engine.test.ts                     idempotência, concorrência, versão e tempo
src/modules/flow/flow.engine.loop.test.ts           os DOIS tetos de laco, e por que sao dois (§9, §10)
src/modules/flow/flow.checklist.test.ts             o checklist, e o que ele NAO bloqueia
src/modules/flow/flow.diff.test.ts                  a comparacao por chave, e nao por id
```
