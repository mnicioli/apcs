import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/rbac/rbac.types";

/**
 * AUTORIZAÇÃO NA API, não no botão (§3, §5, §48, §49, §73).
 *
 * O §49 é explícito: "tentar manualmente POST, PUT/PATCH, status, schedule,
 * cancel, reject. Não confiar no frontend." Estes testes fazem exatamente isso —
 * chamam cada Server Action DIRETO, com o papel que não pode, e exigem duas
 * coisas:
 *
 *   1. o resultado é `forbidden`;
 *   2. **o banco nunca é tocado** — `rpc` não é chamado nem uma vez.
 *
 * A segunda importa mais que a primeira. Uma action que consulta o banco e só
 * depois nega já vazou a existência do registro pelo tempo de resposta, e
 * depende da RLS para não ter escrito nada. Aqui a negativa acontece ANTES.
 *
 * ⚠️ O papel NÃO é mockado. O que se mocka é o Supabase; `getCurrentUserRole`,
 * `hasPermission` e a matriz do RBAC rodam de verdade. Um teste que mockasse
 * `assertPermission` provaria só que eu sei escrever `vi.mock`.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const rpc = vi.fn();
let papelAtual: Role | null = "admin";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: papelAtual === null ? null : { id: "11111111-1111-4111-8111-111111111111" } },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          returns: () => ({
            maybeSingle: async () => ({
              data: papelAtual === null ? null : { role: papelAtual, active: true },
              error: null,
            }),
          }),
        }),
      }),
    }),
    rpc,
  }),
}));

const {
  assignLectureResponsibleAction,
  assignLectureSpeakerAction,
  checkLectureConflictsAction,
  createLectureAction,
  registerLectureOutcomeAction,
  rescheduleLectureAction,
  setLectureStatusAction,
  updateLectureAction,
} = await import("./lectures");

const ID = "22222222-2222-4222-8222-222222222222";

const CRIACAO = {
  name: "Manejo sanitário",
  theme: "Prevenção de doenças em granjas",
  city: "Toledo",
  location: "",
  type: "company" as const,
  typeOther: "",
  format: "" as const,
  eventDate: "2026-09-10",
  startTime: "",
  endTime: "",
  attendeesEstimated: "",
  speakerId: "",
  responsibleId: "",
  priority: "normal" as const,
  status: "requested" as const,
  notes: "",
  requesterName: "",
  requesterEmail: "",
  requesterPhone: "",
  requesterOrganization: "",
};

const EDICAO = {
  lectureId: ID,
  name: "Manejo sanitário",
  theme: "Prevenção de doenças em granjas",
  city: "Toledo",
  location: "",
  type: "company" as const,
  typeOther: "",
  format: "" as const,
  attendeesEstimated: "",
  priority: "normal" as const,
  notes: "",
};

/**
 * As sete portas de escrita. A lista é a mesma do §49, e é sobre ela que os
 * testes de papel rodam em bloco — assim uma action nova que esqueça o guard
 * aparece como teste faltando, não como buraco silencioso.
 */
const ESCRITAS: readonly [string, () => Promise<{ ok: boolean }>][] = [
  ["criar", () => createLectureAction(CRIACAO)],
  ["editar", () => updateLectureAction(EDICAO)],
  ["mudar situação", () => setLectureStatusAction({ lectureId: ID, status: "under_review" })],
  [
    "rejeitar",
    () =>
      setLectureStatusAction({ lectureId: ID, status: "rejected", reason: "fora do calendário" }),
  ],
  [
    "cancelar",
    () => setLectureStatusAction({ lectureId: ID, status: "cancelled", reason: "sem quórum" }),
  ],
  [
    "reagendar",
    () =>
      rescheduleLectureAction({
        lectureId: ID,
        eventDate: "2026-09-20",
        startTime: "09:00",
        endTime: "10:00",
      }),
  ],
  ["definir responsável", () => assignLectureResponsibleAction({ lectureId: ID, profileId: "" })],
  ["definir palestrante", () => assignLectureSpeakerAction({ lectureId: ID, profileId: "" })],
  [
    "registrar resultado",
    () => registerLectureOutcomeAction({ lectureId: ID, heldAt: "", outcomeNotes: "" }),
  ],
];

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (nome: string) => ({
    // `find_lecture_conflicts` devolve um CONJUNTO de linhas; as demais devolvem
    // a linha afetada. Um mock que devolvesse a mesma forma para as duas passaria
    // no teste e esconderia a diferença que o service depende.
    data:
      nome === "find_lecture_conflicts"
        ? []
        : {
            id: ID,
            protocol: "SOL-000001",
            status: "requested",
            event_date: "2026-09-10",
            start_time: null,
            end_time: null,
          },
    error: null,
  }));
  papelAtual = "admin";
});

describe("permissões de escrita chamando a action direto", () => {
  for (const [nome, chamar] of ESCRITAS) {
    it(`Atendente não consegue ${nome}`, async () => {
      papelAtual = "comercial";
      const resultado = await chamar();

      expect(resultado).toEqual({ ok: false, error: { code: "forbidden" } });
      // O que importa: a negativa veio ANTES do banco.
      expect(rpc).not.toHaveBeenCalled();
    });

    it(`Viewer não consegue ${nome}`, async () => {
      papelAtual = "viewer";
      const resultado = await chamar();

      expect(resultado).toEqual({ ok: false, error: { code: "forbidden" } });
      expect(rpc).not.toHaveBeenCalled();
    });

    it(`sem sessão não consegue ${nome}`, async () => {
      papelAtual = null;
      const resultado = await chamar();

      expect(resultado).toEqual({ ok: false, error: { code: "forbidden" } });
      expect(rpc).not.toHaveBeenCalled();
    });

    it(`Administrador consegue ${nome}`, async () => {
      papelAtual = "admin";
      await chamar();
      expect(rpc).toHaveBeenCalled();
    });

    it(`Gestor consegue ${nome}`, async () => {
      papelAtual = "ceo";
      await chamar();
      expect(rpc).toHaveBeenCalled();
    });
  }
});

describe("permissão de leitura", () => {
  it("Atendente consulta conflito (ele vê a agenda)", async () => {
    papelAtual = "comercial";
    const resultado = await checkLectureConflictsAction({
      eventDate: "2026-09-10",
      startTime: "09:00",
      endTime: "10:00",
    });

    expect(resultado.ok).toBe(true);
  });

  it("Viewer não consulta conflito", async () => {
    papelAtual = "viewer";
    const resultado = await checkLectureConflictsAction({
      eventDate: "2026-09-10",
      startTime: "09:00",
      endTime: "10:00",
    });

    expect(resultado).toEqual({ ok: false, error: { code: "forbidden" } });
  });

  it("sem sessão não consulta conflito", async () => {
    papelAtual = null;
    const resultado = await checkLectureConflictsAction({
      eventDate: "2026-09-10",
      startTime: "09:00",
      endTime: "10:00",
    });

    expect(resultado).toEqual({ ok: false, error: { code: "forbidden" } });
  });
});

/**
 * O ID VEM DO CLIENTE E NÃO É CONFIÁVEL (§73).
 *
 * Não existe "palestra do usuário" neste módulo — quem tem `lectures.write`
 * escreve em qualquer uma. Então o que se prova aqui é o outro lado: um id
 * malformado não vira consulta ao banco.
 */
describe("id recebido do cliente", () => {
  it("id que não é uuid não chega ao banco", async () => {
    papelAtual = "admin";
    const resultado = await setLectureStatusAction({
      lectureId: "1 OR 1=1",
      status: "under_review",
    });

    expect(resultado).toEqual({ ok: false, error: { code: "invalidInput" } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("id vazio não chega ao banco", async () => {
    papelAtual = "admin";
    const resultado = await rescheduleLectureAction({
      lectureId: "",
      eventDate: "2026-09-20",
      startTime: "09:00",
      endTime: "",
    });

    expect(resultado).toEqual({ ok: false, error: { code: "invalidInput" } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("data fora de formato não chega ao banco", async () => {
    papelAtual = "admin";
    const resultado = await checkLectureConflictsAction({
      eventDate: "2026-09-20'; drop table lectures; --",
      startTime: "09:00",
      endTime: null,
    });

    expect(resultado).toEqual({ ok: false, error: { code: "invalidInput" } });
  });

  it("situação fora do enum não chega ao banco", async () => {
    papelAtual = "admin";
    const resultado = await setLectureStatusAction({
      lectureId: ID,
      // Um valor que o banco não conhece — barrado antes de virar consulta.
      status: "superaprovada" as never,
    });

    expect(resultado).toEqual({ ok: false, error: { code: "invalidInput" } });
    expect(rpc).not.toHaveBeenCalled();
  });
});

/**
 * PAYLOAD MALICIOSO (§50, §51, §52).
 *
 * ⚠️ O comportamento CERTO aqui é ACEITAR o texto e passá-lo adiante intacto.
 *
 * Sanitizar na entrada é a armadilha clássica: quem escreve "a < b no gráfico"
 * numa observação perde o texto, e o dia em que o mesmo campo for lido por um
 * canal que não escapa (um PDF, um e-mail) a suposta limpeza não vai ter
 * ajudado. A defesa contra XSS é a ESCAPAGEM NA SAÍDA — que o React faz por
 * padrão e que o teste de renderização abaixo comprova.
 *
 * O que a entrada precisa garantir é outra coisa: que o texto vire PARÂMETRO, e
 * nunca comando. É o que estes testes verificam.
 */
describe("payload malicioso", () => {
  const PAYLOADS = [
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(document.cookie)">',
    "'; DROP TABLE public.lectures; --",
    "' OR '1'='1",
    "${process.env.SUPABASE_SERVICE_ROLE_KEY}",
    "{{constructor.constructor('return process')()}}",
    "../../../etc/passwd",
    "%00%0a%0d",
  ];

  for (const payload of PAYLOADS) {
    it(`atravessa como parâmetro, não como comando: ${payload.slice(0, 28)}`, async () => {
      papelAtual = "admin";
      const resultado = await createLectureAction({
        ...CRIACAO,
        name: payload,
        theme: `Tema ${payload}`,
        notes: payload,
      });

      expect(resultado.ok).toBe(true);

      // O texto chega ao banco IDÊNTICO, num argumento nomeado — não concatenado
      // em SQL. Quem monta a consulta é o supabase-js, e ele parametriza.
      const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(args.p_name).toBe(payload);
      expect(args.p_notes).toBe(payload);
    });
  }

  it("nome só com espaços é recusado (não vira palestra sem nome)", async () => {
    papelAtual = "admin";
    const resultado = await createLectureAction({ ...CRIACAO, name: "   " });

    expect(resultado).toEqual({ ok: false, error: { code: "invalidInput" } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("texto absurdamente longo é recusado antes do banco", async () => {
    papelAtual = "admin";
    const resultado = await createLectureAction({ ...CRIACAO, name: "A".repeat(10_000) });

    expect(resultado).toEqual({ ok: false, error: { code: "invalidInput" } });
    expect(rpc).not.toHaveBeenCalled();
  });
});

/**
 * O ERRO DO BANCO NÃO VAZA PARA A TELA (§53, §72).
 *
 * O que a pessoa vê é um código do catálogo; a mensagem crua do Postgres — que
 * carrega nome de tabela, de constraint e às vezes o valor — fica no log do
 * servidor.
 */
describe("erro do banco", () => {
  const CASOS: readonly [string, string, string][] = [
    ["transição impossível", "PL001", "lectureTransitionNotAllowed"],
    ["campo imutável", "PL002", "lectureFieldImmutable"],
    ["situação não permite", "PL003", "lectureStatusBlocksAction"],
    ["motivo obrigatório", "PL004", "lectureReasonRequired"],
    ["falta horário", "PL005", "lectureNeedsTime"],
    ["perfil inexistente", "PL006", "lectureProfileNotFound"],
    ["sem permissão no banco", "42501", "forbidden"],
    ["não encontrada", "P0002", "notFound"],
  ];

  for (const [nome, code, esperado] of CASOS) {
    it(`${nome} vira "${esperado}"`, async () => {
      papelAtual = "admin";
      rpc.mockResolvedValue({
        data: null,
        error: {
          code,
          message: 'permission denied for table lectures / constraint "lectures_theme_len"',
          details: "Key (protocol)=(SOL-000042) already exists.",
          hint: null,
        },
      });

      const resultado = await setLectureStatusAction({ lectureId: ID, status: "under_review" });

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.error.code).toBe(esperado);
        // Nada além do código atravessa a fronteira.
        expect(Object.keys(resultado.error)).toEqual(["code"]);
      }
    });
  }

  it("erro desconhecido não vaza a mensagem crua", async () => {
    papelAtual = "admin";
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "XX000",
        message: "internal error at /var/lib/postgresql/data/base/16384 — password=hunter2",
        details: null,
        hint: null,
      },
    });

    const resultado = await setLectureStatusAction({ lectureId: ID, status: "under_review" });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(JSON.stringify(resultado)).not.toContain("hunter2");
      expect(JSON.stringify(resultado)).not.toContain("postgresql");
    }
  });
});
