# Convenções de código

## Idioma

- **Código em inglês**: nomes de arquivos, funções, variáveis, tipos, rotas,
  tabelas e colunas. Ex.: `listClients`, `/clients`, `created_at`.
- **PT-BR só no que o usuário vê**: textos de UI, rótulos, mensagens de erro
  exibidas. E na documentação/comentários.

## Nomes

| O quê                   | Convenção  | Exemplo                   |
| ----------------------- | ---------- | ------------------------- |
| Componente React        | PascalCase | `ProfileForm`             |
| Arquivo de componente   | kebab-case | `profile-form.tsx`        |
| Função / variável       | camelCase  | `getCurrentProfile`       |
| Tipo / interface        | PascalCase | `ActionResult`, `Profile` |
| Rota / pasta            | kebab-case | `/health-score`           |
| Tabela / coluna (banco) | snake_case | `created_at`              |

## TypeScript

- **Proibido `any`** (o ESLint barra). Use o tipo certo ou `unknown`.
- Imports de tipo com `import type { ... }`.
- `strict` ligado, incluindo `noUncheckedIndexedAccess` — trate `undefined`.

## React / Next

- **Server Components por padrão.** Só use `"use client"` quando precisar de
  estado, evento ou hook de browser.
- `redirect` de `next/navigation` em Server Components.
- Sempre trate loading e erro em operações assíncronas.

## Estilo / UI

- **Tokens, não cores fixas.** Use `bg-primary`, `text-muted-foreground`,
  `border-border` — nunca `bg-blue-500`. Os tokens estão em `src/app/globals.css`.
- Reutilize os componentes de `src/components/ui/` — não recrie Button/Input.
- Todo input tem `<Label>`; use HTML semântico (`button`, `nav`, `main`).

## Commits (Conventional Commits)

`tipo(escopo): descrição` — ex.: `feat(clients): adiciona cadastro de clientes`.
Tipos: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`.
O **commitlint** valida automaticamente (via Husky). Não use `--no-verify`.

## Erros conhecidos / workarounds

- **`.returns<T>()` em selects e `as never` em insert/update**: são contornos
  para um descompasso de generics entre `@supabase/ssr` e `@supabase/supabase-js`
  (sem eles, o `from()` pode inferir `never`). São inofensivos e mantêm o código
  tipado. Use o mesmo padrão dos exemplos de referência (`profile.ts`). Quando os
  pacotes alinharem os generics, dá para remover.
