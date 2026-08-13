# Eventos

O módulo de eventos da APCS. Responde a uma pergunta só, e é dela que sai todo o
resto do desenho:

> **Quais eventos estão de pé agora, quando, onde e para quem?**

Quem consome a resposta hoje é o backoffice. Quem vai consumir amanhã é o
chatbot e, depois dele, a comunicação por WhatsApp.

---

## 1. A decisão que explica o módulo: a expiração é DERIVADA

Esta é a única coisa que precisa ficar clara antes de mexer em qualquer arquivo.

```
status (coluna no banco)  =  APENAS a decisão humana:  'active' | 'inactive'
effectiveStatus (derivado) =  o que vale agora:        'active' | 'inactive' | 'expired'
```

```ts
// src/modules/event/event.rules.ts
export function effectiveStatus(event, today) {
  if (event.status === "inactive") return "inactive"; // alguém inativou
  return event.eventDate < today ? "expired" : "active"; // o calendário decidiu
}
```

**"Expirado" nunca é gravado em lugar nenhum.** Não existe coluna
`status_reason`, não existe cron, não existe rotina de varredura.

### Por que assim

1. **O projeto não tem infraestrutura de job.** Sem cron, sem `pg_cron`, sem
   worker — o `vercel.json` só declara o framework. Uma rotina agendada seria a
   primeira do projeto, e uma rotina que não roda falha **em silêncio**: o evento
   de ontem continuaria no ar e ninguém saberia.
2. **A derivação só sabe rebaixar.** Um evento inativado à mão nunca volta a
   aparecer como ativo pela passagem do tempo. "Expiração não pode reativar
   evento manual" deixa de ser uma regra a lembrar e vira uma impossibilidade.
3. **Idempotência de graça.** Não há rotina para rodar duas vezes.
4. **Sem janela de inconsistência.** Um job que roda às 03:00 deixaria o evento
   de ontem "ativo" das 00:00 às 03:00. A derivação vira no segundo certo.

### O que isso custa — e é uma troca, não um esquecimento

**Não existe linha de auditoria "o sistema expirou o evento X às 00:00"**,
porque nada acontece: a verdade muda com o calendário. É o único item da matriz
de auditoria do escopo que este desenho não entrega.

Se um dia for exigido, o caminho é um cron que grava **só** a linha de
auditoria, mantendo a derivação como verdade de comportamento — nunca as duas
coisas gravando status, que criaria a segunda fonte da verdade que este desenho
existe para evitar.

### O furo que precisou ser tapado

Com a expiração derivada, bastaria mandar `activate` num evento de ontem para
ele voltar a contar como ativo. Por isso `set_event_status` **recusa ativar um
evento cuja data já passou** (`EV001`), dentro da função Postgres — não na tela.

---

## 2. Os três conceitos

| Conceito         | Tabela                | O que é                                                                                                               |
| ---------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Evento**       | `events`              | Uma ocorrência independente. Sem recorrência, sem intervalo de datas: o Workshop de 2026 e o de 2027 são duas linhas. |
| **Público-alvo** | `event_segments`      | Catálogo de segmentações. Público novo = um `insert` numa migration, sem código.                                      |
| **Vínculo**      | `event_segment_links` | N:N. Um evento alcança N públicos **sem se duplicar**.                                                                |

Mais `event_audit_logs`, a trilha imutável.

---

## 3. Segmentação — o que existe e o que deliberadamente não existe

```
Evento ──< event_segment_links >── event_segments
                                          │
                                          │  ⚠️ ESTE ELO NÃO EXISTE
                                          ▼
                              EventAudienceSource → associados
                                          ▼
                                     Campanha → WhatsApp
```

**Não há cadastro de associados neste banco.** As tabelas de pessoas são
`profiles` (usuários do CRM) e `chat_contacts` (quem falou com o bot) — nenhuma
é um registro de associados da APCS. A evidência está na §9.

Então a segmentação entrega o que dá para entregar com honestidade: o evento
**rotula** seu público de forma consultável, e toda a lógica de elegibilidade
(OU, união, deduplicação) está escrita e testada. O que falta é só a ORIGEM dos
associados, declarada como porta em `event.audience.ts`.

O `slug` existe e é imutável exatamente para essa porta se prender a ele: `name`
é rótulo de tela e alguém vai renomeá-lo.

### Acrescentar um público

Uma migration, uma linha:

```sql
insert into public.event_segments (slug, name, description)
values ('camara-ambiental', 'Câmara Ambiental', 'Associados ligados à Câmara Ambiental.')
on conflict (slug) do nothing;
```

Sem tela, sem tipo regerado, sem deploy de código. Foi por isso que o catálogo é
tabela e não enum — um enum exigiria duas migrations por público (o valor não
pode ser usado na mesma transação em que é criado) e o Postgres **não permite
remover valor de enum**: um nome errado seria permanente.

> Hoje o catálogo tem **um** público ("Todos os associados"). Enquanto for
> assim, a segmentação rotula mas não separa ninguém.

---

## 4. A imagem: três passos, e por quê

```
1. requestEventImageUploadAction   permissão + extensão + tamanho
                                   SORTEIA o eventId  →  <eventId>/<uuid>.<ext>
2. navegador → Supabase Storage    upload direto na URL assinada
3. createEventAction               baixa, confere os BYTES, e só então grava
```

**Por que o arquivo não passa pelo servidor Next:** a Vercel corta o corpo de
qualquer requisição serverless em **4,5 MB**, e o limite do módulo é 5 MB. Não é
configuração — uma imagem de 5 MB simplesmente não chega por Server Action.

**Por que o `eventId` é sorteado no passo 1:** o caminho da imagem precisa da
pasta do evento, e o arquivo sobe antes de a linha existir. Sortear o id ali é o
que permite a imagem ser obrigatória já no primeiro insert, sem criar um evento
sem cartaz nem inventar uma pasta de rascunho.

### As quatro barreiras

| Onde                                 | O que impede                                  |
| ------------------------------------ | --------------------------------------------- |
| Navegador (`validateImageCandidate`) | extensão fora da lista, arquivo vazio, > 5 MB |
| Servidor (`inspectImage`)            | **os bytes**: JPEG/PNG/WEBP por assinatura    |
| Bucket `events`                      | `allowed_mime_types` + `file_size_limit`      |
| CHECK de `events`                    | `image_mime` na lista, `0 < size <= 5242880`  |

**A regra do servidor: os bytes mandam, e a extensão tem de concordar com eles.**
Um `.png` que na verdade é JPEG é recusado — uma regra só, sem exceção, é mais
fácil de confiar do que duas com uma ressalva.

**Limite honesto:** magic bytes provam o **cabeçalho**, não o arquivo inteiro. Um
PNG com assinatura válida e corpo truncado passa por aqui e falha no navegador
de quem for abrir. Decodificar de verdade exigiria uma dependência nativa
(sharp/jimp) para responder uma pergunta que cabe em doze bytes.

### Substituição

A imagem nova é validada **antes** de a linha mudar. Se for recusada, o objeto
novo é apagado e o evento continua apontando para a imagem que sempre funcionou.
A antiga só é descartada **depois** da troca gravada — e só se nenhum evento
ainda apontar para ela (`discardReplacedImage`). Nunca há um instante em que o
banco aponte para arquivo inexistente.

---

## 5. Segurança

- **Bucket privado.** Acesso só por URL assinada emitida no servidor depois de
  checar permissão. TTL de **1 hora** (contra os 300 s das normativas): a grid
  emite as URLs na renderização, e uma lista aberta por meia hora não pode virar
  uma tela de imagens quebradas.
- **O caminho nunca usa o nome enviado.** `<event_id>/<uuid>.<ext>` mata
  traversal por `../`, colisão entre dois "cartaz.png" e caractere inválido.
- **O link de inscrição é dado externo não confiável.** `z.string().url()`
  **ACEITA** `javascript:alert(1)` — num `href`, isso é XSS. A validação é uma
  allowlist explícita de protocolo (`http:`/`https:`), no Zod **e** no CHECK
  `events_url_scheme`.
- **Autoria não se declara, se comprova.** `created_by`/`updated_by` têm
  `default auth.uid()` e as policies exigem `= auth.uid()`. Um `ceo` chamando o
  PostgREST direto não consegue nem assinar a edição com o nome de outro, nem
  editar sem assinar.
- **Grants de coluna.** RLS filtra linha, não coluna: sem eles a policy de update
  deixaria reescrever `created_by`. Verificado — **nem o admin consegue**.

---

## 6. Permissões

| Ação                               | Administrador (`admin`) | Gestor (`ceo`) | Atendente (`comercial`) |
| ---------------------------------- | :---------------------: | :------------: | :---------------------: |
| Visualizar eventos                 |           ✅            |       ✅       |           ✅            |
| Criar / Editar / Ativar / Inativar |           ✅            |       ✅       |           ❌            |
| Ver a trilha de auditoria          |           ✅            |       ✅       |           ❌            |

Três camadas: `PERMISSION_MATRIX` (`events.read` / `events.write`) →
`assertPermission` na action → RLS + guarda de papel dentro da função Postgres
(`42501`).

> A auditoria é mais estreita que a leitura. Para um `comercial`,
> `listEventAuditLogs` devolve **lista vazia sem erro** — é assim que RLS
> funciona, ela filtra linhas em vez de recusar a consulta. Por isso a tela
> também precisa checar `events.write` antes de renderizar a seção: senão
> mostraria "nenhum registro" onde o certo é não mostrar a seção.

---

## 7. Auditoria

| Ação                     | Quando                | `metadata`                       |
| ------------------------ | --------------------- | -------------------------------- |
| `event_created`          | cadastro              | nome, data, públicos             |
| `event_image_uploaded`   | cadastro              | mime, tamanho                    |
| `event_updated`          | edição, se algo mudou | `{changes: [{field, from, to}]}` |
| `event_image_replaced`   | troca de imagem       | `{from, to}`                     |
| `event_segments_updated` | troca de públicos     | `{from, to}`                     |
| `event_activated`        | ativação              | `{from, to, eventDate}`          |
| `event_deactivated`      | inativação            | `{from, to, reason: 'manual'}`   |

O **diff campo a campo** é calculado dentro de `update_event`, e não na
aplicação, por um motivo concreto: ele precisa da linha antiga e da nova na
mesma transação. Lido antes e escrito depois pela aplicação, duas edições
simultâneas registrariam "de A para C" e "de A para B" — e o histórico contaria
uma mentira.

A trilha é imutável: sem policy de update/delete e com os privilégios revogados.

---

## 8. A porta do chatbot

```ts
// src/lib/services/event-chatbot.ts
getAvailableEventsForSegments(slugs, { limit?, untilDate? }): Promise<ChatbotEvent[]>
getEventForSegments(eventId, slugs):                          Promise<ChatbotEventResult>
getAvailableEventsForAssociate(associateId, query):           Promise<... | unknown-audience>
getEventForAssociate(eventId, associateId):                   Promise<ChatbotEventResult>
resolveEventAudience(eventId):                                Promise<EventAudience>
```

**O chatbot nunca fala com o banco.** Ele chama estas funções e recebe
`ChatbotEvent` — e não `EventSummary`, que carrega `createdBy`/`updatedBy`
(nomes de funcionários da APCS), status cru e carimbos administrativos.

O DTO é uma **lista fechada de campos**, não um `Omit<...>`: com `Omit`, um campo
novo em `EventSummary` passaria a vazar sozinho. Um teste falha se alguém trocar
isso.

### A regra de visibilidade — três condições

1. o evento está **ativo** (a decisão humana);
2. a data **não passou** (a decisão do calendário);
3. o associado pertence a **algum** dos públicos do evento — **OU**, nunca E.

A condição 2 é **defesa em profundidade**, não redundância. Se um dia existir uma
rotina marcando vencidos como inativos, ela pode falhar, atrasar ou não rodar;
esta comparação não pode. Um evento que já aconteceu nunca é oferecido, qualquer
que seja o estado da coluna.

O corte por data é feito contra `public.event_today()`, a **mesma** função da
regra de ativação. Com o relógio do processo, a Vercel (UTC) mudaria o dia às 21h
de Brasília.

### Um evento só: os três "nãos" colapsam num só

`getEventForSegments` devolve `unavailable` tanto para "não existe" quanto para
"já passou" quanto para "não é do seu público" — **de propósito**. Distinguir os
casos confirmaria a existência de um evento a quem não deveria saber dele, e é
assim que varrer ids vira um mapa da agenda.

### Limite

`DEFAULT_CHATBOT_EVENT_LIMIT = 10`, teto rígido em `50`. O teto existe contra
enumeração: sem ele, `limit=100000` seria um dump da agenda numa chamada.
Paginação por cursor fica para quando o bot precisar de "mais eventos" — hoje
seria complexidade sem uso.

**Ainda não está ligada ao `decide.ts`.** Hoje todo texto do bot sai do catálogo
aprovado em `src/modules/chat/flows/csp.content.ts`, sem etapa de consulta a
eventos. Quando essa etapa existir, ela roda **anônima** — `/api/chat` é público
e a RLS de `events` exige papel autenticado —, então precisará de `service_role`
no servidor e **tem de entrar por aqui**.

> "Eventos" também aparece no [ROADMAP](./ROADMAP.md) como o _fluxo de chat_ #25
> em `/flows/events`. É coisa diferente deste CRUD — este é a fonte de dados que
> aquele fluxo vai ler.

---

## 9. A audiência — e o elo que falta

```
EVENTO → SEGMENTAÇÃO → [ EventAudienceSource ] → CAMPANHA → PROVEDOR WHATSAPP
   ✅         ✅               ❌ não existe          ❌            ❌
```

### O que foi verificado no banco (não suposto)

| Achado                                         | Evidência                                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Não há cadastro de associados                  | as tabelas de pessoas são `profiles` (usuários do CRM) e `chat_contacts`                                          |
| `chat_contacts` é log de leads, não identidade | **10 linhas para 7 telefones distintos**, e a única restrição única é a PK — uma linha nova por triagem concluída |
| `contact_profile` não é filiação               | `'producer' \| 'member' \| 'supplier'` é resposta que a pessoa deu na triagem                                     |
| Nenhuma tabela liga pessoas a segmentos        | a única coluna `%segment%` do schema está em `event_segment_links`                                                |

### A porta

`src/modules/event/event.audience.ts` declara `EventAudienceSource` com dois
métodos, e uma única implementação: `NO_ASSOCIATE_REGISTRY`, que **admite que
não sabe**.

```ts
type AudienceLookup<T> =
  | { available: true; value: T }
  | { available: false; reason: "no-associate-registry" };
```

⚠️ **`available: false` não é `value: []`.** "Não sei quem são" e "não é
ninguém" são respostas diferentes; colapsá-las faria uma campanha enviar para
zero pessoas e reportar sucesso. É o mesmo erro que o escopo proíbe do outro
lado — nunca ler "sem segmento" como "todos os associados". Ausência de dado não
é um valor.

Pelo mesmo motivo `resolveEventAudience` tem **quatro** estados, e não dois:
`not-found`, `no-segments` (a audiência **é** vazia), `unavailable` (não há de
onde tirar) e `resolved`.

### Quando o cadastro existir

Escreve-se uma implementação de `EventAudienceSource` e troca-se a linha em
`audienceSource()` no service. **Nada mais muda** — a lógica de OU, união e
deduplicação já está escrita e testada contra uma origem em memória.

---

## 9.1 GAPs para a comunicação por WhatsApp

Nenhum destes foi inventado para "resolver" o prompt. São o que falta, dito:

| GAP                               | Situação hoje                                                                                                                                                                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cadastro de associados**        | não existe                                                                                                                                                                                                                                                                   |
| **Filiação associado ↔ segmento** | não existe                                                                                                                                                                                                                                                                   |
| **Opt-in de marketing**           | **não existe.** O que existe é consentimento LGPD **por conversa** (`chat_conversations.consent_given_at` + `consent_policy_version`), para coleta de dados naquela triagem. Não é autorização para receber comunicação depois, e **não deve ser reutilizado como se fosse** |
| **Opt-out / bloqueio**            | não existe                                                                                                                                                                                                                                                                   |
| **Preferência de canal**          | `chat_contacts.preferred_channel` existe, mas é "como o time comercial deve te procurar sobre o CSP" — resposta de triagem, não preferência de campanha                                                                                                                      |
| **Telefone verificado**           | `chat_contacts.phone` é digitado pela pessoa, sem verificação                                                                                                                                                                                                                |

A audiência final de uma campanha **não é só segmento**:

```
segmento  ∩  opt-in válido  ∩  canal válido  ∩  regras da campanha
```

E **audiência ≠ entrega**: "quem pode receber" é elegibilidade; "quem recebeu" é
resultado de envio. São duas tabelas diferentes no dia em que existirem.

---

## 9.2 A arquitetura de disparo (a construir, não construída)

```
Event
  ↓  resolveEventAudience(eventId)
EventAudienceResolver     ← existe, sem origem de associados
  ↓
Campaign                  ← não existe
  ↓
CampaignAudience          ← não existe (o instantâneo de quem era elegível)
  ↓
Message / MessageTemplate ← não existe
  ↓
WhatsAppProvider          ← não existe
```

**Não criei a interface `WhatsAppProvider`.** O escopo permite não criar quando
não há necessidade no código atual, e não há: uma interface sem implementação e
sem chamador é especulação que envelhece errado. O que fica registrado é o
formato esperado:

```ts
interface WhatsAppProvider {
  sendText(...): Promise<DeliveryResult>;
  sendTemplate(...): Promise<DeliveryResult>;
  sendMedia(...): Promise<DeliveryResult>;
}
```

Quando o disparo existir, ele **não** entra em `EventService`. Nada de
`sendEventWhatsApp()` no CRUD: o evento não conhece provedor, campanha nem
telefone — e não deve.

**O que o disparo vai precisar considerar, e hoje não existe:** template
aprovado pela Meta, variáveis, idioma, opt-in, janela de 24h de atendimento,
políticas da Meta e status de entrega.

### Cache

O projeto não tem Redis nem camada de cache. Não introduzi uma por causa deste
módulo. A invalidação que existe é a do Next (`revalidatePath`), já disparada por
criação, edição e mudança de status.

### Rate limit

O chat público já tem rate limit no banco (`src/lib/chat/rate-limit.ts`: 8
mensagens/minuto, 40 por conversa, 5 conversas/hora por hash de IP). Quando a
consulta de eventos entrar no fluxo do chat, ela herda esse limite — não precisa
de mecanismo novo.

### Analytics

Fora deste escopo. Os pontos que fariam sentido medir um dia: quantos viram,
quantos clicaram no link, quantos se inscreveram, quantas mensagens saíram e
quantas falharam.

---

## 9.3 Edge conhecido: desativar um público em uso

Apagar um segmento é impedido em duas camadas (verificado): a aplicação não tem
privilégio de `delete` em `event_segments`, e a FK de `event_segment_links` é
`on delete restrict` — como dono, o Postgres devolve `23503`. Retirar de
circulação se faz com `active = false`.

**Mas:** o formulário só lista segmentos ativos, e `assert_event_segments` só
aceita ativos. Se um público desativado ainda estiver ligado a um evento, a
próxima edição desse evento vai removê-lo do vínculo. Não é silencioso — a
alteração vira `event_segments_updated` na auditoria —, mas é uma remoção que
ninguém pediu.

Antes de desativar um público, veja quem usa:

```sql
select e.name, e.event_date
from public.event_segment_links l
join public.events e on e.id = l.event_id
join public.event_segments s on s.id = l.segment_id
where s.slug = 'o-slug';
```

---

## 10. Armadilhas encontradas (e que vão te pegar de novo)

**A classe `P0` de SQLSTATE é reservada pelo PL/pgSQL.** `P0003` é
`too_many_rows` e `P0004` é `assert_failure` — e `exception when others`
**não captura** `assert_failure`. Um erro de negócio com esse código atravessava
qualquer tratamento e derrubava a transação. Os códigos deste módulo usam a
classe `EV`, que ninguém ocupa:

| Código  | Significado                                  | Vira              |
| ------- | -------------------------------------------- | ----------------- |
| `EV001` | evento expirado, não pode ser ativado        | `eventExpired`    |
| `EV002` | público inexistente, inativo ou lista vazia  | `invalidSegment`  |
| `EV003` | data anterior a hoje                         | `eventDateInPast` |
| `P0002` | não encontrado (`no_data_found`, capturável) | `notFound`        |

**O PostgREST aceita espaço depois de um hint de constraint e não depois de
`!inner`.** `profiles!events_created_by_fkey (id)` funciona;
`event_segment_links!inner (x)` é erro de parse — precisa ser `!inner(x)`.

**`new Date("2026-08-15")` é meia-noite UTC**, que em São Paulo é 21h do dia
anterior. Datas de calendário nunca passam por `Date`: use `formatCalendarDate` e
compare strings ISO, cuja ordem lexicográfica já é a ordem do calendário.

---

## 11. Onde está cada coisa

```
supabase/migrations/20260813000000_create_events.sql       tabelas, RLS, grants, bucket, RPCs
supabase/migrations/20260813000100_seed_event_segments.sql catálogo de públicos
supabase/migrations/20260813000200_fix_event_error_codes.sql  SQLSTATE da classe EV

src/modules/event/event.types.ts    tipos + enums espelhados
src/modules/event/event.rules.ts    effectiveStatus, ordenação, filtros (puro)
src/modules/event/event.schema.ts   Zod + validação de imagem no cliente
src/modules/event/event.labels.ts   textos PT-BR
src/modules/event/event.audience.ts porta de associados, OU, união/dedupe (puro)
src/modules/event/event.chatbot.ts  DTO fechado + regra de visibilidade (puro)

src/lib/events/image.ts             magic bytes (sem dependência)
src/lib/events/storage.ts           bucket, caminho, TTL

src/lib/services/events.ts          leitura + getAvailableEvents
src/lib/services/event-chatbot.ts   a camada que o chatbot consome
src/lib/actions/events.ts           upload, criar, editar, ativar/inativar

src/app/(app)/events/page.tsx              grid
src/app/(app)/events/loading.tsx           esqueleto
src/app/(app)/events/error.tsx             "tentar novamente"
src/app/(app)/events/new/page.tsx          cadastro
src/app/(app)/events/[id]/page.tsx         detalhes + auditoria
src/app/(app)/events/[id]/edit/page.tsx    edição
src/app/(app)/events/event-form.tsx        formulário (cadastro e edição)
src/app/(app)/events/event-image-field.tsx drag & drop + preview
src/app/(app)/events/events-filters.tsx    filtros na URL
src/app/(app)/events/event-status-actions.tsx  ativar/inativar
src/app/(app)/events/event-segments-cell.tsx   "+N" com diálogo
src/app/(app)/events/event-thumbnail.tsx   miniatura com placeholder
src/app/(app)/events/event-badges.ts       variante do selo por status
```

---

## 12. Telas

| Rota                | Quem entra     | O que faz                                           |
| ------------------- | -------------- | --------------------------------------------------- |
| `/events`           | `events.read`  | Grid, filtros, ações                                |
| `/events/new`       | `events.write` | Cadastro                                            |
| `/events/[id]`      | `events.read`  | Detalhes; a auditoria só aparece com `events.write` |
| `/events/[id]/edit` | `events.write` | Edição                                              |

Páginas, e não diálogos: o formulário tem oito campos mais o cartaz e os
públicos. Diálogo continua sendo o padrão para confirmação (ativar/inativar) e
para a lista de públicos na grid.

**A grid tem oito colunas**, não as dez do escopo: "Criado em" e "Atualizado em"
saíram para a tela de detalhes. Com dez, a coluna de ações caía fora da primeira
dobra — e o próprio escopo pede para adaptar ao padrão visual e não criar grid
excessivamente larga.

**Não há paginação**, porque o CRM não tem em módulo nenhum. A leitura usa
`.limit(200)`; o recorte por período vai para o SQL e nome/status ficam em
memória (ver §11 do service). Quando o volume pedir, o caminho é paginar de
verdade — não improvisar aqui.

**Não há sistema de toast.** O CRM usa mensagem inline (`role="status"`), e a
confirmação de "salvo com sucesso" viaja pela URL (`?created=1` / `?updated=1`)
porque a navegação acontece entre duas telas. Inventar um toast para uma
mensagem seria criar um padrão novo só para este módulo.

### Estados

`loading.tsx` e `error.tsx` são os mecanismos do App Router — o esqueleto e o
"tentar novamente" saem de graça, sem estado no cliente. A mensagem crua do erro
**não** vai para a tela (pode conter nome de tabela); vai para o console do
servidor.

### ⚠️ Ao verificar no painel do navegador

Uma tela com `loading.tsx` parece **travada no esqueleto** dentro do painel de
preview. Não está: a aba do painel tem `visibilityState: "hidden"` e nunca
dispara `requestAnimationFrame`, e o React 19 espera um frame de pintura para
trocar o fallback pelo conteúdo já recebido. Em navegador visível funciona.

Para destravar durante uma inspeção:

```js
if (window.$RB?.length) {
  window.$RV(window.$RB);
  window.$RB = [];
}
```

### Proteção contra perda de rascunho

O formulário registra `beforeunload` quando há alterações não salvas. **Limite
honesto:** isso cobre fechar a aba, recarregar e sair do app. NÃO intercepta
navegação interna do App Router, que não expõe gancho para bloquear rota —
clicar num item do menu ainda perde o rascunho.

---

## 13. Volume: o teto de leitura e onde ele dói

Não há paginação server-side — em nenhum módulo do CRM. A grid lê com teto e
avisa quando bate nele.

| Constante                 | Valor | Onde                 | Para quê                                     |
| ------------------------- | ----- | -------------------- | -------------------------------------------- |
| `SIDE_LIMIT`              | 100   | `listEvents`         | Por lado: próximos e passados, separadamente |
| `SEGMENT_SCAN_LIMIT`      | 200   | `getAvailableEvents` | Varredura ao filtrar por público             |
| `MAX_CHATBOT_EVENT_LIMIT` | 50    | `event.chatbot.ts`   | Teto rígido do que o bot devolve             |

**Por lado, e não um teto único.** Uma leitura só, ordenada por data crescente,
guardaria os 100 eventos **mais antigos** — numa agenda com histórico isso
esconderia justamente os próximos, que é para o que a tela existe. Lendo os dois
lados de "hoje" em ordens opostas, o que sobra é sempre a vizinhança de hoje.

Nome e status são filtrados **em memória**, depois da leitura: `ilike` no
Postgres é sensível a acento e ninguém digita "Câmara" com circunflexo, e o
status exibido é derivado (não é coluna). Consequência: com a leitura cheia, a
busca por nome pode não alcançar tudo — por isso `listEvents` devolve
`truncated` e a grid mostra o aviso. Sem ele, procurar um evento que existe mas
ficou fora da leitura devolveria "nenhum evento encontrado", e a pessoa
concluiria que ele não está cadastrado.

Quando passar disso, o caminho é paginação server-side + coluna de busca
normalizada com índice — para o CRM inteiro, não só para eventos.

### Por que o filtro de público é em memória

Os públicos já vêm no mesmo `select` (`links:event_segment_links(...)`), então
filtrar por eles não custa consulta nenhuma. A alternativa — perguntar antes
"quais eventos têm estes públicos?" e mandar os ids num `in(...)` — **não tem
teto**: devolve todo evento já vinculado àqueles públicos, inclusive passados e
inativos, e a lista inteira vira query string. Algumas centenas de eventos já
produzem uma URL de dezenas de kB, que falha de uma vez em vez de degradar.

O recorte pelo `limit` acontece **antes** de assinar as URLs de imagem: assinar
a varredura inteira para devolver dez eventos seria pagar vinte vezes pelo que
se usa.

---

## 14. Deploy

**Variáveis de ambiente:** nenhuma nova. O módulo usa as que já existem
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Não há token de
WhatsApp, chave de API nem segredo próprio — e não deve haver: o `service_role`
nunca vai ao frontend.

**Migrations, nesta ordem:**

```
20260813000000_create_events.sql        tabelas, RLS, grants, bucket, RPCs
20260813000100_seed_event_segments.sql  catálogo de públicos
20260813000200_fix_event_error_codes.sql  SQLSTATE da classe EV
```

⚠️ A `000200` **precisa** ser aplicada junto: sem ela, "Público-alvo inválido."
usa `P0004` (`assert_failure`), que `exception when others` não captura — o erro
atravessa qualquer tratamento e derruba a transação. O cabeçalho da `000000`
ainda cita os códigos antigos (`P0003`/`P0004`/`P0005`); ele foi deixado como
está porque migration aplicada não se reescreve. **Os códigos que valem são os
da `000200`.**

**Storage:** a migration cria o bucket `events` (privado, 5 MB,
`image/jpeg|png|webp`) com `on conflict do nothing`. Em banco que já o tenha,
confira à mão que `public = false`.

**Jobs:** nenhum. A expiração é derivada — ver a seção 1.

**Depois de aplicar:** `pnpm db:types`.

### Rollback

Os passos estão no fim de cada migration, na ordem das dependências. Dois
pontos que costumam morder:

- **esvazie o bucket antes** de apagar a linha em `storage.buckets`, senão o
  delete falha;
- o Supabase recusa `delete from storage.objects` direto ("Use the Storage API
  instead") — use a API de Storage para os arquivos e SQL só para as linhas.

Nenhuma tabela de outro módulo é tocada por estas migrations, então o rollback
não afeta Documentos, Atendimento nem Chat.

### Ambientes

Não há `localhost` nem URL fixa no código do módulo — o cliente Supabase sai de
`@/lib/supabase/{server,client}`, que leem o ambiente. Não há feature flag, e
não foi criada uma: o projeto não tem infraestrutura de flags, e criar a
primeira só para este módulo seria inventar um mecanismo para mantê-lo.

---

## 15. Pendências conhecidas

O que a validação final encontrou e **não** corrigiu, com o motivo. Nada aqui é
bloqueante para o escopo aprovado.

| #   | Grau     | O quê                                                                                       |
| --- | -------- | ------------------------------------------------------------------------------------------- |
| 1   | MÉDIO    | Apagar um perfil apaga a **autoria** da trilha (`actor_id ... on delete set null`)          |
| 2   | MÉDIO    | Sem paginação server-side (vale para o CRM inteiro)                                         |
| 3   | MELHORIA | Sem _optimistic locking_: duas edições simultâneas — a última vence, em silêncio            |
| 4   | MELHORIA | Sem testes E2E: o projeto não tem Playwright/Cypress                                        |
| 5   | MELHORIA | Sem observabilidade: o projeto não tem Sentry/Datadog; erros vão para o console do servidor |
| 6   | BAIXO    | `inspectImage` prova o **cabeçalho**, não o arquivo inteiro: um PNG truncado passa          |

**(1)** é o mais relevante e **não é do módulo Evento**: `document_audit_logs`
tem exatamente a mesma FK. A ação e o carimbo sobrevivem; o autor vira
"Usuário removido". Corrigir só aqui deixaria os dois módulos com trilhas de
confiabilidade diferente — a correção certa (gravar o nome do autor no
`metadata`, ou trocar a FK) é uma migration única para os dois. Hoje o app não
expõe caminho para excluir perfil, então o risco é potencial.

**(3)** o lock consultivo (`lock_event`) **serializa** as edições concorrentes,
então nunca há escrita parcial nem diff mentiroso na auditoria — o que falta é
avisar a segunda pessoa de que o dado mudou embaixo dela. §44 do escopo permite
registrar como melhoria quando o projeto não tem o mecanismo, e não tem.

**(4)** e **(5)** exigiriam dependência nova. As decisões de tela estão cobertas
por testes de componente (Testing Library), e as regras de banco foram
verificadas contra o banco real em transações revertidas.

### GAPs de negócio — decisões que ainda não foram tomadas

Nenhuma delas está implementada, e nenhuma deve ser sem decisão explícita:

- evento **online** — hoje "Online" é só um texto no campo Local; não há link de
  transmissão, e o DTO do chatbot não finge que há;
- **descrição** do evento — não existe campo;
- **mais de um local**, **recorrência**, **vagas**, **inscrição dentro do CRM**,
  **confirmação**, **lembrete**, **cancelamento** — nada disso existe;
- a inscrição hoje é um **link externo** (`registration_url`), opcional;
- **http** é aceito além de https (o CHECK permite os dois). Se a APCS quiser só
  https, é um caractere na constraint — mas é decisão de negócio.
