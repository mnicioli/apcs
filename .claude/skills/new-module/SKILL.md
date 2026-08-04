---
name: new-module
description: Cria um módulo de negócio novo (ex. Clientes, Projetos, Recursos) seguindo o padrão de referência do projeto. Use quando for implementar um dos módulos do roadmap (docs/ROADMAP.md) ou qualquer entidade CRUD nova com tabela própria no banco.
---

# new-module — criar um módulo seguindo o padrão

Use este fluxo para implementar um módulo do roadmap (ver
[docs/ROADMAP.md](../../../docs/ROADMAP.md)). **Implemente UM módulo por vez.**

> O módulo `profile` é o exemplo de referência. Antes de começar, leia:
> `src/modules/profile/`, `src/lib/services/profile.ts`,
> `src/lib/actions/profile.ts` e o formulário em `src/app/(app)/profile/`.

Vou chamar o domínio de `<domain>` (em inglês, ex.: `clients`). Os textos de UI
ficam em PT-BR (ex.: "Clientes").

## 1. Banco (migration + RLS)

Use a skill **`/new-migration`**. A tabela DEVE ter:

- [ ] `id uuid primary key default gen_random_uuid()`
- [ ] `created_at` / `updated_at timestamptz` + trigger de `updated_at`
- [ ] `alter table ... enable row level security;`
- [ ] Policies por papel usando os helpers `is_admin()` / `current_app_role()`
      (espelhe a matriz em `src/lib/rbac/rbac.config.ts`).

Depois: `pnpm db:push` (ou `db:reset` local) e **`pnpm db:types`** para
atualizar `src/types/database.ts`.

## 2. Tipos e validação — `src/modules/<domain>/`

- [ ] `<domain>.types.ts` — tipo de domínio (camelCase).
- [ ] `<domain>.schema.ts` — schema Zod do formulário (mensagens em PT-BR).

## 3. Permissões — `src/lib/rbac/`

- [ ] Adicione `<domain>.read` / `<domain>.write` em `rbac.types.ts`.
- [ ] Defina quais papéis têm cada uma em `rbac.config.ts` (alinhado com a RLS).

## 4. Leitura — `src/lib/services/<domain>.ts`

- [ ] `import "server-only";`
- [ ] `listX()` / `getXById()` — retorna o dado mapeado ou lança erro.

## 5. Escrita — `src/lib/actions/<domain>.ts`

- [ ] `"use server";`
- [ ] `createXAction` / `updateXAction` / `deleteXAction` — retornam `ActionResult`.
- [ ] Ordem: validar (Zod) → `assertPermission("<domain>.write")` → escrever →
      `mapPostgresError` → `revalidatePath`.

## 6. Telas — `src/app/(app)/<domain>/`

- [ ] `page.tsx` (Server Component) — chama o service e renderiza.
- [ ] `<domain>-form.tsx` (Client) — React Hook Form + Zod + chama a action
      (copie de `src/app/(app)/profile/profile-form.tsx`).

## 7. Navegação

- [ ] Em `src/config/navigation.ts`, vire o item do módulo para `available: true`.

## 8. Testes e fechamento

- [ ] **`/testing`** para a lógica nova (validação, mapeamentos).
- [ ] Volte para a skill **`/new-feature`** (Checkpoint 3 em diante) para validar, commitar e subir.
