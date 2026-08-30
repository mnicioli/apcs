import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * `pnpm db:types` — regenera src/types/database.ts a partir do banco ligado.
 *
 * ⚠️ EXISTE POR CAUSA DE UMA PERDA DE ARQUIVO REAL. O script era:
 *
 *     supabase gen types typescript --linked > src/types/database.ts
 *
 * e o `>` do shell TRUNCA O DESTINO ANTES de o comando rodar. Quando o CLI
 * falha — e ele falha por motivos banais, como o projeto não estar ligado —, o
 * que sobra é um `database.ts` VAZIO. O type-check quebra em centenas de linhas
 * de uma vez, e quem só queria atualizar os tipos passa a debugar um estrago que
 * o próprio comando causou.
 *
 * Aqui a saída é capturada em memória e o arquivo só é reescrito quando o CLI
 * termina bem E o que ele devolveu parece mesmo os tipos. Em qualquer outro
 * caso, `database.ts` continua exatamente como estava.
 */

const DESTINO = "src/types/database.ts";

/** O que um `database.ts` de verdade sempre tem. */
const ASSINATURA = "export type Database";

const resultado = spawnSync("npx", ["supabase", "gen", "types", "typescript", "--linked"], {
  encoding: "utf8",
  // O arquivo passa de 5000 linhas; o buffer padrão de 1 MB fica apertado.
  maxBuffer: 64 * 1024 * 1024,
  // ⚠️ `shell` NO WINDOWS, e não por preguiça: desde o CVE-2024-27980 o Node
  // recusa `spawn` direto em um `.cmd` (que é o que `npx` é lá) e devolve
  // EINVAL. Os argumentos abaixo são literais fixos — não há nada vindo de fora
  // para o shell interpretar.
  shell: process.platform === "win32",
});

function recusar(motivo) {
  console.error(`\n[db:types] ${motivo}`);
  console.error(`[db:types] ${DESTINO} NÃO foi alterado.\n`);
  process.exit(1);
}

if (resultado.error) {
  recusar(`não foi possível executar o CLI do Supabase: ${resultado.error.message}`);
}

if (resultado.status !== 0) {
  const saida = (resultado.stderr || "").trim();
  if (/project ref/i.test(saida)) {
    recusar(
      "o projeto não está ligado nesta máquina.\n" +
        "           Rode `npx supabase login` e depois `npx supabase link` uma vez.\n" +
        `           Mensagem do CLI: ${saida}`,
    );
  }
  recusar(`o CLI falhou (código ${resultado.status}):\n${saida}`);
}

const tipos = resultado.stdout ?? "";

// ⚠️ CONFERE O CONTEÚDO, e não só o código de saída. Um CLI que devolve 0 com a
// saída vazia (ou com um aviso no lugar dos tipos) apagaria o arquivo do mesmo
// jeito — que é exatamente o estrago que este script existe para não repetir.
if (!tipos.includes(ASSINATURA)) {
  recusar(`a saída do CLI não parece os tipos gerados (não contém "${ASSINATURA}").`);
}

const anterior = (() => {
  try {
    return readFileSync(DESTINO, "utf8");
  } catch {
    return "";
  }
})();

if (anterior === tipos) {
  console.log(`[db:types] ${DESTINO} já estava atualizado.`);
  process.exit(0);
}

writeFileSync(DESTINO, tipos);
console.log(`[db:types] ${DESTINO} atualizado (${tipos.split("\n").length} linhas).`);
