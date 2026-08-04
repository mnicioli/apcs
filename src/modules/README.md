# `src/modules/` — tipos e schemas por domínio

Cada módulo de negócio (clients, projects, resources, ...) tem aqui uma pasta
com **só tipos e validação** — nada de acesso a banco ou React:

```
modules/<domain>/
  <domain>.types.ts    # tipos de domínio (camelCase), desacoplados da Row do banco
  <domain>.schema.ts   # schemas Zod (validação compartilhada client + server)
```

A lógica de leitura fica em [`src/lib/services/`](../lib/services/) e a de
escrita em [`src/lib/actions/`](../lib/actions/).

**Exemplo de referência:** [`profile/`](./profile/). Veja também
[docs/HOW-TO-CREATE-A-MODULE.md](../../docs/HOW-TO-CREATE-A-MODULE.md).
