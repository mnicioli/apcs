import { describe, expect, it } from "vitest";
import {
  knowledgeCommandSchema,
  knowledgeEntryFormSchema,
  knowledgeSearchSchema,
  type KnowledgeEntryFormData,
} from "./knowledge.schema";

function formulario(patch: Partial<KnowledgeEntryFormData> = {}): KnowledgeEntryFormData {
  return {
    categoryId: "3f1b0c8e-0000-4000-8000-000000000001",
    categoryName: "",
    title: "Horário de atendimento",
    content: "A APCS atende de segunda a sexta, das 8h às 17h.",
    keywords: "horas, horário, funcionamento",
    status: "active",
    availableForChatbot: true,
    startsAt: "",
    endsAt: "",
    ...patch,
  };
}

/** O caminho de erro que interessa: qual campo o formulário vai acender. */
function camposComErro(entrada: KnowledgeEntryFormData): string[] {
  const resultado = knowledgeEntryFormSchema.safeParse(entrada);
  if (resultado.success) return [];
  return resultado.error.issues.map((issue) => issue.path.join("."));
}

describe("formulário de item de conhecimento", () => {
  it("aceita um item completo", () => {
    expect(knowledgeEntryFormSchema.safeParse(formulario()).success).toBe(true);
  });

  /**
   * ⚠️ A REGRA QUE EVITA O DEFEITO MUDO, e ela também é um CHECK no banco
   * (`knowledge_entries_chatbot_needs_keywords`).
   *
   * Sem palavra-chave, o item aparece na tela como disponível para o chatbot e
   * o robô responde "não encontrei" — porque não há nada com que casar a
   * mensagem da pessoa. O sintoma manda investigar o chatbot, que está certo.
   */
  it("liberado para o chatbot exige ao menos uma palavra-chave", () => {
    expect(camposComErro(formulario({ availableForChatbot: true, keywords: "" }))).toEqual([
      "keywords",
    ]);
    expect(camposComErro(formulario({ availableForChatbot: true, keywords: "  ,  ; " }))).toEqual([
      "keywords",
    ]);
  });

  it("sem liberar o chatbot, palavra-chave é opcional", () => {
    // Um rascunho ou uma resposta que só o atendimento humano usa não precisa
    // ser encontrável pelo robô — exigir a lista ali seria burocracia.
    expect(
      knowledgeEntryFormSchema.safeParse(formulario({ availableForChatbot: false, keywords: "" }))
        .success,
    ).toBe(true);
  });

  it("recusa mais de 20 palavras-chave", () => {
    const muitas = Array.from({ length: 21 }, (_, i) => `palavra${i}`).join(", ");
    expect(camposComErro(formulario({ keywords: muitas }))).toEqual(["keywords"]);
  });

  it("exige uma categoria: escolhida ou digitada", () => {
    expect(camposComErro(formulario({ categoryId: "", categoryName: "" }))).toEqual(["categoryId"]);

    expect(
      knowledgeEntryFormSchema.safeParse(formulario({ categoryId: "", categoryName: "Eventos" }))
        .success,
    ).toBe(true);
  });

  it("recusa nome de categoria curto demais", () => {
    expect(camposComErro(formulario({ categoryId: "", categoryName: "A" }))).toEqual([
      "categoryName",
    ]);
  });

  it("recusa título e resposta fora dos limites do banco", () => {
    expect(camposComErro(formulario({ title: "Oi" }))).toEqual(["title"]);
    expect(camposComErro(formulario({ title: "x".repeat(161) }))).toEqual(["title"]);
    expect(camposComErro(formulario({ content: "curto" }))).toEqual(["content"]);
    expect(camposComErro(formulario({ content: "x".repeat(4001) }))).toEqual(["content"]);
  });

  /**
   * ⚠️ "2026-02-31" PASSA NA REGEX E NÃO É UMA DATA. Reconstruir a string a
   * partir da data interpretada é o que separa uma data possível de uma que só
   * parece uma data — mesmo raciocínio de `effectiveDateSchema` em Documentos.
   */
  it("recusa data que só parece data", () => {
    expect(camposComErro(formulario({ startsAt: "2026-02-31" }))).toEqual(["startsAt"]);
    expect(camposComErro(formulario({ endsAt: "30/08/2026" }))).toEqual(["endsAt"]);
  });

  it("aceita janela aberta dos dois lados, de um lado só, e fechada", () => {
    expect(knowledgeEntryFormSchema.safeParse(formulario()).success).toBe(true);
    expect(knowledgeEntryFormSchema.safeParse(formulario({ startsAt: "2026-09-01" })).success).toBe(
      true,
    );
    expect(
      knowledgeEntryFormSchema.safeParse(
        formulario({ startsAt: "2026-09-01", endsAt: "2026-09-30" }),
      ).success,
    ).toBe(true);
  });

  it("recusa janela que termina antes de começar", () => {
    // Não é erro de digitação inofensivo: é um item que nunca vai aparecer, e
    // ninguém descobre por quê.
    expect(camposComErro(formulario({ startsAt: "2026-09-30", endsAt: "2026-09-01" }))).toEqual([
      "endsAt",
    ]);
  });

  it("aceita o mesmo dia nas duas pontas — vale por um dia", () => {
    expect(
      knowledgeEntryFormSchema.safeParse(
        formulario({ startsAt: "2026-09-01", endsAt: "2026-09-01" }),
      ).success,
    ).toBe(true);
  });
});

describe("comandos e busca", () => {
  it("só aceita ativar e inativar", () => {
    const id = "3f1b0c8e-0000-4000-8000-000000000001";
    expect(knowledgeCommandSchema.safeParse({ id, command: "activate" }).success).toBe(true);
    expect(knowledgeCommandSchema.safeParse({ id, command: "deactivate" }).success).toBe(true);
    // Um comando desconhecido não pode virar um update silencioso.
    expect(knowledgeCommandSchema.safeParse({ id, command: "delete" }).success).toBe(false);
  });

  it("a busca de teste exige uma mensagem de verdade", () => {
    expect(knowledgeSearchSchema.safeParse({ query: "a" }).success).toBe(false);
    expect(knowledgeSearchSchema.safeParse({ query: "que horas abre?" }).success).toBe(true);
  });
});
