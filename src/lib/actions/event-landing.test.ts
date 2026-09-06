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
  removeLandingPageImageAction,
  requestLandingImageUploadAction,
  setLandingPageImageAction,
  setLandingPageStatusAction,
  setParticipantConfirmationAction,
  updateCompanyAction,
  updateLandingPageAction,
  updateParticipantAction,
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
    () =>
      updateRegistrationAction({ eventId: EVENTO, registrationId: INSCRICAO, status: "cancelled" }),
  ],
  [
    "confirmar participante",
    () =>
      setParticipantConfirmationAction({
        eventId: EVENTO,
        participantId: PARTICIPANTE,
        confirmation: "not_confirmed",
      }),
  ],
];

/**
 * As escritas que o Prompt 4 acrescentou. Entram na MESMA bateria de permissões:
 * o dia em que uma delas escapar da lista, os quatro casos por action deixam de
 * rodar sobre ela — e ninguém percebe, porque a bateria continua verde.
 */
const ESCRITAS_DO_BACKOFFICE: readonly [string, () => Promise<ActionResult<unknown>>][] = [
  [
    "editar participante",
    () =>
      updateParticipantAction({
        eventId: EVENTO,
        participantId: PARTICIPANTE,
        fullName: "João da Silva",
        email: "joao@email.com",
        phone: "11999998888",
        whatsapp: "",
        confirmation: "confirmed",
      }),
  ],
  [
    "renomear a granja",
    () =>
      updateCompanyAction({
        eventId: EVENTO,
        registrationId: INSCRICAO,
        companyName: "Granja ABC",
      }),
  ],
];

const TODAS = [...ESCRITAS_DE_EVENTO, ...ESCRITAS_DE_INSCRICAO, ...ESCRITAS_DO_BACKOFFICE];

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

/**
 * ============================================================================
 * ⚠️ A IMAGEM DA PÁGINA (§8 do Prompt 2) — TRÊS PORTAS, TRÊS ARMADILHAS.
 * ============================================================================
 * O upload é o único caminho deste módulo em que um arquivo chega ao servidor,
 * e ele tem uma propriedade incômoda: o objeto sobe ao Storage ANTES de
 * qualquer validação de conteúdo (a Vercel corta o corpo de Server Actions em
 * 4,5 MB, e o limite é 5 MB). Os testes abaixo cobrem o que isso exige.
 */
describe("a imagem da página", () => {
  it("o Atendente não pode pedir endereço de upload", async () => {
    papelAtual = "comercial";

    const resultado = await requestLandingImageUploadAction({
      landingPageId: LANDING,
      filename: "cartaz.jpg",
      sizeBytes: 1024,
    });

    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("o Atendente não pode gravar nem remover a imagem", async () => {
    papelAtual = "comercial";

    const gravar = await setLandingPageImageAction({
      landingPageId: LANDING,
      storagePath: `${EVENTO}/landing/x.jpg`,
    });
    const remover = await removeLandingPageImageAction({ landingPageId: LANDING });

    expect(gravar.ok).toBe(false);
    expect(remover.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ ARQUIVO GRANDE DEMAIS MORRE ANTES DE SUBIR. A validação por extensão e
   * tamanho é o que se consegue fazer com o que o cliente declarou — e serve
   * para não gastar uma volta ao Storage com um arquivo que seria recusado.
   */
  it("recusa arquivo acima do limite sem falar com o Storage", async () => {
    papelAtual = "admin";

    const resultado = await requestLandingImageUploadAction({
      landingPageId: LANDING,
      filename: "cartaz.jpg",
      sizeBytes: 6 * 1024 * 1024,
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("fileTooLarge");
  });

  it("recusa extensão que não é de imagem", async () => {
    papelAtual = "admin";

    const resultado = await requestLandingImageUploadAction({
      landingPageId: LANDING,
      filename: "planilha.xlsx",
      sizeBytes: 1024,
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("fileNotImage");
  });

  it("payload malformado não chega ao banco", async () => {
    papelAtual = "admin";

    const resultado = await setLandingPageImageAction({
      landingPageId: "não-é-uuid",
      storagePath: "x.jpg",
    });

    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

/* ========================================================================== */
/* §25 e §26 do Prompt 4 — o evento viaja junto (IDOR)                        */
/* ========================================================================== */

describe("o evento é enviado ao banco em toda escrita de inscrição", () => {
  /**
   * ==========================================================================
   * ⚠️ O QUE ESTE BLOCO PROTEGE É UMA COISA QUE NÃO APARECE NA TELA.
   * ==========================================================================
   * O §25 pede: "garantir especialmente que um usuário não consiga acessar um
   * participante informando manualmente um ID pertencente a outro evento".
   *
   * Quem recusa é o BANCO — as funções conferem `event_id` e devolvem P0002. Mas
   * elas só conseguem conferir se a action MANDAR o evento. Um `p_event_id` que
   * some daqui não quebra nada visível: a tela continua funcionando, porque ela
   * sempre manda o evento certo. O que abre é a porta para quem não usa a tela.
   */
  it.each([
    [
      "confirmação",
      () =>
        setParticipantConfirmationAction({
          eventId: EVENTO,
          participantId: PARTICIPANTE,
          confirmation: "confirmed",
        }),
      "p_event_id",
    ],
    [
      "edição do participante",
      () =>
        updateParticipantAction({
          eventId: EVENTO,
          participantId: PARTICIPANTE,
          fullName: "João da Silva",
          email: "joao@email.com",
          phone: "11999998888",
          whatsapp: "",
          confirmation: "confirmed",
        }),
      "p_event_id",
    ],
    [
      "renomear a granja",
      () =>
        updateCompanyAction({
          eventId: EVENTO,
          registrationId: INSCRICAO,
          companyName: "Granja ABC",
        }),
      "p_event_id",
    ],
  ])("%s manda o evento", async (_nome, chamar, parametro) => {
    papelAtual = "admin";
    await chamar();

    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args[parametro]).toBe(EVENTO);
  });

  /**
   * ⚠️ RENOMEAR A GRANJA NÃO PODE CANCELAR A INSCRIÇÃO (§16). `updateCompanyAction`
   * existe separada de `updateRegistrationAction` justamente porque aquela
   * também cancela e reativa — e o §16 proíbe exclusão nesta tela. Uma action
   * estreita não tem como cancelar por engano.
   */
  it("renomear a granja não mexe na situação da inscrição", async () => {
    papelAtual = "admin";
    await updateCompanyAction({
      eventId: EVENTO,
      registrationId: INSCRICAO,
      companyName: "Granja ABC",
    });

    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args["p_status"]).toBeUndefined();
  });

  /**
   * ⚠️ TELEFONE VAZIO É "APAGAR", E NÃO "MANTER". `update_event_participant`
   * trata string vazia como limpar o campo — é o que permite tirar um telefone
   * pela tela. Se a action mandasse `undefined`, o campo ficaria imutável e
   * ninguém entenderia por quê.
   */
  it("campo de telefone limpo chega ao banco como vazio, não como ausente", async () => {
    papelAtual = "admin";
    await updateParticipantAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      fullName: "João da Silva",
      email: "joao@email.com",
      phone: "",
      whatsapp: "11988887777",
      confirmation: "confirmed",
    });

    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args["p_phone"]).toBe("");
  });
});

describe("§13 e §15 — a ficha inválida não chega ao banco", () => {
  it.each([
    ["sem nome", { fullName: "" }],
    ["e-mail inválido", { email: "joao@email" }],
    ["sem telefone e sem WhatsApp", { phone: "", whatsapp: "" }],
    ["evento que não é uuid", { eventId: "outro-evento" }],
  ])("%s: recusa sem tocar no banco", async (_nome, remendo) => {
    papelAtual = "admin";
    const resultado = await updateParticipantAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      fullName: "João da Silva",
      email: "joao@email.com",
      phone: "11999998888",
      whatsapp: "",
      confirmation: "confirmed",
      ...remendo,
    } as never);

    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  /** §14 — a mensagem que o banco devolve chega traduzida à tela. */
  it("o e-mail já inscrito vira a mensagem de duplicidade", async () => {
    papelAtual = "admin";
    rpc.mockResolvedValue({ data: null, error: { code: "RG003", message: "x" } });

    const resultado = await updateParticipantAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      fullName: "João da Silva",
      email: "maria@email.com",
      phone: "11999998888",
      whatsapp: "",
      confirmation: "confirmed",
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("participantAlreadyRegistered");
  });

  /**
   * ⚠️ P0002 É "NÃO ENCONTRADO", e é a resposta para um participante de OUTRO
   * evento. A tela não deve dizer "este participante existe, mas é de outro
   * evento" — isso confirmaria a existência do registro.
   */
  it("participante de outro evento responde 'não encontrado'", async () => {
    papelAtual = "admin";
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "x" } });

    const resultado = await setParticipantConfirmationAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      confirmation: "confirmed",
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("notFound");
  });
});
