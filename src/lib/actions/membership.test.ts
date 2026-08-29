import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/rbac/rbac.types";

/**
 * AUTORIZAÇÃO NA API, NÃO NO BOTÃO — e a porta pública sob controle.
 *
 * Este arquivo cobre as DUAS metades de `src/lib/actions/membership.ts`, que têm
 * regras opostas:
 *
 *   1. AS DECISÕES DO CRM. Chamadas DIRETO, com o papel que não pode, exigem
 *      duas coisas: o resultado é `forbidden` E o banco nunca é tocado. A
 *      segunda importa mais — uma action que consulta e só depois nega já
 *      dependeu da RLS para não ter escrito nada.
 *
 *   2. O FORMULÁRIO PÚBLICO. Não tem permissão para checar (não há usuário), e
 *      é justamente por isso que ele precisa de teste: o que o protege é a
 *      VALIDAÇÃO antes da chamada, a chave de deduplicação e o cliente correto
 *      (`service_role`, nunca o do usuário).
 *
 * ⚠️ O papel NÃO é mockado. O que se mocka é o Supabase; `getCurrentUserRole`,
 * `hasPermission` e a matriz do RBAC rodam de verdade.
 *
 * ⚠️ E estes testes NÃO substituem a bateria SQL. Eles cobrem a PRIMEIRA das
 * três camadas; a RLS, os grants e a checagem de papel dentro das funções foram
 * testados contra o banco real (28 casos, incluindo "o anon não executa nada
 * deste módulo").
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const cabecalhos = new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "vitest" });
vi.mock("next/headers", () => ({ headers: async () => cabecalhos }));

const rpc = vi.fn();
const adminRpc = vi.fn();
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

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: adminRpc }) }));

const {
  approveMembershipApplicationAction,
  rejectMembershipApplicationAction,
  reopenMembershipApplicationAction,
  startMembershipReviewAction,
  submitMembershipApplicationAction,
} = await import("./membership");

const ID = "11111111-1111-4111-8111-111111111111";

function solicitacaoValida(extra: Record<string, unknown> = {}) {
  return {
    profileType: "criador" as const,
    fullName: "Maria da Silva",
    whatsapp: "(54) 99123-4567",
    email: "  MARIA@Exemplo.com ",
    city: "Caxias do Sul",
    state: "RS" as const,
    productionCity: "Vacaria",
    interests: [],
    consentAccepted: true as const,
    ...extra,
  };
}

beforeEach(() => {
  rpc.mockReset();
  adminRpc.mockReset();
  papelAtual = "admin";
});

/* -------------------------------------------------------------------------- */
/* 1. As decisões do CRM                                                      */
/* -------------------------------------------------------------------------- */

describe("permissão das decisões do CRM", () => {
  const acoes: Array<[string, () => Promise<{ ok: boolean }>]> = [
    ["assumir análise", () => startMembershipReviewAction(ID)],
    ["aprovar", () => approveMembershipApplicationAction({ id: ID })],
    ["recusar", () => rejectMembershipApplicationAction({ id: ID, reason: "Fora do escopo." })],
    ["reabrir", () => reopenMembershipApplicationAction(ID)],
  ];

  for (const [nome, acao] of acoes) {
    it(`${nome}: o Atendente é recusado sem tocar no banco`, async () => {
      papelAtual = "comercial";
      const resultado = await acao();
      expect(resultado.ok).toBe(false);
      expect(rpc).not.toHaveBeenCalled();
    });

    it(`${nome}: quem não tem perfil é recusado sem tocar no banco`, async () => {
      papelAtual = null;
      const resultado = await acao();
      expect(resultado.ok).toBe(false);
      expect(rpc).not.toHaveBeenCalled();
    });
  }

  // Era "o Gestor consegue aprovar" — o papel foi aposentado em
  // 20260902000000_retire_roles.sql e aprovar passou a ser só do Administrador.
  // O teste continua sendo o único caso POSITIVO desta suíte: sem ele, provar
  // que o Atendente é recusado não provaria nada (recusar todo mundo também
  // passaria).
  it("o Administrador consegue aprovar", async () => {
    papelAtual = "admin";
    rpc.mockResolvedValue({ data: { id: "22222222-2222-4222-8222-222222222222" }, error: null });

    const resultado = await approveMembershipApplicationAction({ id: ID, note: "confere" });
    expect(resultado.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("approve_membership_application", {
      p_application_id: ID,
      p_note: "confere",
    });
  });

  it("recusar sem motivo é barrado antes do banco", async () => {
    const resultado = await rejectMembershipApplicationAction({ id: ID, reason: "   " });
    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("id que não é uuid é barrado antes do banco", async () => {
    const resultado = await startMembershipReviewAction("nao-e-uuid");
    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("traduz o código do banco em vez de vazar a mensagem crua", async () => {
    // MA001 = transição não permitida. O texto do Postgres cita nome de tabela;
    // o que a tela mostra é a frase do dicionário de erros.
    rpc.mockResolvedValue({
      data: null,
      error: { code: "MA001", message: 'membership_applications: "approved" -> "pending"' },
    });

    const resultado = await reopenMembershipApplicationAction(ID);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error.code).toBe("membershipTransitionNotAllowed");
  });
});

/* -------------------------------------------------------------------------- */
/* 2. O formulário público                                                    */
/* -------------------------------------------------------------------------- */

describe("submitMembershipApplicationAction", () => {
  it("registra a solicitação e devolve o protocolo", async () => {
    adminRpc.mockResolvedValue({
      data: [{ application_id: ID, protocol: "ASC-000001", duplicate: false }],
      error: null,
    });

    const resultado = await submitMembershipApplicationAction(solicitacaoValida());
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.data).toEqual({ protocol: "ASC-000001", duplicate: false });
  });

  it("usa o cliente de service_role, e não o do usuário", async () => {
    // O visitante não tem sessão: se esta action passasse pelo cliente
    // autenticado, a RLS recusaria e o formulário nunca gravaria nada.
    adminRpc.mockResolvedValue({
      data: [{ application_id: ID, protocol: "ASC-000002", duplicate: false }],
      error: null,
    });

    await submitMembershipApplicationAction(solicitacaoValida());
    expect(adminRpc).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("normaliza telefone e CNPJ para dígitos antes de gravar", async () => {
    adminRpc.mockResolvedValue({
      data: [{ application_id: ID, protocol: "ASC-000003", duplicate: false }],
      error: null,
    });

    await submitMembershipApplicationAction(
      solicitacaoValida({ cnpj: "11.222.333/0001-81", sowCount: "1200" }),
    );

    const args = adminRpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args["p_whatsapp"]).toBe("54991234567");
    expect(args["p_cnpj"]).toBe("11222333000181");
    // O formulário coleta texto; o banco guarda inteiro.
    expect(args["p_sow_count"]).toBe(1200);
  });

  it("manda o hash do IP, nunca o IP em claro", async () => {
    adminRpc.mockResolvedValue({
      data: [{ application_id: ID, protocol: "ASC-000004", duplicate: false }],
      error: null,
    });

    await submitMembershipApplicationAction(solicitacaoValida());

    const args = adminRpc.mock.calls[0]?.[1] as Record<string, unknown>;
    const hash = args["p_source_ip_hash"];
    expect(typeof hash).toBe("string");
    expect(hash).not.toContain("203.0.113.7");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("monta a chave de deduplicação com e-mail minúsculo e perfil", async () => {
    adminRpc.mockResolvedValue({
      data: [{ application_id: ID, protocol: "ASC-000005", duplicate: false }],
      error: null,
    });

    await submitMembershipApplicationAction(solicitacaoValida());

    const args = adminRpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(String(args["p_dedupe_key"])).toMatch(/^maria@exemplo\.com\|criador\|\d+$/);
  });

  it("dois envios seguidos geram a MESMA chave de deduplicação", async () => {
    adminRpc.mockResolvedValue({
      data: [{ application_id: ID, protocol: "ASC-000006", duplicate: false }],
      error: null,
    });

    await submitMembershipApplicationAction(solicitacaoValida());
    await submitMembershipApplicationAction(solicitacaoValida());

    const primeira = (adminRpc.mock.calls[0]?.[1] as Record<string, unknown>)["p_dedupe_key"];
    const segunda = (adminRpc.mock.calls[1]?.[1] as Record<string, unknown>)["p_dedupe_key"];
    expect(primeira).toBe(segunda);
  });

  it("recusa antes do banco quando falta o consentimento", async () => {
    const resultado = await submitMembershipApplicationAction(
      solicitacaoValida({ consentAccepted: false }),
    );
    expect(resultado.ok).toBe(false);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("recusa antes do banco quando o perfil exige um campo que não veio", async () => {
    const resultado = await submitMembershipApplicationAction(
      solicitacaoValida({ profileType: "empresa", productionCity: "" }),
    );
    expect(resultado.ok).toBe(false);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("traduz o limite de taxa numa frase para quem está do outro lado", async () => {
    adminRpc.mockResolvedValue({ data: null, error: { code: "MA004", message: "too many" } });

    const resultado = await submitMembershipApplicationAction(solicitacaoValida());
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error.code).toBe("membershipRateLimited");
  });

  it("devolve erro quando o banco não retorna linha", async () => {
    adminRpc.mockResolvedValue({ data: [], error: null });

    const resultado = await submitMembershipApplicationAction(solicitacaoValida());
    expect(resultado.ok).toBe(false);
  });
});
