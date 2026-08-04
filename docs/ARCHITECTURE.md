# Arquitetura

## Visão geral

O FAST Operation Cockpit é um **app único** Next.js 15 (App Router) com Supabase
como backend (Auth + Postgres + RLS). É uma ferramenta **interna de uma empresa**,
com acesso controlado por **papéis** (roles). Não é multi-tenant.

```
Navegador
   │
   ▼
Next.js (App Router)
   ├─ middleware.ts ............ renova a sessão e protege rotas
   ├─ app/login ................ tela pública de login
   ├─ app/(app)/* .............. rotas autenticadas (shell com sidebar + topbar)
   │     ├─ Server Components → chamam services (leitura)
   │     └─ Client Components → chamam actions (escrita)
   │
   ▼
Supabase
   ├─ Auth (e-mail + senha)
   └─ Postgres + RLS (Row Level Security por papel)
```

## Camadas (a regra mais importante do projeto)

| Camada       | Pasta                     | Faz                              | Regra                                  |
| ------------ | ------------------------- | -------------------------------- | -------------------------------------- |
| Tipos/Schema | `src/modules/<domain>/`   | tipos de domínio + validação Zod | sem banco, sem React                   |
| Leitura      | `src/lib/services/`       | lê do Supabase                   | `server-only`, **lança** erro          |
| Escrita      | `src/lib/actions/`        | cria/edita/apaga                 | `"use server"`, retorna `ActionResult` |
| Telas        | `src/app/(app)/<domain>/` | renderiza e interage             | Server por padrão                      |

Detalhe em [SERVICE-ACTION-PATTERN.md](./SERVICE-ACTION-PATTERN.md).

## Autenticação e papéis

- O login cria uma sessão Supabase (cookies). O `middleware.ts` a renova a cada
  navegação e redireciona anônimos para `/login`.
- Cada usuário tem uma linha em `public.profiles` com um `role` (`app_role`).
- O papel é lido por `getCurrentUserRole()` (`src/lib/auth/current-user.ts`),
  com **fallback `viewer`** (deny-by-default) se algo falhar.
- Permissões: matriz em `src/lib/rbac/rbac.config.ts` (1ª camada, app) + RLS no
  banco (2ª camada). As duas devem concordar.

## Estrutura de pastas

```
src/
  app/
    layout.tsx            # layout raiz (html/body, globals.css)
    page.tsx              # "/" → redireciona p/ /dashboard
    login/                # tela pública
    (app)/                # grupo autenticado (não aparece na URL)
      layout.tsx          # shell: Sidebar + Topbar
      dashboard/
      profile/            # EXEMPLO de referência do padrão completo
  components/
    ui/                   # componentes base (Button, Input, ...) — não recriar
    layout/               # Sidebar, Topbar
  config/                 # navigation.ts (os 13 módulos), app.ts
  lib/
    supabase/             # clients server/client + middleware de sessão
    auth/                 # sessão, usuário atual, papel, guard de permissão
    rbac/                 # tipos e matriz de permissões
    services/             # LEITURA
    actions/              # ESCRITA (+ errors.ts = ActionResult)
    utils.ts              # cn()
  modules/<domain>/       # tipos + schemas por domínio
  types/database.ts       # GERADO pelo Supabase (pnpm db:types)
supabase/
  migrations/             # SQL versionado (fonte da verdade do schema)
  config.toml
  seed.sql
```

## Decisões (e por quê)

- **App único, não monorepo:** menos superfície de erro; ideal para uma equipe
  pequena/IA tocar o projeto sem se perder.
- **Só PT-BR:** ferramenta interna brasileira — sem a complexidade de i18n.
- **Padrão service/action explícito:** separa leitura de escrita e dá um contrato
  de erro previsível (`ActionResult`), o que mantém o código consistente mesmo
  quando gerado por IA.
- **RLS sempre:** a segurança não pode depender só do app; o banco também barra.
