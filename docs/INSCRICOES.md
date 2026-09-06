# Landing Pages e Inscrições

Substitui a planilha de Excel em que hoje se controla quem vai a cada evento da
APCS. É um submódulo de [Eventos](./EVENTS.md) — não um módulo novo.

```
EVENTOS
├── Eventos          (já existia)
├── Landing Pages    ← a página pública de inscrição, uma por evento
└── Inscrições       ← quem se inscreveu
```

> **Estado:** Prompts 1 e 2 de 5 implementados — banco, domínio, services,
> actions, **o menu, a listagem, a criação e o Builder com prévia**. A página
> pública é o Prompt 3; a tela de Inscrições é o Prompt 4.

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

| O quê              | Quando      | Observação                                                          |
| ------------------ | ----------- | ------------------------------------------------------------------- |
| ~~Página pública~~ | ✅ Prompt 3 | `/eventos/[slug]` — ver a seção 15                                  |
| ~~Inscrição real~~ | ✅ Prompt 3 | `submitEventRegistrationAction`                                     |
| Tela de Inscrições | Prompt 4    | `listRegistrations` pronto                                          |
| Exportação Excel   | Prompt 4    | `REGISTRATION_LIMIT` é 1000; a exportação vai precisar ler em lotes |

### Pendências declaradas

1. **Não existe arquivo de logo do CSPI.** `public/` tem `logo-apcs.svg` e mais
   nada. O §21 do Prompt 2 pede os dois logos; a prévia identifica o CSPI por
   **assinatura tipográfica** enquanto o arquivo não chega. Desenhar um
   substituto seria inventar a marca de terceiro. Quando o SVG existir, o
   caminho é `CabecalhoInstitucional` em `landing-preview.tsx` — um lugar só.

2. **`events.registration_url` continua sendo um link externo livre.** É a
   decisão arquitetural que o §34 do Prompt 1 manda reportar antes de resolver
   por conta própria — veja a seção 13.

3. **`beforeunload` não intercepta navegação interna.** O Builder avisa ao
   fechar a aba ou recarregar com alterações pendentes, mas clicar num item do
   menu ainda perde o rascunho. É o mesmo limite de `event-form.tsx`: o App
   Router não expõe gancho para bloquear rota, e inventar um interceptador de
   `<Link>` para esta tela seria uma solução paralela ao padrão da plataforma.

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

---

## 14. O backoffice (Prompt 2)

```
Eventos
├── Eventos            /events
├── Landing Pages      /events/landing-pages     ← este prompt
└── Inscrições         (Em breve — Prompt 4)
```

| Tela            | Rota                         | Permissão                                          |
| --------------- | ---------------------------- | -------------------------------------------------- |
| Listagem        | `/events/landing-pages`      | `events.read`                                      |
| Escolher evento | `/events/landing-pages/new`  | `events.write`                                     |
| Builder         | `/events/landing-pages/[id]` | `events.read` para ver, `events.write` para editar |

### O Builder em uma frase

**Todo o estado mora num `useState` só e desce para as duas colunas por props.**
É isso que faz a prévia em tempo real (§19) ser consequência do desenho em vez
de um recurso: digitar redesenha a coluna da direita no mesmo quadro, porque as
duas leem o mesmo objeto.

### ⚠️ A prévia não cria inscrição, e isso é estrutural

O §34 proíbe. A garantia não é uma promessa: `landing-preview.tsx` **não importa
Server Action nenhuma, nenhum cliente Supabase e nenhum módulo `server-only`**.
Os campos são caixas desenhadas (não `<input>`), o botão de confirmar é um
`<div>`, e "adicionar participante" mexe num contador local.

O sinal de que essa garantia se perdeu seria um `vi.mock` de action aparecendo
em `landing-preview.test.tsx`. Hoje não há nenhum.

### Drag & drop com alternativa de teclado (§13, §31)

`draggable` + três manipuladores nativos, **sem biblioteca** — uma dependência
de ~30 kB para reordenar cinco itens não se paga. E ao lado de cada campo, duas
setas que fazem exatamente a mesma coisa, com rótulo que nomeia o campo ("Mover
E-mail para cima").

> "Não fazer o Drag & Drop depender exclusivamente do mouse." As setas são a
> garantia; o arrastar é o atalho por cima dela. Os testes atacam as setas.

### A obrigatoriedade é mostrada, não editada (§14)

Selos, não caixas de seleção. `landing-field-list.test.tsx` cobra que não exista
`checkbox` nem `switch` na lista — porque o §14 é explícito em não deixar o
administrador desconfigurar as regras nesta versão.

### O endereço enquanto se digita

⚠️ **Um defeito que um teste encontrou.** O campo normaliza a cada tecla. Com
`slugPreview` ali, digitar "Encontro Técnico" produzia `encontrotecnico`:

1. `normalizeForSearch` termina com `.trim()` → "Encontro " chegava sem o espaço;
2. `slugPreview` corta hífen das pontas → mesmo criado, ele sumia antes da
   próxima tecla.

A correção separou as duas perguntas: `slugWhileTyping` (sem cortar as pontas)
enquanto se digita, `slugPreview` ao sair do campo e ao salvar. E `foldAccents`
saiu de `normalizeForSearch` para que o `trim` seja decisão de quem chama.

### §25 — não há versionamento, e o Prompt 2 não inventou um

O que protege o histórico é outra coisa: **inscrição gravada é imutável**.
Editar a página muda o que os próximos verão, nunca o que os anteriores
preencheram. O Builder diz isso na tela quando a página está no ar com
inscritos.

A única edição que poderia criar inconsistência — reduzir a capacidade abaixo de
quem já está inscrito — já era recusada pelo banco desde o Prompt 1 (LP004).

---

## 15. A página pública (Prompt 3)

`/eventos/<slug>` — a segunda página do sistema que qualquer um na internet abre
sem estar logado. A outra é `/associe-se`, e **as duas compartilham a casca**:
`PUBLIC_SHELL_CLASS` (fontes por `next/font` + escopo `.apcs-landing`) e os
controles de `@/components/public/fields`. As duas moravam dentro de
`/associe-se`; saíram de lá quando esta página apareceu.

### A rota é pública no middleware

`src/lib/supabase/middleware.ts` lista `/eventos` junto de `/login`, `/auth` e
`/associe-se`. **Não confundir com `/events`**, que é a tela do CRM e continua
protegida — são duas rotas, uma em português e outra em inglês, e é isso que
permite que a mesma informação tenha duas portas com regras opostas.

### A leitura anônima é uma FUNÇÃO, não uma policy

`get_public_event_landing_page(slug)` é `security definer`, devolve um jsonb com
os campos da página e mais nada, e só o `service_role` executa.

A alternativa — liberar `select` para o papel anônimo — abriria o PostgREST:
qualquer um com a chave anônima (que é pública por definição, está no bundle do
navegador) poderia listar todas as páginas publicadas, escolher colunas e seguir
os embeds até `events`. É o mesmo desenho de `submit_membership_application`.

**O que a função NÃO devolve** é tão importante quanto o que devolve: nada de
`event_id`, de autores, de `registration_url`, de segmentação, de trilha, e nada
de `event_registrations`/`event_participants`. Há um teste que falha se alguma
dessas tabelas aparecer no corpo dela.

### O navegador nunca recebe o id da página

O formulário manda o **slug** — que já está na barra de endereços — e o servidor
deriva a página (`resolvePublicLandingPageId`). Sem id no cliente, não há id
para forjar: um POST forjado não consegue apontar para a página de outro evento.

⚠️ **A revisão do §45 encontrou isto quebrado.** `landingPageId` estava em
`PublicLandingPage`, e esse objeto desce inteiro como prop de um Client
Component — ou seja, ia no payload do RSC, enquanto o comentário do schema
afirmava que não ia. A correção foi tirar o campo do tipo, e não vigiá-lo.
Pelo mesmo motivo a página monta a prop do formulário **campo a campo**, e não
com um spread.

### Os oito estados do §41

Seis são do formulário (`PublicRegistrationState`): `ready`, `submitting`,
`success`, `error`, `closed`, `soldOut`. Os outros dois são do framework —
`LOADING` é o carregamento do Server Component e `NOT_FOUND` é `notFound()`,
que troca a árvore inteira por `eventos/not-found.tsx`.

**`closed` e `soldOut` chegam do SERVIDOR** (`landingEffectiveStatus` roda na
página, com o relógio do servidor), e a tela também pode CAIR neles depois: se o
banco recusar o envio com RG002 ou RG001 — porque outra granja levou as últimas
vagas entre o carregamento e o clique —, o formulário some e o aviso aparece.
Mostrar o erro e devolver o formulário convidaria a pessoa a tentar de novo um
envio que vai ser recusado de novo.

### Rascunho, inativa e slug inexistente respondem a mesma coisa

`getPublicLandingPage` devolve `null` para os três, e a página responde 404 sem
distingui-los. Diferenciar "não existe" de "existe mas está oculta" confirmaria
a existência de um evento que ainda está sendo preparado, para quem estivesse
tentando endereços.

### LGPD: o mecanismo é o que já existia (§35)

`consent_texts` — a mesma tabela append-only que a landing de associação usa,
legível pelo papel anônimo de propósito. O que faltava era **onde guardar a
versão que a pessoa leu**, e é a coluna nova
`event_registrations.consent_policy_version`.

⚠️ **A versão viaja com o envio, e não é relida no servidor.** Se alguém
publicar um texto novo enquanto a granja preenche o formulário, a inscrição tem
de guardar a versão que estava NA TELA — buscar a vigente no instante da
gravação registraria uma autorização para um texto que ninguém leu. Um
`current_consent_text()` dentro de `create_event_registration` seria exatamente
esse defeito, e ele é invisível: a coluna fica preenchida, só que errada.

O aceite é exigido **só pela porta pública**. No backoffice quem digita é a
APCS, a partir de uma lista de papel — não é o titular do dado, e não tem como
aceitar nada em nome dele.

### Limite de taxa (§34)

`event_registration_ip_hourly_limit()` = 20 envios por hash de IP por hora, só
para a origem `landing_page`. É a mesma forma de `membership_ip_hourly_limit`
(que é 8): uma pessoa se associa uma vez na vida, mas uma granja inscreve gente
em vários eventos, e um escritório de cooperativa pode inscrever várias granjas
do mesmo IP na mesma tarde.

⚠️ **O limite roda DEPOIS da conferência de idempotência**, e a ordem é o que
faz ele não punir quem é legítimo: um F5, um duplo clique ou um retry chegam com
o mesmo `dedupe_key` e recebem a inscrição que já existe, sem consumir cota. Uma
conexão ruim — que é justamente quem mais reenvia — seria a primeira a ser
bloqueada pela ordem inversa.

### §17 — telefone internacional

`formatPhoneInput` usa a máscara existente (`formatWhatsapp`) até 11 dígitos e
sai da frente acima disso. Sem essa segunda metade, um número de 12 dígitos
seria cortado em silêncio e o formulário recusaria um telefone digitado certo —
`phoneSchema` aceita de 10 a 15, o teto do E.164.

`onlyDigits` e `formatWhatsapp` moram agora em `@/lib/format/phone`;
`membership.schema.ts` e `event.landing.schema.ts` reexportam. Eram duas cópias.

### O que o Prompt 3 mexeu no backoffice

Uma coisa só: a **prévia do Builder ganhou o bloco de consentimento**. A revisão
do §45.11 ("o Preview representa corretamente a página real?") respondia NÃO — a
página pública passou a exigir o aceite de LGPD e a prévia mostrava um
formulário sem ele. O administrador conferiria a composição, aprovaria e
publicaria uma página com um campo obrigatório a mais do que viu. É o modo de
falhar mais traiçoeiro de uma prévia: ela não quebra, ela mente.

### Pendências para o Prompt 4

1. **O logo do CSPI continua não existindo.** Agora são DOIS lugares para trocar
   quando o SVG chegar: `CabecalhoInstitucional` em `landing-preview.tsx`
   (backoffice) e o de `eventos/[slug]/landing-chrome.tsx` (público). O
   comentário está nos dois.

2. **`events.registration_url` continua em aberto** — seção 13. Agora é mais
   concreto: o endereço público existe de verdade, e alguém vai colar um link
   externo num evento que já tem página de inscrição.

3. **A situação do EVENTO não é conferida na leitura pública.** Se alguém
   desativar o evento sem encerrar a Landing Page, a página continua no ar.
   Filtrar por `events.status` na leitura criaria uma regra que a GRAVAÇÃO não
   tem (`create_event_registration` também não olha o evento), e telas e banco
   discordando é o que este módulo evita desde o Prompt 1. A correção honesta é
   decidir isso nas duas pontas ao mesmo tempo — e é decisão de produto, não de
   código.

4. **Sem analytics (§38).** A plataforma não tem mecanismo de analytics, e o §38
   é explícito em não introduzir ferramenta nova só por isso. O que existe no
   lugar é a trilha (`event_registration_audit_logs`), que já registra origem,
   data/hora e a landing de cada inscrição — o suficiente para responder "quantas
   inscrições vieram da página pública" sem nenhuma dependência externa.

5. **`og:image` não é emitido.** A imagem vive em bucket privado e o que temos é
   URL assinada de uma hora. Um `og:image` que morre em sessenta minutos é pior
   que nenhum: o WhatsApp guarda a prévia em cache e passaria a mostrar um
   retângulo quebrado. Resolver isso é decidir se a arte da landing pode ser
   pública — decisão de produto.
