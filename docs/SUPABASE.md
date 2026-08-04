# Supabase

O backend é o Supabase: **Auth** (e-mail + senha), **Postgres** e **RLS**.

## Setup inicial (uma vez)

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Copie a URL e a `anon key` (Project Settings → API) para o `.env.local`
   (veja [SETUP.md](../SETUP.md)).
3. Instale o CLI e linke o projeto:
   ```bash
   pnpm exec supabase login
   pnpm db:link        # cole o project-ref quando pedir
   ```
4. Aplique as migrations:
   ```bash
   pnpm db:push
   ```
5. Gere os tipos:
   ```bash
   pnpm db:types
   ```
6. Crie seu usuário pela tela de login do app e promova-o a admin no SQL Editor:
   ```sql
   update public.profiles set role = 'admin' where email = 'voce@empresa.com';
   ```

## Regras de ouro

- **Schema só por migration.** Nunca altere tabela/coluna/policy pelo Dashboard
  — some do histórico e quebra os outros ambientes. Use `/new-migration`.
- **RLS sempre.** Toda tabela nova precisa de `enable row level security` e
  policies. Sem policy = ninguém acessa (ou pior, todo mundo, se RLS desligada).
- **`service_role` nunca no frontend** nem em variável `NEXT_PUBLIC_*`. Ela
  ignora RLS — vazá-la é vazar o banco inteiro.
- **Regenere os tipos** (`pnpm db:types`) após qualquer mudança de schema.

## RLS por papel — o padrão

Os helpers `current_app_role()` e `is_admin()` (criados na migration inicial)
são `SECURITY DEFINER` de propósito: leem `profiles` ignorando RLS, o que evita
a **recursão infinita** que aconteceria se uma policy de `profiles` consultasse
`profiles` por um caminho sujeito a RLS. Use sempre os helpers nas policies.

```sql
create policy "clients_select" on public.clients for select
  using (public.current_app_role() in ('admin','ceo','comercial','pm'));
```

As policies devem refletir a matriz de [`rbac.config.ts`](../src/lib/rbac/rbac.config.ts).

## Papéis (`app_role`)

`admin`, `ceo`, `pm`, `tech_lead`, `comercial`, `financeiro`, `viewer`.
Novos usuários entram como `viewer` (deny-by-default) — um admin promove depois.
Ao adicionar um papel, atualize **os dois lugares**: o enum na migration e o
`VALID_ROLES` em [`rbac.types.ts`](../src/lib/rbac/rbac.types.ts).

## Ambientes (sugestão)

A casca usa **um** projeto Supabase. Quando for para produção, o recomendado é
ter **dois** projetos (um de dev/staging e um de produção) e promover migrations
do dev para o prod. Por enquanto, mantenha simples: um projeto só.
