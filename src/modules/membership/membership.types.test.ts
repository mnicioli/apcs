import { describe, expect, it } from "vitest";
import {
  ASSOCIATE_PROFILE_TYPES,
  isAssociateProfile,
  MEMBERSHIP_PROFILE_TYPES,
  PUBLIC_PROFILE_TYPES,
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
  it("tem os cinco perfis do cadastro", () => {
    expect(MEMBERSHIP_PROFILE_TYPES).toEqual([
      "criador",
      "empresa",
      "tecnico",
      "universidade",
      "interno",
    ]);
  });

  /**
   * ⚠️ ESTE TESTE COBROU A DECISÃO, E ELA FOI TOMADA AQUI.
   *
   * O comentário do topo prometia: "o dia em que um quinto perfil entrar, quem
   * o acrescentar é obrigado a decidir de que lado ele cai". O quinto entrou —
   * `interno`, o Time Interno APCS — e a decisão é que ele **não é associado**,
   * pelo mesmo motivo que `universidade` não é: ele existe para a APCS
   * conseguir falar com um grupo, não porque esse grupo pagou anuidade.
   *
   * A consequência prática, que é o que importa: o time interno não entra em
   * contagem de associados, não aparece em indicador de base e não recebe
   * comunicação de sócio.
   */
  it("três são associados; universidade e time interno não são", () => {
    expect(ASSOCIATE_PROFILE_TYPES).toEqual(["criador", "empresa", "tecnico"]);
    expect(isAssociateProfile("criador")).toBe(true);
    expect(isAssociateProfile("empresa")).toBe(true);
    expect(isAssociateProfile("tecnico")).toBe(true);
    expect(isAssociateProfile("universidade")).toBe(false);
    expect(isAssociateProfile("interno")).toBe(false);
  });

  /**
   * ============================================================================
   * ⚠️ A BARREIRA DA PORTA ABERTA.
   * ============================================================================
   *
   * `/associe-se` é o único endereço deste sistema que aceita POST de qualquer
   * pessoa. `membershipApplicationSchema` valida contra `PUBLIC_PROFILE_TYPES`,
   * e não contra a lista completa — sem isso, um POST direto com
   * `profileType: "interno"` colocaria um estranho no público de testes da
   * APCS, passando a receber tudo o que fosse disparado para ele.
   *
   * A tela nunca ofereceu esse botão. Tela não é barreira.
   */
  it("o formulário público não aceita o perfil interno", () => {
    expect(PUBLIC_PROFILE_TYPES).not.toContain("interno");
    expect(MEMBERSHIP_PROFILE_TYPES).toContain("interno");
  });

  /** Todo perfil público existe no cadastro — a lista é subconjunto, não outra. */
  it("os perfis públicos são um subconjunto do cadastro", () => {
    for (const perfil of PUBLIC_PROFILE_TYPES) {
      expect(MEMBERSHIP_PROFILE_TYPES).toContain(perfil);
    }
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
