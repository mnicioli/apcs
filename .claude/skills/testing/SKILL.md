---
name: testing
description: Escreve testes Vitest para a lógica nova (validação, formatters, render condicional, mapeamentos). Use após implementar uma feature, antes do PR. Foca no que é barato e valioso de testar; evita testar detalhe de implementação.
---

# testing — escrever testes com Vitest

O projeto usa **Vitest** + **Testing Library**. Testes ficam ao lado do código
testado: `arquivo.ts` → `arquivo.test.ts`. Veja o exemplo de referência em
`src/lib/auth/session.test.ts`.

## O que VALE testar

- [ ] Validação de schema Zod (entradas válidas e inválidas).
- [ ] Funções puras: formatters, cálculos, mapeamentos Row → tipo de domínio.
- [ ] Lógica de RBAC (`hasPermission` para papéis-chave).
- [ ] Render condicional de componentes (estado de erro, vazio, loading).

## O que NÃO vale

- Não teste a biblioteca (Supabase, Next, React) em si.
- Não teste detalhe de implementação (nomes de variáveis internas).
- Fluxo de banco real / navegação de ponta a ponta é caro — deixe para depois
  (E2E não está configurado nesta casca; ver docs/TESTING.md).

## Como rodar

```bash
pnpm test          # roda uma vez
pnpm test:watch    # modo watch enquanto desenvolve
```

## Passos

1. Identifique a lógica nova testável no diff.
2. Para cada uma, liste 2-4 casos (feliz + bordas) e escreva o `.test.ts`.
3. Rode `pnpm test` e garanta verde antes de seguir.
