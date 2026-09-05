import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/actions/errors";
import type { Role } from "@/lib/rbac/rbac.types";

/**
 * AUTORIZAÇÃO NA API, NÃO NO BOTÃO (§21, §28, §30).
 *
 * O §30 pede testes de "usuário sem permissão", "payload inválido", "campos não
 * permitidos" e "tentativa de alterar identificadores protegidos". Estes testes
 * chamam cada Server Action DIRETO, com o papel que não pode, e exigem duas
 * coisas:
 *
 *   1. o resultado é `forbidden`;
 *   2. **o banco nunca é tocado** — `rpc` não é chamado nem uma vez.
 *
 * A segunda importa mais que a primeira, e mais ainda neste módulo do que nos
 * outros: aqui as tabelas guardam nome, e-mail e telefone de centenas de
 * pessoas que não são usuárias do sistema. Uma action que consulta o banco e só
 * depois nega já vazou pelo tempo de resposta a existência daquela inscrição.
 *
 * ⚠️ O PAPEL NÃO É MOCKADO. O que se mocka é o Supabase; `getCurrentUserRole`,
 * `hasPermission` e a matriz do RBAC rodam de verdade. Um teste que mockasse
 * `assertPermission` provaria só que eu sei escrever `vi.mock`.
 *
 * ⚠️ E O RECORTE TESTADO AQUI É O QUE O MÓDULO TEM DE PECULIAR: Landing Page é
 * `events.write`, Inscrição é `registrations.write`. Hoje as duas caem no mesmo
 * papel; o dia em que deixarem de cair, é este arquivo que cobra.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * A matriz de CARGOS fica de fora, como em `lectures.test.ts`: aqui o Supabase
 * é um dublê e não sabe responder aquela consulta. O que o RBAC faz nesse caso
 * é cair na matriz do CÓDIGO, que é exatamente o que estes testes verificam.
 */
vi.mock("@/lib/services/roles", () => ({
  ensureRoleMatrix: async () => [],
  invalidateRoleCache: () => {},
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));

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
  createLandingPageAction,
  createRegistrationAction,
  setLandingPageStatusAction,
  setParticipantConfirmationAction,
  updateLandingPageAction,
  updateRegistrationAction,
} = await import("./event-landing");

const EVENTO = "11111111-1111-4111-8111-111111111111";
const LANDING = "22222222-2222-4222-8222-222222222222";
const INSCRICAO = "33333333-3333-4333-8333-333333333333";
const PARTICIPANTE = "44444444-4444-4444-8444-444444444444";

const CAMPOS = ["GRANJA_EMPRESA", "EMAIL", "NOME_PARTICIPANTE", "TELEFONE", "WHATSAPP"] as const;

const FORM_LANDING = {
  slug: "",
  description: "",
  formFields: [...CAMPOS],
  successTitle: "",
  successMessage: "",
  successFooter: "",
  closesAt: "",
  maxParticipants: "",
};

const INSCRICAO_VALIDA = {
  landingPageId: LANDING,
  companyName: "Granja ABC",
  participants: [
    { fullName: "João da Silva", email: "joao@granja.com", phone: "", whatsapp: "45999990000" },
  ],
};

/**
 * As seis portas de escrita, agrupadas pela permissão que cada uma exige.
 *
 * A lista é o que faz uma action nova sem guard aparecer como teste faltando,
 * em vez de buraco silencioso.
 */
const ESCRITAS_DE_EVENTO: readonly [string, () => Promise<ActionResult<unknown>>][] = [
  ["criar landing page", () => createLandingPageAction({ eventId: EVENTO, ...FORM_LANDING })],
  [
    "editar landing page",
    () => updateLandingPageAction({ landingPageId: LANDING, ...FORM_LANDING }),
  ],
  [
    "publicar landing page",
    () => setLandingPageStatusAction({ landingPageId: LANDING, command: "publish" }),
  ],
];

const ESCRITAS_DE_INSCRICAO: readonly [string, () => Promise<ActionResult<unknown>>][] = [
  ["criar inscrição", () => createRegistrationAction(INSCRICAO_VALIDA)],
  [
    "cancelar inscrição",
    () => updateRegistrationAction({ registrationId: INSCRICAO, status: "cancelled" }),
  ],
  [
    "confirmar participante",
    () =>
      setParticipantConfirmationAction({
        participantId: PARTICIPANTE,
        confirmation: "not_confirmed",
      }),
  ],
];

const TODAS = [...ESCRITAS_DE_EVENTO, ...ESCRITAS_DE_INSCRICAO];

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (nome: string) => ({
    // ⚠️ AS DUAS FORMAS DE RETORNO SÃO DIFERENTES, e o mock respeita a
    // diferença. `create_event_registration` é `returns table`, ou seja, um
    // CONJUNTO de linhas; as demais devolvem a linha afetada. Um mock que
    // devolvesse a mesma forma para as duas passaria no teste e esconderia o
    // `Array.isArray(data) ? data[0] : data` de que a action depende.
    data:
      nome === "create_event_registration"
        ? [{ registration_id: INSCRICAO, participant_count: 1, duplicate: false }]
        : { id: LANDING, slug: "encontro-tecnico", status: "published" },
    error: null,
  }));
  papelAtual = "admin";
});

describe("permissões chamando a action direto", () => {
  for (const [nome, chamar] of TODAS) {
    it(`${nome}: o Atendente não pode, e o banco não é tocado`, async () => {
      papelAtual = "comercial";
      const resultado = await chamar();

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.error.code).toBe("forbidden");
      }
      expect(rpc).not.toHaveBeenCalled();
    });

    it(`${nome}: o Visualizador não pode, e o banco não é tocado`, async () => {
      papelAtual = "viewer";
      const resultado = await chamar();

      expect(resultado.ok).toBe(false);
      expect(rpc).not.toHaveBeenCalled();
    });

    it(`${nome}: sem sessão não passa`, async () => {
      papelAtual = null;
      const resultado = await chamar();

      expect(resultado.ok).toBe(false);
      expect(rpc).not.toHaveBeenCalled();
    });

    it(`${nome}: o Administrador pode`, async () => {
      papelAtual = "admin";
      const resultado = await chamar();

      expect(resultado.ok).toBe(true);
      expect(rpc).toHaveBeenCalledTimes(1);
    });
  }
});

/**
 * ⚠️ VALIDAR ANTES DE AUTORIZAR, E ANTES DE TOCAR NO BANCO.
 *
 * O §28 pede validação de payload num módulo que vai ter porta pública. O que
 * estes testes garantem é que uma entrada malformada morre no Zod — sem
 * consulta, sem escrita, sem mensagem que revele o que existe do outro lado.
 */
describe("payload inválido não chega ao banco", () => {
  it("uuid inventado é recusado", async () => {
    const resultado = await updateRegistrationAction({
      registrationId: "não-é-uuid",
      status: "cancelled",
    } as never);

    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("situação que não existe é recusada", async () => {
    const resultado = await updateRegistrationAction({
      registrationId: INSCRICAO,
      status: "deleted",
    } as never);

    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("comando de landing page que não existe é recusado", async () => {
    const resultado = await setLandingPageStatusAction({
      landingPageId: LANDING,
      command: "delete",
    } as never);

    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("inscrição sem participante é recusada", async () => {
    const resultado = await createRegistrationAction({
      landingPageId: LANDING,
      companyName: "Granja ABC",
      participants: [],
    });

    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("participante sem telefone nem WhatsApp é recusado (§8)", async () => {
    const resultado = await createRegistrationAction({
      landingPageId: LANDING,
      companyName: "Granja ABC",
      participants: [
        { fullName: "João da Silva", email: "joao@granja.com", phone: "", whatsapp: "" },
      ],
    });

    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("configuração de formulário sem contato é recusada", async () => {
    const resultado = await createLandingPageAction({
      eventId: EVENTO,
      ...FORM_LANDING,
      formFields: ["GRANJA_EMPRESA", "EMAIL", "NOME_PARTICIPANTE"],
    });

    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

/**
 * ⚠️ CAMPOS QUE O CLIENTE NÃO PODE ESCOLHER (§28, "não confiar em IDs enviados
 * pelo cliente").
 *
 * Dois deles importam neste módulo, e cada um por um motivo diferente.
 */
describe("o que o cliente não decide", () => {
  /**
   * ⚠️ A CHAVE DE IDEMPOTÊNCIA É MONTADA NO SERVIDOR. Aceitá-la de fora
   * deixaria qualquer um mandar a chave de OUTRA inscrição e receber os dados
   * dela de volta como "duplicada" — que é um vazamento, não uma otimização.
   */
  it("dedupeKey vindo do cliente é descartado", async () => {
    await createRegistrationAction({
      ...INSCRICAO_VALIDA,
      dedupeKey: "chave-de-outra-inscricao",
    } as never);

    const argumentos = rpc.mock.calls[0]?.[1] as { p_dedupe_key: string };
    expect(argumentos.p_dedupe_key).not.toBe("chave-de-outra-inscricao");
    // A chave real é `landingPageId|email|janela` — montada aqui, com o e-mail
    // do primeiro participante.
    expect(argumentos.p_dedupe_key).toContain(LANDING);
    expect(argumentos.p_dedupe_key).toContain("joao@granja.com");
  });

  /**
   * ⚠️ `origin` NÃO É PARÂMETRO. Ele é DERIVADO dentro do Postgres, a partir de
   * quem está chamando. Um `p_origin` na assinatura deixaria a página pública
   * gravar 'backoffice' e mentir sobre a procedência de toda inscrição.
   */
  it("a action não manda origin nenhum para o banco", async () => {
    await createRegistrationAction(INSCRICAO_VALIDA);

    const argumentos = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(argumentos).not.toHaveProperty("p_origin");
  });

  it("o e-mail chega ao banco em minúsculas — é disso que o §12 depende", async () => {
    await createRegistrationAction({
      ...INSCRICAO_VALIDA,
      participants: [
        {
          fullName: "João da Silva",
          email: "  JOAO@Granja.com ",
          phone: "",
          whatsapp: "45 99999-0000",
        },
      ],
    });

    const argumentos = rpc.mock.calls[0]?.[1] as {
      p_participants: { email: string; whatsapp: string | null; phone: string | null }[];
    };
    expect(argumentos.p_participants[0]?.email).toBe("joao@granja.com");
    // E o telefone chega só com dígitos, como o CHECK do banco exige.
    expect(argumentos.p_participants[0]?.whatsapp).toBe("45999990000");
    // Vazio vira `null`, e não string vazia: `''` estouraria o CHECK de dígitos.
    expect(argumentos.p_participants[0]?.phone).toBeNull();
  });
});

/**
 * O contrato de retorno de `create_event_registration`, que é `returns table`.
 *
 * ⚠️ ESTE TESTE EXISTE PORQUE A FORMA MUDA. As outras funções devolvem a linha;
 * esta devolve um conjunto, e o `Array.isArray(data) ? data[0] : data` da
 * action é o que reconcilia os dois. Sem isto, um refactor que "simplificasse"
 * aquela linha passaria despercebido até alguém se inscrever.
 */
describe("resposta da criação de inscrição", () => {
  it("devolve o id, a contagem e se foi duplicada", async () => {
    const resultado = await createRegistrationAction(INSCRICAO_VALIDA);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.data.registrationId).toBe(INSCRICAO);
      expect(resultado.data.participantCount).toBe(1);
      expect(resultado.data.duplicate).toBe(false);
    }
  });

  it("um reenvio na mesma janela volta como duplicado, e não como erro", async () => {
    rpc.mockImplementation(async () => ({
      data: [{ registration_id: INSCRICAO, participant_count: 4, duplicate: true }],
      error: null,
    }));

    const resultado = await createRegistrationAction(INSCRICAO_VALIDA);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.data.duplicate).toBe(true);
      // ⚠️ E DEVOLVE A INSCRIÇÃO QUE JÁ EXISTE, com os participantes dela. Quem
      // apertou duas vezes recebe uma inscrição, não duas nem um erro.
      expect(resultado.data.registrationId).toBe(INSCRICAO);
      expect(resultado.data.participantCount).toBe(4);
    }
  });
});

/**
 * ⚠️ O QUE O LOG NÃO PODE CONTER (§29).
 *
 * Nome, e-mail, telefone e WhatsApp são dados pessoais. Um erro que os despeje
 * no log de produção é um vazamento silencioso — ninguém o vê acontecer, e ele
 * fica lá indefinidamente.
 */
describe("o erro não vaza dado pessoal para o log", () => {
  it("o contexto registrado tem ids e contagem, e nada de pessoa", async () => {
    const logs: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args);
    };

    rpc.mockImplementation(async () => ({
      data: null,
      error: { code: "RG002", message: "Não há vagas suficientes: restam 2." },
    }));

    try {
      await createRegistrationAction({
        landingPageId: LANDING,
        companyName: "Granja ABC",
        participants: [
          {
            fullName: "João da Silva",
            email: "joao@granja.com",
            phone: "",
            whatsapp: "45999990000",
          },
        ],
      });
    } finally {
      console.error = original;
    }

    const texto = JSON.stringify(logs);
    expect(texto).not.toContain("joao@granja.com");
    expect(texto).not.toContain("João da Silva");
    expect(texto).not.toContain("45999990000");
    // O que ele TEM: o id da página e quantas pessoas — o bastante para depurar.
    expect(texto).toContain(LANDING);
  });

  it("a mensagem devolvida é a traduzida, e não a crua do Postgres", async () => {
    rpc.mockImplementation(async () => ({
      data: null,
      error: { code: "RG002", message: "Não há vagas suficientes: restam 2." },
    }));

    const original = console.error;
    console.error = () => {};
    let resultado;
    try {
      resultado = await createRegistrationAction(INSCRICAO_VALIDA);
    } finally {
      console.error = original;
    }

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.error.code).toBe("registrationsFull");
    }
  });
});
