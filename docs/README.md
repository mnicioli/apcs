# Documentação — FAST Operation Cockpit

Índice da documentação do projeto. Comece pelo [CLAUDE.md](../CLAUDE.md) (regras
gerais) e pelo [SETUP.md](../SETUP.md) (como rodar).

> **Assumindo o projeto agora?** Leia primeiro o [HANDOFF.md](./HANDOFF.md) —
> estado atual, decisões, pendências e como continuar.

## Por onde começar

| Quero...                             | Leia                                                     |
| ------------------------------------ | -------------------------------------------------------- |
| Entender a arquitetura               | [ARCHITECTURE.md](./ARCHITECTURE.md)                     |
| Criar um módulo novo (passo a passo) | [HOW-TO-CREATE-A-MODULE.md](./HOW-TO-CREATE-A-MODULE.md) |
| Entender leitura vs escrita          | [SERVICE-ACTION-PATTERN.md](./SERVICE-ACTION-PATTERN.md) |
| Mexer no banco (tabelas, RLS)        | [SUPABASE.md](./SUPABASE.md)                             |
| Saber as convenções de código        | [CONVENTIONS.md](./CONVENTIONS.md)                       |
| Escrever testes                      | [TESTING.md](./TESTING.md)                               |
| Ver o roadmap dos 13 módulos         | [ROADMAP.md](./ROADMAP.md)                               |

## Skills (use no Claude Code com `/`)

- `/new-feature` — fluxo de ponta a ponta de uma tarefa.
- `/new-module` — criar um módulo de negócio seguindo o padrão.
- `/new-migration` — alterar o banco com RLS + tipos.
- `/pre-pr` — checagens antes do PR.
- `/review` e `/security` — revisões (rode em subagentes).
- `/testing` — escrever testes Vitest.
