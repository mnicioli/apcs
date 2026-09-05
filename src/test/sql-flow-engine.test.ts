import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FLOW_EVENT_TYPES, FLOW_STEP_STATUSES } from "@/modules/flow/flow.types";

/**
 * O MOTOR DE EXECUÇÃO, CONFERIDO NO TEXTO DAS MIGRATIONS.
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE, E POR QUE ELE LÊ SQL COMO TEXTO.
 *
 * O §38 do Prompt 3 pede teste para idempotência, concorrência, versionamento e
 * tempo. As quatro NÃO SÃO regras de TypeScript: elas são um índice único, uma
 * comparação de `lock_version`, uma coluna que não se reescreve e uma consulta
 * com prazo. Nenhuma delas pode ser provada com um mock — um mock que
 * concordasse comigo provaria que eu concordo comigo.
 *
 * Provar de verdade exigiria um Postgres na bateria de testes, que este projeto
 * não tem. O que dá para fazer sem ele é conferir que as PROPRIEDADES
 * estruturais continuam escritas onde precisam estar: se alguém trocar o `on
 * conflict do nothing` por um `select ... if not found`, ou o `where
 * lock_version = ...` por um update sem condição, o defeito não apareceria em
 * teste nenhum — só em produção, sob carga, na forma de uma mensagem duplicada
 * no WhatsApp de um associado.
 *
 * É grosseiro, e responde perguntas objetivas — o que o torna preciso.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const arquivos = readdirSync(MIGRATIONS)
  .filter((nome) => nome.endsWith(".sql"))
  .sort();

/** ⚠️ SEM OS COMENTÁRIOS. Os cabeçalhos deste módulo DISCUTEM em português as
 *  mesmas expressões que o teste procura — lendo o texto cru, um `on conflict`
 *  citado num comentário contaria como real. */
const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, "");

const ENGINE = semComentarios(
  readFileSync(join(MIGRATIONS, "20260919000000_flow_engine.sql"), "utf8"),
);

const TODO_SQL = arquivos
  .map((nome) => semComentarios(readFileSync(join(MIGRATIONS, nome), "utf8")))
  .join("\n");

/** O corpo da última definição de uma função — só ele. */
function corpo(nome: string): string {
  const definicoes = [
    ...TODO_SQL.matchAll(
      new RegExp(
        `create\\s+or\\s+replace\\s+function\\s+public\\.${nome}\\s*\\(([\\s\\S]*?)\\$fn\\$;`,
        "gi",
      ),
    ),
  ];
  return definicoes.at(-1)?.[0] ?? "";
}

describe("o teste está de fato lendo as migrations", () => {
  it("acha o arquivo do motor e as funções dele", () => {
    // Sem isto, uma expressão regular quebrada transformaria a bateria num
    // teste que passa sobre strings vazias — o pior tipo de guarda.
    expect(arquivos.length).toBeGreaterThan(10);
    expect(ENGINE.length).toBeGreaterThan(5_000);
    expect(corpo("flow_claim_step").length).toBeGreaterThan(200);
    expect(corpo("flow_commit_step").length).toBeGreaterThan(400);
  });
});

/* ========================================================================== */
/* §23 — idempotência                                                         */
/* ========================================================================== */

describe("a idempotência (§23)", () => {
  /**
   * ⚠️ A REIVINDICAÇÃO PRECISA SER UM INSERT, E NÃO UMA CONSULTA SEGUIDA DE UM
   * INSERT. Um `select ... if not found then insert` perde a corrida exatamente
   * quando o webhook reentrega — que é sob carga, com as duas cópias em voo ao
   * mesmo tempo. As duas leriam "não existe", as duas inseririam, e o fluxo
   * avançaria duas vezes.
   */
  it("flow_claim_step reivindica com ON CONFLICT DO NOTHING", () => {
    const fn = corpo("flow_claim_step");

    expect(fn).toMatch(/insert\s+into\s+public\.flow_run_steps/i);
    expect(fn).toMatch(
      /on\s+conflict\s*\(\s*flow_run_id\s*,\s*idempotency_key\s*\)\s*do\s+nothing/i,
    );
  });

  it("o índice único que sustenta isso continua existindo", () => {
    expect(TODO_SQL).toMatch(
      /create\s+unique\s+index[\s\S]{0,80}flow_run_steps_idempotency_idx[\s\S]{0,120}\(\s*flow_run_id\s*,\s*idempotency_key\s*\)/i,
    );
  });

  /**
   * ⚠️ E O `for update` NÃO É SOBRE IDEMPOTÊNCIA — é sobre o NÚMERO do passo.
   * `seq` tem índice único, e calculá-lo com `max(seq) + 1` em duas transações
   * simultâneas produziria o mesmo número e um 23505 numa constraint que não
   * tem nada a ver com reentrega.
   */
  it("a numeração dos passos é serializada por um bloqueio de linha", () => {
    const fn = corpo("flow_claim_step");

    expect(fn).toMatch(/from\s+public\.flow_runs\s+where\s+id\s*=\s*p_run_id\s+for\s+update/i);
    expect(fn.indexOf("for update")).toBeLessThan(fn.indexOf("max(s.seq)"));
  });
});

/* ========================================================================== */
/* §24 — concorrência                                                         */
/* ========================================================================== */

describe("a concorrência (§24)", () => {
  /**
   * ⚠️ O CENÁRIO EXATO DO ESCOPO: duas mensagens leem o nó 10, uma vai para o
   * 11 e a outra para o 12. Sem a comparação de `lock_version` no `where`, a
   * segunda escrita sobrescreveria a primeira com um avanço calculado a partir
   * de um estado que já não existe — e ninguém veria erro nenhum.
   */
  it("flow_commit_step só grava quando o lock_version lido ainda vale", () => {
    const fn = corpo("flow_commit_step");

    expect(fn).toMatch(/update\s+public\.flow_runs/i);
    expect(fn).toMatch(
      /where\s+r\.id\s*=\s*v_run_id\s*and\s+r\.lock_version\s*=\s*p_lock_version/i,
    );
  });

  it("e incrementa o contador na mesma escrita", () => {
    expect(corpo("flow_commit_step")).toMatch(/lock_version\s*=\s*r\.lock_version\s*\+\s*1/i);
  });

  /**
   * A recusa precisa ser SILENCIOSA e detectável — `false`, não exceção. Uma
   * exceção viraria 500 no webhook, o fornecedor reentregaria, e a reentrega
   * encontraria o passo já reivindicado: a conversa ficaria travada.
   */
  it("a recusa devolve false em vez de levantar", () => {
    const fn = corpo("flow_commit_step");
    expect(fn).toMatch(/if\s+not\s+found\s+then\s+return\s+false;/i);
  });
});

/* ========================================================================== */
/* §33 e §34 — versionamento                                                  */
/* ========================================================================== */

describe("o versionamento (§33, §34)", () => {
  /**
   * ⚠️ NENHUMA FUNÇÃO DO MOTOR PODE ESCREVER `flow_version_id`. É essa ausência
   * que garante que uma conversa em andamento não salte para a v3 publicada no
   * meio dela — e ela é uma ausência, então só um teste a enxerga.
   */
  it("nenhuma função do motor reescreve a versão de uma execução em curso", () => {
    for (const nome of ["flow_commit_step", "flow_set_automation_pause"]) {
      expect(corpo(nome), nome).not.toMatch(/set[\s\S]{0,400}flow_version_id\s*=/i);
    }
  });

  /**
   * §3. "Nunca executar uma versão em RASCUNHO. Nunca em TESTE." A abertura
   * precisa exigir `published` explicitamente — depender de `active_version_id`
   * só ser preenchido pela publicação é depender de um invariante não escrito.
   */
  it("flow_begin_run só aceita versão publicada, de fluxo ativo e de entrada", () => {
    const fn = corpo("flow_begin_run");

    expect(fn).toMatch(/v\.status\s*=\s*'published'/i);
    expect(fn).toMatch(/f\.status\s*=\s*'active'/i);
    expect(fn).toMatch(/f\.is_entry/i);
  });

  /**
   * §37. "Nunca confiar em IDs enviados pelo frontend." A prova é a ASSINATURA:
   * a função recebe canal e conversa, e não fluxo nem versão. Não existe
   * parâmetro capaz de mandar o motor executar um rascunho.
   */
  it("a abertura não aceita flow_id nem version_id como parâmetro", () => {
    const assinatura = /create\s+or\s+replace\s+function\s+public\.flow_begin_run\s*\(([^)]*)\)/i
      .exec(ENGINE)?.[1]
      ?.toLowerCase();

    expect(assinatura).toBeDefined();
    expect(assinatura).toContain("p_channel");
    expect(assinatura).toContain("p_chat_id");
    expect(assinatura).not.toContain("version");
    expect(assinatura).not.toContain("p_flow_id");
  });

  /** §28. Reentrada: uma conversa aberta é reencontrada, não duplicada. */
  it("flow_begin_run devolve a execução aberta quando já existe", () => {
    const fn = corpo("flow_begin_run");
    expect(fn).toMatch(
      /status\s+in\s*\(\s*'running'\s*,\s*'waiting_reply'\s*,\s*'handed_off'\s*\)/i,
    );
  });
});

/* ========================================================================== */
/* §27 — tempo                                                                */
/* ========================================================================== */

describe("o tempo (§27)", () => {
  it("a varredura respeita o prazo do fluxo e ignora quem já encerrou", () => {
    const fn = corpo("flow_timeout_due");

    expect(fn).toMatch(/r\.last_activity_at\s*<\s*now\(\)\s*-\s*make_interval/i);
    expect(fn).toMatch(/r\.status\s+in\s*\(\s*'running'\s*,\s*'waiting_reply'\s*\)/i);
  });

  /**
   * §29. Uma conversa que uma pessoa assumiu não vence por silêncio do robô: o
   * silêncio ali é o atendimento humano acontecendo fora deste sistema.
   */
  it("a varredura pula conversas em atendimento humano", () => {
    expect(corpo("flow_timeout_due")).toMatch(/automation_paused_until\s+is\s+null\s+or/i);
  });

  /**
   * ⚠️ A VARREDURA NÃO PODE ESCREVER. Se ela encerrasse conversas por conta
   * própria, existiriam dois caminhos de mudança de estado com regras próprias
   * — e na primeira manutenção eles divergiriam. Quem age é o motor, pelas
   * portas normais.
   */
  it("a varredura só lê", () => {
    const fn = corpo("flow_timeout_due");
    expect(fn).toMatch(/language\s+sql/i);
    expect(fn).toMatch(/\bstable\b/i);
    expect(fn).not.toMatch(/\b(update|insert|delete)\s+(into\s+)?public\./i);
  });

  /** Configuração pela metade é silenciosa — por isso o CHECK. */
  it("prazo e ação são cobrados juntos", () => {
    expect(ENGINE).toMatch(/constraint\s+flows_timeout_shape/i);
    expect(ENGINE).toMatch(/constraint\s+flows_timeout_team/i);
  });
});

/* ========================================================================== */
/* §21 e §22 — a trilha                                                       */
/* ========================================================================== */

describe("a trilha (§21, §22)", () => {
  it("todo tipo de evento do TypeScript existe no enum do banco", () => {
    const declarados = new Set(
      [...ENGINE.matchAll(/'([a-z_]+)'/g)].map((achado) => achado[1] ?? ""),
    );

    const faltando = FLOW_EVENT_TYPES.filter((tipo) => !declarados.has(tipo));

    expect(
      faltando,
      `\n\nTipos em FLOW_EVENT_TYPES que o enum flow_event_type NÃO declara:\n\n` +
        faltando.map((t) => `  ${t}`).join("\n") +
        `\n\nO motor gravaria um evento que o Postgres recusa com 22P02 — e a\n` +
        `trilha perderia a linha exatamente do passo que alguém foi investigar.\n`,
    ).toEqual([]);
  });

  it("todo desfecho de passo do TypeScript existe no enum do banco", () => {
    for (const status of FLOW_STEP_STATUSES) {
      expect(ENGINE, status).toContain(`'${status}'`);
    }
  });

  /** §21. O histórico precisa responder "quanto demorou" e "o que deu errado". */
  it("o passo guarda tipo, desfecho, erro e duração", () => {
    for (const coluna of ["node_type", "status", "error", "duration_ms", "metadata"]) {
      expect(ENGINE, coluna).toMatch(
        new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${coluna}\\b`, "i"),
      );
    }
  });

  /**
   * ⚠️ A TRILHA NÃO PODE FICAR PARA TRÁS EM RELAÇÃO AO ESTADO. Gravada em outra
   * chamada, ela poderia se perder quando o estado já tivesse mudado — e uma
   * trilha incompleta com aparência de completa é pior que trilha nenhuma.
   */
  it("os eventos são gravados no mesmo commit do estado", () => {
    const fn = corpo("flow_commit_step");

    expect(fn).toMatch(/insert\s+into\s+public\.flow_run_events/i);
    expect(fn.indexOf("update public.flow_runs")).toBeLessThan(
      fn.indexOf("insert into public.flow_run_events"),
    );
  });
});

/* ========================================================================== */
/* §14 — os operadores, nos dois lados                                        */
/* ========================================================================== */

describe("os operadores sem valor (§14)", () => {
  /**
   * ⚠️ DUPLICAÇÃO DELIBERADA, GUARDADA POR UM TESTE. A regra
   * `condition_without_value` precisa saber quais operadores NÃO pedem valor, e
   * o Postgres não tem como ler `CONDITION_OPERATOR_REGISTRY`. A lista está
   * escrita nos dois lados.
   *
   * Sem este teste, acrescentar um operador sem valor (um `is_empty`, digamos)
   * faria a publicação recusar todo fluxo que o usasse — com a frase "compara e
   * não diz com o quê" para uma condição que, por definição, não compara com
   * nada.
   */
  it("a lista do banco bate com a do registro", () => {
    const regra =
      /not\s+in\s*\(\s*('(?:exists|not_exists|is_true|is_false)'(?:\s*,\s*'[a-z_]+')*)\s*\)/i.exec(
        ENGINE,
      );

    expect(regra, "a regra condition_without_value não foi encontrada na migration").not.toBeNull();

    const noBanco = [...(regra?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? "").sort();

    expect(noBanco).toEqual(["exists", "is_false", "is_true", "not_exists"]);
  });
});

/* ========================================================================== */
/* Segurança                                                                  */
/* ========================================================================== */

describe("as portas do motor", () => {
  const FUNCOES = [
    "flow_begin_run",
    "flow_claim_step",
    "flow_commit_step",
    "flow_set_automation_pause",
    "flow_timeout_due",
  ];

  /**
   * ⚠️ NENHUMA DELAS PODE SER ALCANÇADA POR UMA SESSÃO DE NAVEGADOR. São
   * `security definer` e escrevem estado de atendimento — uma delas alcançável
   * por `authenticated` permitiria forjar a trilha de uma conversa.
   */
  it("são todas revogadas de anon e authenticated", () => {
    for (const nome of FUNCOES) {
      const revogacao = new RegExp(
        `revoke\\s+execute\\s+on\\s+function\\s+public\\.${nome}[\\s\\S]{0,300}?from[\\s\\S]{0,80}?authenticated`,
        "i",
      );
      expect(ENGINE, `${nome} precisa ser revogada de authenticated`).toMatch(revogacao);
    }
  });

  /**
   * ⚠️ ESTE TESTE GUARDA UMA CONVENÇÃO, E NÃO UM DEFEITO — e a distinção está
   * escrita aqui porque ele nasceu de um diagnóstico ERRADO.
   *
   * A suspeita era de que `revoke ... from public` trancasse o `service_role`
   * junto (ele herdaria o EXECUTE da concessão padrão). Verificado contra o
   * banco: NÃO tranca. `compile_flow_definition` tem o mesmo padrão — revoke
   * sem grant — e o `service_role` a executa normalmente, porque o Supabase
   * concede EXECUTE a ele por `alter default privileges`. Os `42501` que
   * levaram à suspeita vinham de outra coisa: a chave publicável no lugar da
   * secreta no `.env.local`.
   *
   * O que este teste continua valendo é o motivo de sempre: o privilégio
   * implícito é uma promessa da PLATAFORMA, não do schema. Ele não aparece ao
   * ler o SQL, e depende de as default privileges do projeto continuarem como
   * estão. O grant explícito custa cinco linhas e diz, para quem lê a
   * migration, quem chama aquelas funções.
   *
   * Se um dia isto atrapalhar, apague-o — mas apague sabendo que é uma
   * convenção que se está abandonando, e não uma proteção.
   */
  it("e todas concedidas a service_role — a convenção, não uma barreira", () => {
    for (const nome of FUNCOES) {
      const concessao = new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+public\\.${nome}[\\s\\S]{0,400}?to[\\s\\S]{0,80}?service_role`,
        "i",
      );

      expect(
        TODO_SQL,
        `\n\n${nome} não tem grant explícito para service_role.\n\n` +
          `Hoje ela funciona assim mesmo — o Supabase concede EXECUTE ao service_role\n` +
          `por default privileges. O grant explícito existe para a intenção ficar no\n` +
          `SQL, e não numa configuração de plataforma que ninguém vê ao ler a migration.\n`,
      ).toMatch(concessao);
    }
  });

  it("a trilha de eventos é somente leitura, e só para quem edita fluxos", () => {
    expect(ENGINE).toMatch(
      /alter\s+table\s+public\.flow_run_events\s+enable\s+row\s+level\s+security/i,
    );
    expect(ENGINE).toMatch(/create\s+policy\s+"flow_run_events_select"[\s\S]{0,160}for\s+select/i);
    expect(ENGINE).toMatch(
      /revoke\s+insert,\s*update,\s*delete\s+on\s+public\.flow_run_events\s+from\s+authenticated,\s*anon/i,
    );
  });
});
