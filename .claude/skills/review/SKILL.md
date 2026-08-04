---
name: review
description: Code review dos arquivos alterados seguindo os padrões do FAST Operation Cockpit. Use após implementar algo e antes de abrir o PR. Idealmente rode em um subagente. Verifica TypeScript, padrões service/action, Supabase, React/Next, acessibilidade e testes.
---

# review — code review dos padrões do projeto

1. Rode `git diff --name-only` (e `git diff`) para ver o que mudou.
2. Leia cada arquivo alterado e cheque os itens abaixo.
3. Gere um relatório com ✅ / ❌ por arquivo e um veredito final.

## Checklist

### TypeScript

- [ ] Sem `any` (use tipos específicos ou `unknown`).
- [ ] `import type { ... }` para imports só de tipo.
- [ ] Sem `console.log` esquecido.

### Padrão service / action

- [ ] Leitura em `src/lib/services/` (`server-only`, lança erro).
- [ ] Escrita em `src/lib/actions/` (`"use server"`, retorna `ActionResult`, **nunca throw**).
- [ ] Actions validam com Zod e chamam `assertPermission(...)` antes de escrever.
- [ ] Erros do banco passam por `mapPostgresError` (mensagem crua nunca vai ao usuário).
- [ ] Tipos/schemas do domínio em `src/modules/<domain>/`.

### Supabase

- [ ] `createClient` de `@/lib/supabase/server` em Server Components/Actions; de
      `@/lib/supabase/client` em Client Components.
- [ ] Tabela nova tem RLS habilitada e policies por papel.
- [ ] `service_role` **nunca** no frontend nem em `NEXT_PUBLIC_*`.
- [ ] `pnpm db:types` rodado se o schema mudou.

### React / Next

- [ ] Server Components por padrão; `"use client"` só quando necessário.
- [ ] Estados de loading e erro tratados em operações async.
- [ ] `redirect` de `next/navigation` em Server Components.

### UI / Acessibilidade

- [ ] Cores via tokens (`bg-primary`, `text-muted-foreground`) — sem cor fixa (`bg-blue-500`).
- [ ] Componentes base de `@/components/ui` (não recriar Button/Input).
- [ ] Todo input tem `<Label>`; HTML semântico; texto em PT-BR.

### Testes

- [ ] Lógica nova (validação, formatter, render condicional) tem teste Vitest ao lado.

## Veredito

**APROVADO** ou **PRECISA DE AJUSTES** + lista objetiva de correções.
