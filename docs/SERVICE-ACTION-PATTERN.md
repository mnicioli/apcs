# Padrão Service / Action

A regra que mantém o código consistente: **leitura ≠ escrita**, e cada uma tem
um lugar e um contrato.

## Service = LEITURA (`src/lib/services/`)

- Começa com `import "server-only";`.
- Lê do Supabase e **mapeia** a linha (snake_case) para o tipo de domínio (camelCase).
- Em caso de erro, **lança** (`throw`) — quem chama decide como tratar.
- Nunca escreve.

Referência: [`src/lib/services/profile.ts`](../src/lib/services/profile.ts).

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function listClients(): Promise<Client[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, created_at")
    .order("name")
    .returns<{ id: string; name: string; created_at: string }[]>();

  if (error) {
    console.error(`[clients] listClients falhou: ${error.message}`);
    throw error;
  }
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
}
```

## Action = ESCRITA (`src/lib/actions/`)

- Começa com `"use server";`.
- **Sempre** retorna `ActionResult<T>` — **nunca** lança.
- Ordem fixa dos passos:

1. **Validar** com Zod (`schema.safeParse`). Falhou → `fail("invalidInput")`.
2. **Permissão**: `const denied = await assertPermission<T>("clients.write"); if (denied) return denied;`
3. **Autenticar**: pegar o usuário; sem usuário → `fail("forbidden")`.
4. **Escrever** no Supabase.
5. **Mapear erro**: `if (error) return { ok: false, error: mapPostgresError(error) };` (e logar).
6. **Revalidar**: `revalidatePath("/clients");` e retornar `ok(data)`.

Referência: [`src/lib/actions/profile.ts`](../src/lib/actions/profile.ts).

## Por que nunca lançar nas actions?

Porque o componente cliente precisa diferenciar sucesso de erro e mostrar a
mensagem certa, sem que a mensagem crua do banco (que pode vazar nomes de
tabela/constraint) chegue ao usuário. O contrato `ActionResult` resolve isso:

```ts
const result = await createClientAction(values);
if (result.ok) {
  // sucesso → result.data
} else {
  // erro → ACTION_ERROR_MESSAGES[result.error.code]
}
```

Os códigos e mensagens estão em [`src/lib/actions/errors.ts`](../src/lib/actions/errors.ts).

## No client (formulário)

React Hook Form + Zod (o **mesmo** schema do server) + chamar a action dentro de
`useTransition`. Referência: [`src/app/(app)/profile/profile-form.tsx`](<../src/app/(app)/profile/profile-form.tsx>).
