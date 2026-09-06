import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A PORTA PÚBLICA — o que ela aceita, o que ela recusa, e o que ela NUNCA conta.
 *
 * ============================================================================
 * ⚠️ ESTA É A ÚNICA ACTION DO MÓDULO SEM `assertPermission`, E POR ISSO ELA É A
 * QUE MAIS PRECISA DESTES TESTES.
 * ============================================================================
 * As outras são protegidas por um papel; esta é protegida por quatro
 * propriedades estruturais, e cada uma delas é um caso abaixo:
 *
 *   1. o navegador manda SLUG, e o servidor deriva a página;
 *   2. a chave de idempotência é montada aqui, nunca recebida;
 *   3. o log não carrega dado pessoal;
 *   4. a resposta não devolve identificador nenhum.
 *
 * Nenhuma delas quebra de forma visível: um `landingPageId` aceito do cliente
 * continua funcionando para o uso honesto, e o log com o e-mail da pessoa só
 * aparece no dia em que alguém abrir o painel de logs de produção.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ "user-agent": "vitest", "x-vercel-forwarded-for": "203.0.113.7" }),
}));

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

/** O que o slug resolve. `null` = a página não existe para o mundo. */
let paginaResolvida: string | null = "aaaaaaaa-1111-4111-8111-111111111111";
const resolver = vi.fn(async (_slug: string) => paginaResolvida);

vi.mock("@/lib/services/event-landing-public", () => ({
  resolvePublicLandingPageId: (slug: string) => resolver(slug),
}));

const { submitEventRegistrationAction } = await import("./event-registration-public");

const ENVIO = {
  slug: "encontro-tecnico",
  companyName: "Granja ABC",
  participants: [
    { fullName: "João da Silva", email: "joao@email.com", phone: "11999998888", whatsapp: "" },
  ],
  consentVersion: "2026-08-v1",
  consentAccepted: true as const,
};

/** A resposta feliz da função Postgres. */
function gravou(participantes = 1, duplicate = false) {
  return {
    data: [
      {
        registration_id: "bbbbbbbb-2222-4222-8222-222222222222",
        participant_count: participantes,
        duplicate,
      },
    ],
    error: null,
  };
}

beforeEach(() => {
  rpc.mockReset();
  resolver.mockClear();
  paginaResolvida = "aaaaaaaa-1111-4111-8111-111111111111";
});

describe("§20 e §21 — o caminho feliz", () => {
  it("grava e devolve quantas pessoas entraram", async () => {
    rpc.mockResolvedValue(gravou(2));

    const r = await submitEventRegistrationAction({
      ...ENVIO,
      participants: [
        ...ENVIO.participants,
        { fullName: "Maria", email: "maria@email.com", phone: "", whatsapp: "11988887777" },
      ],
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.participantCount).toBe(2);
  });

  /**
   * ⚠️ O SLUG VIRA A PÁGINA NO SERVIDOR. Este é o caso que prova a propriedade
   * 1: a action NÃO aceita um identificador de página do cliente, ela resolve a
   * partir do endereço. Se alguém trocar isto por um `input.landingPageId`, um
   * POST forjado passa a poder inscrever gente na página de outro evento.
   */
  it("deriva a página a partir do slug, e é ela que vai para o banco", async () => {
    rpc.mockResolvedValue(gravou());

    await submitEventRegistrationAction(ENVIO);

    expect(resolver).toHaveBeenCalledWith("encontro-tecnico");
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args["p_landing_page_id"]).toBe("aaaaaaaa-1111-4111-8111-111111111111");
  });

  /**
   * ⚠️ A CHAVE É MONTADA AQUI (§23, §26). Ela leva a página, o e-mail do
   * primeiro participante e uma janela de tempo — e nada disso veio do corpo da
   * requisição. Aceitá-la de fora deixaria qualquer um mandar a chave de OUTRA
   * inscrição e receber os dados dela de volta como "duplicada".
   */
  it("monta a chave de idempotência no servidor", async () => {
    rpc.mockResolvedValue(gravou());

    await submitEventRegistrationAction(ENVIO);

    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    const chave = String(args["p_dedupe_key"]);
    expect(chave).toContain("aaaaaaaa-1111-4111-8111-111111111111");
    expect(chave).toContain("joao@email.com");
  });

  /** §36 — a origem NÃO é enviada: o banco a deriva de quem chamou. */
  it("não manda a origem", async () => {
    rpc.mockResolvedValue(gravou());
    await submitEventRegistrationAction(ENVIO);

    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(args)).not.toContain("p_origin");
  });

  /** §35 — a versão do consentimento viaja com o envio e é gravada. */
  it("leva a versão de consentimento que estava na tela", async () => {
    rpc.mockResolvedValue(gravou());
    await submitEventRegistrationAction(ENVIO);

    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args["p_consent_policy_version"]).toBe("2026-08-v1");
  });

  /** §34 e §35 — o IP vai como HASH, e nunca em claro. */
  it("manda o hash do IP, não o endereço", async () => {
    rpc.mockResolvedValue(gravou());
    await submitEventRegistrationAction(ENVIO);

    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    const hash = String(args["p_source_ip_hash"] ?? "");
    expect(hash).not.toContain("203.0.113.7");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * ⚠️ A RESPOSTA NÃO TEM `registrationId`. A action do backoffice devolve; esta
   * não. Um identificador na resposta de uma página aberta na internet é uma
   * coisa que pode ser colada em algum lugar, e a tela de confirmação não
   * precisa dele para nada.
   */
  it("não devolve identificador nenhum", async () => {
    rpc.mockResolvedValue(gravou());
    const r = await submitEventRegistrationAction(ENVIO);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.data).sort()).toEqual(["duplicate", "participantCount"]);
    }
  });
});

describe("§34 — o que a action recusa antes de tocar no banco", () => {
  it.each([
    ["sem granja", { companyName: "" }],
    ["sem participante", { participants: [] }],
    ["sem aceite de LGPD", { consentAccepted: false }],
    ["endereço inválido", { slug: "Encontro Técnico" }],
    [
      "e-mail repetido",
      {
        participants: [
          { fullName: "João", email: "joao@email.com", phone: "11999998888", whatsapp: "" },
          { fullName: "Outro", email: "JOAO@email.com", phone: "11988887777", whatsapp: "" },
        ],
      },
    ],
    [
      "participante sem contato",
      {
        participants: [{ fullName: "João", email: "joao@email.com", phone: "", whatsapp: "" }],
      },
    ],
  ])("%s: recusa e não chama o banco", async (_nome, remendo) => {
    const r = await submitEventRegistrationAction({ ...ENVIO, ...remendo } as never);

    expect(r.ok).toBe(false);
    // ⚠️ A SEGUNDA METADE IMPORTA MAIS QUE A PRIMEIRA. Uma action que consulta
    // o banco e só depois recusa já gastou uma transação por um payload que
    // nunca deveria ter passado da porta.
    expect(rpc).not.toHaveBeenCalled();
  });

  /**
   * Slug que não existe, página em rascunho, página inativada — a função
   * Postgres devolve vazio para os três, e a action responde a mesma coisa.
   */
  it("página inexistente ou oculta responde notFound sem gravar", async () => {
    paginaResolvida = null;

    const r = await submitEventRegistrationAction(ENVIO);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("notFound");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("§30 — os erros de negócio chegam traduzidos", () => {
  it.each([
    ["LP001", "landingNotAcceptingRegistrations"],
    ["RG001", "registrationsClosed"],
    ["RG002", "registrationsFull"],
    ["RG003", "participantAlreadyRegistered"],
    ["RG004", "participantRepeatedInRequest"],
    ["RG007", "registrationRateLimited"],
    ["RG008", "registrationConsentRequired"],
  ])("%s vira %s", async (errcode, esperado) => {
    rpc.mockResolvedValue({ data: null, error: { code: errcode, message: "x" } });

    const r = await submitEventRegistrationAction(ENVIO);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(esperado);
  });

  /**
   * ⚠️ 23505 NO ÍNDICE DE E-MAIL É A CORRIDA DO §22. Duas requisições
   * simultâneas com o mesmo e-mail passam AS DUAS pela checagem em PL/pgSQL;
   * quem recusa a segunda é o índice único, e o que chega aqui é uma violação
   * de constraint. Sem esta tradução, a segunda granja veria "Já existe um
   * registro com esses dados" — verdadeiro e inútil.
   */
  it("a violação do índice vira a mensagem de já inscrito", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", constraint: "event_participants_event_email_idx", message: "x" },
    });

    const r = await submitEventRegistrationAction(ENVIO);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("participantAlreadyRegistered");
  });
});

describe("§35 — nada de dado pessoal no log", () => {
  /**
   * ==========================================================================
   * ⚠️ ESTE FORMULÁRIO É O QUE MAIS GENTE DE FORA VAI PREENCHER.
   * ==========================================================================
   * Um `console.error("falhou", input)` aqui despejaria nome, e-mail e telefone
   * de terceiros no log de produção — um vazamento que não dispara alarme
   * nenhum, não aparece na tela e sobrevive em backup de log por meses.
   *
   * O teste captura o que foi escrito e procura os dados da pessoa. Ele falha
   * no instante em que alguém "melhora" o log para depurar.
   */
  it("o erro do Postgres não leva nome, e-mail nem telefone", async () => {
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "RG002", message: "sem vagas" } });

    await submitEventRegistrationAction(ENVIO);

    const escrito = espiao.mock.calls.flat().map(String).join(" | ");
    expect(escrito).toContain("RG002");
    for (const pessoal of ["João da Silva", "joao@email.com", "11999998888", "Granja ABC"]) {
      expect(escrito, `vazou "${pessoal}"`).not.toContain(pessoal);
    }
    espiao.mockRestore();
  });

  /**
   * ⚠️ E O `catch` TAMBÉM. Uma falha de rede do `fetch` do supabase-js pode
   * trazer o CORPO DA REQUISIÇÃO dentro da exceção — que é justamente a lista
   * de participantes. As outras actions do projeto logam o erro inteiro, e ali
   * isso é seguro porque quem as chama está logado; aqui não é.
   */
  it("a exceção inesperada não leva o payload junto", async () => {
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockRejectedValue(new Error(`falha ao enviar ${JSON.stringify(ENVIO)}`));

    const r = await submitEventRegistrationAction(ENVIO);

    expect(r.ok).toBe(false);
    const escrito = espiao.mock.calls.flat().map(String).join(" | ");
    expect(escrito).not.toContain("joao@email.com");
    expect(escrito).not.toContain("Granja ABC");
    espiao.mockRestore();
  });
});
