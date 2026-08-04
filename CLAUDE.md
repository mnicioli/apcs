# CLAUDE.md — FAST Operation Cockpit

Instruções para qualquer IA (Claude Code) que trabalhe neste repositório. Leia
antes de codar. As regras existem para manter um código bom e consistente
mesmo quando quem dirige não é desenvolvedor.

---

## Contexto

- **O que é:** o "command center" interno de **uma** empresa — fonte única da
  verdade de clientes, projetos, recursos, custos e inteligência operacional.
- **Quem usa:** CEO, PMs, Tech Leads, Comercial e Financeiro (acesso por papéis).
- **Como é construído:** com IA. Por isso os guardrails (este arquivo, as skills,
  os agents, lint/type-check/testes, RLS) são levados a sério.

---

## ⭐ Para quem está dirigindo a IA (mesmo sem ser dev)

Estas são as regras de ouro. Se seguir só estas, o projeto se mantém saudável:

1. **Uma coisa de cada vez.** Um módulo ou uma correção por vez, um PR por vez.
   Peça à IA para focar; não tente fazer três módulos juntos.
2. **Sempre rode `/pre-pr` antes de finalizar.** Ele roda lint, type-check,
   testes e build. **Se algo estiver vermelho, não está pronto** — peça para a IA
   corrigir antes de seguir.
3. **Nunca pule os hooks** (não autorize `--no-verify`). Eles barram commit ruim.
4. **Nunca exponha segredos.** A `service_role key` do Supabase e o `.env.local`
   jamais vão para o código ou para o Git. Se a IA sugerir isso, recuse.
5. **Quando a IA estiver em dúvida, ela deve te perguntar** — e você pode pedir
   que ela explique em português o que vai fazer antes de fazer.
6. **Mudou o banco? Rode `pnpm db:types`.** Sempre.
7. **Confie nos sinais vermelhos.** Erro de type-check, teste falhando ou CI
   vermelho são amigos: estão te avisando antes do problema chegar no ar.

Em caso de dúvida sobre "como faz X", a resposta quase sempre é: **olhe como o
módulo `profile` faz** e copie o padrão.

---

## Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 ·
componentes estilo shadcn/ui · Supabase (Auth + Postgres + RLS) · Zod +
React Hook Form · ESLint + Prettier · Husky + commitlint · Vitest · pnpm.

App **único** (sem monorepo). Idioma **PT-BR** apenas (sem i18n).

---

## Idioma: código em inglês, UI em PT-BR

- **Inglês:** nomes de arquivos, funções, variáveis, tipos, rotas, tabelas, colunas.
- **PT-BR:** apenas textos que o usuário vê (labels, mensagens) e documentação.

Detalhes em [docs/CONVENTIONS.md](./docs/CONVENTIONS.md).

---

## Branches e commits

Projeto solo, fluxo simples: trabalha-se **direto na `main`**.

- **Antes de cada commit**, rode `/pre-pr` (lint, type-check, testes, build). Só
  commite se estiver tudo verde — `main` é o que vai para produção.
- Commits em **Conventional Commits**: `feat(clients): adiciona cadastro`.
  O commitlint valida automaticamente — **não use `--no-verify`**.
- O CI (GitHub Actions) roda a cada push na `main` como rede de segurança.
- Para algo grande/experimental, dá para criar uma branch e abrir PR — opcional,
  não obrigatório.

---

## Padrões de código (resumo — detalhe em docs/)

- **Leitura** em `src/lib/services/` (`server-only`, lança erro).
  **Escrita** em `src/lib/actions/` (`"use server"`, retorna `ActionResult`,
  nunca `throw`). Tipos/validação em `src/modules/<domain>/`.
  → [docs/SERVICE-ACTION-PATTERN.md](./docs/SERVICE-ACTION-PATTERN.md)
- **Server Components por padrão**; `"use client"` só quando há interação.
- **Supabase:** `createClient` de `@/lib/supabase/server` no servidor,
  de `@/lib/supabase/client` no cliente.
- **Formulários:** React Hook Form + Zod (o mesmo schema no client e na action).
- **TypeScript:** proibido `any`; `import type` para tipos.
- **UI:** tokens de cor (`bg-primary`, `text-muted-foreground`) — nunca cor fixa
  (`bg-blue-500`). Reutilize `src/components/ui/`; todo input tem `<Label>`.
- **Exemplo de referência de tudo:** o módulo `profile`
  (`src/modules/profile/`, `src/lib/services/profile.ts`,
  `src/lib/actions/profile.ts`, `src/app/(app)/profile/`).

---

## Supabase (regras críticas)

- **Schema só por migration** — nunca pelo Dashboard. Use `/new-migration`.
- **RLS sempre** em tabela nova; policies por papel usando `current_app_role()`
  / `is_admin()` (helpers `SECURITY DEFINER` da migration inicial).
- **`service_role` nunca no frontend** nem em `NEXT_PUBLIC_*`.
- **`pnpm db:types`** após qualquer mudança de schema (regenera
  `src/types/database.ts` — não edite à mão).
- → [docs/SUPABASE.md](./docs/SUPABASE.md)

## Papéis (RBAC)

`admin`, `ceo`, `pm`, `tech_lead`, `comercial`, `financeiro`, `viewer`.
Matriz de permissões em `src/lib/rbac/rbac.config.ts` (1ª camada) + RLS no banco
(2ª camada) — devem concordar. Novos usuários entram como `viewer`.

---

## Skills (use com `/`)

| Skill            | Quando usar                                      |
| ---------------- | ------------------------------------------------ |
| `/new-feature`   | Começar qualquer tarefa (fluxo do início ao PR). |
| `/new-module`    | Implementar um módulo do roadmap.                |
| `/new-migration` | Criar/alterar tabela, coluna, policy no banco.   |
| `/pre-pr`        | Checagens antes de finalizar/abrir PR.           |
| `/review`        | Code review (rode em subagente).                 |
| `/security`      | Revisão de segurança (rode em subagente).        |
| `/testing`       | Escrever testes Vitest.                          |

**Rode `/review` e `/security` em subagentes** (`Task`/agent) para não encher o
contexto do chat principal. Agents disponíveis: `code-reviewer`,
`security-reviewer`, `supabase-guardian`.

---

## Documentação

Índice em [docs/README.md](./docs/README.md). Destaques:
[ARCHITECTURE](./docs/ARCHITECTURE.md) ·
[HOW-TO-CREATE-A-MODULE](./docs/HOW-TO-CREATE-A-MODULE.md) ·
[ROADMAP](./docs/ROADMAP.md) · [SETUP](./SETUP.md).
