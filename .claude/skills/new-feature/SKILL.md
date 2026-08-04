---
name: new-feature
description: Fluxo guiado para implementar qualquer tarefa/feature no FAST Operation Cockpit do início ao PR. Use ao começar uma nova tarefa, feature, correção ou alteração. Garante branch correta, padrões, testes e checagens antes de abrir PR.
---

# new-feature — fluxo de ponta a ponta

Siga os checkpoints na ordem. Cada um é um portão; não pule sem declarar por quê.
O objetivo não é burocracia — é não deixar o essencial escapar.

## Checkpoint 0 — Escopo (antes de escrever código)

Projeto solo: trabalha-se direto na `main` (não precisa criar branch).

- [ ] Entendeu o que precisa ser feito. **Se estiver ambíguo, PARE e pergunte ao usuário.**
- [ ] A tarefa é pequena e focada (uma coisa de cada vez).

## Checkpoint 1 — Implementação

- [ ] É um módulo de negócio novo (Clientes, Projetos, ...)? Use a skill **`/new-module`**.
- [ ] Mudou o schema do banco? Use a skill **`/new-migration`** e rode `pnpm db:types`.
- [ ] Seguiu o padrão: leitura em `src/lib/services/`, escrita em `src/lib/actions/`
      (sempre `ActionResult`), tipos/validação em `src/modules/<domain>/`.
- [ ] Server Components por padrão; `"use client"` só quando precisa de interação.
- [ ] Texto visível ao usuário em **PT-BR**. Nada de cor fixa (`bg-blue-500`) — use tokens.

## Checkpoint 2 — Testes

Se a mudança é só docs/config, pode pular (declare isso). Senão:

- [ ] Use a skill **`/testing`** para cobrir a lógica nova com Vitest.

## Checkpoint 3 — Validação local antes do push

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

- [ ] Tudo verde. Se algo falhar, **corrija antes de seguir** (não empurre quebrado).
- [ ] Rodou `pnpm dev` e conferiu a tela no navegador (desktop e mobile).

## Checkpoint 4 — Revisão (em subagentes)

Delegue para não encher o contexto do chat principal:

- [ ] **`/review`** (qualidade e padrões) e **`/security`** (RLS, segredos, XSS).
- [ ] Corrija as observações que fizerem sentido **antes** de abrir o PR.

## Checkpoint 5 — Commitar e subir

```bash
git add -A
git commit -m "feat(escopo): ..."   # conventional commits (o commitlint valida)
git push
```

- [ ] Rodou `/pre-pr` e estava tudo verde **antes** de commitar.
- [ ] Mensagem em conventional commits (`feat(...)`, `fix(...)`, `chore(...)`).
- [ ] Após o push, confira o CI (GitHub Actions) verde — é a rede de segurança.
