import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * GRAVAR EM TABELA FECHADA EXIGE `SECURITY DEFINER` — conferido em todas as
 * funções de todas as migrations.
 *
 * ============================================================================
 * ⚠️ NASCEU DE UM DEFEITO QUE FOI PARA PRODUÇÃO.
 * ============================================================================
 * Marcar um participante como "Não confirmado" devolvia:
 *
 *   "O banco recusou esta gravação por configuração interna — não é o seu
 *    perfil. Avise quem cuida do sistema."
 *
 * A investigação natural — grants de coluna — não achava nada: `confirmation`,
 * `updated_by` e `updated_at` estavam todos liberados em
 * `event_participants`. O UPDATE funcionava. Quem recusava era a linha
 * SEGUINTE: o insert na TRILHA.
 *
 * `event_registration_audit_logs` é fechada de propósito, e por dois lados ao
 * mesmo tempo:
 *
 *     revoke insert, update, delete on public.event_registration_audit_logs
 *       from authenticated, anon;
 *     -- e nenhuma policy de insert
 *
 * A migration que fez isso explicava a intenção num comentário: "quem escreve
 * na trilha é create_event_registration / update_event_registration /
 * set_participant_confirmation, TODAS SECURITY DEFINER". Só que das três,
 * apenas a primeira era. As outras duas — e depois uma terceira,
 * `update_event_participant` — nasceram SECURITY INVOKER. O comentário
 * descrevia um mundo que o código ao lado dele não construiu.
 *
 * ⚠️ POR QUE NADA MAIS PEGOU: a função é criada sem reclamar (o PL/pgSQL só
 * planeja cada comando na PRIMEIRA execução), o type-check não fala com o
 * Postgres, e os testes de action mockam o Supabase — justamente quem recusava.
 * O caminho quebrado era um clique que nenhuma bateria dá. Só aparece quando
 * uma pessoa de verdade clica no toggle.
 *
 * É o MESMO formato de `sql-column-grants` e `postgrest-embeds`: ler texto de
 * SQL é grosseiro, e responder uma pergunta só é o que o mantém sem falso
 * positivo. A pergunta aqui é: existe função SECURITY INVOKER gravando em
 * tabela onde `authenticated` não tem insert?
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const arquivos = readdirSync(MIGRATIONS)
  .filter((nome) => nome.endsWith(".sql"))
  .sort();

/**
 * O SQL sem comentários.
 *
 * ⚠️ SEM ISTO O TESTE MENTE, e mentiu na primeira versão. As migrations deste
 * projeto explicam cada decisão em blocos longos de `--`, e vários deles CITAM
 * comandos (`-- revoke update on public.events from authenticated;`). Um regex
 * que enxerga comentário atravessa dezenas de linhas de prosa e junta o
 * `revoke` de um comentário com o `on public.<tabela>` do comando seguinte:
 * `events`, `market_bulletin_versions` e `event_landing_pages` apareceram como
 * fechadas sem nunca terem sido. Três falsos positivos em seis achados — e um
 * teste que acusa código correto é um teste que alguém desliga.
 */
function semComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

const sqlPorArquivo = arquivos.map(
  (arquivo) => [arquivo, semComentarios(readFileSync(join(MIGRATIONS, arquivo), "utf8"))] as const,
);

const todoSql = sqlPorArquivo.map(([, sql]) => sql).join("\n");

/**
 * As tabelas em que `authenticated` NÃO pode inserir.
 *
 * ⚠️ `[^;]*?` E NÃO `[\s\S]*?` NA LISTA DE PRIVILÉGIOS: o ponto-e-vírgula é o
 * fim do comando, e um padrão que o atravessa costura o começo de um `revoke`
 * ao fim de outro. É a mesma armadilha dos comentários, por outra porta.
 *
 * O `grant` depois desfaz o `revoke`, na ordem em que as migrations rodam —
 * uma tabela que foi fechada e reaberta não é fechada.
 */
function tabelasSemInsertParaAutenticado(): Set<string> {
  const fechadas = new Set<string>();

  const temInsert = (privilegios: string) => /\binsert\b|\ball\b/i.test(privilegios);
  const atinge = (papeis: string) => /\bauthenticated\b/i.test(papeis);

  for (const achado of todoSql.matchAll(
    /revoke\s+([^;]*?)\s+on\s+public\.(\w+)\s+from\s+([^;]*);/gi,
  )) {
    const [, privilegios = "", tabela = "", papeis = ""] = achado;
    if (atinge(papeis) && temInsert(privilegios)) fechadas.add(tabela);
  }

  for (const achado of todoSql.matchAll(
    /grant\s+([^;]*?)\s+on\s+public\.(\w+)\s+to\s+([^;]*);/gi,
  )) {
    const [, privilegios = "", tabela = "", papeis = ""] = achado;
    if (atinge(papeis) && temInsert(privilegios)) fechadas.delete(tabela);
  }

  return fechadas;
}

type Funcao = { arquivo: string; corpo: string; definer: boolean };

/**
 * O ESTADO FINAL de cada função — o que está no banco depois de todas as
 * migrations rodarem, e não o que uma delas escreveu no meio do caminho.
 *
 * Duas coisas mudam esse estado, e o teste precisa das duas:
 *
 *   1. `create or replace function` — troca o corpo inteiro. A definição
 *      POSTERIOR vence: ler todas como independentes acusaria versões que já
 *      não existem, e deixaria passar uma regressão introduzida depois.
 *
 *   2. `alter function ... security definer` — troca SÓ esse atributo, e é
 *      assim que a correção de 20260927000000 foi feita. Repetir três corpos
 *      de PL/pgSQL só para mudar duas palavras seria copiar ~200 linhas à mão
 *      num arquivo que roda em produção. Um teste que só entendesse a forma 1
 *      continuaria acusando código já corrigido — e um teste que acusa código
 *      correto é um teste que alguém desliga.
 */
function definicoesVigentes(): Map<string, Funcao> {
  const porNome = new Map<string, Funcao>();

  for (const [arquivo, sql] of sqlPorArquivo) {
    for (const achado of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\([\s\S]*?\$\$;/gi,
    )) {
      const corpo = achado[0];
      porNome.set(achado[1] ?? "", {
        arquivo,
        corpo,
        definer: /security\s+definer/i.test(corpo),
      });
    }

    for (const achado of sql.matchAll(
      /alter\s+function\s+public\.(\w+)\s*\([^;]*?\)\s*security\s+(definer|invoker)\s*;/gi,
    )) {
      const anterior = porNome.get(achado[1] ?? "");
      if (anterior) anterior.definer = /definer/i.test(achado[2] ?? "");
    }
  }

  return porNome;
}

const fechadas = tabelasSemInsertParaAutenticado();
const funcoes = definicoesVigentes();

describe("a bateria está lendo as migrations", () => {
  it("encontra funções e tabelas fechadas", () => {
    expect(funcoes.size).toBeGreaterThan(100);
    expect(fechadas.size).toBeGreaterThan(10);
  });

  /**
   * ⚠️ O CASO CONHECIDO, ESCRITO À MÃO. Os cálculos acima são genéricos e podem
   * se enganar; esta linha responde a pergunta exata que custou o defeito.
   */
  it("a trilha de inscrições está entre as fechadas", () => {
    expect([...fechadas]).toContain("event_registration_audit_logs");
  });

  /**
   * ⚠️ E QUE O `alter function` REALMENTE FOI VISTO.
   *
   * A tolerância que ensina o teste a aceitar a correção é a mesma que pode
   * fazê-lo aceitar QUALQUER coisa: um erro no regex do `alter` não quebra
   * nada — ele só faz o teste principal deixar de enxergar as três funções
   * corrigidas, e um guarda cego passa sempre. Estas três linhas cobram que a
   * leitura funcionou, então o guarda continua sendo um guarda.
   */
  it("as três funções corrigidas em 20260927000000 constam como SECURITY DEFINER", () => {
    for (const nome of [
      "set_participant_confirmation",
      "update_event_participant",
      "update_event_registration",
    ]) {
      const funcao = funcoes.get(nome);
      expect(funcao, `${nome} não foi encontrada nas migrations`).toBeDefined();
      expect(funcao?.definer, `${nome} deveria estar SECURITY DEFINER`).toBe(true);
      // E que ela é DEFINER pelo `alter`, e não porque o corpo já dizia isso —
      // se alguém recriar a função inline, esta linha avisa que a de cima
      // deixou de provar o que se propunha.
      expect(/security\s+definer/i.test(funcao?.corpo ?? "")).toBe(false);
    }
  });
});

describe("nenhuma função SECURITY INVOKER grava em tabela fechada", () => {
  it("toda gravação em tabela sem insert vem de SECURITY DEFINER", () => {
    const suspeitas: string[] = [];

    for (const [nome, { arquivo, corpo, definer }] of funcoes) {
      if (definer) continue;

      const alvos = [
        ...new Set(
          [...corpo.matchAll(/insert\s+into\s+public\.(\w+)/gi)]
            .map((achado) => achado[1] ?? "")
            .filter((tabela) => fechadas.has(tabela)),
        ),
      ];

      if (alvos.length > 0) {
        suspeitas.push(`${nome} (${arquivo}) grava em ${alvos.join(", ")}`);
      }
    }

    expect(
      suspeitas,
      "Uma função SECURITY INVOKER roda com o privilégio de quem chamou, e " +
        "`authenticated` não tem insert nestas tabelas: a gravação morre em 42501 " +
        "no primeiro clique de verdade. Ou a função vira SECURITY DEFINER (e então " +
        "a checagem de papel dentro dela passa a ser a única barreira — confira que " +
        "existe), ou a tabela deixa de ser fechada (e então há uma decisão de " +
        "segurança a rever). Ver o cabeçalho deste arquivo.",
    ).toEqual([]);
  });
});
