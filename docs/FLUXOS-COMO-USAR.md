# Fluxos de Atendimento — como usar

Guia para quem vai **operar** os fluxos: montar, testar, homologar, publicar e
acompanhar. Não é preciso saber programar.

> A parte técnica está em [FLUXOS.md](./FLUXOS.md). Este documento é o outro
> lado: o que fazer, na ordem, e o que cada tela quer de você.

---

## O que é um fluxo

É o caminho que uma conversa percorre **antes** de chegar a uma pessoa.

```
Alguém escreve no WhatsApp
        ↓
o robô cumprimenta e pergunta o assunto
        ↓
conforme a resposta:
        ↓
manda o conteúdo oficial   OU   encaminha para o time certo
```

Você desenha esse caminho arrastando caixinhas. Nada disso exige deploy: o
desenho é dado, não código.

---

## O ciclo, do começo ao ar

```
RASCUNHO ──► EM TESTE ──► AGUARDANDO APROVAÇÃO ──► APROVADA ──► NO AR
```

Cada etapa existe por um motivo prático:

| Etapa                    | O que significa                                            | Quem costuma agir |
| ------------------------ | ---------------------------------------------------------- | ----------------- |
| **Rascunho**             | ainda mexendo. É a única etapa em que o desenho pode mudar | quem desenha      |
| **Em teste**             | o desenho está de pé e está sendo experimentado            | quem desenha      |
| **Aguardando aprovação** | terminado, esperando alguém conferir                       | quem desenha      |
| **Aprovada**             | conferido, pronto para ir ao ar                            | quem aprova       |
| **No ar**                | está atendendo as conversas reais                          | —                 |

> **Uma versão no ar nunca é editada.** Para mudar um fluxo que já atende, você
> clica em **Criar nova versão** — o sistema copia o desenho para um rascunho
> novo, e o que está no ar continua exatamente como estava. É isso que permite
> voltar atrás depois.

---

## 1. Criar um fluxo

**Inteligência → Fluxos de Atendimento → Novo fluxo.**

Três coisas importam:

- **Nome** — como ele aparece nas listas e no histórico.
  ⚠️ Renomear depois parte o histórico em dois: os registros antigos ficam com o
  nome antigo. Vale escolher com calma.
- **Canal** — WhatsApp ou Web.
- **Fluxo de entrada** — marque **um** fluxo por canal. É ele que atende quem
  escreve pela primeira vez.

> **Se nenhum fluxo estiver marcado como de entrada, nada do que você desenhar
> vai atender ninguém.** O robô antigo (de uma pergunta por vez) continua
> respondendo, e você não recebe aviso nenhum. É o engano mais comum.

---

## 2. Desenhar

A tela tem quatro áreas: as peças (esquerda), o desenho (centro), as
propriedades (direita) e as pendências.

### As seis peças

| Peça           | Para quê                                                                    |
| -------------- | --------------------------------------------------------------------------- |
| **Mensagem**   | o robô fala e segue adiante                                                 |
| **Pergunta**   | o robô pergunta e **espera** a resposta                                     |
| **Condição**   | bifurca o caminho conforme o que já foi respondido                          |
| **Ação**       | consulta o CRM (Bolsa, normativa, comunicado, agenda, base de conhecimento) |
| **Transferir** | manda a conversa para um time                                               |
| **Fim**        | encerra o atendimento                                                       |

Arraste uma peça para o quadro. Clique nela para configurar à direita.

### Ligar as peças

Puxe da bolinha de uma caixinha até a outra. A seta é o caminho.

Numa **pergunta**, cada alternativa tem a própria bolinha — a seta que sai dela
é o caminho de quem escolher aquela opção.

Numa **condição**, saem duas: verdadeiro e falso.

> **Toda caixinha precisa de saída.** Uma sem seta é um beco sem saída: a
> conversa para ali e a pessoa fica sem resposta. O sistema recusa publicar
> assim, e o aviso aparece na lista de pendências enquanto você desenha.

---

## 3. Configurar uma pergunta

À direita, com a pergunta selecionada:

- **Texto** — o que a pessoa lê. Pode usar `{{nome}}`, `{{cidade}}` e qualquer
  variável já coletada.
- **Tipo de resposta** — botões, lista, sim/não, texto livre ou número.
- **Alternativas** — cada uma tem uma **chave** (em MAIÚSCULAS, tipo
  `BOLSA_SUINOS`) e um **rótulo** (o que a pessoa lê).
  ⚠️ A chave é a regra; o rótulo é só texto. Você pode reescrever o rótulo
  quando quiser. **Nunca** monte uma condição sobre o número da opção — a ordem
  pode mudar.
- **Variável** — onde a resposta fica guardada, para usar depois.

### Quando a resposta não serve

- **Quantas vezes perguntar** — depois disso o atendimento segue para o desfecho.
- **Texto de resposta inválida** — o "não entendi". Vazio repete a pergunta.
- **Desfecho** — encerrar ou transferir. Transferindo, escolha o time.

> Todo fluxo precisa de uma saída para quem não consegue responder. Sem isso a
> pessoa fica repetindo a mesma pergunta, e ninguém da APCS fica sabendo.

### Entender texto livre

Marque **"Entender o que ela quis dizer"** e a IA passa a interpretar respostas
que não casam com nenhuma alternativa.

Ela grava o que entendeu em duas variáveis:

- `sys_intent` — o assunto identificado
- `sys_intent_band` — a segurança da leitura: `high`, `medium` ou `low`

**A IA não escolhe o caminho.** Quem escolhe são as setas de condição que você
ligar nessas variáveis. O desenho típico:

```
sys_intent_band = high     → segue direto para o assunto
sys_intent_band = medium   → pergunta "você quer dizer X?"
sys_intent = sys_ia_indisponivel → mostra um menu numerado
(nenhuma casou)            → repete a pergunta
```

Sem nenhuma seta assim, marcar a caixa não muda nada — a pergunta simplesmente
se repete, como antes.

As duas barras de confiança ficam em **Configurações → Chatbot**.

---

## 4. Configurar uma ação

Escolha o que consultar. As disponíveis hoje:

| Ação                              | O que devolve                           |
| --------------------------------- | --------------------------------------- |
| Consultar a Bolsa                 | título, imagem e PDF do boletim vigente |
| Consultar normativa               | título e PDF da versão ativa            |
| Consultar comunicado              | título e PDF (ISP, revista, calendário) |
| Consultar a agenda                | a lista de eventos do público da pessoa |
| Consultar a Base de Conhecimento  | a resposta escrita                      |
| Consultar solicitação de palestra | a situação de um protocolo              |

O que a ação devolve vira variável. Para **mandar** o arquivo, use uma mensagem
depois da ação com `{{bolsa_imagem_url}}` no campo de imagem e
`{{bolsa_pdf_url}}` no de PDF.

> As ações sempre trazem a **versão ativa e liberada para o chatbot**. Não existe
> caminho que devolva uma versão antiga.

Toda ação tem três saídas: **deu certo**, **não encontrei** e **falhou**. Ligue
as três — "não encontrei" é uma resposta útil ("não há boletim publicado hoje"),
e é diferente de erro.

---

## 5. Testar

Botão **Testar fluxo**.

O simulador roda o **motor de verdade**, mas nada sai da casa: não manda
WhatsApp, não cria registro, não transfere conversa.

O que dá para fazer:

- **Quem está conversando** — nome, telefone, tipo, cidade e se está dentro do
  horário. Vira contexto: um `{{nome}}` já mostra o que a pessoa vai ler.
- **Responder** como a pessoa responderia.
- **Resposta vazia** e **Resposta inválida** — os dois botões que testam o que
  mais acontece no WhatsApp de verdade e o que menos se testa à mão.
- **Simular IA** — escolha a intenção e a confiança e veja qual caminho o motor
  segue. Serve para conferir as setas do texto livre sem depender do modelo.
- **Ações respondem** — escolha entre "deu certo", "não encontrei" e "falhou"
  para percorrer os três caminhos de cada ação.

Abaixo da conversa fica o painel de depuração: etapa anterior, etapa atual,
resposta lida, ligação seguida, ação, intenção e todas as variáveis. É por ele
que você descobre **por que** o fluxo foi para onde foi.

---

## 6. Homologar

Marque o **checklist de homologação**, abaixo do desenho. São onze itens, e cada
um registra quem conferiu e quando.

> **O checklist não bloqueia a publicação.** Ele é registro, não porta — os itens
> são afirmações suas, e o sistema não tem como conferi-las. O que impede
> publicar um desenho quebrado é a lista de **pendências**, que o sistema
> verifica sozinho.

Quando terminar, clique em **Enviar para aprovação**.

---

## 7. Aprovar ou reprovar

Quem confere abre a versão e decide:

- **Aprovar** — ela fica pronta para publicar.
- **Reprovar** — ela volta para rascunho, e o sistema **exige um motivo**.

Escreva o motivo pensando em quem vai corrigir. Ele é a única informação que
essa pessoa vai ter, e aparece no topo da tela quando ela abrir o rascunho.

Ruim: _"está errado"_
Bom: _"a triagem de Financeiro está direcionando para o time de Marketing"_

---

## 8. Publicar

Botão **Publicar**. Antes de confirmar, o sistema mostra:

- qual fluxo e qual versão;
- **o que muda** em relação ao que está no ar — quais caixinhas entraram, quais
  saíram e o que foi alterado em cada uma.

Confira essa lista. É a última chance de notar uma mudança que você não fez.

Ao confirmar:

```
v4 → NO AR
v3 → substituída (continua no histórico)
```

**As conversas que já estavam em andamento continuam na v3.** Elas não pulam
para o desenho novo no meio — é isso que impede alguém de receber a pergunta de
uma etapa que nunca viu.

---

## 9. Voltar atrás (rollback)

Abra a versão anterior pelo seletor de versões e clique em **Restaurar esta
versão**.

```
v3 → NO AR
v4 → substituída
```

Nada é apagado. As duas continuam no histórico, e você pode ir e voltar quantas
vezes precisar. As conversas em andamento na v4 continuam na v4.

---

## 10. Acompanhar

**Fluxos → Monitoramento.**

| O que ver           | O que ele responde                                                     |
| ------------------- | ---------------------------------------------------------------------- |
| Indicadores         | quantas conversas, quantas o robô resolveu, quantas foram para pessoas |
| Situação por fluxo  | saudável, atenção, com problema ou sem movimento                       |
| Funil               | onde as conversas estão parando                                        |
| Fila de atendimento | quem está esperando, há quanto tempo, e se estourou o prazo            |
| Erros               | onde o desenho quebrou, quantas vezes e quando                         |

**"Sem movimento"** num fluxo publicado geralmente significa que ele não é o
fluxo de entrada do canal — vale conferir.

### Prazo de atendimento (SLA)

Cada time pode ter um prazo padrão. Ele é gravado no momento da transferência,
então mudar o prazo do time depois não reescreve o que já aconteceu.

O relógio começa quando a conversa entra na fila e para quando **uma pessoa**
responde — a mensagem do robô dizendo "vou te encaminhar" não conta.

---

## Perguntas que aparecem

**Mudei o fluxo e nada mudou no WhatsApp.**
Você mexeu num rascunho. Só a versão **no ar** atende. Publique.

**Publiquei e continua respondendo o de antes.**
Conversas já abertas continuam no desenho com que começaram. Comece uma conversa
nova para ver a versão nova.

**O botão Publicar está apagado.**
Há pendências. Elas aparecem na lista ao lado do desenho, com o que falta em
cada caixinha.

**Aparece "esta ação ainda não está ligada ao sistema".**
O desenho está certo; falta ligar aquela consulta no código. Fale com quem cuida
do sistema.

**Preciso desligar o atendimento automático agora.**
**Configurações → Chatbot → Robô ligado**: escreva `off`. Vale para os fluxos e
para o robô antigo, e não exige deploy. As mensagens continuam chegando na caixa
de entrada — só não recebem resposta automática.

---

## O que você não consegue fazer, e por quê

|                                    | Por quê                                              |
| ---------------------------------- | ---------------------------------------------------- |
| Editar uma versão no ar            | ela está atendendo. Crie uma nova versão.            |
| Publicar um desenho com pendências | a conversa quebraria na frente de alguém.            |
| Apagar uma versão                  | o histórico é o que permite voltar atrás.            |
| Apagar um fluxo que já atendeu     | ele é referência das conversas gravadas. Desligue-o. |
| Reprovar sem motivo                | quem for corrigir ficaria adivinhando.               |
