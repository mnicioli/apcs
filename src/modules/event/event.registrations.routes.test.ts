import { describe, expect, it } from "vitest";
import {
  eventRegistrationsHref,
  hasActiveFilters,
  parseRegistrationFilters,
  registrationsExportHref,
  registrationsHref,
} from "./event.registrations.routes";
import {
  EMPTY_REGISTRATION_BOARD_FILTERS,
  type RegistrationBoardFilters,
} from "./event.landing.types";

/**
 * A SERIALIZAÇÃO DOS FILTROS — e a propriedade que faz o §19 valer.
 *
 * ============================================================================
 * ⚠️ `parse` E `href` PRECISAM SER INVERSAS. É isso que garante que o botão
 * "Exportar" leve exatamente o recorte que está na tela.
 * ============================================================================
 * O modo de falhar, se elas divergirem, é silencioso e é o pior possível:
 * exportar um arquivo que não corresponde ao que se está vendo. Ninguém confere
 * linha por linha um CSV de trezentas pessoas — a planilha simplesmente vira a
 * verdade, e ela estaria errada.
 */

const EVENTO = "11111111-1111-4111-8111-111111111111";

function filtros(over: Partial<RegistrationBoardFilters> = {}): RegistrationBoardFilters {
  return { ...EMPTY_REGISTRATION_BOARD_FILTERS, ...over };
}

/** Extrai só a query string de um endereço, para reentrar em `parse`. */
function relerDe(href: string): RegistrationBoardFilters {
  const url = new URL(href, "https://exemplo.test");
  return parseRegistrationFilters(Object.fromEntries(url.searchParams));
}

describe("ida e volta", () => {
  it.each([
    ["sem nada", filtros()],
    ["só busca", filtros({ query: "Granja ABC" })],
    ["só confirmação", filtros({ confirmation: "not_confirmed" })],
    ["só período", filtros({ from: "2026-09-01", to: "2026-09-30" })],
    ["ordenação", filtros({ sort: "company" })],
    ["página", filtros({ page: 4 })],
    [
      "tudo junto",
      filtros({
        query: "joao@email.com",
        confirmation: "confirmed",
        from: "2026-09-01",
        to: "2026-09-30",
        sort: "participant",
        page: 3,
      }),
    ],
  ])("%s sobrevive à ida e à volta", (_nome, entrada) => {
    expect(relerDe(eventRegistrationsHref(EVENTO, entrada))).toEqual(entrada);
  });

  /**
   * ⚠️ O ENDEREÇO LIMPO NÃO CARREGA PARÂMETRO NENHUM. Não é estética: um
   * `?conf=all&sort=recent&page=1` colado numa conversa sugere que há um filtro
   * aplicado quando não há.
   */
  it("o padrão não aparece na URL", () => {
    expect(eventRegistrationsHref(EVENTO, filtros())).toBe(`/events/registrations/${EVENTO}`);
    expect(registrationsHref()).toBe("/events/registrations");
  });
});

describe("§19 — a exportação leva o mesmo recorte", () => {
  /**
   * ==========================================================================
   * ⚠️ O CASO QUE O §19 DESCREVE, PALAVRA POR PALAVRA.
   * ==========================================================================
   * "Evento: Evento A / Filtro: Confirmados / Busca: Granja ABC → deve exportar
   * somente os participantes correspondentes ao resultado atual."
   */
  it("busca e filtro chegam iguais na exportação", () => {
    const atual = filtros({ query: "Granja ABC", confirmation: "confirmed" });

    const exportacao = registrationsExportHref(EVENTO, atual);
    const lido = relerDe(exportacao);

    expect(exportacao.startsWith(`/events/registrations/${EVENTO}/export`)).toBe(true);
    expect(lido.query).toBe("Granja ABC");
    expect(lido.confirmation).toBe("confirmed");
  });

  /**
   * ⚠️ A PÁGINA NÃO VAI JUNTO, e é deliberado. A exportação leva o recorte
   * inteiro; se ela herdasse `page=3`, quem clicasse estando na terceira página
   * baixaria vinte e cinco linhas em vez das trezentas — e o arquivo pareceria
   * completo.
   */
  it("a página atual não vai para a exportação", () => {
    const href = registrationsExportHref(EVENTO, filtros({ page: 7, query: "abc" }));
    expect(href).not.toContain("page=");
    expect(relerDe(href).page).toBe(1);
  });
});

describe("uma URL colada errada não quebra a tela", () => {
  /**
   * ⚠️ VALOR DESCONHECIDO CAI NO PADRÃO, e não em lista vazia. Uma URL de uma
   * versão anterior do sistema — ou digitada à mão — não deve parecer "não há
   * inscrições neste evento", que é a conclusão que alguém tiraria de uma grid
   * vazia sem explicação.
   */
  it.each([
    ["confirmação inventada", { conf: "talvez" }],
    ["ordenação inventada", { sort: "; drop table" }],
    ["página negativa", { page: "-3" }],
    ["página que não é número", { page: "abc" }],
    ["data mal formada", { from: "01/09/2026" }],
  ])("%s cai no padrão", (_nome, params) => {
    const lido = parseRegistrationFilters(params);
    expect(lido.confirmation).toBe("all");
    expect(lido.sort).toBe("recent");
    expect(lido.page).toBeGreaterThan(0);
    expect(lido.from === "" || /^\d{4}-\d{2}-\d{2}$/.test(lido.from)).toBe(true);
  });

  /**
   * ⚠️ A DATA É VALIDADA PORQUE ELA ENTRA NUMA CONSULTA. O driver parametriza
   * (não há injeção possível), mas um texto que não é data faria o Postgres
   * recusar a chamada inteira — e a tela quebraria por causa de um caractere
   * colado na URL.
   */
  it("data em formato brasileiro é descartada, não repassada", () => {
    expect(parseRegistrationFilters({ from: "01/09/2026", to: "30/09/2026" }).from).toBe("");
  });

  /** O mesmo parâmetro repetido: fica o primeiro, e a tela não quebra. */
  it("parâmetro repetido não confunde", () => {
    expect(parseRegistrationFilters({ q: ["primeiro", "segundo"] }).query).toBe("primeiro");
  });
});

describe("hasActiveFilters", () => {
  /**
   * ⚠️ ORDENAÇÃO E PÁGINA NÃO CONTAM COMO FILTRO. É o que decide entre "ainda
   * não existem inscrições para este evento" e "nenhuma inscrição encontrada"
   * (§27) — e trocar as duas faz alguém concluir que o sistema perdeu os dados.
   * Estar na página 2 de um evento vazio não é um filtro ativo.
   */
  it("só busca, confirmação e período contam", () => {
    expect(hasActiveFilters(filtros())).toBe(false);
    expect(hasActiveFilters(filtros({ sort: "company", page: 3 }))).toBe(false);

    expect(hasActiveFilters(filtros({ query: "x" }))).toBe(true);
    expect(hasActiveFilters(filtros({ confirmation: "confirmed" }))).toBe(true);
    expect(hasActiveFilters(filtros({ from: "2026-09-01" }))).toBe(true);
  });

  it("busca só com espaços não é filtro", () => {
    expect(hasActiveFilters(filtros({ query: "   " }))).toBe(false);
  });
});
