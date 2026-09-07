import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/rbac/rbac.types";
import {
  landingEffectiveStatus,
  landingStatusReason,
  resolveSuccessMessage,
  withEventDate,
} from "@/modules/event/event.landing.rules";
import {
  publicRegistrationSchema,
  updateParticipantSchema,
} from "@/modules/event/event.landing.schema";
import {
  MAX_PARTICIPANTS_PER_REGISTRATION,
  type LandingPageWithEvent,
} from "@/modules/event/event.landing.types";
import {
  eventRegistrationsHref,
  parseRegistrationFilters,
  registrationsExportHref,
} from "@/modules/event/event.registrations.routes";

/**
 * O CICLO COMPLETO — §3 e §30 do Prompt 5.
 *
 * ============================================================================
 * ⚠️ O QUE ESTE ARQUIVO É, E O QUE ELE HONESTAMENTE NÃO É.
 * ============================================================================
 * Ele percorre o cenário do §3 de ponta a ponta:
 *
 *   Evento "Encontro APCS 2026" → Landing Page "encontro-apcs-2026"
 *   → Inscrição pública da "Granja ABC" com João, Maria e Pedro
 *   → Sucesso → Backoffice → Busca → Confirmação → Edição → Exportação
 *
 * O que ele exercita de VERDADE é a camada de decisão: os schemas que aceitam e
 * recusam, as regras que decidem se a página aceita inscrição, a serialização
 * que faz a exportação levar o mesmo recorte da tela, e o texto que a granja lê
 * no fim. Tudo isso roda de verdade, sem mock.
 *
 * O que ele NÃO exercita é o Postgres. Este projeto não sobe banco na bateria
 * (ver o cabeçalho de `sql-returns-table`), então as transações, os locks e as
 * constraints são cobertos por `sql-event-landing.test.ts`, que lê as
 * invariantes do texto do SQL. Chamar isto de "teste de integração completo"
 * seria mentir sobre a garantia — e é justamente o tipo de afirmação que faz
 * alguém pular a homologação manual.
 *
 * O valor dele é outro e é real: ele amarra as PONTAS. Cada etapa consome o que
 * a anterior produziu, com os MESMOS dados. Uma mudança que faça o Builder
 * gravar um formato que a página pública não entende — ou a busca procurar num
 * campo que a grid não traz — quebra aqui, e não em produção.
 */

/* -------------------------------------------------------------------------- */
/* O cenário do §3                                                            */
/* -------------------------------------------------------------------------- */

const EVENTO = {
  id: "11111111-1111-4111-8111-111111111111",
  nome: "Encontro APCS 2026",
  data: "2026-11-20",
  inicio: "08:00:00",
  fim: "13:00:00",
  local: "Toledo — PR",
};

const SLUG = "encontro-apcs-2026";
const GRANJA = "Granja ABC";

const PESSOAS = [
  { fullName: "João da Silva", email: "joao@granjaabc.com", phone: "11999998888", whatsapp: "" },
  { fullName: "Maria da Silva", email: "maria@granjaabc.com", phone: "", whatsapp: "11988887777" },
  { fullName: "Pedro Souza", email: "pedro@granjaabc.com", phone: "11977776666", whatsapp: "" },
];

/** "Hoje" é antes do evento — o cenário inteiro acontece com a página no ar. */
const HOJE = new Date("2026-10-01T09:00:00-03:00");

const PADROES = {
  title: "INSCRIÇÃO CONFIRMADA!",
  message: "Seu cadastro para o {{event_name}} foi realizado com sucesso.",
  footer: "Esperamos você! Nos vemos no evento.",
};

function landing(over: Partial<LandingPageWithEvent> = {}): LandingPageWithEvent {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    eventId: EVENTO.id,
    status: "published",
    slug: SLUG,
    imageUrl: null,
    successImageUrl: null,
    formFields: ["GRANJA_EMPRESA", "EMAIL", "NOME_PARTICIPANTE", "TELEFONE", "WHATSAPP"],
    closesAt: null,
    maxParticipants: null,
    participantCount: 0,
    createdBy: null,
    createdAt: "2026-09-01T10:00:00Z",
    updatedBy: null,
    updatedAt: "2026-09-01T10:00:00Z",
    publishedAt: "2026-09-02T10:00:00Z",
    publishedBy: null,
    event: {
      id: EVENTO.id,
      name: EVENTO.nome,
      eventDate: EVENTO.data,
      startTime: EVENTO.inicio,
      endTime: EVENTO.fim,
      location: EVENTO.local,
      description: null,
      imageUrl: null,
    },
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* A porta pública, com a action de verdade                                   */
/* -------------------------------------------------------------------------- */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ "user-agent": "vitest", "x-vercel-forwarded-for": "203.0.113.9" }),
}));

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/services/event-landing-public", () => ({
  resolvePublicLandingPageId: async (slug: string) =>
    slug === SLUG ? "22222222-2222-4222-8222-222222222222" : null,
}));

const { submitEventRegistrationAction } = await import("@/lib/actions/event-registration-public");

/* -------------------------------------------------------------------------- */
/* O backoffice, com o papel real passando pelo RBAC                          */
/* -------------------------------------------------------------------------- */

vi.mock("@/lib/services/roles", () => ({
  ensureRoleMatrix: async () => [],
  invalidateRoleCache: () => {},
}));

const rpcInterno = vi.hoisted(() => vi.fn());
let papelAtual: Role | null = "admin";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: papelAtual === null ? null : { id: "99999999-9999-4999-8999-999999999999" } },
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
    rpc: rpcInterno,
  }),
}));

const { setParticipantConfirmationAction, updateParticipantAction } =
  await import("@/lib/actions/event-landing");

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: [
      {
        registration_id: "33333333-3333-4333-8333-333333333333",
        participant_count: 3,
        duplicate: false,
      },
    ],
    error: null,
  });

  rpcInterno.mockReset();
  rpcInterno.mockResolvedValue({
    data: { id: "44444444-4444-4444-8444-444444444444" },
    error: null,
  });

  papelAtual = "admin";
});

/* ========================================================================== */

describe("Etapa 1 — a Landing Page publicada aceita inscrição", () => {
  it("publicada, sem prazo e sem lotação, com o evento no futuro", () => {
    const page = withEventDate(landing());

    expect(landingEffectiveStatus(page, HOJE)).toBe("published");
    expect(landingStatusReason(page, HOJE)).toBeNull();
  });

  /** §29 — o slug do §3 é o que a normalização produz a partir do nome. */
  it("o endereço é o slug do evento", () => {
    expect(landing().slug).toBe("encontro-apcs-2026");
  });
});

describe("Etapa 2 — a inscrição pública da Granja ABC, com três participantes", () => {
  const envio = {
    slug: SLUG,
    companyName: GRANJA,
    participants: PESSOAS,
    consentVersion: "2026-08-v1",
    consentAccepted: true as const,
  };

  it("o payload das três pessoas é aceito pelo schema", () => {
    const r = publicRegistrationSchema.safeParse(envio);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.participants).toHaveLength(3);
  });

  it("a action grava e devolve as três pessoas", async () => {
    const resultado = await submitEventRegistrationAction(envio);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.data.participantCount).toBe(3);
  });

  /**
   * ⚠️ O QUE CHEGA AO BANCO É O QUE A GRANJA DIGITOU, normalizado. Este caso
   * amarra a ponta: o telefone vai só com dígitos, o e-mail em minúsculas, e a
   * granja aparece UMA vez — não uma por pessoa.
   */
  it("o banco recebe a granja uma vez e as três pessoas normalizadas", async () => {
    await submitEventRegistrationAction(envio);

    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args["p_company_name"]).toBe(GRANJA);

    const enviados = args["p_participants"] as { email: string; phone: string | null }[];
    expect(enviados.map((p) => p.email)).toEqual([
      "joao@granjaabc.com",
      "maria@granjaabc.com",
      "pedro@granjaabc.com",
    ]);
    expect(enviados[0]?.phone).toBe("11999998888");
    // Maria só tem WhatsApp: o telefone vazio vira nulo, e não string vazia.
    expect(enviados[1]?.phone).toBeNull();
  });

  /** §10 — o duplo envio cai na chave de deduplicação, montada no servidor. */
  it("dois envios seguidos usam a mesma chave de idempotência", async () => {
    await submitEventRegistrationAction(envio);
    await submitEventRegistrationAction(envio);

    const primeira = (rpc.mock.calls[0]?.[1] as Record<string, unknown>)["p_dedupe_key"];
    const segunda = (rpc.mock.calls[1]?.[1] as Record<string, unknown>)["p_dedupe_key"];
    expect(primeira).toBe(segunda);
  });
});

describe("Etapa 3 — o que a inscrição NÃO pode fazer", () => {
  const base = {
    slug: SLUG,
    companyName: GRANJA,
    consentVersion: "2026-08-v1",
    consentAccepted: true,
  };

  /** §8 — o mesmo e-mail duas vezes na mesma inscrição. */
  it("recusa João duas vezes, mesmo com caixa diferente", () => {
    const r = publicRegistrationSchema.safeParse({
      ...base,
      participants: [PESSOAS[0], { ...PESSOAS[1], email: "JOAO@GranjaABC.com" }],
    });
    expect(r.success).toBe(false);
  });

  /** §9 — sem telefone e sem WhatsApp. */
  it("recusa participante sem nenhum contato", () => {
    const r = publicRegistrationSchema.safeParse({
      ...base,
      participants: [{ ...PESSOAS[0], phone: "", whatsapp: "" }],
    });
    expect(r.success).toBe(false);
  });

  /**
   * §7 — exatamente 20 passa; 21 não. O número vem da constante, e não escrito à
   * mão: `sql-event-landing` prova que ela vale o mesmo que a função do banco.
   */
  it("aceita exatamente o teto e recusa um a mais", () => {
    const pessoa = (i: number) => ({
      fullName: `Pessoa ${i}`,
      email: `p${i}@granjaabc.com`,
      phone: "11999998888",
      whatsapp: "",
    });
    const noTeto = Array.from({ length: MAX_PARTICIPANTS_PER_REGISTRATION }, (_, i) => pessoa(i));

    expect(publicRegistrationSchema.safeParse({ ...base, participants: noTeto }).success).toBe(
      true,
    );
    expect(
      publicRegistrationSchema.safeParse({
        ...base,
        participants: [...noTeto, pessoa(MAX_PARTICIPANTS_PER_REGISTRATION)],
      }).success,
    ).toBe(false);
  });
});

describe("Etapa 4 — a tela de sucesso", () => {
  /**
   * §16 — a mensagem base do escopo, com o nome do evento resolvido. É a MESMA
   * função que a prévia do Builder chama: se as duas divergissem, o
   * administrador aprovaria um texto e a granja leria outro.
   */
  it("mostra a mensagem configurada, com o nome do evento", () => {
    const mensagem = resolveSuccessMessage(PADROES, landing().event);

    expect(mensagem.title).toBe("INSCRIÇÃO CONFIRMADA!");
    expect(mensagem.message).toBe(
      "Seu cadastro para o Encontro APCS 2026 foi realizado com sucesso.",
    );
    expect(mensagem.message).not.toContain("{{");
  });
});

describe("Etapa 5 — o backoffice encontra a inscrição", () => {
  /**
   * §7 do Prompt 4 — a busca procura por granja, participante, e-mail e
   * telefone. Aqui a amarra é a SERIALIZAÇÃO: o que a tela põe na URL é o que a
   * exportação vai reler.
   */
  it.each([
    ["a granja", GRANJA],
    ["o participante", "João da Silva"],
    ["o e-mail", "maria@granjaabc.com"],
    ["o telefone colado da conversa", "(11) 97777-6666"],
  ])("procurar por %s sobrevive à ida e à volta na URL", (_nome, termo) => {
    const filtros = { ...parseRegistrationFilters({}), query: termo };
    const href = eventRegistrationsHref(EVENTO.id, filtros);
    const url = new URL(href, "https://x.test");

    expect(parseRegistrationFilters(Object.fromEntries(url.searchParams)).query).toBe(termo);
  });
});

describe("Etapa 6 — confirmação e edição", () => {
  const PARTICIPANTE = "44444444-4444-4444-8444-444444444444";

  /** §19 do Prompt 4 — OFF → ON, com o evento junto (§13 do Prompt 5: IDOR). */
  it("confirmar manda o participante E o evento", async () => {
    const r = await setParticipantConfirmationAction({
      eventId: EVENTO.id,
      participantId: PARTICIPANTE,
      confirmation: "confirmed",
    });

    expect(r.ok).toBe(true);
    const args = rpcInterno.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args["p_event_id"]).toBe(EVENTO.id);
    expect(args["p_confirmation"]).toBe("confirmed");
  });

  /** §19 — ON → OFF. O participante continua existindo: só o enum muda. */
  it("desconfirmar é a mesma operação, com o valor oposto", async () => {
    await setParticipantConfirmationAction({
      eventId: EVENTO.id,
      participantId: PARTICIPANTE,
      confirmation: "not_confirmed",
    });

    const args = rpcInterno.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args["p_confirmation"]).toBe("not_confirmed");
  });

  /** §20 — editar a ficha usa as MESMAS regras do cadastro público. */
  it("a edição aceita a ficha do João e recusa a mesma ficha sem contato", () => {
    const ficha = {
      eventId: EVENTO.id,
      participantId: PARTICIPANTE,
      fullName: "João da Silva",
      email: "joao@granjaabc.com",
      phone: "11999998888",
      whatsapp: "",
      confirmation: "confirmed" as const,
    };

    expect(updateParticipantSchema.safeParse(ficha).success).toBe(true);
    expect(updateParticipantSchema.safeParse({ ...ficha, phone: "", whatsapp: "" }).success).toBe(
      false,
    );
  });

  /**
   * ⚠️ E A EDIÇÃO CHEGA AO BANCO COM O EVENTO JUNTO. O caso acima prova o
   * schema; este prova o CAMINHO — que é onde a proteção contra IDOR mora.
   *
   * O telefone limpo vai como string VAZIA, e não como ausente: a função do
   * banco trata vazio como "apague este campo", e é isso que permite tirar um
   * telefone pela tela. `undefined` deixaria o campo imutável, e ninguém
   * entenderia por quê.
   */
  it("editar o WhatsApp da Maria manda o evento e limpa o telefone", async () => {
    const r = await updateParticipantAction({
      eventId: EVENTO.id,
      participantId: PARTICIPANTE,
      fullName: "Maria da Silva",
      email: "maria@granjaabc.com",
      phone: "",
      whatsapp: "11966665555",
      confirmation: "confirmed",
    });

    expect(r.ok).toBe(true);
    const args = rpcInterno.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args["p_event_id"]).toBe(EVENTO.id);
    expect(args["p_whatsapp"]).toBe("11966665555");
    expect(args["p_phone"]).toBe("");
  });

  /** §12 e §13 — quem não pode escrever não escreve, e o banco nem é tocado. */
  it("o Atendente não confirma ninguém", async () => {
    papelAtual = "comercial";

    const r = await setParticipantConfirmationAction({
      eventId: EVENTO.id,
      participantId: PARTICIPANTE,
      confirmation: "confirmed",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("forbidden");
    expect(rpcInterno).not.toHaveBeenCalled();
  });
});

describe("Etapa 7 — a exportação leva o mesmo recorte", () => {
  /**
   * ==========================================================================
   * ⚠️ A AMARRA FINAL DO CICLO, E A QUE MAIS IMPORTA NA PRÁTICA.
   * ==========================================================================
   * "Filtro: Confirmados / Busca: Granja ABC → exportar somente o resultado
   * atual." Se a tela e a exportação lessem a URL de jeitos diferentes, o
   * arquivo não corresponderia ao que está na tela — e ninguém confere linha por
   * linha um CSV de trezentas pessoas. O erro passaria como verdade.
   */
  it("busca e filtro da tela chegam iguais na exportação", () => {
    const naTela = {
      ...parseRegistrationFilters({}),
      query: GRANJA,
      confirmation: "confirmed" as const,
      page: 3,
    };

    const href = registrationsExportHref(EVENTO.id, naTela);
    const url = new URL(href, "https://x.test");
    const lido = parseRegistrationFilters(Object.fromEntries(url.searchParams));

    expect(lido.query).toBe(GRANJA);
    expect(lido.confirmation).toBe("confirmed");
    // A página fica de fora: a exportação leva o recorte inteiro.
    expect(lido.page).toBe(1);
  });
});

describe("Etapa 8 — depois do evento, a página fecha sozinha", () => {
  /**
   * §17 — o ciclo termina aqui. Passado o dia do evento, a mesma página que
   * aceitou a Granja ABC para de aceitar — sem ninguém encerrar nada à mão, e
   * mesmo sem prazo e sem capacidade configurados.
   */
  it("no dia seguinte ao evento, a inscrição está encerrada", () => {
    const depois = new Date("2026-11-21T09:00:00-03:00");
    const page = withEventDate(landing());

    expect(landingEffectiveStatus(page, depois)).toBe("closed");
    expect(landingStatusReason(page, depois)).toBe("eventPassed");
  });

  /** E as inscrições que ela já recebeu continuam lá — nada se apaga (§16). */
  it("a página encerrada continua sendo a mesma página, com o mesmo endereço", () => {
    const page = landing();
    expect(page.slug).toBe(SLUG);
    expect(page.status).toBe("published");
  });
});
