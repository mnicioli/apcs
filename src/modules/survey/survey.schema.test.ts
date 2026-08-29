import { describe, expect, it } from "vitest";
import {
  surveyAudienceSchema,
  surveyCoreSchema,
  surveyOptionsSchema,
  surveyQuestionSchema,
  surveyReplySchema,
  surveyResponseSchema,
  surveyFiltersSchema,
  surveyScheduleSchema,
} from "./survey.schema";

/**
 * Testes dos contratos de entrada.
 *
 * O que se prova aqui é que o formulário recusa ANTES de o banco recusar — e com
 * a mensagem certa. A autoridade continua sendo o banco: cada limite testado
 * abaixo tem um gêmeo como CHECK, e a bateria SQL prova esse lado.
 */

const BASE = {
  title: "Expectativa sobre o valor da arroba do suino",
  description: "",
  question: "Como voce acredita que ficara o valor nas proximas semanas?",
  options: ["Aumentar muito", "Aumentar", "Manter", "Reduzir", "Reduzir muito"],
  startsAt: "",
  endsAt: "",
  scheduledAt: "",
  isAnonymous: false,
  allowsResponseChange: false,
};

describe("surveyOptionsSchema (§7)", () => {
  it("aceita a lista da primeira enquete", () => {
    expect(surveyOptionsSchema.safeParse(BASE.options).success).toBe(true);
  });

  it("recusa uma alternativa só — nao ha escolha com uma opcao", () => {
    const r = surveyOptionsSchema.safeParse(["Aumentar"]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/ao menos duas/i);
  });

  it("recusa alternativa em branco", () => {
    expect(surveyOptionsSchema.safeParse(["Aumentar", "   "]).success).toBe(false);
  });

  it("recusa alternativas repetidas, ignorando maiuscula", () => {
    const r = surveyOptionsSchema.safeParse(["Manter", "manter"]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/repetidas/i);
  });

  it("recusa mais de 10 — nao cabe numa mensagem de WhatsApp", () => {
    const onze = Array.from({ length: 11 }, (_, i) => `Opcao ${i + 1}`);
    expect(surveyOptionsSchema.safeParse(onze).success).toBe(false);
  });

  it("apara os espacos das alternativas", () => {
    const r = surveyOptionsSchema.safeParse(["  Aumentar  ", "Reduzir"]);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data[0]).toBe("Aumentar");
  });
});

describe("surveyCoreSchema (§4, §17, §35)", () => {
  it("aceita a enquete completa", () => {
    expect(surveyCoreSchema.safeParse(BASE).success).toBe(true);
  });

  it("exige titulo e pergunta com conteudo de verdade", () => {
    expect(surveyCoreSchema.safeParse({ ...BASE, title: "ab" }).success).toBe(false);
    expect(surveyCoreSchema.safeParse({ ...BASE, question: "?" }).success).toBe(false);
  });

  it("§17 recusa encerramento igual ao inicio", () => {
    const r = surveyCoreSchema.safeParse({
      ...BASE,
      startsAt: "2026-08-14T10:00:00Z",
      endsAt: "2026-08-14T10:00:00Z",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["endsAt"]);
  });

  it("§17 recusa encerramento anterior ao inicio", () => {
    const r = surveyCoreSchema.safeParse({
      ...BASE,
      startsAt: "2026-08-14T10:00:00Z",
      endsAt: "2026-08-13T10:00:00Z",
    });
    expect(r.success).toBe(false);
  });

  it("§35 recusa envio anterior ao inicio, apontando o campo certo", () => {
    const r = surveyCoreSchema.safeParse({
      ...BASE,
      startsAt: "2026-08-14T10:00:00Z",
      endsAt: "2026-08-20T10:00:00Z",
      scheduledAt: "2026-08-14T08:00:00Z",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["scheduledAt"]);
  });

  it("aceita envio no mesmo instante da abertura", () => {
    const r = surveyCoreSchema.safeParse({
      ...BASE,
      startsAt: "2026-08-14T10:00:00Z",
      endsAt: "2026-08-20T10:00:00Z",
      scheduledAt: "2026-08-14T10:00:00Z",
    });
    expect(r.success).toBe(true);
  });

  it("recusa data que so parece data", () => {
    expect(surveyCoreSchema.safeParse({ ...BASE, startsAt: "2026-02-31T10:00:00Z" }).success).toBe(
      false,
    );
    expect(surveyCoreSchema.safeParse({ ...BASE, startsAt: "amanha" }).success).toBe(false);
  });

  it("rascunho sem datas e valido — elas entram no agendamento", () => {
    const r = surveyCoreSchema.safeParse({ ...BASE, startsAt: "", endsAt: "", scheduledAt: "" });
    expect(r.success).toBe(true);
  });
});

describe("surveyQuestionSchema (§60)", () => {
  it("exige pergunta e duas alternativas", () => {
    expect(
      surveyQuestionSchema.safeParse({ question: "Pergunta valida?", options: ["A", "B"] }).success,
    ).toBe(true);
    expect(
      surveyQuestionSchema.safeParse({ question: "Pergunta valida?", options: ["A"] }).success,
    ).toBe(false);
  });
});

describe("surveyAudienceSchema (§23 a §31, GAP 1)", () => {
  it("aceita toda a base", () => {
    expect(surveyAudienceSchema.safeParse([{ dimension: "all" }]).success).toBe(true);
  });

  it("aceita regiao com UF e normaliza para maiuscula no proprio criterio", () => {
    const r = surveyAudienceSchema.safeParse([{ dimension: "region", value: "sp" }]);
    expect(r.success).toBe(true);
  });

  it("recusa regiao sem UF", () => {
    const r = surveyAudienceSchema.safeParse([{ dimension: "region", value: "" }]);
    expect(r.success).toBe(false);
  });

  it("recusa regiao com nome por extenso", () => {
    expect(
      surveyAudienceSchema.safeParse([{ dimension: "region", value: "Sao Paulo" }]).success,
    ).toBe(false);
  });

  it("aceita perfil e contato especifico", () => {
    expect(
      surveyAudienceSchema.safeParse([{ dimension: "profile", value: "producer" }]).success,
    ).toBe(true);
    expect(
      surveyAudienceSchema.safeParse([
        { dimension: "contact", contactId: "a0000000-0000-4000-8000-000000000001" },
      ]).success,
    ).toBe(true);
  });

  it("recusa contato sem id", () => {
    expect(surveyAudienceSchema.safeParse([{ dimension: "contact" }]).success).toBe(false);
  });

  it("GAP 1 recusa segmento, categoria e carteira com a mensagem que diz o que usar", () => {
    for (const dimension of ["segment", "category", "portfolio"] as const) {
      const r = surveyAudienceSchema.safeParse([
        { dimension, value: "x", segmentId: "a0000000-0000-4000-8000-000000000001" },
      ]);
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0]?.message).toMatch(/cadastro de associados/i);
        expect(r.error.issues[0]?.message).toMatch(/Regiao|Região/i);
      }
    }
  });

  it("recusa lista vazia — enquete sem publico nao alcanca ninguem", () => {
    expect(surveyAudienceSchema.safeParse([]).success).toBe(false);
  });

  it("recusa uma dimensao inventada", () => {
    expect(surveyAudienceSchema.safeParse([{ dimension: "signo" }]).success).toBe(false);
  });
});

describe("surveyScheduleSchema (§35)", () => {
  it("exige envio e encerramento", () => {
    expect(
      surveyScheduleSchema.safeParse({
        scheduledAt: "2026-08-14T10:00:00Z",
        endsAt: "2026-08-20T10:00:00Z",
      }).success,
    ).toBe(true);

    expect(surveyScheduleSchema.safeParse({ scheduledAt: "2026-08-14T10:00:00Z" }).success).toBe(
      false,
    );
  });

  it("recusa encerramento anterior ao inicio informado", () => {
    expect(
      surveyScheduleSchema.safeParse({
        scheduledAt: "2026-08-14T10:00:00Z",
        startsAt: "2026-08-14T10:00:00Z",
        endsAt: "2026-08-13T10:00:00Z",
      }).success,
    ).toBe(false);
  });
});

describe("os contratos do chatbot (§73)", () => {
  it("a resposta por id exige tres uuids", () => {
    const valido = {
      surveyId: "a0000000-0000-4000-8000-000000000001",
      optionId: "a0000000-0000-4000-8000-000000000002",
      contactId: "a0000000-0000-4000-8000-000000000003",
    };
    expect(surveyResponseSchema.safeParse(valido).success).toBe(true);
    expect(surveyResponseSchema.safeParse({ ...valido, surveyId: "1" }).success).toBe(false);
  });

  it("o id de mensagem e opcional — nem todo canal fornece um", () => {
    const base = {
      surveyId: "a0000000-0000-4000-8000-000000000001",
      optionId: "a0000000-0000-4000-8000-000000000002",
      contactId: "a0000000-0000-4000-8000-000000000003",
    };
    expect(surveyResponseSchema.safeParse(base).success).toBe(true);
    expect(surveyResponseSchema.safeParse({ ...base, sourceMessageId: "wamid.1" }).success).toBe(
      true,
    );
  });

  it("a resposta digitada exige um texto, e recusa um romance", () => {
    const base = {
      surveyId: "a0000000-0000-4000-8000-000000000001",
      contactId: "a0000000-0000-4000-8000-000000000003",
    };
    expect(surveyReplySchema.safeParse({ ...base, reply: "3" }).success).toBe(true);
    expect(surveyReplySchema.safeParse({ ...base, reply: "" }).success).toBe(false);
    expect(surveyReplySchema.safeParse({ ...base, reply: "x".repeat(201) }).success).toBe(false);
  });
});

describe("agendamento de 5 em 5 minutos", () => {
  /**
   * A mesma grade de Eventos e Palestras, aplicada ao INSTANTE. Enquetes marcam
   * `datetime-local`, não `time`, então quem decide é `isInstantOnTimeStep` —
   * que lê os minutos em UTC para sobreviver à conversão de fuso.
   */
  it("aceita um agendamento na grade", () => {
    const r = surveyCoreSchema.safeParse({
      ...BASE,
      startsAt: "2026-09-01T12:00:00.000Z",
      endsAt: "2026-09-10T23:55:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("recusa um agendamento fora da grade", () => {
    const r = surveyCoreSchema.safeParse({
      ...BASE,
      startsAt: "2026-09-01T12:00:00.000Z",
      endsAt: "2026-09-10T23:59:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  /**
   * ⚠️ O TESTE QUE IMPEDE A REGRA DE VAZAR PARA O FILTRO DA LISTA.
   *
   * `surveyFiltersSchema` usa o instante SEM a grade de propósito: o campo "até"
   * do filtro vira `AAAA-MM-DDT23:59:59.999Z` — o dia inteiro, que é o que quem
   * filtra "até 20/08" espera. Se alguém "simplificar" pondo o passo dentro do
   * `instantSchema`, a lista de enquetes para de filtrar por data.
   */
  it("não vale para o filtro da lista, que precisa do fim do dia", () => {
    const r = surveyFiltersSchema.safeParse({
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-10T23:59:59.999Z",
    });
    expect(r.success).toBe(true);
  });
});
