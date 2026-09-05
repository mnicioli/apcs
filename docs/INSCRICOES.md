# Landing Pages e Inscrições

Substitui a planilha de Excel em que hoje se controla quem vai a cada evento da
APCS. É um submódulo de [Eventos](./EVENTS.md) — não um módulo novo.

```
EVENTOS
├── Eventos          (já existia)
├── Landing Pages    ← a página pública de inscrição, uma por evento
└── Inscrições       ← quem se inscreveu
```

> **Estado:** o Prompt 1 de 5 está implementado — banco, domínio, services,
> actions e testes. **Não existe tela ainda.** O Builder é o Prompt 2, a página
> pública é o Prompt 3.

---

## 1. O modelo, em uma frase

**A inscrição é da GRANJA/EMPRESA, não da pessoa.**

```
1 EVENTO
   └── 1 LANDING PAGE
          └── N INSCRIÇÕES            ← uma por granja/empresa
                 └── N PARTICIPANTES  ← as pessoas daquela granja
```

Uma granja com quatro funcionários é **uma** inscrição com quatro participantes,
e não quatro inscrições. É por isso que `company_name` mora em
`event_registrations` e não se repete em participante nenhum.

---

## 2. A decisão que explica o módulo: o encerramento é DERIVADO

É a mesma decisão de Eventos, e pelos mesmos motivos.

```
status (coluna)      = APENAS a decisão humana:  draft | published | closed | inactive
effectiveStatus      = o que vale agora:         + fechada por prazo ou lotação
```

```ts
// src/modules/event/event.landing.rules.ts
export function landingEffectiveStatus(page, now) {
  if (page.status !== "published") return page.status;
  if (isPastDeadline(page, now)) return "closed"; // o relógio decidiu
  if (isFull(page)) return "closed"; //              a lotação decidiu
  return "published";
}
```

**"Encerrada porque o prazo venceu" e "encerrada porque lotou" nunca são
gravados.** Não há cron neste projeto; uma rotina que não roda falha em
silêncio, e o formulário continuaria aceitando inscrição depois do prazo.

### O que isso exige em troca

A regra tem de valer **de verdade na escrita**. `create_event_registration`
recusa fora do prazo e acima da capacidade, **sob lock**, dentro da transação.

> Derivação é para **ler**. A barreira é para **escrever**. Quando as duas
> discordarem, quem manda é o banco: a tela pode oferecer um botão que a
> gravação recusa (chato), nunca o contrário (grave).

### E o motivo importa mais que a situação

`landingStatusReason` devolve cinco motivos para duas situações de tela. É
deliberado: **"encerrada" sozinha manda a pessoa procurar um botão de reabrir**;
"lotou" manda aumentar a capacidade; "o prazo venceu" manda estender o prazo.
Três providências diferentes atrás do mesmo rótulo.

---

## 3. A capacidade

- Contada em **PARTICIPANTES**, não em inscrições (§14 do escopo).
  Capacidade 100 com inscrições de 5, 3 e 10 = 18 pessoas.
- `max_participants` nulo = **sem limite**.
- **Inscrição cancelada devolve as vagas** — a contagem só considera as ativas.
- **A inscrição inteira cabe, ou nenhuma parte dela cabe.** Cinco pessoas com
  três vagas é recusa; aceitar três deixaria a granja sem saber quem ficou de
  fora.

### Como a concorrência é resolvida

```
Capacidade 100, 95 inscritos.
Usuário A envia 5.   Usuário B envia 5.
```

Sem proteção, os dois leem 95, os dois concluem que cabem, e o evento fecha com
105 pessoas. `create_event_registration` toma um **lock consultivo pela landing
page** antes de contar: os dois se enfileiram, o segundo lê 100 e é recusado.

Lock consultivo e não `select ... for update` pelo mesmo motivo de `lock_event`:
em tabela com RLS, `for update` exige privilégio de UPDATE — e quem se inscreve
pela página pública não tem nenhum.

---

## 4. O §12: evento + e-mail é único

> Um mesmo participante não pode ter duas inscrições para o mesmo evento com o
> mesmo e-mail.

São **três barreiras**, e só a última garante:

| Onde                                 | O quê                                | Para quê                           |
| ------------------------------------ | ------------------------------------ | ---------------------------------- |
| Zod (`registrationFormSchema`)       | e-mail repetido dentro da requisição | dizer **qual linha** corrigir      |
| `create_event_registration`          | e-mail já inscrito no evento         | dizer **qual e-mail** é o problema |
| `event_participants_event_email_idx` | índice único                         | **a garantia**                     |

Duas requisições simultâneas com o mesmo e-mail passam as duas pelas checagens;
quem recusa a segunda é o índice, com 23505. `mapPostgresError` traduz essa
constraint específica para "Este e-mail já está inscrito neste evento" em vez do
genérico "Já existe um registro com esses dados".

### Por que `event_participants` carrega `event_id`

Índice único não atravessa join. Para o Postgres impor a regra, as duas colunas
precisam estar na mesma linha. O que impede a cópia de virar mentira é a **FK
composta** `(registration_id, event_id) → event_registrations (id, event_id)`:
gravar um participante com o evento errado é **impossível**, não improvável.

### O e-mail é guardado em minúsculas

Sempre. O índice compara bytes, e "Joao@x.com" com "joao@x.com" entrariam as
duas. Normalizado no Zod, na função Postgres e cobrado pelo CHECK
`event_participants_email_lower`.

### Cancelar não libera o e-mail

Decisão consciente, documentada na migration. Quem cancelou e quer voltar tem a
inscrição **reativada** pelo backoffice — que preserva o histórico (§13) em vez
de criar uma segunda linha para a mesma pessoa no mesmo evento. Um índice
parcial (`where status = 'active'`) seria mais gentil, mas exigiria que o
participante conhecesse a situação da inscrição: uma segunda cópia do mesmo
fato.

---

## 5. Idempotência (§27)

`dedupe_key` é `landingPageId|email-do-primeiro-participante|janela-de-5-min`.

- **Montada no servidor, nunca recebida do cliente.** Aceitá-la de fora deixaria
  qualquer um mandar a chave de outra inscrição e receber os dados dela de volta
  como "duplicada" — que é um vazamento, não uma otimização.
- É o e-mail do primeiro participante, e não a granja: duas inscrições legítimas
  da mesma granja existem (dois grupos, dois momentos); duas com a mesma
  primeira pessoa em cinco minutos são o mesmo envio chegando duas vezes.

### ⚠️ A ordem das checagens não é arbitrária

`create_event_registration` confere a **idempotência antes de tudo**. Um retry
chega com o mesmo `dedupe_key` **depois** de a primeira tentativa ter gravado os
participantes. Se as validações rodassem antes, esse retry morreria em "e-mail
já inscrito neste evento" — acusando a pessoa de duplicidade contra ela mesma e
escondendo que a inscrição dela deu certo.

`src/test/sql-event-landing.test.ts` guarda essa ordem. Trocá-la parece limpeza.

---

## 6. As duas portas, e por que são a mesma função

```
BACKOFFICE (Prompt 2)                  PÁGINA PÚBLICA (Prompt 3)
createRegistrationAction                     server action pública
  → assertPermission("registrations.write")    → sem sessão
  → cliente autenticado                        → cliente service_role
        └──────────────┬────────────────────────────────┘
                       ↓
          create_event_registration   (SECURITY DEFINER)
```

As duas obedecem às mesmas regras porque são a mesma função. O que muda é só
quem chama — e **`origin` é derivado disso dentro do banco, nunca recebido**. Um
parâmetro `p_origin` deixaria a página pública gravar `backoffice` e mentir
sobre a procedência de toda inscrição.

**O administrador não fura o prazo nem a capacidade.** Quem precisa inscrever
alguém depois do prazo estende `closes_at` — um ato explícito, com trilha, em
vez de uma exceção invisível dentro de uma função.

---

## 7. Permissões

| Chave                                        | Papéis                   | O quê                              |
| -------------------------------------------- | ------------------------ | ---------------------------------- |
| `events.read` / `events.write`               | admin, comercial / admin | o evento **e a landing page dele** |
| `registrations.read` / `registrations.write` | admin, comercial / admin | **quem se inscreveu**              |

### Por que duas chaves

A Landing Page é a fachada do evento: mesma tela, mesma pessoa decidindo,
nenhum dado de terceiro. As **inscrições** são outra coisa — nome, e-mail,
telefone e WhatsApp de centenas de pessoas que não são usuárias do sistema e
nunca autorizaram nada além de ir a um evento.

Hoje as duas listas de papéis coincidem. O que a chave separada compra é
**poderem deixar de coincidir sem mexer em Eventos**.

> O §21 do escopo pedia Administrador, **Gestor** e Atendente. O Gestor não
> existe mais — foi aposentado em `20260902000000_retire_roles.sql`. Um "Gestor
> de Inscrições" continua possível sem papel novo: é um **cargo** criado em
> `/permissions` com base `admin` e só as chaves `registrations.*`.

---

## 8. LGPD (§29)

- **A trilha nunca guarda dado pessoal.** `event_registration_audit_logs` grava
  ids, contagens e nomes de campo. O "quem" está em `event_participants`, sob
  RLS, e é de lá que sai quando alguém pede exclusão. Uma cópia na auditoria
  seria a que ninguém lembraria de apagar.
- **Os logs de erro também não.** `createRegistrationAction` registra o id da
  página e quantas pessoas — nunca nome, e-mail ou telefone. Há um teste que
  cobra isso.
- **IP nunca é guardado**, só o hash (`clientIpHashFromHeaders`), e ele serve ao
  limite de taxa do formulário público e a mais nada.
- **`anon` não enxerga nada.** Nenhuma policy menciona `anon`; o acesso é
  revogado explicitamente nas quatro tabelas.

---

## 9. Onde está cada coisa

```
supabase/migrations/
  20260922000000_event_landing_enums.sql        os tipos
  20260922000100_event_landing.sql              tabelas, RLS, funções
  20260922000200_event_landing_empty_fields.sql correção de mensagem

src/modules/event/
  event.landing.types.ts     tipos e listas (enums vêm do banco)
  event.landing.rules.ts     regras puras — a LEITURA das regras
  event.landing.schema.ts    Zod, o mesmo no cliente e na action
  event.landing.labels.ts    PT-BR + a identidade institucional do §19

src/lib/services/event-landing.ts   leitura (server-only, lança)
src/lib/actions/event-landing.ts    escrita (ActionResult, nunca lança)

src/test/sql-event-landing.test.ts  as invariantes lidas do SQL
```

---

## 10. A identidade visual não tem coluna (§19)

O escopo pede que a página pertença ao contexto **APCS + CSPI** e que o usuário
**não** possa trocar logo, cores ou identidade. A forma mais confiável de
garantir isso é **não existir onde guardar**: não há `logo_url`, não há
`primary_color`, não há `theme`.

A identidade é uma constante (`LANDING_INSTITUTIONAL_CONTEXT` em
`event.landing.labels.ts`). O que a Landing Page configura é o **conteúdo**:
imagem do evento, descrição, campos e mensagem de sucesso.

---

## 11. A mensagem de confirmação (§18)

Não há texto embutido em service nem em controller. **Duas fontes, nunca duas
verdades:**

1. o padrão da plataforma, em `app_settings`
   (`events.registration_success_title` / `_message` / `_footer`), editável em
   `/settings/texts`;
2. o texto da própria Landing Page, quando ela define — e ela pode sobrescrever
   **pedaço a pedaço**, não é tudo ou nada.

O padrão só é consultado quando a específica não existe. `<EVENTO>` e `<DATA>`
são substituídos na renderização, e não concatenados no SQL, porque quem edita o
texto precisa poder mover o nome do evento de lugar na frase.

---

## 12. O que NÃO existe ainda

| O quê                 | Quando   | Observação                                                                           |
| --------------------- | -------- | ------------------------------------------------------------------------------------ |
| Builder drag & drop   | Prompt 2 | `form_fields` é jsonb e já guarda a ordem                                            |
| Tela de Landing Pages | Prompt 2 | services e actions prontos                                                           |
| Tela de Inscrições    | Prompt 2 | `listRegistrations` pronto                                                           |
| Página pública        | Prompt 3 | precisa de uma função `security definer` de LEITURA — ela não existe, e é deliberado |
| Exportação Excel      | Prompt 4 | `REGISTRATION_LIMIT` é 1000; a exportação vai precisar ler em lotes                  |

### Pendências declaradas

1. **`set_event_landing_page_image` não tem action.** A função Postgres existe
   (o §4 pede o campo imagem), mas o fluxo de upload — URL assinada, inspeção
   dos bytes, descarte do órfão — mora em `src/lib/actions/events.ts` e
   **precisa ser extraído, não copiado**, quando o Builder o usar. Copiá-lo
   seria a duplicação que o §33 manda procurar.

2. **`events.registration_url` continua sendo um link externo livre.** É a
   decisão arquitetural que o §34 manda reportar antes de resolver por conta
   própria — veja abaixo.

---

## 13. ⚠️ A decisão que ficou em aberto: `registration_url`

`events.registration_url` já existe e **já é usado**: entra na mensagem de
divulgação por WhatsApp (`event-dispatch.ts`) e na resposta do chatbot
(`event.chatbot.ts`). Hoje ele é um endereço externo digitado à mão — um Google
Forms, um Sympla.

Quando uma Landing Page for publicada, esse campo passa a ter **duas respostas
possíveis** para a mesma pergunta ("onde a pessoa se inscreve?"). Há três
caminhos, e nenhum é obviamente certo:

| Caminho                                               | A favor                                                                       | Contra                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Publicar **sobrescreve** `registration_url`           | o WhatsApp e o chatbot passam a apontar para a landing sem ninguém fazer nada | apaga um link que alguém digitou; e "sobrescrever em silêncio" é o oposto do resto deste módulo |
| Derivar na LEITURA (landing publicada ganha do campo) | nada se apaga; uma verdade só, calculada                                      | muda o comportamento de dois módulos que já estão no ar                                         |
| Deixar como está e o Builder **avisar**               | risco zero para o que já funciona                                             | a APCS tem de colar o endereço da landing à mão, e vai esquecer                                 |

**Nada foi feito.** A fundação não depende disso, e escolher por conta própria
mudaria o comportamento de um disparo de WhatsApp que já está em produção.
A decisão é do Prompt 3, quando a página pública existir e o endereço for real.
