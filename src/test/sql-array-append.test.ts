import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `text[] || 'literal'` NÃO ACRESCENTA UM ITEM — e o Postgres não avisa.
 *
 * ============================================================================
 * ⚠️ NASCEU DE UM DEFEITO EM PRODUÇÃO QUE DUROU UM MÊS.
 * ============================================================================
 * `update_member` montava a lista de campos alterados assim:
 *
 *     v_changed text[] := '{}';
 *     ...
 *     v_changed := v_changed || 'profileType';
 *
 * A intenção é óbvia para quem lê. O Postgres entende outra coisa: `||` tem
 * duas formas aplicáveis — `anyarray || anyelement` e `anyarray || anyarray` —
 * e o literal chega com tipo `unknown`, sem nada que diga qual escolher. A
 * resolução recai sobre a segunda, e ele tenta ler `profileType` COMO UM ARRAY:
 *
 *     22P02  malformed array literal: "profileType"
 *
 * O sintoma na tela era "Dados inválidos. Verifique os campos e tente
 * novamente." — a MESMA frase que o Zod produz quando o formulário está mal
 * preenchido. Quem viu foi conferir os campos, e os campos estavam certos.
 *
 * ⚠️ POR QUE NENHUMA OUTRA BARREIRA PEGA ISSO:
 *
 *   * o PL/pgSQL só planeja cada comando na PRIMEIRA VEZ que ele executa — a
 *     função é criada sem uma palavra, e a migration aplica limpa;
 *   * a concatenação vive dentro de um `if ... is distinct from`, então salvar
 *     SEM alterar nada funciona. Quem testou "abrir e salvar" viu tudo certo;
 *   * type-check, lint, build e as milhares de asserções desta bateria não
 *     executam uma linha de SQL.
 *
 * É a mesma família de `sql-column-grants` e `sql-audit-writes`: erro que só
 * falha para quem USA o sistema, no caminho que ninguém tinha percorrido.
 *
 * ⚠️ E ELE ERA MAIS AMPLO QUE O RELATO. A varredura que virou este teste achou
 * o mesmo padrão em `update_user_profile` — trocar nome ou e-mail de um usuário
 * em /users falhava igual, e ninguém tinha reclamado ainda.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const arquivos = readdirSync(MIGRATIONS)
  .filter((nome) => nome.endsWith(".sql"))
  .sort();

/**
 * ⚠️ COMENTÁRIO FORA ANTES DE QUALQUER COISA. Este teste nasceu de uma
 * migration cujo CABEÇALHO cita o padrão errado para explicá-lo — e um teste
 * que acusa a própria explicação do defeito é um teste que alguém desliga. É a
 * mesma armadilha que `sql-audit-writes` documenta, por outra porta.
 */
function semComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

interface Achado {
  arquivo: string;
  variavel: string;
  linha: string;
}

/**
 * O ESTADO FINAL de cada função — o que está no banco depois de todas as
 * migrations rodarem.
 *
 * ============================================================================
 * ⚠️ POR FUNÇÃO, E NÃO POR ARQUIVO. A PRIMEIRA VERSÃO DESTE TESTE ERRAVA AQUI.
 * ============================================================================
 * Ela varria cada arquivo isoladamente e acusava `20260829140100` — que de fato
 * TEM o padrão errado, e sempre vai ter: migration aplicada não se reescreve. A
 * correção veio numa migration POSTERIOR, com `create or replace`.
 *
 * Um teste que insistisse no arquivo antigo cobraria uma correção impossível, e
 * a única saída seria desligá-lo. Ler a última definição de cada função é o que
 * faz este arquivo descrever o banco de hoje — a mesma decisão de
 * `sql-audit-writes` e `sql-event-landing`.
 *
 * ⚠️ O TERMINADOR NÃO É SEMPRE `$$`. `update_user_profile` fecha com `$fn$`, e
 * um regex preso em `$$` engoliria a função seguinte junto — foi o que
 * aconteceu ao montar a migration de correção, e é por isso que aqui ele aceita
 * qualquer rótulo.
 */
function definicoesVigentes(): Map<string, { arquivo: string; corpo: string }> {
  const porNome = new Map<string, { arquivo: string; corpo: string }>();

  for (const arquivo of arquivos) {
    const sql = semComentarios(readFileSync(join(MIGRATIONS, arquivo), "utf8"));

    for (const achado of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\([\s\S]*?\n\$\w*\$;/gi,
    )) {
      porNome.set(achado[1] ?? "", { arquivo, corpo: achado[0] });
    }
  }

  return porNome;
}

/**
 * Toda atribuição `<var> := <var> || <literal entre aspas>` onde `<var>` foi
 * declarada `text[]` na MESMA função.
 *
 * ⚠️ A EXIGÊNCIA DE DECLARAÇÃO É O QUE MANTÉM ISTO SEM FALSO POSITIVO.
 * `v_texto := v_texto || 'x'` numa variável `text` é concatenação de string,
 * perfeitamente correta e comum — acusar isso encheria o teste de ruído até
 * alguém parar de olhar.
 */
function concatenacoesCruas(): Achado[] {
  const achados: Achado[] = [];

  for (const [nome, { arquivo, corpo }] of definicoesVigentes()) {
    const arrays = new Set(
      [...corpo.matchAll(/(\w+)\s+text\[\]/gi)].map((achado) => (achado[1] ?? "").toLowerCase()),
    );
    if (arrays.size === 0) continue;

    for (const achado of corpo.matchAll(/(\w+)\s*:=\s*\1\s*\|\|\s*('[^']*')/gi)) {
      const variavel = (achado[1] ?? "").toLowerCase();
      if (!arrays.has(variavel)) continue;
      achados.push({
        arquivo: `${arquivo} → ${nome}`,
        variavel,
        linha: achado[0].replace(/\s+/g, " "),
      });
    }
  }

  return achados;
}

describe("a bateria está lendo as migrations", () => {
  it("encontra as funções e as duas que foram corrigidas", () => {
    const vigentes = definicoesVigentes();
    expect(vigentes.size).toBeGreaterThan(100);

    /**
     * ⚠️ AS DUAS DO DEFEITO, PELA DEFINIÇÃO QUE VALE. Se o regex de terminador
     * ou a ordem de leitura quebrarem, estas linhas avisam — em vez de o caso
     * principal passar por estar lendo a versão errada.
     */
    for (const nome of ["update_member", "update_user_profile"]) {
      const vigente = vigentes.get(nome);
      expect(vigente, `${nome} não foi encontrada`).toBeDefined();
      expect(vigente?.arquivo).toBe("20260930000000_fix_audit_changed_array.sql");
      expect(vigente?.corpo).toContain("array['");
    }
  });

  /**
   * ⚠️ E QUE A VARREDURA REALMENTE ENXERGA O PADRÃO. Sem esta linha, um erro no
   * regex faria o caso principal passar por não achar nada — um guarda cego
   * passa sempre. Aqui ela roda contra o texto do próprio defeito.
   */
  it("reconheceria o defeito original se ele voltasse", () => {
    const defeito = "v_changed text[] := '{}';\nv_changed := v_changed || 'profileType';";
    const arrays = new Set(
      [...defeito.matchAll(/(\w+)\s+text\[\]/gi)].map((a) => (a[1] ?? "").toLowerCase()),
    );
    const casos = [...defeito.matchAll(/(\w+)\s*:=\s*\1\s*\|\|\s*('[^']*')/gi)].filter((a) =>
      arrays.has((a[1] ?? "").toLowerCase()),
    );
    expect(casos).toHaveLength(1);
  });
});

describe("nenhuma migration acrescenta a um text[] com literal solto", () => {
  it("toda concatenação usa array[...] ou um cast explícito", () => {
    const achados = concatenacoesCruas();

    expect(
      achados,
      achados.length === 0
        ? ""
        : "Use `array['x']` (ou `'x'::text`). `text[] || 'x'` tenta LER 'x' como array e " +
            `devolve 22P02 em tempo de execução:\n${achados
              .map((a) => `  ${a.arquivo}: ${a.linha}`)
              .join("\n")}`,
    ).toEqual([]);
  });
});
