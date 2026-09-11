import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/rbac/rbac.types";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  barWidth,
  formatAverage,
  formatPercent,
  hasAverage,
  largestOption,
  optionPercent,
  ratingScaleMax,
  responseRatePercent,
  resultsStage,
} from "@/modules/event/event.results.rules";
import {
  EMPTY_RESULTS_FILTERS,
  RATING_FILTERS,
  RESULTS_FILTERS,
  type ResultsOption,
  type ResultsQuestion,
} from "@/modules/event/event.results.types";
import {
  eventResultsHref,
  hasActiveResultsFilters,
  parseResultsFilters,
  responseDetailHref,
  resultsExportHref,
  resultsHref,
} from "@/modules/event/event.results.routes";
import { evaluationStructureSchema } from "@/modules/event/event.evaluation.schema";

/**
 * A TABULAÇÃO DOS RESULTADOS, DA URL ATÉ A CHAMADA AO BANCO.
 *
 * ============================================================================
 * ⚠️ O QUE ESTE ARQUIVO EXERCITA DE VERDADE, E O QUE ELE NÃO ALCANÇA.
 * ============================================================================
 * Roda de verdade, sem mock: as regras derivadas (percentual, escala, largura de
 * barra, taxa, etapa vazia), a serialização dos filtros, a matriz de permissões
 * e os services inteiros — inclusive o que eles MANDAM para o banco.
 *
 * O que ele NÃO alcança é o Postgres. Este projeto não sobe banco na bateria, e
 * é ali que moram as AGREGAÇÕES: média, mínimo, máximo, distribuição, elegíveis,
 * separação por versão e a rodada. Elas são cobertas por
 * `sql-event-results.test.ts`, que lê as invariantes do texto do SQL.
 *
 * ⚠️ E ISSO É UMA CONSEQUÊNCIA DO §44, não uma lacuna de teste. "O frontend
 * apenas apresenta os resultados" — então não há média para testar em
 * TypeScript: ela chega pronta. O que dá para provar aqui é que o recorte certo
 * é PEDIDO, que o percentual é apresentado com o denominador certo, e que quem
 * não pode não passa.
 */

const EVENTO = "11111111-1111-4111-8111-111111111111";
const OUTRO_EVENTO = "22222222-2222-4222-8222-222222222222";
const RESPOSTA = "33333333-3333-4333-8333-333333333333";

/* -------------------------------------------------------------------------- */
/* Os services, com o Supabase mockado                                         */
/* -------------------------------------------------------------------------- */

const rpc = vi.hoisted(() => vi.fn());
let papelAtual: Role | null = "admin";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: papelAtual === null ? null : { id: "99999999-9999-4999-8999-999999999999" } },
      }),
    },
    rpc,
  }),
}));

const {
  getResponseDetail,
  getResultsExport,
  getResultsPending,
  getResultsQuestions,
  getResultsResponses,
  getResultsSummary,
} = await import("@/lib/services/event-results");

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
  papelAtual = "admin";
});

function argumentos(): Record<string, unknown> {
  return (rpc.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
}

function pergunta(extra: Partial<ResultsQuestion> = {}): ResultsQuestion {
  return {
    questionId: "q1",
    prompt: "Tema e conteúdo",
    type: "rating",
    required: true,
    isOverall: false,
    position: 1,
    respondents: 0,
    answers: 0,
    average: null,
    min: null,
    max: null,
    textCount: 0,
    options: [],
    ...extra,
  };
}

function opcao(label: string, total: number, value: number | null = null): ResultsOption {
  return { optionId: label, label, value, position: 1, total };
}

/* ========================================================================== */
/* §6 e §30 — a taxa de resposta                                              */
/* ========================================================================== */

describe("§6 e §30 — a taxa de resposta", () => {
  /**
   * ⚠️ RESPONDIDAS / ENVIADAS, e é a regra que o §30 recomenda: "isso evita
   * considerar participantes que não eram elegíveis ou que não receberam a
   * avaliação". Dividir por PRESENTES misturaria adesão de quem recebeu com
   * eficiência do disparo.
   */
  it("é respondidas sobre enviadas", () => {
    expect(responseRatePercent(87, 64)).toBeCloseTo(73.56, 2);
  });

  it("zero enviadas devolve 0%, e não divisão por zero", () => {
    expect(responseRatePercent(0, 0)).toBe(0);
    expect(Number.isFinite(responseRatePercent(0, 0))).toBe(true);
  });

  it("ninguém respondeu com envios feitos dá 0%", () => {
    expect(responseRatePercent(87, 0)).toBe(0);
  });

  it("todo mundo respondeu dá 100%", () => {
    expect(responseRatePercent(40, 40)).toBe(100);
  });

  it("o formato em português usa vírgula e no máximo uma casa", () => {
    expect(formatPercent(73.5632)).toBe("73,6");
    expect(formatPercent(100)).toBe("100");
  });
});

/* ========================================================================== */
/* §7, §9, §36, §37 — percentual e distribuição                               */
/* ========================================================================== */

describe("§9 e §36 — o percentual de cada alternativa", () => {
  /**
   * ⚠️ O DENOMINADOR É QUEM RESPONDEU A PERGUNTA, e não o total de marcações
   * (decisão 3 da migration). Em resposta única os dois números são idênticos.
   */
  it("em escolha única, a soma fecha 100%", () => {
    const q = pergunta({
      respondents: 50,
      options: [
        opcao("Excelente", 36, 5),
        opcao("Bom", 10, 4),
        opcao("Regular", 3, 3),
        opcao("Ruim", 1, 2),
      ],
    });

    const soma = q.options.reduce((total, o) => total + optionPercent(o, q.respondents), 0);
    expect(Math.round(soma)).toBe(100);
    expect(optionPercent(q.options[0]!, q.respondents)).toBe(72);
  });

  /**
   * ⚠️ EM MÚLTIPLA ESCOLHA A SOMA PASSA DE 100%, e o §36 diz que é assim que
   * deve ser. Cada percentual é "quantos dos que responderam marcaram isto".
   */
  it("em múltipla escolha, a soma passa de 100%", () => {
    const q = pergunta({
      type: "multiple_choice",
      respondents: 10,
      options: [opcao("WhatsApp", 8), opcao("E-mail", 6), opcao("Site", 3)],
    });

    const soma = q.options.reduce((total, o) => total + optionPercent(o, q.respondents), 0);
    expect(soma).toBeGreaterThan(100);
    expect(optionPercent(q.options[0]!, q.respondents)).toBe(80);
  });

  it("Sim/Não distribui sobre quem respondeu", () => {
    const q = pergunta({
      type: "yes_no",
      respondents: 50,
      options: [opcao("Sim", 41, 1), opcao("Não", 9, 0)],
    });

    expect(Math.round(optionPercent(q.options[0]!, q.respondents))).toBe(82);
    expect(Math.round(optionPercent(q.options[1]!, q.respondents))).toBe(18);
  });

  it("ninguém respondeu não vira divisão por zero", () => {
    expect(optionPercent(opcao("Excelente", 0, 5), 0)).toBe(0);
  });

  /**
   * ⚠️ A ALTERNATIVA COM ZERO CONTINUA APARECENDO. "Ninguém deu Péssimo" é um
   * RESULTADO, e não uma ausência de dado — some-la faria a distribuição mudar
   * de forma entre dois eventos com a mesma escala.
   */
  it("alternativa com zero tem percentual zero, e não some", () => {
    expect(optionPercent(opcao("Péssimo", 0, 1), 50)).toBe(0);
  });
});

describe("§12 — a largura das barras", () => {
  it("a maior alternativa ocupa a barra inteira", () => {
    const opcoes = [opcao("A", 30), opcao("B", 10), opcao("C", 0)];
    const maior = largestOption(opcoes);

    expect(barWidth(30, maior)).toBe(100);
    expect(barWidth(10, maior)).toBeCloseTo(33.33, 1);
    expect(barWidth(0, maior)).toBe(0);
  });

  it("tudo zerado não quebra a conta", () => {
    expect(largestOption([opcao("A", 0)])).toBe(1);
    expect(barWidth(0, largestOption([opcao("A", 0)]))).toBe(0);
  });
});

/* ========================================================================== */
/* §8, §9, §35 — média e escala                                               */
/* ========================================================================== */

describe("§9 e §35 — a escala e o que entra na média", () => {
  /**
   * ⚠️ O TETO VEM DAS OPÇÕES, e nunca de um `5` escrito no código. O §9 é
   * explícito: "não assumir que todas as avaliações futuras obrigatoriamente
   * terão 5 opções".
   */
  it("a escala sai dos valores das alternativas", () => {
    expect(
      ratingScaleMax(pergunta({ options: [opcao("Ótimo", 1, 10), opcao("Ruim", 1, 0)] })),
    ).toBe(10);
    expect(
      ratingScaleMax(pergunta({ options: [opcao("Excelente", 1, 5), opcao("Bom", 1, 4)] })),
    ).toBe(5);
  });

  it("sem valor nenhum cai em 5, e não em zero — zero dividiria a barra por nada", () => {
    expect(ratingScaleMax(pergunta({ options: [opcao("A", 1, null)] }))).toBe(5);
  });

  /**
   * ⚠️ A RESPOSTA VEM DO DADO, E NÃO DO TIPO. Um `single_choice` com valores
   * numéricos É uma escala com outro nome; um `rating` sem resposta não é média
   * de coisa alguma.
   */
  it("texto livre não tem média", () => {
    expect(hasAverage(pergunta({ type: "free_text", average: null, answers: 0 }))).toBe(false);
  });

  it("escolha sem valor numérico não tem média", () => {
    expect(
      hasAverage(pergunta({ type: "single_choice", average: null, answers: 0, respondents: 12 })),
    ).toBe(false);
  });

  it("pergunta de nota com respostas tem média", () => {
    expect(hasAverage(pergunta({ average: 4.62, answers: 50 }))).toBe(true);
  });

  it("pergunta de nota sem nenhuma resposta não tem média", () => {
    expect(hasAverage(pergunta({ average: null, answers: 0 }))).toBe(false);
  });

  it("a média sai em português, com vírgula", () => {
    expect(formatAverage(4.6)).toBe("4,6");
    expect(formatAverage(4.625)).toBe("4,63");
    expect(formatAverage(5)).toBe("5,0");
  });

  /** §34. Sem média definida a tela mostra travessão — nunca zero. */
  it("média nula vira travessão, e não 0,0", () => {
    expect(formatAverage(null)).toBe("—");
  });
});

/* ========================================================================== */
/* §38 — os estados vazios                                                    */
/* ========================================================================== */

describe("§38 — cada vazio tem a sua causa", () => {
  it("evento sem participante", () => {
    expect(resultsStage({ participants: 0, present: 0, sent: 0, answered: 0 })).toBe(
      "no_participants",
    );
  });

  it("participantes, mas ninguém presente", () => {
    expect(resultsStage({ participants: 120, present: 0, sent: 0, answered: 0 })).toBe(
      "no_present",
    );
  });

  it("presentes, mas nada enviado", () => {
    expect(resultsStage({ participants: 120, present: 87, sent: 0, answered: 0 })).toBe("no_sent");
  });

  it("enviado, mas ninguém respondeu", () => {
    expect(resultsStage({ participants: 120, present: 87, sent: 87, answered: 0 })).toBe(
      "no_answers",
    );
  });

  it("com resposta, o painel abre", () => {
    expect(resultsStage({ participants: 120, present: 87, sent: 87, answered: 64 })).toBe("ready");
  });
});

/* ========================================================================== */
/* §4, §22, §44 — o que é PEDIDO ao banco                                     */
/* ========================================================================== */

describe("§44 — o cálculo é do banco, e o service só pede", () => {
  it("o resumo é uma chamada agregada, e não uma varredura de respostas", async () => {
    rpc.mockResolvedValue({ data: { eventId: EVENTO, participants: 120 }, error: null });

    await getResultsSummary(EVENTO);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("event_results_summary");
    expect(argumentos()).toEqual({ p_event_id: EVENTO });
  });

  it("a tabulação por pergunta é UMA chamada, e não uma por pergunta (§23)", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await getResultsQuestions(EVENTO);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("event_results_questions");
  });

  it("evento inexistente devolve nulo, para a página fazer notFound()", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getResultsSummary(EVENTO)).toBeNull();
  });

  /**
   * ⚠️ SEM `eventId` NO RETORNO, É NULO. A função do banco devolve a mesma coisa
   * para "não existe" e para "a RLS barrou" — e o service não tenta distinguir
   * (§45): a diferença seria um oráculo sobre ids alheios.
   */
  it("resposta sem eventId é tratada como não encontrada", async () => {
    rpc.mockResolvedValue({ data: { participants: 0 }, error: null });
    expect(await getResultsSummary(EVENTO)).toBeNull();
  });

  it("erro do banco é lançado, para o error.tsx assumir", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "negado" } });
    await expect(getResultsSummary(EVENTO)).rejects.toBeTruthy();
  });
});

/* ========================================================================== */
/* §17, §18, §27 — busca, filtros e exportação                                */
/* ========================================================================== */

describe("§17 e §18 — a busca e os filtros vão para o backend", () => {
  it("a busca viaja como parâmetro, e a paginação também", async () => {
    rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null });

    await getResultsResponses(EVENTO, {
      tab: "responses",
      query: "granja",
      filter: "with_comment",
      page: 3,
    });

    expect(argumentos()).toMatchObject({
      p_event_id: EVENTO,
      p_query: "granja",
      p_filter: "with_comment",
      p_limit: 25,
      // Página 3, 25 por página → pula 50.
      p_offset: 50,
    });
  });

  it("o filtro 'todas' não é enviado — ele é a ausência de filtro", async () => {
    rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null });

    await getResultsResponses(EVENTO, EMPTY_RESULTS_FILTERS);

    expect(argumentos().p_filter).toBeUndefined();
    expect(argumentos().p_query).toBeUndefined();
  });

  /**
   * ⚠️ A EXPORTAÇÃO LEVA O RECORTE INTEIRO, e não a página (§27: "não gerar
   * Excel apenas com os dados atualmente carregados na página quando houver
   * paginação").
   */
  it("a exportação manda os mesmos filtros e ignora a paginação", async () => {
    rpc.mockResolvedValue({ data: { questions: [], rows: [] }, error: null });

    await getResultsExport(EVENTO, { query: "granja", filter: "rating_5" });

    const args = argumentos();
    expect(args).toMatchObject({ p_event_id: EVENTO, p_query: "granja", p_filter: "rating_5" });
    expect(args.p_offset).toBeUndefined();
    expect(args.p_limit).toBe(5000);
  });

  it("o teto da exportação é generoso e explícito", async () => {
    rpc.mockResolvedValue({ data: { questions: [], rows: [] }, error: null });
    await getResultsExport(EVENTO, { query: "", filter: "all" }, 5000);
    expect(argumentos().p_limit).toBe(5000);
  });

  it("os pendentes não recebem filtro de nota — ninguém ali respondeu", async () => {
    rpc.mockResolvedValue({ data: { total: 0, rows: [], metrics: {} }, error: null });

    await getResultsPending(EVENTO, { ...EMPTY_RESULTS_FILTERS, filter: "rating_5" });

    expect(argumentos().p_filter).toBeUndefined();
    expect(rpc.mock.calls[0]?.[0]).toBe("event_results_pending");
  });
});

/* ========================================================================== */
/* §45 — IDOR                                                                 */
/* ========================================================================== */

describe("§45 — o evento viaja junto, sempre", () => {
  it("o detalhe manda evento E resposta, para o banco conferir a cadeia", async () => {
    rpc.mockResolvedValue({ data: { participantEvaluationId: RESPOSTA }, error: null });

    await getResponseDetail(EVENTO, RESPOSTA);

    expect(argumentos()).toEqual({
      p_event_id: EVENTO,
      p_participant_evaluation_id: RESPOSTA,
    });
  });

  /**
   * ⚠️ O EVENTO ERRADO NÃO É RECUSADO AQUI — é recusado NO BANCO, e é ali que
   * tem de ser. Este caso prova que o par chega inteiro para a função conferir;
   * sem ele, um id de resposta de outro evento passaria sem nada com que
   * comparar.
   */
  it("um evento diferente continua sendo enviado para o banco decidir", async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await getResponseDetail(OUTRO_EVENTO, RESPOSTA);

    expect(argumentos().p_event_id).toBe(OUTRO_EVENTO);
  });

  it("resposta de outro evento volta nula — e a página faz notFound()", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getResponseDetail(OUTRO_EVENTO, RESPOSTA)).toBeNull();
  });
});

/* ========================================================================== */
/* §40 — RBAC                                                                 */
/* ========================================================================== */

describe("§40 — quem pode o quê", () => {
  it("ler os resultados alcança o Administrador e o Atendente", () => {
    expect(hasPermission("admin", "results.read")).toBe(true);
    expect(hasPermission("comercial", "results.read")).toBe(true);
    expect(hasPermission("viewer", "results.read")).toBe(false);
    expect(hasPermission("financeiro", "results.read")).toBe(false);
  });

  /**
   * ⚠️ BAIXAR É MAIS ESTREITO QUE LER, e é a decisão mais restritiva deste
   * prompt. Ler deixa o dado dentro do sistema, sob RLS; baixar tira dele para
   * sempre — com opinião amarrada a nome (§41).
   */
  it("baixar a planilha é SÓ do Administrador", () => {
    expect(hasPermission("admin", "results.export")).toBe(true);
    expect(hasPermission("comercial", "results.export")).toBe(false);
    expect(hasPermission("viewer", "results.export")).toBe(false);
  });

  it("quem lê resultados não ganha, por tabela, o direito de editar perguntas", () => {
    expect(hasPermission("comercial", "results.read")).toBe(true);
    expect(hasPermission("comercial", "evaluations.write")).toBe(false);
  });

  /** §32. O reenvio a partir dos Resultados REUSA a permissão do Prompt 2. */
  it("reenviar continua sendo `evaluations.send`, e não uma chave nova", () => {
    expect(hasPermission("comercial", "evaluations.send")).toBe(true);
    expect(hasPermission("viewer", "evaluations.send")).toBe(false);
  });
});

/* ========================================================================== */
/* §34 — a pergunta de avaliação geral                                        */
/* ========================================================================== */

const BLOCO = {
  title: "Avaliação geral",
  description: null,
  questions: [
    {
      prompt: "Como você avalia o evento?",
      type: "rating" as const,
      required: true,
      isOverall: true,
      options: [
        { label: "Excelente", value: 5 },
        { label: "Bom", value: 4 },
      ],
    },
  ],
};

describe("§34 — só uma pergunta pode ser a avaliação geral", () => {
  it("uma marcada é válido", () => {
    expect(
      evaluationStructureSchema.safeParse({ eventId: EVENTO, sections: [BLOCO] }).success,
    ).toBe(true);
  });

  /** §34 prevê o caso e manda mostrar "N/A" — nunca obrigar uma. */
  it("nenhuma marcada também é válido", () => {
    expect(
      evaluationStructureSchema.safeParse({
        eventId: EVENTO,
        sections: [{ ...BLOCO, questions: [{ ...BLOCO.questions[0]!, isOverall: false }] }],
      }).success,
    ).toBe(true);
  });

  /**
   * ⚠️ A CHECAGEM ATRAVESSA OS BLOCOS. Duas marcadas em blocos diferentes
   * passariam por qualquer validação feita por pergunta — é por isso que ela
   * mora no nível da estrutura.
   */
  it("duas marcadas, em blocos diferentes, é recusado", () => {
    const resultado = evaluationStructureSchema.safeParse({
      eventId: EVENTO,
      sections: [BLOCO, { ...BLOCO, title: "Infraestrutura" }],
    });

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues[0]?.message).toContain("Só uma pergunta");
    }
  });

  it("duas marcadas no MESMO bloco também é recusado", () => {
    const resultado = evaluationStructureSchema.safeParse({
      eventId: EVENTO,
      sections: [
        {
          ...BLOCO,
          questions: [BLOCO.questions[0]!, { ...BLOCO.questions[0]!, prompt: "Outra" }],
        },
      ],
    });

    expect(resultado.success).toBe(false);
  });

  /** §35. Média de texto livre não existe — o CHECK do banco também recusa. */
  it("só pergunta de nota pode ser a geral", () => {
    const resultado = evaluationStructureSchema.safeParse({
      eventId: EVENTO,
      sections: [
        {
          ...BLOCO,
          questions: [
            {
              prompt: "Comentários",
              type: "free_text" as const,
              required: false,
              isOverall: true,
              options: [],
            },
          ],
        },
      ],
    });

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues.some((i) => i.message.includes("tipo Nota"))).toBe(true);
    }
  });

  /**
   * ⚠️ FORMULÁRIOS SALVOS ANTES DO PROMPT 3 NÃO MANDAM O CAMPO. Sem o
   * `default(false)`, reabrir e salvar uma avaliação antiga viraria erro de
   * validação numa estrutura que não mudou.
   */
  it("o campo é opcional na entrada, e vira false", () => {
    const resultado = evaluationStructureSchema.safeParse({
      eventId: EVENTO,
      sections: [
        {
          ...BLOCO,
          questions: [
            {
              prompt: "Recepção",
              type: "rating" as const,
              required: true,
              options: [
                { label: "Excelente", value: 5 },
                { label: "Bom", value: 4 },
              ],
            },
          ],
        },
      ],
    });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.sections[0]!.questions[0]!.isOverall).toBe(false);
    }
  });
});

/* ========================================================================== */
/* A URL — abas, busca, filtro e paginação                                    */
/* ========================================================================== */

describe("os filtros na URL", () => {
  it("os padrões não aparecem no endereço", () => {
    expect(eventResultsHref(EVENTO, EMPTY_RESULTS_FILTERS)).toBe(`/events/results/${EVENTO}`);
    expect(resultsHref()).toBe("/events/results");
  });

  it("aba, busca, filtro e página fazem a volta completa", () => {
    const filtros = {
      tab: "responses" as const,
      query: "granja",
      filter: "with_comment" as const,
      page: 3,
    };
    const endereco = eventResultsHref(EVENTO, filtros);
    const lido = parseResultsFilters(
      Object.fromEntries(new URL(`https://x${endereco}`).searchParams),
    );

    expect(lido).toEqual(filtros);
  });

  it("aba inventada volta para o painel", () => {
    expect(parseResultsFilters({ aba: "inventada" }).tab).toBe("dashboard");
  });

  it("filtro inventado volta para 'todas'", () => {
    expect(parseResultsFilters({ f: "nota_dez" }).filter).toBe("all");
  });

  it("página inválida vira 1", () => {
    expect(parseResultsFilters({ page: "-4" }).page).toBe(1);
    expect(parseResultsFilters({ page: "abc" }).page).toBe(1);
  });

  /**
   * ⚠️ A EXPORTAÇÃO NÃO LEVA `page` NEM `aba` (§27). O arquivo é sempre o das
   * respostas, e é sempre o recorte inteiro.
   */
  it("o endereço da exportação carrega os filtros e descarta a paginação", () => {
    const endereco = resultsExportHref(EVENTO, {
      tab: "responses",
      query: "granja",
      filter: "rating_5",
      page: 7,
    });

    expect(endereco).toContain(`/events/results/${EVENTO}/export`);
    expect(endereco).toContain("q=granja");
    expect(endereco).toContain("f=rating_5");
    expect(endereco).not.toContain("page=");
    expect(endereco).not.toContain("aba=");
  });

  it("sem filtro, a exportação é só o endereço", () => {
    expect(resultsExportHref(EVENTO, EMPTY_RESULTS_FILTERS)).toBe(
      `/events/results/${EVENTO}/export`,
    );
  });

  it("o detalhe de uma resposta tem endereço próprio e compartilhável", () => {
    expect(responseDetailHref(EVENTO, RESPOSTA)).toBe(
      `/events/results/${EVENTO}/respostas/${RESPOSTA}`,
    );
  });

  it("sabe quando há filtro ativo", () => {
    expect(hasActiveResultsFilters(EMPTY_RESULTS_FILTERS)).toBe(false);
    expect(hasActiveResultsFilters({ ...EMPTY_RESULTS_FILTERS, query: "x" })).toBe(true);
    expect(hasActiveResultsFilters({ ...EMPTY_RESULTS_FILTERS, filter: "with_comment" })).toBe(
      true,
    );
    // Página e aba não são filtro: estar na página 2 não é ter filtrado nada.
    expect(hasActiveResultsFilters({ ...EMPTY_RESULTS_FILTERS, page: 2 })).toBe(false);
    expect(hasActiveResultsFilters({ ...EMPTY_RESULTS_FILTERS, tab: "pending" })).toBe(false);
  });

  /** §18. Os cinco filtros de nota são exatamente os que dependem da geral. */
  it("os filtros de nota estão separados dos demais", () => {
    expect(RATING_FILTERS).toHaveLength(5);
    for (const f of RATING_FILTERS) {
      expect(RESULTS_FILTERS).toContain(f);
      expect(f.startsWith("rating_")).toBe(true);
    }
    expect(RATING_FILTERS).not.toContain("with_comment");
    expect(RATING_FILTERS).not.toContain("all");
  });
});
