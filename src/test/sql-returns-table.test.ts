import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A ARMADILHA DO `RETURNS TABLE` + `ON CONFLICT`, conferida em todas as
 * migrations.
 *
 * ⚠️ NASCEU DE UM INCIDENTE EM PRODUÇÃO. `start_broadcast` era declarada como
 * `returns table (broadcast_id uuid, ...)`, e `RETURNS TABLE` cria VARIÁVEIS
 * PL/pgSQL com esses nomes. O corpo tinha
 * `on conflict (broadcast_id, member_phone)`, onde `broadcast_id` também é nome
 * de coluna — e o alvo de um `ON CONFLICT` é um dos poucos lugares em que o
 * PL/pgSQL substitui variáveis, sem forma de qualificar a coluna
 * (`on conflict (r.broadcast_id)` é erro de sintaxe). Resultado: 42702,
 * "column reference is ambiguous", toda vez que alguém divulgava.
 *
 * ⚠️ POR QUE UM TESTE DE TEXTO, E NÃO UM TESTE DE BANCO. O corpo de uma função
 * PL/pgSQL só é analisado na PRIMEIRA VEZ QUE CADA COMANDO RODA. `create
 * function` aceita feliz; type-check, lint, build e as outras 1394 asserções
 * desta bateria não executam SQL nenhum. O defeito atravessou tudo isso e foi
 * descoberto por quem clicou no botão. Uma leitura do arquivo é grosseira, mas
 * é a única barreira que roda a cada commit — e ela pega exatamente a forma que
 * já custou um incidente.
 *
 * ⚠️ O QUE ELE NÃO É: um analisador de SQL. Ele responde uma pergunta só, e por
 * isso quase não tem falso positivo. Se um dia acusar algo legítimo, a saída não
 * é afrouxar a regra — é `#variable_conflict use_column` na função, que é a
 * correção de verdade.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** O corpo de cada função do arquivo, junto dos nomes que o `RETURNS TABLE` cria. */
interface Funcao {
  arquivo: string;
  nome: string;
  saidas: string[];
  corpo: string;
}

/**
 * O conteúdo entre `(` e o `)` que fecha, contando os níveis.
 *
 * ⚠️ Contar parênteses em vez de um `[\s\S]*?\)` preguiçoso. A primeira versão
 * usava uma expressão regular só para o cabeçalho inteiro, e ela ATRAVESSAVA os
 * limites entre funções: o motor recuava e casava a lista de parâmetros de uma
 * função com o `returns table` da função seguinte. O teste acusou
 * `broadcast_is_writer`, que devolve `boolean`.
 */
function ateOFechamento(texto: string, aberturaEm: number): string {
  let nivel = 0;
  for (let i = aberturaEm; i < texto.length; i += 1) {
    if (texto[i] === "(") nivel += 1;
    else if (texto[i] === ")") {
      nivel -= 1;
      if (nivel === 0) return texto.slice(aberturaEm + 1, i);
    }
  }
  return "";
}

function lerFuncoes(arquivo: string, sql: string): Funcao[] {
  // Cada `create function` começa um trecho que vai até o próximo — assim
  // nenhuma expressão abaixo consegue enxergar a função vizinha.
  const cabecalho = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(/gi;
  const inicios = [...sql.matchAll(cabecalho)].map((achado) => ({
    nome: achado[1] ?? "",
    indice: achado.index ?? 0,
  }));

  return inicios.flatMap((atual, i) => {
    const trecho = sql.slice(atual.indice, inicios[i + 1]?.indice ?? sql.length);

    const tabela = /returns\s+table\s*\(/i.exec(trecho);
    if (!tabela) return [];

    // "broadcast_id uuid, queued integer" → ["broadcast_id", "queued"]
    const saidas = ateOFechamento(trecho, tabela.index + tabela[0].length - 1)
      .split(",")
      .map((coluna) => coluna.trim().split(/\s+/)[0] ?? "")
      .filter(Boolean);

    const corpo = /as\s+(\$\w*\$)([\s\S]*?)\1/i.exec(trecho);
    if (!corpo) return [];

    return [{ arquivo, nome: atual.nome, saidas, corpo: corpo[2] ?? "" }];
  });
}

/** Os nomes citados no alvo de cada `ON CONFLICT (...)` do corpo. */
function alvosDeConflito(corpo: string): string[] {
  const nomes: string[] = [];
  for (const achado of corpo.matchAll(/on\s+conflict\s*\(([^)]*)\)/gi)) {
    for (const parte of (achado[1] ?? "").split(",")) {
      const nome = parte.trim();
      if (/^\w+$/.test(nome)) nomes.push(nome);
    }
  }
  return nomes;
}

// Ordem cronológica: os nomes começam com o carimbo de tempo, e é assim que o
// CLI do Supabase aplica as migrations.
const arquivos = readdirSync(MIGRATIONS)
  .filter((nome) => nome.endsWith(".sql"))
  .sort();

const todas = arquivos.flatMap((arquivo) =>
  lerFuncoes(arquivo, readFileSync(join(MIGRATIONS, arquivo), "utf8")),
);

/**
 * ⚠️ SÓ A ÚLTIMA DEFINIÇÃO DE CADA FUNÇÃO — e isso não é uma brecha, é o que
 * importa.
 *
 * Uma migration aplicada não se edita: ela é o registro do que aconteceu.
 * `20260901000100_broadcasts.sql` contém para sempre a versão de
 * `start_broadcast` que levantava 42702, e é assim que tem que ser. O que existe
 * NO BANCO é o último `create or replace` — que é justamente o que este teste
 * precisa julgar.
 *
 * O efeito prático continua sendo o certo: reintroduzir a armadilha numa
 * migration nova torna aquela a definição vigente, e o teste fica vermelho.
 */
const vigentes = new Map<string, Funcao>();
for (const funcao of todas) vigentes.set(funcao.nome, funcao);

const funcoes = [...vigentes.values()];

describe("funções SQL com RETURNS TABLE", () => {
  it("o teste está de fato lendo as migrations", () => {
    // Sem isto, um erro na expressão regular transformaria a bateria inteira
    // num teste que passa sobre uma lista vazia — o pior tipo de guarda.
    expect(arquivos.length).toBeGreaterThan(10);
    expect(funcoes.length).toBeGreaterThan(0);
    expect(funcoes.map((f) => f.nome)).toContain("start_broadcast");
  });

  it.each(funcoes.map((f) => [`${f.arquivo} → ${f.nome}`, f] as const))(
    "%s não usa um nome de saída no alvo de ON CONFLICT",
    (_rotulo, funcao) => {
      // `#variable_conflict use_column` é a correção documentada: com ela, um
      // identificador ambíguo passa a significar a COLUNA, que é o que o alvo
      // do ON CONFLICT sempre quis dizer.
      if (/#variable_conflict\s+use_column/i.test(funcao.corpo)) return;

      const colisoes = alvosDeConflito(funcao.corpo).filter((alvo) => funcao.saidas.includes(alvo));

      expect(
        colisoes,
        `${funcao.nome}: ${colisoes.join(", ")} é nome de coluna E de parâmetro de saída. ` +
          "O Postgres levanta 42702 na primeira execução. " +
          "Acrescente `#variable_conflict use_column` antes do `declare`.",
      ).toEqual([]);
    },
  );
});
