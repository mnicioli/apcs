---
name: new-migration
description: Cria uma migration SQL nova no Supabase com RLS por papel e regenera os tipos. Use sempre que precisar criar/alterar tabela, coluna, enum, função ou policy no banco. Nunca altere o schema pelo Dashboard — sempre por migration.
---

# new-migration — alterar o schema com segurança

> REGRA DE OURO: **toda** mudança de schema entra como migration versionada.
> Nunca edite o banco pelo Dashboard do Supabase (some do histórico e quebra
> os outros ambientes).

## 1. Criar o arquivo

```bash
pnpm db:migration:new <nome_descritivo>   # ex.: create_clients
```

Isso cria `supabase/migrations/<timestamp>_<nome>.sql`.

## 2. Escrever o SQL

Use a migration inicial (`supabase/migrations/20260603000000_init.sql`) como
referência. Para uma tabela nova, o mínimo é:

```sql
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clients enable row level security;

-- Leitura: quem tem o papel certo (espelhe src/lib/rbac/rbac.config.ts)
create policy "clients_select" on public.clients for select
  using (public.current_app_role() in ('admin','ceo','comercial','pm'));

-- Escrita: papéis com permissão de write
create policy "clients_write" on public.clients for all
  using (public.current_app_role() in ('admin','comercial'))
  with check (public.current_app_role() in ('admin','comercial'));

-- updated_at automático
create trigger on_clients_updated
  before update on public.clients
  for each row execute procedure public.handle_updated_at();
```

Checklist:

- [ ] `enable row level security` presente.
- [ ] Pelo menos uma policy de SELECT e uma de escrita.
- [ ] Policies coerentes com a matriz de `rbac.config.ts`.
- [ ] Trigger de `updated_at` (a função `handle_updated_at` já existe).

## 3. Aplicar

- Local: `pnpm db:reset` (recria do zero com as migrations + seed).
- Remoto: `pnpm db:push` (aplica as migrations pendentes no projeto linkado).

## 4. Regenerar os tipos (OBRIGATÓRIO)

```bash
pnpm db:types
```

Isso reescreve `src/types/database.ts`. Sem isso, o TypeScript não conhece a
tabela nova. **Nunca** edite esse arquivo à mão.
