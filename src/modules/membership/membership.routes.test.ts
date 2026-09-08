import { describe, expect, it } from "vitest";
import {
  APPLICATIONS_BASE,
  applicationHref,
  isMembershipId,
  listHref,
  memberHref,
  memberSortHref,
  memberSortParams,
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

/**
 * A ORDEM DA LISTA DE ASSOCIADOS.
 *
 * O que estes testes seguram é a promessa da tela: quem abre `/members` vê os
 * nomes de A a Z. O padrão está em dois lugares que precisam concordar — o
 * parser (o que a tela mostra sem parâmetro nenhum) e o montador de URL (o que
 * ele considera "padrão" e portanto omite). Se um mudar sem o outro, o endereço
 * `/members` passa a mostrar uma ordem e o link "Nome" outra.
 */
describe("ordenação de associados", () => {
  it("sem parâmetro nenhum, é nome de A a Z", () => {
    expect(parseMemberParams({})).toMatchObject({ sort: { field: "name", ascending: true } });
  });

  it("lê o critério e o sentido da URL", () => {
    expect(parseMemberParams({ sort: "joinedAt", dir: "asc" }).sort).toEqual({
      field: "joinedAt",
      ascending: true,
    });
  });

  it("cada critério tem seu sentido natural quando o `dir` não vem", () => {
    // Data sem sentido declarado é o mais recente primeiro; nome é A→Z.
    expect(parseMemberParams({ sort: "joinedAt" }).sort.ascending).toBe(false);
    expect(parseMemberParams({ sort: "name" }).sort.ascending).toBe(true);
  });

  it("um critério inventado cai no padrão em vez de virar erro", () => {
    // ⚠️ Este valor viraria NOME DE COLUNA no service. Cair no padrão aqui é o
    // que impede `?sort=` de chegar ao Postgres.
    expect(parseMemberParams({ sort: "full_name; drop table" }).sort.field).toBe("name");
    expect(parseMemberParams({ dir: "xyz" }).sort.ascending).toBe(true);
  });

  it("a ordem padrão não suja a URL", () => {
    expect(memberSortParams({ field: "name", ascending: true })).toEqual([]);
  });

  it("o sentido natural do critério também não", () => {
    expect(memberSortParams({ field: "joinedAt", ascending: false })).toEqual([
      { name: "sort", value: "joinedAt" },
    ]);
  });

  it("só o que foge do padrão vira parâmetro", () => {
    expect(memberSortParams({ field: "name", ascending: false })).toEqual([
      { name: "dir", value: "desc" },
    ]);
  });

  it("clicar no critério ativo inverte o sentido", () => {
    const params = parseMemberParams({});
    expect(memberSortHref(params, "name")).toBe("/members?dir=desc");
  });

  it("clicar em outro critério começa pelo sentido natural dele", () => {
    const params = parseMemberParams({});
    expect(memberSortHref(params, "joinedAt")).toBe("/members?sort=joinedAt");
  });

  it("trocar a ordem preserva o recorte e volta para a primeira página", () => {
    const params = parseMemberParams({ status: "active", q: "silva", page: "4" });
    expect(memberSortHref(params, "joinedAt")).toBe("/members?status=active&q=silva&sort=joinedAt");
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

describe("memberHref", () => {
  it("monta o endereço da ficha do associado", () => {
    expect(memberHref("11111111-1111-4111-8111-111111111111")).toBe(
      "/members/11111111-1111-4111-8111-111111111111",
    );
  });

  /**
   * ⚠️ O TESTE QUE PARECE BOBO E NÃO É. `/members/[id]` e `/members/applications`
   * são rotas irmãs: se alguém trocar `APPLICATIONS_BASE` por algo que a rota
   * dinâmica engula, a caixa de entrada vira "uma ficha de associado com id
   * inválido" — 404 no lugar da tela que o time usa todo dia.
   */
  it("não colide com a caixa de entrada de solicitações", () => {
    expect(APPLICATIONS_BASE).toBe("/members/applications");
    expect(isMembershipId("applications")).toBe(false);
  });
});
