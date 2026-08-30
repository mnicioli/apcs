import { describe, expect, it } from "vitest";
import {
  apcsToday,
  compareKnowledgeEntries,
  countAvailableToChatbot,
  formatKeywords,
  isAvailableToChatbot,
  knowledgeBlocker,
  matchesKnowledgeFilters,
  parseKeywords,
} from "./knowledge.rules";
import { EMPTY_KNOWLEDGE_FILTERS, type KnowledgeEntry } from "./knowledge.types";

const HOJE = "2026-08-30";

function item(patch: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "e1",
    categoryId: "c1",
    categoryName: "Atendimento",
    title: "Horário de atendimento",
    content: "A APCS atende de segunda a sexta, das 8h às 17h.",
    keywords: ["horas", "horário", "funcionamento"],
    status: "active",
    availableForChatbot: true,
    startsAt: null,
    endsAt: null,
    createdBy: null,
    createdAt: "2026-08-01T12:00:00Z",
    updatedBy: null,
    updatedAt: "2026-08-01T12:00:00Z",
    ...patch,
  };
}

/**
 * ⚠️ ESTA TABELA DE CASOS É O ESPELHO DO `where` DE `search_knowledge()`
 * (20260913000100_knowledge.sql, seção 7). As duas escritas da mesma regra são
 * uma dívida assumida — o banco IMPÕE, o TypeScript EXIBE —, e é aqui que a
 * dívida fica visível. Mudou o `where` lá? Este arquivo tem de mudar junto.
 */
describe("§43 — quando o chatbot pode usar um item", () => {
  it("as quatro condições satisfeitas liberam o item", () => {
    expect(knowledgeBlocker(item(), HOJE)).toBeNull();
    expect(isAvailableToChatbot(item(), HOJE)).toBe(true);
  });

  it("inativo bloqueia, mesmo liberado para o chatbot", () => {
    expect(knowledgeBlocker(item({ status: "inactive" }), HOJE)).toBe("inactive");
  });

  it("ativo sem liberação não vale para o robô", () => {
    // §19 do escopo, e é o motivo de este módulo NÃO copiar o CHECK de
    // Documentos (`available_for_chatbot = (status = 'active')`): a resposta
    // pode valer para o atendimento humano antes de valer para o robô.
    expect(knowledgeBlocker(item({ availableForChatbot: false }), HOJE)).toBe("notReleased");
  });

  it("vigência futura ainda não vale", () => {
    expect(knowledgeBlocker(item({ startsAt: "2026-09-01" }), HOJE)).toBe("notStarted");
  });

  it("vigência vencida não vale mais", () => {
    expect(knowledgeBlocker(item({ endsAt: "2026-08-29" }), HOJE)).toBe("expired");
  });

  /**
   * ⚠️ OS DOIS EXTREMOS SÃO INCLUSIVOS, como o `<=` e o `>=` da função no banco.
   * Um item que "vale até hoje" e some hoje de manhã é a diferença entre o
   * recesso terminar no dia certo e terminar um dia antes.
   */
  it("o primeiro e o último dia da janela contam como dentro", () => {
    expect(knowledgeBlocker(item({ startsAt: HOJE }), HOJE)).toBeNull();
    expect(knowledgeBlocker(item({ endsAt: HOJE }), HOJE)).toBeNull();
    expect(knowledgeBlocker(item({ startsAt: HOJE, endsAt: HOJE }), HOJE)).toBeNull();
  });

  /**
   * ⚠️ A ORDEM DAS CAUSAS IMPORTA: quem vê "inativo" não precisa saber que a
   * vigência também expirou. Resolver a primeira é o que a pessoa faz.
   */
  it("com vários problemas, aponta o primeiro a resolver", () => {
    const quebrado = item({
      status: "inactive",
      availableForChatbot: false,
      endsAt: "2020-01-01",
    });
    expect(knowledgeBlocker(quebrado, HOJE)).toBe("inactive");
  });

  it("conta quantos o chatbot alcança agora", () => {
    const lista = [
      item({ id: "a" }),
      item({ id: "b", status: "inactive" }),
      item({ id: "c", endsAt: "2026-08-01" }),
      item({ id: "d" }),
    ];
    expect(countAvailableToChatbot(lista, HOJE)).toBe(2);
  });
});

describe("o hoje da APCS", () => {
  /**
   * ⚠️ O TESTE QUE JUSTIFICA A FUNÇÃO EXISTIR. Às 23h em São Paulo já é o dia
   * seguinte em UTC — e `toISOString().slice(0,10)` faria um item vigente até
   * hoje sumir três horas antes da hora, todas as noites.
   */
  it("usa o fuso de São Paulo, não o do servidor", () => {
    expect(apcsToday(new Date("2026-08-30T02:00:00Z"))).toBe("2026-08-29");
    expect(apcsToday(new Date("2026-08-30T03:00:00Z"))).toBe("2026-08-30");
  });
});

describe("palavras-chave", () => {
  it("aceita vírgula, quebra de linha e ponto e vírgula", () => {
    // ⚠️ AS TRÊS, porque as três acontecem: quem cola de uma planilha traz uma
    // por linha, e quem digita usa vírgula. Aceitar só uma transformaria a
    // lista colada num único item gigante — invisível para a busca, e sem
    // nenhum erro na tela.
    expect(parseKeywords("horas\nhorário; aberto, funcionamento")).toEqual([
      "horas",
      "horário",
      "aberto",
      "funcionamento",
    ]);
  });

  it("descarta repetições ignorando acento e caixa, mantendo a primeira grafia", () => {
    expect(parseKeywords("Horário, horario, HORÁRIO, horas")).toEqual(["Horário", "horas"]);
  });

  it("limpa sobras: espaços nas pontas, espaços dobrados e itens vazios", () => {
    expect(parseKeywords("  bolsa  de   suínos ,, , preço  ")).toEqual([
      "bolsa de suínos",
      "preço",
    ]);
  });

  it("texto sem nada aproveitável vira lista vazia", () => {
    expect(parseKeywords("   ,  ; \n ")).toEqual([]);
  });

  it("volta ao formulário no formato em que foi digitada", () => {
    expect(formatKeywords(["horas", "aberto"])).toBe("horas, aberto");
  });
});

describe("filtros da grid", () => {
  it("sem filtro nenhum, passa tudo", () => {
    expect(matchesKnowledgeFilters(item(), EMPTY_KNOWLEDGE_FILTERS)).toBe(true);
  });

  /**
   * ⚠️ A BUSCA IGNORA ACENTO, e é o mesmo motivo de Documentos: ninguém digita
   * "horário" com acento numa caixa de busca. Sem isto o `ilike` do Postgres
   * responderia "nenhum item" para um item que está bem ali na lista.
   */
  it("encontra sem acento e sem caixa", () => {
    const busca = { ...EMPTY_KNOWLEDGE_FILTERS, query: "HORARIO" };
    expect(matchesKnowledgeFilters(item(), busca)).toBe(true);
  });

  it("encontra pela palavra-chave, não só pelo título", () => {
    // Quem procura "funcionamento" na tela procura o mesmo item que o associado
    // procura escrevendo "funcionamento" no WhatsApp.
    const busca = { ...EMPTY_KNOWLEDGE_FILTERS, query: "funcionamento" };
    expect(matchesKnowledgeFilters(item({ title: "Expediente" }), busca)).toBe(true);
  });

  it("encontra pelo texto da resposta", () => {
    const busca = { ...EMPTY_KNOWLEDGE_FILTERS, query: "segunda a sexta" };
    expect(matchesKnowledgeFilters(item({ title: "X", keywords: [] }), busca)).toBe(true);
  });

  it("filtra por status e por categoria", () => {
    const porStatus = { ...EMPTY_KNOWLEDGE_FILTERS, status: "inactive" as const };
    expect(matchesKnowledgeFilters(item(), porStatus)).toBe(false);
    expect(matchesKnowledgeFilters(item({ status: "inactive" }), porStatus)).toBe(true);

    const porCategoria = { ...EMPTY_KNOWLEDGE_FILTERS, categoryId: "c2" };
    expect(matchesKnowledgeFilters(item(), porCategoria)).toBe(false);
    expect(matchesKnowledgeFilters(item({ categoryId: "c2" }), porCategoria)).toBe(true);
  });

  it("ordena pelo título com as regras do português", () => {
    const lista = [item({ title: "Serviços" }), item({ title: "Associação" })];
    expect([...lista].sort(compareKnowledgeEntries).map((e) => e.title)).toEqual([
      "Associação",
      "Serviços",
    ]);
  });
});
