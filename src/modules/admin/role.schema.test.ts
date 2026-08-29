import { describe, expect, it } from "vitest";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { ALL_PERMISSIONS } from "@/lib/rbac/rbac.labels";
import {
  createRoleSchema,
  setUserRoleKeySchema,
  suggestRoleKey,
  updateRoleSchema,
} from "./role.schema";

/**
 * Os contratos de entrada dos CARGOS.
 *
 * ⚠️ O que estes testes NÃO provam: a regra central. "Um cargo só tira do
 * papel-base, nunca acrescenta" vive no trigger `app_role_permission_guard`, no
 * Postgres, porque depende de consultar o teto — coisa que um schema não sabe.
 * Aqui se prova o formato; a migration 20260903000100 prova o resto.
 */

const ID = "11111111-1111-4111-8111-111111111111";

const VALIDO = {
  key: "editor-conteudo",
  label: "Editor de Conteúdo",
  description: "Publica normativas, eventos e enquetes. Não mexe em pessoas.",
  baseRole: "admin" as const,
  permissions: ["documents.read", "documents.write"],
};

describe("createRoleSchema", () => {
  it("aceita um cargo completo", () => {
    expect(createRoleSchema.safeParse(VALIDO).success).toBe(true);
  });

  /**
   * ⚠️ CARGO SEM PERMISSÃO NENHUMA É VÁLIDO, e o teste existe para ninguém
   * "consertar" isso. É exatamente o Visualização: a pessoa entra, aparece no
   * diretório interno e não abre módulo nenhum.
   */
  it("aceita cargo sem permissão nenhuma", () => {
    expect(createRoleSchema.safeParse({ ...VALIDO, permissions: [] }).success).toBe(true);
  });

  it("recusa uma permissão que não existe", () => {
    const r = createRoleSchema.safeParse({ ...VALIDO, permissions: ["banco.esvaziar"] });
    expect(r.success).toBe(false);
  });

  it("recusa um papel-base que não é papel do sistema", () => {
    expect(createRoleSchema.safeParse({ ...VALIDO, baseRole: "chefe" }).success).toBe(false);
  });

  /**
   * ⚠️ AS MESMAS REGRAS DO CHECK `app_roles_key_format`. A chave aparece em
   * URL, em log e na trilha — um espaço ou um acento aqui vira um identificador
   * que ninguém consegue procurar depois.
   */
  it("recusa chaves que o banco recusaria", () => {
    // "Editor" NÃO está na lista: maiúscula é normalizada, não recusada — ver o
    // teste logo abaixo. Recusar o que dá para consertar sozinho é grosseria.
    for (const ruim of ["", "a", "3-turno", "editor conteudo", "editor_conteudo", "-x"]) {
      expect(createRoleSchema.safeParse({ ...VALIDO, key: ruim }).success, ruim).toBe(false);
    }
  });

  it("normaliza a chave para minúsculas e sem espaço em volta", () => {
    const r = createRoleSchema.safeParse({ ...VALIDO, key: "  Editor-Conteudo  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.key).toBe("editor-conteudo");
  });

  it("exige um nome", () => {
    expect(createRoleSchema.safeParse({ ...VALIDO, label: " " }).success).toBe(false);
  });

  it("descrição vazia vira ausente, e não string vazia", () => {
    const r = createRoleSchema.safeParse({ ...VALIDO, description: "   " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.description).toBeUndefined();
  });
});

describe("updateRoleSchema", () => {
  /**
   * ⚠️ NÃO TEM `baseRole`, E A AUSÊNCIA É A REGRA. Trocar o papel-base de um
   * cargo mudaria em silêncio o que a RLS entrega a todo mundo que já o tem — a
   * mesma pessoa, no mesmo cargo, lendo outras tabelas sem nada na tela dizer
   * isso. A garantia está na ASSINATURA: não existe o campo.
   */
  it("não aceita trocar o papel-base", () => {
    const r = updateRoleSchema.safeParse({ ...VALIDO, baseRole: "comercial" });
    expect(r.success).toBe(true);
    if (r.success) expect("baseRole" in r.data).toBe(false);
  });
});

describe("setUserRoleKeySchema", () => {
  it("aceita um cargo criado pela APCS, e não só os embutidos", () => {
    expect(setUserRoleKeySchema.safeParse({ userId: ID, roleKey: "secretaria" }).success).toBe(
      true,
    );
    expect(setUserRoleKeySchema.safeParse({ userId: ID, roleKey: "admin" }).success).toBe(true);
  });

  it("recusa um id que não é uuid", () => {
    expect(setUserRoleKeySchema.safeParse({ userId: "abc", roleKey: "admin" }).success).toBe(false);
  });
});

describe("suggestRoleKey", () => {
  it("tira acento, espaço e maiúscula", () => {
    expect(suggestRoleKey("Secretaria Executiva")).toBe("secretaria-executiva");
    expect(suggestRoleKey("Comunicação")).toBe("comunicacao");
  });

  /** O CHECK do banco exige começar por letra. */
  it("nunca começa por número ou hífen", () => {
    expect(suggestRoleKey("3º Turno")).toBe("turno");
    expect(suggestRoleKey("--- Diretoria ---")).toBe("diretoria");
  });

  it("o que ela sugere é aceito pelo schema", () => {
    for (const nome of ["Secretaria Executiva", "Comunicação", "Bolsa & Mercado", "3º Turno"]) {
      const chave = suggestRoleKey(nome);
      expect(createRoleSchema.safeParse({ ...VALIDO, key: chave }).success, nome).toBe(true);
    }
  });
});

describe("as mensagens de erro dos cargos", () => {
  /**
   * ⚠️ A MENSAGEM DE `roleAboveCeiling` PRECISA EXPLICAR A REGRA INTEIRA, e não
   * só dizer "não pode". Ela é a única pista de que o caminho existe: escolher
   * outro papel-base. Sem isso, quem esbarrar nela vai concluir que a permissão
   * está quebrada.
   */
  it("dizem o que fazer, e não só o que deu errado", () => {
    expect(ACTION_ERROR_MESSAGES.roleAboveCeiling).toMatch(/papel-base/i);
    expect(ACTION_ERROR_MESSAGES.roleInUse).toMatch(/antes de excluí-lo/i);
    expect(ACTION_ERROR_MESSAGES.roleBuiltinLocked).toMatch(/cargo novo/i);
    expect(ACTION_ERROR_MESSAGES.lastUserManager).toMatch(/outra pessoa/i);
  });
});

describe("o vocabulário de permissões", () => {
  /**
   * ⚠️ O SCHEMA VALIDA CONTRA `ALL_PERMISSIONS`, que é derivada dos grupos da
   * matriz. Se essa lista ficasse incompleta, uma permissão nova simplesmente
   * não poderia ser dada a nenhum cargo — e o sintoma seria "marquei a caixa e
   * ela não salva", sem erro nenhum no console.
   */
  it("toda permissão da matriz é aceita num cargo", () => {
    const r = createRoleSchema.safeParse({ ...VALIDO, permissions: [...ALL_PERMISSIONS] });
    expect(r.success).toBe(true);
  });
});
