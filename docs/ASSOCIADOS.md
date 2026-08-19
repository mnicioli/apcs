# Associados — landing pública e registro

Como funciona o cadastro de novos associados: a página `/associe-se`, que
qualquer um na internet abre, e as duas tabelas em que ela desemboca.

---

## 1. O resumo em cinco linhas

- Uma pessoa preenche o formulário em **`/associe-se`** (rota pública).
- A solicitação cai em **`membership_applications`** — a caixa de entrada.
- Alguém do CRM analisa em **`/members/applications`** e aprova ou recusa.
- Aprovar cria (ou vincula) a linha em **`members`** — o registro definitivo.
- **A carga dos associados que já existem ainda não foi feita.** A tabela está
  pronta para recebê-la; a importação é trabalho de um segundo momento.

---

## 2. Por que são DUAS tabelas

`membership_applications` é o que uma pessoa **digitou**, sem ninguém ter
conferido nada. Qualquer um na internet escreve ali.

`members` é quem a APCS **reconhece** como associado. Só entra por aprovação de
alguém do CRM — ou pela carga do cadastro anterior.

Fundir as duas faria o formulário público escrever direto na fonte da verdade da
entidade. É por isso que aprovar é uma operação explícita, com trilha, e não uma
mudança de coluna.

Este módulo também fecha o **GAP 1** registrado no cabeçalho de Enquetes: até
aqui o banco não tinha cadastro de associados, e por isso a segmentação de
campanha por "segmento", "categoria" e "carteira" era recusada. `members` é a
tabela que, um dia, vai sustentar essas dimensões — `members.contact_id` já liga
o associado ao `chat_contacts`, que é a entidade com telefone.

---

## 3. A porta pública

O formulário é a única escrita anônima deste módulo, e ela tem uma porta só:

```
/associe-se  →  submitMembershipApplicationAction  →  submit_membership_application()
   (React)          (Server Action, service_role)        (SECURITY DEFINER)
```

**Não existe policy de INSERT para `anon` em nenhuma tabela do módulo.** Não
existe nem para `authenticated`. O `EXECUTE` da função está revogado de `public`,
`anon` e `authenticated` — só o `service_role` a chama, e ele só existe no
servidor.

Motivo: um endpoint público que escreve no banco precisa de limite de taxa,
deduplicação e normalização **antes** de a linha existir. Policy de RLS não faz
nada disso; uma função faz as três numa transação.

O que a função aplica, em ordem:

| Passo          | O que faz                                                               |
| -------------- | ----------------------------------------------------------------------- |
| Perfil         | Recusa envio sem os campos obrigatórios do perfil escolhido (`MA003`)   |
| Limite de taxa | 8 envios por hora por hash de IP (`MA004`)                              |
| Deduplicação   | `on conflict (dedupe_key) do nothing` — duplo clique = mesmo protocolo  |
| Normalização   | Telefone e CNPJ viram dígitos; e-mail vira minúsculo; UF vira maiúsculo |
| Auditoria      | Uma linha em `membership_audit_logs`, sem ator (foi o site)             |

A chave de deduplicação é `e-mail | perfil | janela de 5 minutos`, montada na
action. Fora da janela, o mesmo e-mail cria uma solicitação nova — que é o certo:
a segunda pode ser a corrigida.

O IP nunca é guardado em claro. `source_ip_hash` é HMAC-SHA256 com
`APCS_IP_HASH_SECRET` (ver `src/lib/security/client-ip.ts`), o mesmo mecanismo do
chat público.

---

## 4. O fluxo da solicitação

As transições moram em `membership_application_status_transitions` e um trigger
recusa qualquer passo fora do grafo, em **qualquer** caminho de escrita.

```
            ┌──────────────┐
   (nova) ─►│  AGUARDANDO  │◄────────────┐
            └──┬────────┬──┘             │
               │        │                │ devolver / reabrir
               │        ▼                │
               │   ┌────────────┐        │
               │   │ EM ANÁLISE ├────────┘
               │   └──┬──────┬──┘
               │      │      │
        ┌──────┴──────┘      └──────┐
        ▼                           ▼
  ┌───────────┐              ┌────────────┐
  │ APROVADA  │              │  RECUSADA  │──► reabrir
  └───────────┘              └────────────┘
   (terminal)
```

**APROVADA é terminal.** Aprovar cria (ou vincula) um associado no registro;
desfazer isso pelo grafo deixaria a solicitação livre e o associado de pé. Quem
precisa reverter inativa o **associado**, que é onde a informação de verdade
mora.

Recusar exige motivo (`MA005`) — no banco, não só na tela. Uma recusa sem motivo
é uma recusa que ninguém consegue explicar para quem ligou perguntando.

### Aprovar já vinculado

Se já existir um associado com o mesmo e-mail, a aprovação **vincula** em vez de
criar. Sem isso, o índice único de e-mail transformaria o caso mais comum de
todos — "essa pessoa já é associada e se cadastrou de novo" — num erro de banco
na cara do gestor.

---

## 5. Permissões

| Papel                   | `members.read` | `members.write` |
| ----------------------- | -------------- | --------------- |
| Administrador (`admin`) | ✅             | ✅              |
| Gestor (`ceo`)          | ✅             | ✅              |
| Atendente (`comercial`) | ✅             | ❌              |
| Demais                  | ❌             | ❌              |

O Atendente **não aprova**, e é deliberado: aprovar cria uma linha no registro de
associados, que é a fonte única da verdade da entidade — e a carga do cadastro
anterior vai desembocar na mesma tabela.

Se um dia a triagem virar rotina do atendimento, mover `comercial` para
`members.write` é **uma linha em `rbac.config.ts` MAIS** `membership_is_writer()`
na migration. As duas camadas têm de contar a mesma história.

A trilha (`membership_audit_logs`) é mais estreita que a leitura: só `admin` e
`ceo`. Para o Atendente a consulta volta vazia e a seção some da tela — não é
erro, é a trilha ser mais estreita.

---

## 6. A landing

`/associe-se` é a única página do sistema, fora o chat, que qualquer um abre sem
estar logado. Ela está na lista de rotas públicas em
`src/lib/supabase/middleware.ts`.

**Ela tem identidade visual própria, e ela não vaza.** O CRM é laranja
(`--primary: #FF6115`); a landing é vermelha (`#C4262E`, amostrado do logo
oficial em `public/logo-apcs.svg`). Os tokens da landing são redefinidos dentro
de `.apcs-landing`, em `src/app/associe-se/landing.css`, e o `@theme inline` do
Tailwind faz `bg-primary` virar `background-color: var(--primary)` — então
redefinir a variável num ancestral reescreve toda a subárvore sem duplicar uma
linha de Tailwind.

É também por isso que a landing **não tem modo escuro**: uma custom property
declarada no próprio elemento vence a herdada do `.dark` do `<html>`.

As fontes (Manrope e Inter) são carregadas no layout **da rota**, não no raiz: o
CRM não usa nenhuma das duas, e baixá-las em toda tela do sistema seria peso sem
uso. Vêm por `next/font`, que as hospeda no próprio domínio — nenhuma requisição
sai para o Google quando alguém abre uma página que coleta dado pessoal.

Só três coisas chegam ao navegador como JavaScript: o formulário, o `Reveal` e o
botão fixo do celular. O resto é HTML pronto.

---

## 7. LGPD

- O aceite é obrigatório **no banco** (`CHECK membership_applications_consent`),
  não só no formulário.
- `consent_at` guarda quando, `consent_policy_version` guarda **a que texto** a
  pessoa disse sim.
- Ao alterar `MEMBERSHIP_CONSENT_TEXT` em `membership.labels.ts`, **incremente**
  `MEMBERSHIP_CONSENT_VERSION`. Uma autorização só vale para o que foi lido.

---

## 8. ⚠️ A carga dos associados que já existem (a fazer)

**Ela não foi feita.** A tela `/members` diz isso em cima da lista, e a migration
diz isso no cabeçalho. Não fingir que existe é parte do desenho.

O que já está pronto para recebê-la:

| Coluna                | Para quê                                                                   |
| --------------------- | -------------------------------------------------------------------------- |
| `origin = 'import'`   | Distingue quem veio da carga de quem se cadastrou pelo site                |
| `external_id`         | Id no sistema de origem, com índice único parcial — reimportar não duplica |
| `joined_at`           | Data **real** de associação (histórica), diferente de `created_at`         |
| Quase tudo é anulável | Cadastro legado é incompleto por natureza                                  |

**O contrato que a carga vai ter de cumprir:** `members_email_unique_idx` recusa
dois associados com o mesmo e-mail. É de propósito — sem isso o registro deixa de
ser fonte única da verdade no primeiro arquivo com duplicata, e o vínculo com a
solicitação passa a apontar para qualquer um dos dois. E-mail **nulo** é aceito,
então associado antigo sem e-mail entra sem problema; o que não entra é o
**mesmo** e-mail duas vezes.

Também não existe ainda: edição de cadastro de associado pelo CRM. Enquanto a
carga não define o formato final do registro, um formulário de edição seria
construído contra um alvo que ainda vai se mexer.

---

## 9. Códigos de erro

Classe `MA`, mapeada em `src/lib/actions/errors.ts`. Classe própria porque a `P0`
é reservada pelo PL/pgSQL.

| Código  | Significa                                       |
| ------- | ----------------------------------------------- |
| `42501` | Sem permissão                                   |
| `P0002` | Solicitação não encontrada                      |
| `MA001` | Transição de situação não permitida             |
| `MA002` | A situação atual não permite esta operação      |
| `MA003` | Falta um campo obrigatório do perfil escolhido  |
| `MA004` | Limite de envios do formulário público atingido |
| `MA005` | É preciso justificar a recusa                   |

---

## 10. O que foi verificado

| Bateria                           | Onde                                             | Resultado |
| --------------------------------- | ------------------------------------------------ | --------- |
| SQL (transação desfeita)          | grafo, grants, RLS, deduplicação, limite de taxa | 28/28     |
| Unitários (schema, rotas, action) | `src/modules/membership/`, `src/lib/actions/`    | 71/71     |
| Componente (formulário 3 etapas)  | `src/app/associe-se/form/`                       | 16/16     |
| Ao vivo, contra o banco real      | `service_role` executa; `anon` é recusado        | 10/10     |

A última é a que as outras não conseguiam fazer: a bateria SQL roda como
`postgres`, que pode tudo. Se o `grant` para `service_role` estivesse errado, ela
teria passado igual e o formulário quebraria em produção.

---

## 11. Arquivos

| Onde                                                       | O quê                                |
| ---------------------------------------------------------- | ------------------------------------ |
| `supabase/migrations/20260821000000_create_membership.sql` | Tabelas, RLS, grants, funções, grafo |
| `src/modules/membership/`                                  | Schema (Zod), tipos, rótulos, rotas  |
| `src/lib/services/membership.ts`                           | Leituras (RLS)                       |
| `src/lib/actions/membership.ts`                            | Formulário público + decisões do CRM |
| `src/lib/security/client-ip.ts`                            | Hash de IP para o limite de taxa     |
| `src/app/associe-se/`                                      | A landing pública                    |
| `src/app/(app)/members/`                                   | Caixa de entrada, detalhe e registro |
