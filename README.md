# FAST Operation Cockpit

Fonte única da verdade da empresa: clientes, projetos, recursos, infraestrutura,
custos, rentabilidade e inteligência operacional — em uma única plataforma
interna.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4 · Supabase
(Auth + Postgres + RLS) · Zod + React Hook Form · Vitest · pnpm.

## Começar

```bash
pnpm install
cp .env.example .env.local   # preencha com seu projeto Supabase
pnpm dev
```

Passo a passo completo em **[SETUP.md](./SETUP.md)**.

## Como o projeto é organizado

Este repositório foi preparado para ser construído **com IA** mantendo qualidade.
Antes de codar, leia:

- **[CLAUDE.md](./CLAUDE.md)** — regras do projeto e guia de ouro para dirigir a IA.
- **[docs/](./docs/)** — arquitetura, padrões, Supabase, convenções, testes.
- **[docs/ROADMAP.md](./docs/ROADMAP.md)** — os 13 módulos do produto, faseados.
- **[docs/HOW-TO-CREATE-A-MODULE.md](./docs/HOW-TO-CREATE-A-MODULE.md)** — passo a
  passo para implementar cada módulo.

No Claude Code, use as skills: `/new-feature`, `/new-module`, `/new-migration`,
`/pre-pr`, `/review`, `/security`, `/testing`.

## O que já vem pronto (a "casca")

- Autenticação por e-mail/senha + sessão (Supabase) e proteção de rotas.
- Controle de acesso por **papéis** (admin, ceo, pm, tech_lead, comercial,
  financeiro, viewer) com RLS no banco.
- Shell do app (sidebar + topbar) e dashboard com o roadmap dos módulos.
- O módulo **`profile`** como exemplo de referência do padrão completo.
- Qualidade: ESLint, Prettier, Husky, commitlint, Vitest e CI (GitHub Actions).

Os 13 módulos de negócio **ainda não são implementados** — eles são o roadmap, a
serem construídos um a um seguindo o padrão de referência.
