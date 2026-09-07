# Landing Pages e Inscrições

Substitui a planilha de Excel em que hoje se controla quem vai a cada evento da
APCS. É um submódulo de [Eventos](./EVENTS.md) — não um módulo novo.

```
EVENTOS
├── Eventos          (já existia)
├── Landing Pages    ← a página pública de inscrição, uma por evento
└── Inscrições       ← quem se inscreveu
```

> **Estado:** os 5 prompts estão implementados e **em produção**. Banco,
> domínio, services, actions, o Builder com prévia, a página pública de
> inscrição, o backoffice com confirmação e a exportação. A seção 18 registra o
> que quebrou depois do go live — inclusive um defeito que atravessou as cinco
> etapas sem aparecer.
>
> ⚠️ **A seção 19 muda o que as seções 10 e 11 descrevem.** A página deixou de
> ter texto solto: a descrição saiu e a mensagem de confirmação virou um
> **banner**. As duas seções abaixo continuam valendo no que dizem sobre a
> identidade institucional e sobre a origem do texto padrão — mas não sobre os
> campos, que já não existem. Leia a 19 antes de mexer nessa parte.

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
~~imagem do evento, descrição, campos e mensagem de sucesso~~ — hoje, **duas
artes** (a da página e a da confirmação), a ordem dos campos, o prazo e a
capacidade. Ver a seção 19.

---

## 11. A mensagem de confirmação (§18)

> ⚠️ **Esta seção descreve o desenho até a seção 19.** A fonte 2 não existe
> mais: a confirmação virou um banner, e a Landing Page não sobrescreve texto
> nenhum. Sobrou a fonte 1 — que continua sendo o que aparece quando não há
> banner, e o que um leitor de tela recebe quando há.

Não há texto embutido em service nem em controller. **Duas fontes, nunca duas
verdades:**

1. o padrão da plataforma, em `app_settings`
   (`events.registration_success_title` / `_message` / `_footer`), editável em
   `/settings/texts`;
2. ~~o texto da própria Landing Page, quando ela define — e ela pode
   sobrescrever **pedaço a pedaço**, não é tudo ou nada.~~ Removido na seção 19.

`<EVENTO>` e `<DATA>` são substituídos na renderização, e não concatenados no
SQL, porque quem edita o texto precisa poder mover o nome do evento de lugar na
frase. `resolveSuccessMessage` continua existindo por isso — e porque são duas
telas (a prévia do Builder e a página pública) que precisam resolver o texto
igual.

---

## 12. O que NÃO existe ainda

| O quê                  | Quando      | Observação                                       |
| ---------------------- | ----------- | ------------------------------------------------ |
| ~~Página pública~~     | ✅ Prompt 3 | `/eventos/[slug]` — ver a seção 15               |
| ~~Inscrição real~~     | ✅ Prompt 3 | `submitEventRegistrationAction`                  |
| ~~Tela de Inscrições~~ | ✅ Prompt 4 | `/events/registrations` — ver a seção 16         |
| ~~Exportação~~         | ✅ Prompt 4 | CSV, como o resto da plataforma — ver a seção 16 |

### Pendências declaradas

1. ~~**Não existe arquivo de logo do CSPI.**~~ **Resolvido depois do Prompt 5.**
   O arquivo chegou (`public/logo-cspi.png`, 924 × 258) e a assinatura
   tipográfica saiu dos dois lugares que a usavam. O desenho agora é
   `CspiMark`, em `src/components/brand/cspi-logo.tsx` — um componente só, lido
   pela página pública e pela prévia, como o `ApcsMark`.

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

1. ~~**O logo do CSPI continua não existindo.**~~ **Resolvido depois do Prompt 5.** Os dois lugares previstos aqui foram exatamente os dois que mudaram, e
   passaram a ler o mesmo `CspiMark` — ver a pendência 1 do Prompt 2.

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

---

## 16. O backoffice de Inscrições (Prompt 4)

Duas telas e uma rota de download, em `Eventos → Inscrições`:

| Rota                                     | O que é                                                   |
| ---------------------------------------- | --------------------------------------------------------- |
| `/events/registrations`                  | Os eventos que têm página de inscrição, com as contagens. |
| `/events/registrations/[eventId]`        | A grid de PARTICIPANTES daquele evento.                   |
| `/events/registrations/[eventId]/export` | O arquivo, com o recorte da tela.                         |

### A unidade muda: a grid é de PESSOAS

`RegistrationRow` (Prompt 1) é a granja com as pessoas dentro. A **grid** é de
pessoas — quem opera está procurando o fulano, decidindo se ele vem, e
exportando uma linha por participante. As duas convivem porque respondem a
perguntas diferentes; o que não pode é a tela derivar uma da outra no navegador.

### Uma função, um `where`, três respostas

`event_registrations_board` devolve **métricas + página + total** num jsonb só.

⚠️ **O motivo é o §6, não desempenho.** "Os indicadores devem respeitar os
filtros ativos." Com uma consulta para a lista e outra para os contadores, o
mesmo `where` existiria em dois lugares — e o dia em que um filtro novo entrasse
só num deles, a tela diria "12 confirmados" sobre uma lista de 5. Ninguém
confere a soma à mão.

Ela é **SECURITY INVOKER** (o padrão), ao contrário de
`get_public_event_landing_page`. Aqui existe usuário logado, e a RLS é a segunda
camada do RBAC; um DEFINER desligaria justamente a proteção que faz sentido
nesta porta. Há teste que falha se alguém a tornar DEFINER.

### A busca atravessa duas tabelas

A granja mora na INSCRIÇÃO, a pessoa mora no PARTICIPANTE. Um `or=` do PostgREST
não cruza a junção — daí a função. Duas colunas geradas `search_text` (o mesmo
`translate()` de `lectures.search_text`, que espelha `normalizeForSearch`), mais
um segundo padrão só de dígitos: quem procura por telefone cola
`(11) 99999-8888` da conversa, e a coluna guarda `11999998888`.

Copiar o nome da granja para dentro do participante deixaria a busca mais
simples e criaria uma cópia que se desatualiza no primeiro "editar
Granja/Empresa" — que é justamente o §13.

### §26 — a cadeia é conferida no banco

`update_event_participant`, `set_participant_confirmation` e
`update_event_registration` passaram a receber `p_event_id` e recusam quando o
alvo pertence a outro evento, com **P0002** — o mesmo código de "não
encontrado".

⚠️ **Isso não é redundante com a RLS.** A RLS responde "esta pessoa pode ver
inscrições?"; ela não responde "este participante é do evento que a tela diz
estar aberto". Um administrador tem acesso a todos os eventos — o que a
checagem impede é a operação ATRAVESSAR o contexto por um id trocado na
requisição. E o erro não distingue "não existe" de "é de outro evento": a
distinção transformaria a função num oráculo de ids.

### §22 e §23 — a confirmação é um compare-and-set

A versão do Prompt 1 fazia `select` → `if igual então retorna` → `update`. Duas
requisições simultâneas passam **as duas** pelo `if` e gravam as duas: resultado
final certo, e **duas linhas de trilha** afirmando que houve mudança — sendo que
a segunda não mudou nada.

Agora a condição está dentro do `update`
(`where ... and confirmation is distinct from ?`). Quem não altera nada não
grava nada, e repetir é sucesso — que é o §23.

### §12 e §25 — o que a trilha guarda

| Ação                   | O que vai para a trilha                             |
| ---------------------- | --------------------------------------------------- |
| Confirmação            | `participantId`, `from`, `to`                       |
| Edição do participante | `participantId` e os **NOMES** dos campos alterados |
| Granja renomeada       | `from` e `to` — nome de empresa não é dado pessoal  |

⚠️ **Os valores dos campos pessoais NÃO entram.** Gravar
`email: joao@x.com para joao@y.com` criaria uma segunda cópia do dado numa
tabela append-only, fora de `event_participants` — que é de onde o dado sai num
pedido de exclusão. A cópia sobreviveria ao pedido e ninguém lembraria dela.

### §18 e §20 — a exportação é CSV

O §20 diz: "se o projeto já possuir convenção própria, seguir a convenção
existente". Ele possui — `surveys/[id]/results/export` — e o comentário de lá
explica: a plataforma **não tem biblioteca de planilha**, e acrescentar uma
(SheetJS pesa centenas de KB e tem histórico de CVE) para gerar um arquivo que o
Excel abre igual seria pagar caro por nada.

O arquivo abre no Excel com dois cliques, uma linha por participante, acentos
corretos e colunas separadas. **O que muda é a extensão:**
`inscricoes_<slug>_<AAAAMMDD>.csv`.

⚠️ **A injeção de fórmula é um risco real neste módulo.** O nome da granja é
digitado por quem se inscreve numa página ABERTA na internet (Prompt 3): alguém
pode cadastrar uma granja chamada `=HYPERLINK(...)` e esperar que a APCS abra a
planilha. O apóstrofo na frente de `=`, `+`, `-` e `@` neutraliza sem perder o
texto.

⚠️ **A permissão é conferida no endpoint**, e é o ponto mais importante da rota.
Ela é uma URL: sem a checagem, a exportação é a porta dos fundos de uma tela
protegida — e o que sai por ela é dado pessoal de centenas de terceiros.

### §19 — o arquivo é o que está na tela

`parseRegistrationFilters` e `eventRegistrationsHref` são inversas, e há teste
que prova. O botão "Exportar" é um **link** montado pela mesma função que monta
a paginação, e a rota lê os mesmos parâmetros. "Exportar somente o resultado
atual" é consequência do desenho, não uma regra a lembrar.

A página atual **não** vai junto: a exportação leva o recorte inteiro. Se ela
herdasse `page=3`, quem clicasse na terceira página baixaria 25 linhas de um
evento com 300 — e o arquivo pareceria completo.

### ⚠️ Um defeito de três horas, encontrado na revisão

O filtro de período recebia `timestamptz` e o serviço montava o valor
concatenando texto. Um literal sem fuso é lido pelo Postgres no fuso do
**servidor** — UTC na Supabase —, então "inscritos a partir de 06/09"
significava 05/09 às 21h em São Paulo.

O sintoma seria quase invisível: uma contagem "quase certa" e uma exportação com
algumas linhas a mais que a tela. A correção
(`20260925000200_event_registration_period.sql`) é a mesma decisão de
`event_today()`: a **data** entra, e o fuso é aplicado no banco. O fim do
período é o dia seguinte, exclusivo — `23:59:59.999` deixaria de fora uma
inscrição gravada no último milissegundo, e esse defeito aparece uma vez a cada
mil anos, o que é pior do que aparecer sempre.

### O que o Prompt 4 mexeu fora do módulo

Uma coisa: a **paginação virou um componente compartilhado**
(`@/components/ui/pagination`). `lecture-pagination.tsx` e
`survey-pagination.tsx` eram o mesmo arquivo, e Inscrições precisava do mesmo —
o §32 proíbe duplicar. As duas passaram a delegar, preservando os nomes que as
páginas delas já importavam; o que sobrou em cada uma é como serializar os
filtros dela.

Também subiu o `testTimeout` do Vitest para 15 s: os testes de formulário de
várias etapas encostavam nos 5 s padrão sob carga e falhavam por TEMPO, sobre
código correto. Um teste que falha por contenção de CPU ensina o time a
reexecutar a bateria até passar — que é como uma falha de verdade acaba
ignorada.

### Pendências para o Prompt 5

1. **Não consegui verificar as duas telas no navegador.** Elas exigem sessão, e
   eu não faço login. O que existe é o build, o type-check, o lint e os testes
   novos — que exercitam comportamento, não aparência. **Vale abrir e olhar**,
   em especial a grid em tablet e o diálogo de edição.

2. **A visualização do §17 mostra a linha, não a inscrição inteira.** Abrir a
   ficha de um participante e buscar os irmãos dele seria uma ida ao banco por
   clique, num diálogo que existe para conferir um dado de olho. Quem quer ver a
   granja inteira ordena por "Granja / Empresa" — as pessoas ficam juntas. Se a
   operação pedir a visão agrupada de verdade, é uma tela, não um diálogo.

3. **Cancelar inscrição não tem tela** (§16 proíbe exclusão, e cancelamento é
   outra coisa). `update_event_registration` já sabe cancelar e reativar,
   conferindo a capacidade na volta — falta só quem peça.

4. **O teto da exportação é 5.000 linhas.** Muito além da realidade da APCS. Se
   um dia encostar, o caminho é exportar por período, não aumentar o número.

5. **A situação do EVENTO continua sem ser conferida** na leitura pública — a
   pendência 3 da seção 15 segue aberta, e agora vale também para esta tela: um
   evento desativado ainda aparece em `Eventos → Inscrições`, o que é correto
   (os inscritos existem) mas merece uma decisão explícita de produto.

---

## 17. Homologação (Prompt 5)

Nenhuma funcionalidade nova. A auditoria de ponta a ponta encontrou três coisas.

### ⚠️ ALTO — evento que já aconteceu aceitava inscrição

`closes_at` é **opcional**. O Builder o oferece com o início do evento como
padrão, e quem edita pode limpar o campo. Uma página publicada, sem prazo e sem
capacidade, aceitava inscrição para um evento de 2024 — indefinidamente. Nem
`landingEffectiveStatus` nem `create_event_registration` olhavam a data do
evento.

O sintoma seria dado sujo que ninguém percebe até alguém exportar a planilha:
gente inscrita, meses depois, num encontro que já aconteceu.

Corrigido nas duas pontas, com a mesma régua (`event_today()`, a que Eventos usa
para expiração desde o primeiro módulo): a leitura devolve o motivo
`eventPassed`, e a gravação recusa com **RG009**.

⚠️ **A regra é a DATA, não o horário.** "O evento começou às 8h e agora são 9h" é
trabalho do PRAZO — que por padrão é o início do evento, e que quem organiza
pode estender de propósito (inscrição na portaria acontece). O que não pode
existir é inscrição para um DIA que já passou.

### ⚠️ MÉDIO — o teto por inscrição era 200, e são 20

O Prompt 1 escreveu 200 tratando o número como limite de payload. O §7 do
Prompt 5 é explícito: são 20.

E a regra **passou a existir no banco**, não só no Zod:
`event_registration_max_participants()`. Até aqui o teto era a única barreira e
morava só no schema — um administrador chamando o RPC direto pelo PostgREST
passava com 500 pessoas numa inscrição só.

Há um teste que lê o número dos DOIS arquivos e falha se eles divergirem.

### ⚠️ MÉDIO — a confirmação não mostrava a data do evento

O §24 do Prompt 3 já desenhava a tela de sucesso com a data logo abaixo da
frase, e o §16 do Prompt 5 repete. A tela mostrava só os três blocos de texto
configurados: quando é o evento só aparecia se o administrador tivesse lembrado
de escrever `{{event_date}}` na mensagem.

Quem acabou de se inscrever precisa saber quando comparecer, e isso não pode
depender de um marcador. Corrigido nas duas telas ao mesmo tempo — a página
pública e a prévia do Builder —, porque uma prévia que não corresponde ao
resultado público mente (§4).

### Código morto removido

`listRegistrations`, `RegistrationListPage`, `REGISTRATION_LIMIT`,
`matchesRegistrationFilters` e `countByConfirmation` eram o caminho de leitura
que o Prompt 1 preparou para a tela de Inscrições: lia até mil INSCRIÇÕES e
filtrava em memória. O Prompt 4 o substituiu por `getRegistrationBoard`.

Manter os dois deixaria uma armadilha: quem precisasse listar inscrições
encontraria primeiro a versão que traz mil linhas de dado pessoal para a memória
do servidor — exatamente o que o §7 do Prompt 4 proíbe. **Código morto que ainda
compila e ainda funciona é o mais perigoso, porque parece uma escolha legítima.**

Ficaram, com a razão documentada: `getRegistration`, `listRegistrationAuditLogs`,
`createRegistrationAction` e `updateRegistrationAction` — capacidades desenhadas,
cada uma com contrapartida no banco, à espera de uma tela que as peça. São
diferentes de código superseded: não há uma segunda versão delas competindo.

### O que foi verificado no navegador

Com sessão de administrador, no dev server:

| O quê                                 | Resultado                        |
| ------------------------------------- | -------------------------------- |
| `Eventos → Inscrições` no menu        | Abre, com o estado vazio correto |
| `Eventos → Landing Pages`             | Abre, com filtros e estado vazio |
| `Eventos`                             | Lista os eventos existentes      |
| Exportação de evento sem landing page | 404, sem vazar nada              |
| Inscrições em tablet (768px)          | Sem rolagem horizontal           |
| `/eventos/<slug>` inexistente         | 404 institucional, sem login     |
| `/events/*` sem sessão                | Redireciona para `/login`        |

### O que NÃO foi verificado, e por quê

**O ciclo completo com dados reais.** O banco não tem nenhuma Landing Page, e
criar uma para testar deixaria registros **permanentes**: este módulo não tem
exclusão física em lugar nenhum, por decisão do Prompt 1. Uma página de teste e
suas inscrições só poderiam ser inativadas e canceladas, nunca removidas — e
publicá-la colocaria um endereço público no ar.

É decisão de quem responde pelo dado, não minha.

---

## 18. Depois do go live: o que quebrou de verdade

Três relatos chegaram depois que o módulo subiu. Dois eram acabamento; um era
um defeito que estava lá desde o Prompt 1 e que nenhuma das cinco etapas pegou.

### CRÍTICO — o toggle "Confirmado" nunca funcionou

Marcar um participante como "Não confirmado" devolvia:

> O banco recusou esta gravação por configuração interna — não é o seu perfil.

Editar a ficha de um participante falhava igual. Era o mesmo defeito.

**A causa.** `event_registration_audit_logs` é fechada por dois lados, de
propósito: `revoke insert ... from authenticated` e nenhuma policy de insert. A
migration que fez isso explica a intenção num comentário — "quem escreve na
trilha é `create_event_registration` / `update_event_registration` /
`set_participant_confirmation`, **todas SECURITY DEFINER**". Só que das três,
**apenas a primeira era**. As outras duas nasceram `SECURITY INVOKER`, e a
terceira (`update_event_participant`) nasceu igual no Prompt 4.

Uma função `SECURITY INVOKER` roda com o privilégio de quem chamou. Quem chama é
`authenticated`. `authenticated` não pode inserir na trilha. O UPDATE passava; a
linha seguinte morria em 42501.

⚠️ **O comentário descrevia um mundo que o código ao lado dele não construiu.**

**Por que nada pegou.** A função é criada sem reclamar (o PL/pgSQL só planeja
cada comando na primeira execução); type-check, lint e build não falam com o
Postgres; os testes das actions mockam o Supabase, que é justamente quem
recusava. E o ciclo de homologação exercitou `create_event_registration` — a
única das quatro que estava certa. Inscrever funcionava. Confirmar, não.

Isto é exatamente a pendência que o relatório do Prompt 5 declarou em aberto
("o toggle e o diálogo de edição não foram exercitados na interface"). O item
não era formalidade: era este defeito, esperando o primeiro clique.

**A correção.** `20260927000000_registration_writes_security_definer.sql` —
`alter function ... security definer` nas três, sem tocar nos corpos. A checagem
de papel que elas já faziam na primeira linha (`registrations_is_writer()`) é
exatamente o que as policies de update checavam, então a barreira é a mesma, um
nível acima. `auth.uid()` lê o JWT, não o papel do banco: a trilha continua
registrando quem clicou.

**O guarda.** `src/test/sql-audit-writes.test.ts` varre as 145 funções de todas
as migrations e recusa `SECURITY INVOKER` gravando em tabela onde
`authenticated` não tem insert. Ele foi escrito **antes** da correção, e acusou
as três — e só as três.

### A mensagem de erro apontava para o lugar errado

`dbPrivilege` dizia "o log do servidor diz qual **coluna** faltou liberar",
porque o caso que a criou era mesmo de coluna (`events.description`). Aqui
faltava o insert numa **tabela**, e a mensagem mandou toda a investigação para
os grants de coluna — que estavam certos. Passou a dizer "tabela ou coluna".

⚠️ Uma mensagem de erro que descreve só o último caso conhecido aponta para o
lugar errado com toda a confiança do mundo.

### O rótulo "E-mail" saía torto

Só o primeiro rótulo de cada bloco de participante, e só em tela larga.

A `<legend>` usa `float-left` para escapar da renderização especial que o
navegador dá a ela. Um float **estreito** deixa espaço à direita, e a primeira
linha do primeiro rótulo escorregava para esse espaço: o texto começava 118px
adiantado — a largura exata de "PARTICIPANTE 1". No celular não cabia texto ao
lado do float, então a linha já descia sozinha, e o defeito sumia.

`w-full` na legenda resolve: um float de largura total não deixa vão nenhum ao
lado. O `pt-5` que tentava empurrar os campos para baixo saiu junto — ele nunca
funcionou, porque a caixa de **margem** do float contava também.

⚠️ O DOM estava certo, os papéis estavam certos, os nomes acessíveis estavam
certos. O que estava errado era onde o navegador desenhou — e é por isso que
nenhum teste de unidade encontraria isso.

### O logo do CSPI existe agora

A pendência número 1 do Prompt 2, aberta desde então, fechou: o arquivo chegou
(`public/logo-cspi.png`). A assinatura tipográfica saiu dos dois lugares
previstos, e os dois passaram a ler o mesmo `CspiMark` — como já faziam com
`ApcsMark`.

### Ajustes de arte pedidos depois do go live

**Os dois logos levam a `https://apcs.com.br/`**, em outra aba. O `target` não é
enfeite: esta página é uma inscrição pela metade na maior parte do tempo que
fica aberta, e sair dela no mesmo separador jogaria fora o que a pessoa já
digitou — o formulário não guarda rascunho. `rel="noopener noreferrer"` vai
junto, sempre.

**Nome, data, hora e local saíram da tela.** Passaram a viver dentro da arte do
banner, e repeti-los embaixo dele era dizer a mesma coisa duas vezes.

⚠️ **Saíram da TELA, não da página.** A versão `sr-only` continua no HTML, e não
é teimosia com o pedido — é o pedido inteiro:

- o banner é uma **imagem**; quem usa leitor de tela recebe o `alt` e mais nada.
  Apagar o texto tiraria data, hora e local de quem não enxerga: a informação
  não estaria "no banner" para essa pessoa, estaria em lugar nenhum;
- imagem que não carrega acontece (rede ruim, URL assinada expirada). Sem o
  texto, a página viraria um formulário sem dizer para qual evento é — e o
  espaço reservado do `SignedImage` nomeia o evento justamente por isso;
- uma página sem `<h1>` não tem nome para o buscador nem para o índice de
  cabeçalhos do leitor de tela.

O bloco `sr-only` fica **fora** do `space-y-5`. `sr-only` tira o elemento do
fluxo, mas o `space-y` não sabe disso: daria margem ao vizinho, e o banner
desceria alguns pixels por causa de algo que ninguém vê.

**A prévia do Builder acompanhou.** Ela existe para mostrar o que vai ao ar; se
continuasse desenhando o título e a linha de data e local, o administrador
aprovaria uma composição que ninguém veria. É a mesma lição do consentimento no
Prompt 3 — prévia que não acompanha a página real não é ilustrativa, é errada.
O teste que afirmava "mostra nome, data, horário e local" foi **invertido** em
vez de apagado: a pergunta continua valendo, ao contrário.

**O rodapé virou uma linha:** `© APCS | CSP 2026 - Todos os direitos
reservados`. Saíram a assinatura "APCS · CSPI" e a razão social por extenso — o
aviso de direitos já nomeia as duas marcas.

⚠️ **O ano está fixo em 2026**, como foi ditado. Derivar de `new Date()` mudaria
sozinho na virada — o que costuma ser o desejado, mas é decisão de quem responde
pela marca.

⚠️ **E `program` virou "CSP", não "CSPI".** Esse texto é o `alt` do logo: o que
alguém ouve no lugar da imagem. O desenho escreve **CSP**, e é assim que a marca
aparece no nome do evento e no rodapé. Um `alt` com sigla diferente da que está
desenhada descreve outra coisa.

---

## 19. A página sem texto: o banner de confirmação e o Builder em blocos

Pedido do cliente depois do go live, e ele fecha um movimento que tinha começado
na seção 18: **a página de inscrição deixa de ter texto solto.** Nome, data,
hora e local já tinham saído da tela e passado para o banner. Agora saíram os
dois blocos que restavam.

### O que saiu

| O quê                       | Onde ficava                | O que ficou no lugar          |
| --------------------------- | -------------------------- | ----------------------------- |
| **Descrição**               | abaixo da arte, na página  | nada — a arte diz o que dizia |
| **Mensagem após inscrição** | título + mensagem + rodapé | um **banner de confirmação**  |

A confirmação virou uma **imagem**. Quem monta a página envia duas artes — a da
inscrição e a da confirmação — e não escreve mais nada.

### ⚠️ As colunas de texto NÃO foram derrubadas

`description`, `success_title`, `success_message` e `success_footer` continuam
em `event_landing_pages`, **com o conteúdo que tinham**. Um drop de coluna
apagaria texto escrito por gente, em produção, para atender a um pedido de
layout. Se amanhã a decisão for outra, o texto está lá.

O que saiu foi a **escrita**, em duas camadas que não são redundantes:

1. `create_event_landing_page` e `update_event_landing_page` foram **derrubadas
   e recriadas** sem os quatro parâmetros (drop-e-recria, e não `create or
replace`: tirar parâmetro muda a assinatura, e as duas versões conviveriam
   sobrecarregadas — 42725 numa chamada por nome de argumento);
2. o `grant update` das quatro colunas foi **revogado**. As funções são SECURITY
   INVOKER, então o privilégio de coluna é a barreira que vale mesmo se alguém
   escrever um UPDATE novo por distração — inclusive direto pelo PostgREST.

O Zod ignora chave desconhecida por padrão: uma tela que continuasse mandando
`description: ""` passaria pelo schema sem uma palavra e apagaria o texto. Por
isso há dois testes assertando as **chaves** do payload, e não só o conteúdo.

### O banner de confirmação, e o que ele NÃO faz

`success_image_path` / `_mime` / `_size_bytes`, com o mesmo CHECK de "os três ou
nenhum" que `image_path` já tinha. Mesmo bucket, mesmo teto de 5 MB, mesma
inspeção de bytes no servidor, mesmo descarte do arquivo substituído. Pasta
própria: `<event_id>/landing/success/`.

⚠️ **Sem banner, a confirmação NÃO cai no cartaz do evento** — ao contrário da
arte da página, que cai. São duas peças com finalidades diferentes: uma convida,
a outra confirma. Mostrar a peça de divulgação como se fosse o comprovante seria
pior do que não mostrar imagem nenhuma. Sem banner, a confirmação usa o **texto
padrão da plataforma** (`app_settings`, editável em Configurações → Textos), que
sempre existe.

⚠️ **Com banner, o texto vira `sr-only` — não desaparece.** Um banner é uma
imagem, e o `alt` de uma arte de confirmação não comporta a frase inteira. Quem
usa leitor de tela recebe o mesmo conteúdo que quem enxerga recebe pela arte.

⚠️ **A data e o horário ficam VISÍVEIS nos dois casos.** É a correção da
homologação (§16 do Prompt 5) resistindo a um jeito **novo** de perdê-la: antes
o risco era o administrador esquecer de escrever `{{event_date}}`; agora é ele
mandar uma arte sem a data, ou com a data de antes de o evento ser remarcado. As
duas linhas vêm do EVENTO, não da imagem.

⚠️ **E o banner pode não carregar.** A URL é assinada e expira em uma hora; a
aba pode ficar aberta mais que isso antes de alguém apertar "confirmar". Sem
tratamento, o resultado seria uma moldura vazia com a frase escondida em
`sr-only` — a granja se inscreveria e não veria confirmação nenhuma. O `onError`
da imagem devolve o texto à tela.

### Uma action para as duas artes, e um `slot` para dizer qual

As três actions de upload são as mesmas para a arte da página e para o banner. O
que difere cabe numa tabela (`IMAGEM_DA_PAGINA` em `event-landing.ts`): a pasta
no Storage, a função Postgres e a coluna. Duplicar as três para trocar isso é
como uma das cópias deixa de receber a próxima correção de segurança.

⚠️ **A pasta do `success` é FILHA da pasta do `page`.**
`<id>/landing/success/x.png` também começa com `<id>/landing/`, então um
`startsWith` sozinho deixaria uma arte de confirmação ser gravada como arte da
página. Por isso a conferência exige que o resto do caminho seja um **nome de
arquivo** — sem mais nenhuma barra.

### O Builder virou quatro blocos de duas colunas

Era uma coluna de configuração à esquerda e a prévia `sticky` à direita. Dois
fatos somados envelheceram esse desenho:

- a coluna esquerda tinha seis cartões e **três eram texto**; com o texto fora, o
  que sobrou são pares que se leem juntos;
- a prévia deixou de ser uma tela e virou **duas** (formulário e confirmação), e
  duas páginas em miniatura não cabem em meia tela.

| Bloco | Esquerda             | Direita                    |
| ----- | -------------------- | -------------------------- |
| 1     | Evento               | Endereço público           |
| 2     | Imagem da página     | Imagem da confirmação      |
| 3     | Campos do formulário | Configurações de inscrição |
| 4     | Ver formulário       | Ver confirmação            |

A prévia deixou de ser `sticky` de propósito: com os blocos em duas colunas a
página encurtou pela metade, e uma prévia grudada no topo passaria a **cobrir** o
bloco que a pessoa está editando em vez de acompanhá-lo.

As duas telas da prévia aparecem **ao mesmo tempo** porque as duas viraram,
principalmente, duas artes. Comparar duas imagens é a operação que se faz o tempo
todo agora, e um botão que troca uma pela outra transforma comparação em
memória.

⚠️ **Consequência para os testes:** com as duas telas no DOM,
`getByText("18/09/2026")` acharia a data da confirmação numa asserção que fala do
formulário — e passaria dizendo o contrário do que pretende. Por isso
`landing-preview.test.tsx` ganhou um helper `painel()`, e toda asserção que fala
de uma das telas é feita dentro dela.

### As setas de reordenar saíram — e o §31 continua de pé

O pedido foi remover as duas setas de cada linha da lista de campos. Elas eram a
**única** forma de reordenar sem mouse: tirá-las e não pôr nada no lugar
quebraria o §31 ("Não fazer o Drag & Drop depender exclusivamente do mouse") sem
que nenhum teste percebesse — os casos daquele bloco simplesmente sumiriam.

No lugar entrou um `<select>` de **posição**, nativo (teclado e leitor de tela de
graça), com o nome do campo no `aria-label`. Numa lista de cinco itens, escolher
"3" na hora é melhor do que apertar a seta duas vezes.

⚠️ **O `value` é 1-based, igual ao rótulo.** A primeira versão usava
`value={indice}` com texto `indice + 1` — a opção que MOSTRA "3" carregava o
valor "2". O teste pegou: `selectOptions(select, "3")` acertava a posição errada
por um. Qualquer código que procure a posição pelo que está escrito sofreria o
mesmo, e a conversão para índice agora acontece num lugar só.

### O que isso muda na leitura pública

`get_public_event_landing_page` deixou de devolver `description`,
`successTitle`, `successMessage` e `successFooter`, e passou a devolver
`successImagePath`. É o princípio do cabeçalho de `20260924000000`: campo que a
tela não usa mais e continua no jsonb é campo que desce para o navegador sem
ninguém notar.

`successDefaults` **continua** — ele é o fallback e o texto alternativo do
banner, não um resquício.

⚠️ E a descrição do Open Graph (o que aparece ao colar o link no WhatsApp) era o
texto editável. Passou a ser sempre a frase montada a partir do evento. Não é
perda: a anterior só existia quando alguém tinha lembrado de escrevê-la, e caía
nessa mesma frase quando não.

---

## 20. O teto do telefone e a confirmação só com o banner

Dois ajustes pedidos depois da seção 19, os dois na página pública.

### O telefone parava de reclamar tarde demais

A máscara já existia e funcionava — `formatPhoneInput`, aplicada no `onChange`
dos campos de Telefone e WhatsApp desde o Prompt 3. O que **não** existia era
teto: acima de 11 dígitos a função saía da frente (para não estragar número
internacional) e devolvia o que recebesse. O campo aceitava quarenta
algarismos, e o erro só chegava no **envio**, vindo do `phoneSchema`, depois de
a granja ter preenchido a inscrição inteira.

O corte passou a viver dentro de `formatPhoneInput`, em **15 dígitos** — o
máximo do E.164, que é o mesmo teto que a validação sempre teve. Os dois números
saíram dos literais e viraram `MIN_PHONE_DIGITS` / `MAX_PHONE_DIGITS` em
`src/lib/format/phone.ts`, importados pelo `phoneSchema`: enquanto eram
literais em dois arquivos, um dos lados podia afrouxar sozinho e o campo passaria
a deixar digitar o que o servidor recusa.

⚠️ **Por que não é um `maxLength` no `<input>`.** É a solução aparentemente
óbvia e é a errada, por uma razão que só aparece na conta: `maxLength` conta
**caracteres**, e a máscara brasileira completa — `(11) 99999-9999` — tem
exatamente 15. Com `maxLength={15}` o navegador bloquearia a digitação do **12º
dígito**, que é justamente onde um número estrangeiro começa a existir. A
capacidade internacional que o §17 mandou preservar morreria por causa de dois
parênteses e um hífen. O corte precisa ser em dígitos, e por isso mora na
função.

⚠️ **Vale também no backoffice.** `participant-actions.tsx` usa a mesma função
para editar a ficha do participante, então o teto chegou lá junto — sem uma
linha a mais, e sem duas regras para manter em dia.

### A confirmação passou a ser só o banner

O pedido foi literal: "ao confirmar a inscrição, o usuário final deve ser
apresentado apenas ao banner de confirmação". A data e o horário, que ficavam
desenhados abaixo da arte, entraram no bloco `sr-only` junto com o título, a
mensagem e o rodapé. Visualmente, a tela é a imagem e mais nada.

⚠️ **ISSO REABRE, DE OLHOS ABERTOS, O QUE O §16 TINHA FECHADO.** Aquela correção
de homologação existia porque a data só aparecia se o administrador tivesse
lembrado de escrever `{{event_date}}` na mensagem. Agora ela só aparece se a
**arte** a trouxer — e uma arte enviada antes de o evento ser remarcado vai
continuar anunciando a data velha, sem que nada no sistema perceba. É uma
decisão de quem responde pela comunicação, e está registrada no cabeçalho de
`TelaDeSucesso` para não voltar como surpresa.

⚠️ **O que NÃO sumiu:**

- **sem banner**, o texto padrão da plataforma continua sendo a confirmação
  inteira, visível — uma página que não mostrasse nada depois do envio deixaria
  a granja sem saber se deu certo;
- **com banner que não carrega** (a URL assinada expira em uma hora, e a aba
  pode ficar aberta mais que isso), o `onError` devolve o texto à tela;
- **para quem usa leitor de tela**, tudo continua no HTML. Sumir da tela é
  composição; sumir da página deixaria essa pessoa sem confirmação nenhuma,
  porque de uma imagem ela recebe só o `alt` — e o `alt` de um banner não
  comporta a frase inteira.

⚠️ **A prévia do Builder acompanhou**, e aqui isso rende: com a arte sozinha na
coluna "Ver confirmação", falta de data no banner **salta aos olhos** antes de a
página ser publicada. É a única conferência que restou, e ela só funciona sem
texto por baixo.

---

## 21. "Não confirmados" ficava em zero para sempre

Defeito encontrado em produção, na tela de um evento: um participante estava
como **não confirmado**, o contador de "Confirmados" desceu de 10 para 9 — e o
de "Não confirmados" continuou em **0**, em vez de virar 1.

### A causa

`event_registrations_board` montava as métricas assim:

```sql
'metrics', (select to_jsonb(m) from metricas m)
```

`to_jsonb` de uma linha **nomeia as chaves pelas colunas**. A CTE `metricas` tem
`participants`, `confirmed`, `not_confirmed`, `registrations` e `companies` — e
o jsonb saía com esses cinco nomes, em snake_case. A aplicação lê
`metricas.notConfirmed` (`getRegistrationBoard`), não achava, e caía no `?? 0`.

⚠️ **Só uma das cinco quebrou, e é isso que torna o caso traiçoeiro.** Quatro
são palavras **únicas** — `participants`, `confirmed`, `registrations`,
`companies` são iguais nas duas convenções e casavam por coincidência.
`not_confirmed` é a única composta, e foi a única a chegar com o nome errado.

⚠️ **O modo de falhar é o pior que existe para um contador:** ele não some da
tela, não dá erro, não aparece no log. Ele mostra **zero** — um número
plausível, e "nenhum não confirmado" é exatamente o que se espera ver num evento
que está indo bem. Só fica visível quando alguém marca alguém como não
confirmado **e** confere a soma à mão.

Nenhuma barreira do projeto pegava: o jsonb atravessa a fronteira como
`unknown`, então o TypeScript está certo dos dois lados; a função compila; a RLS
passa; e os testes do CSV montam `metrics` à mão, sem nunca perguntar ao SQL
como ele escreve as chaves. É a mesma família de `sql-column-grants` e
`sql-returns-table`: contrato que só existe como **combinação** entre banco e
aplicação.

### A correção, e a regra que ela deixa

As métricas passam a ser montadas **chave a chave**, com `jsonb_build_object` —
exatamente como `rows` sempre foi montado, dez linhas abaixo, e por este motivo.

> `to_jsonb(<linha>)` é ótimo para depurar e é uma armadilha para contrato: ele
> publica o nome interno das colunas como API.

`sql-event-landing.test.ts` passou a cobrar duas coisas: que toda chave de
`RegistrationBoardMetrics` apareça literalmente no corpo da função, e que a
forma que causou o defeito (`'metrics', (select to_jsonb …`) não volte. Sem a
segunda, alguém poderia reintroduzir `to_jsonb` e a primeira continuaria
passando — as chaves ainda estariam escritas em algum comentário.

### ⚠️ O filtro de arquivos do teste falhou pela terceira vez

O `sql-event-landing.test.ts` lê as migrations do módulo por um filtro de nome, e
ele era `/landing|event_registration/`. Dois arquivos ficavam de fora:

```
20260927000000_registration_writes_security_definer.sql
20260929000000_event_registration_board_metrics.sql
```

O segundo é justamente o que redefine `event_registrations_board` — com ele de
fora, a bateria leria a versão anterior e **passaria sobre código morto**. Foi
exatamente o que aconteceu ao escrever a guarda acima: ela falhou de cara,
lendo a definição antiga.

O filtro virou `/landing|registration/`, e entrou um caso que **conta** os
arquivos do módulo na pasta contra os que o filtro pegou. Uma lista de nomes
esperados precisaria ser atualizada a cada migration; a conta responde a
pergunta real — "ficou algum de fora?" — sozinha.

### E a máscara do modal de edição

Veio na mesma conversa: "o modal na parte de telefone não está com máscara e
limite". A máscara **existe desde o Prompt 4** — `formatPhoneInput` no
`onChange` dos dois campos. O que faltava era o **teto**, o mesmo da seção 20, e
ele chegou junto porque o modal usa a mesma função.

Visto de fora os dois defeitos parecem o mesmo: você digita muito, a máscara
some (acima de onze dígitos, de propósito, para não estragar número
estrangeiro), e nada te impede. `participant-actions.test.tsx` ganhou quatro
casos que separam as duas coisas — a máscara, o teto de 15 dígitos, o
internacional de 12 que precisa continuar cabendo, e o fato de que o que vai ao
banco são dígitos, sem máscara.

### E a lista de campos ficou apertada

Consequência direta da seção 19: com o Builder em duas colunas, a lista de
campos foi para **metade da largura**. Cada linha tinha o rótulo, uma frase de
explicação embaixo dele, o selo de obrigatoriedade e o seletor de posição — e a
frase começou a espremer os dois últimos para fora da linha, com o texto cortado
no meio.

As explicações viraram **tooltip** (`InfoTip`, ao lado do rótulo). Não ficaram
menos verdadeiras; só não precisavam ocupar espaço permanente para algo que se
lê uma vez na vida. É a mesma conclusão a que a barra de filtros chegou antes —
e é literalmente o componente que nasceu daquele problema.

⚠️ **"Obrigatório" e "Opcional" saíram do texto da dica.** Não foi corte por
espaço: o **selo** ao lado já diz isso, e diz melhor — ele se lê de relance, sem
clicar em nada. Repetir por escrito dentro da dica era a mesma coisa dita duas
vezes, a segunda em letra menor.

⚠️ **O rótulo do botão nomeia o campo** (`Sobre E-mail`, e não "Mais
informações"). Cinco botões idênticos fazem um leitor de tela anunciar cinco
controles iguais — o mesmo cuidado do seletor de posição, ali ao lado.

| Campo                | Dica                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| Granja / Empresa     | Informado uma vez por inscrição.                                              |
| E-mail               | De cada participante. O que impede a mesma pessoa de se inscrever duas vezes. |
| Nome do Participante | De cada participante.                                                         |
| Telefone             | Cada participante precisa informar telefone ou WhatsApp.                      |
| WhatsApp             | Cada participante precisa informar telefone ou WhatsApp.                      |
