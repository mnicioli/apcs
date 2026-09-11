import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSION_MATRIX } from "@/lib/rbac/rbac.config";

/**
 * AS INVARIANTES DA TABULAÇÃO, LIDAS DO TEXTO DAS MIGRATIONS.
 *
 * ============================================================================
 * ⚠️ AQUI ESTE FORMATO DE TESTE VALE MAIS QUE NOS DOIS PROMPTS ANTERIORES.
 * ============================================================================
 * Este projeto NÃO sobe Postgres na bateria. Nos prompts 1 e 2 isso deixava de
 * fora a ESCRITA (o carimbo, a trilha, a transação); aqui deixa de fora o
 * CÁLCULO — média, distribuição, elegíveis, versão, rodada.
 *
 * E o §44 é justamente o que torna isso inevitável: "o frontend apenas
 * apresenta os resultados". Não há média para testar em TypeScript porque não há
 * média em TypeScript. Ela é uma linha de SQL — e uma linha de SQL errada
 * produz um número plausível, que é o pior tipo de defeito: ninguém confere uma
 * média de 60 respostas à mão.
 *
 * Então o que dá para cobrar é a FORMA das consultas, e cada caso aqui pergunta
 * uma coisa só: a confirmação não entra na conta de elegíveis? a rodada é
 * filtrada? a média ignora texto? o token sai do arquivo?
 *
 * ⚠️ E O HISTÓRICO JUSTIFICA. O corpo de uma função PL/pgSQL só é analisado na
 * PRIMEIRA VEZ que cada comando roda: `create function` aceita feliz, o
 * type-check não fala com o Postgres, e os testes de service mockam o Supabase —
 * justamente quem recusaria.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const RESULTADOS = "20261003000100_event_evaluation_results.sql";
const ENUMS = "20261003000000_event_evaluation_results_enums.sql";

const sql = readFileSync(join(MIGRATIONS, RESULTADOS), "utf8");
const sqlEnums = readFileSync(join(MIGRATIONS, ENUMS), "utf8");

/**
 * O SQL sem os comentários.
 *
 * ⚠️ SEM ISTO O TESTE MENTE. As migrations deste projeto explicam cada decisão
 * em blocos longos de `--`, e vários deles CITAM comandos e nomes de coluna. Um
 * regex que enxerga comentário aprovaria um arquivo que não faz nada do que o
 * comentário promete.
 */
function semComentarios(texto: string): string {
  return texto.replace(/--[^\n]*/g, "");
}

const codigo = semComentarios(sql);
const codigoEnums = semComentarios(sqlEnums);

/** O corpo da função, da declaração até o `$$;` que a fecha. */
function corpoDe(nome: string): string {
  const inicio = codigo.lastIndexOf(`create or replace function public.${nome}(`);
  expect(inicio, `função ${nome} não encontrada`).toBeGreaterThan(-1);
  const fim = codigo.indexOf("\n$$;", inicio);
  expect(fim, `função ${nome} não tem fim`).toBeGreaterThan(inicio);
  return codigo.slice(inicio, fim);
}

describe("a bateria está lendo o que acha que está lendo", () => {
  it("os dois arquivos existem", () => {
    const naPasta = readdirSync(MIGRATIONS);
    expect(naPasta).toContain(RESULTADOS);
    expect(naPasta).toContain(ENUMS);
    expect(codigo.length).toBeGreaterThan(15_000);
  });

  it("os comentários foram removidos antes das asserções", () => {
    expect(sql).toContain("-- ");
    expect(codigo).not.toContain("-- ");
  });

  /**
   * ⚠️ AQUI A SEPARAÇÃO DE ARQUIVO É OBRIGATÓRIA, diferente do Prompt 2. Lá eram
   * `create type`, que nasce usável no mesmo arquivo. Este é
   * `alter type ... add value`, e o Postgres recusa o USO na mesma transação.
   */
  it("o valor novo do enum está no arquivo anterior, e é usado no de resultados", () => {
    expect(codigoEnums).toMatch(
      /alter type public\.event_evaluation_audit_action\s+add value if not exists 'results_exported'/,
    );
    expect(codigo).not.toMatch(/alter type public\.event_evaluation_audit_action/);
    expect(corpoDe("log_evaluation_export")).toContain("'results_exported'");
  });
});

/* ========================================================================== */
/* §4 — elegíveis são os PRESENTES                                            */
/* ========================================================================== */

describe("§4 — a confirmação não é critério de nada", () => {
  /**
   * ⚠️ "120 inscritos, 90 confirmados, 80 presentes → elegíveis = 80. Não: 90."
   *
   * A regra sai de graça porque a coluna `confirmation` simplesmente NÃO É LIDA.
   * É isso que este caso cobra — a ausência, e não a presença de um `if`.
   */
  it("o resumo não lê `confirmation` em lugar nenhum", () => {
    expect(corpoDe("event_results_summary")).not.toContain("confirmation");
  });

  it("elegíveis e presentes saem da MESMA contagem", () => {
    const corpo = corpoDe("event_results_summary");
    expect(corpo).toMatch(
      /presentes as \([\s\S]*?where p\.event_id = p_event_id and p\.present\s*\)/,
    );
    expect(corpo).toMatch(/'present', \(select count\(\*\) from presentes\)/);
    expect(corpo).toMatch(/'eligible', \(select count\(\*\) from presentes\)/);
  });

  it("a lista de pendentes também filtra por presença", () => {
    expect(corpoDe("event_results_pending")).toContain("and p.present");
  });

  it("nem a de pendentes lê confirmação", () => {
    expect(corpoDe("event_results_pending")).not.toContain("confirmation");
  });
});

/* ========================================================================== */
/* §19 do Prompt 2 — a rodada                                                 */
/* ========================================================================== */

describe("a rodada é filtrada em toda agregação", () => {
  /**
   * ⚠️ REABRIR UMA AVALIAÇÃO INCREMENTA `answer_round` E PRESERVA A RESPOSTA
   * ANTERIOR (§19 do Prompt 2). Uma agregação que esquecesse o filtro contaria a
   * pessoa duas vezes na média — e a resposta que a APCS decidiu descartar
   * continuaria pesando.
   *
   * ⚠️ E O DEFEITO SERIA INVISÍVEL: a média mudaria de 4,6 para 4,5 e ninguém
   * teria como saber que está errada.
   */
  it("todas as cinco consultas casam a rodada com a da avaliação", () => {
    for (const fn of [
      "event_results_summary",
      "event_results_questions",
      "event_results_responses",
      "event_results_response_detail",
      "event_results_export",
    ]) {
      expect(corpoDe(fn), `${fn} não filtra a rodada`).toMatch(
        /a\.round = (av|pe|r)\.answer_round|a2\.round = f\.answer_round|a\.round = v_row\.answer_round/,
      );
    }
  });

  /**
   * ⚠️ AS RESPOSTAS SÃO FILTRADAS UMA VEZ, NO TOPO. Sem a CTE, cada agregação
   * repetiria o mesmo join e o mesmo filtro de rodada — e bastaria uma esquecer
   * para a conta sair errada só naquele número.
   */
  it("a tabulação parte de uma CTE única de respostas", () => {
    const corpo = corpoDe("event_results_questions");
    expect(corpo).toMatch(
      /respostas as \([\s\S]*?join avaliacoes av on av\.id = a\.participant_evaluation_id\s*and a\.round = av\.answer_round/,
    );
    expect(corpo).toMatch(/from respostas/);
  });
});

/* ========================================================================== */
/* §8, §35 — o que entra na média                                             */
/* ========================================================================== */

describe("§8 e §35 — a média é só do valor numérico", () => {
  /**
   * ⚠️ "NÃO CALCULAR MÉDIA SOBRE LABELS TEXTUAIS." Não é um `if` por tipo: é o
   * formato do dado. `avg` ignora nulo, e `numeric_value` é nulo em texto livre
   * e em escolha sem peso.
   */
  it("a média por pergunta é `avg(numeric_value)`", () => {
    expect(corpoDe("event_results_questions")).toMatch(/avg\(numeric_value\)::numeric as media/);
  });

  it("mínimo e máximo também saem do valor numérico (§7)", () => {
    const corpo = corpoDe("event_results_questions");
    expect(corpo).toContain("min(numeric_value) as minimo");
    expect(corpo).toContain("max(numeric_value) as maximo");
  });

  it("a contagem de respostas com nota ignora as sem valor", () => {
    expect(corpoDe("event_results_questions")).toContain(
      "count(*) filter (where numeric_value is not null) as com_nota",
    );
  });

  /**
   * ⚠️ A MÉDIA DO BLOCO É A MÉDIA DAS RESPOSTAS, e não a média das médias (§33).
   * As duas só coincidem quando toda pergunta tem o mesmo número de respostas —
   * e não têm, porque pergunta opcional fica em branco. A média das médias daria
   * peso igual a uma pergunta respondida por 60 pessoas e a outra por 3.
   */
  it("a média do bloco agrega as respostas, e não as médias", () => {
    expect(corpoDe("event_results_questions")).toMatch(
      /'average', \(\s*select avg\(r\.numeric_value\)::numeric\s*from respostas r[\s\S]*?where q2\.section_id = s\.id and r\.numeric_value is not null\s*\)/,
    );
  });

  /** §34. Sem pergunta marcada, `avg` volta nulo e a tela mostra "N/A". */
  it("a nota geral sai SÓ da pergunta marcada como geral", () => {
    expect(corpoDe("event_results_summary")).toMatch(
      /geral as \([\s\S]*?where av\.status = 'answered'\s*and q\.is_overall\s*and a\.numeric_value is not null/,
    );
  });

  it("o resumo diz se existe pergunta geral, para a tela não inventar média", () => {
    expect(corpoDe("event_results_summary")).toContain("'hasOverallQuestion'");
  });
});

/* ========================================================================== */
/* §36, §9 — o denominador do percentual                                      */
/* ========================================================================== */

describe("§36 — o percentual é sobre PESSOAS", () => {
  /**
   * ⚠️ `count(distinct participant_evaluation_id)`, E NÃO `count(*)`. Em múltipla
   * escolha uma pessoa gera várias linhas; dividir pelas linhas daria "quanto
   * esta opção representa das marcações", que ninguém pediu. Dividindo por
   * pessoas, a soma passa de 100% — exatamente o que o §36 descreve.
   */
  it("o denominador é a contagem DISTINTA de quem respondeu", () => {
    expect(corpoDe("event_results_questions")).toMatch(
      /respondentes as \(\s*select question_id, count\(distinct participant_evaluation_id\) as pessoas/,
    );
  });

  /**
   * ⚠️ `left join` NA DISTRIBUIÇÃO. Uma alternativa que ninguém escolheu precisa
   * aparecer com zero — "ninguém deu Péssimo" é um resultado, e some-la faria a
   * distribuição mudar de forma entre dois eventos com a mesma escala.
   */
  it("alternativa sem nenhuma escolha continua na distribuição", () => {
    expect(corpoDe("event_results_questions")).toMatch(
      /from public\.event_evaluation_options o\s*left join respostas r on r\.option_id = o\.id/,
    );
  });
});

/* ========================================================================== */
/* §21 — a versão                                                             */
/* ========================================================================== */

describe("§21 — os resultados respeitam a versão", () => {
  /**
   * ⚠️ SÓ AS VERSÕES QUE TÊM RESPOSTA. Uma v2 recém-publicada, sem ninguém que a
   * tenha respondido, apareceria como uma lista de perguntas com zero em tudo —
   * indistinguível de "todo mundo deixou em branco".
   */
  it("a tabulação só traz blocos de versões respondidas", () => {
    expect(corpoDe("event_results_questions")).toContain(
      "where s.version_id in (select distinct version_id from avaliacoes)",
    );
  });

  it("o detalhe usa a versão que AQUELA pessoa leu, e não a atual", () => {
    expect(corpoDe("event_results_response_detail")).toContain(
      "where s.version_id = pe.version_id",
    );
  });

  it("o resumo informa quantas versões foram respondidas", () => {
    expect(corpoDe("event_results_summary")).toMatch(
      /'answeredVersions', \(select count\(distinct version_id\)/,
    );
  });

  /**
   * ⚠️ COM DUAS VERSÕES, O RÓTULO DA COLUNA CARREGA A VERSÃO (§25). Sem isso o
   * cabeçalho teria "Infraestrutura - Recepção" duas vezes, com conteúdos
   * diferentes — a planilha que ninguém consegue conferir.
   */
  it("a exportação desambigua as colunas quando há mais de uma versão", () => {
    expect(corpoDe("event_results_export")).toMatch(
      /when \(select count\(distinct version_id\) from avaliacoes\) > 1\s*then 'v' \|\| v\.version/,
    );
  });

  /** §20. Os cinco campos que a comparação futura entre eventos vai precisar. */
  it("o modelo mantém evento, avaliação, versão, pergunta e resposta ligados", () => {
    const corpo = corpoDe("event_results_questions");
    expect(corpo).toContain("pe.event_id = p_event_id");
    expect(corpo).toContain("pe.version_id");
    expect(corpo).toContain("a.question_id");
    expect(corpo).toContain("a.numeric_value");
  });
});

/* ========================================================================== */
/* §18 — os filtros de nota                                                   */
/* ========================================================================== */

describe("§18 — o filtro de nota usa a pergunta geral", () => {
  /**
   * ⚠️ "NÃO APLICAR FILTRO DE NOTA INDISCRIMINADAMENTE A TODAS AS PERGUNTAS."
   * Filtrar "nota 5" contra qualquer pergunta traria quem deu 5 ao café e 1 ao
   * evento — que responde a pergunta errada.
   */
  it("a nota comparada é a da pergunta marcada como geral", () => {
    const corpo = corpoDe("event_results_responses");
    expect(corpo).toMatch(
      /select a\.numeric_value[\s\S]*?join public\.event_evaluation_questions q on q\.id = a\.question_id[\s\S]*?and q\.is_overall/,
    );
    expect(corpo).toMatch(/p_filter = 'rating_5' and b\.overall_value = 5/);
  });

  it("os cinco filtros de nota existem, e o de comentário também", () => {
    const corpo = corpoDe("event_results_responses");
    for (const n of [1, 2, 3, 4, 5]) {
      expect(corpo, `falta o filtro de nota ${n}`).toContain(`p_filter = 'rating_${n}'`);
    }
    expect(corpo).toContain("p_filter = 'with_comment' and b.comment is not null");
  });

  /** §27. O MESMO filtro na exportação — é o que a faz respeitar a tela. */
  it("a exportação aplica exatamente os mesmos filtros", () => {
    const lista = corpoDe("event_results_responses");
    const exporta = corpoDe("event_results_export");

    for (const trecho of [
      "p_filter = 'with_comment'",
      "p_filter = 'rating_5'",
      "p_filter = 'rating_1'",
    ]) {
      expect(lista).toContain(trecho);
      expect(exporta, `a exportação não tem ${trecho}`).toContain(trecho);
    }
  });

  /** §17. A busca atravessa participante, granja, e-mail e telefone. */
  it("a busca cobre os quatro campos que a tela oferece", () => {
    for (const fn of ["event_results_responses", "event_results_export"]) {
      const corpo = corpoDe(fn);
      expect(corpo).toContain("b.full_name ilike");
      expect(corpo).toContain("b.email ilike");
      expect(corpo).toContain("b.company_name ilike");
      expect(corpo).toContain("b.whatsapp");
    }
  });
});

/* ========================================================================== */
/* §13, §16 — comentários e lista de respostas                                */
/* ========================================================================== */

describe("§13 e §16 — os comentários são identificados", () => {
  /**
   * ⚠️ O COMENTÁRIO VEM COM O PARTICIPANTE E A GRANJA NA MESMA LINHA. A APCS
   * optou por identificação (§13 do Prompt 2), e separar os dois obrigaria a
   * abrir uma tela por comentário para saber de quem é.
   */
  it("a lista traz nome, granja e comentário juntos", () => {
    const corpo = corpoDe("event_results_responses");
    expect(corpo).toContain("'fullName', f.full_name");
    expect(corpo).toContain("'companyName', f.company_name");
    expect(corpo).toContain("'comment', f.comment");
  });

  /**
   * ⚠️ `string_agg` PORQUE UM FORMULÁRIO PODE TER MAIS DE UMA PERGUNTA DE TEXTO.
   * Pegar só a primeira esconderia a segunda sem avisar ninguém.
   */
  it("mais de uma pergunta de texto vira um comentário só, e não some", () => {
    expect(corpoDe("event_results_responses")).toMatch(
      /string_agg\(btrim\(a\.text_value\), ' — ' order by q\.position, q\.id\)/,
    );
  });

  /** §16. "Evitar estados desnecessários nessa tabela." */
  it("a lista de respostas só traz quem respondeu", () => {
    expect(corpoDe("event_results_responses")).toContain("and pe.status = 'answered'");
  });

  it("a lista é ordenada da resposta mais recente para a mais antiga", () => {
    expect(corpoDe("event_results_responses")).toContain("order by f.answered_at desc nulls last");
  });
});

/* ========================================================================== */
/* §31 — quem não respondeu                                                   */
/* ========================================================================== */

describe("§31 — os pendentes", () => {
  /**
   * ⚠️ INCLUI QUEM AINDA NEM TEM AVALIAÇÃO CRIADA. É o caso que ninguém
   * descobre sozinho, porque não há linha para aparecer em lugar nenhum — e o
   * §31 pede "receberam avaliação OU possuem envio pendente".
   */
  it("um presente sem avaliação criada continua na lista", () => {
    expect(corpoDe("event_results_pending")).toMatch(
      /left join public\.event_participant_evaluations pe[\s\S]*?and \(pe\.id is null or pe\.status in/,
    );
  });

  /**
   * ⚠️ CANCELADA FICA DE FORA. Alguém decidiu que aquela pessoa não vai receber;
   * listá-la como pendência faria a lista nunca esvaziar.
   */
  it("cancelada e respondida não entram", () => {
    const corpo = corpoDe("event_results_pending");
    expect(corpo).toMatch(/pe\.status in \('pending', 'scheduled', 'sent', 'expired'\)/);
    expect(corpo).not.toMatch(/pe\.status in \([^)]*'cancelled'/);
    expect(corpo).not.toMatch(/pe\.status in \([^)]*'answered'/);
  });

  /** §28/§29. "Falha" não é status: é `last_error` preenchido. */
  it("a contagem de falhas sai de `last_error`, e não de um status novo", () => {
    expect(corpoDe("event_results_pending")).toContain(
      "'failed', (select count(*) from base where last_error is not null)",
    );
    expect(corpoDe("event_results_summary")).toMatch(
      /'failed',[\s\S]{0,120}last_error is not null and status <> 'answered'/,
    );
  });

  it("nenhuma consulta inventa um status `failed` (§29)", () => {
    expect(codigo).not.toMatch(/'failed'::public\.event_evaluation_status/);
    expect(codigo).not.toMatch(/status = 'failed'/);
  });
});

/* ========================================================================== */
/* §25, §41 — a exportação                                                    */
/* ========================================================================== */

describe("§25 e §41 — a exportação", () => {
  /** §25. As colunas são montadas a partir das perguntas reais do formulário. */
  it("as colunas vêm das perguntas, e não de uma lista fixa", () => {
    const corpo = corpoDe("event_results_export");
    expect(corpo).toContain("'questions', coalesce(");
    expect(corpo).toMatch(/s\.title \|\| ' - ' \|\| q\.prompt/);
  });

  /**
   * ⚠️ UM MAPA `questionId → resposta`, e não um array na ordem das colunas. O
   * array dependeria de a rota iterar exatamente na mesma ordem da CTE — e o dia
   * em que divergissem, cada valor entraria na coluna do vizinho, em silêncio.
   */
  it("as respostas saem indexadas pelo id da pergunta", () => {
    expect(corpoDe("event_results_export")).toContain("jsonb_object_agg(");
  });

  /**
   * ⚠️ O TOKEN NÃO SAI NO ARQUIVO (§41: "não incluir tokens de avaliação no
   * Excel"). Não há como escapar por engano: a coluna não é selecionada, e o
   * `revoke select (token)` do Prompt 2 impediria mesmo se estivesse.
   */
  it("o token não aparece em consulta nenhuma deste arquivo", () => {
    for (const fn of [
      "event_results_summary",
      "event_results_questions",
      "event_results_responses",
      "event_results_response_detail",
      "event_results_pending",
      "event_results_export",
    ]) {
      expect(corpoDe(fn), `${fn} está selecionando o token`).not.toMatch(/\btoken\b/);
    }
  });

  it("a exportação também só leva quem respondeu", () => {
    expect(corpoDe("event_results_export")).toContain("and pe.status = 'answered'");
  });
});

/* ========================================================================== */
/* §42 — a trilha da exportação                                               */
/* ========================================================================== */

describe("§42 — baixar a planilha deixa rastro", () => {
  /**
   * ⚠️ `SECURITY DEFINER` PORQUE ESCREVE NA TRILHA, que é tabela fechada — e com
   * a checagem por dentro, porque DEFINER desliga a RLS.
   */
  it("é DEFINER e confere a permissão por dentro", () => {
    const corpo = corpoDe("log_evaluation_export");
    expect(corpo).toContain("security definer");
    expect(corpo).toContain("public.results_is_exporter()");
    expect(corpo).toContain("errcode = '42501'");
  });

  /**
   * ⚠️ O TERMO BUSCADO NÃO ENTRA NA TRILHA (§41). Ele pode ser o e-mail, o
   * telefone ou o nome de uma pessoa — e a trilha é a tabela que ninguém pensa
   * em varrer quando alguém pede exclusão de dados. O que fica é SE houve busca.
   */
  it("guarda quantas linhas e SE houve busca, nunca o termo", () => {
    const corpo = corpoDe("log_evaluation_export");
    expect(corpo).toContain("'rows'");
    expect(corpo).toContain("'searched'");
    expect(corpo).not.toMatch(/'query'|p_query/);
  });

  it("não guarda nome, e-mail nem telefone", () => {
    const corpo = corpoDe("log_evaluation_export");
    for (const proibido of ["full_name", "email", "whatsapp", "phone"]) {
      expect(corpo, `a trilha está guardando ${proibido}`).not.toContain(proibido);
    }
  });
});

/* ========================================================================== */
/* §40, §45 — permissão e IDOR                                                */
/* ========================================================================== */

describe("§40 — as duas camadas contam a mesma história", () => {
  it("os papéis do banco batem com a PERMISSION_MATRIX", () => {
    const leitor = corpoDe("results_is_reader");
    const exportador = corpoDe("results_is_exporter");

    for (const papel of PERMISSION_MATRIX["results.read"]) {
      expect(leitor, `results_is_reader não inclui ${papel}`).toContain(`'${papel}'`);
    }
    for (const papel of PERMISSION_MATRIX["results.export"]) {
      expect(exportador, `results_is_exporter não inclui ${papel}`).toContain(`'${papel}'`);
    }

    // A direção oposta: o Atendente lê e NÃO baixa.
    expect(PERMISSION_MATRIX["results.export"]).not.toContain("comercial");
    expect(exportador).not.toContain("'comercial'");
  });

  /**
   * ⚠️ SÓ O TETO NÃO BASTA. Uma permissão acrescentada depois entra em
   * `app_role_ceilings` e não entra em cargo nenhum — e o item "Resultados"
   * ficaria invisível até para o Administrador, com a RLS liberada.
   */
  it("as duas permissões são semeadas no teto E nos cargos embutidos", () => {
    for (const chave of ["results.read", "results.export"]) {
      expect(codigo, `${chave} não está no teto`).toContain(`'${chave}'`);
    }
    expect(codigo).toContain("insert into public.app_role_permissions (role_key, permission)");
    expect(codigo).toContain("where r.is_builtin");
  });

  /**
   * ⚠️ AS CONSULTAS SÃO INVOKER DE PROPÓSITO (decisão 4). Quem não passa em
   * `evaluations_is_reader()` recebe zero linhas mesmo que a checagem de
   * permissão da aplicação falhe. DEFINER aqui seria trocar a segunda barreira
   * por nada.
   */
  it("nenhuma consulta de leitura é SECURITY DEFINER", () => {
    for (const fn of [
      "event_results_summary",
      "event_results_questions",
      "event_results_responses",
      "event_results_response_detail",
      "event_results_pending",
      "event_results_export",
    ]) {
      expect(corpoDe(fn), `${fn} virou DEFINER`).not.toContain("security definer");
    }
  });

  it("nenhuma delas é alcançável por `anon`", () => {
    for (const fn of [
      "event_results_summary(uuid)",
      "event_results_questions(uuid)",
      "event_results_response_detail(uuid, uuid)",
    ]) {
      const escapada = fn.replace(/[()]/g, "\\$&").replace(/, /g, ",\\s*");
      expect(codigo).toMatch(
        new RegExp(`revoke execute on function public\\.${escapada}[\\s\\S]{0,60}anon`),
      );
    }
  });
});

describe("§45 — IDOR", () => {
  /**
   * ⚠️ O DETALHE CONFERE A CADEIA. `p_participant_evaluation_id` vem da URL; sem
   * o `and pe.event_id = p_event_id`, um id trocado abriria a resposta de OUTRO
   * evento — com nome, e-mail e comentário de quem não tem nada a ver com a
   * tela.
   */
  it("o detalhe confere que a resposta é DESTE evento", () => {
    expect(corpoDe("event_results_response_detail")).toMatch(
      /where pe\.id = p_participant_evaluation_id\s*and pe\.event_id = p_event_id/,
    );
  });

  it("toda consulta é recortada pelo evento", () => {
    for (const fn of [
      "event_results_summary",
      "event_results_questions",
      "event_results_responses",
      "event_results_pending",
      "event_results_export",
    ]) {
      expect(corpoDe(fn), `${fn} não recorta por evento`).toMatch(/event_id = p_event_id/);
    }
  });
});

/* ========================================================================== */
/* §23 — performance                                                          */
/* ========================================================================== */

describe("§23 — os índices que a tabulação pede", () => {
  it("os quatro índices novos existem", () => {
    for (const indice of [
      "event_participant_evaluations_answered_idx",
      "event_participant_evaluations_version_idx",
      "event_evaluation_answers_option_idx",
      "event_evaluation_answers_text_idx",
    ]) {
      expect(codigo, `falta o índice ${indice}`).toContain(`create index if not exists ${indice}`);
    }
  });

  /**
   * ⚠️ PARCIAIS ONDE A MAIORIA DAS LINHAS NÃO INTERESSA. `answered_at` é nulo
   * para todo o resto; a maioria esmagadora das respostas não é comentário. Sem
   * o `where`, os índices carregariam linhas que aquelas consultas nunca leem.
   */
  it("os índices de resposta e de comentário são parciais", () => {
    expect(codigo).toMatch(
      /event_participant_evaluations_answered_idx[\s\S]{0,140}where status = 'answered'/,
    );
    expect(codigo).toMatch(
      /event_evaluation_answers_text_idx[\s\S]{0,140}where text_value is not null/,
    );
  });

  /** §34. O índice da pergunta geral também é parcial: uma linha entre milhares. */
  it("o índice da pergunta geral é parcial", () => {
    expect(codigo).toMatch(/event_evaluation_questions_overall_idx[\s\S]{0,120}where is_overall/);
  });
});

/* ========================================================================== */
/* §34 — a coluna nova                                                        */
/* ========================================================================== */

describe("§34 — a pergunta de avaliação geral", () => {
  it("a coluna existe com padrão falso", () => {
    expect(codigo).toMatch(/add column if not exists is_overall boolean not null default false/);
  });

  /** §35. Média de texto livre não existe — o CHECK impede o estado. */
  it("só pergunta de nota pode ser a geral, e o CHECK impõe", () => {
    expect(codigo).toMatch(
      /event_evaluation_questions_overall_is_rating\s*check \(not is_overall or question_type = 'rating'\)/,
    );
  });

  /**
   * ⚠️ SEM ESTE `update`, o modelo padrão semeado no Prompt 2 ficaria sem
   * pergunta geral — e a "Nota média geral" abriria em "N/A" para todo evento
   * que usasse o padrão da casa.
   */
  it("o modelo padrão é marcado retroativamente, e só ele", () => {
    expect(codigo).toMatch(
      /update public\.event_evaluation_questions q\s*set is_overall = true[\s\S]*?btrim\(lower\(s\.title\)\) = 'avaliação geral'/,
    );
    // ⚠️ E não sobrescreve quem já tem uma marcada.
    expect(codigo).toMatch(/and not exists \([\s\S]*?outra\.is_overall\s*\)/);
  });

  /**
   * ⚠️ NO MÁXIMO UMA POR VERSÃO, imposta pelo ÚNICO caminho de escrita. Um
   * índice único não alcança: a versão está a dois saltos da pergunta, e índice
   * não atravessa junção.
   */
  it("o salvamento da estrutura recusa duas perguntas gerais", () => {
    const corpo = corpoDe("save_event_evaluation_structure");
    expect(corpo).toContain("v_gerais := v_gerais + 1");
    expect(corpo).toMatch(/if v_gerais > 1 then[\s\S]{0,200}errcode = 'AV003'/);
  });

  it("o salvamento recusa marcar uma pergunta que não é de nota", () => {
    expect(corpoDe("save_event_evaluation_structure")).toMatch(
      /v_is_overall and v_tipo <> 'rating'[\s\S]{0,200}errcode = 'AV003'/,
    );
  });

  it("a estrutura devolvida ao construtor carrega a marcação", () => {
    expect(corpoDe("evaluation_version_structure")).toContain("'isOverall', qq.is_overall");
  });
});

/* ========================================================================== */
/* A migration não é destrutiva                                               */
/* ========================================================================== */

describe("a migration", () => {
  it("tem bloco de ROLLBACK nos dois arquivos", () => {
    expect(sql).toContain("-- ROLLBACK");
    expect(sqlEnums).toContain("-- ROLLBACK");
  });

  /**
   * ⚠️ ELA NÃO CRIA TABELA NENHUMA, e é o ponto do prompt: o §22 manda derivar
   * dos dados persistidos. Uma tabela de agregados seria uma segunda verdade
   * sobre os mesmos fatos.
   */
  it("não cria tabela de resultados agregados", () => {
    expect(codigo).not.toMatch(/create table/);
  });

  it("não apaga nem reescreve resposta nenhuma", () => {
    expect(codigo).not.toMatch(/drop table/);
    expect(codigo).not.toMatch(/drop column/);
    expect(codigo).not.toMatch(/truncate/);
    expect(codigo).not.toMatch(/delete from public\.event_evaluation_answers/);
    expect(codigo).not.toMatch(/delete from public\.event_participant_evaluations/);
  });

  /**
   * ⚠️ O ÚNICO `update` DO ARQUIVO É A MARCAÇÃO DA PERGUNTA GERAL, e ele é
   * restrito. Qualquer outro seria reescrita de dado coletado.
   */
  it("o único UPDATE é o da pergunta geral", () => {
    const updates = codigo.match(/update public\.\w+/g) ?? [];
    expect(updates).toEqual(["update public.event_evaluation_questions"]);
  });
});
