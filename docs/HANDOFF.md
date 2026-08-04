# Handoff — estado do projeto

> Documento de passagem de bastão. Leia isto + [CLAUDE.md](../CLAUDE.md) antes de
> continuar. Última atualização: **2026-06-03** (montagem inicial da casca).

## Status atual

A **casca** está pronta e verificada. O app roda, autentica e está com todos os
guardrails de qualidade no lugar. **Nenhum módulo de negócio foi implementado** —
isso é o roadmap, a ser construído por quem assumir.

Verificação executada (tudo verde):

| Checagem          | Resultado               |
| ----------------- | ----------------------- |
| `pnpm type-check` | ✅                      |
| `pnpm lint`       | ✅                      |
| `pnpm test`       | ✅ 7 testes             |
| `pnpm build`      | ✅ 5 rotas + middleware |
| Husky (hooks)     | ✅ ativo                |

## O que JÁ existe

- **Auth + sessão** (Supabase e-mail/senha), proteção de rotas via `middleware.ts`.
- **RBAC** com 7 papéis e matriz de permissões (`src/lib/rbac/`) + RLS no banco.
- **Shell** do app (sidebar + topbar) e **dashboard** que lista o roadmap.
- **Módulo `profile`** — o exemplo de referência do padrão completo (copie-o).
- **Migration inicial** (`profiles`, enum de papéis, RLS, helpers, anti-escalada).
- **Qualidade:** ESLint (+ plugins Next e React Hooks), Prettier, Husky,
  commitlint, Vitest, CI (GitHub Actions).
- **Guardrails de IA:** skills e agents em `.claude/`; documentação em `docs/`.

## O que NÃO está incluído (de propósito)

- Os 13 módulos de negócio (ver [ROADMAP.md](./ROADMAP.md)).
- i18n / inglês — é só PT-BR.
- Testes E2E (Playwright) — adicionar quando houver fluxos críticos (ver [TESTING.md](./TESTING.md)).
- Toggle de tema dark no UI — os tokens dark já existem em `globals.css`, falta o botão.

## Decisões e porquês (resumo)

- **App único, não monorepo** (diferente do `matsu`): menos superfície de erro
  para quem dirige a IA sem ser dev.
- **Só PT-BR**: ferramenta interna brasileira; elimina a camada de i18n.
- **Padrão service/action + `ActionResult`**: contrato previsível mantém o código
  consistente mesmo gerado por IA.
- **RLS sempre + matriz RBAC no app**: segurança em duas camadas.
- **`profile` como referência viva**: a IA tem um exemplo concreto a copiar, em vez
  de inventar um padrão novo a cada módulo.

## Pendências / pontos de atenção

1. **Conectar o Supabase** (ainda não há projeto linkado): seguir [SETUP.md](../SETUP.md)
   passos 2–5. Sem isso o app sobe mas não loga.
2. **`.claude/settings.json` não foi criado** (bloqueado por segurança): o bloco de
   permissões recomendado está documentado em [SETUP.md](../SETUP.md) → aplicar via
   `/permissions` se desejar menos confirmações.
3. **Workaround de tipos do Supabase** (`.returns<T>()` / `as never`): necessário pelo
   descompasso de generics entre `@supabase/ssr` e `@supabase/supabase-js`. Manter o
   padrão dos exemplos. Detalhe em [CONVENTIONS.md](./CONVENTIONS.md).
4. **Aviso de build "Edge Runtime / process.version"**: vem do supabase-js no
   middleware. É inofensivo e não quebra o build — pode ignorar.
5. **Um único projeto Supabase**: para produção, considerar separar dev e prod
   (ver final de [SUPABASE.md](./SUPABASE.md)).
6. **Fluxo solo, direto na `main`.** Projeto de uma pessoa só: trabalha-se na
   `main`, sem feature branches nem PR obrigatório. Antes de cada commit, rode
   `/pre-pr` (tudo verde) e commite. O CI roda a cada push como rede de segurança.

## Como continuar

Implemente **um módulo por vez**, começando pela Fundação (Clientes/Projetos).
No Claude Code, rode a skill **`/new-module`** — ela conduz o passo a passo de
[HOW-TO-CREATE-A-MODULE.md](./HOW-TO-CREATE-A-MODULE.md). Ao terminar, rode
`/pre-pr`, commite na `main` e dê `git push`.

## Mapa rápido (onde fica o quê)

| Preciso de...          | Vá para                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| Regras do projeto      | [CLAUDE.md](../CLAUDE.md)                                        |
| Rodar o projeto        | [SETUP.md](../SETUP.md)                                          |
| Criar um módulo        | [HOW-TO-CREATE-A-MODULE.md](./HOW-TO-CREATE-A-MODULE.md)         |
| Exemplo de código real | `src/modules/profile/` + `src/lib/{services,actions}/profile.ts` |
| Mexer no banco         | [SUPABASE.md](./SUPABASE.md) + `supabase/migrations/`            |
| Padrão leitura/escrita | [SERVICE-ACTION-PATTERN.md](./SERVICE-ACTION-PATTERN.md)         |
| Roadmap dos 13 módulos | [ROADMAP.md](./ROADMAP.md)                                       |
