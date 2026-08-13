# Bolsa — os boletins de preço da APCS

Guia do módulo. Leia antes de mexer em qualquer coisa que envolva publicação de
boletim.

> **Nome:** o negócio diz **Bolsa**; o código diz `market_bulletin`. É a mesma
> tradução que `documents` faz de "normativa", e o roadmap já tinha registrado o
> termo em inglês ao chamar este fluxo de `/flows/market` (ROADMAP #27). Regra do
> CLAUDE.md: código em inglês, tela em PT-BR.

---

## 1. O que é

Uma **Bolsa** é um boletim de preços que a APCS publica periodicamente. Hoje
existe uma — a **Bolsa de Suínos** —, mas nada na estrutura sabe disso: "Bolsa de
Aves" entra como **linha**, nunca como migration. Nenhuma regra do módulo cita
suínos.

Cada publicação é um **par indivisível**: uma imagem (o card que circula) e um
PDF (o boletim completo). Os dois representam a MESMA publicação, sempre.

```
Bolsa de Suínos
├── Bolsa_01Jul26   imagem + PDF     inativa (substituída)
├── Bolsa_01Ago26   imagem + PDF     inativa (substituída)
└── Bolsa_12Ago26   imagem + PDF     ATIVA
```

---

## 2. Bolsa ≠ publicação

Duas tabelas, e confundi-las é o erro fácil:

| Conceito                | Tabela                     | O que é                                       |
| ----------------------- | -------------------------- | --------------------------------------------- |
| **Bolsa**               | `market_bulletins`         | O cadastro lógico. Um por bolsa, para sempre. |
| **Publicação** (versão) | `market_bulletin_versions` | Um par imagem+PDF. Imutável depois de criada. |

Um novo upload **cria uma publicação**, nunca duplica a Bolsa.

---

## 3. Por que não virou uma categoria de `documents`

A gestão documental já tem categoria, versão, status, vigência, bucket e trilha.
Acrescentar `'bolsa'` ao enum `document_category` seria o caminho óbvio — e foi
descartado por um motivo técnico concreto, não estético:

**Uma publicação da Bolsa exige DOIS arquivos, e um CHECK do Postgres não
consegue consultar outra tabela.**

Dentro de `document_versions`, a regra "Bolsa tem imagem obrigatória" precisaria
ler a categoria em `documents`. Isso só sairia com trigger ou com a categoria
desnormalizada na tabela filha. Em tabela própria, a mesma regra é `not null`.

Estrutural x procedural foi o critério — o mesmo que este projeto já aplicou ao
pôr "só uma versão ativa" num índice único parcial em vez de na aplicação.

**O que é compartilhado continua compartilhado:**

| Compartilhado                   | Onde                          | Quem usa          |
| ------------------------------- | ----------------------------- | ----------------- |
| Validação de PDF (bytes, senha) | `src/lib/files/pdf.ts`        | Documentos, Bolsa |
| Validação de imagem (bytes)     | `src/lib/files/image.ts`      | Eventos, Bolsa    |
| "Hoje" no fuso da APCS          | `public.event_today()`        | Eventos, Bolsa    |
| Padrão service/action           | `docs/SERVICE-ACTION-PATTERN` | Todos             |
| Papéis e matriz de permissão    | `src/lib/rbac/`               | Todos             |

O que **não** é compartilhado, e por quê: bucket (o de `documents` declara
`allowed_mime_types = ['application/pdf']`, e abrir para imagens afrouxaria uma
garantia das normativas) e tabela de auditoria (as FKs de
`document_audit_logs` apontam para `documents`; não há como reaproveitá-las).

---

## 4. ATIVA ≠ VIGENTE

**A distinção mais importante do módulo.**

| Conceito    | Como se apura            | Onde mora            |
| ----------- | ------------------------ | -------------------- |
| **Ativa**   | `status = 'active'`      | Coluna. Gravada.     |
| **Vigente** | `effective_date <= hoje` | **Conta.** Derivada. |

Uma publicação enviada dia 12 para valer dia 15 fica **ATIVA e ainda NÃO
VIGENTE**. Ela é a publicação oficial, e mesmo assim o chatbot não pode citá-la.

A tela mostra a combinação, não as duas colunas cruas:

| Situação       | Significa                                         |
| -------------- | ------------------------------------------------- |
| **Vigente**    | Ativa e já valendo. É esta que o chatbot entrega. |
| **Programada** | Ativa, mas a vigência só chega depois.            |
| **Histórica**  | Inativa. Fica no acervo e pode ser reativada.     |

`versionSituation()` em `market.rules.ts` é quem faz essa leitura.

---

## 5. Nome da publicação: `Bolsa_12Ago26`

A identidade **funcional** de uma publicação. Regras:

- **A data é a de HOJE, não a vigência.** Publicou dia 12 para valer dia 15?
  Chama-se `Bolsa_12Ago26`.
- **O sistema decide, não o usuário.** O nome do arquivo enviado (`bolsa.pdf`,
  `bolsa-final-v2.pdf`) é guardado só como metadado.
- **Fuso da APCS.** A data vem de `public.event_today()`, não do relógio do
  servidor.
- **Dois envios no mesmo dia não se sobrescrevem:** o segundo vira
  `Bolsa_12Ago26-2`, o terceiro `-3`. O histórico nunca perde nada.

Os meses vêm de uma lista explícita (`Jan Fev Mar Abr Mai Jun Jul Ago Set Out Nov
Dez`) tanto no Postgres quanto no TypeScript — `to_char(..., 'Mon')` respeitaria o
`lc_time` do servidor e devolveria "Aug".

**Além do nome funcional, cada publicação tem:**

- um **UUID** (a chave técnica — é ele que dois envios no mesmo dia separam);
- um **número de sequência** (`version`: 1, 2, 3…), que nunca é reutilizado. É
  por isso que reativar a v1 quando existem v1..v3 ainda faz a próxima ser a v4.

---

## 6. As regras de estado

### Só uma publicação ativa

Garantido pelo índice único parcial `mb_versions_one_active_idx`. Não é promessa
da aplicação — é propriedade do banco, e duas telas concorrentes não furam.

**É também o que dispensa a coluna `active_version_id`** no cadastro. Com no
máximo uma linha ativa, "a publicação oficial" é uma consulta sem ambiguidade;
uma coluna espelho seria uma cópia que pode sair de sincronia — exatamente o que
o módulo de Eventos evitou ao derivar a expiração em vez de gravá-la.

### A Bolsa nunca fica sem publicação ativa

⚠️ **Aqui a Bolsa se separa das normativas.** Uma normativa pode ficar sem versão
ativa (e o chatbot encaminha para atendimento humano). A Bolsa, não.

Como só existe uma ativa por vez, inativar "a ativa" é exatamente o que deixaria
a Bolsa vazia — então essa chamada é **recusada, sempre** (erro `MB001`).

**Consequência intencional:** trocar a publicação oficial se faz **ativando a
outra**, não inativando a atual. Ativar já inativa a anterior na mesma transação.

> Ver a pendência **P1** na seção 12 — isto torna "Inativar" uma operação que
> nunca conclui, e é uma contradição do escopo que precisa de decisão do negócio.

### Idempotência

Ativar o que já está ativo não muda nada e **não inventa evento na trilha**.
Inativar o que já está inativo idem. Chamar duas vezes tem o efeito de chamar uma.

---

## 7. O chatbot

**A regra oficial de disponibilidade — as três condições, e nenhuma a menos:**

1. a Bolsa permite consumo por robô (`chatbot_enabled = true`);
2. a publicação é a **ATIVA**;
3. a **vigência já chegou** (`effective_date <= hoje`).

`chatbot_enabled` mora na **Bolsa**, não na publicação: a decisão "esta Bolsa
pode ser citada por robô" é sobre a Bolsa. Na publicação, cada upload obrigaria
alguém a reafirmar a mesma escolha, e o dia em que esquecessem o chatbot mudaria
de comportamento sozinho.

⚠️ **`null` NÃO significa "use a anterior".** Significa que não há boletim oficial
disponível agora, e o atendimento vai para uma pessoa. Não existe fallback
automático — um boletim de **preço** desatualizado citado como se fosse o vigente
é pior do que "não tenho essa informação agora".

**O DTO** (`MarketBulletinChatbotView`) tem seis campos: `bulletinId`, `name`,
`versionName`, `effectiveDate`, `imageUrl`, `pdfUrl`. Nada de quem publicou,
quando, número de sequência ou status. Devolver a entidade inteira transformaria
cada campo novo do cadastro em vazamento automático para fora da empresa.

**O chatbot é READ-ONLY.** Não existe caminho que o deixe publicar, ativar ou
inativar.

> ⚠️ **Ainda não está ligado ao motor do chat**, e isso é deliberado: hoje todo
> texto do bot sai do catálogo aprovado em `csp.content.ts`. Quando a etapa de
> consulta existir, ela roda **anônima** (`/api/chat` é público e a RLS exige
> papel autenticado), então precisará de um cliente `service_role` no servidor —
> e tem de entrar por `market-chatbot.ts`. Uma segunda consulta em outro lugar é
> como as duas entradas divergem no dia em que a regra mudar.

---

## 8. Arquivos

|             | Imagem                        | PDF         |
| ----------- | ----------------------------- | ----------- |
| Formatos    | JPG, JPEG, PNG, WEBP          | PDF         |
| Limite      | 5 MB (5 MB exatos **passam**) | 5 MB (idem) |
| Obrigatório | Sim                           | Sim         |

**Recusados:** GIF, BMP, TIFF, SVG (é XML, aceita `<script>`, e servido de um
bucket vira execução no navegador de quem abrir), DOC/DOCX/XLS/XLSX/PPT/PPTX/
TXT/ZIP, e **PDF protegido por senha**.

**PDF escaneado é aceito** — a checagem é estrutural, não de conteúdo. OCR é
problema do pipeline do chatbot, não deste módulo.

### Quatro barreiras por arquivo

1. o formulário (extensão + MIME declarado + tamanho);
2. a action, **sobre os bytes que chegaram** (`inspectImage` / `inspectPdf`);
3. o `file_size_limit` e `allowed_mime_types` do bucket;
4. os CHECKs da tabela.

Se uma for contornada, as outras seguem de pé. A validação por **bytes** é a que
importa: renomear `planilha.xlsx` para `bolsa.pdf` engana extensão e MIME, mas
não o cabeçalho do arquivo.

### Onde os arquivos moram

```
market-bulletins/                        (bucket PRIVADO)
└── <bulletin_id>/
    └── <version_id>/
        ├── image/<uuid>.jpg
        └── pdf/<uuid>.pdf
```

O nome enviado **não entra no caminho** — mata traversal por `../`, colisão entre
dois "bolsa.pdf" e caractere que o storage não aceita.

**A pasta da versão é o que amarra o par**, e os CHECKs
`mb_versions_image_path_scope` / `mb_versions_pdf_path_scope` provam isso no
banco: não dá para gravar uma publicação apontando para o arquivo de outra.

O acesso é **sempre** por URL assinada de vida curta, emitida por uma action que
já checou a permissão. Imagem: 1 h (a grid emite na renderização, e uma lista
aberta durante o almoço viraria tela de imagens quebradas). PDF: 5 min.

---

## 9. Permissões

| Ação                      | Administrador | Gestor | Atendente |
| ------------------------- | :-----------: | :----: | :-------: |
| Visualizar                |      ✅       |   ✅   |    ✅     |
| Baixar / abrir PDF        |      ✅       |   ✅   |    ✅     |
| Publicar                  |      ✅       |   ✅   |    ❌     |
| Ativar / reativar         |      ✅       |   ✅   |    ❌     |
| Inativar                  |      ✅       |   ✅   |    ❌     |
| Ver a trilha de auditoria |      ✅       |   ✅   |    ❌     |

`market.read` → `admin`, `ceo`, `comercial`
`market.write` → `admin`, `ceo`

**Duas camadas que contam a mesma história:** a matriz em `rbac.config.ts` e a
RLS no banco. Um Atendente que chamar a RPC direto recebe `42501` → "Você não tem
permissão para esta ação".

A trilha é **mais estreita que a leitura**: o Atendente consulta e baixa o
boletim, mas o histórico de quem publicou o quê não é dele. Ele ainda assim
**grava** "abri"/"baixei" — insert sem select.

**Chave própria (`market.*`) e não `documents.*`** mesmo com a mesma lista de
papéis: são decisões de negócio distintas, e restringir quem publica a Bolsa não
pode mexer em quem publica normativa.

---

## 10. Auditoria

Sete ações: `bulletin_created`, `bulletin_updated`, `version_uploaded`,
`version_activated`, `version_deactivated`, `version_viewed`,
`version_downloaded`.

`version_activated` cobre **ativar e reativar**: no dado são a mesma transição, e
inventar uma ação só para dizer que a versão já estivera ativa antes obrigaria a
trilha a manter uma memória que ela não tem.

Não existe `update_bolsa_segmentation` — a Bolsa não tem segmentação neste
escopo.

**O nome de quem agiu é congelado** em `metadata.actor_name`. A FK `actor_id` é
`on delete set null`, então sem isso o histórico perderia o autor no dia em que
um perfil saísse. Custa uma leitura por chave primária e responde "quem fez isso?"
para sempre.

**A trilha não se reescreve nem se apaga** — sem policy de update/delete, e com
`revoke` explícito.

**Limite honesto:** o que fica registrado em view/download é a **emissão da URL**,
não cada leitura. Quem guardar o link reabre dentro da validade sem gerar novo
evento — é o TTL curto que limita essa janela, não a auditoria.

**Nada de exclusão física.** Publicação enviada por engano se resolve publicando
outra. O histórico é o produto.

---

## 11. Onde está cada coisa

| Camada                  | Arquivo                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| Banco                   | `supabase/migrations/20260814000000_create_market_bulletins.sql` |
| Tipos de domínio        | `src/modules/market/market.types.ts`                             |
| Regras puras            | `src/modules/market/market.rules.ts`                             |
| Contratos (Zod)         | `src/modules/market/market.schema.ts`                            |
| Rótulos PT-BR           | `src/modules/market/market.labels.ts`                            |
| Rotas                   | `src/modules/market/market.routes.ts`                            |
| Leitura                 | `src/lib/services/market-bulletins.ts`                           |
| Porta do chatbot        | `src/lib/services/market-chatbot.ts`                             |
| Escrita                 | `src/lib/actions/market-bulletins.ts`                            |
| Endereçamento no bucket | `src/lib/market/storage.ts`                                      |
| Telas                   | `src/app/(app)/market/`                                          |
| Item de menu            | `src/config/navigation.ts` (seção Documentos)                    |

**Não existem endpoints REST** — o projeto usa Server Components + Server
Actions, e criar rotas HTTP só para este módulo seria a arquitetura paralela que
o CLAUDE.md proíbe. O contrato de escrita são as actions:

| Operação conceitual                    | Action                         |
| -------------------------------------- | ------------------------------ |
| `POST /bolsas`                         | `createBulletinAction`         |
| `PUT /bolsas/:id`                      | `updateBulletinAction`         |
| `POST /bolsas/:id/versions` (passo 1)  | `requestBulletinUploadAction`  |
| `POST /bolsas/:id/versions` (passo 2)  | `createBulletinVersionAction`  |
| `POST .../activate` e `.../inactivate` | `setVersionStatusAction`       |
| download / viewer                      | `getBulletinFileUrlAction`     |
| `GET /bolsas`, `GET /bolsas/:id`       | `listBulletins`, `getBulletin` |
| `GET /bolsas/:id/chatbot`              | `getBulletinForChatbot`        |

**O upload é em dois passos** porque a Vercel corta o corpo de requisição
serverless em 4,5 MB e o limite do módulo é 5 MB — um PDF de 5 MB simplesmente
não chega por Server Action. O navegador envia direto ao Storage com uma URL
assinada; o que trafega pela action são algumas centenas de bytes.

**Falha no meio não deixa rastro:** se qualquer um dos dois arquivos for
reprovado, **nenhum** entra e os dois saem do bucket.

### Códigos de erro

| Código  | Significa                                      |
| ------- | ---------------------------------------------- |
| `42501` | sem permissão                                  |
| `P0002` | Bolsa ou publicação não encontrada             |
| `MB001` | inativar deixaria a Bolsa sem publicação ativa |
| `MB002` | a publicação não pertence a esta Bolsa         |

A classe `MB` é própria pelo mesmo motivo da `EV` de Eventos: a classe `P0` é
**reservada** pelo PL/pgSQL (P0004 é `assert_failure`, que
`exception when others` não captura).

---

## 12. Pendências e decisões do negócio

### P1 — CONTRADIÇÃO: "Inativar" nunca conclui ⚠️

O escopo dá a Administrador e Gestor a permissão de **inativar** (§51) e, no
parágrafo seguinte (§34), manda **recusar** a inativação da única publicação
ativa. Como só existe uma ativa por vez, as duas regras juntas significam que
**inativar nunca tem efeito**: na ativa é recusado, na inativa é no-op.

**O que foi feito:** §34 implementado ao pé da letra — é a regra explícita, com
mensagem de erro definida no próprio escopo. A permissão continua existindo.

**O que precisa de decisão:** ou "Inativar" some da tela (e a troca se faz só por
"Ativar"), ou passa a significar "inativar esta E ativar aquela", escolhendo a
substituta na mesma operação. A segunda leitura é a que faz o enum
`status_reason = 'manual'` — hoje inalcançável — passar a ser gravado, sem
migration.

**Status em 13/08/2026:** mantido como está, em caráter PROVISÓRIO, para o
PROMPT 2/3 seguir. A validação do negócio ainda não aconteceu.

**Como isso aparece na tela:** não existe botão "Inativar". A publicação ativa
não oferece ação nenhuma no histórico, e o card acima da tabela explica por
escrito que a troca se faz ATIVANDO a outra. Um botão que sempre falha é pior do
que a ausência dele: a pessoa clica, lê um erro e não descobre o caminho. Se o
negócio decidir a segunda leitura ("inativar esta E ativar aquela"), a mudança é
no `VersionStatusActions`.

### P2 — GAP: valor inicial de `chatbot_enabled`

O escopo (§46) manda **não assumir silenciosamente**. Decisão de MVP tomada e
registrada: uma Bolsa nasce com `chatbot_enabled = true`, porque uma Bolsa existe
para ser divulgada e cadastrar uma que o robô ignora em silêncio é a falha mais
provável de passar despercebida. O campo é editável e aparece no formulário.

**Precisa de confirmação do negócio.** Se a resposta for "nasce desligada", muda
um `.default()` no schema e um `default` na coluna.

**Status em 13/08/2026:** mantido ligado, em caráter PROVISÓRIO. Reverter é
barato — dois defaults —, e o teste
"chatbotEnabled nasce LIGADO quando não informado" em `market.schema.test.ts` é
onde a mudança aparece.

### P3 — GAP: quem publica a Bolsa?

O escopo trata Administrador e Gestor como iguais. Na APCS, publicar boletim de
**preço** pode ser atribuição mais estreita que publicar normativa. Hoje
`market.write` = `admin` + `ceo`, igual a `documents.write`.

**Precisa de decisão.** A chave de permissão já é separada exatamente para essa
mudança custar uma linha.

### P4 — DÉBITO: `event_today()` tem nome de módulo

É o "hoje" de toda a plataforma, mas nasceu em Eventos. A Bolsa a reutiliza — o
certo — e o nome ficou errado. Renomear exige tocar nas funções já implantadas de
Eventos; duplicá-la criaria duas verdades sobre que dia é hoje, que é exatamente
o problema que ela resolve.

### P5 — DÉBITO: terceira tabela de auditoria

`document_audit_logs`, `event_audit_logs` e agora
`market_bulletin_audit_logs`. Cada uma existe porque as FKs apontam para tabelas
diferentes, mas a estrutura é a mesma. Uma trilha unificada (com `entity` +
`entity_id` polimórficos) é o caminho — e é decisão de plataforma, não deste
módulo.

### P6 — LIMITE: arquivos órfãos

A action apaga os objetos em todo caminho de recusa. O que **não** existe é
varredura para o caso de o processo morrer entre o upload e a confirmação: um
arquivo enviado cuja action nunca terminou fica no bucket sem referência. Sem
mecanismo de limpeza no projeto hoje — registrado como GAP técnico.

### P7 — NÃO TESTADO ponta a ponta

A migration e as regras de negócio foram validadas contra o banco real (78 casos,
em transação revertida). As **telas não existem ainda** (PROMPT 2/3), então o
caminho completo — formulário → upload direto ao Storage → confirmação → grid —
ainda não foi exercitado por inteiro. Em particular, o `limit` aninhado em
`getBulletin` e o filtro sobre embed em `getBulletinForChatbot` dependem do
PostgREST resolver o **apelido** do embed; ambos estão escritos na forma
documentada, mas só a tela vai provar.

---

## 13. Volume

Uma Bolsa publicando por semana produz ~52 publicações por ano. Os tetos de
leitura são `LIST_LIMIT = 100` (bolsas) e `VERSION_LIMIT = 500` (histórico de uma
Bolsa) — folga de quase dez anos.

Não há índice por `effective_date` nem por `chatbot_enabled`, e isso é
deliberado: a consulta do chatbot é `bulletin_id = ? and status = 'active'`, que
o índice único parcial resolve em **uma** linha; a vigência é testada sobre essa
linha só. Índice que nenhuma consulta usa é custo de escrita sem retorno.

---

## 14. O que conferir quando for validar

As regras foram exercitadas contra o banco (78 casos) e as puras têm teste
(357 no total). O que **nenhum** dos dois alcança é o caminho de ponta a ponta,
porque as telas só chegam no PROMPT 2/3. Quando for validar com as telas na mão,
estes são os pontos onde uma falha seria silenciosa:

1. **O par sobrevive ao upload real.** Enviar imagem e PDF e conferir que os dois
   caem em `<bolsa>/<publicação>/`. Se o caminho sair diferente, o CHECK recusa —
   falha barulhenta, fácil.
2. **Recusa no meio não deixa lixo.** Enviar um PDF com senha junto de uma imagem
   boa: a publicação tem de ser recusada e **os dois** arquivos sumirem do bucket.
3. **`getBulletin` respeita o limite aninhado.** Depende de o PostgREST resolver o
   APELIDO do embed (`versions.limit`), não o nome da tabela. Errar aqui não dá
   erro — o limite simplesmente não vale.
4. **`getBulletinForChatbot` filtra pelo apelido** (`bulletin.chatbot_enabled`).
   Mesmo risco: desligar o chatbot de uma Bolsa e conferir que ela some da
   resposta. Se continuar aparecendo, é este filtro.
5. **Vigência futura.** Publicar hoje com vigência para daqui a três dias: a
   publicação aparece como **Programada** e o chatbot **não** a entrega.
6. **Dois envios no mesmo dia.** O segundo tem de virar `-2` e o primeiro
   continuar no acervo.
7. **Papel de Atendente.** Entrar como `comercial` e confirmar que vê e baixa, mas
   não publica, não ativa e não vê a trilha.

As decisões **provisórias** a revisitar estão em P1 e P2 da seção 12.

---

## 15. As telas

| Rota           | O que é                                                      |
| -------------- | ------------------------------------------------------------ |
| `/market`      | Grid das bolsas, com a publicação que vale hoje em cada uma. |
| `/market/[id]` | Detalhe, histórico de publicações e trilha de auditoria.     |

A rota é `/market` e não `/documents/bolsa` porque a Bolsa **não** é uma
categoria de `documents` — a rota de categorias resolve o slug contra o enum do
banco e devolveria "não encontrado". No MENU ela aparece sob Documentos, que é
onde as pessoas procuram. O agrupamento é de navegação, não de dados.

**A rota é protegida, não só o menu:** as duas páginas checam `market.read` e
redirecionam para o dashboard. Esconder o item de menu não impede ninguém de
digitar o endereço.

### O que cada papel vê

| Controle                  | Administrador | Gestor | Atendente |
| ------------------------- | :-----------: | :----: | :-------: |
| Nova Bolsa / Editar       |      ✅       |   ✅   |    ❌     |
| Nova versão               |      ✅       |   ✅   |    ❌     |
| Ativar                    |      ✅       |   ✅   |    ❌     |
| Imagem / Ver PDF / Baixar |      ✅       |   ✅   |    ✅     |
| Histórico                 |      ✅       |   ✅   |    ✅     |
| Trilha de auditoria       |      ✅       |   ✅   |    ❌     |

O Atendente **vê todo o dado** — situação, publicação ativa, vigência,
disponibilidade para o chatbot. O que ele não tem é o controle de alterar.

### Decisões de tela que valem registrar

**A coluna "Chatbot" não mostra a coluna do banco.** Mostra o que o ROBÔ
enxerga, que é a conjunção das três condições. Uma Bolsa ligada cuja publicação
só vale semana que vem aparece como "Disponível em 20/08/2026", não como "Sim" —
escrever "Sim" faria alguém prometer ao associado uma resposta que o robô não dá.

**"Situação" no lugar de "Status".** `Vigente` / `Programada` / `Histórica` é a
leitura de status + vigência já combinados. "Ativa" sozinho engana.

**O nome do download é montado no servidor:** `Bolsa_de_Suínos_12Ago26.pdf`. O
atributo `download` da âncora não é usado de propósito — navegadores o ignoram em
URL de outra origem, e quem manda é o `Content-Disposition` que o servidor
assinou. Duas fontes para o mesmo nome divergiriam.

**O upload é em dois passos e os arquivos vão diretos ao Storage**, pelo mesmo
motivo das normativas: a Vercel corta o corpo serverless em 4,5 MB e o limite é
5 MB por arquivo. A tela mostra em que etapa está (imagem, PDF, publicando).

### Gaps de UX registrados

- **Sem sistema de toast.** O projeto não tem um, e criá-lo mudaria o design
  system inteiro. O retorno de sucesso é o diálogo fechar e a grid atualizar
  sozinha (`revalidatePath`), que é o padrão de Documentos e Eventos. Se um dia
  entrar um componente de toast, os três módulos ganham juntos.
- **Sem paginação.** Nenhuma grid do CRM tem — todas leem com teto e filtram em
  memória. Com uma Bolsa publicando por semana, o teto de 100 bolsas e 500
  publicações dá folga de anos. Registrado como pendência de plataforma.
- **Sem barra de progresso em porcentagem.** `uploadToSignedUrl` do supabase-js
  não expõe progresso; mostrar uma barra falsa seria mentira. A tela diz a etapa.
- **Sem confirmação ao sair com formulário preenchido.** Nenhuma tela do CRM tem
  esse comportamento hoje, e criá-lo só aqui seria inconsistente.
