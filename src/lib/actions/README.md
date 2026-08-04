# `src/lib/actions/` — ESCRITA

Server Actions que **alteram** dados (create/update/delete). Regras:

- Começam com a diretiva `"use server";`.
- **Sempre** retornam `ActionResult<T>` ([errors.ts](./errors.ts)) — **nunca** `throw`.
- Ordem obrigatória: **validar (Zod) → checar permissão (`assertPermission`) →
  autenticar → escrever → mapear erro (`mapPostgresError`) → `revalidatePath`**.
- Nunca expõem a mensagem crua do banco ao usuário.

**Referência:** [`profile.ts`](./profile.ts). Detalhes em
[docs/SERVICE-ACTION-PATTERN.md](../../../docs/SERVICE-ACTION-PATTERN.md).
