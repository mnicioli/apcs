# `src/lib/services/` — LEITURA

Funções que **leem** dados do Supabase. Regras:

- Começam com `import "server-only";` (nunca rodam no navegador).
- Retornam o dado mapeado para o tipo de domínio, ou **lançam** erro (`throw`).
- **Nunca escrevem** no banco — isso é trabalho das [actions](../actions/).
- Sempre filtram pelo que o usuário pode ver; a RLS é a segunda camada.

**Referência:** [`profile.ts`](./profile.ts). Detalhes em
[docs/SERVICE-ACTION-PATTERN.md](../../../docs/SERVICE-ACTION-PATTERN.md).
