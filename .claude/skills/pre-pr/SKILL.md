---
name: pre-pr
description: Roda todas as checagens obrigatórias antes de commitar/subir (lint, type-check, testes, build). Use sempre antes de "git commit" / "git push", ou quando o usuário disser que terminou uma tarefa.
---

# pre-pr — checagens antes de commitar

Projeto solo, fluxo direto na `main`: rode estas checagens **antes de cada
commit**. Execute na ordem e gere o relatório final. Pare e reporte o que falhar.

## 1. Lint

```bash
pnpm lint
```

## 2. Type Check

```bash
pnpm type-check
```

## 3. Testes

```bash
pnpm test
```

## 4. Build

```bash
pnpm build
```

> O build usa valores dummy de Supabase no CI; localmente precisa do `.env.local`.

## 5. Conferência visual (se mexeu em UI)

Se houver Chrome DevTools MCP disponível, abra as páginas afetadas em
`localhost:3000` e confira **desktop (1440×900)** e **mobile (375×812)**:
sem overflow, textos não cortam, estados de loading/erro presentes.

## Relatório final

```
## Pre-PR — checagens

| Checagem      | Status |
|---------------|--------|
| Lint          | ✅/❌  |
| Type Check    | ✅/❌  |
| Testes        | ✅/❌  |
| Build         | ✅/❌  |
| Visual (se UI)| ✅/❌  |

### Problemas e como corrigir
- ...
```

Se tudo passou, pode commitar. Se não, liste exatamente o que corrigir antes de commitar.
