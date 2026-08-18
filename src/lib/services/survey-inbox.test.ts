import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeProvider } from "@/lib/messaging/providers/fake";
import type { InboundEvent } from "@/lib/messaging/messaging.types";

/**
 * §62, §63, §64. O WEBHOOK, do evento até a urna.
 *
 * ⚠️ Estes testes cobrem o que a bateria SQL não alcança: as DECISÕES DE
 * CONVERSA. Quando o bot responde, quando ele cala, quando ele pergunta, e
 * quando ele NÃO registra — que é a metade que dá defeito silencioso.
 */

const CONTATO = "c0000000-0000-4000-8000-000000000001";
const ENQUETE_A = "a0000000-0000-4000-8000-00000000000a";
const ENQUETE_B = "b0000000-0000-4000-8000-00000000000b";
const NUMERO = "5519991234567";

const banco = {
  /** Eventos já vistos — é a tabela de idempotência do §16. */
  eventos: new Map<string, { outcome: string | null }>(),
  contatoExiste: true,
  contextos: [] as {
    state_id: string;
    survey_id: string;
    question_id: string;
    recipient_id: string | null;
    survey_title: string;
    asked_at: string;
    matched_by: string;
  }[],
  atendimentoHumano: 0,
  respostas: new Map<string, string>(),
  gate: "registered",
  contextosFechados: [] as { id: string; status: string }[],
  optOuts: [] as string[],
  invalidas: 0,
  statusMarcados: [] as { id: string; status: string }[],
  mensagemConhecida: true,
};

/**
 * ⚠️ Os ids são UUID de verdade porque `surveyResponseSchema` valida o formato
 * ANTES de chamar o banco. Com "op-2" a action devolvia `failed` em silêncio, e
 * o teste acusava "nenhuma resposta registrada" sem dizer por quê.
 */
const OP1 = "0d000000-0000-4000-8000-000000000001";
const OP2 = "0d000000-0000-4000-8000-000000000002";
const OP3 = "0d000000-0000-4000-8000-000000000003";

const OPCOES = [
  { option_id: OP1, option_position: 1, option_text: "Aumentar" },
  { option_id: OP2, option_position: 2, option_text: "Manter" },
  { option_id: OP3, option_position: 3, option_text: "Reduzir" },
];

/**
 * ⚠️ O dublê precisa imitar o ENCADEAMENTO do supabase-js, e não só o `await`.
 *
 * `survey-chatbot.ts` chama `admin.rpc(...).returns<T>()` — o contorno de
 * generics documentado em CONVENTIONS.md. Um mock que devolvesse só uma Promise
 * quebraria ali com "returns is not a function", e o sintoma apareceria como
 * "enquete não encontrada" em todo teste, escondendo o que se queria medir.
 */
function executar(nome: string, args: Record<string, unknown> = {}) {
  switch (nome) {
    case "record_survey_inbound_event": {
      const chave = `${args.p_provider}:${args.p_event_id}`;
      if (banco.eventos.has(chave)) return { data: false, error: null };
      banco.eventos.set(chave, { outcome: null });
      return { data: true, error: null };
    }

    case "complete_survey_inbound_event": {
      const chave = `${args.p_provider}:${args.p_event_id}`;
      const linha = banco.eventos.get(chave);
      if (linha) linha.outcome = String(args.p_outcome);
      return { data: null, error: null };
    }

    case "find_contact_by_whatsapp":
      return {
        data: banco.contatoExiste ? [{ id: CONTATO, phone: "(19) 99123-4567" }] : [],
        error: null,
      };

    case "resolve_survey_context": {
      const citado = args.p_reply_to_message_id;
      if (citado) {
        const achado = banco.contextos.find((c) => c.state_id === `ctx-${String(citado)}`);
        return { data: achado ? [{ ...achado, matched_by: "quoted" }] : [], error: null };
      }
      const abertos = banco.contextos;
      return {
        data: abertos.map((c) => ({
          ...c,
          matched_by: abertos.length === 1 ? "single" : "ambiguous",
        })),
        error: null,
      };
    }

    case "survey_response_gate":
      return { data: banco.gate, error: null };

    case "get_survey_for_chatbot":
      return {
        data:
          banco.gate === "registered"
            ? OPCOES.map((o) => ({
                survey_id: ENQUETE_A,
                title: "Expectativa do valor da arroba",
                question_id: "q-1",
                question: "Como ficará o valor?",
                ...o,
              }))
            : [],
        error: null,
      };

    case "register_survey_response": {
      const chaveMensagem = args.p_source_message_id ? String(args.p_source_message_id) : null;
      // §73. A idempotência por mensagem vem ANTES de tudo.
      if (chaveMensagem && banco.respostas.has(chaveMensagem)) {
        return { data: "registered", error: null };
      }
      const chavePessoa = `${String(args.p_survey_id)}:${String(args.p_contact_id)}`;
      if (banco.respostas.has(chavePessoa)) return { data: "already_answered", error: null };
      banco.respostas.set(chavePessoa, String(args.p_option_id));
      if (chaveMensagem) banco.respostas.set(chaveMensagem, String(args.p_option_id));
      return { data: "registered", error: null };
    }

    case "close_survey_context":
      banco.contextosFechados.push({
        id: String(args.p_state_id),
        status: String(args.p_status),
      });
      banco.contextos = banco.contextos.filter((c) => c.state_id !== args.p_state_id);
      return { data: null, error: null };

    case "count_survey_context_miss":
      banco.invalidas += 1;
      return { data: banco.invalidas, error: null };

    case "register_survey_opt_out":
      banco.optOuts.push(String(args.p_contact_id));
      return { data: true, error: null };

    case "mark_survey_recipient_by_message":
      if (!banco.mensagemConhecida) return { data: null, error: null };
      banco.statusMarcados.push({
        id: String(args.p_provider_message_id),
        status: String(args.p_status),
      });
      return { data: { id: "rec-1" }, error: null };

    default:
      return { data: null, error: null };
  }
}

type Resultado = { data: unknown; error: unknown };

const rpc = vi.fn((nome: string, args: Record<string, unknown> = {}) => {
  const promessa = Promise.resolve(executar(nome, args) as Resultado) as Promise<Resultado> & {
    returns: () => Promise<Resultado>;
    single: () => Promise<Resultado>;
  };
  promessa.returns = () => promessa;
  promessa.single = () => promessa;
  return promessa;
});

const from = vi.fn(() => ({
  select: () => ({
    eq: () => ({
      not: () => ({
        is: () => ({ count: banco.atendimentoHumano, error: null }),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc, from }),
}));

const { processInboundEvents } = await import("./survey-inbox");

function contexto(surveyId: string, titulo: string, sufixo: string) {
  return {
    state_id: `ctx-${sufixo}`,
    survey_id: surveyId,
    question_id: "q-1",
    recipient_id: "rec-1",
    survey_title: titulo,
    asked_at: new Date().toISOString(),
    matched_by: "single",
  };
}

function mensagem(texto: string, id = "wamid.1", citando: string | null = null): InboundEvent {
  return {
    kind: "message",
    eventId: id,
    from: NUMERO,
    text: texto,
    replyToMessageId: citando,
    timestamp: "1770000000",
  };
}

beforeEach(() => {
  banco.eventos = new Map();
  banco.contatoExiste = true;
  banco.contextos = [contexto(ENQUETE_A, "Expectativa do valor da arroba", "wamid.PERGUNTA")];
  banco.atendimentoHumano = 0;
  banco.respostas = new Map();
  banco.gate = "registered";
  banco.contextosFechados = [];
  banco.optOuts = [];
  banco.invalidas = 0;
  banco.statusMarcados = [];
  banco.mensagemConhecida = true;
  vi.clearAllMocks();
});

async function processar(eventos: InboundEvent[], fake = new FakeProvider()) {
  const r = await processInboundEvents(eventos, fake, "corr-teste");
  return { ...r, fake };
}

describe("§62. Resposta válida", () => {
  it("registra e confirma", async () => {
    const { fake } = await processar([mensagem("2")]);

    expect(banco.respostas.get(`${ENQUETE_A}:${CONTATO}`)).toBe(OP2);
    expect(fake.sent[0]?.body).toMatch(/obrigado pela sua participação/i);
    // §37. No WhatsApp não há retorno visual de "entrou na urna".
    expect(fake.sent[0]?.body).toMatch(/registrada com sucesso/i);
  });

  it("§38. o contexto sai de cena depois da resposta", async () => {
    await processar([mensagem("1")]);
    expect(banco.contextosFechados).toEqual([{ id: "ctx-wamid.PERGUNTA", status: "answered" }]);
  });

  it("aceita o texto da alternativa (§13)", async () => {
    await processar([mensagem("Reduzir")]);
    expect(banco.respostas.get(`${ENQUETE_A}:${CONTATO}`)).toBe(OP3);
  });
});

describe("§62. Resposta inválida (§11)", () => {
  it("não registra e pede de novo, com a lista junto", async () => {
    const { fake } = await processar([mensagem("9")]);

    expect(banco.respostas.size).toBe(0);
    expect(fake.sent[0]?.body).toMatch(/não identificamos uma opção válida/i);
    expect(fake.sent[0]?.body).toContain("1 - Aumentar");
  });

  it("⚠️ depois de três erros a conversa é LIBERADA, não travada", async () => {
    const fake = new FakeProvider();
    await processar([mensagem("9", "e1")], fake);
    await processar([mensagem("8", "e2")], fake);
    await processar([mensagem("7", "e3")], fake);

    expect(fake.sent[2]?.body).toMatch(/encaminhar você para o nosso atendimento/i);
  });

  it('⚠️ "bom dia" NÃO é resposta inválida — o bot cala (§39)', async () => {
    // Colapsar "errou" e "não estava respondendo" produziria o pior atendimento
    // possível: quem manda bom dia recebe "escolha uma das opções", e três
    // bons-dias depois é expulso da enquete.
    const { fake } = await processar([mensagem("bom dia, tudo bem?")]);

    expect(fake.sent).toHaveLength(0);
    expect(banco.invalidas).toBe(0);
    expect(banco.contextosFechados).toHaveLength(0);
  });
});

describe("§14, §63, §64. Duplicidade e idempotência", () => {
  it("⚠️ O MESMO WEBHOOK REENTREGUE não vira segunda resposta", async () => {
    const fake = new FakeProvider();
    const evento = mensagem("2", "wamid.MESMA");

    const r1 = await processar([evento], fake);
    const r2 = await processar([evento], fake);

    expect(r1.processed).toBe(1);
    expect(r2.duplicates).toBe(1);
    expect(r2.processed).toBe(0);
    // E o bot NÃO fala de novo: a pessoa receberia dois "obrigado" por uma
    // resposta só.
    expect(fake.sent).toHaveLength(1);
  });

  it("cinco reentregas continuam sendo uma resposta", async () => {
    const fake = new FakeProvider();
    const evento = mensagem("2", "wamid.MESMA");
    for (let i = 0; i < 5; i += 1) await processar([evento], fake);

    expect(fake.sent).toHaveLength(1);
    expect(banco.respostas.get(`${ENQUETE_A}:${CONTATO}`)).toBe(OP2);
  });

  it("§14. responder de novo, por OUTRA mensagem, diz 'você já participou'", async () => {
    const fake = new FakeProvider();
    await processar([mensagem("2", "wamid.1")], fake);

    banco.contextos = [contexto(ENQUETE_A, "Expectativa do valor da arroba", "wamid.PERGUNTA")];
    await processar([mensagem("3", "wamid.2")], fake);

    expect(fake.sent[1]?.body).toMatch(/já participou/i);
    // A primeira resposta é a que vale: a segunda não sobrescreve.
    expect(banco.respostas.get(`${ENQUETE_A}:${CONTATO}`)).toBe(OP2);
  });

  it("dois eventos DIFERENTES no mesmo lote são vistos como dois", async () => {
    const r = await processar([mensagem("2", "wamid.A"), mensagem("3", "wamid.B")]);

    // ⚠️ Só o primeiro vira resposta, e está CERTO: ele fecha o contexto, então
    // o segundo cai em "sem enquete em contexto" (§44) — que é o que aconteceria
    // com qualquer mensagem seguinte de quem já respondeu.
    expect(r.processed).toBe(1);
    // O que este teste protege é a INDEPENDÊNCIA: nenhum dos dois foi tomado
    // pelo outro. Se a chave de idempotência estivesse errada (o telefone, por
    // exemplo, em vez do id da mensagem), o segundo viria como duplicata.
    expect(r.duplicates).toBe(0);
    expect(r.processed + r.duplicates + r.ignored).toBe(2);
  });
});

describe("§9, §45. Mais de uma enquete em aberto", () => {
  it("⚠️ NÃO ESCOLHE — pergunta", async () => {
    banco.contextos = [
      contexto(ENQUETE_A, "Expectativa do valor da arroba", "wamid.A"),
      contexto(ENQUETE_B, "Satisfação com o atendimento", "wamid.B"),
    ];

    const { fake } = await processar([mensagem("2")]);

    expect(banco.respostas.size).toBe(0);
    expect(fake.sent[0]?.body).toContain("Expectativa do valor da arroba");
    expect(fake.sent[0]?.body).toContain("Satisfação com o atendimento");
    expect(fake.sent[0]?.body).toMatch(/mais de uma enquete/i);
  });

  it("⚠️ a CITAÇÃO desempata sem perguntar nada", async () => {
    banco.contextos = [
      contexto(ENQUETE_A, "Expectativa do valor da arroba", "wamid.A"),
      contexto(ENQUETE_B, "Satisfação com o atendimento", "wamid.B"),
    ];

    await processar([mensagem("2", "wamid.1", "wamid.B")]);

    expect(banco.respostas.get(`${ENQUETE_B}:${CONTATO}`)).toBe(OP2);
  });
});

describe("§41, §42. Enquete encerrada ou cancelada", () => {
  it("encerrada: diz que encerrou e NÃO registra", async () => {
    banco.gate = "closed";
    const { fake } = await processar([mensagem("2")]);

    expect(banco.respostas.size).toBe(0);
    expect(fake.sent[0]?.body).toMatch(/já foi encerrada/i);
    expect(banco.contextosFechados[0]?.status).toBe("expired");
  });

  it("cancelada: diz que não está disponível e NÃO registra", async () => {
    banco.gate = "cancelled";
    const { fake } = await processar([mensagem("2")]);

    expect(banco.respostas.size).toBe(0);
    expect(fake.sent[0]?.body).toMatch(/não está disponível/i);
  });
});

describe("§43, §44. Sem contexto", () => {
  it("⚠️ '1' sem enquete em contexto NÃO vira voto", async () => {
    banco.contextos = [];
    const { fake, processed } = await processar([mensagem("1")]);

    expect(banco.respostas.size).toBe(0);
    expect(processed).toBe(0);
    // E o bot da enquete não fala: o fluxo normal do chatbot é que cuida.
    expect(fake.sent).toHaveLength(0);
  });

  it("número desconhecido não vira nada", async () => {
    banco.contatoExiste = false;
    const { fake } = await processar([mensagem("1")]);

    expect(banco.respostas.size).toBe(0);
    expect(fake.sent).toHaveLength(0);
  });
});

describe("§40. Atendimento humano ativo", () => {
  it("⚠️ a enquete NÃO atravessa uma conversa humana", async () => {
    banco.atendimentoHumano = 1;
    const { fake } = await processar([mensagem("2")]);

    expect(banco.respostas.size).toBe(0);
    expect(fake.sent).toHaveLength(0);
  });

  it("⚠️ mas a mensagem CITADA vale mesmo assim", async () => {
    // Clicar em "responder" NA mensagem da enquete é intenção inequívoca.
    // Sem esta exceção, quem está resolvendo outro assunto com o time perderia
    // o voto.
    banco.atendimentoHumano = 1;
    await processar([mensagem("2", "wamid.1", "wamid.PERGUNTA")]);

    expect(banco.respostas.get(`${ENQUETE_A}:${CONTATO}`)).toBe(OP2);
  });
});

describe("§32. Sair da lista", () => {
  it("registra o opt-out e confirma", async () => {
    const { fake } = await processar([mensagem("SAIR")]);

    expect(banco.optOuts).toEqual([CONTATO]);
    expect(fake.sent[0]?.body).toMatch(/não receberá mais enquetes/i);
    expect(banco.respostas.size).toBe(0);
  });
});

describe("§39. Falar com gente", () => {
  it("libera o contexto e avisa", async () => {
    const { fake } = await processar([mensagem("atendente")]);

    expect(banco.contextosFechados[0]?.status).toBe("released");
    expect(fake.sent[0]?.body).toMatch(/encaminhar você para o nosso atendimento/i);
  });
});

describe("§26. Webhook de status", () => {
  function status(estado: "sent" | "delivered" | "read" | "failed", id = "wamid.X"): InboundEvent {
    return {
      kind: "status",
      eventId: `${id}:${estado}`,
      providerMessageId: id,
      status: estado,
      errorMessage: estado === "failed" ? "Recipient not found" : null,
      timestamp: "1770000000",
    };
  }

  it("sobe a escala", async () => {
    await processar([status("sent"), status("delivered"), status("read")]);
    expect(banco.statusMarcados.map((s) => s.status)).toEqual(["sent", "delivered", "read"]);
  });

  it("'failed' vira erro", async () => {
    await processar([status("failed")]);
    expect(banco.statusMarcados[0]?.status).toBe("error");
  });

  it("⚠️ os três status da MESMA mensagem são eventos distintos", async () => {
    // Sem o sufixo na chave de idempotência, só o primeiro seria processado —
    // e "entregue" e "lido" nunca chegariam.
    const r = await processar([status("sent"), status("delivered"), status("read")]);
    expect(r.duplicates).toBe(0);
    expect(r.processed).toBe(3);
  });

  it("status de mensagem que não é de enquete é ignorado em silêncio", async () => {
    // O WhatsApp manda status de TODA mensagem da conta. Lançar erro faria o
    // webhook devolver 500 e o fornecedor reentregar para sempre.
    banco.mensagemConhecida = false;
    const r = await processar([status("delivered")]);
    expect(r.ignored).toBe(1);
    expect(r.processed).toBe(0);
  });
});

describe("§19. Nada derruba o webhook", () => {
  it("um evento que explode não impede os outros", async () => {
    // O cast existe porque o dublê devolve uma Promise ENRIQUECIDA (com
    // `.returns`), e uma que lança não tem esses métodos — é o ponto do teste.
    rpc.mockImplementationOnce((() => {
      throw new Error("banco caiu");
    }) as unknown as Parameters<typeof rpc.mockImplementationOnce>[0]);

    const r = await processar([mensagem("2", "wamid.A"), mensagem("3", "wamid.B")]);
    expect(r.ignored + r.processed).toBe(2);
  });

  it("processInboundEvents nunca lança", async () => {
    rpc.mockImplementation((() => {
      throw new Error("tudo caiu");
    }) as unknown as Parameters<typeof rpc.mockImplementation>[0]);

    await expect(processar([mensagem("2")])).resolves.toBeDefined();
  });
});
