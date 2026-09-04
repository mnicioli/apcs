# Fluxos de Atendimento

**Inteligência → Fluxos de Atendimento** — o desenho do caminho que uma conversa
percorre antes de chegar a uma pessoa.

Hoje esse caminho está em código (`intent.registry.ts`, `router.ts`,
`engine.ts`): mudar a triagem exige um programador, um deploy e um
`pnpm db:types`. Este módulo tira essa decisão do código e a coloca numa tela.

> **Estado: fundação + Builder visual (Prompts 1 e 2 de 5).** O banco, o
> domínio, o motor, as validações, as permissões, a auditoria, as actions e a
> tela de desenho estão prontos. Falta ligar as ações de negócio e o WhatsApp.
> Ver [Pendências](#13-pendências).

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

## 13. Pendências

- **Handlers das ações** (Prompt 3) — `FLOW_ACTION_HANDLERS` está vazio de
  propósito. Ligar a Bolsa é uma entrada apontando para
  `src/lib/services/market-chatbot.ts`.
- **Ligação com o WhatsApp** (Prompt 4) — quem executa os `FlowEffect`, escreve
  `flow_runs` / `flow_run_steps` com `service_role` e usa a chave de
  idempotência. O `delaySeconds` e o `slaMinutes` são carregados hoje e não
  cobrados por ninguém: quem os honra é essa camada.
- **Simulador completo** (Prompt 5).
- **Tela de times com edição de membros** — as actions existem
  (`setAttendanceTeamMembersAction`); a lista de `/flows` mostra os times em
  leitura.
- **Editar os dados do fluxo pela tela** — `updateFlowAction` existe e nenhuma
  tela a chama ainda. Nome, descrição e canal são definidos na criação.
- **Duplicar fluxo** — `duplicateFlowAction` existe sem botão. Duplicar ETAPA
  está no painel de propriedades.
- **Resumo por IA** (§16) — se um dia existir, entra como campo A MAIS embaixo
  das variáveis coletadas, nunca no lugar delas.

---

## 14. Arquivos

```
supabase/migrations/20260917000000_flow_enums.sql    os sete tipos + 15 verbos de auditoria
supabase/migrations/20260917000100_flows.sql         8 tabelas, 12 funções, 11 gatilhos, RLS
supabase/migrations/20260918000000_flow_builder.sql  validação dos tipos de pergunta + auditoria sem ruído

src/modules/flow/flow.types.ts                       o domínio
src/modules/flow/flow.schema.ts                      Zod — a união discriminada por tipo de nó
src/modules/flow/flow.rules.ts                       ciclo de vida + espelho da validação
src/modules/flow/flow.engine.ts                      o motor determinístico
src/modules/flow/flow.builder.ts                     as decisões do Builder que não dependem de React
src/modules/flow/flow.actions.registry.ts            o registro de ações (§26)
src/modules/flow/flow.labels.ts                      os textos PT-BR

src/lib/services/flows.ts                            leitura
src/lib/actions/flows.ts                             escrita

src/app/(app)/flows/page.tsx                         a lista + os times
src/app/(app)/flows/new/                             o cadastro de um fluxo
src/app/(app)/flows/[id]/page.tsx                    o servidor do Builder
src/app/(app)/flows/[id]/flow-builder.tsx            as quatro áreas, auto save, ciclo de vida
src/app/(app)/flows/[id]/builder-node.tsx            a caixinha do canvas
src/app/(app)/flows/[id]/node-inspector.tsx          o painel de propriedades
src/app/(app)/flows/[id]/flow-simulator.tsx          "Testar fluxo"

src/test/sql-flow-validation.test.ts                 o espelho TypeScript ↔ SQL
```
