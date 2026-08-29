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
      expect(isNavItemVisible(item(), papel, hasPermission)).toBe(true);
    }
  });

  it("esconde de quem não tem a permissão", () => {
    expect(isNavItemVisible(item({ permission: "users.manage" }), "admin", hasPermission)).toBe(
      true,
    );
    expect(isNavItemVisible(item({ permission: "users.manage" }), "comercial", hasPermission)).toBe(
      false,
    );
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
      expect(isNavItemVisible(escondido, papel, hasPermission)).toBe(false);
    }
  });

  it("`hidden` também vence quando não há permissão declarada", () => {
    expect(isNavItemVisible(item({ hidden: true }), "admin", hasPermission)).toBe(false);
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
      const visiveis = secao.items.filter((i) => isNavItemVisible(i, "admin", hasPermission));
      expect(visiveis.length, `a seção "${secao.title}" ficou vazia`).toBeGreaterThan(0);
    }
  });
});
