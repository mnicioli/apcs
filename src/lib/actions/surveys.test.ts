import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/actions/errors";
import type { Role } from "@/lib/rbac/rbac.types";

/**
 * AUTORIZAÇÃO NA API, NÃO NO BOTÃO (§3, §74).
 *
 * O §3 é explícito: "A autorização deverá existir no backend. Não confiar apenas
 * no frontend." Estes testes chamam cada Server Action DIRETO, com o papel que
 * não pode, e exigem duas coisas:
 *
 *   1. o resultado é `forbidden`;
 *   2. **o banco nunca é tocado** — `rpc` não é chamado nem uma vez.
 *
 * A segunda importa mais que a primeira. Uma action que consulta o banco e só
 * depois nega já vazou a existência do registro pelo tempo de resposta, e depende
 * da RLS para não ter escrito nada. Aqui a negativa acontece ANTES.
 *
 * ⚠️ O papel NÃO é mockado. O que se mocka é o Supabase; `getCurrentUserRole`,
 * `hasPermission` e a matriz do RBAC rodam de verdade. Um teste que mockasse
 * `assertPermission` provaria só que eu sei escrever `vi.mock`.
 *
 * ⚠️ E estes testes NÃO substituem a bateria SQL. Eles cobrem a PRIMEIRA das três
 * camadas; a RLS e a checagem de papel dentro das funções foram testadas contra o
 * banco real, papel a papel — inclusive `anon`, que foi onde apareceu um
 * vazamento de verdade. Ver docs/ENQUETES.md §Segurança.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const rpc = vi.fn();
const from = vi.fn();
let papelAtual: Role | null = "admin";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: papelAtual === null ? null : { id: "11111111-1111-4111-8111-111111111111" },
        },
      }),
    },
    from: (tabela: string) => {
      from(tabela);
      // O caminho do RBAC (`profiles`) e o do contador de destinatários usam
      // formas diferentes do builder; este objeto atende os dois.
      return {
        select: () => ({
          eq: () => ({
            returns: () => ({
              maybeSingle: async () => ({
                data: papelAtual === null ? null : { role: papelAtual },
                error: null,
              }),
            }),
            count: 3,
            error: null,
            then: (resolve: (v: unknown) => void) => resolve({ count: 3, error: null }),
          }),
        }),
      };
    },
    rpc,
  }),
}));

const {
  activateSurveyAction,
  cancelSurveyAction,
  closeSurveyAction,
  createSurveyAction,
  deleteSurveyAction,
  scheduleSurveyAction,
  setSurveyAudienceAction,
  unscheduleSurveyAction,
  updateSurveyAction,
  updateSurveyQuestionAction,
} = await import("./surveys");

const ID = "22222222-2222-4222-8222-222222222222";

const CRIACAO = {
  title: "Expectativa sobre o valor da arroba",
  description: "",
  question: "Como voce acredita que ficara o valor nas proximas semanas?",
  options: ["Aumentar", "Manter", "Reduzir"],
  startsAt: "",
  endsAt: "",
  scheduledAt: "",
  isAnonymous: false,
  allowsResponseChange: false,
};

const EDICAO = {
  title: "Expectativa sobre o valor da arroba",
  description: "",
  startsAt: "",
  endsAt: "",
  scheduledAt: "",
  isAnonymous: false,
  allowsResponseChange: false,
};

/**
 * ⚠️ O ENCERRAMENTO É 23:55, E ERA 23:59 ATÉ A GRADE DE 5 MINUTOS EXISTIR.
 *
 * Vale registrar por que mudou, porque a troca não é cosmética: “fechar a urna
 * às 23:59” é o jeito idiomático de dizer “no fim do dia”, e a política de
 * horários de 5 em 5 minutos passou a recusá-lo. 23:55 diz a mesma coisa em
 * termos práticos — cinco minutos a menos numa enquete que fica dias aberta.
 *
 * Se um dia alguém precisar do minuto exato num agendamento, o lugar de
 * afrouxar é o schema de agendamento em survey.schema.ts; este comentário é
 * onde a decisão fica registrada.
 */
const AGENDAMENTO = {
  scheduledAt: "2026-09-01T09:00:00Z",
  startsAt: "2026-09-01T00:00:00Z",
  endsAt: "2026-09-10T23:55:00Z",
};

const PUBLICO = [{ dimension: "all" as const }];

/** Toda action de escrita, com uma entrada VÁLIDA — só o papel varia. */
const ESCRITAS: [string, () => Promise<ActionResult<unknown>>][] = [
  ["createSurvey", () => createSurveyAction(CRIACAO)],
  ["updateSurvey", () => updateSurveyAction(ID, EDICAO)],
  [
    "updateSurveyQuestion",
    () => updateSurveyQuestionAction(ID, { question: "Outra pergunta?", options: ["A", "B"] }),
  ],
  ["setSurveyAudience", () => setSurveyAudienceAction(ID, PUBLICO)],
  ["scheduleSurvey", () => scheduleSurveyAction(ID, AGENDAMENTO)],
  ["unscheduleSurvey", () => unscheduleSurveyAction(ID)],
  ["activateSurvey", () => activateSurveyAction(ID)],
  ["closeSurvey", () => closeSurveyAction(ID)],
  ["cancelSurvey", () => cancelSurveyAction(ID, { reason: "teste" })],
  ["deleteSurvey", () => deleteSurveyAction(ID)],
];

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  papelAtual = "admin";
  rpc.mockResolvedValue({
    data: {
      id: ID,
      title: "Expectativa sobre o valor da arroba",
      status: "draft",
      starts_at: null,
      ends_at: null,
      scheduled_at: null,
    },
    error: null,
  });
});

describe("§3 o ATENDENTE visualiza, mas não escreve", () => {
  it.each(ESCRITAS)("comercial não executa %s — e o banco nem é tocado", async (_nome, acao) => {
    papelAtual = "comercial";

    const resultado = await acao();

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("forbidden");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("§3 quem não tem papel nenhum não escreve", () => {
  it.each(ESCRITAS)("viewer não executa %s", async (_nome, acao) => {
    papelAtual = "viewer";
    const resultado = await acao();
    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(ESCRITAS)("sem sessão não executa %s", async (_nome, acao) => {
    papelAtual = null;
    const resultado = await acao();
    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("os outros papéis do CRM também não escrevem enquete", async () => {
    for (const papel of ["pm", "tech_lead", "financeiro"] as Role[]) {
      papelAtual = papel;
      rpc.mockClear();
      const resultado = await createSurveyAction(CRIACAO);
      expect(resultado.ok).toBe(false);
      expect(rpc).not.toHaveBeenCalled();
    }
  });
});

describe("§3 ADMINISTRADOR e GESTOR escrevem", () => {
  it.each(["admin", "ceo"] as Role[])("%s cria enquete", async (papel) => {
    papelAtual = papel;
    const resultado = await createSurveyAction(CRIACAO);
    expect(resultado.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("create_survey", expect.anything());
  });
});

describe("a validação acontece ANTES da autorização e da ida ao banco", () => {
  it("payload inválido não chega ao banco nem com papel de admin", async () => {
    const resultado = await createSurveyAction({ ...CRIACAO, options: ["Só uma"] });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("invalidInput");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("§17 janela invertida é barrada na action", async () => {
    const resultado = await createSurveyAction({
      ...CRIACAO,
      startsAt: "2026-09-10T00:00:00Z",
      endsAt: "2026-09-01T00:00:00Z",
    });
    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("GAP 1 — segmentação sem cadastro de apoio é barrada antes do banco", async () => {
    const resultado = await setSurveyAudienceAction(ID, [
      { dimension: "segment", segmentId: "a0000000-0000-4000-8000-000000000001" },
    ]);
    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("público vazio é barrado antes do banco", async () => {
    const resultado = await setSurveyAudienceAction(ID, []);
    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uma dimensão inventada não passa", async () => {
    const resultado = await setSurveyAudienceAction(ID, [
      { dimension: "signo" as never, value: "leao" },
    ]);
    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("os erros do banco viram códigos que a tela sabe explicar", () => {
  const casos: [string, string][] = [
    ["SV001", "surveyTransitionNotAllowed"],
    ["SV002", "surveyHasResponses"],
    ["SV003", "surveyStatusBlocksAction"],
    ["SV004", "surveyInvalidWindow"],
    ["SV005", "surveyNeedsQuestion"],
    ["SV006", "surveyEmptyAudience"],
    ["SV007", "surveyDimensionUnavailable"],
    ["42501", "forbidden"],
    ["P0002", "notFound"],
  ];

  it.each(casos)("%s vira %s", async (sqlstate, esperado) => {
    rpc.mockResolvedValue({ data: null, error: { code: sqlstate, message: "erro do banco" } });

    const resultado = await activateSurveyAction(ID);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe(esperado);
  });

  it("um código desconhecido vira 'unexpected' — e nunca a mensagem crua", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "XX999", message: 'relation "surveys" does not exist' },
    });

    const resultado = await closeSurveyAction(ID);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.error.code).toBe("unexpected");
      expect(JSON.stringify(resultado.error)).not.toMatch(/relation|surveys does not/i);
    }
  });
});

describe("nenhuma action deixa o banco escolher o autor", () => {
  it("createSurvey não envia created_by — quem preenche é o DEFAULT do banco", async () => {
    await createSurveyAction(CRIACAO);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(rpc.mock.calls[0]?.[1] ?? {})).not.toMatch(/created_by|createdBy/);
  });

  it("nenhuma action aceita um parâmetro de situação", async () => {
    // §70: "Não permitir alteração arbitrária de status via PATCH." A garantia
    // está na ASSINATURA — não existe argumento de status em lugar nenhum.
    await createSurveyAction({ ...CRIACAO, status: "active" } as never);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(rpc.mock.calls[0]?.[1] ?? {})).not.toMatch(/p_status|"active"/);
  });
});
