import { describe, expect, it } from "vitest";
import { PERMISSION_MATRIX } from "./rbac.config";
import { PERMISSION_GROUPS, PERMISSION_GROUP_NOTES, PERMISSION_LABELS } from "./rbac.labels";
import type { Permission } from "./rbac.types";

/**
 * ESTES TESTES GUARDAM A MATRIZ DE ACESSO CONTRA A FALHA POR OMISSÃO.
 *
 * Uma tela que lista permissões erra de um jeito silencioso: a permissão nova
 * simplesmente não aparece. Ninguém percebe a ausência de uma linha numa tabela
 * de trinta — e a partir daí a tela que existe para responder "quem pode o quê"
 * responde errado, com cara de certa.
 */

const TODAS = Object.keys(PERMISSION_MATRIX) as Permission[];
const AGRUPADAS = PERMISSION_GROUPS.flatMap((g) => g.permissions);

describe("os grupos da matriz de acesso", () => {
  it("cobrem TODA permissão que existe na matriz de decisão", () => {
    const faltando = TODAS.filter((p) => !AGRUPADAS.includes(p));
    expect(faltando).toEqual([]);
  });

  /**
   * ⚠️ O CAMINHO INVERSO TAMBÉM IMPORTA. Um grupo que cita uma chave que saiu
   * de `PERMISSION_MATRIX` quebraria a tela ao ler `PERMISSION_MATRIX[chave]`
   * (undefined) — e quebraria só quando alguém abrisse a página.
   */
  it("não citam permissão que não existe mais", () => {
    const sobrando = AGRUPADAS.filter((p) => !TODAS.includes(p));
    expect(sobrando).toEqual([]);
  });

  it("não repetem a mesma permissão em dois grupos", () => {
    const vistas = new Set<string>();
    const repetidas = AGRUPADAS.filter((p) => (vistas.has(p) ? true : (vistas.add(p), false)));
    expect(repetidas).toEqual([]);
  });

  it("toda permissão tem um rótulo em português", () => {
    for (const permissao of TODAS) {
      expect(PERMISSION_LABELS[permissao]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  /**
   * O rótulo é lido numa célula ao lado de sete colunas de papel. Uma frase
   * longa quebra a linha e desalinha a leitura horizontal, que é justamente o
   * que a matriz existe para permitir.
   */
  it("os rótulos são curtos o bastante para caber numa linha", () => {
    for (const [permissao, rotulo] of Object.entries(PERMISSION_LABELS)) {
      expect(rotulo.length, `${permissao} está longo demais`).toBeLessThanOrEqual(50);
    }
  });

  it("todo grupo tem título e ao menos uma permissão", () => {
    for (const grupo of PERMISSION_GROUPS) {
      expect(grupo.title.length).toBeGreaterThan(0);
      expect(grupo.permissions.length).toBeGreaterThan(0);
    }
  });

  /**
   * ⚠️ AS SEÇÕES QUE NÃO ESTÃO NO AR PRECISAM DIZER ISSO. Sem a nota, um
   * "Analytics: CEO pode" na tela vira promessa de uma tela que não existe — e
   * alguém vai cobrar o acesso que já tem.
   */
  it("os estados que não estão no ar trazem uma explicação", () => {
    expect(PERMISSION_GROUP_NOTES.roadmap).toBeTruthy();
    expect(PERMISSION_GROUP_NOTES.unused).toBeTruthy();
    expect(PERMISSION_GROUP_NOTES.live).toBeNull();
  });
});
