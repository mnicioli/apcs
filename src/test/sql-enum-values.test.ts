import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * VALOR DE ENUM CITADO POR UMA FUNÇÃO QUE O BANCO NÃO CONHECE — a armadilha,
 * conferida em todas as migrations.
 *
 * ⚠️ POR QUE ELA É INVISÍVEL ATÉ ALGUÉM CLICAR. O PL/pgSQL planeja cada comando
 * na PRIMEIRA VEZ que aquele comando executa, e não na criação da função. Um
 * corpo que diz
 *
 *     perform public.log_admin_action('user_updated'::public.admin_audit_action, ...);
 *
 * é aceito sem uma palavra mesmo que `user_updated` não exista no enum. A função
 * é criada, a migration passa, a tela abre, a lista carrega. O erro
 * (`22P02: invalid input value for enum`) só aparece no dia em que alguém
 * percorre aquele caminho — e chega traduzido como "Ocorreu um erro inesperado.
 * Tente novamente.", que manda a pessoa repetir a única coisa que nunca vai
 * funcionar.
 *
 * ⚠️ E TEM UMA SEGUNDA ARMADILHA, OPOSTA: `alter type ... add value` e o USO do
 * valor novo não podem estar na MESMA migration. O Postgres recusa com "unsafe
 * use of new value of enum type" — e é por isso que este projeto tem arquivos
 * de enum separados (`20260829140000_member_edit_enums.sql`,
 * `20260831000000_admin_user_enums.sql`). Juntá-los "para simplificar" quebra a
 * migration. Este teste guarda a separação.
 *
 * Ele lê texto de SQL, o que é grosseiro, e responde duas perguntas objetivas,
 * o que o torna preciso.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const arquivos = readdirSync(MIGRATIONS)
  .filter((nome) => nome.endsWith(".sql"))
  .sort();

const sqlPorArquivo = arquivos.map(
  (arquivo) => [arquivo, readFileSync(join(MIGRATIONS, arquivo), "utf8")] as const,
);

interface Declaracao {
  arquivo: string;
  /** `create type` declara e já libera o uso; `add value` só libera na migration seguinte. */
  usavelNoMesmoArquivo: boolean;
}

/** Onde cada `enum.valor` passa a existir. */
const declarado = new Map<string, Declaracao>();

/** Cada `'valor'::public.enum` encontrado num corpo de função ou comando. */
const usos: { enumName: string; valor: string; arquivo: string }[] = [];

for (const [arquivo, sql] of sqlPorArquivo) {
  // create type public.X as enum ('a', 'b', ...)
  // Usar um valor no MESMO arquivo é seguro: a restrição do Postgres é sobre
  // `add value` num tipo que já existia, não sobre um tipo recém-criado.
  for (const criacao of sql.matchAll(/create\s+type\s+public\.(\w+)\s+as\s+enum\s*\(([^)]*)\)/gi)) {
    const nome = criacao[1] ?? "";
    for (const valor of (criacao[2] ?? "").matchAll(/'([^']+)'/g)) {
      const chave = `${nome}.${valor[1]}`;
      if (!declarado.has(chave)) declarado.set(chave, { arquivo, usavelNoMesmoArquivo: true });
    }
  }

  // alter type public.X add value [if not exists] 'v'
  for (const adicao of sql.matchAll(
    /alter\s+type\s+public\.(\w+)\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'/gi,
  )) {
    const chave = `${adicao[1]}.${adicao[2]}`;
    if (!declarado.has(chave)) declarado.set(chave, { arquivo, usavelNoMesmoArquivo: false });
  }

  // alter type public.X rename value 'antigo' to 'novo'
  for (const troca of sql.matchAll(
    /alter\s+type\s+public\.(\w+)\s+rename\s+value\s+'([^']+)'\s+to\s+'([^']+)'/gi,
  )) {
    const chave = `${troca[1]}.${troca[3]}`;
    // Renomear não cria valor novo: a linha já existe, só muda o rótulo. Por
    // isso é usável na mesma transação.
    if (!declarado.has(chave)) declarado.set(chave, { arquivo, usavelNoMesmoArquivo: true });
  }

  // 'valor'::public.X — o cast que só é planejado quando o comando executa.
  for (const uso of sql.matchAll(/'([^']+)'\s*::\s*public\.(\w+)/g)) {
    usos.push({ enumName: uso[2] ?? "", valor: uso[1] ?? "", arquivo });
  }
}

/** Só os tipos que sabemos serem enums — um cast para domínio não interessa. */
const enums = new Set([...declarado.keys()].map((chave) => chave.split(".")[0]));

const posicao = (arquivo: string) => arquivos.indexOf(arquivo);

const relevantes = usos.filter((uso) => enums.has(uso.enumName));

describe("valores de enum usados nas migrations", () => {
  it("o teste está de fato lendo as migrations", () => {
    // Sem isto, uma expressão regular quebrada transformaria a bateria num teste
    // que passa sobre listas vazias — o pior tipo de guarda.
    expect(arquivos.length).toBeGreaterThan(10);
    expect(enums.has("admin_audit_action")).toBe(true);
    expect(declarado.has("admin_audit_action.user_updated")).toBe(true);
    expect(relevantes.length).toBeGreaterThan(20);
  });

  it.each(relevantes.map((u) => [`'${u.valor}'::public.${u.enumName} (${u.arquivo})`, u] as const))(
    "%s existe quando este arquivo roda",
    (_rotulo, uso) => {
      const onde = declarado.get(`${uso.enumName}.${uso.valor}`);

      expect(
        onde,
        `${uso.arquivo} usa '${uso.valor}'::public.${uso.enumName}, e NENHUMA migration acrescenta ` +
          `esse valor ao enum. A função vai ser criada sem reclamar e só falhar quando alguém ` +
          `percorrer esse caminho, com 22P02 — que a tela mostra como "erro inesperado".`,
      ).toBeDefined();

      if (!onde) return;

      expect(
        posicao(onde.arquivo),
        `${uso.arquivo} usa '${uso.valor}'::public.${uso.enumName}, mas o valor só é acrescentado ` +
          `depois, em ${onde.arquivo}. Mova a declaração para um arquivo anterior.`,
      ).toBeLessThanOrEqual(posicao(uso.arquivo));

      if (onde.arquivo === uso.arquivo && !onde.usavelNoMesmoArquivo) {
        expect.fail(
          `${uso.arquivo} acrescenta '${uso.valor}' ao enum public.${uso.enumName} E o usa no mesmo ` +
            `arquivo. O Postgres recusa isso com "unsafe use of new value of enum type": um valor ` +
            `criado por \`alter type ... add value\` não pode ser usado na mesma transação. ` +
            `Separe em dois arquivos, como 20260831000000_admin_user_enums.sql faz.`,
        );
      }
    },
  );
});
