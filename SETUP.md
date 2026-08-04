# Setup — como rodar o projeto

## Pré-requisitos

- **Node 20+** — verifique com `node --version`.
- **pnpm 9+** — instale com `npm install -g pnpm` e verifique `pnpm --version`.
- **Git** e uma conta no **[Supabase](https://supabase.com)**.

## 1. Instalar dependências

```bash
pnpm install
```

(Isso também configura os hooks do Git via Husky automaticamente.)

## 2. Variáveis de ambiente

Copie o exemplo e preencha com os dados do seu projeto Supabase
(Dashboard → Project Settings → API):

```bash
# Mac/Linux
cp .env.example .env.local
# Windows PowerShell
Copy-Item .env.example .env.local
```

Preencha `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## 3. Banco de dados (Supabase)

```bash
pnpm exec supabase login
pnpm db:link        # cole o "project ref" do seu projeto quando pedir
pnpm db:push        # aplica as migrations (cria a tabela profiles + RLS)
pnpm db:types       # gera os tipos em src/types/database.ts
```

## 4. Rodar

```bash
pnpm dev
```

Abra http://localhost:3000. Você será mandado para `/login`.

## 5. Criar o primeiro usuário (admin)

1. Como `enable_signup` está ligado, crie seu usuário pela autenticação do
   Supabase (Dashboard → Authentication → Add user) ou pelo fluxo de signup.
2. Promova-o a admin no **SQL Editor** do Supabase:

```sql
update public.profiles set role = 'admin' where email = 'voce@empresa.com';
```

3. Faça login no app.

## Comandos do dia a dia

| Comando           | O que faz                      |
| ----------------- | ------------------------------ |
| `pnpm dev`        | Sobe o app em desenvolvimento  |
| `pnpm lint`       | Verifica problemas de código   |
| `pnpm type-check` | Verifica os tipos (TypeScript) |
| `pnpm test`       | Roda os testes                 |
| `pnpm build`      | Build de produção              |
| `pnpm format`     | Formata o código (Prettier)    |
| `pnpm db:types`   | Regenera os tipos do banco     |

## (Opcional) Permissões do Claude Code

Para o Claude Code pedir menos confirmações em comandos seguros, crie o arquivo
`.claude/settings.json` com o conteúdo abaixo (ou use o comando `/permissions`).
**Revise antes de aplicar** — você está autorizando esses comandos a rodarem sem
perguntar:

```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm install)",
      "Bash(pnpm dev:*)",
      "Bash(pnpm build:*)",
      "Bash(pnpm lint:*)",
      "Bash(pnpm type-check:*)",
      "Bash(pnpm test:*)",
      "Bash(pnpm format:*)",
      "Bash(pnpm db:*)",
      "Bash(git status)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git branch:*)",
      "Bash(git checkout:*)"
    ],
    "ask": ["Bash(git push:*)", "Bash(supabase db push:*)"],
    "deny": ["Read(.env)", "Read(.env.local)"]
  }
}
```
