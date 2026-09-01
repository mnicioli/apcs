# Chat de atendimento — arquitetura e guardrails

Documentação técnica do primeiro fluxo da plataforma: **CSP (compras coletivas)**.
Leia antes de mexer no chat ou de criar um fluxo novo.

---

## O problema que o desenho resolve

O bot fala com produtores, associados e fornecedores em nome da APCS. A regra de
negócio é dura: **ele só pode dizer o que já foi aprovado**. Um LLM solto, por
melhor que seja o prompt, sempre pode improvisar — e um improviso da associação
sobre preço, prazo ou condição comercial é um problema real.

A solução é estrutural, não é prompt: **o LLM nunca escreve para o usuário**.

```
Pessoa escreve  →  LLM interpreta  →  Motor decide  →  Catálogo aprovado  →  Pessoa lê
                   (dados+intenção)   (determinístico)  (texto em código)
```

| Peça               | Arquivo                                 | Responsabilidade                                           |
| ------------------ | --------------------------------------- | ---------------------------------------------------------- |
| Catálogo aprovado  | `src/modules/chat/flows/csp.content.ts` | **Todo** o texto que o bot pode dizer                      |
| Definição do fluxo | `src/modules/chat/flows/csp.flow.ts`    | Quais campos coletar, em que ordem                         |
| Interpretação      | `src/lib/chat/llm.ts`                   | Chama o Claude; devolve dados + intenção                   |
| Decisão            | `src/lib/chat/decide.ts`                | Escolhe **qual chave** do catálogo enviar (puro, testável) |
| Encanamento        | `src/lib/chat/engine.ts`                | Banco → LLM → decisão → banco                              |
| Porta de entrada   | `src/app/api/chat/route.ts`             | Endpoint público, cookie de sessão                         |

O contrato do LLM é minúsculo de propósito: `{ intent, slots }`. Ele não escolhe
mensagem, não escreve frase, não decide status. Se ele falhar, recusar ou
devolver lixo, o motor cai numa mensagem aprovada de indisponibilidade.

O teste `src/lib/chat/decide.test.ts` percorre todas as combinações de estado ×
intenção e afirma que **nenhuma** produz chave fora do catálogo. Se alguém
introduzir um caminho que devolve texto cru, esse teste quebra.

---

## Segurança do canal público

`/chat` é aberto — sem login. Três decisões seguram isso:

1. **RLS fechada para anônimo.** As tabelas do chat têm RLS habilitada e
   **nenhuma policy de escrita** para `anon`/`authenticated`. Toda escrita passa
   pelo servidor com a `service_role` (`src/lib/supabase/admin.ts`, `server-only`).
   A superfície pública do banco é zero.
2. **A conversa é o cookie.** Um token aleatório de 256 bits em cookie httpOnly
   identifica a conversa; no banco fica só o SHA-256. Nenhum id de conversa é
   aceito pelo corpo da requisição — senão bastaria trocar o id para ler a
   conversa alheia.
3. **Limites de uso.** Mensagens por minuto, teto por conversa e conversas por
   IP/hora (`src/lib/chat/rate-limit.ts`). Um endpoint anônimo que chama um LLM
   sem limite é um cartão de crédito aberto na internet.

## LGPD

O bot pede consentimento explícito **antes da primeira pergunta de triagem**, com
link para a política. O aceite fica carimbado em `consent_given_at` +
`consent_policy_version`.

Enquanto o aceite não vier, três coisas **não** acontecem:

1. Nenhum dado de triagem é registrado (`decideTurn` descarta o que veio).
2. **O texto cru da mensagem não é gravado.** Só o ato de consentimento é —
   e como rótulo canônico ("Sim, autorizo"), não como texto livre. Sem isso, uma
   pessoa que se apresenta antes de aceitar e depois recusa teria nome e telefone
   no banco enquanto o bot responde "não vou registrar nenhum dado".
3. **Nada é enviado à Anthropic.** Não há base legal para mandar o texto do
   visitante a um processador terceiro fora do país antes do aceite.

Por isso o gate de consentimento é **determinístico** ([consent.ts](../src/lib/chat/consent.ts)),
sem LLM: além da privacidade, um consentimento precisa ser inequívoco (LGPD art.
5º XII) — registrar um aceite porque um classificador achou que a pessoa disse
sim não é registro de ato afirmativo. O clique no botão resolve por igualdade de
valor; texto livre passa por reconhecimento de padrões; qualquer dúvida repete a
pergunta. A revogação (`consent_decline` a qualquer momento) encerra a conversa.

O IP nunca é gravado em claro: é HMAC com `APCS_IP_HASH_SECRET`. SHA-256 puro não
serviria — IPv4 tem 2^32 valores e a tabela inteira se gera em minutos.

### Pendências de LGPD (antes de divulgar o chat)

- **Retenção e expurgo.** Hoje conversa e lead ficam para sempre. Falta definir o
  prazo (sugestão: conversa sem lead → 90 dias) e um job de expurgo.
- **Direito de eliminação.** A policy de `DELETE` para `admin` já existe (a
  exclusão da conversa cascateia para mensagens e lead), mas ainda não há tela
  nem action para atender um pedido do titular.
- **Texto do consentimento.** O rascunho atual não menciona processamento por IA
  nem transferência internacional de dados. Precisa passar pelo DPO.

---

## Criar um fluxo novo (Eventos, Filiação, Bolsa…)

1. `alter type public.chat_flow_key add value '<flow>'` numa migration nova.
2. `src/modules/chat/flows/<flow>.content.ts` — o catálogo aprovado do fluxo.
3. `src/modules/chat/flows/<flow>.flow.ts` — os campos e a ordem das perguntas.
4. Registrar em `src/modules/chat/flows/registry.ts` (`available: true`).
5. Tabela de leads própria, se o fluxo gerar lead, com RLS espelhando a matriz
   em `src/lib/rbac/rbac.config.ts`.

O motor (`decide.ts`, `engine.ts`) não deveria precisar mudar. Se precisar, é
sinal de que a abstração do fluxo está apertada — vale rever antes de codar.

---

## Variáveis de ambiente

Todas server-side (ver `.env.example`):

| Variável                      | Para quê                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`   | Escrita do chat. **Obrigatória.** Nunca `NEXT_PUBLIC_`.                                                               |
| `ANTHROPIC_API_KEY`           | Interpretação das mensagens.                                                                                          |
| `APCS_IP_HASH_SECRET`         | HMAC que anonimiza o IP do rate limit.                                                                                |
| `APCS_PRIVACY_POLICY_URL`     | Link mostrado no pedido de consentimento.                                                                             |
| `APCS_PRIVACY_POLICY_VERSION` | Versão registrada junto com o aceite.                                                                                 |
| `APCS_CSP_MATERIAL_URL`       | Material oficial que o bot envia.                                                                                     |
| `APCS_CHAT_MODEL`             | Opcional — modelo usado na extração do chat da web (padrão `claude-sonnet-5`).                                        |
| `APCS_INTELLIGENCE_MODEL`     | Opcional — modelo da classificação de intenções do WhatsApp (padrão `claude-sonnet-5`). Variável separada da de cima. |

O fusível de custo definitivo não é nenhuma dessas: é o **limite de gasto da
organização no console da Anthropic**. Um endpoint público que chama LLM precisa
dele configurado.

## Antes de publicar

O conteúdo em `csp.content.ts` e os rótulos em `chat.labels.ts` estão marcados
com `TODO(APCS)`. **Nenhum `TODO(APCS)` pode sobrar** quando o chat for
divulgado — cada um é um texto que precisa da revisão do time.
