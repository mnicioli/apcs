# Testes

A casca usa **Vitest** + **Testing Library** (rápidos, rodam sem navegador).

```bash
pnpm test          # roda uma vez (usado no CI)
pnpm test:watch    # modo watch durante o desenvolvimento
pnpm test:coverage # com cobertura
```

## Onde ficam

Ao lado do código: `arquivo.ts` → `arquivo.test.ts`.
Exemplo de referência: [`src/lib/auth/session.test.ts`](../src/lib/auth/session.test.ts).

## O que testar (custo baixo, valor alto)

- Validação de schema Zod (entradas válidas e inválidas).
- Funções puras: formatters, cálculos, mapeamento Row → tipo de domínio.
- RBAC: `hasPermission(role, permission)` para os papéis-chave.
- Render condicional de componentes (erro, vazio, loading).

## O que NÃO testar

- A biblioteca em si (Supabase, Next, React).
- Detalhes de implementação (nomes internos).
- Fluxo real de banco / navegação ponta a ponta.

## E os testes E2E (Playwright)?

Não vêm configurados nesta casca, de propósito — eles baixam navegadores e
adicionam complexidade que não compensa no início. Quando o produto amadurecer e
houver fluxos críticos (login, criar projeto), vale adicionar Playwright. O
caminho: `pnpm add -D @playwright/test`, `npx playwright install`, criar
`playwright.config.ts` e uma pasta `e2e/`. Deixe para essa fase.
