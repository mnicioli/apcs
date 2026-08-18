import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SURVEY_RESPONSE_ALREADY,
  SURVEY_RESPONSE_CLOSED,
  SURVEY_RESPONSE_INVALID,
  SURVEY_RESPONSE_THANKS,
  SURVEY_RESPONSE_UNAVAILABLE,
} from "@/modules/survey/survey.labels";

/**
 * A PORTA DO CHATBOT (§41 a §50, §73).
 *
 * O que estes testes exigem, em ordem de importância:
 *
 *   1. **Nunca lançar.** O chat não pode cair porque uma resposta falhou — nem
 *      quando o banco devolve erro, nem quando ele lança de verdade.
 *   2. **Nunca vazar detalhe técnico** para a janela do chat.
 *   3. Não ir ao banco quando não há o que registrar (§44).
 *   4. Respeitar o portão antes de montar a mensagem.
 */

const rpc = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));

const { getSurveyForChatbot, registerSurveyReply, registerSurveyResponse } =
  await import("./survey-chatbot");

const ENQUETE = "a0000000-0000-4000-8000-000000000001";
const CONTATO = "a0000000-0000-4000-8000-000000000002";
const OPCAO = "a0000000-0000-4000-8000-000000000003";

const LINHAS = [
  {
    survey_id: ENQUETE,
    title: "Expectativa do valor da arroba",
    question_id: "a0000000-0000-4000-8000-000000000009",
    question: "Como ficara o valor?",
    option_id: "a0000000-0000-4000-8000-000000000011",
    option_position: 1,
    option_text: "Aumentar",
  },
  {
    survey_id: ENQUETE,
    title: "Expectativa do valor da arroba",
    question_id: "a0000000-0000-4000-8000-000000000009",
    question: "Como ficara o valor?",
    option_id: "a0000000-0000-4000-8000-000000000012",
    option_position: 2,
    option_text: "Manter",
  },
  {
    survey_id: ENQUETE,
    title: "Expectativa do valor da arroba",
    question_id: "a0000000-0000-4000-8000-000000000009",
    question: "Como ficara o valor?",
    option_id: "a0000000-0000-4000-8000-000000000013",
    option_position: 3,
    option_text: "Reduzir",
  },
];

/** O mock precisa distinguir as RPCs: as três têm formatos de retorno diferentes. */
function mockarBanco(opcoes: { gate?: string; linhas?: typeof LINHAS; outcome?: string } = {}) {
  rpc.mockImplementation((nome: string) => {
    if (nome === "survey_response_gate") {
      return Promise.resolve({ data: opcoes.gate ?? "registered", error: null });
    }
    if (nome === "get_survey_for_chatbot") {
      const linhas = opcoes.linhas ?? LINHAS;
      return { returns: () => Promise.resolve({ data: linhas, error: null }) };
    }
    if (nome === "register_survey_response") {
      return Promise.resolve({ data: opcoes.outcome ?? "registered", error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => {
  rpc.mockReset();
  mockarBanco();
});

describe("getSurveyForChatbot (§41, §42)", () => {
  it("monta a mensagem com a pergunta e as opções numeradas", async () => {
    const r = await getSurveyForChatbot(ENQUETE);

    expect(r.status).toBe("found");
    if (r.status !== "found") return;

    expect(r.survey.question).toBe("Como ficara o valor?");
    expect(r.survey.options).toHaveLength(3);
    expect(r.survey.message).toContain("Como ficara o valor?");
    expect(r.survey.message).toContain("Aumentar");
    expect(r.survey.message).toContain("APCS");
    expect(r.survey.message).toMatch(/responda com o número/i);
  });

  it("as opções saem em ordem de posição", async () => {
    mockarBanco({ linhas: [LINHAS[2]!, LINHAS[0]!, LINHAS[1]!] });
    const r = await getSurveyForChatbot(ENQUETE);
    if (r.status !== "found") throw new Error("esperava found");
    expect(r.survey.options.map((o) => o.position)).toEqual([1, 2, 3]);
  });

  it("§48/§49/§50 o portão bloqueia antes de montar a mensagem", async () => {
    for (const gate of ["closed", "cancelled", "not_active", "not_found"]) {
      mockarBanco({ gate });
      const r = await getSurveyForChatbot(ENQUETE);
      expect(r.status).toBe("not-available");
    }
  });

  it("um id que não é uuid nem chega ao banco", async () => {
    const r = await getSurveyForChatbot("nao-sou-um-uuid");
    expect(r.status).toBe("not-available");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("enquete sem alternativas não vira mensagem", async () => {
    mockarBanco({ linhas: [] });
    const r = await getSurveyForChatbot(ENQUETE);
    expect(r.status).toBe("not-available");
  });

  it("⚠️ a mensagem NÃO carrega resultado parcial — isso enviesaria a enquete", async () => {
    const r = await getSurveyForChatbot(ENQUETE);
    if (r.status !== "found") throw new Error("esperava found");
    expect(r.survey.message).not.toMatch(/\d+\s*%|votos|responderam|parcial/i);
    expect(JSON.stringify(r.survey)).not.toMatch(/total|percentage|recipient|audience/i);
  });

  it("nunca lança, mesmo com o banco em pânico", async () => {
    rpc.mockImplementation(() => {
      throw new Error("conexão perdida");
    });
    await expect(getSurveyForChatbot(ENQUETE)).resolves.toEqual({ status: "not-available" });
  });
});

describe("registerSurveyReply (§43, §44)", () => {
  it("traduz o número digitado na alternativa certa", async () => {
    const r = await registerSurveyReply({ surveyId: ENQUETE, contactId: CONTATO, reply: "2" });

    expect(r.status).toBe("handled");
    if (r.status !== "handled") return;
    expect(r.outcome).toBe("registered");
    expect(r.message).toBe(SURVEY_RESPONSE_THANKS);

    const chamada = rpc.mock.calls.find(([nome]) => nome === "register_survey_response");
    expect(chamada?.[1]).toMatchObject({
      p_option_id: "a0000000-0000-4000-8000-000000000012",
      p_contact_id: CONTATO,
    });
  });

  it("§44 número fora da lista NÃO vai ao banco", async () => {
    const r = await registerSurveyReply({ surveyId: ENQUETE, contactId: CONTATO, reply: "9" });

    expect(r.status).toBe("handled");
    if (r.status !== "handled") return;
    expect(r.outcome).toBe("invalid_option");
    expect(r.message).toBe(SURVEY_RESPONSE_INVALID);
    expect(rpc.mock.calls.some(([nome]) => nome === "register_survey_response")).toBe(false);
  });

  it("§45 texto fora do contexto não vira resposta", async () => {
    const r = await registerSurveyReply({
      surveyId: ENQUETE,
      contactId: CONTATO,
      reply: "quero falar com um atendente",
    });

    if (r.status !== "handled") throw new Error("esperava handled");
    expect(r.outcome).toBe("invalid_option");
    expect(rpc.mock.calls.some(([nome]) => nome === "register_survey_response")).toBe(false);
  });

  it("§48 enquete encerrada devolve a frase do escopo", async () => {
    mockarBanco({ gate: "closed" });
    const r = await registerSurveyReply({ surveyId: ENQUETE, contactId: CONTATO, reply: "1" });

    if (r.status !== "handled") throw new Error("esperava handled");
    expect(r.outcome).toBe("closed");
    expect(r.message).toBe(SURVEY_RESPONSE_CLOSED);
  });

  it("§49/§50 cancelada e não ativa colapsam na mesma frase", async () => {
    for (const gate of ["cancelled", "not_active"]) {
      mockarBanco({ gate });
      const r = await registerSurveyReply({ surveyId: ENQUETE, contactId: CONTATO, reply: "1" });
      if (r.status !== "handled") throw new Error("esperava handled");
      expect(r.message).toBe(SURVEY_RESPONSE_UNAVAILABLE);
    }
  });

  it("entrada malformada não vira chamada ao banco", async () => {
    const r = await registerSurveyReply({ surveyId: "nao-uuid", contactId: CONTATO, reply: "1" });
    expect(r.status).toBe("failed");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("registerSurveyResponse (§46, §47, §73)", () => {
  it("§47 quem já participou recebe a frase do escopo", async () => {
    mockarBanco({ outcome: "already_answered" });
    const r = await registerSurveyResponse({
      surveyId: ENQUETE,
      optionId: OPCAO,
      contactId: CONTATO,
    });

    if (r.status !== "handled") throw new Error("esperava handled");
    expect(r.outcome).toBe("already_answered");
    expect(r.message).toBe(SURVEY_RESPONSE_ALREADY);
  });

  it("§73 o id da mensagem é repassado ao banco — é a idempotência", async () => {
    await registerSurveyResponse({
      surveyId: ENQUETE,
      optionId: OPCAO,
      contactId: CONTATO,
      sourceMessageId: "wamid.HBgN1",
    });

    expect(rpc).toHaveBeenCalledWith(
      "register_survey_response",
      expect.objectContaining({ p_source_message_id: "wamid.HBgN1" }),
    );
  });

  it("sem id de mensagem manda NULL, e não string vazia", async () => {
    await registerSurveyResponse({ surveyId: ENQUETE, optionId: OPCAO, contactId: CONTATO });
    expect(rpc).toHaveBeenCalledWith(
      "register_survey_response",
      expect.objectContaining({ p_source_message_id: null }),
    );
  });

  it("erro do banco vira 'failed', sem detalhe técnico", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied for table survey_responses" },
    });

    const r = await registerSurveyResponse({
      surveyId: ENQUETE,
      optionId: OPCAO,
      contactId: CONTATO,
    });

    expect(r).toEqual({ status: "failed" });
    expect(JSON.stringify(r)).not.toMatch(/permission denied|survey_responses|42501/);
  });

  it("nunca lança, mesmo com o banco em pânico", async () => {
    rpc.mockImplementation(() => {
      throw new Error("conexão perdida");
    });
    await expect(
      registerSurveyResponse({ surveyId: ENQUETE, optionId: OPCAO, contactId: CONTATO }),
    ).resolves.toEqual({ status: "failed" });
  });

  it("id inválido é barrado antes do banco", async () => {
    const r = await registerSurveyResponse({
      surveyId: ENQUETE,
      optionId: "'; drop table surveys; --",
      contactId: CONTATO,
    });
    expect(r).toEqual({ status: "failed" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("nenhuma frase do bot vaza o sistema (§72-análogo)", () => {
  it("todas as respostas possíveis são texto de negócio", async () => {
    const desfechos = [
      "registered",
      "already_answered",
      "invalid_option",
      "closed",
      "cancelled",
      "not_active",
      "not_found",
    ];

    for (const outcome of desfechos) {
      mockarBanco({ outcome });
      const r = await registerSurveyResponse({
        surveyId: ENQUETE,
        optionId: OPCAO,
        contactId: CONTATO,
      });

      if (r.status !== "handled") throw new Error("esperava handled");
      expect(r.message).not.toMatch(/survey|SV0|PGRST|postgres|rpc|null|undefined/i);
      expect(r.message.length).toBeGreaterThan(10);
    }
  });
});
