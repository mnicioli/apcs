import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/rbac/rbac.types";
import type { RegistrationBoardRow } from "@/modules/event/event.landing.types";

/**
 * A EXPORTAÇÃO (§18, §19, §20, §25, §29).
 *
 * ============================================================================
 * ⚠️ ESTE ENDPOINT É UMA URL, E É POR ISSO QUE ELE PRECISA DA PRÓPRIA BATERIA.
 * ============================================================================
 * Alguém pode colá-lo no navegador sem passar por tela nenhuma. O que sai por
 * ele é nome, e-mail e telefone de centenas de terceiros — se a permissão
 * estiver só na tela, a exportação é a porta dos fundos de um dado protegido.
 *
 * O primeiro bloco abaixo é o mais importante do arquivo.
 */

let papelAtual: Role | null = "admin";

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUserRole: async () => papelAtual,
}));

const getLandingPageByEvent = vi.hoisted(() => vi.fn());
const getRegistrationBoard = vi.hoisted(() => vi.fn());

vi.mock("@/lib/services/event-landing", () => ({
  getLandingPageByEvent,
  getRegistrationBoard,
}));

const { GET } = await import("./route");

const EVENTO = "11111111-1111-4111-8111-111111111111";

function participante(over: Partial<RegistrationBoardRow> = {}): RegistrationBoardRow {
  return {
    participantId: "p1",
    registrationId: "r1",
    companyName: "Granja ABC",
    fullName: "João da Silva",
    email: "joao@email.com",
    phone: "11999999999",
    whatsapp: null,
    confirmation: "confirmed",
    present: false,
    checkedInAt: null,
    registeredAt: "2026-09-06T13:30:00Z",
    registrationStatus: "active",
    origin: "landing_page",
    ...over,
  };
}

async function exportar(url = `https://x.test/events/registrations/${EVENTO}/export`) {
  const resposta = await GET(new Request(url), { params: Promise.resolve({ eventId: EVENTO }) });
  return { resposta, texto: await resposta.text() };
}

/** As linhas de dados (sem o BOM e sem o cabeçalho). */
function linhasDe(texto: string): string[] {
  return texto
    .replace(/^\ufeff/, "")
    .split("\r\n")
    .slice(1)
    .filter(Boolean);
}

beforeEach(() => {
  papelAtual = "admin";
  getLandingPageByEvent.mockReset();
  getRegistrationBoard.mockReset();

  getLandingPageByEvent.mockResolvedValue({
    slug: "encontro-tecnico",
    event: { name: "Encontro Técnico" },
  });
  getRegistrationBoard.mockResolvedValue({
    rows: [participante()],
    metrics: { registrations: 1, participants: 1, confirmed: 1, notConfirmed: 0, companies: 1 },
    total: 1,
    page: 1,
    pageSize: 5000,
  });
});

describe("§25 — a permissão é conferida no endpoint", () => {
  /**
   * ⚠️ E O BANCO NÃO É TOCADO. Uma rota que consulta e só depois recusa já
   * revelou, pelo tempo de resposta, que o evento existe.
   */
  it.each([["comercial" as const], ["viewer" as const]])(
    "%s pode ler inscrições? só quem tem registrations.read exporta",
    async (papel) => {
      papelAtual = papel;
      const { resposta } = await exportar();

      // `comercial` TEM `registrations.read` (ver rbac.config.ts) — este caso
      // existe para o dia em que a matriz mudar: se ele perder a leitura, a
      // exportação tem de fechar junto.
      const esperado = papel === "comercial" ? 200 : 403;
      expect(resposta.status).toBe(esperado);
      if (esperado === 403) expect(getRegistrationBoard).not.toHaveBeenCalled();
    },
  );

  it("sem sessão não exporta, e o banco não é consultado", async () => {
    papelAtual = null;
    const { resposta } = await exportar();

    expect(resposta.status).toBe(403);
    expect(getLandingPageByEvent).not.toHaveBeenCalled();
    expect(getRegistrationBoard).not.toHaveBeenCalled();
  });

  it("evento sem página de inscrição responde 404", async () => {
    getLandingPageByEvent.mockResolvedValue(null);
    const { resposta } = await exportar();

    expect(resposta.status).toBe(404);
    expect(getRegistrationBoard).not.toHaveBeenCalled();
  });
});

describe("§18 — o formato do arquivo", () => {
  it("uma linha por participante, com as oito colunas", async () => {
    getRegistrationBoard.mockResolvedValue({
      rows: [
        participante(),
        participante({
          participantId: "p2",
          fullName: "Maria Silva",
          email: "maria@email.com",
          phone: null,
          whatsapp: "11988888888",
          confirmation: "not_confirmed",
        }),
        participante({
          participantId: "p3",
          companyName: "Granja XYZ",
          fullName: "Pedro Souza",
          email: "pedro@email.com",
        }),
      ],
      metrics: { registrations: 2, participants: 3, confirmed: 2, notConfirmed: 1, companies: 2 },
      total: 3,
      page: 1,
      pageSize: 5000,
    });

    const { texto } = await exportar();
    const linhas = linhasDe(texto);

    expect(linhas).toHaveLength(3);
    // A ordem das colunas é a do §18, e o evento vai em TODAS as linhas.
    expect(linhas[0]).toContain("Encontro Técnico;Granja ABC;João da Silva;joao@email.com");
    expect(linhas[1]).toContain("Maria Silva");
    expect(linhas[2]).toContain("Granja XYZ");
  });

  it("o cabeçalho traz as colunas obrigatórias", async () => {
    const { texto } = await exportar();
    const cabecalho = texto.replace(/^\ufeff/, "").split("\r\n")[0] ?? "";

    for (const coluna of [
      "Evento",
      "Granja/Empresa",
      "Participante",
      "E-mail",
      "Telefone",
      "WhatsApp",
      "Confirmado",
      "Data da inscrição",
    ]) {
      expect(cabecalho).toContain(coluna);
    }
  });

  /**
   * ⚠️ "Sim"/"Não", como no exemplo do §18 — e não o rótulo da interface
   * ("Confirmado"/"Não confirmado"). Uma planilha que alguém vai filtrar por
   * coluna precisa de dois valores curtos e opostos.
   */
  it("confirmado vira Sim/Não", async () => {
    getRegistrationBoard.mockResolvedValue({
      rows: [participante(), participante({ participantId: "p2", confirmation: "not_confirmed" })],
      metrics: { registrations: 1, participants: 2, confirmed: 1, notConfirmed: 1, companies: 1 },
      total: 2,
      page: 1,
      pageSize: 5000,
    });

    const linhas = linhasDe((await exportar()).texto);
    expect(linhas[0]).toContain(";Sim;");
    expect(linhas[1]).toContain(";Não;");
  });

  /** O telefone sai em DÍGITOS: é o que serve para importar num disparo. */
  it("o telefone sai sem máscara, e o campo vazio fica vazio", async () => {
    const linhas = linhasDe((await exportar()).texto);
    expect(linhas[0]).toContain("11999999999");
    // WhatsApp nulo vira coluna vazia, e não "null".
    expect(linhas[0]).not.toContain("null");
  });

  /**
   * ⚠️ BOM + CRLF. Sem o BOM, "João" vira "JoÃ£o" ao abrir com dois cliques no
   * Excel em português — e a planilha inteira parece corrompida.
   */
  /**
   * ⚠️ A CONFERÊNCIA É NOS BYTES, E NÃO NO TEXTO — e isso custou um teste falso.
   *
   * `Response.text()` aplica o "UTF-8 decode" da especificação, que REMOVE o BOM
   * antes de devolver a string. Ou seja: `texto.startsWith("\ufeff")` é sempre
   * falso, mesmo quando o BOM está lá. Um teste escrito assim falharia sobre
   * código correto — e, pior, o inverso também vale: se ele fosse escrito para
   * passar, deixaria de conferir a única coisa que importa aqui.
   *
   * O que chega ao navegador são os bytes. EF BB BF é o BOM em UTF-8.
   */
  it("sai com BOM e quebras CRLF", async () => {
    // ⚠️ `GET` DIRETO, e não o helper: o corpo de uma `Response` só pode ser
    // lido UMA vez, e `exportar()` já o consome com `.text()`.
    const resposta = await GET(
      new Request(`https://x.test/events/registrations/${EVENTO}/export`),
      { params: Promise.resolve({ eventId: EVENTO }) },
    );
    const bytes = new Uint8Array(await resposta.arrayBuffer());

    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(resposta.headers.get("Content-Type")).toContain("charset=utf-8");

    const { texto } = await exportar();
    expect(texto).toContain("\r\n");
  });

  /** §20 — `inscricoes_<slug>_<AAAAMMDD>`. */
  it("o nome do arquivo segue o padrão pedido", async () => {
    const { resposta } = await exportar();
    const disposition = resposta.headers.get("Content-Disposition") ?? "";

    expect(disposition).toMatch(/filename="inscricoes_encontro-tecnico_\d{8}\.csv"/);
  });

  /** Um arquivo novo a cada clique: a lista muda a cada inscrição. */
  it("não é cacheado", async () => {
    const { resposta } = await exportar();
    expect(resposta.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("§18 — injeção de fórmula", () => {
  /**
   * ==========================================================================
   * ⚠️ O RISCO É REAL E VEM DE FORA.
   * ==========================================================================
   * O nome da granja e o nome do participante são digitados por quem se
   * inscreve numa página ABERTA na internet (Prompt 3). Alguém pode cadastrar
   * uma "granja" chamada `=HYPERLINK("http://...")` e esperar que a APCS abra a
   * planilha — o Excel executa a célula.
   *
   * O `'` na frente neutraliza sem perder o conteúdo: a célula mostra o texto.
   */
  it.each([["=1+1"], ["+SOMA(A1)"], ["-2"], ["@SUM(A1)"]])(
    "%s é neutralizado com apóstrofo",
    async (nomePerigoso) => {
      getRegistrationBoard.mockResolvedValue({
        rows: [participante({ companyName: nomePerigoso })],
        metrics: { registrations: 1, participants: 1, confirmed: 1, notConfirmed: 0, companies: 1 },
        total: 1,
        page: 1,
        pageSize: 5000,
      });

      const linhas = linhasDe((await exportar()).texto);
      expect(linhas[0]).toContain(`'${nomePerigoso}`);
    },
  );

  /** Ponto e vírgula no nome não pode virar uma coluna nova. */
  it("o separador dentro do texto é escapado com aspas", async () => {
    getRegistrationBoard.mockResolvedValue({
      rows: [participante({ companyName: 'Granja "A"; Filial B' })],
      metrics: { registrations: 1, participants: 1, confirmed: 1, notConfirmed: 0, companies: 1 },
      total: 1,
      page: 1,
      pageSize: 5000,
    });

    const linhas = linhasDe((await exportar()).texto);
    expect(linhas[0]).toContain('"Granja ""A""; Filial B"');
  });
});

describe("§19 — a exportação respeita busca e filtros", () => {
  /**
   * ==========================================================================
   * ⚠️ O CASO DO §19, PALAVRA POR PALAVRA.
   * ==========================================================================
   * "Evento A / Filtro: Confirmados / Busca: Granja ABC → exportar somente os
   * participantes correspondentes ao resultado atual."
   */
  it("busca e filtro da URL chegam ao banco", async () => {
    await exportar(
      `https://x.test/events/registrations/${EVENTO}/export?q=Granja%20ABC&conf=confirmed`,
    );

    const [eventoRecebido, filtros] = getRegistrationBoard.mock.calls[0] ?? [];
    expect(eventoRecebido).toBe(EVENTO);
    expect(filtros.query).toBe("Granja ABC");
    expect(filtros.confirmation).toBe("confirmed");
  });

  /**
   * ⚠️ SEM FILTRO, VAI TUDO — e com um teto MUITO maior que o da tela. Herdar o
   * tamanho da página exportaria vinte e cinco linhas de um evento com
   * trezentas, e o arquivo pareceria completo.
   */
  it("exporta o recorte inteiro, não a página da tela", async () => {
    await exportar(`https://x.test/events/registrations/${EVENTO}/export?page=7`);

    const [, filtros, tamanho] = getRegistrationBoard.mock.calls[0] ?? [];
    expect(filtros.page).toBe(1);
    expect(tamanho).toBeGreaterThan(1000);
  });

  /** §29 — arquivo sem resultados: o cabeçalho sai, e mais nada. */
  it("sem resultados, o arquivo tem só o cabeçalho", async () => {
    getRegistrationBoard.mockResolvedValue({
      rows: [],
      metrics: { registrations: 0, participants: 0, confirmed: 0, notConfirmed: 0, companies: 0 },
      total: 0,
      page: 1,
      pageSize: 5000,
    });

    const { resposta, texto } = await exportar();

    expect(resposta.status).toBe(200);
    expect(linhasDe(texto)).toHaveLength(0);
    expect(texto).toContain("Participante");
  });
});

describe("§25 — a falha não vaza nada", () => {
  it("um erro no meio não escreve dado pessoal no log", async () => {
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    getRegistrationBoard.mockRejectedValue(new Error("falha com joao@email.com no corpo"));

    const { resposta } = await exportar(
      `https://x.test/events/registrations/${EVENTO}/export?q=joao@email.com`,
    );

    expect(resposta.status).toBe(500);

    const escrito = espiao.mock.calls.flat().map(String).join(" | ");
    // Nem o erro completo, nem o termo buscado — que pode ser o e-mail de alguém.
    expect(escrito).not.toContain("joao@email.com");
    espiao.mockRestore();
  });
});
