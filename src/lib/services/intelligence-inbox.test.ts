import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeProvider } from "@/lib/messaging/providers/fake";
import { UnconfiguredProvider } from "@/lib/messaging/providers/unconfigured";
import type { MessagingProvider } from "@/lib/messaging/messaging.types";
import type { RecordedMessage } from "./whatsapp-inbox";

/**
 * §41, §60, §64. QUANDO O ROBÔ FALA — e, principalmente, quando ele CALA.
 *
 * ⚠️ ESTA BATERIA É SOBRE O SILÊNCIO. Um robô que responde demais não dá erro
 * em lugar nenhum: ele atravessa uma conversa humana, responde ao próprio eco,
 * ou manda a Bolsa duas vezes porque o fornecedor reentregou o webhook. Todos
 * os três "funcionam" — e todos são vistos pelo associado, não pelo log.
 */

const CHAT = "ccccccc1-0000-4000-8000-000000000001";
const NUMERO = "5519991234567";

const estado = {
  /** O que `whatsapp_bot_should_answer` responde. */
  podeFalar: true,
  /** §39. O que `whatsapp_bot_rate_ok` responde. */
  dentroDoLimite: true,
  /** §83. O que a chave geral responde. */
  ligado: true,
  /** Conversas caladas por `whatsapp_pause_bot`. */
  pausadas: [] as string[],
  /** O que `handleIncomingMessage` devolve. */
  handoff: false,
  /** Chamadas ao motor — é o que prova que ele NÃO foi chamado. */
  turnos: [] as { chatId: string; message: string }[],
  /** O que a entrega reporta. */
  entregaFalhou: false,
  entregas: [] as { chatId: string; body: string }[],
  amarracoes: [] as { interactionId: number; messageId: string }[],
};

vi.mock("./whatsapp-bot", () => ({
  botShouldAnswer: vi.fn(async () => estado.podeFalar),
  botWithinRateLimit: vi.fn(async () => estado.dentroDoLimite),
  pauseBot: vi.fn(async (chatId: string) => {
    estado.pausadas.push(chatId);
  }),
  getBotChatTarget: vi.fn(async (chatId: string) => ({
    chatId,
    chatKey: NUMERO,
    phone: NUMERO,
    contactId: null,
    memberId: null,
  })),
  linkInteractionReply: vi.fn(async (interactionId: number, messageId: string) => {
    estado.amarracoes.push({ interactionId, messageId });
  }),
}));

vi.mock("@/lib/intelligence/engine", () => ({
  handleIncomingMessage: vi.fn(async (input: { chatId: string; message: string }) => {
    estado.turnos.push({ chatId: input.chatId, message: input.message });
    return {
      body: "Olá! Sou o assistente virtual da APCS.",
      attachments: [],
      handoff: estado.handoff,
      interactionId: 42,
      intent: estado.handoff ? "falar_com_atendente" : "saudacao",
      tool: null,
      outcome: estado.handoff ? "handoff" : "message",
    };
  }),
}));

vi.mock("@/lib/intelligence/flags", () => ({
  chatbotEnabled: vi.fn(async () => estado.ligado),
}));

vi.mock("@/lib/intelligence/deliver", () => ({
  deliverBotReply: vi.fn(
    async (params: { target: { chatId: string }; reply: { body: string } }) => {
      estado.entregas.push({ chatId: params.target.chatId, body: params.reply.body });
      return {
        sent: estado.entregaFalhou ? 0 : 1,
        failed: estado.entregaFalhou,
        firstMessageId: estado.entregaFalhou ? null : "msg-enviada",
        attachmentsSent: 0,
      };
    },
  ),
}));

/** O histórico da conversa. Não é o que esta bateria mede. */
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          neq: () => ({
            order: () => ({
              limit: () => ({ returns: () => ({ data: [], error: null }) }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

const { processChatbotMessages } = await import("./intelligence-inbox");

function mensagem(over: Partial<RecordedMessage> = {}): RecordedMessage {
  return {
    eventId: "wamid.1",
    messageId: "msg-recebida-1",
    chatId: CHAT,
    duplicate: false,
    fromMe: false,
    isGroup: false,
    text: "Oi",
    phone: NUMERO,
    ...over,
  };
}

beforeEach(() => {
  estado.podeFalar = true;
  estado.dentroDoLimite = true;
  estado.ligado = true;
  estado.pausadas = [];
  estado.handoff = false;
  estado.turnos = [];
  estado.entregaFalhou = false;
  estado.entregas = [];
  estado.amarracoes = [];
  vi.clearAllMocks();
});

function processar(
  mensagens: RecordedMessage[],
  tratados: string[] = [],
  provider: MessagingProvider = new FakeProvider(),
) {
  return processChatbotMessages(mensagens, new Set(tratados), provider, "corr-teste");
}

describe("§7. A primeira mensagem", () => {
  it('"Oi" chega ao motor e a resposta é entregue', async () => {
    const r = await processar([mensagem()]);

    expect(estado.turnos).toEqual([{ chatId: CHAT, message: "Oi" }]);
    expect(estado.entregas).toHaveLength(1);
    expect(r.answered).toBe(1);
  });
});

describe("§41 e §60. Reentrega", () => {
  /**
   * ⚠️ O TESTE MAIS IMPORTANTE DESTA BATERIA. A Z-API reentrega o payload
   * sempre que não recebe 200 a tempo — é o caminho NORMAL, não uma anomalia.
   * Sem esta guarda, cada reentrega manda a Bolsa de novo: dois PDFs iguais
   * para quem pediu um.
   */
  it("mensagem marcada como reentrega não é respondida", async () => {
    const r = await processar([mensagem({ duplicate: true })]);

    expect(estado.turnos).toEqual([]);
    expect(estado.entregas).toEqual([]);
    expect(r.skipped).toBe(1);
  });

  it("o mesmo webhook duas vezes produz UMA resposta só", async () => {
    // Primeira entrega: mensagem nova. Segunda: o livro-razão já a conhecia.
    await processar([mensagem()]);
    await processar([mensagem({ duplicate: true })]);

    expect(estado.entregas).toHaveLength(1);
  });
});

describe("A fila de precedência", () => {
  /**
   * ⚠️ SEM ISTO, O ROBÔ RESPONDE AO PRÓPRIO ECO — em laço, com a conta pagando
   * cada volta. A Z-API avisa sobre tudo que sai do número, inclusive o que ela
   * acabou de enviar a nosso pedido.
   */
  it("o que saiu do nosso número não é pergunta de ninguém", async () => {
    await processar([mensagem({ fromMe: true })]);

    expect(estado.turnos).toEqual([]);
  });

  it("grupo nunca", async () => {
    // Um grupo é dezenas de pessoas conversando entre si; o robô responderia a
    // cada menção de "bolsa" no meio de um papo.
    await processar([mensagem({ isGroup: true })]);

    expect(estado.turnos).toEqual([]);
  });

  /**
   * ⚠️ UM "3" DENTRO DE UMA ENQUETE É VOTO, E NÃO PERGUNTA. O robô respondendo
   * por cima transformaria o voto numa consulta — e a pessoa veria "não
   * entendi" depois de responder certo.
   */
  it("o que a Enquete tratou não chega ao robô", async () => {
    await processar([mensagem({ eventId: "wamid.voto", text: "3" })], ["wamid.voto"]);

    expect(estado.turnos).toEqual([]);
  });

  /**
   * ⚠️ MENSAGEM SÓ COM ANEXO É DECISÃO, NÃO ESQUECIMENTO. Ver
   * `motivoParaPular`: o contador de não lidas fica aceso e um humano atende.
   * Um "não entendi" automático faria a pessoa achar que foi atendida.
   */
  it("foto e áudio sem texto ficam para uma pessoa", async () => {
    await processar([mensagem({ text: "   " })]);

    expect(estado.turnos).toEqual([]);
  });

  /**
   * ⚠️ ATENDIMENTO HUMANO EM ANDAMENTO NÃO SE ATRAVESSA. Quem decide é
   * `whatsapp_bot_should_answer`, no banco — aqui só se obedece.
   */
  it("conversa calada não recebe resposta do robô", async () => {
    estado.podeFalar = false;

    const r = await processar([mensagem()]);

    expect(estado.turnos).toEqual([]);
    expect(r.skipped).toBe(1);
  });
});

describe("§39. Limite de uso", () => {
  /**
   * ⚠️ ESTOURAR É FICAR CALADO, e não avisar. Quem manda sete mensagens num
   * minuto não está esperando resposta — e uma frase automática de repreensão a
   * um associado é pior que o silêncio.
   */
  it("acima do limite, o robô não classifica nem responde", async () => {
    estado.dentroDoLimite = false;

    const r = await processar([mensagem()]);

    expect(estado.turnos).toEqual([]);
    expect(estado.entregas).toEqual([]);
    expect(r.skipped).toBe(1);
  });

  /**
   * ⚠️ O LIMITE VEM ANTES DO MODELO. Um limite consultado depois da
   * classificação protegeria contra tudo menos contra a única coisa que ele
   * existe para proteger: o custo.
   */
  it("o limite é conferido antes de gastar o modelo", async () => {
    estado.dentroDoLimite = false;
    await processar([mensagem()]);

    expect(estado.turnos).toHaveLength(0);
  });
});

describe("§83. A chave geral", () => {
  it("desligado, nenhuma mensagem do lote é respondida", async () => {
    estado.ligado = false;

    const r = await processar([mensagem({ eventId: "a" }), mensagem({ eventId: "b" })]);

    expect(estado.turnos).toEqual([]);
    expect(r.skipped).toBe(2);
  });

  it("ligado, tudo segue normal", async () => {
    const r = await processar([mensagem()]);
    expect(r.answered).toBe(1);
  });
});

describe("§64. Encaminhar para uma pessoa", () => {
  /**
   * ⚠️ O SILÊNCIO VEM ANTES DO ENVIO. Entre o "vou te encaminhar" e o atendente
   * aparecer podem se passar horas — sem calar, o robô responderia a tudo que a
   * pessoa escrevesse enquanto espera, inclusive ao "obrigado" dela.
   */
  it("o robô se cala na hora em que encaminha", async () => {
    estado.handoff = true;

    await processar([mensagem({ text: "quero falar com um atendente" })]);

    expect(estado.pausadas).toEqual([CHAT]);
    // E a frase de encaminhamento SAI: calar não é sumir.
    expect(estado.entregas).toHaveLength(1);
  });

  it("sem encaminhamento, ninguém é calado", async () => {
    await processar([mensagem()]);

    expect(estado.pausadas).toEqual([]);
  });
});

describe("§46. A corrente fechada", () => {
  it("amarra a decisão à mensagem que saiu", async () => {
    await processar([mensagem()]);

    expect(estado.amarracoes).toEqual([{ interactionId: 42, messageId: "msg-enviada" }]);
  });

  it("envio que falhou não amarra nada", async () => {
    estado.entregaFalhou = true;

    const r = await processar([mensagem()]);

    expect(estado.amarracoes).toEqual([]);
    expect(r.failed).toBe(1);
  });
});

describe("§52. Sem fornecedor", () => {
  /**
   * ⚠️ RECUSA ANTES DE CLASSIFICAR. Sem fornecedor não há a quem responder —
   * gastar o modelo e gravar uma resposta pendente que nunca vai sair deixaria
   * na conversa uma falha com cara de problema do associado.
   */
  it("não classifica nem grava quando a integração não existe", async () => {
    const r = await processar([mensagem()], [], new UnconfiguredProvider(["APCS_ZAPI_TOKEN"]));

    expect(estado.turnos).toEqual([]);
    expect(r.skipped).toBe(1);
  });
});

describe("Nada aqui lança para fora", () => {
  /**
   * ⚠️ UMA EXCEÇÃO VIRARIA 500 NO WEBHOOK, o fornecedor reentregaria o payload,
   * e o resultado seria um laço de reentrega sobre um erro que não se resolve
   * sozinho.
   */
  it("uma mensagem que explode não derruba as outras", async () => {
    const { handleIncomingMessage } = await import("@/lib/intelligence/engine");
    vi.mocked(handleIncomingMessage).mockRejectedValueOnce(new Error("modelo fora do ar"));

    const r = await processar([
      mensagem({ eventId: "wamid.1", messageId: "m1" }),
      mensagem({ eventId: "wamid.2", messageId: "m2" }),
    ]);

    expect(r.failed).toBe(1);
    expect(r.answered).toBe(1);
  });
});
