import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * GATILHO COMPARTILHADO QUE LÊ UMA COLUNA QUE A TABELA PODE NÃO TER.
 *
 * ⚠️ NASCEU DE UM DEFEITO QUE SÓ APARECEU ABRINDO A TELA. `flow_audit()` é UMA
 * função para SEIS tabelas. O atalho que ignora o arrastar do canvas foi escrito
 * como uma condição só:
 *
 *     if tg_table_name = 'flow_nodes' and tg_op = 'UPDATE'
 *        and new.position is distinct from old.position
 *     then
 *
 * Lendo da esquerda para a direita parece seguro: o primeiro termo já barraria
 * qualquer outra tabela. Mas o PL/pgSQL entrega a condição INTEIRA ao executor
 * como uma expressão só, e para isso resolve `new.position` contra o tipo da
 * linha ANTES de avaliar o primeiro termo. Resultado: todo INSERT em `flows`
 * morria com `42703: record "new" has no field "position"` — o módulo inteiro
 * não conseguia criar um fluxo.
 *
 * ⚠️ POR QUE NENHUMA OUTRA BARREIRA PEGA: a migration aplica sem reclamar,
 * porque CRIAR uma função não a EXECUTA. É o mesmo formato do grant de função
 * (`sql-function-grants.test.ts`) e do grant de coluna: o erro mora no uso, não
 * na definição, e a migration roda como dono.
 *
 * O QUE ESTE TESTE FAZ: proíbe misturar `tg_table_name` e `new.`/`old.` na
 * MESMA condição. A correção é sempre a mesma e é barata — dois `if`
 * aninhados, porque aí o PL/pgSQL só prepara a expressão de dentro quando a de
 * fora já garantiu a tabela.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const arquivos = readdirSync(MIGRATIONS)
  .filter((nome) => nome.endsWith(".sql"))
  .sort();

/** Um `-- new.position` num comentário não é código. */
function semComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

interface Gatilho {
  nome: string;
  arquivo: string;
  corpo: string;
}

/**
 * Só funções sem argumento: toda função de gatilho é `()`, e casar exatamente
 * isso evita tropeçar em listas de parâmetros com parênteses dentro.
 *
 * ⚠️ A ÚLTIMA DEFINIÇÃO VENCE, como no banco: `create or replace` numa migration
 * posterior substitui a anterior, e analisar a versão velha acusaria um defeito
 * já corrigido.
 */
const DEFINICAO =
  /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(\s*\)([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/gi;

const gatilhos = new Map<string, Gatilho>();

for (const arquivo of arquivos) {
  const sql = readFileSync(join(MIGRATIONS, arquivo), "utf8");
  for (const encontrado of sql.matchAll(DEFINICAO)) {
    const [, nome, assinatura, , corpo] = encontrado;
    if (!nome || !assinatura || !corpo) continue;
    if (!/returns\s+trigger/i.test(assinatura)) continue;
    gatilhos.set(nome, { nome, arquivo, corpo });
  }
}

/** De `if`/`elsif` até o `then` que o fecha — a expressão que o banco monta de uma vez. */
const CONDICOES = /\b(?:if|elsif)\b([\s\S]*?)\bthen\b/gi;
const CAMPO = /\b(?:new|old)\.\w+/i;

const violacoes: string[] = [];

for (const gatilho of gatilhos.values()) {
  for (const condicao of semComentarios(gatilho.corpo).matchAll(CONDICOES)) {
    const texto = condicao[1];
    if (!texto) continue;
    if (!/tg_table_name/i.test(texto)) continue;

    const campo = texto.match(CAMPO);
    if (!campo) continue;

    violacoes.push(
      `${gatilho.nome} (${gatilho.arquivo}): a condição decide a tabela por tg_table_name ` +
        `e lê ${campo[0]} na mesma expressão. Separe em dois \`if\` aninhados.`,
    );
  }
}

describe("gatilho compartilhado não lê coluna de outra tabela", () => {
  it("achou funções de gatilho nas migrations", () => {
    expect(gatilhos.size).toBeGreaterThan(0);
  });

  it("nenhuma condição mistura tg_table_name com new./old.", () => {
    expect(violacoes).toEqual([]);
  });
});
