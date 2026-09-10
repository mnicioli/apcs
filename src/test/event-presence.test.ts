import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/rbac/rbac.types";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { participantPresenceSchema } from "@/modules/event/event.landing.schema";
import {
  EMPTY_PRESENCE_BOARD_FILTERS,
  EMPTY_REGISTRATION_BOARD_FILTERS,
  REGISTRATION_PAGE_SIZE,
} from "@/modules/event/event.landing.types";
import {
  eventPresenceHref,
  hasActiveFilters,
  parsePresenceFilters,
  parseRegistrationFilters,
  presenceHref,
} from "@/modules/event/event.registrations.routes";

/**
 * A LISTA DE PRESENÇA, DA URL ATÉ A CHAMADA AO BANCO.
 *
 * ============================================================================
 * ⚠️ O QUE ESTE ARQUIVO EXERCITA DE VERDADE, E O QUE ELE NÃO ALCANÇA.
 * ============================================================================
 * Roda de verdade, sem mock: o schema que aceita e recusa, a serialização dos
 * filtros (que é o que faz busca, filtro e paginação chegarem ao servidor), a
 * matriz de permissões e a action inteira — inclusive a checagem de RBAC, com o
 * papel real passando por `hasPermission`.
 *
 * O que ele NÃO alcança é o Postgres. Este projeto não sobe banco na bateria
 * (ver o cabeçalho de `sql-returns-table`), então o compare-and-set, o carimbo
 * de hora, a trilha e a recusa de participante de outro evento são cobertos por
 * `sql-event-presence.test.ts`, que lê as invariantes do texto do SQL. Chamar
 * isto de "teste de integração completo" seria mentir sobre a garantia — e é
 * justamente o tipo de afirmação que faz alguém pular a homologação manual.
 *
 * O valor dele é outro e é real: ele prova que o QUE A TELA MANDA é o que o
 * banco espera receber. A action manda o evento junto (§18), não manda
 * timestamp (§21) e não manda confirmação (§3).
 */

const EVENTO = "11111111-1111-4111-8111-111111111111";
const OUTRO_EVENTO = "22222222-2222-4222-8222-222222222222";
const PARTICIPANTE = "44444444-4444-4444-8444-444444444444";

/* -------------------------------------------------------------------------- */
/* A action, com o papel real passando pelo RBAC                              */
/* -------------------------------------------------------------------------- */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/services/roles", () => ({
  ensureRoleMatrix: async () => [],
  invalidateRoleCache: () => {},
}));

const rpc = vi.hoisted(() => vi.fn());
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
    rpc,
  }),
}));

const { setParticipantPresenceAction } = await import("@/lib/actions/event-presence");

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: {
      id: PARTICIPANTE,
      present: true,
      checked_in_at: "2026-09-09T21:02:00Z",
      checked_in_by: "99999999-9999-4999-8999-999999999999",
    },
    error: null,
  });
  papelAtual = "admin";
});

/* ========================================================================== */

describe("§4 e §12 — o participante começa ausente", () => {
  it("os filtros nascem em 'todos', então a primeira abertura mostra a lista inteira", () => {
    expect(EMPTY_PRESENCE_BOARD_FILTERS.presence).toBe("all");
  });

  it("a ordenação padrão da presença é alfabética, e a de inscrições não", () => {
    /**
     * ⚠️ A DIFERENÇA É O TRABALHO QUE CADA TELA SERVE. Na porta do evento a
     * pergunta é sempre "achar o fulano que está na minha frente"; em Inscrições
     * é "quem se inscreveu ultimamente".
     */
    expect(EMPTY_PRESENCE_BOARD_FILTERS.sort).toBe("participant");
    expect(EMPTY_REGISTRATION_BOARD_FILTERS.sort).toBe("recent");
  });
});

describe("§12 — marcar presença", () => {
  it("manda o participante, o evento e o novo estado", async () => {
    const resultado = await setParticipantPresenceAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      present: true,
    });

    expect(resultado.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("set_participant_presence", {
      p_event_id: EVENTO,
      p_participant_id: PARTICIPANTE,
      p_present: true,
      p_source: "backoffice",
    });
  });

  it("§21 — NÃO manda timestamp nenhum", async () => {
    /**
     * ⚠️ A ASSERÇÃO É SOBRE A AUSÊNCIA, e é o §21 inteiro. O relógio do
     * navegador de quem opera não pode decidir a que horas alguém chegou —
     * uma máquina com a hora errada faria a lista mentir sobre o evento.
     */
    await setParticipantPresenceAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      present: true,
    });

    const payload = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    for (const chave of Object.keys(payload)) {
      expect(chave).not.toMatch(/at$|time|date|when/i);
    }
  });

  it("§4 — NÃO manda o usuário responsável", async () => {
    // Ele vem de `auth.uid()` no banco. Um `p_checked_in_by` no payload seria a
    // identidade de quem registrou virando um campo escolhido por quem chama.
    await setParticipantPresenceAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      present: true,
    });

    const payload = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain("p_checked_in_by");
    expect(Object.keys(payload)).not.toContain("p_actor_id");
  });

  it("devolve o estado atualizado, com o carimbo que o banco gerou", async () => {
    const resultado = await setParticipantPresenceAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      present: true,
    });

    expect(resultado).toEqual({
      ok: true,
      data: { id: PARTICIPANTE, present: true, checkedInAt: "2026-09-09T21:02:00Z" },
    });
  });
});

describe("§13 — desmarcar é a mesma operação, com o valor oposto", () => {
  it("manda present: false pela mesma porta", async () => {
    rpc.mockResolvedValue({
      data: { id: PARTICIPANTE, present: false, checked_in_at: null, checked_in_by: null },
      error: null,
    });

    const resultado = await setParticipantPresenceAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      present: false,
    });

    expect(resultado).toEqual({
      ok: true,
      data: { id: PARTICIPANTE, present: false, checkedInAt: null },
    });
    expect(rpc).toHaveBeenCalledWith("set_participant_presence", {
      p_event_id: EVENTO,
      p_participant_id: PARTICIPANTE,
      p_present: false,
      p_source: "backoffice",
    });
  });
});

describe("§3 — Confirmado e Presença são independentes", () => {
  it("a presença não carrega confirmação no payload", async () => {
    await setParticipantPresenceAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      present: true,
    });

    const payload = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain("p_confirmation");
  });

  it("o schema da presença recusa um campo de confirmação", () => {
    // ⚠️ NÃO É PEDANTISMO. Um schema que aceitasse os dois convidaria, no
    // primeiro refactor, a uma action que escreve os dois "de uma vez" — que é
    // exatamente a regra automática que o §3 proíbe.
    const analisado = participantPresenceSchema.safeParse({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      present: true,
      confirmation: "confirmed",
    });

    expect(analisado.success).toBe(true);
    expect(analisado.success && "confirmation" in analisado.data).toBe(false);
  });

  it("a presença não é obrigatória para nada em confirmação, e vice-versa", () => {
    // As quatro combinações são estados legítimos. Nenhuma regra do domínio as
    // liga — é a razão de as duas actions e as duas funções serem separadas.
    for (const present of [true, false]) {
      const analisado = participantPresenceSchema.safeParse({
        eventId: EVENTO,
        participantId: PARTICIPANTE,
        present,
      });
      expect(analisado.success).toBe(true);
    }
  });
});

describe("§18 — o participante precisa pertencer ao evento", () => {
  it("o evento SEMPRE vai junto na chamada", async () => {
    await setParticipantPresenceAction({
      eventId: OUTRO_EVENTO,
      participantId: PARTICIPANTE,
      present: true,
    });

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_event_id: OUTRO_EVENTO });
  });

  it("o schema exige o evento — sem ele nada chega ao banco", async () => {
    const resultado = await setParticipantPresenceAction(
      // @ts-expect-error — é exatamente o payload que o schema tem de recusar.
      { participantId: PARTICIPANTE, present: true },
    );

    expect(resultado).toEqual({ ok: false, error: { code: "invalidInput" } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("participante de outro evento: o banco recusa, e a tela recebe 'não encontrado'", async () => {
    // O 'P0002' é o que `set_participant_presence` levanta quando a cadeia não
    // fecha. A action o traduz sem inventar uma mensagem que revele se o id
    // existe em outro lugar.
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "Participante não encontrado." },
    });

    const resultado = await setParticipantPresenceAction({
      eventId: OUTRO_EVENTO,
      participantId: PARTICIPANTE,
      present: true,
    });

    expect(resultado).toEqual({ ok: false, error: { code: "notFound", constraint: undefined } });
  });

  it("participante inexistente cai no mesmo caminho, sem distinção", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "Participante não encontrado." },
    });

    const resultado = await setParticipantPresenceAction({
      eventId: EVENTO,
      participantId: "00000000-0000-4000-8000-000000000000",
      present: true,
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.ok === false && resultado.error.code).toBe("notFound");
  });

  it("um id que não é uuid não chega ao banco", async () => {
    const resultado = await setParticipantPresenceAction({
      eventId: EVENTO,
      participantId: "nao-e-uuid",
      present: true,
    });

    expect(resultado).toEqual({ ok: false, error: { code: "invalidInput" } });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("§19 — quem pode marcar presença", () => {
  it("o Administrador marca", async () => {
    papelAtual = "admin";
    const resultado = await setParticipantPresenceAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      present: true,
    });
    expect(resultado.ok).toBe(true);
  });

  it("o Atendente TAMBÉM marca — e é a exceção deliberada do módulo", async () => {
    /**
     * ⚠️ ESTE CASO EXISTE PARA SER LIDO. Em Inscrições o Atendente não confirma
     * ninguém; aqui ele marca presença, porque marcar quem entrou pela porta não
     * é decisão editorial — é o trabalho de quem está na porta.
     */
    papelAtual = "comercial";
    const resultado = await setParticipantPresenceAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      present: true,
    });

    expect(resultado.ok).toBe(true);
    expect(hasPermission("comercial", "presence.write")).toBe(true);
    // ...e continua sem poder confirmar a inscrição.
    expect(hasPermission("comercial", "registrations.write")).toBe(false);
  });

  it("quem só visualiza não marca, e nada chega ao banco", async () => {
    papelAtual = "viewer";
    const resultado = await setParticipantPresenceAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      present: true,
    });

    expect(resultado).toEqual({ ok: false, error: { code: "forbidden" } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("o Financeiro não abre nem marca", () => {
    expect(hasPermission("financeiro", "presence.read")).toBe(false);
    expect(hasPermission("financeiro", "presence.write")).toBe(false);
  });

  it("sem sessão não passa", async () => {
    papelAtual = null;
    const resultado = await setParticipantPresenceAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      present: true,
    });

    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a permissão é conferida ANTES de tocar no banco", async () => {
    papelAtual = "viewer";
    await setParticipantPresenceAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      present: true,
    });
    // Defesa em profundidade: a 2ª camada é `presence_is_writer()` dentro da
    // função Postgres. Esta é a 1ª, e ela nega cedo, com mensagem clara.
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("§20 — repetir o mesmo estado", () => {
  it("ON → ON devolve sucesso com o mesmo estado", async () => {
    // O compare-and-set do banco não grava e não audita; ele devolve a linha
    // como está. Para a tela isso é sucesso — devolver erro faria o toggle
    // reverter um estado que está certo.
    rpc.mockResolvedValue({
      data: { id: PARTICIPANTE, present: true, checked_in_at: "2026-09-09T21:02:00Z" },
      error: null,
    });

    const resultado = await setParticipantPresenceAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      present: true,
    });

    expect(resultado).toEqual({
      ok: true,
      data: { id: PARTICIPANTE, present: true, checkedInAt: "2026-09-09T21:02:00Z" },
    });
  });

  it("OFF → OFF devolve sucesso com o mesmo estado", async () => {
    rpc.mockResolvedValue({
      data: { id: PARTICIPANTE, present: false, checked_in_at: null },
      error: null,
    });

    const resultado = await setParticipantPresenceAction({
      eventId: EVENTO,
      participantId: PARTICIPANTE,
      present: false,
    });

    expect(resultado).toEqual({
      ok: true,
      data: { id: PARTICIPANTE, present: false, checkedInAt: null },
    });
  });

  it("duas chamadas seguidas mandam exatamente o mesmo payload", async () => {
    const payload = { eventId: EVENTO, participantId: PARTICIPANTE, present: true };
    await setParticipantPresenceAction(payload);
    await setParticipantPresenceAction(payload);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]?.[1]).toEqual(rpc.mock.calls[1]?.[1]);
  });
});

/* ========================================================================== */
/* §14, §15, §16 — busca, filtros e paginação viajam pela URL                */
/* ========================================================================== */

describe("§14 — a busca chega ao servidor pela URL", () => {
  it("o termo entra no endereço e volta igual", () => {
    const comBusca = { ...EMPTY_PRESENCE_BOARD_FILTERS, query: "Granja ABC" };
    const href = eventPresenceHref(EVENTO, comBusca);

    expect(href).toContain("q=Granja+ABC");
    expect(parsePresenceFilters(lerQuery(href)).query).toBe("Granja ABC");
  });

  it("procurar por participante, empresa, e-mail ou telefone usa o MESMO campo", () => {
    /**
     * ⚠️ É UMA CAIXA SÓ, e é isso que este caso registra. A busca atravessa duas
     * tabelas no banco (a granja mora na inscrição, a pessoa no participante),
     * então um campo por coluna seria quatro controles fazendo o que um faz.
     */
    for (const termo of ["João da Silva", "Granja ABC", "joao@email.com", "11999998888"]) {
      const href = eventPresenceHref(EVENTO, { ...EMPTY_PRESENCE_BOARD_FILTERS, query: termo });
      expect(parsePresenceFilters(lerQuery(href)).query).toBe(termo);
    }
  });

  it("busca vazia não suja o endereço", () => {
    expect(eventPresenceHref(EVENTO, EMPTY_PRESENCE_BOARD_FILTERS)).toBe(
      `/events/presence/${EVENTO}`,
    );
  });
});

describe("§15 — os filtros de presença", () => {
  it("Presentes vai e volta", () => {
    const href = eventPresenceHref(EVENTO, {
      ...EMPTY_PRESENCE_BOARD_FILTERS,
      presence: "present",
    });
    expect(href).toContain("pres=present");
    expect(parsePresenceFilters(lerQuery(href)).presence).toBe("present");
  });

  it("Ausentes vai e volta", () => {
    const href = eventPresenceHref(EVENTO, {
      ...EMPTY_PRESENCE_BOARD_FILTERS,
      presence: "absent",
    });
    expect(href).toContain("pres=absent");
    expect(parsePresenceFilters(lerQuery(href)).presence).toBe("absent");
  });

  it("Todos não aparece no endereço", () => {
    const href = eventPresenceHref(EVENTO, { ...EMPTY_PRESENCE_BOARD_FILTERS, presence: "all" });
    expect(href).not.toContain("pres=");
  });

  it("combina com a confirmação — 'confirmou e não chegou'", () => {
    const href = eventPresenceHref(EVENTO, {
      ...EMPTY_PRESENCE_BOARD_FILTERS,
      presence: "absent",
      confirmation: "confirmed",
    });

    const volta = parsePresenceFilters(lerQuery(href));
    expect(volta.presence).toBe("absent");
    expect(volta.confirmation).toBe("confirmed");
  });

  it("um valor inventado na URL cai em 'todos', e não em lista vazia", () => {
    /**
     * ⚠️ UMA URL COLADA ERRADA NÃO DEVE PARECER "ninguém compareceu". A grid
     * vazia sem explicação é a conclusão errada mais fácil de tirar.
     */
    expect(parsePresenceFilters({ pres: "talvez" }).presence).toBe("all");
    expect(parsePresenceFilters({ pres: "" }).presence).toBe("all");
  });

  it("o filtro conta como filtro ativo — é ele que muda a mensagem de vazio", () => {
    expect(hasActiveFilters(EMPTY_PRESENCE_BOARD_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_PRESENCE_BOARD_FILTERS, presence: "present" })).toBe(true);
  });
});

describe("§16 — paginação", () => {
  it("a página entra no endereço e volta", () => {
    const href = eventPresenceHref(EVENTO, { ...EMPTY_PRESENCE_BOARD_FILTERS, page: 3 });
    expect(href).toContain("page=3");
    expect(parsePresenceFilters(lerQuery(href)).page).toBe(3);
  });

  it("a página 1 não aparece no endereço", () => {
    expect(eventPresenceHref(EVENTO, { ...EMPTY_PRESENCE_BOARD_FILTERS, page: 1 })).not.toContain(
      "page=",
    );
  });

  it("a paginação PRESERVA busca e filtro", () => {
    /**
     * ⚠️ É O DEFEITO CLÁSSICO DESTA TELA. Se o link da página 2 perdesse o
     * filtro, quem estivesse vendo "Ausentes" receberia a lista inteira sem
     * perceber — e concluiria que metade da gente sumiu do filtro.
     */
    const href = eventPresenceHref(EVENTO, {
      ...EMPTY_PRESENCE_BOARD_FILTERS,
      query: "Granja",
      presence: "absent",
      page: 2,
    });

    const volta = parsePresenceFilters(lerQuery(href));
    expect(volta).toMatchObject({ query: "Granja", presence: "absent", page: 2 });
  });

  it("página inválida na URL volta para 1", () => {
    expect(parsePresenceFilters({ page: "-3" }).page).toBe(1);
    expect(parsePresenceFilters({ page: "abacaxi" }).page).toBe(1);
  });

  it("o tamanho da página é o mesmo do resto do módulo", () => {
    expect(REGISTRATION_PAGE_SIZE).toBe(25);
  });
});

describe("§8 — a seleção de evento", () => {
  it("o endereço da lista de eventos aceita busca e página", () => {
    expect(presenceHref()).toBe("/events/presence");
    expect(presenceHref(2, "Encontro")).toBe("/events/presence?q=Encontro&page=2");
  });

  it("a rota do evento leva o id, como em Inscrições", () => {
    // Mesmo padrão de navegação das telas vizinhas — o escopo pede explicitamente
    // para não inventar um caminho inconsistente.
    expect(eventPresenceHref(EVENTO, EMPTY_PRESENCE_BOARD_FILTERS)).toBe(
      `/events/presence/${EVENTO}`,
    );
  });
});

describe("as duas telas leem a mesma URL sem se atrapalhar", () => {
  it("a ordenação padrão de cada uma some do endereço da sua tela", () => {
    /**
     * ⚠️ É O ÚNICO PONTO EM QUE AS DUAS TELAS DIFEREM na serialização, e por
     * isso ele tem caso próprio. Com um padrão fixo, a Lista de Presença
     * carregaria `sort=participant` em todo endereço que monta — inclusive nos
     * da paginação.
     */
    expect(eventPresenceHref(EVENTO, EMPTY_PRESENCE_BOARD_FILTERS)).not.toContain("sort=");
    expect(parsePresenceFilters({}).sort).toBe("participant");
    expect(parseRegistrationFilters({}).sort).toBe("recent");
  });

  it("a ordenação que NÃO é o padrão daquela tela aparece", () => {
    const href = eventPresenceHref(EVENTO, { ...EMPTY_PRESENCE_BOARD_FILTERS, sort: "company" });
    expect(href).toContain("sort=company");
    expect(parsePresenceFilters(lerQuery(href)).sort).toBe("company");
  });

  it("a grid de Inscrições continua sem escrever o filtro de presença", () => {
    // Ela não oferece o controle: deixa em `all`, e o parâmetro nem sai na URL.
    expect(parseRegistrationFilters({}).presence).toBe("all");
  });
});

/** Os parâmetros de um endereço montado por `eventPresenceHref`. */
function lerQuery(href: string): Record<string, string> {
  const busca = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
  return Object.fromEntries(new URLSearchParams(busca));
}
