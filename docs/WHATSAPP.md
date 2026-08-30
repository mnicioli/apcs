# WhatsApp — a caixa de entrada do Atendimento

Como a conversa de WhatsApp do número da APCS passou a existir dentro do CRM:
a tela `/whatsapp`, o adaptador da Z-API e as duas tabelas em que tudo desemboca.

---

## 1. O resumo em cinco linhas

- Alguém escreve para o número da APCS. A Z-API avisa o nosso **webhook**.
- A mensagem é gravada em **`whatsapp_messages`**, dentro de uma
  **`whatsapp_chats`** — a conversa.
- O time abre **`/whatsapp`**, lê e responde pela tela.
- A resposta sai pela Z-API e volta como "entregue" e "lida" pelo mesmo webhook.
- **Nada de antes existe aqui.** A caixa começa vazia e se preenche do webhook
  em diante — o histórico antigo continua no celular.

---

## 2. O desenho em uma linha

```
  WhatsApp ──► Z-API ──► /api/webhooks/zapi/<segredo> ──► whatsapp-inbox ──► banco
                                                              │
                                                              └──► survey-inbox
  tela /whatsapp ──► action ──► ZApiProvider.send() ──► Z-API ──► WhatsApp
```

O adaptador da Z-API é **um arquivo** (`src/lib/messaging/providers/z-api.ts`).
A porta de mensageria já existia e foi desenhada para isto: o cabeçalho do
`cloud-api.ts` diz, desde Enquetes, que trocar de fornecedor seria "escrever
OUTRO arquivo como este". Foi o que aconteceu — **nem o disparo de enquetes, nem
o chatbot, nem uma tela mudaram**.

---

## 3. Duas tabelas próprias, e por quê

`chat_conversations` / `chat_messages` são do **chat público da web**:
identificadas por um token de sessão num cookie, com consentimento LGPD aceito
num botão, com `flow_key` dizendo qual roteiro do bot está rodando.

Um chat de WhatsApp não tem nada disso. A pessoa mandou mensagem para um número.
Enfiar os dois na mesma tabela obrigaria `session_token_hash` — a coluna que
IDENTIFICA uma conversa da web — a virar anulável, e ela deixaria de identificar
qualquer coisa.

**`whatsapp_messages` é um livro-razão.** Guarda tudo que entra e sai: o que a
pessoa escreveu, o que o atendente respondeu pelo CRM, o que o bot de enquete
respondeu sozinho e **o que alguém digitou direto no celular**. É por isso que a
ingestão grava primeiro e só depois entrega o evento às Enquetes — na ordem
inversa, uma mensagem consumida pelo fluxo de enquete poderia não aparecer para
o atendente, que veria uma conversa com um buraco no meio sem nada indicando
que há um buraco.

---

## 4. ⚠️ A Z-API não assina os webhooks

A Meta manda `X-Hub-Signature-256` com o HMAC do corpo, e a rota
`/api/webhooks/whatsapp` confere. **A Z-API não manda assinatura nenhuma** — sem
HMAC, sem header secreto, sem campo de verificação. Conferido na documentação
oficial (`webhooks/introduction` e `security/introduction`) antes de escrever o
módulo.

Sem alguma autenticação, o endpoint seria um formulário público capaz de inserir
na caixa de entrada uma frase que um associado nunca disse — indistinguível da
verdadeira, com o nome dele em cima.

A autenticação é o **segredo no caminho da URL**:

```
https://SEU-DOMINIO/api/webhooks/zapi/<APCS_ZAPI_WEBHOOK_SECRET>
```

comparado em tempo constante (`safeCompare`). As consequências práticas:

| Consequência                                                           | Por quê                                               |
| ---------------------------------------------------------------------- | ----------------------------------------------------- |
| **A URL inteira é um segredo**                                         | Ela não vai para print, chamado nem grupo de WhatsApp |
| Trocar o segredo = trocar a variável **e** recadastrar a URL no painel | Não há rotação automática                             |
| O segredo nunca aparece em log                                         | Nem no de erro: registra-se só "segredo inválido"     |
| Segredo errado responde **404**, não 401                               | 401 confirmaria que o caminho existe                  |

Isto é **mais fraco que um HMAC** — um HMAC prova cada corpo; um segredo na URL
prova só quem chamou. É o mais forte que o fornecedor permite.

Por isso `ZApiProvider.verifySignature()` **devolve `false` sempre**: se alguém
apontar a rota genérica da Meta (que confia na assinatura) para este adaptador,
ela recusa em vez de virar um endpoint aberto.

---

## 5. A idempotência, sem tabela de eventos

O fornecedor reentrega o mesmo webhook sempre que não recebe 200 a tempo. É o
caminho normal, não uma anomalia. Enquetes resolveu isso com uma tabela-diário
(`survey_inbound_events`); aqui não foi preciso:

| Evento             | O que impede o efeito duplo                                    |
| ------------------ | -------------------------------------------------------------- |
| Mensagem que chega | `unique (provider, provider_message_id)` — o índice recusa     |
| Entrega / leitura  | UPDATE que **só avança** na escala; aplicar duas vezes é igual |

A escala é `pendente < enviada < entregue < lida`. Sem ela, um `SENT` reentregue
depois do `READ` faria a mensagem lida voltar a "enviada" na tela. `failed` não
está na escala: ele só entra enquanto ninguém confirmou entrega — um "falhou"
atrasado não apaga um "entregue" que já é fato.

Idempotência que sai da **forma** do dado não depende de ninguém lembrar de
consultá-la antes.

---

## 6. A resposta do atendente: grava → manda → liquida

Entre o clique e a resposta do fornecedor existe uma chamada HTTP que pode
demorar 15 segundos, falhar, ou **ter sucesso sem que a resposta volte**.

Por isso são duas funções no banco:

1. `whatsapp_start_outbound_message` — cria a linha em `pending` **antes**;
2. `ZApiProvider.send()`;
3. `whatsapp_settle_outbound_message` — id do fornecedor vira `sent`, ausência
   dele vira `failed` com o motivo.

Se a linha só nascesse depois, uma mensagem **entregue** numa chamada cuja
resposta se perdeu sumiria do CRM — e o atendente a mandaria de novo, para
alguém que já a recebeu. Gravar antes troca "mensagem invisível duplicada" por
"mensagem visível marcada como falha", que é um problema que se enxerga.

O `settle` só age sobre `pending`: o webhook de entrega às vezes chega **antes**
da resposta HTTP do envio, e voltar de `delivered` para `sent` seria a tela
andando para trás.

---

## 7. Permissões

| Papel                   | `whatsapp.read` | `whatsapp.write` |
| ----------------------- | --------------- | ---------------- |
| Administrador (`admin`) | ✅              | ✅               |
| Gestor (`ceo`)          | ✅              | ✅               |
| Atendente (`comercial`) | ✅              | ✅               |
| Demais                  | ❌              | ❌               |

⚠️ **É o único módulo em que a escrita não é mais estreita que a leitura.** Em
Documentos, Eventos, Bolsa, Palestras e Associados o Atendente só lê, porque
publicar uma normativa ou aprovar um associado é decisão de quem responde por
aquilo. Responder a mensagem de um associado no WhatsApp **não é decisão: é o
trabalho do Atendente**. Uma caixa que ele abre e não pode responder não serve
para nada.

As duas listas coincidem hoje e são duas funções assim mesmo
(`whatsapp_is_reader` / `whatsapp_is_writer`) — para que restringir uma, um dia,
não mexa na outra.

**Nenhuma tabela tem policy de escrita.** Quem escreve é função
`security definer`, e só.

---

## 8. Mídia recebida

A Z-API entrega imagem, áudio, vídeo e documento numa URL **hospedada por ela,
que expira**. Guardar só a URL produziria uma caixa que apodrece: as conversas
de dois meses atrás virariam uma parede de anexos quebrados.

O servidor baixa o arquivo e o guarda no bucket privado `whatsapp-media`; a URL
do fornecedor fica registrada só como procedência.

**O download roda depois da resposta HTTP** (`after()` na rota). Um áudio de dois
minutos pode demorar mais do que a Z-API espera pelo 200 — e demora, para ela,
significa "não recebeu": o resultado seria uma reentrega em laço causada
justamente pelas mensagens mais pesadas. A tela mostra "Baixando o arquivo…" por
alguns segundos, que é honesto.

| Estado do anexo | O que a tela diz                                         |
| --------------- | -------------------------------------------------------- |
| `pending`       | "Baixando o arquivo…"                                    |
| `stored`        | Exibe a imagem / o player / o cartão de download         |
| `too_large`     | "Arquivo grande demais para o sistema. Abra no celular." |
| `failed`        | "Não foi possível baixar este arquivo. Abra no celular." |

Teto: **20 MB**, igual ao `file_size_limit` do bucket. Nenhum estado é silêncio —
uma bolha vazia faria o atendente responder a uma foto que ele acha que nunca
chegou.

---

## 9. Detalhes da tela que têm motivo

| Decisão                                 | Por quê                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Estado na URL (`?filtro=&q=&conversa=`) | É uma tela em que o time manda link para o colega o dia todo                                   |
| Trocar de aba fecha a conversa aberta   | Ela quase nunca está na aba nova; ficaria sem linha correspondente                             |
| Altura fixa, rolagem interna            | Com a página rolando, ler uma conversa longa empurra o campo de resposta para fora da tela     |
| Marca como lida **ao abrir**, sem botão | "Lida" quer dizer "alguém do time olhou", e abrir É olhar                                      |
| Iniciais em vez da foto do perfil       | Exibir a foto faria o navegador de cada pessoa buscá-la no CDN do WhatsApp — e as URLs expiram |
| Enter envia, Shift+Enter quebra linha   | Convenção de todo aplicativo de mensagem; quem atende digita rápido                            |
| Atualiza sozinha a cada 15 s (sondagem) | Ver abaixo                                                                                     |

**Por que sondagem e não tempo real.** O Supabase tem Realtime e ele seria mais
elegante, mas não é usado em nenhum lugar deste projeto. Adotá-lo aqui traria a
primeira conexão WebSocket do sistema, um segundo modelo de autorização para
manter em sincronia com a RLS, e reconexão para depurar — tudo para ganhar
segundos numa tela em que a mensagem já demorou o tempo do webhook para chegar.
A sondagem só roda com a aba visível. Trocar por Realtime, quando o volume
justificar, é mexer em `auto-refresh.tsx` e em nenhum outro arquivo.

---

## 10. Configuração

Quatro variáveis, todas secretas (ver `.env.example`):

| Variável                   | Onde achar                                    |
| -------------------------- | --------------------------------------------- |
| `APCS_ZAPI_INSTANCE_ID`    | Painel Z-API > Instâncias                     |
| `APCS_ZAPI_TOKEN`          | O token da instância                          |
| `APCS_ZAPI_CLIENT_TOKEN`   | Token de segurança da **conta** (outro token) |
| `APCS_ZAPI_WEBHOOK_SECRET` | Você inventa. Vira parte da URL do webhook    |

Mais `APCS_WHATSAPP_PROVIDER=z_api`.

⚠️ **O segredo do webhook é obrigatório para o adaptador existir**, mesmo não
sendo usado no envio. Sem ele o envio funcionaria igual e o webhook ficaria de pé
sem autenticação nenhuma. Exigi-lo é o que garante que "configurei a Z-API" e "o
webhook está protegido" sejam a mesma frase.

No painel da Z-API, cadastre a **mesma URL** nos três webhooks (ao receber, ao
enviar, e status da mensagem) — o adaptador distingue pelo campo `type` do corpo.

**Enquanto as variáveis não existirem, nada entra e nada sai** — e a tela diz
isso em cima da caixa, em vez de parecer uma caixa vazia por falta de mensagem.

---

## 11. O que este módulo NÃO faz

Escrito para ninguém procurar:

- **Não importa o histórico.** A caixa começa do zero. A Z-API tem um endpoint
  de lista de conversas, mas ela **não devolve a transcrição** — importar traria
  nomes e uma última mensagem, sem o diálogo.
- **Não envia mídia _pela tela_.** Recebe e exibe; a resposta que o atendente
  digita no CRM é só texto. (O robô manda imagem e PDF, por outro caminho — ver
  o item seguinte.)
- **Não mexe no "lido" do aparelho.** `unread_count` é do CRM e responde "alguém
  do time já olhou isto?". O do celular responde outra coisa.
- **Não tem atribuição nem fila.** Não há "assumir conversa" como na Central de
  Atendimento. As colunas para isso não existem — quando existirem, entram por
  migration.

  ⚠️ Desde `20260915000000_whatsapp_bot.sql` existe uma coisa **menor** e que não
  é atribuição: `bot_paused_until`, a resposta a "o robô deve falar agora?". É
  uma data, não um dono. Quando a atribuição chegar, ela substitui a checagem de
  pausa dentro de `whatsapp_bot_should_answer`.

- **A caixa não responde sozinha — o robô responde, e ela registra.** Desde a
  Etapa 3 da Inteligência, mensagens que sobram do opt-out e das Enquetes vão
  para `intelligence-inbox.ts`, que classifica e responde. Tudo que ele manda
  entra aqui como `origin = 'bot'`, e uma resposta do atendente (ou do celular)
  o cala por uma hora. Ver [INTELIGENCIA.md](./INTELIGENCIA.md), seção 11.

  ⚠️ O robô **não zera** `unread_count`. Ele responder não é o time ter lido — e
  a conversa continua acesa na aba "Não lidas" até alguém abrir.

---

## 12. Códigos de erro

Classe `WA`, mapeada em `src/lib/actions/errors.ts`. Classe própria porque a
`P0` é reservada pelo PL/pgSQL.

| Código  | Significa                                              |
| ------- | ------------------------------------------------------ |
| `42501` | Sem permissão                                          |
| `P0002` | Conversa não encontrada                                |
| `WA002` | Mensagem vazia                                         |
| `WA003` | Mensagem sem identificação de conversa (só no webhook) |

---

## 13. O que foi verificado

| Bateria                    | Onde                                                    | Resultado |
| -------------------------- | ------------------------------------------------------- | --------- |
| SQL (transação desfeita)   | grafo de status, grants, RLS, idempotência, constraints | 40/40     |
| Adaptador Z-API            | `src/lib/messaging/providers/z-api.test.ts`             | 45/45     |
| Rotas, nomes e formatação  | `src/modules/whatsapp/`                                 | 32/32     |
| Action (permissão e ordem) | `src/lib/actions/whatsapp.test.ts`                      | 21/21     |

⚠️ **O adaptador nunca falou com a API real.** Os payloads dos testes são cópias
dos exemplos da documentação oficial e o `fetch` é dublê. Ligar à conta real é o
passo de homologação que depende da APCS: as quatro variáveis preenchidas e a
URL do webhook cadastrada no painel. Ver a seção 10.

---

## 14. Arquivos

| Onde                                                           | O quê                                     |
| -------------------------------------------------------------- | ----------------------------------------- |
| `supabase/migrations/20260822000000_create_whatsapp_inbox.sql` | Tabelas, RLS, funções, bucket             |
| `src/lib/messaging/providers/z-api.ts`                         | O adaptador (envio e tradução do webhook) |
| `src/app/api/webhooks/zapi/[secret]/route.ts`                  | O webhook                                 |
| `src/lib/services/whatsapp-inbox.ts`                           | Ingestão e download de anexo              |
| `src/lib/services/whatsapp.ts`                                 | Leituras da tela (RLS)                    |
| `src/lib/actions/whatsapp.ts`                                  | Responder, arquivar, marcar como lida     |
| `src/modules/whatsapp/`                                        | Tipos, rótulos, schema, rotas, formatação |
| `src/app/(app)/whatsapp/`                                      | A tela                                    |
