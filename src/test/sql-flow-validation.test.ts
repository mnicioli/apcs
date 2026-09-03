import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_ERROR_MESSAGES, mapPostgresError } from "@/lib/actions/errors";
import { FLOW_VALIDATION_CODES } from "@/modules/flow/flow.types";

/**
 * O ESPELHO ENTRE O TYPESCRIPT E O BANCO, nos Fluxos de Atendimento.
 *
 * ⚠️ POR QUE ELE PRECISA EXISTIR. Este módulo tem a mesma regra escrita em dois
 * lugares de propósito:
 *
 *   `validate_flow_version()`   a BARREIRA — vale para a tela, o psql, o script
 *   `validateFlowGraph()`       o ESPELHO — para o botão de publicar poder ficar
 *                               desabilitado COM O MOTIVO à vista
 *
 * Duplicação deliberada é uma dívida que se paga com um teste. Sem este arquivo,
 * uma regra nova entraria só num lado e o defeito seria dos silenciosos: a tela
 * diria "pode publicar" e o banco recusaria, ou — pior — a tela mostraria um
 * problema que o banco não conhece e ninguém conseguiria publicar nada.
 *
 * ⚠️ E ELE GUARDA UMA SEGUNDA COISA, MAIS IMPORTANTE: os grants de coluna. São
 * eles que impedem um `PATCH` pelo PostgREST de publicar uma versão sem validar,
 * sem compilar o retrato congelado e sem substituir a anterior. Um `grant
 * update` largado incluindo `status` transformaria as seis funções de ciclo de
 * vida em sugestão — e nada na tela mostraria isso.
 *
 * Ele lê texto de SQL, o que é grosseiro, e responde perguntas objetivas, o que
 * o torna preciso.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const ENUMS = readFileSync(join(MIGRATIONS, "20260917000000_flow_enums.sql"), "utf8");
const FLUXOS = readFileSync(join(MIGRATIONS, "20260917000100_flows.sql"), "utf8");

/**
 * ⚠️ SEM OS COMENTÁRIOS. Toda migration deste projeto termina com um bloco
 * ROLLBACK escrito em linhas comentadas, e o cabeçalho destas duas discute em
 * português os mesmos códigos que o teste procura. Lendo o texto cru, um
 * `raise ... 'FL001'` citado num comentário contaria como real.
 */
const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, "");

const FLUXOS_SQL = semComentarios(FLUXOS);
const ENUMS_SQL = semComentarios(ENUMS);

/**
 * O corpo de `validate_flow_version` — e SÓ ele.
 *
 * ⚠️ RECORTAR A FUNÇÃO IMPORTA. Procurar os códigos no arquivo inteiro faria
 * `'dead_end'` casar com qualquer menção em outra função, e o teste aprovaria um
 * código que a validação não devolve mais. O recorte vai do cabeçalho até o
 * `$fn$;` que fecha.
 */
function corpoDaValidacao(): string {
  const inicio = FLUXOS_SQL.indexOf("create or replace function public.validate_flow_version");
  const fim = FLUXOS_SQL.indexOf("$fn$;", inicio);
  return FLUXOS_SQL.slice(inicio, fim);
}

describe("o espelho da validação de fluxos (§19)", () => {
  it("o teste está de fato lendo as migrations", () => {
    // Sem isto, um caminho errado transformaria a bateria num teste que passa
    // sobre strings vazias — o pior tipo de guarda.
    expect(FLUXOS_SQL).toContain("create or replace function public.validate_flow_version");
    expect(FLUXOS_SQL.length).toBeGreaterThan(10_000);
    expect(FLOW_VALIDATION_CODES.length).toBeGreaterThan(4);
  });

  it("todo código do TypeScript existe em validate_flow_version", () => {
    const corpo = corpoDaValidacao();
    const faltando = FLOW_VALIDATION_CODES.filter((codigo) => !corpo.includes(`'${codigo}'`));

    expect(
      faltando,
      `\n\nCódigos em FLOW_VALIDATION_CODES que validate_flow_version NÃO devolve:\n\n` +
        faltando.map((c) => `  ${c}`).join("\n") +
        `\n\nA tela mostraria um problema que o banco não conhece — e a publicação\n` +
        `passaria mesmo com a tela dizendo que não.\n`,
    ).toEqual([]);
  });

  it("todo código do banco existe no TypeScript", () => {
    const corpo = corpoDaValidacao();
    // `return query select 'codigo'::text, ...`
    const noBanco = [...corpo.matchAll(/select\s+'([a-z_]+)'::text/gi)].map((m) => m[1] ?? "");
    const sobrando = [...new Set(noBanco)].filter(
      (codigo) => !(FLOW_VALIDATION_CODES as readonly string[]).includes(codigo),
    );

    expect(
      sobrando,
      `\n\nCódigos que validate_flow_version devolve e o TypeScript não conhece:\n\n` +
        sobrando.map((c) => `  ${c}`).join("\n") +
        `\n\nO banco recusaria a publicação por um motivo que a tela não sabe traduzir.\n`,
    ).toEqual([]);
  });
});

describe("os códigos de erro da classe FL", () => {
  /** Todo `errcode = 'FLxxx'` levantado pela migration. */
  function codigosLevantados(): string[] {
    return [
      ...new Set([...FLUXOS_SQL.matchAll(/errcode\s*=\s*'(FL\d{3})'/g)].map((m) => m[1] ?? "")),
    ];
  }

  it("o teste está de fato achando os códigos", () => {
    expect(codigosLevantados().length).toBeGreaterThan(4);
    expect(codigosLevantados()).toContain("FL001");
  });

  /**
   * ⚠️ UM CÓDIGO SEM TRADUÇÃO VIRA "Ocorreu um erro inesperado. Tente
   * novamente." — que é a pior mensagem possível, porque manda a pessoa repetir
   * exatamente a única coisa que nunca vai funcionar. Foi assim que o defeito de
   * `mapPostgresError` sem log nasceu.
   */
  it("todo código levantado pelo banco tem tradução na tela", () => {
    const semTraducao = codigosLevantados().filter(
      (codigo) => mapPostgresError({ code: codigo }).code === "unexpected",
    );

    expect(
      semTraducao,
      `\n\nCódigos FL levantados na migration e não mapeados em mapPostgresError:\n\n` +
        semTraducao.map((c) => `  ${c}`).join("\n") +
        `\n\nA tela diria "erro inesperado, tente novamente" para uma regra de negócio.\n`,
    ).toEqual([]);
  });

  it("cada tradução tem uma mensagem que diz o que fazer", () => {
    for (const codigo of codigosLevantados()) {
      const traduzido = mapPostgresError({ code: codigo }).code;
      const mensagem = ACTION_ERROR_MESSAGES[traduzido];

      expect(mensagem, `mensagem vazia para ${codigo}`).toBeTruthy();
      // Uma frase curta demais quase sempre é "Não foi possível." — que constata
      // sem ensinar. As deste módulo explicam o caminho de saída.
      expect(
        mensagem.length,
        `mensagem curta demais para ${codigo}: "${mensagem}"`,
      ).toBeGreaterThan(30);
    }
  });
});

/**
 * ⚠️ A SEÇÃO QUE GUARDA A ARQUITETURA INTEIRA DO CICLO DE VIDA.
 *
 * `status`, `definition`, `published_at`, `published_by` e `active_version_id`
 * foram revogadas de `authenticated` para que só as funções `security definer`
 * possam mudá-las. Se um dia alguém "consertar" um 42501 acrescentando a coluna
 * ao `grant`, a publicação passaria a poder acontecer por um `PATCH` — sem
 * validação, sem retrato congelado e sem substituir a versão anterior.
 *
 * O sintoma seria nenhum. É por isso que este teste existe.
 */
describe("os grants de coluna dos fluxos", () => {
  function colunasComGrant(tabela: string): string[] {
    const colunas: string[] = [];
    const alvo = new RegExp(
      `grant\\s+update\\s*\\(([^)]*)\\)\\s*\\n?\\s*on\\s+public\\.${tabela}\\s+to`,
      "gi",
    );
    for (const achado of FLUXOS_SQL.matchAll(alvo)) {
      for (const coluna of (achado[1] ?? "").split(",")) colunas.push(coluna.trim());
    }
    return colunas;
  }

  it("o teste está de fato lendo os grants", () => {
    expect(FLUXOS_SQL).toContain("revoke update on public.flows from authenticated");
    expect(FLUXOS_SQL).toContain("revoke update on public.flow_versions from authenticated");
    expect(colunasComGrant("flows")).toContain("name");
    expect(colunasComGrant("flow_versions")).toContain("notes");
  });

  it.each([
    ["flows", "status"],
    ["flows", "active_version_id"],
    ["flow_versions", "status"],
    ["flow_versions", "definition"],
    ["flow_versions", "published_at"],
    ["flow_versions", "published_by"],
  ])("%s.%s continua fora do alcance de um PATCH", (tabela, coluna) => {
    expect(
      colunasComGrant(tabela),
      `\n\n${tabela}.${coluna} ganhou grant de UPDATE para \`authenticated\`.\n\n` +
        `A partir daqui, publicar uma versão vira um PATCH pelo PostgREST: sem validar\n` +
        `o desenho, sem congelar o retrato e sem substituir a versão anterior. As funções\n` +
        `das seções 12 a 16 da migration passam a ser sugestão.\n`,
    ).not.toContain(coluna);
  });

  /**
   * ⚠️ A SEGUNDA TRANCA, e é a que sobrevive a alguém acrescentar um `for all`
   * "para simplificar" na seção 18.
   *
   * Sem o `revoke delete on public.flows`, um Administrador apaga pelo PostgREST
   * um fluxo que já esteve no ar — levando junto, por cascade, todas as versões
   * publicadas. `delete_flow` recusa exatamente isso, e seria contornada por um
   * `DELETE /rest/v1/flows?id=eq...`.
   *
   * Sem o `revoke insert on public.flow_versions`, um INSERT direto cria uma
   * versão com o número que o cliente quiser — sem o lock que serializa dois
   * cliques em "nova versão", sem copiar o desenho e sem trilha.
   */
  it.each([
    ["delete", "flows"],
    ["insert", "flow_versions"],
    ["delete", "flow_versions"],
  ])("%s em %s continua sendo privilégio revogado", (verbo, tabela) => {
    const revogados = [
      ...FLUXOS_SQL.matchAll(
        new RegExp(`revoke\\s+([a-z,\\s]+?)\\s+on\\s+public\\.${tabela}\\s+from`, "gi"),
      ),
    ].flatMap((achado) => (achado[1] ?? "").split(",").map((v) => v.trim()));

    expect(
      revogados,
      `\n\nO privilégio de ${verbo.toUpperCase()} em ${tabela} deixou de ser revogado de\n` +
        `\`authenticated\`. A partir daqui, a função que existe para guardar essa operação\n` +
        `passa a ser contornável por uma chamada direta ao PostgREST.\n`,
    ).toContain(verbo);
  });
});

/**
 * ⚠️ AS DUAS ARMADILHAS DE `NEW` E `OLD` NUM GATILHO DE DELETE.
 *
 * Em DELETE o PL/pgSQL NÃO ATRIBUI `new`, e lê-lo não devolve nulo: levanta
 * "record new is not assigned yet". Ou seja, o `coalesce(new.x, old.x)` — que é
 * o reflexo natural de quem quer cobrir os dois casos, e que este módulo chegou
 * a ter escrito — transformaria toda exclusão de nó, de transição e de membro de
 * time num erro.
 *
 * E, fiel à armadilha de sempre deste projeto, ele passa na migration: o
 * PL/pgSQL planeja cada comando na primeira vez que ele executa. O defeito só
 * apareceria no dia em que alguém apagasse um nó.
 */
describe("os gatilhos que atendem DELETE", () => {
  function corpoDaFuncao(nome: string): string {
    const inicio = FLUXOS_SQL.indexOf(`create or replace function public.${nome}()`);
    expect(inicio, `função ${nome} não encontrada na migration`).toBeGreaterThan(-1);
    return FLUXOS_SQL.slice(inicio, FLUXOS_SQL.indexOf("$fn$;", inicio));
  }

  it.each(["flow_graph_draft_only", "flow_audit"])("%s ramifica por tg_op", (nome) => {
    const corpo = corpoDaFuncao(nome);

    expect(corpo).toMatch(/tg_op\s*=\s*'DELETE'/i);
    expect(
      corpo,
      `\n\n${nome} usa coalesce(new.…, old.…) — que levanta "record new is not assigned yet"\n` +
        `em todo DELETE. O ramo por tg_op é a única forma que funciona.\n`,
    ).not.toMatch(/coalesce\(\s*new\.\w+\s*,\s*old\./i);
    expect(corpo).not.toMatch(/coalesce\(\s*new\s*,\s*old\s*\)/i);
  });
});

/**
 * ⚠️ A ARMADILHA DO ENUM, PERSEGUIDA NESTE MÓDULO EM PARTICULAR.
 *
 * `sql-enum-values.test.ts` confere os usos escritos como `'valor'::public.enum`.
 * As funções deste módulo passam o verbo SEM cast — `log_admin_action('flow_created', …)`
 * e `v_action := 'flow_version_tested'` —, que é a forma que aquele teste não
 * enxerga.
 *
 * E é justamente a forma perigosa: o PL/pgSQL planeja cada comando na PRIMEIRA
 * vez que ele executa, então um verbo inexistente atravessa a migration, o
 * type-check e o build, e só quebra no dia em que alguém clicar no botão.
 */
describe("os verbos de auditoria dos fluxos (§17)", () => {
  const declarados = new Set(
    [...ENUMS_SQL.matchAll(/add\s+value\s+if\s+not\s+exists\s+'(flow_[a-z_]+)'/gi)].map(
      (m) => m[1] ?? "",
    ),
  );

  const usados = new Set([
    ...[...FLUXOS_SQL.matchAll(/log_admin_action\(\s*'(flow_[a-z_]+)'/gi)].map((m) => m[1] ?? ""),
    ...[...FLUXOS_SQL.matchAll(/(?:when|then|else)\s+'(flow_[a-z_]+)'/gi)].map((m) => m[1] ?? ""),
    ...[...FLUXOS_SQL.matchAll(/v_action\s*:=\s*'(flow_[a-z_]+)'/gi)].map((m) => m[1] ?? ""),
  ]);

  it("o teste está de fato achando verbos dos dois lados", () => {
    expect(declarados.size).toBeGreaterThan(10);
    expect(usados.size).toBeGreaterThan(5);
    expect(declarados.has("flow_version_published")).toBe(true);
  });

  it("todo verbo usado foi declarado no arquivo de enums", () => {
    const faltando = [...usados].filter((verbo) => !declarados.has(verbo));

    expect(
      faltando,
      `\n\nVerbos usados em 20260917000100_flows.sql e não declarados em 20260917000000_flow_enums.sql:\n\n` +
        faltando.map((v) => `  ${v}`).join("\n") +
        `\n\nA migration passa, a tela abre — e o erro (22P02) só aparece quando alguém\n` +
        `percorrer aquele caminho pela primeira vez.\n`,
    ).toEqual([]);
  });

  /**
   * A outra ponta: um verbo declarado e nunca usado é ruído permanente. O
   * Postgres não sabe remover valor de enum, então ele fica para sempre.
   */
  it("todo verbo declarado é de fato usado", () => {
    const orfaos = [...declarados].filter((verbo) => !usados.has(verbo));
    expect(orfaos, `Verbos declarados e nunca usados: ${orfaos.join(", ")}`).toEqual([]);
  });
});

/**
 * ⚠️ A COLUNA `updated_at` QUE NUNCA MUDA — o erro que ninguém reporta.
 *
 * Sem gatilho, ela fica congelada na criação. O número aparece na grid, é
 * plausível, e está errado para sempre: a coluna "Atualizado" mostraria a data
 * em que o registro nasceu. Ninguém abre um chamado sobre uma data que parece
 * certa.
 *
 * Este módulo já nasceu com o defeito em `flows` — descoberto lendo a lista de
 * gatilhos, não rodando nada. Daí o teste.
 */
describe("o carimbo de atualização", () => {
  /** As tabelas da migration que declaram `updated_at`. */
  function tabelasComUpdatedAt(): string[] {
    const tabelas: string[] = [];
    for (const bloco of FLUXOS_SQL.split(/create table if not exists public\./i).slice(1)) {
      const nome = /^(\w+)/.exec(bloco)?.[1];
      const corpo = bloco.slice(0, bloco.indexOf(");"));
      if (nome && /\bupdated_at\s+timestamptz/i.test(corpo)) tabelas.push(nome);
    }
    return tabelas;
  }

  it("o teste está de fato achando as tabelas", () => {
    expect(tabelasComUpdatedAt()).toContain("flows");
    expect(tabelasComUpdatedAt()).toContain("flow_versions");
    expect(tabelasComUpdatedAt().length).toBeGreaterThan(3);
  });

  it("toda tabela com updated_at tem gatilho que o carimba", () => {
    const semGatilho = tabelasComUpdatedAt().filter(
      (tabela) =>
        !new RegExp(
          `create trigger \\w+\\s*\\n?\\s*before update on public\\.${tabela}\\b`,
          "i",
        ).test(FLUXOS_SQL),
    );

    expect(
      semGatilho,
      `\n\nTabelas com updated_at e sem gatilho BEFORE UPDATE:\n\n` +
        semGatilho.map((t) => `  ${t}`).join("\n") +
        `\n\nA coluna fica congelada na criação. A grid mostra a data errada, ela parece\n` +
        `certa, e ninguém reporta.\n`,
    ).toEqual([]);
  });
});

/**
 * As três regras do cabeçalho da migration, conferidas como TEXTO — porque
 * nenhuma bateria deste projeto executa SQL, e estas são as que sustentam o
 * módulo inteiro.
 */
describe("as regras estruturais dos fluxos", () => {
  it("só existe uma versão publicada por fluxo, e é um índice", () => {
    expect(FLUXOS_SQL).toMatch(
      /create unique index[\s\S]*?flow_versions_published_idx[\s\S]*?where status = 'published'/i,
    );
  });

  it("só existe um nó inicial por versão, e é um índice", () => {
    expect(FLUXOS_SQL).toMatch(
      /create unique index[\s\S]*?flow_nodes_start_idx[\s\S]*?where is_start/i,
    );
  });

  it("a idempotência do §27 é um índice único, não uma checagem em código", () => {
    expect(FLUXOS_SQL).toMatch(
      /create unique index[\s\S]*?flow_run_steps_idempotency_idx[\s\S]*?\(flow_run_id, idempotency_key\)/i,
    );
  });

  /**
   * A FK composta é o que recusa apontar para um nó de OUTRA versão — o caso
   * que uma checagem em código deixaria passar, e o que de fato acontece quando
   * alguém duplica um fluxo.
   */
  it("uma transição não alcança nó de outra versão", () => {
    expect(FLUXOS_SQL).toMatch(
      /foreign key \(source_node_id, flow_version_id\)\s*\n?\s*references public\.flow_nodes \(id, flow_version_id\)/i,
    );
    expect(FLUXOS_SQL).toMatch(
      /foreign key \(target_node_id, flow_version_id\)\s*\n?\s*references public\.flow_nodes \(id, flow_version_id\)/i,
    );
  });

  it("nó e transição só se escrevem em rascunho", () => {
    expect(FLUXOS_SQL).toContain("create trigger on_flow_nodes_draft_only");
    expect(FLUXOS_SQL).toContain("create trigger on_flow_transitions_draft_only");
    expect(FLUXOS_SQL).toMatch(/before insert or update or delete on public\.flow_nodes/i);
  });
});
