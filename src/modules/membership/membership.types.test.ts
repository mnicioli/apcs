import { describe, expect, it } from "vitest";
import {
  ASSOCIATE_PROFILE_TYPES,
  isAssociateProfile,
  MEMBERSHIP_PROFILE_TYPES,
} from "./membership.types";
import { MEMBERSHIP_PROFILE_TYPE_LABELS } from "./membership.labels";

/**
 * "Quem é associado?" — a pergunta que a unificação dos perfis criou.
 *
 * Antes havia duas taxonomias (`membership_profile_type` e `event_segments`)
 * sem mapeamento entre elas, e ninguém conseguia responder isto. Agora a
 * resposta é uma leitura do perfil, e não uma coluna que poderia contradizê-lo.
 * Estes testes existem para que o dia em que um quinto perfil entrar, quem o
 * acrescentar seja obrigado a decidir de que lado ele cai.
 */
describe("perfis de associado", () => {
  it("tem exatamente os quatro perfis unificados", () => {
    expect(MEMBERSHIP_PROFILE_TYPES).toEqual(["criador", "empresa", "tecnico", "universidade"]);
  });

  it("três são associados; universidade não é", () => {
    expect(ASSOCIATE_PROFILE_TYPES).toEqual(["criador", "empresa", "tecnico"]);
    expect(isAssociateProfile("criador")).toBe(true);
    expect(isAssociateProfile("empresa")).toBe(true);
    expect(isAssociateProfile("tecnico")).toBe(true);
    expect(isAssociateProfile("universidade")).toBe(false);
  });

  /**
   * ⚠️ Perfil ausente NÃO é associado.
   *
   * `members.profile_type` é anulável — a carga do cadastro legado traz linhas
   * sem perfil. Ler `null` como associado inflaria qualquer contagem e, pior,
   * incluiria alguém numa comunicação de associado sem que ninguém tivesse
   * afirmado que ele é um.
   */
  it("perfil ausente não é associado", () => {
    expect(isAssociateProfile(null)).toBe(false);
  });

  /**
   * O `Record` de rótulos é a rede que pega um valor novo vindo do Postgres:
   * `pnpm db:types` acrescenta o valor ao enum, o `Record` fica incompleto e o
   * type-check quebra. Este teste cobre a outra ponta — que a lista e os
   * rótulos não divirjam em quantidade.
   */
  it("todo perfil tem rótulo", () => {
    for (const perfil of MEMBERSHIP_PROFILE_TYPES) {
      expect(MEMBERSHIP_PROFILE_TYPE_LABELS[perfil]).toBeTruthy();
    }
    expect(Object.keys(MEMBERSHIP_PROFILE_TYPE_LABELS)).toHaveLength(
      MEMBERSHIP_PROFILE_TYPES.length,
    );
  });
});
