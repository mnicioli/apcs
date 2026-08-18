import { describe, expect, it } from "vitest";
import {
  DEFAULT_SURVEY_PAGE_SIZE,
  MAX_SURVEY_PAGE_SIZE,
  isSurveyFiltered,
  isSurveyId,
  parseSurveyFilters,
  parseSurveyPage,
  parseSurveySort,
  surveyEditHref,
  surveyExportHref,
  surveyHref,
  surveyResultsHref,
  surveysHref,
  surveysResultsHref,
} from "./survey.routes";

/**
 * O ESTADO DE TELA que viaja na URL (§4, §5, §6, §7, §59).
 *
 * ⚠️ O que estes testes protegem, acima de tudo: **um parâmetro colado errado
 * nunca vira consulta**. Filtro, ordenação e página são lidos de texto que veio
 * de fora — a barra de endereço é entrada do usuário como qualquer outra.
 */

const UUID = "540f509f-ccd2-4cd6-9dc9-994fe072f14c";

describe("isSurveyId", () => {
  it("aceita uuid, em maiúscula ou minúscula", () => {
    expect(isSurveyId(UUID)).toBe(true);
    expect(isSurveyId(UUID.toUpperCase())).toBe(true);
  });

  it("recusa o que não é uuid", () => {
    // Sem esta checagem, `/surveys/results-antigo` iria ao banco, o Postgres
    // recusaria com "invalid input syntax for type uuid" e a pessoa veria a tela
    // de FALHA DO SISTEMA para o que é só um endereço que não existe.
    expect(isSurveyId("results")).toBe(false);
    expect(isSurveyId("")).toBe(false);
    expect(isSurveyId("540f509f-ccd2-4cd6-9dc9")).toBe(false);
    expect(isSurveyId(`${UUID} or 1=1`)).toBe(false);
    expect(isSurveyId("'; drop table surveys; --")).toBe(false);
  });
});

describe("os endereços", () => {
  it("cada tela tem o seu", () => {
    expect(surveyHref(UUID)).toBe(`/surveys/${UUID}`);
    expect(surveyEditHref(UUID)).toBe(`/surveys/${UUID}/edit`);
    expect(surveyResultsHref(UUID)).toBe(`/surveys/${UUID}/results`);
    expect(surveyExportHref(UUID)).toBe(`/surveys/${UUID}/results/export`);
  });

  it("a listagem sem filtro é o caminho limpo", () => {
    expect(surveysHref()).toBe("/surveys");
    expect(surveysResultsHref()).toBe("/surveys/results");
  });
});

describe("parseSurveyFilters (§4, §5)", () => {
  it("lê o que está preenchido", () => {
    const f = parseSurveyFilters({
      q: "suíno",
      status: "active",
      region: "sp",
      profile: "producer",
    });

    expect(f.query).toBe("suíno");
    expect(f.status).toBe("active");
    // A UF sobe para maiúscula: é assim que ela está gravada nos critérios.
    expect(f.region).toBe("SP");
    expect(f.profile).toBe("producer");
  });

  it("um valor fora da lista vira SEM FILTRO, e não uma lista vazia", () => {
    // Uma URL quebrada não deve parecer "não há nada aqui" — e um valor
    // arbitrário nunca chega ao SQL.
    const f = parseSurveyFilters({ status: "excluida", profile: "extraterrestre", region: "SP1" });
    expect(f.status).toBeUndefined();
    expect(f.profile).toBeUndefined();
    expect(f.region).toBeUndefined();
  });

  it("recusa injeção no lugar de um status", () => {
    const f = parseSurveyFilters({ status: "active'; drop table surveys; --" });
    expect(f.status).toBeUndefined();
  });

  it("recusa data que não é data", () => {
    expect(parseSurveyFilters({ from: "ontem" }).from).toBeUndefined();
    expect(parseSurveyFilters({ from: "2026-08-14T00:00:00Z" }).from).toBe("2026-08-14T00:00:00Z");
  });

  it("corta uma busca absurdamente longa", () => {
    const f = parseSurveyFilters({ q: "a".repeat(500) });
    expect(f.query?.length).toBe(120);
  });

  it("array de valores usa o primeiro", () => {
    expect(parseSurveyFilters({ status: ["active", "closed"] }).status).toBe("active");
  });

  it("sem parâmetro nenhum, nenhum filtro", () => {
    expect(parseSurveyFilters({})).toEqual({});
    expect(isSurveyFiltered({})).toBe(false);
  });
});

describe("isSurveyFiltered", () => {
  it("qualquer filtro preenchido conta", () => {
    expect(isSurveyFiltered({ query: "x" })).toBe(true);
    expect(isSurveyFiltered({ status: "draft" })).toBe(true);
    expect(isSurveyFiltered({ region: "SP" })).toBe(true);
    expect(isSurveyFiltered({ profile: "producer" })).toBe(true);
    expect(isSurveyFiltered({ from: "2026-01-01T00:00:00Z" })).toBe(true);
  });

  it("busca só com espaços não conta como filtro", () => {
    // Senão o vazio "nenhuma enquete encontrada para os filtros" apareceria sem
    // que exista filtro nenhum para limpar.
    expect(isSurveyFiltered({ query: "   " })).toBe(false);
  });
});

describe("a ida e a volta dos filtros", () => {
  it("o que sai na URL volta igual", () => {
    const original = {
      query: "arroba",
      status: "active" as const,
      region: "PR",
      profile: "member",
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-31T23:59:59.999Z",
    };

    const url = surveysHref({ filters: original });
    const params = Object.fromEntries(new URL(url, "http://x").searchParams);

    expect(parseSurveyFilters(params)).toEqual(original);
  });

  it("a grid e os resultados falam a MESMA URL (§59)", () => {
    const filters = { status: "active" as const, region: "SP" };
    const grid = new URL(surveysHref({ filters }), "http://x").search;
    const resultados = new URL(surveysResultsHref({ filters }), "http://x").search;

    // É isto que faz o recorte sobreviver à troca de tela.
    expect(grid).toBe(resultados);
  });
});

describe("parseSurveySort (§7)", () => {
  it("o padrão é a criação, do mais recente", () => {
    const s = parseSurveySort({});
    expect(s.field).toBe("createdAt");
    expect(s.ascending).toBe(false);
  });

  it("aceita os campos declarados e recusa o resto", () => {
    expect(parseSurveySort({ sort: "title", dir: "asc" })).toEqual({
      field: "title",
      ascending: true,
    });
    // Um campo inventado não pode virar `order by` — cairia no SQL.
    expect(parseSurveySort({ sort: "senha" }).field).toBe("createdAt");
  });

  it("a ordenação padrão não suja a URL", () => {
    expect(surveysHref({ sort: { field: "createdAt", ascending: false } })).toBe("/surveys");
    expect(surveysHref({ sort: { field: "title", ascending: false } })).toBe("/surveys?sort=title");
  });
});

describe("parseSurveyPage (§6)", () => {
  it("o padrão é a primeira página", () => {
    expect(parseSurveyPage({})).toEqual({ page: 1, pageSize: DEFAULT_SURVEY_PAGE_SIZE });
  });

  it("recusa página que não é número inteiro positivo", () => {
    expect(parseSurveyPage({ page: "0" }).page).toBe(1);
    expect(parseSurveyPage({ page: "-3" }).page).toBe(1);
    expect(parseSurveyPage({ page: "1.5" }).page).toBe(1);
    expect(parseSurveyPage({ page: "abc" }).page).toBe(1);
  });

  it("limita o tamanho da página", () => {
    // Sem teto, `?size=100000` viraria um dump da tabela inteira numa requisição.
    expect(parseSurveyPage({ size: "999999" }).pageSize).toBe(DEFAULT_SURVEY_PAGE_SIZE);
    expect(parseSurveyPage({ size: String(MAX_SURVEY_PAGE_SIZE) }).pageSize).toBe(
      MAX_SURVEY_PAGE_SIZE,
    );
    expect(parseSurveyPage({ size: "50" }).pageSize).toBe(50);
  });

  it("a primeira página não suja a URL", () => {
    expect(surveysHref({ page: 1 })).toBe("/surveys");
    expect(surveysHref({ page: 3 })).toBe("/surveys?page=3");
  });
});
