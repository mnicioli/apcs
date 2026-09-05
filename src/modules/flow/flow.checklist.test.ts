import { describe, expect, it } from "vitest";
import {
  checklistProgress,
  FLOW_CHECKLIST_ITEMS,
  FLOW_CHECKLIST_KEYS,
  isChecklistComplete,
  readFlowChecklist,
  toggleChecklistItem,
} from "./flow.checklist";

/**
 * §21 do Prompt 5 — o checklist de homologação.
 *
 * ⚠️ NENHUM TESTE AQUI VERIFICA QUE O CHECKLIST BLOQUEIA ALGUMA COISA, e a
 * ausência é o assunto. Ver o comentário no topo de `flow.checklist.ts`: os
 * itens são AFIRMAÇÕES DE UMA PESSOA, não verificáveis pelo sistema, e uma
 * trava sobre elas produz o hábito de marcar sem ler.
 */

const AGORA = new Date("2026-09-05T12:00:00Z");

describe("a lista de itens", () => {
  it("tem os onze do §21", () => {
    expect(FLOW_CHECKLIST_ITEMS).toHaveLength(11);
  });

  /**
   * ⚠️ CHAVES ESTÁVEIS E ÚNICAS. O rótulo pode ser reescrito numa quinta-feira
   * sem invalidar o que já foi marcado; a chave é o que sobrevive. Duas iguais
   * fariam um item apagar o outro no jsonb, silenciosamente.
   */
  it("não repete chave", () => {
    expect(new Set(FLOW_CHECKLIST_KEYS).size).toBe(FLOW_CHECKLIST_KEYS.length);
  });

  it("usa chave em inglês, minúscula, como o resto do projeto", () => {
    for (const chave of FLOW_CHECKLIST_KEYS) {
      expect(chave).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  /** Todo item explica POR QUE existe — é o texto de ajuda da tela. */
  it("todo item tem rótulo e ajuda", () => {
    for (const item of FLOW_CHECKLIST_ITEMS) {
      expect(item.label.length).toBeGreaterThan(3);
      expect(item.help.length).toBeGreaterThan(20);
    }
  });
});

describe("readFlowChecklist", () => {
  it("lê um checklist vazio como tudo desmarcado", () => {
    const lido = readFlowChecklist({});
    expect(checklistProgress(lido)).toEqual({ done: 0, total: 11 });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["texto", "sim"],
    ["número", 42],
    ["lista", []],
  ])("sobrevive a %s vindo do jsonb", (_nome, bruto) => {
    const lido = readFlowChecklist(bruto);
    expect(Object.keys(lido)).toHaveLength(11);
    expect(checklistProgress(lido).done).toBe(0);
  });

  /**
   * ⚠️ ITEM DESCONHECIDO É DESCARTADO. Uma versão gravada quando a lista tinha
   * um item a mais continuaria com ele no jsonb; mostrá-lo faria a tela exibir
   * uma exigência que não existe mais no processo.
   */
  it("descarta item que não está mais na lista", () => {
    const lido = readFlowChecklist({
      lgpd: { checked: true, by: "Maria", at: AGORA.toISOString() },
      item_que_foi_removido: { checked: true, by: "João", at: AGORA.toISOString() },
    });

    expect(lido["lgpd"]?.checked).toBe(true);
    expect("item_que_foi_removido" in lido).toBe(false);
  });

  /**
   * ⚠️ SÓ `true` CONTA COMO MARCADO. O jsonb aceita qualquer coisa, e uma
   * gravação distraída pode ter posto `"true"` (texto) ou `1`. Tratá-los como
   * marcado faria o registro de conferência afirmar algo que ninguém afirmou.
   */
  it.each([
    ["texto", "true"],
    ["número", 1],
    ["ausente", undefined],
  ])("não aceita %s como marcado", (_nome, valor) => {
    const lido = readFlowChecklist({ lgpd: { checked: valor } });
    expect(lido["lgpd"]?.checked).toBe(false);
  });
});

describe("toggleChecklistItem", () => {
  it("marca com autor e carimbo de tempo", () => {
    const depois = toggleChecklistItem(readFlowChecklist({}), "lgpd", true, "Maria", AGORA);

    expect(depois["lgpd"]).toEqual({
      checked: true,
      by: "Maria",
      at: AGORA.toISOString(),
    });
  });

  /**
   * ⚠️ DESMARCAR APAGA O CARIMBO. Manter "conferido por Maria em 03/09" ao lado
   * de uma caixa vazia contaria duas histórias na mesma linha — e a que a tela
   * mostra em negrito é a errada.
   */
  it("limpa o autor ao desmarcar", () => {
    const marcado = toggleChecklistItem(readFlowChecklist({}), "lgpd", true, "Maria", AGORA);
    const desmarcado = toggleChecklistItem(marcado, "lgpd", false, "João", AGORA);

    expect(desmarcado["lgpd"]).toEqual({ checked: false, by: null, at: null });
  });

  it("não mexe nos outros itens", () => {
    const um = toggleChecklistItem(readFlowChecklist({}), "lgpd", true, "Maria", AGORA);
    const dois = toggleChecklistItem(um, "messages", true, "João", AGORA);

    expect(dois["lgpd"]?.by).toBe("Maria");
    expect(dois["messages"]?.by).toBe("João");
  });

  /** Chave fora da lista não cria item novo — ela simplesmente não existe. */
  it("ignora chave desconhecida", () => {
    const antes = readFlowChecklist({});
    const depois = toggleChecklistItem(antes, "inventada", true, "Maria", AGORA);
    expect(depois).toBe(antes);
  });
});

describe("progresso", () => {
  it("conta os marcados", () => {
    let checklist = readFlowChecklist({});
    checklist = toggleChecklistItem(checklist, "lgpd", true, null, AGORA);
    checklist = toggleChecklistItem(checklist, "messages", true, null, AGORA);

    expect(checklistProgress(checklist)).toEqual({ done: 2, total: 11 });
    expect(isChecklistComplete(checklist)).toBe(false);
  });

  it("fica completo com os onze", () => {
    let checklist = readFlowChecklist({});
    for (const chave of FLOW_CHECKLIST_KEYS) {
      checklist = toggleChecklistItem(checklist, chave, true, null, AGORA);
    }

    expect(isChecklistComplete(checklist)).toBe(true);
  });
});
