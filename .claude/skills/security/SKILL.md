---
name: security
description: Revisão de segurança dos arquivos alterados e da configuração (RLS, segredos, service_role, XSS, redirects). Use antes de abrir o PR de qualquer mudança que toque banco, auth, env ou formulários. Idealmente rode em um subagente.
---

# security — revisão de segurança

1. `git diff --name-only` para ver o que mudou.
2. Cheque cada item abaixo nos arquivos alterados e na config.
3. Gere o relatório por severidade.

## Banco / Supabase

- [ ] RLS habilitada em TODAS as tabelas (`enable row level security`).
- [ ] Toda tabela com policies — nenhuma tabela exposta sem policy.
- [ ] Policies usam `auth.uid()` / `is_admin()` / `current_app_role()` para filtrar.
- [ ] `SECURITY DEFINER` só em funções que precisam (e com `set search_path = ''`).
- [ ] Nenhuma escalada de privilégio (ex.: usuário comum mudar o próprio `role`).

## Segredos / env

- [ ] `service_role` **nunca** no código frontend nem em `NEXT_PUBLIC_*`.
- [ ] `.env` / `.env.local` no `.gitignore` (só `.env.example` versionado).
- [ ] Sem chave/senha/token hardcoded; sem segredo em `console.log`.

## Autenticação

- [ ] Rotas protegidas verificam `supabase.auth.getUser()` (não só `getSession()`).
- [ ] O middleware renova a sessão e protege as rotas.

## Frontend

- [ ] Sem `dangerouslySetInnerHTML` (ou conteúdo sanitizado).
- [ ] Inputs validados com Zod no client **e** no server (action).
- [ ] Sem stack trace / mensagem crua de erro exposta ao usuário.
- [ ] Links externos com `rel="noopener noreferrer"`; sem redirect aberto.

## Dependências

```bash
pnpm audit
```

## Relatório

```
## 🔒 Segurança

### Crítico 🔴
### Alto ⚠️
### Médio 🟡
### OK ℹ️
```
