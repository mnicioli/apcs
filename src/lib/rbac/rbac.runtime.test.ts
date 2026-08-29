import { beforeEach, describe, expect, it } from "vitest";
import { hasPermission, permissionsOf, PERMISSION_MATRIX } from "./rbac.config";
import {
  applyRoleDefinitions,
  currentRoleMatrix,
  resetRoleSnapshot,
  type RoleDefinition,
} from "./rbac.runtime";

/**
 * A MATRIZ DE ACESSO PASSOU A VIR DO BANCO, e `hasPermission` continua síncrona.
 *
 * O preço disso é um estado de módulo (o "retrato"), e estes testes cobrem
 * exatamente os pontos em que um estado de módulo costuma errar: o que acontece
 * antes de existir retrato, o que acontece com um retrato vazio, e se uma chave
 * desconhecida abre ou fecha.
 *
 * Ver src/lib/rbac/rbac.runtime.ts e a migration 20260903000100_custom_roles.sql.
 */

function cargo(extra: Partial<RoleDefinition> & { key: string }): RoleDefinition {
  return {
    label: extra.key,
    description: null,
    baseRole: "admin",
    isBuiltin: false,
    sortOrder: 100,
    permissions: [],
    ...extra,
  };
}

beforeEach(() => {
  resetRoleSnapshot();
});

describe("sem retrato — o navegador, um teste, a primeira requisição", () => {
  it("cai na matriz do código", () => {
    expect(currentRoleMatrix()).toBeNull();
    expect(hasPermission("admin", "events.write")).toBe(true);
    expect(hasPermission("comercial", "events.write")).toBe(false);
  });

  /**
   * ⚠️ O CASO QUE JUSTIFICA O `isRole` DENTRO DE `hasPermission`. Sem ele,
   * `PERMISSION_MATRIX[permissao].includes("editor-conteudo")` seria só `false`
   * — o resultado certo por acidente. Com uma permissão cuja lista fosse vazia
   * o acidente continuaria funcionando; o que não funcionaria é o dia em que
   * alguém trocasse `includes` por outra coisa.
   */
  it("um cargo que não é papel do enum é NEGADO", () => {
    expect(hasPermission("editor-conteudo", "documents.read")).toBe(false);
    expect(permissionsOf("editor-conteudo")).toEqual([]);
  });

  it("permissionsOf devolve o que a matriz do código dá ao papel", () => {
    const doAdmin = permissionsOf("admin");
    expect(doAdmin).toContain("users.manage");
    expect(doAdmin.length).toBe(Object.keys(PERMISSION_MATRIX).length);
    expect(permissionsOf("viewer")).toEqual([]);
  });
});

describe("com retrato — o que a APCS editou", () => {
  it("o retrato manda, inclusive quando é mais estreito que o código", () => {
    applyRoleDefinitions([
      cargo({ key: "admin", permissions: ["users.manage", "events.write"], isBuiltin: true }),
      cargo({ key: "editor-conteudo", permissions: ["events.write", "documents.read"] }),
    ]);

    // O código dá 33 permissões ao admin; o retrato dá duas.
    expect(hasPermission("admin", "events.write")).toBe(true);
    expect(hasPermission("admin", "market.write")).toBe(false);

    // E um cargo que o código não conhece funciona.
    expect(hasPermission("editor-conteudo", "events.write")).toBe(true);
    expect(hasPermission("editor-conteudo", "users.manage")).toBe(false);
  });

  /**
   * ⚠️ UM CARGO EXCLUÍDO NÃO PODE CONTINUAR ABRINDO TELA. Se a busca falhasse
   * para o fallback quando a chave não está no retrato, excluir um cargo daria
   * de volta as permissões que o CÓDIGO atribui àquela chave.
   */
  it("cargo fora do retrato é NEGADO, e não devolvido ao código", () => {
    applyRoleDefinitions([cargo({ key: "admin", permissions: ["users.manage"], isBuiltin: true })]);

    expect(hasPermission("comercial", "whatsapp.read")).toBe(false);
    expect(permissionsOf("comercial")).toEqual([]);
  });

  it("retrato VAZIO é recusado e o anterior continua valendo", () => {
    applyRoleDefinitions([cargo({ key: "admin", permissions: ["users.manage"], isBuiltin: true })]);

    expect(applyRoleDefinitions([])).toBe(false);
    expect(hasPermission("admin", "users.manage")).toBe(true);
  });

  it("sem retrato anterior, o vazio também não vira retrato", () => {
    expect(applyRoleDefinitions([])).toBe(false);
    expect(currentRoleMatrix()).toBeNull();
  });
});
