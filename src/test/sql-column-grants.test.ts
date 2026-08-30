import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * COLUNA NOVA EM TABELA COM GRANT DE COLUNA — a armadilha, conferida em todas as
 * migrations.
 *
 * ⚠️ NASCEU DE UM DEFEITO EM PRODUÇÃO. `events` tem grants por COLUNA:
 *
 *     revoke update on public.events from authenticated;
 *     grant update (name, location, ...) on public.events to authenticated;
 *
 * A migration da descrição do evento acrescentou `events.description` e não
 * acrescentou a coluna a essa lista. `update_event` é SECURITY INVOKER, então
 * o UPDATE roda com o privilégio de quem chamou — e escrever numa coluna sem
 * grant é **42501, permission denied**. Que a action traduz para "Você não tem
 * permissão para esta ação".
 *
 * O sintoma foi cruel: um ADMINISTRADOR, com 33 de 33 permissões na Matriz de
 * Acesso, não conseguia salvar a edição de um evento. Toda a investigação
 * apontava para o RBAC — e o RBAC estava certo o tempo todo. O problema era um
 * privilégio de coluna no Postgres, três camadas abaixo.
 *
 * ⚠️ POR QUE NENHUMA OUTRA BARREIRA PEGA ISSO: a coluna existe, o tipo bate, a
 * função compila, a policy de RLS passa (ela olha a LINHA, não as colunas). Só
 * falha na hora de gravar, para quem não é dono da tabela — ou seja, nunca no
 * `psql` de quem rodou a migration, sempre no navegador de quem usa o sistema.
 *
 * Este teste lê texto de SQL, o que é grosseiro, e responde uma pergunta só, o
 * que o torna preciso: uma coluna nova numa tabela com grant de coluna precisa
 * aparecer num `grant` — ou ser gerada, que não se escreve.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const arquivos = readdirSync(MIGRATIONS)
  .filter((nome) => nome.endsWith(".sql"))
  .sort();

const sqlPorArquivo = arquivos.map(
  (arquivo) => [arquivo, readFileSync(join(MIGRATIONS, arquivo), "utf8")] as const,
);

const todoSql = sqlPorArquivo.map(([, sql]) => sql).join("\n");

/**
 * As tabelas em que o UPDATE foi revogado e devolvido coluna a coluna. São elas
 * — e só elas — que têm a armadilha.
 */
const comGrantDeColuna = new Set(
  [...todoSql.matchAll(/revoke\s+update\s+on\s+public\.(\w+)\s+from/gi)].map(
    (achado) => achado[1] ?? "",
  ),
);

/** Toda coluna citada em algum `grant ... (col, col) on public.<tabela>`. */
function colunasComGrant(): Map<string, Set<string>> {
  const porTabela = new Map<string, Set<string>>();

  for (const comando of todoSql.split(";")) {
    if (!/\bgrant\b/i.test(comando)) continue;

    const tabela = /on\s+(?:table\s+)?public\.(\w+)/i.exec(comando)?.[1];
    if (!tabela) continue;

    const conjunto = porTabela.get(tabela) ?? new Set<string>();
    for (const lista of comando.matchAll(/(?:update|insert)\s*\(([^)]*)\)/gi)) {
      for (const coluna of (lista[1] ?? "").split(",")) {
        const nome = coluna.trim();
        if (/^\w+$/.test(nome)) conjunto.add(nome);
      }
    }
    porTabela.set(tabela, conjunto);
  }

  return porTabela;
}

interface ColunaNova {
  arquivo: string;
  tabela: string;
  coluna: string;
}

/** As colunas acrescentadas por `alter table ... add column` depois da criação. */
function colunasAcrescentadas(): ColunaNova[] {
  const novas: ColunaNova[] = [];

  for (const [arquivo, sql] of sqlPorArquivo) {
    for (const alteracao of sql.matchAll(
      /alter\s+table\s+(?:only\s+)?public\.(\w+)([\s\S]*?);/gi,
    )) {
      const tabela = alteracao[1] ?? "";
      const corpo = alteracao[2] ?? "";
      if (!comGrantDeColuna.has(tabela)) continue;

      for (const adicao of corpo.matchAll(
        /add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)([^,]*)/gi,
      )) {
        const coluna = adicao[1] ?? "";
        // Coluna GERADA não se escreve — grant nela não existe e não faz falta.
        if (/generated\s+always\s+as/i.test(adicao[2] ?? "")) continue;
        novas.push({ arquivo, tabela, coluna });
      }
    }
  }

  return novas;
}

/**
 * As colunas que ficam SEM grant de propósito — com o motivo, que é o que
 * separa uma exceção de uma exceção esquecida.
 *
 * ⚠️ A saída padrão para um caso novo NÃO é entrar nesta lista: é acrescentar o
 * grant. Só entra aqui quem nunca é escrito pelo `authenticated` — porque quem
 * escreve é o `service_role`, que não passa por grant de coluna nenhum.
 */
const SEM_GRANT_DE_PROPOSITO: Record<string, string> = {
  "lectures.idempotency_key":
    "Escrita só por `create_lecture_request`, chamada com service_role pelo chatbot " +
    "(src/lib/services/lecture-chatbot.ts). Nenhuma tela interna toca nela.",
};

const grants = colunasComGrant();
const novas = colunasAcrescentadas().filter(
  (nova) => !(`${nova.tabela}.${nova.coluna}` in SEM_GRANT_DE_PROPOSITO),
);

describe("grants de coluna", () => {
  it("o teste está de fato lendo as migrations", () => {
    // Sem isto, uma expressão regular quebrada transformaria a bateria num
    // teste que passa sobre listas vazias — o pior tipo de guarda.
    expect(arquivos.length).toBeGreaterThan(10);
    expect(comGrantDeColuna.has("events")).toBe(true);
    expect(comGrantDeColuna.has("lectures")).toBe(true);
    expect(novas.length).toBeGreaterThan(0);
  });

  it.each(novas.map((n) => [`${n.tabela}.${n.coluna} (${n.arquivo})`, n] as const))(
    "%s aparece num grant",
    (_rotulo, nova) => {
      expect(
        grants.get(nova.tabela) ?? new Set<string>(),
        `public.${nova.tabela}.${nova.coluna} foi acrescentada em ${nova.arquivo}, mas a tabela ` +
          "tem grant por COLUNA e esta ficou de fora. Quem escrever nela leva 42501 " +
          '("permission denied"), que a tela mostra como "Você não tem permissão para esta ação". ' +
          `Acrescente: grant update (${nova.coluna}) on public.${nova.tabela} to authenticated;`,
      ).toContain(nova.coluna);
    },
  );
});
