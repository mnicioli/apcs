# Documentos

Como funciona o módulo de gestão documental — o que guarda os documentos
oficiais da APCS e responde qual arquivo é o vigente hoje.

---

## Três conceitos

Não confunda, porque quase todo erro no módulo vem daqui:

|               | O que é                                                                | Onde vive                |
| ------------- | ---------------------------------------------------------------------- | ------------------------ |
| **Categoria** | O submenu: Normativas, Comunicação. Define a tela e os textos dela.    | enum `document_category` |
| **Documento** | O cadastro lógico: "Selo Suíno Paulista", "Revista". Um por documento. | `documents`              |
| **Versão**    | Cada arquivo enviado: v1, v2, v3. Imutável depois de criada.           | `document_versions`      |

Um upload novo **não duplica o documento** — cria uma versão dele.

### As categorias hoje

```
Documentos
├── Normativas    Câmara Ambiental · Câmara Setorial · Selo Suíno Paulista
└── Comunicação   ISP · Revista · Calendário Anual · Custo de Produção
```

Os documentos são **linhas no banco**, não código: a tela tem um botão para
cadastrar outros sem deploy. As categorias, sim, são código — cada uma precisa de
um item de menu e dos textos próprios.

### Acrescentar uma categoria

Uma rota só (`/documents/[category]`) serve todas. Para somar Procedimentos ou
Manuais:

1. **duas** migrations: uma com `alter type ... add value`, outra com o seed
   (o Postgres não deixa usar um valor de enum na transação em que ele foi criado);
2. `pnpm db:types`;
3. o valor em `DOCUMENT_CATEGORIES` (`document.types.ts`);
4. o slug em `DOCUMENT_CATEGORY_SLUGS` (`document.routes.ts`);
5. os textos em `DOCUMENT_CATEGORY_COPY` (`document.labels.ts`);
6. o item em `config/navigation.ts`.

Os passos 3–5 são `Record<DocumentCategory, …>`: o TypeScript **cobra** cada um.
Nenhuma tabela, policy, grant ou tela nova.

> O slug faz parte do endereço público — `normatives` já está em links salvos.
> Por isso o mapa é explícito, e não derivado do nome da categoria.

---

## A regra que sustenta tudo

**No máximo uma versão ativa por documento.**

Isso não é uma verificação na tela nem na Server Action. É um índice:

```sql
create unique index document_versions_one_active_idx
  on public.document_versions (document_id) where status = 'active';
```

Duas pessoas ativando versões diferentes ao mesmo tempo não conseguem furar isso:
a segunda transação aborta. As telas podem ter bugs; esta regra não pode falhar.

**Um documento pode ficar SEM versão ativa** — é um estado válido. Significa que
não há arquivo oficial publicado, e o chatbot deve encaminhar para uma pessoa.

---

## Numeração

`nova versão = maior versão existente + 1`. Nunca "quantidade + 1", nunca
"última ativa + 1".

Versões nunca são apagadas, então o maior número já usado é a memória da
sequência. A consequência importante:

```
v1, v2, v3 existem · v3 ativa
  → reativa a v1 (v3 sai do ar)
  → próximo upload gera v4, não v2
```

Reativar não devolve um número ao estoque. `nextVersionNumber` em
[`document.rules.ts`](../src/modules/document/document.rules.ts) espelha o que a
função `create_document_version` faz no Postgres, e existe para esse
comportamento poder ser testado sem banco.

---

## Por que três operações vivem no banco

`create_document_version`, `activate_document_version` e
`deactivate_document_version` são funções plpgsql, e não código TypeScript.

Cada uma mexe em duas linhas mais a auditoria, e não pode existir — nem por um
instante — um estado com duas versões ativas. O `supabase-js` não faz transação
de várias chamadas, então isso precisa ser uma unidade no Postgres.

Duas coisas dentro delas que parecem detalhe e não são:

- **Um lock consultivo por documento** (`lock_document`). Sem ele, dois uploads
  simultâneos leem o mesmo `max(version)` e disputam o mesmo número.
- **A ordem: inativar antes de ativar.** O índice único parcial é verificado ao
  fim de cada statement. Inverter a ordem levanta `unique_violation`.

São `SECURITY INVOKER`: a RLS e os grants de coluna continuam valendo dentro
delas.

---

## O upload é em três tempos (e por quê)

**A Vercel corta o corpo de qualquer requisição serverless em 4,5 MB.** O limite
do módulo é 5 MB. Um PDF de 5 MB **não passa** por Server Action nem por Route
Handler — não é configuração, é limite de plataforma.

```
1. requestDocumentUploadAction()  →  confere permissão, devolve URL assinada
2. navegador → Supabase Storage   →  o arquivo vai DIRETO, sem passar pela Vercel
3. createDocumentVersionAction()  →  servidor BAIXA o objeto, valida, publica
```

A consequência: **a validação de conteúdo acontece depois do upload físico**. Por
isso todo caminho de recusa apaga o objeto — arquivo no bucket sem linha em
`document_versions` é lixo que ninguém referencia.

> ⚠️ Testar upload grande **só localmente não prova nada**: o teto de 4,5 MB não
> existe em `pnpm dev`. Um PDF de ~4,9 MB precisa ser testado em produção.

---

## Validação do arquivo

Quatro barreiras independentes, de fora para dentro:

| Onde                          | O que checa                                                 |
| ----------------------------- | ----------------------------------------------------------- |
| Dropzone (cliente)            | extensão e tamanho — só UX, mente-se facilmente             |
| `requestDocumentUploadAction` | extensão e tamanho, antes de gastar o upload                |
| Bucket `documents`            | `file_size_limit` e `allowed_mime_types` no próprio Storage |
| `createDocumentVersionAction` | **abre o arquivo**: `%PDF-`, `pdf-lib`, senha, tamanho real |

A última é a única que vale de verdade — extensão e MIME são informados por quem
envia, e renomear um `.docx` para `.pdf` engana os dois.

Dois detalhes de [`pdf.ts`](../src/lib/documents/pdf.ts) que foram medidos, não
lidos na documentação da biblioteca:

- **`instanceof EncryptedPDFError` devolve `false`** no pdf-lib 1.17 — o que
  `load()` lança é um `Error` comum. Por isso a detecção de senha é feita nos
  bytes (`/Encrypt` no trailer), e o tipo do erro é só plano B.
- **`%PDF-1.7` seguido de lixo CARREGA sem erro.** Só estoura ao pedir
  `getPageCount()`. Se alguém remover essa chamada, arquivo sujo vira documento
  oficial.

PDF de texto e PDF escaneado são os dois aceitos: a checagem é estrutural. OCR é
problema do pipeline do chatbot.

---

## Acesso ao arquivo

Bucket **privado**. Nenhum acesso direto.

`getDocumentVersionUrlAction` confere a permissão, resolve o caminho no bucket
(que o navegador nunca vê) e emite uma URL assinada de **5 minutos**. O caminho é
`<document_id>/<uuid>.pdf` — o nome enviado pela pessoa fica só como metadado, o
que elimina traversal e colisão de nomes.

---

## Permissões

| Ação                                      | `admin` | `ceo` | `comercial` |
| ----------------------------------------- | :-----: | :---: | :---------: |
| Visualizar, histórico, download           |   ✅    |  ✅   |     ✅      |
| Upload, criar documento, ativar, inativar |   ✅    |  ✅   |     ❌      |

> **Nota sobre papéis:** o escopo original fala em Administrador / Gestor /
> Atendente. O enum `app_role` não tem esses nomes, então o mapeamento é
> `admin` → Administrador, `ceo` → Gestor, `comercial` → Atendente. Trocar o enum
> para a nomenclatura da APCS é uma tarefa separada, que mexe em toda a matriz
> de permissões.

**A permissão é uma só para todas as categorias.** Quem publica normativa publica
Comunicação também. Se um dia marketing precisar cuidar da Revista sem tocar em
normativa, isso exige permissão nova (`communications.write`) e policies RLS
filtrando por categoria — hoje as policies são sobre a TABELA, e é por isso que
Comunicação nasceu com o mesmo controle de acesso sem nenhuma migration.

Três camadas independentes, todas verificadas contra o banco:

1. `assertPermission` na action
2. Policy RLS + **grant de coluna** na tabela
3. `raise ... errcode 42501` dentro da função

O grant de coluna é o que torna a imutabilidade estrutural: **nem o admin**
consegue reescrever `storage_path`, apagar uma versão ou alterar a trilha de
auditoria.

---

## Auditoria

`document_audit_logs` só aceita INSERT — sem policy de update/delete, e com
`revoke update, delete`. A trilha não se reescreve.

Os eventos de versão são gravados **dentro da mesma transação** da operação, então
não existe estado onde a versão mudou e o log não registrou.

**Limite honesto:** `version_viewed` e `version_downloaded` registram a EMISSÃO da
URL assinada, não cada abertura do arquivo. Quem guardar o link reabre dentro dos
5 minutos sem gerar novo evento.

---

## A porta do chatbot

```ts
// src/lib/services/documents.ts
getActiveChatbotVersion(documentId): Promise<DocumentVersion | null>
```

Filtra `status = 'active' AND available_for_chatbot = true`. **Não existe caminho
que devolva "a mais recente" ou "a de maior número"** — citar um documento
revogado é pior do que não responder.

O chatbot pergunta por NOME, não por uuid — ele não conhece (nem deve conhecer)
os ids do banco. Para isso existe a variante:

```ts
getActiveChatbotVersionByName(category, name): Promise<DocumentVersion | null>
```

`null` **não** significa "use a anterior". Significa que não há arquivo oficial,
e o atendimento deve ir para uma pessoa (`contentKey: "handoff"`).

**Ainda não está ligada ao motor do chat.** Hoje todo texto do bot sai do catálogo
aprovado em `src/modules/chat/flows/csp.content.ts`, sem etapa de recuperação de
documento. Quando essa etapa existir:

- ela roda anônima, com `service_role` — a consulta precisa continuar sendo esta,
  para as duas entradas não divergirem;
- `null` tem que levar ao encaminhamento humano, nunca a um documento antigo.

---

## No MVP, "disponível para chatbot" é espelho do status

`available_for_chatbot = (status = 'active')` é um CHECK na tabela. A coluna
existe separada para o dia em que a decisão for manual — e **esse CHECK é
exatamente o que precisa cair naquele dia**.

---

## Mexendo no módulo

- Schema só por migration (`/new-migration`), depois **`pnpm db:types`**.
- Mudou permissão? Mude na matriz **e** na policy — as duas contam a mesma história.
- Regra de negócio nova sobre versões: pense primeiro se ela cabe no banco.
  A tela pode ter bug; a constraint não.
