# Como criar um módulo (passo a passo)

Este é o guia prático para implementar um módulo do [roadmap](./ROADMAP.md).
Vamos usar **Clientes** (`clients`) como exemplo concreto. Para os outros
módulos, troque o nome do domínio e os campos.

> Atalho: no Claude Code, rode a skill **`/new-module`** — ela conduz estes
> mesmos passos. Este documento é a explicação detalhada por trás dela.
>
> O módulo `profile` já implementado é o **espelho** de tudo abaixo. Sempre que
> tiver dúvida de "como era mesmo?", abra os arquivos de `profile`.

---

## Passo 1 — Banco (tabela + RLS)

```bash
pnpm db:migration:new create_clients
```

Edite o arquivo criado em `supabase/migrations/`:

```sql
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clients enable row level security;

create policy "clients_select" on public.clients for select
  using (public.current_app_role() in ('admin','ceo','comercial','pm'));

create policy "clients_write" on public.clients for all
  using (public.current_app_role() in ('admin','comercial'))
  with check (public.current_app_role() in ('admin','comercial'));

create trigger on_clients_updated
  before update on public.clients
  for each row execute procedure public.handle_updated_at();
```

Aplique e gere os tipos:

```bash
pnpm db:push     # ou pnpm db:reset (local, recria tudo)
pnpm db:types    # atualiza src/types/database.ts
```

## Passo 2 — Tipos e validação (`src/modules/clients/`)

`clients.types.ts`:

```ts
export interface Client {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
}
```

`clients.schema.ts`:

```ts
import { z } from "zod";

export const clientFormSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do cliente."),
  email: z.string().email("E-mail inválido.").optional().or(z.literal("")),
});

export type ClientFormData = z.infer<typeof clientFormSchema>;
```

## Passo 3 — Permissões (`src/lib/rbac/`)

Em `rbac.types.ts`, adicione ao tipo `Permission`: `"clients.read" | "clients.write"`
(já existem neste projeto — para um módulo novo de verdade, adicione os seus).
Em `rbac.config.ts`, confirme quais papéis têm cada permissão (deve bater com a RLS).

## Passo 4 — Leitura (`src/lib/services/clients.ts`)

Copie a estrutura de `src/lib/services/profile.ts`:

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Client } from "@/modules/clients/clients.types";

export async function listClients(): Promise<Client[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, email, created_at")
    .order("name")
    .returns<{ id: string; name: string; email: string | null; created_at: string }[]>();

  if (error) {
    console.error(`[clients] listClients falhou: ${error.message}`);
    throw error;
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    createdAt: r.created_at,
  }));
}
```

## Passo 5 — Escrita (`src/lib/actions/clients.ts`)

Copie a estrutura de `src/lib/actions/profile.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertPermission } from "@/lib/auth/assert-permission";
import { fail, mapPostgresError, ok, type ActionResult } from "@/lib/actions/errors";
import { clientFormSchema, type ClientFormData } from "@/modules/clients/clients.schema";

export async function createClientAction(
  input: ClientFormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = clientFormSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<{ id: string }>("clients.write");
  if (denied) return denied;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({ name: parsed.data.name, email: parsed.data.email || null } as never)
    .select("id")
    .single();

  if (error || !data) {
    console.error(`[clients.create] falhou: ${error?.message}`);
    return { ok: false, error: mapPostgresError(error) };
  }

  revalidatePath("/clients");
  return ok({ id: (data as { id: string }).id });
}
```

## Passo 6 — Telas (`src/app/(app)/clients/`)

- `page.tsx` (Server Component): chama `listClients()` e renderiza a lista.
- `client-form.tsx` (Client Component): copie `src/app/(app)/profile/profile-form.tsx`
  (React Hook Form + Zod + chamar a action + tratar `ActionResult`).

## Passo 7 — Ligar na navegação

Em `src/config/navigation.ts`, mude o item **Clientes** para `available: true`.

## Passo 8 — Testar e abrir PR

```bash
pnpm lint && pnpm type-check && pnpm test && pnpm build
```

Rode `/review` e `/security` (em subagentes), corrija o que aparecer, rode
`/pre-pr` e commite na `main`. Pronto — um módulo a menos no roadmap. 🎉
