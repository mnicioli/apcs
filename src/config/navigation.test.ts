import { describe, expect, it } from "vitest";
import { Inbox } from "lucide-react";
import { isNavItemVisible, NAV_SECTIONS, type NavItem } from "./navigation";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { VALID_ROLES } from "@/lib/rbac/rbac.types";

/**
 * A navegação é configuração, e configuração erra em silêncio: um item mal
 * declarado não quebra nada — ele simplesmente não aparece, ou aparece para
 * quem não deveria. Estes testes cobrem as duas formas.
 */

function item(extra: Partial<NavItem> = {}): NavItem {
  return { title: "X", href: "/x", icon: Inbox, available: true, ...extra };
}

describe("isNavItemVisible", () => {
  it("mostra item sem permissão declarada para qualquer papel", () => {
    for (const papel of VALID_ROLES) {
      expect(isNavItemVisible(item(), (perm) => hasPermission(papel, perm))).toBe(true);
    }
  });

  it("esconde de quem não tem a permissão", () => {
    expect(
      isNavItemVisible(item({ permission: "users.manage" }), (p) => hasPermission("admin", p)),
    ).toBe(true);
    expect(
      isNavItemVisible(item({ permission: "users.manage" }), (p) => hasPermission("comercial", p)),
    ).toBe(false);
  });

  /**
   * ⚠️ ESTE É O TESTE QUE JUSTIFICA A FUNÇÃO EXISTIR.
   *
   * `hidden` vence a permissão, inclusive para administrador. Escrita na ordem
   * inversa — permissão primeiro, `hidden` depois —, a condição continuaria
   * "funcionando" na maioria dos casos e falharia exatamente no caso do admin,
   * que é quem mais olha o menu.
   */
  it("esconde item marcado como `hidden` MESMO de quem tem permissão", () => {
    const escondido = item({ permission: "users.manage", hidden: true });
    for (const papel of VALID_ROLES) {
      expect(isNavItemVisible(escondido, (perm) => hasPermission(papel, perm))).toBe(false);
    }
  });

  it("`hidden` também vence quando não há permissão declarada", () => {
    expect(isNavItemVisible(item({ hidden: true }), (p) => hasPermission("admin", p))).toBe(false);
  });
});

describe("o menu declarado", () => {
  const todos = NAV_SECTIONS.flatMap((secao) => secao.items);

  it("não repete endereço", () => {
    const hrefs = todos.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("todo item tem título e endereço interno", () => {
    for (const i of todos) {
      expect(i.title.length).toBeGreaterThan(0);
      expect(i.href.startsWith("/")).toBe(true);
    }
  });

  /**
   * ⚠️ ITEM ESCONDIDO MANTÉM A PERMISSÃO DECLARADA. É o que faz "voltar ao
   * menu" ser apagar uma linha: sem a permissão, desesconder traria o item de
   * volta visível para todo mundo, inclusive para quem não pode abrir a tela.
   */
  it("todo item escondido continua declarando sua permissão", () => {
    for (const i of todos.filter((x) => x.hidden)) {
      expect(i.permission, `${i.title} está escondido e sem permissão`).toBeTruthy();
    }
  });

  it("nenhuma seção fica sem item visível para o administrador", () => {
    for (const secao of NAV_SECTIONS) {
      const visiveis = secao.items.filter((i) =>
        isNavItemVisible(i, (p) => hasPermission("admin", p)),
      );
      expect(visiveis.length, `a seção "${secao.title}" ficou vazia`).toBeGreaterThan(0);
    }
  });
});

/**
 * O menu passou a nascer recolhido (menos Geral e Atendimento). Estes testes
 * cobrem o que o recolhimento pode quebrar em silêncio.
 */
describe("seções recolhíveis", () => {
  it("Atendimento nasce aberta — é a tela que fica no ar o dia inteiro", () => {
    const atendimento = NAV_SECTIONS.find((s) => s.title === "Atendimento");
    expect(atendimento?.defaultOpen).toBe(true);
  });

  it("as demais nascem recolhidas", () => {
    for (const secao of NAV_SECTIONS) {
      if (secao.title === "Geral" || secao.title === "Atendimento") continue;
      expect(secao.defaultOpen, `a seção "${secao.title}" nasceria aberta`).not.toBe(true);
    }
  });

  /**
   * ⚠️ O TÍTULO VIRA A CHAVE de armazenamento da preferência e o `id` do
   * `aria-controls`. Dois títulos iguais fariam abrir uma abrir a outra junto,
   * e dois elementos com o mesmo `id` quebram a navegação por leitor de tela.
   */
  it("não repete título de seção", () => {
    const titulos = NAV_SECTIONS.map((s) => s.title);
    expect(new Set(titulos).size).toBe(titulos.length);
  });
});
