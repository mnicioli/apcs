import { describe, expect, it } from "vitest";
import {
  APPLICATIONS_BASE,
  applicationHref,
  isMembershipId,
  listHref,
  parseApplicationParams,
  parseMemberParams,
} from "./membership.routes";

/**
 * As URLs das telas de Associados.
 *
 * O que estes testes protegem não é a formatação da string: é o COMPORTAMENTO
 * de um endereço colado errado. Um `?status=xyz` tem de mostrar a tela, e um
 * `[id]` que não é uuid tem de virar 404 antes de chegar ao Postgres — sem isso
 * um link velho no WhatsApp aparece como falha do sistema.
 */

describe("isMembershipId", () => {
  it("aceita uuid", () => {
    expect(isMembershipId("11111111-1111-4111-8111-111111111111")).toBe(true);
  });

  it("recusa qualquer outra coisa", () => {
    expect(isMembershipId("nao-e-uuid")).toBe(false);
    expect(isMembershipId("")).toBe(false);
    expect(isMembershipId("11111111-1111-4111-8111")).toBe(false);
  });
});

describe("applicationHref", () => {
  it("monta o endereço do detalhe", () => {
    expect(applicationHref("abc")).toBe("/members/applications/abc");
  });
});

describe("parseApplicationParams", () => {
  it("assume “todas”, busca vazia e primeira página", () => {
    expect(parseApplicationParams({})).toEqual({ status: "all", search: "", page: 1 });
  });

  it("lê uma situação válida", () => {
    expect(parseApplicationParams({ status: "pending" }).status).toBe("pending");
  });

  it("cai em “todas” quando a situação não existe", () => {
    expect(parseApplicationParams({ status: "xyz" }).status).toBe("all");
  });

  it("apara a busca", () => {
    expect(parseApplicationParams({ q: "  silva  " }).search).toBe("silva");
  });

  it("recusa página inválida sem quebrar a tela", () => {
    expect(parseApplicationParams({ page: "0" }).page).toBe(1);
    expect(parseApplicationParams({ page: "-3" }).page).toBe(1);
    expect(parseApplicationParams({ page: "abc" }).page).toBe(1);
    expect(parseApplicationParams({ page: "2.7" }).page).toBe(2);
  });

  it("usa o primeiro valor quando o parâmetro vem repetido", () => {
    expect(parseApplicationParams({ status: ["approved", "pending"] }).status).toBe("approved");
  });
});

describe("parseMemberParams", () => {
  it("lê a situação do associado", () => {
    expect(parseMemberParams({ status: "inactive" }).status).toBe("inactive");
  });

  it("ignora uma situação de solicitação — são enums diferentes", () => {
    expect(parseMemberParams({ status: "pending" }).status).toBe("all");
  });
});

describe("listHref", () => {
  const atual = { status: "pending", search: "silva", page: 3 };

  it("preserva o que já estava aplicado", () => {
    expect(listHref(APPLICATIONS_BASE, atual, { page: 4 })).toBe(
      "/members/applications?status=pending&q=silva&page=4",
    );
  });

  it("trocar de situação volta para a página 1", () => {
    expect(listHref(APPLICATIONS_BASE, atual, { status: "approved" })).toBe(
      "/members/applications?status=approved&q=silva",
    );
  });

  it("trocar a busca volta para a página 1", () => {
    expect(listHref(APPLICATIONS_BASE, atual, { search: "souza" })).toBe(
      "/members/applications?status=pending&q=souza",
    );
  });

  it("omite o que é padrão", () => {
    expect(listHref(APPLICATIONS_BASE, { status: "all", search: "", page: 1 }, {})).toBe(
      "/members/applications",
    );
  });

  it("escapa o termo de busca", () => {
    expect(listHref(APPLICATIONS_BASE, { status: "all", search: "a&b=c", page: 1 }, {})).toBe(
      "/members/applications?q=a%26b%3Dc",
    );
  });
});
